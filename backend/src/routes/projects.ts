import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getCognitoUser, authenticateCognito } from '../middleware/cognito';
import { query, queryOne } from '../services/database';
import { saveDraft, loadDraft, deleteDraft, convertS3UrlToPresigned } from '../services/storage';
import { config } from '../config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const createProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(), // Project name (optional for backward compatibility)
  category: z.enum(['music_video', 'ad_creative', 'explainer']),
  prompt: z.string().min(10),
  duration: z.number().min(5).max(300),
  style: z.string().optional(),
  mood: z.string().optional(),
  constraints: z.string().optional(),
  aspectRatio: z.string().optional(),
  colorPalette: z.string().optional(),
  pacing: z.string().optional(),
  videoModelId: z.string().optional(),
  imageModelId: z.string().optional(),
  useReferenceFrame: z.boolean().optional(),
  continuous: z.boolean().optional(),
  mode: z.enum(['classic', 'agentic']).default('classic'),
  audioUrl: z.string().url().optional(), // Store uploaded audio URL
});

const updateProjectSchema = createProjectSchema.partial();

export async function projectRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Create project
  fastify.post('/projects', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Create a new project',
      tags: ['projects'],
      body: {
        type: 'object',
        required: ['category', 'prompt', 'duration'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          category: { type: 'string', enum: ['music_video', 'ad_creative', 'explainer'] },
          prompt: { type: 'string', minLength: 10 },
          duration: { type: 'number', minimum: 5, maximum: 300 },
          style: { type: 'string' },
          mood: { type: 'string' },
          constraints: { type: 'string' },
          mode: { type: 'string', enum: ['classic', 'agentic'], default: 'classic' },
          audioUrl: { type: 'string' },
          videoModelId: { type: 'string' },
          imageModelId: { type: 'string' },
          useReferenceFrame: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category: { type: 'string' },
            prompt: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const userId = user.sub;

    const data = createProjectSchema.parse(request.body);

    // Store project in database
    // Use name if provided, otherwise use prompt as fallback
    let projectName = data.name || data.prompt.substring(0, 100);
    
    // Check for duplicate project name and auto-append sequential number
    let finalProjectName = projectName;
    
    // First check if base name exists
    const baseNameExists = await queryOne(
      'SELECT id FROM projects WHERE user_id = $1 AND name = $2',
      [userId, finalProjectName]
    );

    if (baseNameExists) {
      // Base name exists, find the highest number used
      const projectsWithSameBase = await query(
        `SELECT name FROM projects 
         WHERE user_id = $1 AND name LIKE $2 || '%'
         ORDER BY name`,
        [userId, finalProjectName]
      );
      
      let maxNumber = 0;
      const baseNameRegex = new RegExp(`^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
      
      for (const proj of projectsWithSameBase) {
        const match = (proj.name as string).match(baseNameRegex);
        if (match) {
          if (match[1]) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) maxNumber = num;
          } else {
            // No number means it's the base name itself
            if (maxNumber === 0) maxNumber = 1;
          }
        }
      }
      
      // Use next available number
      finalProjectName = maxNumber > 0 ? `${projectName} ${maxNumber + 1}` : `${projectName} 2`;
    }
    
    projectName = finalProjectName;
    
    const result = await query(
      `INSERT INTO projects (user_id, name, category, prompt, mode, status, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        projectName,
        data.category,
        data.prompt,
        data.mode || 'classic',
        'draft',
        JSON.stringify({
          duration: data.duration,
          style: data.style,
          mood: data.mood,
          constraints: data.constraints,
          aspectRatio: data.aspectRatio,
          colorPalette: data.colorPalette,
          pacing: data.pacing,
          videoModelId: data.videoModelId,
          imageModelId: data.imageModelId,
          useReferenceFrame: data.useReferenceFrame !== undefined ? data.useReferenceFrame : false, // Default to false (user must opt-in)
          continuous: data.continuous !== undefined ? data.continuous : false, // Default to false
          audioUrl: data.audioUrl,
        }),
      ]
    );

    const project = result[0];

    // If audioUrl provided, create asset record
    if (data.audioUrl) {
      await query(
        `INSERT INTO assets (project_id, type, url, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          project.id,
          'audio',
          data.audioUrl,
          JSON.stringify({ uploaded: true }),
        ]
      );
    }

    return reply.code(201).send(project);
  });

  // Generate script endpoint
  fastify.post('/projects/:id/generate-script', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate video script and scene breakdown',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {},
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;

    // Verify project belongs to user
    const projectData = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!projectData) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Parse config
    const config = typeof projectData.config === 'string' 
      ? JSON.parse(projectData.config) 
      : (projectData.config || {});

    try {
      const duration = config.duration || 60;
      const videoDuration = duration; // Duration in seconds

      // Always generate script using LLM (no internal parsing)
      fastify.log.info({ projectId }, 'Generating script using LLM');
      
      // Check if OpenRouter API key is configured
      const { config: appConfig } = await import('../config');
      if (!appConfig.openrouter.apiKey) {
        return reply.code(503).send({
          error: 'OpenRouter API key not configured',
          message: 'Please set OPENROUTER_API_KEY in your environment variables',
        });
      }

      // Calculate target script length based on input prompt length
      // Minimum: 10,000 characters, otherwise match input length (unless explicitly asked for more)
      const inputPromptLength = projectData.prompt?.length || 0;
      const minLength = 10000;
      const targetLength = Math.max(minLength, inputPromptLength);
      const targetWords = Math.round(targetLength / 5); // Rough estimate: 5 chars per word
      const targetCharsPerScene = Math.max(200, Math.round(targetLength / 5)); // Distribute across ~5 scenes
      
      // Check if user explicitly asked for a very long/elaborate script
      const promptLower = projectData.prompt?.toLowerCase() || '';
      const asksForLongScript = promptLower.includes('elaborate') || 
                                promptLower.includes('detailed') || 
                                promptLower.includes('comprehensive') ||
                                promptLower.includes('extensive') ||
                                promptLower.includes('10000') ||
                                promptLower.includes('10,000') ||
                                promptLower.includes('ten thousand');
      
      const finalTargetLength = asksForLongScript ? Math.max(targetLength, 50000) : targetLength;
      const finalTargetWords = Math.round(finalTargetLength / 5);
      const finalTargetCharsPerScene = Math.max(200, Math.round(finalTargetLength / 5));
      
      fastify.log.info({
        projectId,
        inputPromptLength,
        minLength,
        targetLength: finalTargetLength,
        targetWords: finalTargetWords,
        asksForLongScript,
        targetCharsPerScene: finalTargetCharsPerScene,
      }, 'Calculated target script length based on input');

      // Calculate minimum scenes needed (max 8 seconds per scene)
      const MAX_SCENE_DURATION = 8;
      const minScenesNeeded = Math.ceil(videoDuration / MAX_SCENE_DURATION);
      const recommendedScenes = Math.max(minScenesNeeded, Math.ceil(videoDuration / 6)); // Aim for 6-8 seconds per scene

      // Simplified system prompt - just request the JSON structure
      const systemPrompt = `You are a video script writer. Create a detailed video script in JSON format.

Generate approximately ${finalTargetWords} words (${finalTargetLength} characters) total. Break the video into multiple scenes.

CRITICAL SCENE PLANNING:
- Each scene must be MAXIMUM 8 seconds long
- Minimum scenes needed: ${minScenesNeeded} scenes (${videoDuration} seconds ÷ 8 seconds per scene)
- Recommended: ${recommendedScenes} scenes for optimal pacing
- Each scene duration must be ≤ 8 seconds
- Scene durations must add up to exactly ${videoDuration} seconds

CONSISTENCY REQUIREMENTS:
- Establish a consistent theme and visual style in the first scene
- Maintain the same camera style throughout all scenes (e.g., if using "cinematic wide shots", use that consistently)
- Keep consistent color palette, lighting approach, and visual aesthetic across all scenes
- Ensure characters and objects maintain consistent appearance throughout
- Create smooth visual transitions between scenes

SCENE PROMPT REQUIREMENTS:
- Each scene prompt must be EXTENSIVE (400-600+ characters minimum, approximately ${finalTargetCharsPerScene} characters)
- Include detailed visual descriptions: camera angles, movements, framing
- Specify lighting conditions, color palette, and mood
- Describe environmental details, character positioning, and actions
- Include consistency notes referencing the established theme and camera style
- Add visual details that ensure continuity with previous scenes

Output ONLY valid JSON in this exact format:
{
  "overallPrompt": "The original user prompt",
  "parsedPrompt": {
    "style": "Visual style description",
    "mood": "Emotional tone",
    "duration": ${videoDuration},
    "keywords": ["keyword1", "keyword2"],
    "keyElements": ["element1", "element2"]
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "EXTENSIVE scene description (400-600+ characters) with visual details, camera style, lighting, composition, and consistency notes",
      "duration": X.X,
      "startTime": X.X,
      "endTime": X.X
    }
  ]
}

Scene durations must add up to exactly ${videoDuration} seconds, and each scene must be ≤ 8 seconds.`;

      // Simplified user prompt
      const userPrompt = `Create a detailed video script for this concept:

${projectData.prompt}

Duration: ${videoDuration} seconds
${config.style ? `Style: ${config.style}` : ''}
${config.mood ? `Mood: ${config.mood}` : ''}

CRITICAL REQUIREMENTS:
- Generate ${recommendedScenes} scenes (each scene must be ≤ 8 seconds, total duration = ${videoDuration} seconds)
- Each scene prompt must be 400-600+ characters with extensive visual details
- Establish consistent theme and camera style in scene 1, maintain throughout all scenes
- Include detailed camera angles, lighting, color palette, and visual consistency notes in each scene
- Ensure smooth transitions and visual continuity between scenes

Generate approximately ${finalTargetWords} words (${finalTargetLength} characters) total. Break into multiple scenes with EXTENSIVE visual descriptions. Return ONLY valid JSON.`;

      // Call OpenRouter API with Claude Sonnet 4.5
      // Add timeout to prevent hanging (3 minutes for large script generation)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3 * 60 * 1000); // 3 minutes timeout
      
      fastify.log.info({ projectId, promptLength: userPrompt.length }, 'Calling OpenRouter API for script generation');
      
      let openrouterResponse: Response;
      try {
        openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appConfig.openrouter.apiKey}`,
            'HTTP-Referer': appConfig.app.frontendUrl || 'https://vidverseai.com',
            'X-Title': 'VidVerse AI Script Generator',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-4.5-sonnet',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: 32000, // Reduced from 100000 - most models have limits around 32k-64k tokens
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          fastify.log.error({ projectId }, 'OpenRouter API request timed out after 3 minutes');
          return reply.code(504).send({
            error: 'Script generation timed out',
            message: 'The script generation request took too long. Please try again with a shorter prompt or reduce the duration.',
          });
        }
        fastify.log.error({ projectId, error: fetchError.message }, 'OpenRouter API fetch failed');
        return reply.code(502).send({
          error: 'Script generation failed',
          message: `Failed to connect to AI service: ${fetchError.message}`,
        });
      }

      if (!openrouterResponse.ok) {
        const errorText = await openrouterResponse.text();
        let errorMessage = 'Failed to generate script. Please try again.';
        let statusCode = 502;
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
          // Check for common API issues
          if (errorData.error?.code === 'insufficient_quota' || errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('credit')) {
            errorMessage = 'OpenRouter API quota/credits exhausted. Please check your account balance.';
            statusCode = 402; // Payment Required
          } else if (errorData.error?.code === 'invalid_api_key' || errorMessage.toLowerCase().includes('api key')) {
            errorMessage = 'OpenRouter API key is invalid or expired.';
            statusCode = 401;
          } else if (errorData.error?.code === 'rate_limit' || errorMessage.toLowerCase().includes('rate limit')) {
            errorMessage = 'OpenRouter API rate limit exceeded. Please try again later.';
            statusCode = 429;
          }
        } catch {
          // Use default error message
        }

        fastify.log.error({ 
          status: openrouterResponse.status,
          statusText: openrouterResponse.statusText,
          error: errorText.substring(0, 500), // Limit error text length
          projectId 
        }, 'OpenRouter API error during script generation');
        
        return reply.code(statusCode).send({
          error: 'Script generation failed',
          message: errorMessage,
        });
      }

      const openrouterData = await openrouterResponse.json();

      if (!openrouterData.choices || !openrouterData.choices[0]) {
        return reply.code(502).send({
          error: 'Invalid response from AI service',
          message: 'The AI service returned an invalid response format',
        });
      }

      const aiResponse = openrouterData.choices[0].message.content;
      const finishReason = openrouterData.choices[0].finish_reason;
      const usage = openrouterData.usage;
      
      // Log OpenRouter response metadata to diagnose truncation issues
      fastify.log.info({
        projectId,
        finishReason,
        usage: {
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        },
        maxTokensRequested: 32000,
        tokensUsed: usage?.completion_tokens || 0,
        tokensRemaining: 32000 - (usage?.completion_tokens || 0),
        wasTruncated: finishReason === 'length', // 'length' means hit token limit
        wasStopped: finishReason === 'stop', // 'stop' means natural completion
      }, 'OpenRouter API response metadata');
      
      if (!aiResponse || typeof aiResponse !== 'string') {
        fastify.log.error({ projectId, response: openrouterData }, 'Invalid AI response format');
        return reply.code(502).send({
          error: 'Invalid response from AI service',
          message: 'The AI service returned an invalid response format',
        });
      }

      // Warn if response was truncated or is unexpectedly short
      // Use the calculated target length (minimum 10,000, or input length, or 50000 if explicitly asked)
      const expectedMinLength = Math.max(10000, Math.round(finalTargetLength * 0.8)); // Allow 20% tolerance
      if (finishReason === 'length') {
        fastify.log.warn({
          projectId,
          responseLength: aiResponse.length,
          tokensUsed: usage?.completion_tokens,
          maxTokens: 32000,
          targetLength: finalTargetLength,
        }, '⚠️ AI response was TRUNCATED - hit token limit. Response is incomplete!');
      } else if (aiResponse.length < expectedMinLength) {
        fastify.log.warn({
          projectId,
          responseLength: aiResponse.length,
          expectedMinLength,
          targetLength: finalTargetLength,
          finishReason,
          tokensUsed: usage?.completion_tokens,
          difference: expectedMinLength - aiResponse.length,
        }, `⚠️ AI response is SHORTER than expected (target: ${finalTargetLength} chars, got: ${aiResponse.length} chars). Model may not have followed instructions.`);
      }

      fastify.log.info({ 
        projectId, 
        responseLength: aiResponse.length,
        responsePreview: aiResponse.substring(0, 500) + (aiResponse.length > 500 ? '...' : ''),
        responseEnd: aiResponse.length > 500 ? '...' + aiResponse.substring(aiResponse.length - 500) : aiResponse,
      }, 'Received AI response, parsing JSON');

      // Simple function to extract JSON from markdown code blocks
      const extractJsonFromMarkdown = (text: string): string | null => {
        // Try to find markdown code blocks with json
        // Match ```json or ``` followed by content and closing ```
        // Use greedy match to get the full content between first and last ```
        const markdownMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (markdownMatch && markdownMatch[1]) {
          return markdownMatch[1].trim();
        }
        // Also try to find JSON object boundaries if markdown extraction fails
        const firstBrace = text.indexOf('{');
        if (firstBrace !== -1) {
          let braceCount = 0;
          let lastBrace = -1;
          for (let i = firstBrace; i < text.length; i++) {
            if (text[i] === '{') braceCount++;
            if (text[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                lastBrace = i;
                break;
              }
            }
          }
          if (lastBrace !== -1) {
            return text.substring(firstBrace, lastBrace + 1);
          }
        }
        return null;
      };

      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      let scriptJson: any;
      
      // Step 1: Try to extract from markdown code blocks first
      const extractedFromMarkdown = extractJsonFromMarkdown(aiResponse);
      if (extractedFromMarkdown) {
        try {
          scriptJson = JSON.parse(extractedFromMarkdown);
          fastify.log.info({ projectId, extractedLength: extractedFromMarkdown.length }, 'Successfully parsed JSON from markdown code block');
        } catch (markdownError: any) {
          fastify.log.warn({ projectId, error: markdownError.message }, 'Failed to parse JSON from markdown, trying direct parse');
          // Fall through to try direct parse
        }
      }
      
      // Step 2: If markdown extraction failed or wasn't found, try direct parse
      if (!scriptJson) {
        try {
          scriptJson = JSON.parse(aiResponse);
          fastify.log.info({ projectId }, 'Successfully parsed JSON directly from AI response');
        } catch (parseError: any) {
          fastify.log.error({ 
            projectId, 
            error: parseError.message,
            hasMarkdown: !!extractedFromMarkdown,
            responsePreview: aiResponse.substring(0, 500),
          }, 'Failed to parse JSON from AI response');
          
          return reply.code(502).send({
            error: 'Failed to parse script JSON',
            message: `Could not parse JSON from AI response. The response may be truncated or invalid. Error: ${parseError.message}`,
          });
        }
      }

      // Validate and format the response
      if (!scriptJson.scenes || !Array.isArray(scriptJson.scenes)) {
        return reply.code(502).send({
          error: 'Invalid script format',
          message: 'The generated script does not have the required scene structure',
        });
      }

      // Ensure all scenes have required fields
      const scenes = scriptJson.scenes.map((scene: any, index: number) => ({
        sceneNumber: scene.sceneNumber || index + 1,
        prompt: scene.prompt || '',
        duration: scene.duration || 0,
        startTime: scene.startTime || 0,
        endTime: scene.endTime || 0,
      }));

      // Ensure overallPrompt is set
      scriptJson.overallPrompt = scriptJson.overallPrompt || projectData.prompt;
      
      // Merge in params from config (dropdown selections) into parsedPrompt
      if (!scriptJson.parsedPrompt) scriptJson.parsedPrompt = {};
      if (config.style) scriptJson.parsedPrompt.style = config.style;
      if (config.mood) scriptJson.parsedPrompt.mood = config.mood;
      if (config.aspectRatio) scriptJson.parsedPrompt.aspectRatio = config.aspectRatio;
      if (config.colorPalette) scriptJson.parsedPrompt.colorPalette = config.colorPalette;
      if (config.pacing) scriptJson.parsedPrompt.pacing = config.pacing;

      // Return the script
      return reply.send({
        script: JSON.stringify(scriptJson, null, 2),
        scenes: scenes,
      });
    } catch (error: any) {
      fastify.log.error({ err: error, projectId }, 'Script generation failed');
      return reply.code(500).send({
        error: 'Script generation failed',
        message: error.message || 'An error occurred during script generation',
      });
    }
  });

  // Synchronous video generation endpoint (for development without Redis)
  fastify.post('/projects/:id/generate-sync', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate video synchronously (development mode, no Redis required)',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          useReferenceFrame: { type: 'boolean' },
          continuous: { type: 'boolean' },
          videoModelId: { type: 'string' },
          aspectRatio: { type: 'string' },
          style: { type: 'string' },
          mood: { type: 'string' },
          colorPalette: { type: 'string' },
          pacing: { type: 'string' },
          referenceImages: {
            type: 'array',
            items: { type: 'string' },
          },
          assetIdToUrlMap: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body?: { useReferenceFrame?: boolean; continuous?: boolean; videoModelId?: string; aspectRatio?: string; style?: string; mood?: string; colorPalette?: string; pacing?: string; referenceImages?: string[] } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const requestBody = request.body || {};

    fastify.log.info({
      projectId,
      userId: user.sub,
      hasReferenceImages: Array.isArray(requestBody.referenceImages) && requestBody.referenceImages.length > 0,
      referenceImagesCount: Array.isArray(requestBody.referenceImages) ? requestBody.referenceImages.length : 0,
    }, 'Video generation request received');

    // Verify project belongs to user
    const projectData = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!projectData) {
      fastify.log.warn({ projectId, userId: user.sub }, 'Project not found for video generation');
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Parse config from database
    const dbConfig = typeof projectData.config === 'string' 
      ? JSON.parse(projectData.config) 
      : (projectData.config || {});

    // Merge request body values with database config (request body overrides database config)
    const config = {
      ...dbConfig,
      // Override with request body values if provided
      ...(requestBody.useReferenceFrame !== undefined && { useReferenceFrame: requestBody.useReferenceFrame }),
      ...(requestBody.continuous !== undefined && { continuous: requestBody.continuous }),
      ...(requestBody.videoModelId !== undefined && { videoModelId: requestBody.videoModelId }),
      ...(requestBody.aspectRatio !== undefined && { aspectRatio: requestBody.aspectRatio }),
      ...(requestBody.style !== undefined && { style: requestBody.style }),
      ...(requestBody.mood !== undefined && { mood: requestBody.mood }),
      ...(requestBody.colorPalette !== undefined && { colorPalette: requestBody.colorPalette }),
      ...(requestBody.pacing !== undefined && { pacing: requestBody.pacing }),
      ...(requestBody.referenceImages !== undefined && { referenceImages: requestBody.referenceImages }),
    };

    // Log config values for debugging
    fastify.log.info({ 
      projectId, 
      requestBodyUseReferenceFrame: requestBody.useReferenceFrame,
      dbConfigUseReferenceFrame: dbConfig.useReferenceFrame,
      finalConfigUseReferenceFrame: config.useReferenceFrame,
      useReferenceFrameType: typeof config.useReferenceFrame,
      videoModelId: config.videoModelId,
      aspectRatio: config.aspectRatio,
      requestBodyKeys: Object.keys(requestBody),
    }, 'Parsed project config values (merged from DB and request body)');

    // Import video generation functions
    const { parsePrompt } = await import('../services/promptParser');
    const { planScenes } = await import('../services/scenePlanner');
    const { generateVideo } = await import('../services/replicate');
    const { extractFrames, concatenateVideos, addAudioToVideo } = await import('../services/videoProcessor');
    const { uploadGeneratedVideo } = await import('../services/storage');
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const generationStartTime = Date.now();
    fastify.log.info({ 
      projectId, 
      userId: user.sub,
      configVideoModelId: config.videoModelId,
      configAspectRatio: config.aspectRatio,
      configStyle: config.style,
      configMood: config.mood,
      rawConfigType: typeof projectData.config,
    }, 'Starting synchronous video generation');

    // Declare variables outside try block so they're accessible in catch block
    let scenes: Array<{ sceneNumber: number; prompt: string; duration: number; startTime: number; endTime: number }> = [];
    const sceneVideos: string[] = [];
    const frameUrls: { first: string; last: string }[] = [];
    let previousSceneLastFrameUrl: string | undefined = undefined; // Track last frame from previous scene
    
    // Load existing sceneVideoIds from config if available (for extending existing projects)
    const existingSceneVideoIds = config.sceneVideoIds && Array.isArray(config.sceneVideoIds) 
      ? config.sceneVideoIds 
      : [];
    const sceneVideoIds: Array<{ videoId?: string; videoObject?: any; videoUrl: string; gcsUri?: string }> = [...existingSceneVideoIds]; // Store video IDs/objects/GCS URIs for extension
    let previousSceneVideoId: string | undefined = undefined; // Track video ID from previous scene for extension
    let previousSceneVideoObject: any = undefined; // Track video object from previous scene for extension

    try {
      // Update project status to generating
      fastify.log.info({ projectId }, 'Step 0: Updating project status to "generating"');
      await query(
        'UPDATE projects SET status = $1 WHERE id = $2',
        ['generating', projectId]
      );
      fastify.log.info({ projectId }, 'Step 0: Project status updated successfully');

      // 1. Check if prompt is already a script, or parse/plan scenes
      const videoDuration = config.duration || 60;
      let scriptParsedPrompt: any = {};
      
      // Check for script in multiple places:
      // 1. config.script (where generated script is stored)
      // 2. projectData.prompt (might contain the full script JSON)
      const scriptText = config.script || projectData.prompt || '';
      
      // Check for script in config.script or projectData.prompt (NOT calling generate-script API)
      
      // Detect if the prompt is already a script
      const isScriptFormat = (text: string, duration: number): boolean => {
        if (!text || text.trim().length === 0) return false;
        
        // Factor 1: Length-based detection (10000+ characters is likely a script)
        if (text.length > 10000) {
          return true;
        }
        
        // Factor 2: Length-based detection (words per second)
        const wordCount = text.trim().split(/\s+/).length;
        const wordsPerSecond = wordCount / duration;
        if (wordsPerSecond >= 300) {
          return true;
        }
        
        // Factor 3: Check for numbered scenes
        const sceneNumberPatterns = [
          /scene\s+\d+/i,
          /scene\s*:\s*\d+/i,
          /scene\s*#\s*\d+/i,
          /^\s*\d+\.\s*scene/i,
          /scene\s*number\s*\d+/i,
        ];
        const hasNumberedScenes = sceneNumberPatterns.some(pattern => pattern.test(text));
        if (hasNumberedScenes) {
          return true;
        }
        
        // Factor 4: Check for duration mentions in scenes
        const durationPatterns = [
          /duration\s*:\s*\d+/i,
          /duration\s*=\s*\d+/i,
          /\d+\s*seconds?/i,
          /startTime|endTime/i,
        ];
        const hasDurationInfo = durationPatterns.some(pattern => pattern.test(text));
        if (hasDurationInfo && hasNumberedScenes) {
          return true;
        }
        
        // Factor 5: Check for JSON structure
        try {
          const parsed = JSON.parse(text);
          if (parsed.scenes && Array.isArray(parsed.scenes)) {
            return true;
          }
          if (parsed.overallPrompt && parsed.parsedPrompt) {
            return true;
          }
        } catch {
          // Not valid JSON
        }
        
        return false;
      };
      
      if (isScriptFormat(scriptText, videoDuration)) {
        // Parse script (same logic as generate-script endpoint)
        // Use scriptText which could be from config.script or projectData.prompt
        let scriptJson: any;
        try {
          scriptJson = JSON.parse(scriptText);
        } catch {
          const jsonMatch = scriptText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              scriptJson = JSON.parse(jsonMatch[1]);
            } catch {
              scriptJson = null;
              fastify.log.warn({ projectId }, 'Failed to parse script from markdown code block');
            }
          } else {
            scriptJson = null;
            fastify.log.warn({ projectId }, 'Script text is not valid JSON and no markdown code block found');
          }
        }
        
        if (scriptJson && scriptJson.scenes && Array.isArray(scriptJson.scenes)) {
          // Use scenes from script
          scriptParsedPrompt = scriptJson.parsedPrompt || {};
          
          // Merge in params from config (dropdown selections)
          if (config.style) scriptParsedPrompt.style = config.style;
          if (config.mood) scriptParsedPrompt.mood = config.mood;
          if (config.aspectRatio) scriptParsedPrompt.aspectRatio = config.aspectRatio;
          if (config.colorPalette) scriptParsedPrompt.colorPalette = config.colorPalette;
          if (config.pacing) scriptParsedPrompt.pacing = config.pacing;
          
          // CRITICAL: Use the detailed scene prompts directly from the script JSON
          // Each scene.prompt already contains the detailed description (1000+ chars) that should be sent to the API
          scenes = scriptJson.scenes.map((scene: any, index: number) => {
            const sceneNumber = scene.sceneNumber || index + 1;
            const scenePrompt = scene.prompt || '';
            
            return {
              sceneNumber: sceneNumber,
              prompt: scenePrompt, // Use the detailed prompt directly from JSON
              duration: scene.duration || ((scene.endTime || 0) - (scene.startTime || 0)),
              startTime: scene.startTime || 0,
              endTime: scene.endTime || 0,
            };
          });
          
          // Log summary of all scenes (single consolidated log)
          fastify.log.info({
            projectId,
            scriptSource: config.script ? 'config.script' : 'projectData.prompt',
            totalScenes: scenes.length,
            totalPromptLength: scenes.reduce((sum, s) => sum + (s.prompt?.length || 0), 0),
            averagePromptLength: Math.round(scenes.reduce((sum, s) => sum + (s.prompt?.length || 0), 0) / scenes.length),
            scenePromptLengths: scenes.map(s => ({
              sceneNumber: s.sceneNumber,
              promptLength: s.prompt?.length || 0,
            })),
          }, 'Script parsed: Extracted scenes from script JSON');
          
          // Validate and adjust script duration if it exceeds target duration
          const scriptTotalDuration = scenes.reduce((sum, scene) => sum + (scene.duration || 0), 0);
          const durationDifference = scriptTotalDuration - videoDuration;
          const durationRatio = scriptTotalDuration / videoDuration;
          
          if (durationDifference > 0.1) { // Allow small floating point differences
            // Check if script is significantly longer (2x or more) - might need splitting
            if (durationRatio >= 2.0) {
              fastify.log.warn({
                projectId,
                scriptTotalDuration,
                targetDuration: videoDuration,
                durationRatio: durationRatio.toFixed(2),
                sceneCount: scenes.length,
                recommendation: 'Consider splitting script into multiple video generation calls to preserve scene durations',
              }, `⚠️ Script duration (${scriptTotalDuration}s) is ${durationRatio.toFixed(1)}x longer than target (${videoDuration}s). This is a large difference - consider splitting into multiple calls.`);
            }
            
            // Script duration exceeds target - scale down proportionally
            // NOTE: Alternative approach would be to split into multiple video generation batches,
            // but that requires more complex logic (multiple API calls, concatenation, etc.)
            // For now, we scale proportionally to fit all scenes in one video
            const scaleFactor = videoDuration / scriptTotalDuration;
            fastify.log.warn({
              projectId,
              scriptTotalDuration,
              targetDuration: videoDuration,
              durationDifference,
              scaleFactor,
              sceneCount: scenes.length,
              action: 'Scaling all scene durations proportionally to fit target duration',
            }, `⚠️ Script duration (${scriptTotalDuration}s) exceeds target duration (${videoDuration}s). Scaling scene durations proportionally by factor ${scaleFactor.toFixed(3)}`);
            
            // Scale all scene durations proportionally
            let adjustedStartTime = 0;
            scenes = scenes.map((scene, index) => {
              const adjustedDuration = (scene.duration || 0) * scaleFactor;
              const adjustedStart = adjustedStartTime;
              const adjustedEnd = adjustedStartTime + adjustedDuration;
              adjustedStartTime = adjustedEnd;
              
              fastify.log.info({
                projectId,
                sceneNumber: scene.sceneNumber,
                originalDuration: scene.duration,
                adjustedDuration: adjustedDuration.toFixed(2),
                originalStartTime: scene.startTime,
                adjustedStartTime: adjustedStart.toFixed(2),
                originalEndTime: scene.endTime,
                adjustedEndTime: adjustedEnd.toFixed(2),
              }, `Step 1-2: Scene ${scene.sceneNumber} duration adjusted to fit target duration`);
              
              return {
                ...scene,
                duration: adjustedDuration,
                startTime: adjustedStart,
                endTime: adjustedEnd,
              };
            });
            
            // Verify final duration
            const finalTotalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
            fastify.log.info({
              projectId,
              finalTotalDuration: finalTotalDuration.toFixed(2),
              targetDuration: videoDuration,
              difference: Math.abs(finalTotalDuration - videoDuration),
            }, `Step 1-2: Final script duration after scaling: ${finalTotalDuration.toFixed(2)}s (target: ${videoDuration}s)`);
          } else if (durationDifference < -0.1) {
            // Script duration is less than target - log warning but don't adjust (might be intentional)
            fastify.log.info({
              projectId,
              scriptTotalDuration,
              targetDuration: videoDuration,
              durationDifference: Math.abs(durationDifference),
            }, `ℹ️ Script duration (${scriptTotalDuration}s) is less than target duration (${videoDuration}s). Using script durations as-is.`);
          } else {
            // Duration matches (within tolerance)
            fastify.log.info({
              projectId,
              scriptTotalDuration,
              targetDuration: videoDuration,
            }, `✓ Script duration matches target duration: ${scriptTotalDuration.toFixed(2)}s`);
          }
        } else {
          // Try to parse as text-based script
          // Use scriptText (from config.script or projectData.prompt) instead of just projectData.prompt
          const textScript = scriptText || projectData.prompt;
          const parsedScenes: any[] = [];
          
          const scenePattern = /(?:^|\n)\s*(?:Scene\s*[#:]?\s*(\d+)|(\d+)\.\s*Scene|Scene\s*Number\s*(\d+))/i;
          const sceneMatches = [...textScript.matchAll(new RegExp(scenePattern.source, 'gim'))];
          
          if (sceneMatches.length > 0) {
            for (let i = 0; i < sceneMatches.length; i++) {
              const match = sceneMatches[i];
              const sceneNum = parseInt(match[1] || match[2] || match[3] || String(i + 1));
              const startPos = match.index! + match[0].length;
              const endPos = i < sceneMatches.length - 1 ? sceneMatches[i + 1].index! : textScript.length;
              const sceneText = textScript.substring(startPos, endPos).trim();
              
              const durationMatch = sceneText.match(/duration\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|sec)?/i);
              const secondsMatch = sceneText.match(/(\d+(?:\.\d+)?)\s*seconds?/i);
              let sceneDuration: number | undefined;
              
              if (durationMatch) {
                sceneDuration = parseFloat(durationMatch[1]);
              } else if (secondsMatch) {
                sceneDuration = parseFloat(secondsMatch[1]);
              }
              
              const startTimeMatch = sceneText.match(/startTime\s*[=:]\s*(\d+(?:\.\d+)?)/i);
              const endTimeMatch = sceneText.match(/endTime\s*[=:]\s*(\d+(?:\.\d+)?)/i);
              const startTime = startTimeMatch ? parseFloat(startTimeMatch[1]) : undefined;
              const endTime = endTimeMatch ? parseFloat(endTimeMatch[1]) : undefined;
              
              let promptText = sceneText
                .replace(/duration\s*[=:]\s*\d+(?:\.\d+)?\s*(?:seconds?|sec)?/gi, '')
                .replace(/(\d+(?:\.\d+)?)\s*seconds?/gi, '')
                .replace(/startTime\s*[=:]\s*\d+(?:\.\d+)?/gi, '')
                .replace(/endTime\s*[=:]\s*\d+(?:\.\d+)?/gi, '')
                .trim();
              
              parsedScenes.push({
                sceneNumber: sceneNum,
                prompt: promptText,
                duration: sceneDuration,
                startTime: startTime,
                endTime: endTime,
              });
            }
          }
          
          if (parsedScenes.length > 0) {
            // Calculate timing if not provided
            let totalAllocated = 0;
            scenes = parsedScenes.map((scene, index) => {
              let sceneDuration = scene.duration;
              let startTime = scene.startTime;
              let endTime = scene.endTime;
              
              if (!sceneDuration) {
                const remainingScenes = parsedScenes.length - index;
                const remainingTime = videoDuration - totalAllocated;
                sceneDuration = remainingTime / remainingScenes;
              }
              
              if (startTime === undefined) {
                startTime = totalAllocated;
              }
              
              if (endTime === undefined) {
                endTime = startTime + sceneDuration;
              }
              
              totalAllocated = endTime;
              
              return {
                sceneNumber: scene.sceneNumber || index + 1,
                prompt: scene.prompt,
                duration: sceneDuration,
                startTime: startTime,
                endTime: endTime,
              };
            });
            
            // Extract params from config
            scriptParsedPrompt = {
              duration: videoDuration,
            };
            if (config.style) scriptParsedPrompt.style = config.style;
            if (config.mood) scriptParsedPrompt.mood = config.mood;
            if (config.aspectRatio) scriptParsedPrompt.aspectRatio = config.aspectRatio;
            if (config.colorPalette) scriptParsedPrompt.colorPalette = config.colorPalette;
            if (config.pacing) scriptParsedPrompt.pacing = config.pacing;
          } else {
            // Fallback to normal parsing
            fastify.log.info({ projectId }, 'Step 1: Parsing prompt (script parsing failed, using normal parser)');
            const parsedPrompt = parsePrompt(projectData.prompt, videoDuration);
            if (config.style) parsedPrompt.style = config.style;
            if (config.mood) parsedPrompt.mood = config.mood;
            scriptParsedPrompt = parsedPrompt;
            
            fastify.log.info({ projectId, duration: videoDuration }, 'Step 2: Planning scenes');
            scenes = planScenes(projectData.prompt, parsedPrompt, videoDuration);
          }
        }
        
        // Script parsing complete - scenes already logged above
      } else {
        // Normal flow: parse prompt and plan scenes
      fastify.log.info({ projectId, promptLength: projectData.prompt?.length || 0 }, 'Step 1: Parsing prompt');
        const parsedPrompt = parsePrompt(projectData.prompt, videoDuration);
      if (config.style) parsedPrompt.style = config.style;
      if (config.mood) parsedPrompt.mood = config.mood;
        scriptParsedPrompt = parsedPrompt;
        
      fastify.log.info({ 
        projectId, 
        parsedStyle: parsedPrompt.style,
        parsedMood: parsedPrompt.mood,
        keywordsCount: parsedPrompt.keywords?.length || 0,
      }, 'Step 1: Prompt parsed successfully');

        fastify.log.info({ projectId, duration: videoDuration }, 'Step 2: Planning scenes');
        fastify.log.info({
          projectId,
          originalPrompt: projectData.prompt,
          originalPromptLength: projectData.prompt?.length || 0,
          originalPromptPreview: projectData.prompt?.substring(0, 500) + (projectData.prompt && projectData.prompt.length > 500 ? '...' : ''),
        }, 'Step 2: Original prompt before scene planning');
        scenes = planScenes(projectData.prompt, parsedPrompt, videoDuration);
      fastify.log.info({ 
        projectId, 
        sceneCount: scenes.length,
        originalPromptLength: projectData.prompt?.length || 0,
        totalScenePromptLength: scenes.reduce((sum, s) => sum + (s.prompt?.length || 0), 0),
        scenes: scenes.map(s => ({ 
          number: s.sceneNumber, 
          duration: s.duration, 
          promptLength: s.prompt?.length || 0,
          promptPreview: s.prompt?.substring(0, 200) + (s.prompt && s.prompt.length > 200 ? '...' : ''),
        })),
      }, 'Step 2: Scenes planned successfully - PROMPT LENGTH COMPARISON');
      }

      // 2.5. Generate reference images for Veo 3.1 based on script key details
      // reference_images is separate from 'image' (first frame) and 'last_frame' (last frame)
      // reference_images can contain multiple images (characters, artifacts, style references)
      let referenceImagesUrls: string[] = []; // Array of reference image URLs for Veo 3.1
      const selectedVideoModelId = config.videoModelId || 'google/veo-3.1';
      const isVeo31 = selectedVideoModelId === 'google/veo-3.1' || selectedVideoModelId === 'google/veo-3';
      
      if (isVeo31 && scriptParsedPrompt) {
        fastify.log.info({ projectId }, 'Step 2.5: Generating reference images for Veo 3.1 based on script key details');
        
        try {
          // Extract key details from script
          const keyElements = scriptParsedPrompt.keyElements || [];
          const style = scriptParsedPrompt.style || config.style || '';
          const mood = scriptParsedPrompt.mood || config.mood || '';
          const aspectRatio = scriptParsedPrompt.aspectRatio || config.aspectRatio || '16:9';
          
          // Build context for reference image generation
          // Use scriptText if available (contains full script with 10000+ chars), otherwise use projectData.prompt
          const overallPrompt = scriptText || projectData.prompt || '';
          
          // Use Nano Banana via Replicate to generate reference images
          const { generateImage } = await import('../services/replicate');
          
          // Create a comprehensive prompt for reference image generation
          // If we have scenes from script, use those; otherwise use overallPrompt
          const scriptSummary = scenes.length > 0 
            ? scenes.map(s => `Scene ${s.sceneNumber}: ${s.prompt?.substring(0, 200)}...`).join('\n')
            : overallPrompt.substring(0, 1000);
          
          // Generate multiple reference images:
          // 1. Overall style/mood reference image
          // 2. Individual images for key elements (characters, artifacts, etc.)
          
          // 1. Generate overall style reference image
          const styleReferencePrompt = `Create a reference image for video generation that captures the overall visual style and mood.

VIDEO SCRIPT CONTEXT:
${scriptSummary}

VISUAL STYLE: ${style || 'cinematic'}
MOOD/ATMOSPHERE: ${mood || 'professional'}
ASPECT RATIO: ${aspectRatio}

INSTRUCTIONS:
Generate a high-quality reference image that captures the overall visual aesthetic, color palette, lighting style, and mood that will be consistent across all ${scenes.length} scenes in this video. Focus on the visual style, composition, and atmosphere.`;
          
          fastify.log.info({
            projectId,
            keyElementsCount: keyElements.length,
            style,
            mood,
          }, 'Step 2.5: Generating style reference image with Nano Banana');
          
          const styleImageResult = await generateImage({
            prompt: styleReferencePrompt,
            imageModelId: 'google/nano-banana',
            aspectRatio: aspectRatio,
          });
          
          if (styleImageResult.status === 'succeeded' && styleImageResult.output) {
            const styleImageUrl = typeof styleImageResult.output === 'string' 
              ? styleImageResult.output 
              : (Array.isArray(styleImageResult.output) ? styleImageResult.output[0] : '');
            
            if (styleImageUrl) {
              const imageResponse = await fetch(styleImageUrl);
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
              
              const { uploadFile } = await import('../services/storage');
              const uploadResult = await uploadFile(
                imageBuffer,
                user.sub,
                'frame',
                'image/jpeg',
                projectId,
                'reference-style.jpg'
              );
              
              referenceImagesUrls.push(uploadResult.url);
              fastify.log.info({
                projectId,
                referenceImageUrl: uploadResult.url,
                type: 'style reference',
              }, 'Step 2.5: Style reference image generated and uploaded');
            }
          }
          
          // 2. Generate reference images for key elements (characters, artifacts, etc.)
          // Limit to top 5 key elements to avoid too many images
          const keyElementsToGenerate = keyElements.slice(0, 5);
          
          for (let i = 0; i < keyElementsToGenerate.length; i++) {
            const element = keyElementsToGenerate[i];
            
            const elementReferencePrompt = `Create a reference image for a key visual element in a video.

ELEMENT: ${element}

VIDEO CONTEXT:
${scriptSummary.substring(0, 500)}

VISUAL STYLE: ${style || 'cinematic'}
MOOD/ATMOSPHERE: ${mood || 'professional'}
ASPECT RATIO: ${aspectRatio}

INSTRUCTIONS:
Generate a high-quality reference image that shows the "${element}" element. This image will be used as a reference to ensure this element appears consistently across all scenes in the video. Focus on the visual appearance, details, and characteristics of this specific element.`;
            
            try {
              fastify.log.info({
                projectId,
                element,
                elementIndex: i + 1,
                totalElements: keyElementsToGenerate.length,
              }, `Step 2.5: Generating reference image for element: ${element}`);
              
              const elementImageResult = await generateImage({
                prompt: elementReferencePrompt,
                imageModelId: 'google/nano-banana',
                aspectRatio: aspectRatio,
              });
              
              if (elementImageResult.status === 'succeeded' && elementImageResult.output) {
                const elementImageUrl = typeof elementImageResult.output === 'string' 
                  ? elementImageResult.output 
                  : (Array.isArray(elementImageResult.output) ? elementImageResult.output[0] : '');
                
                if (elementImageUrl) {
                  const imageResponse = await fetch(elementImageUrl);
                  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                  
                  const { uploadFile } = await import('../services/storage');
                  const uploadResult = await uploadFile(
                    imageBuffer,
                    user.sub,
                    'frame',
                    'image/jpeg',
                    projectId,
                    `reference-element-${i + 1}-${element.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.jpg`
                  );
                  
                  referenceImagesUrls.push(uploadResult.url);
                  fastify.log.info({
                    projectId,
                    element,
                    referenceImageUrl: uploadResult.url,
                  }, `Step 2.5: Reference image for element "${element}" generated and uploaded`);
                }
              }
            } catch (elementError: any) {
              fastify.log.warn({
                projectId,
                element,
                error: elementError.message,
              }, `Step 2.5: Failed to generate reference image for element "${element}", continuing...`);
              // Continue with other elements
            }
          }
          
          fastify.log.info({
            projectId,
            totalReferenceImages: referenceImagesUrls.length,
            referenceImageUrls: referenceImagesUrls.map(url => url.substring(0, 100) + '...'),
          }, 'Step 2.5: Reference images generation completed - will be used in reference_images array for Veo 3.1');
          
        } catch (refImageError: any) {
          fastify.log.error({
            projectId,
            error: refImageError.message,
            stack: refImageError.stack,
          }, 'Step 2.5: Error generating reference images, continuing without reference images');
          // Continue without reference images - not critical
        }
      } else {
        fastify.log.info({
          projectId,
          isVeo31,
          hasScriptParsedPrompt: !!scriptParsedPrompt,
          selectedVideoModelId,
        }, 'Step 2.5: Skipping reference image generation (not Veo 3.1 or no script parsed prompt)');
      }

      // 3. Generate videos for each scene
      fastify.log.info({ projectId, totalScenes: scenes.length }, 'Step 3: Starting video generation for all scenes');
      
      // Clear arrays and reset reference frame in case of retry
      sceneVideos.length = 0;
      frameUrls.length = 0;
      previousSceneLastFrameUrl = undefined; // Reset - will be set from last frame of each scene

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneStartTime = Date.now();
        
        try {
          // Get the selected video model ID - use from config, fallback to default
          const selectedVideoModelId = config.videoModelId || 'google/veo-3.1';
          
          // Build video generation options
          const videoGenOptions: any = {
            prompt: scene.prompt,
            duration: scene.duration,
            videoModelId: selectedVideoModelId,
            aspectRatio: scriptParsedPrompt.aspectRatio || config.aspectRatio || '16:9',
            style: scriptParsedPrompt.style || config.style,
            mood: scriptParsedPrompt.mood || config.mood,
            colorPalette: scriptParsedPrompt.colorPalette || config.colorPalette,
            pacing: scriptParsedPrompt.pacing || config.pacing,
          };
          
          // Add reference_images array for Veo 3.1
          if (isVeo31 && referenceImagesUrls.length > 0) {
            videoGenOptions.referenceImages = referenceImagesUrls;
          }
          
          // Single consolidated log for scene generation
          fastify.log.info({
            projectId,
            sceneNumber: scene.sceneNumber,
            totalScenes: scenes.length,
            promptLength: scene.prompt?.length || 0,
            duration: scene.duration,
            model: selectedVideoModelId,
            hasReferenceFrame: !!previousSceneLastFrameUrl,
            hasReferenceImages: isVeo31 && referenceImagesUrls.length > 0,
          }, `Generating video for scene ${scene.sceneNumber}/${scenes.length}`);
          
          // Use last frame from previous scene as reference for smooth transitions
          // Only if useReferenceFrame is enabled (defaults to false - user must opt-in)
          // Handle both boolean true and string "true" values (JSON parsing can sometimes return strings)
          const useReferenceFrameValue = config.useReferenceFrame;
          const shouldUseReferenceFrame = useReferenceFrameValue === true || useReferenceFrameValue === 'true' || useReferenceFrameValue === 1;
          
          // Continuous mode: always pass last frame as image parameter (for seamless continuation)
          const continuousValue = config.continuous;
          const shouldUseContinuous = continuousValue === true || continuousValue === 'true' || continuousValue === 1;
          
          fastify.log.info({ 
            projectId,
            sceneNumber: scene.sceneNumber,
            useReferenceFrameValue,
            continuousValue,
            shouldUseReferenceFrame,
            shouldUseContinuous,
            hasPreviousFrame: !!previousSceneLastFrameUrl,
            isFirstScene: i === 0,
          }, `Step 3.${i + 1}: Reference frame check - useReferenceFrame=${useReferenceFrameValue}, continuous=${continuousValue}`);
          
          // Handle reference images for Veo 3.1
          // For first scene (i === 0): use generated reference image if available
          // For subsequent scenes (i > 0): use last frame from previous scene
          if (previousSceneLastFrameUrl && i > 0) {
            if (shouldUseContinuous) {
              // Continuous mode: always pass last frame as image parameter
              videoGenOptions.image = previousSceneLastFrameUrl;
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                referenceImageUrl: previousSceneLastFrameUrl,
                model: selectedVideoModelId,
              }, `Step 3.${i + 1}: Continuous mode enabled - using last frame from scene ${i} as image parameter for scene ${scene.sceneNumber}`);
            } else if (shouldUseReferenceFrame) {
              // For all models including Veo 3.1, use 'image' parameter for reference image
              // For first scene: use generated reference image (if available)
              // For subsequent scenes: use last frame from previous scene
              videoGenOptions.image = previousSceneLastFrameUrl;
              
              const referenceType = i === 0 
                ? 'generated reference image (from script key details)' 
                : `last frame from scene ${i}`;
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                referenceImageUrl: previousSceneLastFrameUrl,
                referenceType,
                model: selectedVideoModelId,
              }, `Step 3.${i + 1}: Using ${referenceType} as reference image for scene ${scene.sceneNumber}`);
            } else {
              // Explicitly ensure these are not set when both are false
              delete videoGenOptions.lastFrame;
              delete videoGenOptions.image;
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
              }, `Step 3.${i + 1}: Skipping reference frame (useReferenceFrame and continuous disabled) - not including in Replicate API call`);
            }
          } else {
            // Ensure these are not set when no reference image/frame exists
            delete videoGenOptions.image;
            delete videoGenOptions.lastFrame; // Keep for backward compatibility, but not used
          }
          
          // Generate video for scene with all params from script and dropdown
          const result = await generateVideo(videoGenOptions);

          const sceneGenDuration = Date.now() - sceneStartTime;
          fastify.log.info({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            duration: sceneGenDuration,
            status: result.status,
          }, `Step 3.${i + 1}: Video generation completed for scene ${scene.sceneNumber}`);

          if (result.status === 'failed') {
            fastify.log.error({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              error: result.error,
            }, `Step 3.${i + 1}: Scene ${scene.sceneNumber} generation failed`);
            throw new Error(`Scene ${scene.sceneNumber} generation failed: ${result.error}`);
          }

          // Handle different output formats
          // result.output can be a string URL, array of URLs, or object with URL
          // Note: Sometimes strings come back as String objects, so we need to handle both
          let videoUrl: string;
          
          // First, normalize the output - handle String objects vs primitive strings
          let normalizedOutput = result.output;
          if (normalizedOutput && typeof normalizedOutput === 'object' && normalizedOutput.constructor === String) {
            // It's a String object, convert to primitive
            normalizedOutput = String(normalizedOutput);
            fastify.log.info({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
            }, `Step 3.${i + 1}: Normalized String object to primitive string`);
          }
          
          if (typeof normalizedOutput === 'string') {
            // Direct string URL (most common case)
            videoUrl = normalizedOutput;
            fastify.log.info({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              outputType: 'string',
              urlLength: videoUrl.length,
              url: videoUrl,
            }, `Step 3.${i + 1}: Using string output as video URL`);
          } else if (Array.isArray(normalizedOutput)) {
            // Array of URLs - take the first one
            videoUrl = normalizedOutput[0];
            fastify.log.info({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              outputType: 'array',
              arrayLength: normalizedOutput.length,
              url: videoUrl,
            }, `Step 3.${i + 1}: Extracted video URL from array output`);
          } else if (normalizedOutput && typeof normalizedOutput === 'object') {
            // Object - try to extract URL from common properties
            // Also handle case where it's a String object that wasn't caught earlier
            if ((normalizedOutput as any) instanceof String || (normalizedOutput as any).constructor === String) {
              // It's a String object, convert to primitive string
              videoUrl = String(normalizedOutput);
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                outputType: 'String-object',
                url: videoUrl,
              }, `Step 3.${i + 1}: Converted String object to primitive string URL`);
            } else if ('url' in normalizedOutput && typeof (normalizedOutput as any).url === 'string') {
              videoUrl = (normalizedOutput as any).url;
            } else if ('videoUrl' in normalizedOutput && typeof (normalizedOutput as any).videoUrl === 'string') {
              videoUrl = (normalizedOutput as any).videoUrl;
            } else if ('output' in normalizedOutput && typeof (normalizedOutput as any).output === 'string') {
              videoUrl = (normalizedOutput as any).output;
            } else {
              // Try to stringify and see if it's actually a URL string
              const outputStr = String(normalizedOutput);
              if (outputStr.startsWith('http://') || outputStr.startsWith('https://')) {
                videoUrl = outputStr;
                fastify.log.info({ 
                  projectId, 
                  sceneNumber: scene.sceneNumber,
                  outputType: 'object-converted-to-string',
                  url: videoUrl,
                }, `Step 3.${i + 1}: Converted object to string URL`);
              } else {
                fastify.log.error({ 
                  projectId, 
                  sceneNumber: scene.sceneNumber,
                  outputType: typeof normalizedOutput,
                  normalizedOutput: normalizedOutput,
                  outputString: outputStr,
                  outputKeys: Object.keys(normalizedOutput),
                }, `Step 3.${i + 1}: Unexpected output format - object without recognizable URL`);
                throw new Error(`Unexpected output format from Replicate: object without URL property. Output: ${JSON.stringify(normalizedOutput).substring(0, 200)}`);
              }
            }
            if (videoUrl) {
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                outputType: 'object',
                url: videoUrl,
              }, `Step 3.${i + 1}: Extracted video URL from object output`);
            }
          } else {
            // Last resort: try to convert to string
            const outputStr = String(normalizedOutput || result.output);
            if (outputStr.startsWith('http://') || outputStr.startsWith('https://')) {
              videoUrl = outputStr;
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                outputType: typeof normalizedOutput,
                url: videoUrl,
              }, `Step 3.${i + 1}: Converted output to string URL as fallback`);
            } else {
              fastify.log.error({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
                outputType: typeof normalizedOutput,
                normalizedOutput: normalizedOutput,
                originalOutput: result.output,
                outputString: outputStr,
              }, `Step 3.${i + 1}: Unexpected output format`);
              throw new Error(`Unexpected output format from Replicate: ${typeof normalizedOutput}. Output: ${outputStr.substring(0, 200)}`);
            }
          }
          
          // Validate that we have a valid URL
          if (!videoUrl || (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://'))) {
            fastify.log.error({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              videoUrl,
            }, `Step 3.${i + 1}: Invalid video URL format`);
            throw new Error(`Invalid video URL format: ${videoUrl}`);
          }

          // Download scene video from Replicate and upload to S3
          fastify.log.info({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            replicateUrl: videoUrl,
          }, `Step 3.${i + 1}.0: Downloading scene video from Replicate and uploading to S3`);
          
          // Download and upload to S3 - MANDATORY, no fallback
          const videoResponse = await fetch(videoUrl);
          if (!videoResponse.ok) {
            throw new Error(`Failed to download video from Replicate: ${videoResponse.statusText}`);
          }
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          fastify.log.info({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            bufferSize: videoBuffer.length,
          }, `Step 3.${i + 1}.0: Video downloaded, uploading to S3`);
          
          const sceneVideoUpload = await uploadGeneratedVideo(
            videoBuffer,
            user.sub,
            projectId,
            `scene-${scene.sceneNumber}.mp4`
          );
          
          // Use S3 URL instead of Replicate URL
          videoUrl = sceneVideoUpload.url;
          fastify.log.info({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            s3Url: videoUrl,
          }, `Step 3.${i + 1}.0: Scene video uploaded to S3 successfully`);
          
          sceneVideos.push(videoUrl);

          // Store video ID/object/GCS URI for extension (Veo 3.1)
          sceneVideoIds.push({
            videoId: result.videoId,
            videoObject: result.videoObject,
            videoUrl: videoUrl,
            gcsUri: result.gcsUri, // Store GCS URI for Veo 3.1
          });
          
          // Determine asset_id based on model:
          // - For Sora: use videoId
          // - For Veo 3.1: use gcsUri
          // - For images: NULL (handled separately)
          let assetId: string | null = null;
          const isSora = selectedVideoModelId?.startsWith('openai/sora');
          const isVeo = selectedVideoModelId?.startsWith('google/veo');
          
          if (isSora && result.videoId) {
            assetId = result.videoId;
          } else if (isVeo && result.gcsUri) {
            assetId = result.gcsUri;
          }
          
          // Update previous scene video ID/object for next iteration
          previousSceneVideoId = result.videoId;
          previousSceneVideoObject = result.videoObject;
          
          fastify.log.info({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            videoId: result.videoId || 'N/A',
            gcsUri: result.gcsUri || 'N/A',
            assetId: assetId || 'N/A',
            model: selectedVideoModelId,
            hasVideoObject: !!result.videoObject,
            videoUrl: videoUrl,
          }, `Step 3.${i + 1}: Stored video ID/object/GCS URI for extension`);

          // Extract frames (non-blocking - if it fails, we still save the scene)
          let frames: { firstFrameUrl: string; lastFrameUrl: string } | null = null;
          fastify.log.info({ projectId, sceneNumber: scene.sceneNumber }, `Step 3.${i + 1}.1: Extracting frames from scene ${scene.sceneNumber}`);
          try {
            frames = await extractFrames(videoUrl, user.sub, projectId, scene.sceneNumber);
            fastify.log.info({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              firstFrameUrl: frames.firstFrameUrl,
              lastFrameUrl: frames.lastFrameUrl,
            }, `Step 3.${i + 1}.1: Frames extracted successfully`);
            frameUrls.push({ first: frames.firstFrameUrl, last: frames.lastFrameUrl });
            
            // Store last frame URL for next scene (use full S3 URL)
            previousSceneLastFrameUrl = frames.lastFrameUrl;
            fastify.log.info({ 
              projectId,
              sceneNumber: scene.sceneNumber,
              lastFrameUrl: previousSceneLastFrameUrl,
              willUseForNextScene: i < scenes.length - 1,
            }, `Step 3.${i + 1}.1: Stored last frame URL for next scene reference`);
          } catch (frameError: any) {
            fastify.log.warn({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              error: frameError.message,
            }, `Step 3.${i + 1}.1: Frame extraction failed, continuing without frames`);
            // Continue without frames - video URL is more important
          }

          // Store scene in database (ALWAYS save video URL, even if frame extraction failed)
          fastify.log.info({ projectId, sceneNumber: scene.sceneNumber }, `Step 3.${i + 1}.2: Storing scene ${scene.sceneNumber} in database`);
          await query(
            `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url, asset_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (project_id, scene_number) DO UPDATE
             SET prompt = $3, duration = $4, start_time = $5, video_url = $6, first_frame_url = $7, last_frame_url = $8, asset_id = $9, updated_at = NOW()`,
            [
              projectId,
              scene.sceneNumber,
              scene.prompt,
              scene.duration,
              scene.startTime,
              videoUrl, // Always save video URL - this is the critical data
              frames?.firstFrameUrl || null, // NULL if frame extraction failed
              frames?.lastFrameUrl || null, // NULL if frame extraction failed
              assetId, // Save asset_id (videoId for Sora, gcsUri for Veo 3.1)
            ]
          );
          fastify.log.info({ projectId, sceneNumber: scene.sceneNumber }, `Step 3.${i + 1}.2: Scene ${scene.sceneNumber} stored successfully`);
        } catch (sceneError: any) {
          fastify.log.error({ 
            projectId, 
            sceneNumber: scene.sceneNumber,
            error: sceneError.message,
            stack: sceneError.stack,
            scenePrompt: scene.prompt?.substring(0, 100),
          }, `Step 3.${i + 1}: ERROR in scene ${scene.sceneNumber} generation`);
          throw sceneError; // Re-throw to be caught by outer try-catch
        }
      }

      fastify.log.info({ projectId, sceneVideoCount: sceneVideos.length }, 'Step 4: Concatenating scene videos');
      
      if (sceneVideos.length === 0) {
        throw new Error('No scene videos to concatenate');
      }
      
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-final-'));
      const concatVideoPath = path.join(tempDir, 'concat.mp4');
      fastify.log.info({ projectId, tempDir, concatVideoPath }, 'Step 4: Created temporary directory');
      
      try {
        await concatenateVideos(sceneVideos, concatVideoPath);
        fastify.log.info({ projectId, concatVideoPath }, 'Step 4: Videos concatenated successfully');
        
        // Verify the concatenated file exists
        const concatFileExists = await fs.access(concatVideoPath).then(() => true).catch(() => false);
        if (!concatFileExists) {
          throw new Error(`Concatenated video file was not created at ${concatVideoPath}`);
        }
        const concatFileStats = await fs.stat(concatVideoPath);
        fastify.log.info({ projectId, fileSize: concatFileStats.size }, 'Step 4: Concatenated file verified');
      } catch (concatError: any) {
        fastify.log.error({ 
          projectId, 
          error: concatError.message,
          sceneVideoCount: sceneVideos.length,
          sceneVideos: sceneVideos.map((url, idx) => ({ index: idx, url: url }))
        }, 'Step 4: ERROR - Failed to concatenate videos');
        throw new Error(`Failed to concatenate videos: ${concatError.message}`);
      }

      // 5. Add audio if provided
      let finalVideoPath = concatVideoPath;
      if (config.audioUrl) {
        fastify.log.info({ projectId, audioUrl: config.audioUrl }, 'Step 5: Adding audio to video');
        const audioVideoPath = path.join(tempDir, 'final-with-audio.mp4');
        await addAudioToVideo(concatVideoPath, config.audioUrl, audioVideoPath);
        finalVideoPath = audioVideoPath;
        fastify.log.info({ projectId, finalVideoPath }, 'Step 5: Audio added successfully');
      } else {
        fastify.log.info({ projectId }, 'Step 5: No audio URL provided, skipping audio addition');
      }

      // 6. Upload final video
      fastify.log.info({ projectId, finalVideoPath }, 'Step 6: Uploading final video to S3');
      
      // Verify final video file exists before uploading
      const finalFileExists = await fs.access(finalVideoPath).then(() => true).catch(() => false);
      if (!finalFileExists) {
        throw new Error(`Final video file does not exist at ${finalVideoPath}`);
      }
      
      const finalVideoBuffer = await fs.readFile(finalVideoPath);
      fastify.log.info({ projectId, bufferSize: finalVideoBuffer.length }, 'Step 6: Video file read into buffer');
      
      if (finalVideoBuffer.length === 0) {
        throw new Error('Final video buffer is empty - file may be corrupted');
      }
      
      let uploadResult;
      try {
        uploadResult = await uploadGeneratedVideo(
          finalVideoBuffer,
          user.sub,
          projectId,
          'output.mp4'
        );
        fastify.log.info({ projectId, uploadUrl: uploadResult.url, uploadKey: uploadResult.key }, 'Step 6: Video uploaded successfully');
        
        if (!uploadResult.url) {
          throw new Error('Upload succeeded but no URL was returned');
        }
      } catch (uploadError: any) {
        fastify.log.error({ 
          projectId, 
          error: uploadError.message,
          bufferSize: finalVideoBuffer.length
        }, 'Step 6: ERROR - Failed to upload final video to S3');
        throw new Error(`Failed to upload final video: ${uploadError.message}`);
      }

      // 7. Update project with final video URL
      fastify.log.info({ projectId }, 'Step 7: Updating project with final video URL');
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
        finalVideoUrl: uploadResult.url, // Also save as finalVideoUrl for frontend compatibility
        sceneUrls: sceneVideos,
        sceneVideoIds: sceneVideoIds.map(item => ({
          videoId: item.videoId,
          videoUrl: item.videoUrl,
          gcsUri: item.gcsUri, // Store GCS URI for Veo 3.1
          // Note: videoObject is not stored in JSON (too large), only videoId, videoUrl, and gcsUri
        })),
        frameUrls,
      };

      const configJson = JSON.stringify(updatedConfig);
      
      // Update project with final video URL in both config and final_video_url column
      try {
        await query(
          `UPDATE projects 
           SET final_video_url = $1,
               status = 'completed',
               config = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [uploadResult.url, configJson, projectId]
        );
        fastify.log.info({ projectId, finalVideoUrl: uploadResult.url }, 'Step 7: Updated final_video_url column and status to completed');
      } catch (dbError: any) {
        // If final_video_url column doesn't exist, just update config and status
        if (dbError.message && dbError.message.includes('final_video_url')) {
          fastify.log.warn({ projectId, error: dbError.message }, 'Step 7: final_video_url column does not exist, updating config and status only');
          await query(
            'UPDATE projects SET status = $1, config = $2, updated_at = NOW() WHERE id = $3',
            ['completed', configJson, projectId]
          );
        } else {
          fastify.log.error({ projectId, error: dbError.message }, 'Step 7: Failed to update final_video_url column, updating config and status only');
          await query(
            'UPDATE projects SET status = $1, config = $2, updated_at = NOW() WHERE id = $3',
            ['completed', configJson, projectId]
          );
        }
      }
      
      // Verify the update was successful
      const verifyProject = await queryOne(
        'SELECT config FROM projects WHERE id = $1',
        [projectId]
      );
      
      if (!verifyProject || !verifyProject.config) {
        fastify.log.error({ projectId }, 'Step 7: WARNING - Config was not saved to database');
      } else {
        const savedConfig = typeof verifyProject.config === 'string' 
          ? JSON.parse(verifyProject.config) 
          : verifyProject.config;
        fastify.log.info({ 
          projectId, 
          configSaved: !!verifyProject.config,
          hasVideoUrl: !!savedConfig.videoUrl,
          hasFinalVideoUrl: !!savedConfig.finalVideoUrl,
          videoUrl: savedConfig.videoUrl || null,
          finalVideoUrl: savedConfig.finalVideoUrl || null,
          videoUrlLength: savedConfig.videoUrl ? savedConfig.videoUrl.length : 0,
        }, 'Step 7: Project updated successfully - VIDEO URL SAVED');
      }

      // Cleanup temp files
      fastify.log.info({ projectId, tempDir }, 'Step 8: Cleaning up temporary files');
      await fs.rm(tempDir, { recursive: true, force: true });
      fastify.log.info({ projectId }, 'Step 8: Temporary files cleaned up');

      const totalDuration = Date.now() - generationStartTime;
      fastify.log.info({ 
        projectId, 
        totalDuration,
        sceneCount: sceneVideos.length,
        finalVideoUrl: uploadResult.url,
      }, 'SUCCESS: Video generation completed successfully');

      return {
        status: 'completed',
        videoUrl: uploadResult.url,
        sceneUrls: sceneVideos,
        frameUrls,
      };
    } catch (error: any) {
      const totalDuration = Date.now() - generationStartTime;
      
      // Log detailed error information
      fastify.log.error({ 
        err: error,
        projectId,
        errorType: error?.constructor?.name || 'Unknown',
        errorMessage: error?.message || 'No error message',
        errorStack: error?.stack || 'No stack trace',
        totalDuration,
        scenesGenerated: sceneVideos.length,
        totalScenes: scenes.length,
      }, 'ERROR: Synchronous video generation failed');

      // Update project status to failed, and store partial results if any scenes were generated
      try {
        const currentConfig = typeof projectData.config === 'string' 
          ? JSON.parse(projectData.config) 
          : (projectData.config || {});
        
        // Store partial results if we have any successfully generated scenes
        if (sceneVideos.length > 0) {
          currentConfig.partialResults = {
            scenesGenerated: sceneVideos.length,
            totalScenes: scenes.length,
            sceneUrls: sceneVideos,
            frameUrls: frameUrls,
            error: error.message || 'Video generation failed',
            failedAtScene: sceneVideos.length + 1,
          };
          fastify.log.info({ 
            projectId, 
            scenesGenerated: sceneVideos.length,
            totalScenes: scenes.length,
          }, 'Storing partial results for failed generation');
        }
        
        // Update status to failed and save config with partial results
        await query(
          'UPDATE projects SET status = $1, config = $2, updated_at = NOW() WHERE id = $3',
          ['failed', JSON.stringify(currentConfig), projectId]
        );
        
        // Verify the update
        const verifyProject = await queryOne(
          'SELECT status, config FROM projects WHERE id = $1',
          [projectId]
        );
        
        if (verifyProject) {
          fastify.log.info({ 
            projectId, 
            status: verifyProject.status,
            hasPartialResults: !!(verifyProject.config && typeof verifyProject.config === 'object' ? verifyProject.config.partialResults : (typeof verifyProject.config === 'string' ? JSON.parse(verifyProject.config).partialResults : false)),
          }, 'Project status updated to "failed" with partial results');
        } else {
          fastify.log.error({ projectId }, 'WARNING: Could not verify project status update');
        }
      } catch (updateError: any) {
        fastify.log.error({ 
          err: updateError, 
          projectId,
          updateErrorStack: updateError?.stack,
        }, 'ERROR: Failed to update project status to "failed"');
      }

      return reply.code(500).send({
        error: 'Video generation failed',
        message: error.message || 'An error occurred during video generation',
        partialResults: sceneVideos.length > 0 ? {
          scenesGenerated: sceneVideos.length,
          totalScenes: scenes.length,
          sceneUrls: sceneVideos,
        } : undefined,
      });
    }
  });

  // Generate a single scene video
  fastify.post('/projects/:id/scenes/generate', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate a single scene video',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          sceneIndex: { type: 'number' },
          prompt: { type: 'string' },
          videoModelId: { type: 'string' },
          aspectRatio: { type: 'string' },
          style: { type: 'string' },
          mood: { type: 'string' },
          colorPalette: { type: 'string' },
          pacing: { type: 'string' },
          referenceImages: {
            type: 'array',
            items: { type: 'string' },
          },
          previousSceneLastFrame: { type: 'string' },
          previousSceneVideoUrl: { type: 'string' },
          useReferenceFrame: { type: 'boolean' },
          withAudio: { type: 'boolean' },
        },
      },
    },
  }, async (request: FastifyRequest<{ 
    Params: { id: string }; 
    Body: { 
      sceneIndex?: number;
      prompt: string;
      videoModelId?: string;
      aspectRatio?: string;
      style?: string;
      mood?: string;
      colorPalette?: string;
      pacing?: string;
      referenceImages?: string[];
      previousSceneLastFrame?: string;
      previousSceneVideoUrl?: string;
      useReferenceFrame?: boolean;
      continuous?: boolean;
      withAudio?: boolean;
    } 
  }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const requestBody = request.body;

    // Verify project belongs to user
    const { query } = await import('../services/database');
    const project = await query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!project || project.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    try {
      const { generateVideo } = await import('../services/replicate');
      const { extractFrames } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');
      const config = project[0].config || {};

      // Get video model ID (from request or config or default)
      const selectedVideoModelId = requestBody.videoModelId || config.videoModelId || 'google/veo-3.1';
      const isVeo31 = selectedVideoModelId.startsWith('google/veo-3.1');

      // Always use 16:9 aspect ratio for all models
      const aspectRatio = '16:9';
      
      // Calculate aspect ratio dimensions for non-Veo models
      let calculatedWidth: number | undefined;
      let calculatedHeight: number | undefined;
      
      if (!isVeo31) {
        const [width, height] = aspectRatio.split(':').map(Number);
        const aspectRatioMultiplier = 64; // Base multiplier for dimensions
        calculatedWidth = width * aspectRatioMultiplier;
        calculatedHeight = height * aspectRatioMultiplier;
      }

      // Build video generation options
      const videoGenOptions: any = {
        prompt: requestBody.prompt,
        duration: 8, // 8 seconds for single scene (Veo 3.1 supports 4, 6, or 8)
        videoModelId: selectedVideoModelId,
        aspectRatio: '16:9', // Always use 16:9
        style: requestBody.style || config.style,
        mood: requestBody.mood || config.mood,
        colorPalette: requestBody.colorPalette || config.colorPalette,
        pacing: requestBody.pacing || config.pacing,
        withAudio: requestBody.withAudio !== false, // Default to true, allow override
      };

      // Add dimensions for non-Veo models
      if (!isVeo31) {
        videoGenOptions.width = calculatedWidth;
        videoGenOptions.height = calculatedHeight;
      }

      // IMPORTANT: Veo 3.1 doesn't support both 'video' (extendPrevious) and 'reference_images' together
      // Check if we're extending previous video first
      const isExtendingPrevious = !!requestBody.previousSceneVideoUrl;
      
      // Add previous scene video URL if provided (for extending previous video)
      // When extendPrevious is checked, we always use the previous video URL regardless of useReferenceFrame setting
      fastify.log.info({
        projectId,
        sceneIndex: requestBody.sceneIndex,
        hasPreviousVideoUrl: !!requestBody.previousSceneVideoUrl,
        previousVideoUrl: requestBody.previousSceneVideoUrl || 'N/A',
        hasPreviousLastFrame: !!requestBody.previousSceneLastFrame,
        useReferenceFrame: requestBody.useReferenceFrame,
        hasReferenceImages: !!requestBody.referenceImages && requestBody.referenceImages.length > 0,
      }, 'Checking for previous scene video/frame for extension');
      
      if (requestBody.previousSceneVideoUrl) {
        // Always use video URL if provided (when extendPrevious is checked)
        videoGenOptions.video = requestBody.previousSceneVideoUrl;
        fastify.log.info({
          projectId,
          sceneIndex: requestBody.sceneIndex,
          previousVideoUrl: requestBody.previousSceneVideoUrl,
          model: selectedVideoModelId,
          videoGenOptionsVideo: videoGenOptions.video,
        }, 'Using previous scene video URL for extension - added to videoGenOptions.video');
        
        // Don't add reference_images when using video parameter (Veo 3.1 doesn't support both)
        if (requestBody.referenceImages && requestBody.referenceImages.length > 0) {
          fastify.log.warn({
            projectId,
            sceneIndex: requestBody.sceneIndex,
            referenceImagesCount: requestBody.referenceImages.length,
          }, 'Skipping reference_images because extendPrevious is true (Veo 3.1 doesn\'t support both video and reference_images)');
        }
      } else {
        // Only add reference images if NOT extending previous video
        // Veo 3.1 doesn't support both 'video' and 'reference_images' together
        if (requestBody.referenceImages && requestBody.referenceImages.length > 0) {
          videoGenOptions.referenceImages = requestBody.referenceImages;
          fastify.log.info({
            projectId,
            sceneIndex: requestBody.sceneIndex,
            referenceImagesCount: requestBody.referenceImages.length,
            referenceImages: requestBody.referenceImages,
            model: selectedVideoModelId,
          }, 'Using reference images for scene generation (extendPrevious is false)');
        }
        
        // Add image parameter for continuous/reference frame mode
        if (requestBody.previousSceneLastFrame && (requestBody.continuous || requestBody.useReferenceFrame)) {
          // Use last frame as image parameter if continuous is enabled OR useReferenceFrame is enabled
          videoGenOptions.image = requestBody.previousSceneLastFrame;
          const mode = requestBody.continuous ? 'continuous' : 'useReferenceFrame';
          fastify.log.info({
            projectId,
            sceneIndex: requestBody.sceneIndex,
            previousLastFrame: requestBody.previousSceneLastFrame.substring(0, 100) + '...',
            model: selectedVideoModelId,
            mode,
            hasImage: !!videoGenOptions.image,
          }, `Using previous scene last frame as image parameter (${mode} mode)`);
        } else if (requestBody.continuous && !requestBody.previousSceneLastFrame) {
          // Continuous mode enabled but no previous frame available yet (first scene or frame not extracted)
          fastify.log.warn({
            projectId,
            sceneIndex: requestBody.sceneIndex,
            continuous: requestBody.continuous,
            hasPreviousLastFrame: !!requestBody.previousSceneLastFrame,
          }, 'Continuous mode enabled but previous scene last frame not available - skipping image parameter');
        } else {
          fastify.log.info({
            projectId,
            sceneIndex: requestBody.sceneIndex,
            continuous: requestBody.continuous,
            useReferenceFrame: requestBody.useReferenceFrame,
            hasPreviousVideoUrl: !!requestBody.previousSceneVideoUrl,
            hasPreviousLastFrame: !!requestBody.previousSceneLastFrame,
            reason: !requestBody.previousSceneVideoUrl && !requestBody.previousSceneLastFrame ? 'no previous video/frame provided' : (!requestBody.previousSceneLastFrame && !requestBody.useReferenceFrame && !requestBody.continuous ? 'no video URL and both flags are false' : 'unknown'),
          }, 'Not using previous scene video/frame for extension');
        }
      }

      fastify.log.info({
        projectId,
        sceneIndex: requestBody.sceneIndex,
        promptLength: requestBody.prompt.length,
        model: selectedVideoModelId,
        hasReferenceImages: requestBody.referenceImages && requestBody.referenceImages.length > 0,
        referenceImagesCount: requestBody.referenceImages?.length || 0,
        hasPreviousVideo: !!requestBody.previousSceneVideoUrl && requestBody.useReferenceFrame,
        hasReferenceFrame: !!requestBody.previousSceneLastFrame && requestBody.useReferenceFrame,
        videoGenOptionsHasVideo: !!videoGenOptions.video,
        videoGenOptionsHasImage: !!videoGenOptions.image,
        videoGenOptionsVideo: videoGenOptions.video || 'N/A',
      }, 'Generating single scene video - calling Replicate API with videoGenOptions');

      // Generate video
      const generateStartTime = Date.now();
      const result = await generateVideo(videoGenOptions);
      const generateDuration = Date.now() - generateStartTime;
      
      fastify.log.info({
        projectId,
        sceneIndex: requestBody.sceneIndex,
        status: result.status,
        duration: generateDuration,
        hasOutput: !!result.output,
        outputType: typeof result.output,
      }, 'Replicate API call completed');

      if (result.status === 'failed') {
        return reply.code(500).send({ 
          error: 'Video generation failed',
          message: result.error 
        });
      }

      // Handle different output formats
      let videoUrl: string;
      if (Array.isArray(result.output)) {
        videoUrl = result.output[0];
      } else if (typeof result.output === 'string') {
        videoUrl = result.output;
      } else {
        throw new Error(`Unexpected output format from Replicate: ${typeof result.output}`);
      }

      // Download and upload to S3
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video from Replicate: ${videoResponse.statusText}`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      
      const sceneNumber = (requestBody.sceneIndex ?? 0) + 1;
      const sceneVideoUpload = await uploadGeneratedVideo(
        videoBuffer,
        user.sub,
        projectId,
        `scene-${sceneNumber}.mp4`
      );
      videoUrl = sceneVideoUpload.url;

      // Extract frames
      const frames = await extractFrames(videoUrl, user.sub, projectId, sceneNumber);

      // Save scene to database
      try {
        const { query } = await import('../services/database');
        const existingScene = await query(
          'SELECT id FROM scenes WHERE project_id = $1 AND scene_number = $2',
          [projectId, sceneNumber]
        );

        if (existingScene && existingScene.length > 0) {
          // Update existing scene
          const sceneDuration = 8; // Default duration for single scene
          const startTime = (sceneNumber - 1) * 8; // Calculate start time
          await query(
            `UPDATE scenes 
             SET prompt = $1, duration = $2, start_time = $3, video_url = $4, first_frame_url = $5, last_frame_url = $6, updated_at = NOW()
             WHERE project_id = $7 AND scene_number = $8`,
            [requestBody.prompt, sceneDuration, startTime, videoUrl, frames.firstFrameUrl, frames.lastFrameUrl, projectId, sceneNumber]
          );
          fastify.log.info({ 
            projectId, 
            sceneNumber, 
            sceneIndex: requestBody.sceneIndex,
            videoUrl: videoUrl,
            hasFirstFrame: !!frames.firstFrameUrl,
            hasLastFrame: !!frames.lastFrameUrl,
          }, 'Updated existing scene in database');
        } else {
          // Insert new scene
          const startTime = (sceneNumber - 1) * 8; // 8 seconds per scene
          await query(
            `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [projectId, sceneNumber, requestBody.prompt, 8, startTime, videoUrl, frames.firstFrameUrl, frames.lastFrameUrl]
          );
          fastify.log.info({ 
            projectId, 
            sceneNumber,
            sceneIndex: requestBody.sceneIndex,
            videoUrl: videoUrl,
            hasFirstFrame: !!frames.firstFrameUrl,
            hasLastFrame: !!frames.lastFrameUrl,
          }, 'Inserted new scene into database');
        }
      } catch (dbError: any) {
        fastify.log.error({ 
          projectId, 
          sceneNumber, 
          error: dbError.message,
          stack: dbError.stack,
        }, 'Failed to save scene to database');
        // Don't fail the request, but log the error
      }

      fastify.log.info({
        projectId,
        sceneIndex: requestBody.sceneIndex,
        videoUrl,
        firstFrameUrl: frames.firstFrameUrl,
        lastFrameUrl: frames.lastFrameUrl,
      }, 'Single scene generated successfully');

      return {
        videoUrl,
        firstFrameUrl: frames.firstFrameUrl,
        lastFrameUrl: frames.lastFrameUrl,
      };
    } catch (error: any) {
      fastify.log.error({ projectId, error: error.message }, 'Failed to generate single scene');
      return reply.code(500).send({ 
        error: 'Scene generation failed',
        message: error.message 
      });
    }
  });

  // Generate all scenes and stitch into final video
  fastify.post('/projects/:id/scenes/generate-all', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate all scenes sequentially or in parallel, then stitch into final video',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sceneIndex: { type: 'number' },
                prompt: { type: 'string' },
                selectedAssetIds: { type: 'array', items: { type: 'string' } },
                extendPrevious: { type: 'boolean' },
              },
            },
          },
          parallel: { type: 'boolean' },
          continuous: { type: 'boolean' },
          useReferenceFrame: { type: 'boolean' },
          videoModelId: { type: 'string' },
          aspectRatio: { type: 'string' },
          style: { type: 'string' },
          mood: { type: 'string' },
          colorPalette: { type: 'string' },
          pacing: { type: 'string' },
          referenceImages: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request: FastifyRequest<{ 
    Params: { id: string }; 
    Body: { 
      scenes: Array<{ sceneIndex: number; prompt: string; selectedAssetIds: string[]; extendPrevious: boolean }>;
      parallel: boolean;
      continuous: boolean;
      useReferenceFrame: boolean;
      videoModelId?: string;
      aspectRatio?: string;
      style?: string;
      mood?: string;
      colorPalette?: string;
      pacing?: string;
          referenceImages?: string[];
          assetIdToUrlMap?: Record<string, string>;
        } 
      }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const requestBody = request.body;

    try {
      // Verify project belongs to user
      const project = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      const config = typeof project.config === 'string' 
        ? JSON.parse(project.config) 
        : (project.config || {});

      const { generateVideo } = await import('../services/replicate');
      const { extractFrames } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');
      const { concatenateVideos } = await import('../services/videoProcessor');
      const { query: queryDb } = await import('../services/database');

      const selectedVideoModelId = requestBody.videoModelId || config.videoModelId || 'google/veo-3.1';
      const isVeo31 = selectedVideoModelId.startsWith('google/veo-3.1');
      const aspectRatio = '16:9';

      // Generate all scenes
      const sceneResults: Array<{ videoUrl: string; firstFrameUrl?: string; lastFrameUrl?: string }> = [];
      let previousSceneLastFrameUrl: string | undefined = undefined;

      if (requestBody.parallel) {
        // Parallel generation - all at once
        fastify.log.info({ projectId, sceneCount: requestBody.scenes.length }, 'Generating all scenes in parallel');
        
        const generationPromises = requestBody.scenes.map(async (sceneData, i) => {
          const sceneIndex = sceneData.sceneIndex; // Now 1-based (1, 2, 3, 4, 5)
          const sceneNumber = sceneIndex; // sceneIndex IS the scene_number now (1-based)
          const previousScene = i > 0 ? requestBody.scenes[i - 1] : null;
          
          // Get previous scene's last frame if continuous is enabled
          let previousLastFrame: string | undefined = undefined;
          if (i > 0 && requestBody.continuous && previousSceneLastFrameUrl) {
            previousLastFrame = previousSceneLastFrameUrl;
          }

          // Build video generation options
          const videoGenOptions: any = {
            prompt: sceneData.prompt,
            duration: 8,
            videoModelId: selectedVideoModelId,
            aspectRatio,
            style: requestBody.style || config.style,
            mood: requestBody.mood || config.mood,
            colorPalette: requestBody.colorPalette || config.colorPalette,
            pacing: requestBody.pacing || config.pacing,
            withAudio: true,
          };

          // IMPORTANT: Veo 3.1 doesn't support both 'video' (extendPrevious) and 'reference_images' together
          // If extendPrevious is true, we can't use reference_images
          // Note: In parallel mode, extendPrevious won't work because we don't have previous videos yet
          // But we still need to check to avoid sending conflicting parameters
          if (sceneData.extendPrevious && i > 0) {
            // extendPrevious requires previous video URL, which we don't have in parallel mode
            // Log warning and skip extendPrevious in parallel mode
            fastify.log.warn({
              projectId,
              sceneIndex,
              extendPrevious: sceneData.extendPrevious,
              mode: 'parallel',
            }, 'extendPrevious is not supported in parallel mode - skipping video parameter');
          }

          // Only add reference_images if extendPrevious is NOT true
          // Veo 3.1 doesn't support video + reference_images together
          // Filter reference images based on this scene's selectedAssetIds
          if (!sceneData.extendPrevious && sceneData.selectedAssetIds && sceneData.selectedAssetIds.length > 0 && requestBody.assetIdToUrlMap) {
            // Map selected asset IDs to URLs for this specific scene
            const sceneReferenceImages = sceneData.selectedAssetIds
              .map(assetId => requestBody.assetIdToUrlMap[assetId])
              .filter(url => url !== undefined) as string[];
            
            if (sceneReferenceImages.length > 0) {
              videoGenOptions.referenceImages = sceneReferenceImages;
              fastify.log.info({
                projectId,
                sceneIndex,
                selectedAssetIds: sceneData.selectedAssetIds,
                referenceImagesCount: sceneReferenceImages.length,
                referenceImageUrls: sceneReferenceImages.map(url => url.substring(0, 100) + '...'),
              }, 'Adding reference_images for scene based on selectedAssetIds (extendPrevious is false)');
            }
          } else if (sceneData.extendPrevious && sceneData.selectedAssetIds && sceneData.selectedAssetIds.length > 0) {
            fastify.log.warn({
              projectId,
              sceneIndex,
              extendPrevious: sceneData.extendPrevious,
              selectedAssetIds: sceneData.selectedAssetIds,
              selectedAssetIdsCount: sceneData.selectedAssetIds.length,
            }, 'Skipping reference_images because extendPrevious is true (Veo 3.1 doesn\'t support both)');
          }

          // Add image parameter for continuous mode (only if not using extendPrevious)
          if (!sceneData.extendPrevious && previousLastFrame && (requestBody.continuous || requestBody.useReferenceFrame)) {
            videoGenOptions.image = previousLastFrame;
            fastify.log.info({
              projectId,
              sceneIndex,
              hasImage: true,
              mode: requestBody.continuous ? 'continuous' : 'useReferenceFrame',
            }, 'Adding image parameter for continuous/reference frame mode');
          }

          const result = await generateVideo(videoGenOptions);
          if (result.status === 'failed') {
            throw new Error(`Scene ${sceneNumber} generation failed: ${result.error}`);
          }

          let videoUrl: string;
          if (Array.isArray(result.output)) {
            videoUrl = result.output[0];
          } else if (typeof result.output === 'string') {
            videoUrl = result.output;
          } else {
            throw new Error(`Unexpected output format from Replicate: ${typeof result.output}`);
          }

          // Download and upload to S3
          const videoResponse = await fetch(videoUrl);
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          const uploadResult = await uploadGeneratedVideo(
            videoBuffer,
            user.sub,
            projectId,
            `scene-${sceneNumber}.mp4`
          );

          // Extract frames (non-blocking)
          let frames: { firstFrameUrl?: string; lastFrameUrl?: string } = {};
          try {
            const frameResult = await extractFrames(uploadResult.url, user.sub, projectId, sceneNumber);
            frames = frameResult;
            previousSceneLastFrameUrl = frameResult.lastFrameUrl;
          } catch (frameError: any) {
            fastify.log.warn({ projectId, sceneIndex, sceneNumber, error: frameError.message }, 'Frame extraction failed, continuing');
          }

          // Save to database - update existing scene or insert new one
          try {
            // Check if scene exists first
            const existingScene = await queryDb(
              'SELECT video_url, first_frame_url, last_frame_url FROM scenes WHERE project_id = $1 AND scene_number = $2',
              [projectId, sceneNumber]
            );
            
            if (existingScene && existingScene.length > 0) {
              // Update existing scene - replacing old video with new one
              const sceneDuration = 8; // Default duration for scenes
              const startTime = (sceneNumber - 1) * 8; // Calculate start time (scene 1 = 0s, scene 2 = 8s, etc.)
              await queryDb(
                `UPDATE scenes 
                 SET prompt = $1, duration = $2, start_time = $3, video_url = $4, first_frame_url = $5, last_frame_url = $6, updated_at = NOW()
                 WHERE project_id = $7 AND scene_number = $8`,
                [sceneData.prompt, sceneDuration, startTime, uploadResult.url, frames.firstFrameUrl || null, frames.lastFrameUrl || null, projectId, sceneNumber]
              );
              fastify.log.info({ 
                projectId, 
                sceneIndex, 
                sceneNumber,
                oldVideoUrl: existingScene[0].video_url || 'none',
                newVideoUrl: uploadResult.url
              }, 'Updated existing scene with new video (parallel mode)');
            } else {
              // Insert new scene
              const sceneDuration = 8; // Default duration for scenes
              const startTime = (sceneNumber - 1) * 8; // Calculate start time (scene 1 = 0s, scene 2 = 8s, etc.)
              await queryDb(
                `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
                [projectId, sceneNumber, sceneData.prompt, sceneDuration, startTime, uploadResult.url, frames.firstFrameUrl || null, frames.lastFrameUrl || null]
              );
              fastify.log.info({ 
                projectId, 
                sceneIndex, 
                sceneNumber
              }, 'Inserted new scene (parallel mode)');
            }
          } catch (dbError: any) {
            fastify.log.error({ projectId, sceneIndex, error: dbError.message }, 'Failed to save scene to database');
          }

          return {
            videoUrl: uploadResult.url,
            firstFrameUrl: frames.firstFrameUrl,
            lastFrameUrl: frames.lastFrameUrl,
          };
        });

        // Use allSettled to handle partial failures - don't lose successful scenes if one fails
        const results = await Promise.allSettled(generationPromises);
        
        // Process results - keep successful ones, log failures
        const successfulScenes: Array<{ videoUrl: string; firstFrameUrl?: string; lastFrameUrl?: string }> = [];
        const failedScenes: Array<{ sceneIndex: number; sceneNumber: number; error: string }> = [];
        
        results.forEach((result, index) => {
          const sceneData = requestBody.scenes[index];
          const sceneIndex = sceneData?.sceneIndex ?? (index + 1); // Default to 1-based if missing
          const sceneNumber = sceneIndex; // sceneIndex is now 1-based, so it IS the scene_number
          
          if (result.status === 'fulfilled') {
            successfulScenes.push(result.value);
            sceneResults.push(result.value);
            fastify.log.info({ 
              projectId, 
              sceneIndex,
              sceneNumber,
              hasVideoUrl: !!result.value.videoUrl
            }, `Scene ${sceneNumber} generation succeeded in parallel mode`);
          } else {
            const errorMessage = result.reason?.message || 'Unknown error';
            failedScenes.push({ sceneIndex, sceneNumber, error: errorMessage });
            fastify.log.error({ 
              projectId, 
              sceneIndex,
              sceneNumber,
              error: errorMessage,
              reason: result.reason,
              stack: result.reason?.stack
            }, `Scene ${sceneNumber} generation failed in parallel mode - scene will be missing from database`);
          }
        });
        
        // Log summary with scene numbers
        const successfulSceneNumbers = results
          .map((result, index) => result.status === 'fulfilled' ? requestBody.scenes[index]?.sceneIndex : null)
          .filter((num): num is number => num !== null);
        const failedSceneNumbers = failedScenes.map(f => f.sceneNumber);
        
        fastify.log.info({ 
          projectId, 
          successful: successfulScenes.length,
          failed: failedScenes.length,
          total: requestBody.scenes.length,
          successfulSceneNumbers,
          failedSceneNumbers
        }, `Parallel generation completed: ${successfulScenes.length} succeeded (scenes: ${successfulSceneNumbers.join(', ')}), ${failedScenes.length} failed (scenes: ${failedSceneNumbers.join(', ')})`);
        
        // If all scenes failed, throw error
        if (successfulScenes.length === 0) {
          throw new Error(`All ${requestBody.scenes.length} scene(s) generation failed. Errors: ${failedScenes.map(f => `Scene ${f.sceneNumber}: ${f.error}`).join('; ')}`);
        }
        
        // If some scenes failed, log warning but continue
        if (failedScenes.length > 0) {
          fastify.log.warn({ 
            projectId,
            failedScenes: failedScenes.map(f => ({ sceneNumber: f.sceneNumber, sceneIndex: f.sceneIndex, error: f.error }))
          }, `${failedScenes.length} scene(s) failed (scenes: ${failedSceneNumbers.join(', ')}), but ${successfulScenes.length} succeeded (scenes: ${successfulSceneNumbers.join(', ')})`);
        }
      } else {
        // Sequential generation - one after another
        fastify.log.info({ projectId, sceneCount: requestBody.scenes.length }, 'Generating all scenes sequentially');
        
        for (let i = 0; i < requestBody.scenes.length; i++) {
          const sceneData = requestBody.scenes[i];
          const sceneIndex = sceneData.sceneIndex; // Now 1-based (1, 2, 3, 4, 5)
          const sceneNumber = sceneIndex; // sceneIndex IS the scene_number now (1-based)

          // Get previous scene's last frame if continuous is enabled
          let previousLastFrame: string | undefined = undefined;
          if (i > 0 && requestBody.continuous && previousSceneLastFrameUrl) {
            previousLastFrame = previousSceneLastFrameUrl;
          }

          // Build video generation options
          const videoGenOptions: any = {
            prompt: sceneData.prompt,
            duration: 8,
            videoModelId: selectedVideoModelId,
            aspectRatio,
            style: requestBody.style || config.style,
            mood: requestBody.mood || config.mood,
            colorPalette: requestBody.colorPalette || config.colorPalette,
            pacing: requestBody.pacing || config.pacing,
            withAudio: true,
          };

          // IMPORTANT: Veo 3.1 doesn't support both 'video' (extendPrevious) and 'reference_images' together
          // Check if this scene wants to extend previous video
          if (sceneData.extendPrevious && i > 0) {
            // Get previous scene's video URL from already generated scenes
            const previousSceneResult = sceneResults[i - 1];
            if (previousSceneResult && previousSceneResult.videoUrl) {
              videoGenOptions.video = previousSceneResult.videoUrl;
              fastify.log.info({
                projectId,
                sceneIndex,
                previousVideoUrl: previousSceneResult.videoUrl,
              }, 'Using previous scene video for extendPrevious (sequential mode)');
              
              // Don't add reference_images when using video parameter
              fastify.log.info({
                projectId,
                sceneIndex,
                extendPrevious: true,
                referenceImagesCount: requestBody.referenceImages?.length || 0,
              }, 'Skipping reference_images because extendPrevious is true (Veo 3.1 doesn\'t support both)');
            } else {
              fastify.log.warn({
                projectId,
                sceneIndex,
                extendPrevious: sceneData.extendPrevious,
                hasPreviousVideo: !!previousSceneResult?.videoUrl,
              }, 'extendPrevious requested but previous scene video not available yet');
            }
          } else {
            // Only add reference_images if extendPrevious is NOT true
            // Filter reference images based on this scene's selectedAssetIds
            if (!sceneData.extendPrevious && sceneData.selectedAssetIds && sceneData.selectedAssetIds.length > 0 && requestBody.assetIdToUrlMap) {
              // Map selected asset IDs to URLs for this specific scene
              const sceneReferenceImages = sceneData.selectedAssetIds
                .map(assetId => requestBody.assetIdToUrlMap[assetId])
                .filter(url => url !== undefined) as string[];
              
              if (sceneReferenceImages.length > 0) {
                videoGenOptions.referenceImages = sceneReferenceImages;
                fastify.log.info({
                  projectId,
                  sceneIndex,
                  selectedAssetIds: sceneData.selectedAssetIds,
                  referenceImagesCount: sceneReferenceImages.length,
                  referenceImageUrls: sceneReferenceImages.map(url => url.substring(0, 100) + '...'),
                }, 'Adding reference_images for scene based on selectedAssetIds (extendPrevious is false, sequential mode)');
              }
            } else if (sceneData.extendPrevious && sceneData.selectedAssetIds && sceneData.selectedAssetIds.length > 0) {
              fastify.log.warn({
                projectId,
                sceneIndex,
                extendPrevious: sceneData.extendPrevious,
                selectedAssetIds: sceneData.selectedAssetIds,
                selectedAssetIdsCount: sceneData.selectedAssetIds.length,
              }, 'Skipping reference_images because extendPrevious is true (Veo 3.1 doesn\'t support both, sequential mode)');
            }

            // Add image parameter for continuous mode
            if (previousLastFrame && (requestBody.continuous || requestBody.useReferenceFrame)) {
              videoGenOptions.image = previousLastFrame;
              fastify.log.info({
                projectId,
                sceneIndex,
                hasImage: true,
                mode: requestBody.continuous ? 'continuous' : 'useReferenceFrame',
              }, 'Adding image parameter for continuous/reference frame mode');
            }
          }

          try {
            const result = await generateVideo(videoGenOptions);
            if (result.status === 'failed') {
              throw new Error(`Scene ${sceneNumber} generation failed: ${result.error}`);
            }

            let videoUrl: string;
            if (Array.isArray(result.output)) {
              videoUrl = result.output[0];
            } else if (typeof result.output === 'string') {
              videoUrl = result.output;
            } else {
              throw new Error(`Unexpected output format from Replicate: ${typeof result.output}`);
            }

            // Download and upload to S3
            const videoResponse = await fetch(videoUrl);
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
            const uploadResult = await uploadGeneratedVideo(
              videoBuffer,
              user.sub,
              projectId,
              `scene-${sceneNumber}.mp4`
            );

            // Extract frames (non-blocking)
            let frames: { firstFrameUrl?: string; lastFrameUrl?: string } = {};
            try {
              const frameResult = await extractFrames(uploadResult.url, user.sub, projectId, sceneNumber);
              frames = frameResult;
              previousSceneLastFrameUrl = frameResult.lastFrameUrl;
            } catch (frameError: any) {
              fastify.log.warn({ projectId, sceneIndex, sceneNumber, error: frameError.message }, 'Frame extraction failed, continuing');
            }

            // Save to database - update existing scene or insert new one
            // IMPORTANT: Save even if frame extraction failed - video is the critical data
            try {
              // Check if scene exists first
              const existingScene = await queryDb(
                'SELECT video_url, first_frame_url, last_frame_url FROM scenes WHERE project_id = $1 AND scene_number = $2',
                [projectId, sceneNumber]
              );
              
              if (existingScene && existingScene.length > 0) {
                // Update existing scene - replacing old video with new one
                const sceneDuration = 8; // Default duration for scenes
                const startTime = (sceneNumber - 1) * 8; // Calculate start time (scene 1 = 0s, scene 2 = 8s, etc.)
                await queryDb(
                  `UPDATE scenes 
                   SET prompt = $1, duration = $2, start_time = $3, video_url = $4, first_frame_url = $5, last_frame_url = $6, updated_at = NOW()
                   WHERE project_id = $7 AND scene_number = $8`,
                  [sceneData.prompt, sceneDuration, startTime, uploadResult.url, frames.firstFrameUrl || null, frames.lastFrameUrl || null, projectId, sceneNumber]
                );
                fastify.log.info({ 
                  projectId, 
                  sceneIndex, 
                  sceneNumber,
                  oldVideoUrl: existingScene[0].video_url || 'none',
                  newVideoUrl: uploadResult.url
                }, 'Updated existing scene with new video (sequential mode)');
              } else {
                // Insert new scene
                const sceneDuration = 8; // Default duration for scenes
                const startTime = (sceneNumber - 1) * 8; // Calculate start time (scene 1 = 0s, scene 2 = 8s, etc.)
                await queryDb(
                  `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
                  [projectId, sceneNumber, sceneData.prompt, sceneDuration, startTime, uploadResult.url, frames.firstFrameUrl || null, frames.lastFrameUrl || null]
                );
                fastify.log.info({ 
                  projectId, 
                  sceneIndex, 
                  sceneNumber
                }, 'Inserted new scene (sequential mode)');
              }
            } catch (dbError: any) {
              fastify.log.error({ projectId, sceneIndex, sceneNumber, error: dbError.message }, 'Failed to save scene to database');
              // Don't throw - video is already uploaded to S3, we can retry DB save later
            }

            const sceneResult = {
              videoUrl: uploadResult.url,
              firstFrameUrl: frames.firstFrameUrl,
              lastFrameUrl: frames.lastFrameUrl,
            };
            
            sceneResults.push(sceneResult);
          } catch (sceneError: any) {
            // Log error but continue with other scenes - don't lose successful ones
            fastify.log.error({ 
              projectId, 
              sceneIndex,
              sceneNumber,
              error: sceneError.message,
              stack: sceneError.stack
            }, `Scene ${sceneNumber} generation failed (sequential mode) - continuing with remaining scenes`);
            
            // Continue to next scene instead of throwing
            // The error will be reported in the final response
          }
        }
      }

      // Stitch all videos together
      let finalVideoUrl: string | null = null;
      
      if (sceneResults.length > 0 && sceneResults.every(r => r.videoUrl)) {
        try {
          const sceneVideoUrls = sceneResults.map(r => r.videoUrl).filter(url => url) as string[];
          
          if (sceneVideoUrls.length > 0) {
            fastify.log.info({ projectId, sceneCount: sceneVideoUrls.length }, 'Stitching all scene videos together');
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-stitch-'));
            const concatVideoPath = path.join(tempDir, 'concat.mp4');

            await concatenateVideos(sceneVideoUrls, concatVideoPath);
            fastify.log.info({ projectId }, 'Videos concatenated successfully');

            // Upload final video
            const finalVideoBuffer = await fs.readFile(concatVideoPath);
            const uploadResult = await uploadGeneratedVideo(
              finalVideoBuffer,
              user.sub,
              projectId,
              'final.mp4'
            );
            finalVideoUrl = uploadResult.url;

            // Cleanup temp directory
            await fs.rm(tempDir, { recursive: true, force: true });
            fastify.log.info({ projectId, finalVideoUrl: finalVideoUrl }, 'Final stitched video uploaded successfully');
          } else {
            fastify.log.warn({ projectId }, 'No valid scene video URLs to stitch');
          }
        } catch (stitchError: any) {
          fastify.log.error({ projectId, error: stitchError.message, stack: stitchError.stack }, 'Failed to stitch videos, but scenes were generated successfully');
          // Don't fail the entire request - scenes were generated, stitching just failed
        }
      } else {
        fastify.log.warn({ projectId, sceneResultsCount: sceneResults.length }, 'No scene results to stitch');
      }

      // Save final video URL to database and config, and mark project as completed (if stitching succeeded)
      if (finalVideoUrl) {
        const { query } = await import('../services/database');
        
        // Update project config with final video URL
        const currentConfig = typeof project.config === 'string' 
          ? JSON.parse(project.config) 
          : (project.config || {});
        currentConfig.finalVideoUrl = finalVideoUrl;
        currentConfig.videoUrl = finalVideoUrl; // Also save as videoUrl for compatibility
        
        // Try to update final_video_url column and mark as completed
        try {
          await query(
            `UPDATE projects 
             SET final_video_url = $1, 
                 status = 'completed',
                 config = $2, 
                 updated_at = NOW() 
             WHERE id = $3`,
            [finalVideoUrl, JSON.stringify(currentConfig), projectId]
          );
        } catch (dbError: any) {
          // If final_video_url column doesn't exist, just update config and status
          if (dbError.message && dbError.message.includes('final_video_url')) {
            fastify.log.warn({ projectId, error: dbError.message }, 'final_video_url column does not exist, updating config and status only');
            await query(
              `UPDATE projects 
               SET status = 'completed',
                   config = $1, 
                   updated_at = NOW() 
               WHERE id = $2`,
              [JSON.stringify(currentConfig), projectId]
            );
          } else {
            fastify.log.error({ projectId, error: dbError.message }, 'Failed to save final video URL to database');
            // Don't throw - scenes were generated successfully, but try to mark as completed anyway
            try {
              await query(
                `UPDATE projects 
                 SET status = 'completed',
                     updated_at = NOW() 
                 WHERE id = $1`,
                [projectId]
              );
            } catch (statusError: any) {
              fastify.log.error({ projectId, error: statusError.message }, 'Failed to mark project as completed');
            }
          }
        }

        fastify.log.info({ 
          projectId, 
          finalVideoUrl: finalVideoUrl,
          status: 'completed'
        }, 'Final video generated, uploaded to S3, saved to database, and project marked as completed');
      }

      return {
        finalVideoUrl: finalVideoUrl || null,
        sceneUrls: sceneResults.map(r => r.videoUrl),
        frameUrls: sceneResults.map(r => ({ first: r.firstFrameUrl || '', last: r.lastFrameUrl || '' })),
      };
    } catch (error: any) {
      fastify.log.error({ projectId, error: error.message }, 'Failed to generate all scenes');
      return reply.code(500).send({ 
        error: 'Generate all scenes failed',
        message: error.message 
      });
    }
  });


  // Add audio to final video
  fastify.post('/projects/:id/add-audio', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Add audio track to final video',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['audioUrl'],
        properties: {
          audioUrl: { type: 'string' },
          volume: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { audioUrl: string; volume?: number } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const { audioUrl, volume = 0.5 } = request.body;

    try {
      // Verify project belongs to user
      const projectData = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!projectData) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Parse existing config
      let config: any = {};
      if (projectData.config) {
        try {
          config = typeof projectData.config === 'string' 
            ? JSON.parse(projectData.config) 
            : (projectData.config || {});
        } catch (parseError) {
          fastify.log.warn({ projectId, error: parseError }, 'Failed to parse project config JSON');
          config = {};
        }
      }

      if (!config.videoUrl) {
        return reply.code(400).send({ error: 'No final video found. Please stitch scenes first.' });
      }

      fastify.log.info({ projectId, audioUrl, hasVideoUrl: !!config.videoUrl }, 'Adding audio to video');

      // Import video processing functions
      const { addAudioToVideo } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');
      const { convertS3UrlToPresigned } = await import('../services/storage');

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-audio-'));
      const videoPath = path.join(tempDir, 'input.mp4');
      const outputPath = path.join(tempDir, 'output-with-audio.mp4');

      // Get presigned URL for video download (if it's an S3 URL)
      const videoUrlToDownload = await convertS3UrlToPresigned(config.videoUrl, 3600) || config.videoUrl;
      
      // Download current video
      fastify.log.info({ projectId, videoUrl: videoUrlToDownload }, 'Downloading video for audio merge');
      const videoResponse = await fetch(videoUrlToDownload);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`);
      }
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(videoPath, videoBuffer);

      // Add audio with volume control
      const { addAudioToVideoWithVolume } = await import('../services/videoProcessor');
      await addAudioToVideoWithVolume(videoPath, audioUrl, volume, outputPath);
      fastify.log.info({ projectId, volume }, 'Audio added successfully');

      // Upload new video
      const finalVideoBuffer = await fs.readFile(outputPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        user.sub,
        projectId,
        'output-with-audio.mp4'
      );
      fastify.log.info({ projectId, uploadUrl: uploadResult.url }, 'Video with audio uploaded successfully');

      // Update project config - when audio is added, this becomes the final video
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
        finalVideoUrl: uploadResult.url, // Save as finalVideoUrl since it has audio merged
        audioUrl: audioUrl,
      };

      await query(
        'UPDATE projects SET config = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(updatedConfig), projectId]
      );

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return {
        success: true,
        videoUrl: uploadResult.url,
      };
    } catch (error: any) {
      fastify.log.error({ 
        err: error,
        projectId,
        errorMessage: error?.message 
      }, 'ERROR: Failed to add audio');
      
      return reply.code(500).send({
        error: 'Failed to add audio',
        message: error.message || 'An error occurred while adding audio',
      });
    }
  });

  // Merge audio tracks with video and save
  fastify.post('/projects/:id/merge-audio-and-save', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Merge audio tracks with video and save to S3',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          audioTracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                startTime: { type: 'number' },
                duration: { type: 'number' },
                volume: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { audioTracks?: Array<{ url: string; startTime: number; duration: number; volume: number }> } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const { audioTracks = [] } = request.body;

    try {
      // Verify project belongs to user
      const projectData = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!projectData) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Parse existing config
      const config = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});

      if (!config.videoUrl) {
        return reply.code(400).send({ error: 'No final video found. Please stitch scenes first.' });
      }

      fastify.log.info({ projectId, audioTrackCount: audioTracks.length }, 'Merging audio tracks with video');

      // Import video processing functions
      const { mergeAudioTracksWithVideo } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-merge-save-'));
      const videoPath = path.join(tempDir, 'input.mp4');
      const outputPath = path.join(tempDir, 'final-with-audio.mp4');

      // Download current video
      const videoResponse = await fetch(config.videoUrl);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(videoPath, videoBuffer);

      // Merge audio tracks with video
      await mergeAudioTracksWithVideo(videoPath, audioTracks, outputPath);
      fastify.log.info({ projectId }, 'Audio tracks merged successfully');

      // Upload merged video to S3
      const finalVideoBuffer = await fs.readFile(outputPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        user.sub,
        projectId,
        'final-video-with-audio.mp4'
      );
      fastify.log.info({ projectId, uploadUrl: uploadResult.url }, 'Merged video uploaded successfully');

      // Update project config with final video URL
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
        finalVideoUrl: uploadResult.url,
        videoCompleted: true,
        audioTracks: audioTracks,
        savedAt: new Date().toISOString(),
      };

      await query(
        'UPDATE projects SET config = $1 WHERE id = $2',
        [JSON.stringify(updatedConfig), projectId]
      );

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return {
        success: true,
        videoUrl: uploadResult.url,
        audioTrackCount: audioTracks.length,
      };
    } catch (error: any) {
      fastify.log.error({ 
        err: error,
        projectId,
        errorMessage: error?.message 
      }, 'ERROR: Failed to merge audio and save');
      
      return reply.code(500).send({
        error: 'Failed to merge audio and save',
        message: error.message || 'An error occurred while merging audio and saving',
      });
    }
  });

  // Trim video
  fastify.post('/projects/:id/trim-video', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Trim video to specific time range',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['startTime', 'endTime'],
        properties: {
          startTime: { type: 'number' },
          endTime: { type: 'number' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { startTime: number; endTime: number } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const { startTime, endTime } = request.body;

    try {
      // Verify project belongs to user
      const projectData = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!projectData) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Parse existing config
      const config = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});

      if (!config.videoUrl) {
        return reply.code(400).send({ error: 'No final video found' });
      }

      if (startTime >= endTime || startTime < 0) {
        return reply.code(400).send({ error: 'Invalid time range' });
      }

      fastify.log.info({ projectId, startTime, endTime }, 'Trimming video');

      // Import video processing functions
      const { trimVideo } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-trim-'));
      const videoPath = path.join(tempDir, 'input.mp4');
      const outputPath = path.join(tempDir, 'trimmed.mp4');

      // Download current video
      const videoResponse = await fetch(config.videoUrl);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(videoPath, videoBuffer);

      // Trim video
      await trimVideo(videoPath, startTime, endTime, outputPath);
      fastify.log.info({ projectId }, 'Video trimmed successfully');

      // Upload trimmed video
      const trimmedBuffer = await fs.readFile(outputPath);
      const uploadResult = await uploadGeneratedVideo(
        trimmedBuffer,
        user.sub,
        projectId,
        'trimmed.mp4'
      );
      fastify.log.info({ projectId, uploadUrl: uploadResult.url }, 'Trimmed video uploaded successfully');

      // Update project config
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
      };

      await query(
        'UPDATE projects SET config = $1 WHERE id = $2',
        [JSON.stringify(updatedConfig), projectId]
      );

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return {
        success: true,
        videoUrl: uploadResult.url,
      };
    } catch (error: any) {
      fastify.log.error({ 
        err: error,
        projectId,
        errorMessage: error?.message 
      }, 'ERROR: Failed to trim video');
      
      return reply.code(500).send({
        error: 'Failed to trim video',
        message: error.message || 'An error occurred while trimming video',
      });
    }
  });

  // Apply video effect
  fastify.post('/projects/:id/apply-effect', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Apply video effect',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['videoUrl', 'effect'],
        properties: {
          videoUrl: { type: 'string' },
          effect: { type: 'string' },
          effectParams: { type: 'object' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { videoUrl: string; effect: string; effectParams?: Record<string, any> } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const { videoUrl, effect, effectParams } = request.body;

    try {
      // Verify project belongs to user
      const projectData = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!projectData) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      fastify.log.info({ projectId, effect }, 'Applying video effect');

      // Import video processing functions
      const { applyVideoEffect } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-effect-'));
      const videoPath = path.join(tempDir, 'input.mp4');
      const outputPath = path.join(tempDir, 'output-with-effect.mp4');

      // Download current video
      const videoResponse = await fetch(videoUrl);
      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(videoPath, videoBuffer);

      // Apply effect
      await applyVideoEffect(videoPath, effect, effectParams || {}, outputPath);
      fastify.log.info({ projectId }, 'Effect applied successfully');

      // Upload new video
      const finalVideoBuffer = await fs.readFile(outputPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        user.sub,
        projectId,
        'output-with-effect.mp4'
      );
      fastify.log.info({ projectId, uploadUrl: uploadResult.url }, 'Video with effect uploaded successfully');

      // Update project config
      const config = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});
      
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
      };

      await query(
        'UPDATE projects SET config = $1 WHERE id = $2',
        [JSON.stringify(updatedConfig), projectId]
      );

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return {
        success: true,
        videoUrl: uploadResult.url,
      };
    } catch (error: any) {
      fastify.log.error({ 
        err: error,
        projectId,
        errorMessage: error?.message 
      }, 'ERROR: Failed to apply effect');
      
      return reply.code(500).send({
        error: 'Failed to apply effect',
        message: error.message || 'An error occurred while applying effect',
      });
    }
  });

  // Get all projects
  fastify.get('/projects', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get all projects for the current user',
      tags: ['projects'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              category: { type: 'string' },
              prompt: { type: 'string' },
              status: { type: 'string' },
              created_at: { type: 'string' },
              final_video_url: { type: ['string', 'null'] },
              thumbnail_url: { type: ['string', 'null'] },
              music_url: { type: ['string', 'null'] },
              config: { 
                type: ['object', 'null'],
                additionalProperties: true
              },
            },
            additionalProperties: true, // Allow other fields that might exist
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getCognitoUser(request);
      const userId = user.sub;

      fastify.log.info({ userId }, 'Fetching projects for user');

      // Get all projects for user from database
      // Use SELECT * to get all available columns (handles missing columns gracefully)
      // Note: PostgreSQL returns column names in lowercase by default
      const projects = await query(
        `SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      
      fastify.log.info({ 
        userId, 
        projectCount: projects.length
      }, 'Fetched projects from database');

      // Convert S3 URLs in config and database columns to presigned URLs for secure access
      const projectsWithPresignedUrls = await Promise.all(
        projects.map(async (project: any) => {
          // Convert final_video_url column to presigned URL if it exists (preferred source)
          // Check for null, undefined, and empty string explicitly
          if (project.final_video_url !== null && project.final_video_url !== undefined && project.final_video_url !== '') {
            try {
              // Convert to presigned URL silently (only log errors)
              project.final_video_url = await convertS3UrlToPresigned(project.final_video_url, 3600);
              
              // Also add to config for backward compatibility
              if (!project.config) {
                project.config = {};
              }
              const config = typeof project.config === 'string' 
                ? JSON.parse(project.config) 
                : (project.config || {});
              config.finalVideoUrl = project.final_video_url;
              // Keep config as object if it was already an object, or stringify if it was a string
              project.config = typeof project.config === 'string' ? JSON.stringify(config) : config;
            } catch (error: any) {
              fastify.log.warn({ projectId: project.id, error: error.message }, 'Failed to convert final_video_url to presigned URL');
            }
          }
          
          // Convert thumbnail_url column to presigned URL if it exists (preferred source)
          if (project.thumbnail_url !== null && project.thumbnail_url !== undefined && project.thumbnail_url !== '') {
            try {
              const originalThumbnailUrl = project.thumbnail_url;
              const convertedUrl = await convertS3UrlToPresigned(project.thumbnail_url, 3600);
              
              if (convertedUrl && convertedUrl !== originalThumbnailUrl) {
                project.thumbnail_url = convertedUrl;
              } else {
                // URL is already a presigned URL or public URL, keep as is
                project.thumbnail_url = convertedUrl || originalThumbnailUrl;
              }
              
              // Also add to config for backward compatibility
              if (!project.config) {
                project.config = {};
              }
              const config = typeof project.config === 'string' 
                ? JSON.parse(project.config) 
                : (project.config || {});
              config.thumbnailUrl = project.thumbnail_url;
              // Keep config as object if it was already an object, or stringify if it was a string
              project.config = typeof project.config === 'string' ? JSON.stringify(config) : config;
            } catch (error: any) {
              fastify.log.warn({ projectId: project.id, error: error.message }, 'Failed to convert thumbnail_url to presigned URL');
            }
          }
          
          // Convert music_url column to presigned URL if it exists (column may not exist)
          // Only process if the column exists in the result
          if (project.music_url !== undefined && project.music_url !== null) {
            try {
              project.music_url = await convertS3UrlToPresigned(project.music_url, 3600);
              // Also add to config for backward compatibility
              if (!project.config) {
                project.config = {};
              }
              const config = typeof project.config === 'string' 
                ? JSON.parse(project.config) 
                : (project.config || {});
              config.musicUrl = project.music_url;
              // Keep config as object if it was already an object, or stringify if it was a string
              project.config = typeof project.config === 'string' ? JSON.stringify(config) : config;
            } catch (error: any) {
              fastify.log.warn({ projectId: project.id, error: error.message }, 'Failed to convert music_url to presigned URL');
            }
          }
          
          if (project.config) {
            const config = typeof project.config === 'string' 
              ? JSON.parse(project.config) 
              : (project.config || {});
            
            // Convert videoUrl to presigned URL if it exists (fallback if no final_video_url)
            if (config.videoUrl && !project.final_video_url) {
              config.videoUrl = await convertS3UrlToPresigned(config.videoUrl, 3600);
            }
            
            // Convert finalVideoUrl to presigned URL if it exists (fallback if no final_video_url column)
            if (config.finalVideoUrl && !project.final_video_url) {
              config.finalVideoUrl = await convertS3UrlToPresigned(config.finalVideoUrl, 3600);
            }
            
            // Convert thumbnailUrl to presigned URL if it exists (fallback if no thumbnail_url column)
            if (config.thumbnailUrl && !project.thumbnail_url) {
              const originalConfigUrl = config.thumbnailUrl;
              const convertedConfigUrl = await convertS3UrlToPresigned(config.thumbnailUrl, 3600);
              config.thumbnailUrl = convertedConfigUrl || originalConfigUrl;
            }
            
            // Convert audioUrl to presigned URL if it exists
            if (config.audioUrl) {
              config.audioUrl = await convertS3UrlToPresigned(config.audioUrl, 3600);
            }
            
            // Convert sceneUrls array to presigned URLs if it exists (logging removed)
            if (config.sceneUrls && Array.isArray(config.sceneUrls)) {
              config.sceneUrls = await Promise.all(
                config.sceneUrls.map(async (url: string, index: number) => {
                  try {
                    if (!url || typeof url !== 'string' || url.trim() === '') {
                      return url;
                    }
                    const originalUrl = url.trim();
                    
                    // Check if already presigned
                    const alreadyPresigned = originalUrl.includes('X-Amz-Signature') || originalUrl.includes('AWSAccessKeyId') || originalUrl.includes('?X-Amz-');
                    if (alreadyPresigned) {
                      return originalUrl;
                    }
                    
                    const presignedUrl = await convertS3UrlToPresigned(originalUrl, 3600);
                    return presignedUrl || originalUrl;
                  } catch (error: any) {
                    // Only log errors
                    fastify.log.error({ 
                      projectId: project.id, 
                      error: error?.message,
                      url: url?.substring(0, 100),
                      index 
                    }, 'Failed to convert sceneUrl to presigned URL');
                    return url; // Return original URL on error
                  }
                })
              );
            }
            
            // Convert audioTracks URLs to presigned URLs if they exist
            if (config.audioTracks && Array.isArray(config.audioTracks)) {
              config.audioTracks = await Promise.all(
                config.audioTracks.map(async (track: any) => {
                  if (track.url) {
                    return {
                      ...track,
                      url: await convertS3UrlToPresigned(track.url, 3600),
                    };
                  }
                  return track;
                })
              );
            }
            
            project.config = config;
          }
          
          // Removed verbose per-project logging
          
          return project;
        })
      );

      // Log summary before returning
      const projectsWithVideos = projectsWithPresignedUrls.filter((p: any) => 
        p.final_video_url || p.config?.finalVideoUrl || p.config?.videoUrl
      );
      const projectsWithSceneUrls = projectsWithPresignedUrls.filter((p: any) => 
        p.config?.sceneUrls && Array.isArray(p.config.sceneUrls) && p.config.sceneUrls.length > 0
      );
      fastify.log.info({ 
        projectCount: projectsWithPresignedUrls.length
      }, 'Projects processed');
      
      return projectsWithPresignedUrls;
    } catch (error: any) {
      fastify.log.error({ err: error, message: error?.message, stack: error?.stack }, 'Error fetching projects');
      return reply.code(500).send({
        error: 'Internal server error',
        message: error?.message || 'Failed to fetch projects',
      });
    }
  });

  // Get project by ID
  fastify.get('/projects/:id', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get a project by ID',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' }, // Include name field in response schema
            category: { type: 'string' },
            prompt: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string' },
            final_video_url: { type: ['string', 'null'] }, // Include final_video_url
            music_url: { type: ['string', 'null'] }, // Include music_url
            config: { 
              type: 'object',
              additionalProperties: true,
            },
          },
          additionalProperties: true, // Allow additional properties from database
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };

    const project = await queryOne(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Convert S3 URLs in config and database columns to presigned URLs for secure access
    // Initialize config if it's null or undefined
    let config: any = {};
    if (project.config) {
      try {
        config = typeof project.config === 'string' 
          ? JSON.parse(project.config) 
          : (project.config || {});
      } catch (parseError) {
        fastify.log.warn({ projectId: id, error: parseError }, 'Failed to parse project config JSON');
        config = {};
      }
    } else {
      fastify.log.warn({ projectId: id, status: project.status }, 'Project config is null or undefined');
    }
    
    // Convert final_video_url column to presigned URL if it exists (preferred source)
    if (project.final_video_url !== null && project.final_video_url !== undefined && project.final_video_url !== '') {
      try {
        // Silent conversion - only log errors
        project.final_video_url = await convertS3UrlToPresigned(project.final_video_url, 3600);
        
        // Also add to config for backward compatibility
        config.finalVideoUrl = project.final_video_url;
        config.videoUrl = project.final_video_url; // Also set as videoUrl for compatibility
      } catch (error: any) {
        fastify.log.warn({ projectId: id, error: error?.message }, 'Failed to convert final_video_url column to presigned URL');
      }
    }
    
    // Convert music_url column to presigned URL if it exists
    if (project.music_url !== undefined && project.music_url !== null && project.music_url !== '') {
      try {
        project.music_url = await convertS3UrlToPresigned(project.music_url, 3600);
        config.musicUrl = project.music_url; // Also add to config for backward compatibility
      } catch (error: any) {
        fastify.log.warn({ projectId: id, error: error?.message }, 'Failed to convert music_url column to presigned URL');
      }
    }
    
    // Convert videoUrl to presigned URL if it exists (fallback if no final_video_url column)
    try {
      if (config.videoUrl) {
        const originalUrl = config.videoUrl;
        config.videoUrl = await convertS3UrlToPresigned(config.videoUrl, 3600);
        // Silent conversion - only log errors
      }
    } catch (error: any) {
      fastify.log.warn({ projectId: id, error: error?.message, url: config.videoUrl }, 'Failed to convert videoUrl to presigned URL');
    }
    
    // Convert finalVideoUrl to presigned URL if it exists (preferred over videoUrl)
    try {
      if (config.finalVideoUrl) {
        const originalUrl = config.finalVideoUrl;
        config.finalVideoUrl = await convertS3UrlToPresigned(config.finalVideoUrl, 3600);
        // Silent conversion - only log errors
      }
    } catch (error: any) {
      fastify.log.warn({ projectId: id, error: error?.message, url: config.finalVideoUrl }, 'Failed to convert finalVideoUrl to presigned URL');
    }
    
    // Convert audioUrl to presigned URL if it exists
    try {
      if (config.audioUrl) {
        config.audioUrl = await convertS3UrlToPresigned(config.audioUrl, 3600);
      }
    } catch (error: any) {
      fastify.log.warn({ projectId: id, error: error?.message, url: config.audioUrl }, 'Failed to convert audioUrl to presigned URL');
    }
    
    // Convert sceneUrls array to presigned URLs if it exists (logging removed)
    try {
      if (config.sceneUrls && Array.isArray(config.sceneUrls)) {
        config.sceneUrls = await Promise.all(
          config.sceneUrls.map(async (url: string, index: number) => {
            try {
              if (!url || typeof url !== 'string' || url.trim() === '') {
                return url;
              }
              const originalUrl = url.trim();
              const presignedUrl = await convertS3UrlToPresigned(originalUrl, 3600);
              return presignedUrl || originalUrl;
            } catch (error: any) {
              // Only log errors
              fastify.log.error({ 
                projectId: id, 
                error: error?.message,
                url: url?.substring(0, 100),
                index 
              }, 'Failed to convert sceneUrl to presigned URL');
              return url; // Return original URL on error
            }
          })
        );
      }
    } catch (error: any) {
      fastify.log.error({ projectId: id, error: error?.message }, 'Failed to convert sceneUrls to presigned URLs');
    }
    
    // Convert audioTracks URLs to presigned URLs if they exist
    try {
      if (config.audioTracks && Array.isArray(config.audioTracks)) {
        config.audioTracks = await Promise.all(
          config.audioTracks.map(async (track: any) => {
            if (track.url) {
              try {
                return {
                  ...track,
                  url: await convertS3UrlToPresigned(track.url, 3600),
                };
              } catch (error: any) {
                fastify.log.warn({ projectId: id, error: error?.message, url: track.url }, 'Failed to convert audioTrack URL to presigned URL');
                return track; // Return original track on error
              }
            }
            return track;
          })
        );
      }
    } catch (error: any) {
      fastify.log.warn({ projectId: id, error: error?.message }, 'Failed to convert audioTracks to presigned URLs');
    }
    
    // Always set config, even if it was null/undefined
    // Create a new object to ensure config is always present
    // Explicitly include name field and final_video_url to ensure they're always in the response
    const response = {
      ...project,
      name: project.name || null, // Explicitly include name field
      final_video_url: project.final_video_url || null, // Include final_video_url column if it exists
      music_url: project.music_url || null, // Include music_url column if it exists
      config: config, // Always include config, even if empty object
    };


    // Ensure config is included in response
    return response;
  });

  // Update project
  fastify.patch('/projects/:id', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Update a project',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          prompt: { type: 'string' },
          style: { type: 'string' },
          mood: { type: 'string' },
          config: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };
    const data = updateProjectSchema.parse(request.body);

    const project = await queryOne(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
      fastify.log.info({ projectId: id, newName: data.name }, 'Updating project name');
    }
    // Track if we need to update config (to avoid multiple assignments)
    let configToUpdate: any = null;
    let configNeedsUpdate = false;
    
    if (data.prompt) {
      updates.push(`prompt = $${paramIndex++}`);
      values.push(data.prompt);
      
      // If the prompt is a script (10000+ chars or JSON with scenes), also save it to config.script
      // This ensures the full script is preserved even if prompt is updated
      if (data.prompt.length > 10000 || (data.prompt.trim().startsWith('{') && data.prompt.includes('"scenes"'))) {
        // Initialize configToUpdate if not already set
        if (!configToUpdate) {
          configToUpdate = (request.body as any).config 
            ? { ...(request.body as any).config } // Start with provided config if exists
            : (typeof project.config === 'string' ? JSON.parse(project.config) : { ...(project.config || {}) }); // Or use existing config
        }
        configToUpdate.script = data.prompt;
        configNeedsUpdate = true;
        fastify.log.info({ projectId: id, scriptLength: data.prompt.length }, 'Detected script in prompt update, saving to config.script');
      }
    }
    
    // Handle config updates - either full config object or individual fields
    if ((request.body as any).config) {
      // Full config update
      const newConfig = (request.body as any).config;
      
      // If we already have configToUpdate (from script merge above), merge the new config into it
      if (configToUpdate) {
        configToUpdate = { ...configToUpdate, ...newConfig }; // Merge, with newConfig taking precedence
      } else {
        configToUpdate = newConfig;
      }
      configNeedsUpdate = true;
      
      // Log if script is being saved
      if (newConfig.script) {
        fastify.log.info({ 
          projectId: id, 
          scriptLength: newConfig.script.length,
          scriptPreview: newConfig.script.substring(0, 200) + '...',
          hasScenes: newConfig.script.includes('"scenes"'),
        }, 'Saving full script to config.script via PATCH');
      }
    } else if (data.style || data.mood || data.constraints || data.audioUrl || data.videoModelId || data.aspectRatio || data.colorPalette || data.pacing || data.imageModelId) {
      // Partial config update (merge with existing)
      if (!configToUpdate) {
        configToUpdate = typeof project.config === 'string' ? JSON.parse(project.config) : { ...(project.config || {}) };
      }
      if (data.style) configToUpdate.style = data.style;
      if (data.mood) configToUpdate.mood = data.mood;
      if (data.constraints) configToUpdate.constraints = data.constraints;
      if (data.audioUrl) configToUpdate.audioUrl = data.audioUrl;
      if (data.videoModelId) configToUpdate.videoModelId = data.videoModelId;
      if (data.aspectRatio) configToUpdate.aspectRatio = data.aspectRatio;
      if (data.colorPalette) configToUpdate.colorPalette = data.colorPalette;
      if (data.pacing) configToUpdate.pacing = data.pacing;
      if (data.imageModelId) configToUpdate.imageModelId = data.imageModelId;
      configNeedsUpdate = true;
    }
    
    // Add config update only once, if needed
    if (configNeedsUpdate && configToUpdate) {
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(configToUpdate));
    }
    if (data.mode) {
      updates.push(`mode = $${paramIndex++}`);
      values.push(data.mode);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, user.sub);

    await query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}`,
      values
    );

    const updated = await queryOne(
      `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
      [id, user.sub]
    );

    return updated;
  });

  // Delete project
  fastify.delete('/projects/:id', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Delete a project',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Delete project (CASCADE will delete related scenes, assets, etc.)
    await query('DELETE FROM projects WHERE id = $1', [id]);

    return reply.code(204).send();
  });

  // Debug endpoint to check scenes in database (temporary)
  fastify.get('/projects/:id/scenes/debug', {
    preHandler: [authenticateCognito],
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };

    const project = await queryOne(
      'SELECT id, name, status, created_at FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const scenes = await query(
      `SELECT id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url, created_at, updated_at
       FROM scenes
       WHERE project_id = $1
       ORDER BY scene_number ASC`,
      [id]
    );

    const projectConfig = await queryOne('SELECT config FROM projects WHERE id = $1', [id]);
    const config = projectConfig?.config ? (typeof projectConfig.config === 'string' ? JSON.parse(projectConfig.config) : projectConfig.config) : {};

    return {
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.created_at,
      },
      scenesInDatabase: scenes.length,
      scenes: scenes.map((s: any) => ({
        sceneNumber: s.scene_number,
        prompt: s.prompt?.substring(0, 100),
        hasVideoUrl: !!s.video_url,
        videoUrl: s.video_url || null,
        hasFirstFrame: !!s.first_frame_url,
        hasLastFrame: !!s.last_frame_url,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
      configSceneUrls: config.sceneUrls?.length || 0,
      configHasSceneUrls: !!(config.sceneUrls && Array.isArray(config.sceneUrls) && config.sceneUrls.length > 0),
    };
  });

  // Get scenes for a project
  fastify.get('/projects/:id/scenes', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get all scenes for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };

    // Verify project belongs to user and get config in one query
    const project = await queryOne(
      'SELECT id, config FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Parse project config to merge prompts from config
    const projectConfig = project.config 
      ? (typeof project.config === 'string' ? JSON.parse(project.config) : project.config)
      : {};

    // Get all scenes from database (URLs come from PostgreSQL)
    const scenes = await query(
      `SELECT id, scene_number, prompt, duration, start_time, video_url, thumbnail_url, first_frame_url, last_frame_url, created_at, updated_at
       FROM scenes
       WHERE project_id = $1
       ORDER BY scene_number ASC`,
      [id]
    );

    // Convert S3 URLs to presigned URLs and map to frontend format
    // Merge prompts from config if available (text comes from config)
    const scenesWithPresignedUrls = await Promise.all(
      scenes.map(async (s: any) => {
        let videoUrl = s.video_url;
        let firstFrameUrl = s.first_frame_url;
        let lastFrameUrl = s.last_frame_url;

        // Convert to presigned URLs if they're S3 URLs
        // Ensure URLs are complete and not truncated
        try {
          if (videoUrl && (videoUrl.includes('s3.') || videoUrl.includes('amazonaws.com'))) {
            const originalVideoUrl = videoUrl;
            videoUrl = await convertS3UrlToPresigned(videoUrl, 3600);
            if (!videoUrl || videoUrl.length < originalVideoUrl.length) {
              fastify.log.warn({ 
                projectId: id, 
                sceneNumber: s.scene_number,
                originalLength: originalVideoUrl.length,
                convertedLength: videoUrl?.length || 0,
                originalUrl: originalVideoUrl,
              }, 'Video URL may have been truncated during conversion');
              videoUrl = originalVideoUrl; // Fallback to original
            }
          }
          if (firstFrameUrl && (firstFrameUrl.includes('s3.') || firstFrameUrl.includes('amazonaws.com'))) {
            const originalFirstFrameUrl = firstFrameUrl;
            firstFrameUrl = await convertS3UrlToPresigned(firstFrameUrl, 3600);
            if (!firstFrameUrl || firstFrameUrl.length < originalFirstFrameUrl.length) {
              fastify.log.warn({ 
                projectId: id, 
                sceneNumber: s.scene_number,
                originalLength: originalFirstFrameUrl.length,
                convertedLength: firstFrameUrl?.length || 0,
              }, 'First frame URL may have been truncated during conversion');
              firstFrameUrl = originalFirstFrameUrl; // Fallback to original
            }
          }
          if (lastFrameUrl && (lastFrameUrl.includes('s3.') || lastFrameUrl.includes('amazonaws.com'))) {
            const originalLastFrameUrl = lastFrameUrl;
            lastFrameUrl = await convertS3UrlToPresigned(lastFrameUrl, 3600);
            if (!lastFrameUrl || lastFrameUrl.length < originalLastFrameUrl.length) {
              fastify.log.warn({ 
                projectId: id, 
                sceneNumber: s.scene_number,
                originalLength: originalLastFrameUrl.length,
                convertedLength: lastFrameUrl?.length || 0,
              }, 'Last frame URL may have been truncated during conversion');
              lastFrameUrl = originalLastFrameUrl; // Fallback to original
            }
          }
        } catch (error: any) {
          fastify.log.warn({ 
            projectId: id, 
            sceneNumber: s.scene_number,
            error: error?.message,
            videoUrlLength: videoUrl?.length || 0,
            firstFrameUrlLength: firstFrameUrl?.length || 0,
            lastFrameUrlLength: lastFrameUrl?.length || 0,
          }, 'Failed to convert scene URL to presigned URL');
        }

        // Get prompt from config if available (prefer config over database prompt)
        // Check config.scenePrompts first, then config.script.scenes
        let prompt = s.prompt; // Default to database prompt
        if (projectConfig.scenePrompts && Array.isArray(projectConfig.scenePrompts)) {
          const configScene = projectConfig.scenePrompts.find((sp: any) => 
            sp.id === s.id || projectConfig.scenePrompts.indexOf(sp) === s.scene_number - 1
          );
          if (configScene?.prompt) {
            prompt = configScene.prompt;
          }
        } else if (projectConfig.script?.scenes && Array.isArray(projectConfig.script.scenes)) {
          const configScene = projectConfig.script.scenes[s.scene_number - 1];
          if (configScene?.prompt) {
            prompt = configScene.prompt;
          }
        }

        return {
          id: s.id,
          sceneNumber: s.scene_number,
          prompt: prompt, // Use prompt from config if available, otherwise from database
          duration: s.duration,
          startTime: s.start_time,
          videoUrl: videoUrl, // Always from database (PostgreSQL)
          thumbnailUrl: s.thumbnail_url,
          firstFrameUrl: firstFrameUrl, // Always from database
          lastFrameUrl: lastFrameUrl, // Always from database
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        };
      })
    );

    return reply.send(scenesWithPresignedUrls);
  });

  // Get frames for a project (stored in scenes table)
  fastify.get('/projects/:id/frames', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get all frames for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Get all scenes with frames
    const scenes = await query(
      `SELECT scene_number, first_frame_url, last_frame_url
       FROM scenes
       WHERE project_id = $1
       ORDER BY scene_number ASC`,
      [id]
    );

    // Convert to frames array format
    const frames: any[] = [];
    scenes.forEach((scene: any) => {
      if (scene.first_frame_url) {
        frames.push({
          id: `frame-${scene.scene_number}-first`,
          sceneNumber: scene.scene_number,
          type: 'first',
          url: scene.first_frame_url,
          thumbnail: scene.first_frame_url,
        });
      }
      if (scene.last_frame_url) {
        frames.push({
          id: `frame-${scene.scene_number}-last`,
          sceneNumber: scene.scene_number,
          type: 'last',
          url: scene.last_frame_url,
          thumbnail: scene.last_frame_url,
        });
      }
    });

    return frames;
  });

  // Save frames for a project
  fastify.post('/projects/:id/frames', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Save frames for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['frames'],
        properties: {
          frames: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sceneNumber', 'type', 'url'],
              properties: {
                sceneNumber: { type: 'number' },
                type: { type: 'string', enum: ['first', 'last', 'user_upload'] },
                url: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getCognitoUser(request);
    const { id } = request.params as { id: string };
    const { frames } = request.body as { frames: Array<{ sceneNumber: number; type: string; url: string }> };

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Group frames by scene
    const framesByScene = new Map<number, { first?: string; last?: string }>();
    frames.forEach((frame) => {
      if (!framesByScene.has(frame.sceneNumber)) {
        framesByScene.set(frame.sceneNumber, {});
      }
      const sceneFrames = framesByScene.get(frame.sceneNumber)!;
      if (frame.type === 'first' || frame.type === 'user_upload') {
        sceneFrames.first = frame.url;
      } else if (frame.type === 'last') {
        sceneFrames.last = frame.url;
      }
    });

    // Update or insert scenes with frames
    for (const [sceneNumber, sceneFrames] of framesByScene.entries()) {
      // Check if scene exists
      const existingScene = await queryOne(
        'SELECT id FROM scenes WHERE project_id = $1 AND scene_number = $2',
        [id, sceneNumber]
      );

      if (existingScene) {
        // Update existing scene
        await query(
          `UPDATE scenes 
           SET first_frame_url = COALESCE($1, first_frame_url),
               last_frame_url = COALESCE($2, last_frame_url),
               updated_at = NOW()
           WHERE project_id = $3 AND scene_number = $4`,
          [sceneFrames.first || null, sceneFrames.last || null, id, sceneNumber]
        );
      } else {
        // Insert new scene
        await query(
          `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, first_frame_url, last_frame_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            sceneNumber,
            `Scene ${sceneNumber} description...`,
            0,
            0,
            sceneFrames.first || null,
            sceneFrames.last || null,
          ]
        );
      }
    }

    return { success: true };
  });

  // Save draft
  fastify.post('/projects/:id/draft', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Save draft data for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id } = request.params;
    const draftData = request.body;

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    try {
      const result = await saveDraft(draftData, user.sub, id);
      return { success: true, url: result.url };
    } catch (error: any) {
      fastify.log.error({ err: error, projectId: id }, 'Failed to save draft');
      return reply.code(500).send({
        error: 'Failed to save draft',
        message: error.message || 'Could not save draft to S3',
      });
    }
  });

  // Load draft
  fastify.get('/projects/:id/draft', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Load draft data for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id } = request.params;

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    try {
      const draftData = await loadDraft(user.sub, id);
      if (!draftData) {
        return reply.code(404).send({ error: 'Draft not found' });
      }
      return draftData;
    } catch (error: any) {
      fastify.log.error({ err: error, projectId: id }, 'Failed to load draft');
      return reply.code(500).send({
        error: 'Failed to load draft',
        message: error.message || 'Could not load draft from S3',
      });
    }
  });

  // Delete draft
  fastify.delete('/projects/:id/draft', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Delete draft data for a project',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id } = request.params;

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    try {
      await deleteDraft(user.sub, id);
      return { success: true };
    } catch (error: any) {
      fastify.log.error({ err: error, projectId: id }, 'Failed to delete draft');
      return reply.code(500).send({
        error: 'Failed to delete draft',
        message: error.message || 'Could not delete draft from S3',
      });
    }
  });

  // Generate music for a project
  fastify.post('/projects/:id/generate-music', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate music for a project using Minimax Music 1.5',
      tags: ['projects'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['lyrics'],
        properties: {
          lyrics: { type: 'string', minLength: 1 },
          prompt: { type: 'string' }, // Style prompt (required by API)
          bitrate: { type: 'number' },
          sample_rate: { type: 'number' },
          audio_format: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: { lyrics: string; prompt?: string; bitrate?: number; sample_rate?: number; audio_format?: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const { lyrics, prompt, bitrate, sample_rate, audio_format } = request.body;

    try {
      // Verify project belongs to user
      const project = await queryOne(
        'SELECT id, config FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Log the payload being sent
      const musicPayload = {
        lyrics: lyrics.substring(0, 100) + (lyrics.length > 100 ? '...' : ''),
        lyricsLength: lyrics.length,
        prompt: prompt || 'Jazz, Smooth Jazz, Romantic, Dreamy',
        bitrate: bitrate || 256000,
        sample_rate: sample_rate || 44100,
        audio_format: audio_format || 'mp3',
      };
      fastify.log.info({ projectId, payload: musicPayload }, 'Music generation request payload');

      // Generate music using Replicate
      const { generateMusic } = await import('../services/replicate');
      const musicUrl = await generateMusic(
        lyrics,
        prompt || 'Jazz, Smooth Jazz, Romantic, Dreamy',
        {
          bitrate: bitrate || 256000,
          sample_rate: sample_rate || 44100,
          audio_format: audio_format || 'mp3',
        }
      );

      // Download music and upload to S3
      const response = await fetch(musicUrl);
      if (!response.ok) {
        throw new Error(`Failed to download music: ${response.statusText}`);
      }

      const musicBuffer = Buffer.from(await response.arrayBuffer());
      const { uploadAudio } = await import('../services/storage');
      const uploadResult = await uploadAudio(
        musicBuffer,
        user.sub,
        projectId,
        `music-${Date.now()}.mp3`
      );

      // Save music URL to project config and database column
      // This ensures the URL is stored in both places for consistency and easier querying
      const currentConfig = typeof project.config === 'string' 
        ? JSON.parse(project.config) 
        : (project.config || {});
      currentConfig.musicUrl = uploadResult.url;

      // Update both music_url column and config JSONB field
      // The music_url column is indexed for faster queries, while config maintains backward compatibility
      try {
        await query(
          `UPDATE projects 
           SET music_url = $1, 
               config = $2, 
               updated_at = NOW() 
           WHERE id = $3`,
          [uploadResult.url, JSON.stringify(currentConfig), projectId]
        );
        fastify.log.info({ 
          projectId, 
          musicUrl: uploadResult.url.substring(0, 100) + '...',
          savedTo: ['music_url_column', 'config_jsonb']
        }, 'Music URL saved to both music_url column and config JSONB');
      } catch (dbError: any) {
        // If music_url column doesn't exist (legacy databases), just update config
        if (dbError.message && dbError.message.includes('music_url')) {
          fastify.log.warn({ projectId, error: dbError.message }, 'music_url column does not exist, updating config only');
          await query(
            `UPDATE projects 
             SET config = $1, 
                 updated_at = NOW() 
             WHERE id = $2`,
            [JSON.stringify(currentConfig), projectId]
          );
          fastify.log.info({ 
            projectId, 
            musicUrl: uploadResult.url.substring(0, 100) + '...',
            savedTo: ['config_jsonb']
          }, 'Music URL saved to config JSONB (music_url column not available)');
        } else {
          fastify.log.error({ projectId, error: dbError.message }, 'Failed to save music URL to database');
          throw dbError;
        }
      }

      fastify.log.info({ 
        projectId, 
        musicUrl: uploadResult.url.substring(0, 100) + '...',
        s3Key: uploadResult.key,
        s3Bucket: uploadResult.bucket
      }, 'Music generated, uploaded to S3, and saved to database successfully');

      return reply.send({ musicUrl: uploadResult.url });
    } catch (error: any) {
      fastify.log.error({ 
        projectId, 
        error: error.message,
        stack: error.stack,
        note: 'Music generation failed, but this does not block other operations (video generation, etc.)'
      }, 'Failed to generate music');
      return reply.code(500).send({ 
        error: 'Failed to generate music',
        message: error.message,
        note: 'Music generation failure does not affect video generation or other operations'
      });
    }
  });

  // Stitch scenes with optional music
  fastify.post('/projects/:id/stitch', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Stitch all scenes together with optional music',
      tags: ['projects'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
      // Body is optional - endpoint fetches scenes from database
      // If body is provided, it can include optional musicUrl
      body: {
        type: 'object',
        properties: {
          musicUrl: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body?: { musicUrl?: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;

    try {
      // Verify project belongs to user
      const project = await queryOne(
        'SELECT id, config FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // First, get ALL scenes to check for missing ones
      const allScenes = await query(
        `SELECT id, scene_number, video_url, prompt 
         FROM scenes 
         WHERE project_id = $1 
         ORDER BY scene_number ASC`,
        [projectId]
      );

      // Get scenes with video URLs for stitching
      const scenes = await query(
        `SELECT id, scene_number, video_url, prompt 
         FROM scenes 
         WHERE project_id = $1 AND video_url IS NOT NULL AND video_url != ''
         ORDER BY scene_number ASC`,
        [projectId]
      );

      // Log missing scenes (scenes without video URLs)
      if (allScenes && allScenes.length > 0) {
        const scenesWithVideos = new Set(scenes.map((s: any) => s.scene_number));
        const missingScenes = allScenes
          .filter((s: any) => !scenesWithVideos.has(s.scene_number))
          .map((s: any) => ({ sceneNumber: s.scene_number, hasVideoUrl: !!s.video_url }));
        
        if (missingScenes.length > 0) {
          fastify.log.warn({ 
            projectId, 
            missingScenes,
            totalScenes: allScenes.length,
            scenesWithVideos: scenes.length
          }, `Some scenes are missing video URLs and will be skipped during stitching`);
        }
      }

      if (!scenes || scenes.length === 0) {
        return reply.code(400).send({ 
          error: 'No scenes with videos found to stitch',
          message: allScenes && allScenes.length > 0 
            ? `Found ${allScenes.length} scene(s) but none have video URLs. Please generate videos for your scenes first.`
            : 'No scenes found. Please create and generate scenes first.'
        });
      }

      const sceneVideoUrls = scenes.map((s: any) => s.video_url).filter((url: string) => url) as string[];

      if (sceneVideoUrls.length === 0) {
        return reply.code(400).send({ error: 'No valid scene video URLs found' });
      }

      // Log which scenes are being stitched
      const sceneNumbers = scenes.map((s: any) => s.scene_number).sort((a: number, b: number) => a - b);
      fastify.log.info({ 
        projectId, 
        sceneCount: sceneVideoUrls.length,
        sceneNumbers,
        totalScenesInDb: allScenes?.length || 0
      }, `Stitching ${sceneVideoUrls.length} scene(s) together (scenes: ${sceneNumbers.join(', ')})`);

      // Get music URL from request body (preferred) or project config
      const currentConfig = typeof project.config === 'string' 
        ? JSON.parse(project.config) 
        : (project.config || {});
      const body = request.body || {};
      const musicUrl = body.musicUrl || currentConfig.musicUrl;

      // Stitch videos
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-stitch-'));
      const concatVideoPath = path.join(tempDir, 'concat.mp4');
      const finalVideoPath = path.join(tempDir, 'final.mp4');

      const { concatenateVideos, addAudioToVideo } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');

      // Concatenate all scene videos
      await concatenateVideos(sceneVideoUrls, concatVideoPath);
      fastify.log.info({ projectId }, 'Videos concatenated successfully');

      // Add music if available
      if (musicUrl) {
        fastify.log.info({ projectId, musicUrl: musicUrl }, 'Adding music to stitched video');
        await addAudioToVideo(concatVideoPath, musicUrl, finalVideoPath);
        fastify.log.info({ projectId }, 'Music added to video successfully');
      } else {
        // No music, use concatenated video as final
        await fs.copyFile(concatVideoPath, finalVideoPath);
        fastify.log.info({ projectId }, 'No music available, using concatenated video as final');
      }

      // Upload final video
      const finalVideoBuffer = await fs.readFile(finalVideoPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        user.sub,
        projectId,
        'final-stitched.mp4'
      );
      const finalVideoUrl = uploadResult.url;

      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true });

      // Update project config and database, and mark project as completed
      currentConfig.finalVideoUrl = finalVideoUrl;
      currentConfig.videoUrl = finalVideoUrl; // Also save as videoUrl for compatibility

      // Try to update final_video_url column and mark as completed
      try {
        await query(
          `UPDATE projects 
           SET final_video_url = $1, 
               status = 'completed',
               config = $2, 
               updated_at = NOW() 
           WHERE id = $3`,
          [finalVideoUrl, JSON.stringify(currentConfig), projectId]
        );
      } catch (dbError: any) {
        // If final_video_url column doesn't exist, just update config and status
        if (dbError.message && dbError.message.includes('final_video_url')) {
          fastify.log.warn({ projectId, error: dbError.message }, 'final_video_url column does not exist, updating config and status only');
          await query(
            `UPDATE projects 
             SET status = 'completed',
                 config = $1, 
                 updated_at = NOW() 
             WHERE id = $2`,
            [JSON.stringify(currentConfig), projectId]
          );
        } else {
          fastify.log.error({ projectId, error: dbError.message }, 'Failed to save final video URL to database');
          // Try to mark as completed anyway
          try {
            await query(
              `UPDATE projects 
               SET status = 'completed',
                   updated_at = NOW() 
               WHERE id = $1`,
              [projectId]
            );
          } catch (statusError: any) {
            fastify.log.error({ projectId, error: statusError.message }, 'Failed to mark project as completed');
          }
          throw dbError;
        }
      }

      fastify.log.info({ 
        projectId, 
        finalVideoUrl: finalVideoUrl,
        hasMusic: !!musicUrl,
        status: 'completed'
      }, 'Final video stitched, uploaded to S3, saved to database, and project marked as completed');

      return reply.send({ 
        success: true,
        videoUrl: finalVideoUrl,
        finalVideoUrl, // For backward compatibility
        sceneCount: sceneVideoUrls.length,
        hasMusic: !!musicUrl
      });
    } catch (error: any) {
      fastify.log.error({ projectId, error: error.message, stack: error.stack }, 'Failed to stitch scenes');
      return reply.code(500).send({ 
        error: 'Failed to stitch scenes',
        message: error.message 
      });
    }
  });

  // Fix projects that have final_video_url but are not marked as completed
  fastify.post('/projects/fix-completed-status', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Fix projects that have final_video_url but status is not completed',
      tags: ['projects'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            updatedCount: { type: 'number' },
            totalWithVideos: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { query } = await import('../services/database');
      
      // Check if final_video_url column exists
      const columnCheck = await query(
        `SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'projects' 
          AND column_name = 'final_video_url'
        ) as exists`
      );
      const hasFinalVideoUrlColumn = columnCheck[0]?.exists || false;
      
      let updatedCount = 0;
      let totalWithVideos = 0;
      
      if (hasFinalVideoUrlColumn) {
        // Count projects with final_video_url but not completed
        const countResult = await query(
          `SELECT COUNT(*) as count
           FROM projects
           WHERE (
             final_video_url IS NOT NULL 
             AND final_video_url != ''
             AND final_video_url != 'null'
           )
           AND status != 'completed'`
        );
        totalWithVideos = parseInt(countResult[0]?.count || '0', 10);
        
        // Update status to completed for projects with final_video_url
        const updateResult = await query(
          `UPDATE projects
           SET status = 'completed',
               updated_at = NOW()
           WHERE (
             final_video_url IS NOT NULL 
             AND final_video_url != ''
             AND final_video_url != 'null'
           )
           AND status != 'completed'
           RETURNING id`
        );
        updatedCount = updateResult.length;
      } else {
        // Fallback: Check config for finalVideoUrl
        const countResult = await query(
          `SELECT COUNT(*) as count
           FROM projects
           WHERE (
             (config->>'finalVideoUrl' IS NOT NULL 
             AND config->>'finalVideoUrl' != ''
             AND config->>'finalVideoUrl' != 'null')
             OR 
             (config->>'videoUrl' IS NOT NULL 
             AND config->>'videoUrl' != ''
             AND config->>'videoUrl' != 'null')
           )
           AND status != 'completed'`
        );
        totalWithVideos = parseInt(countResult[0]?.count || '0', 10);
        
        // Update status to completed for projects with video URLs in config
        const updateResult = await query(
          `UPDATE projects
           SET status = 'completed',
               updated_at = NOW()
           WHERE (
             (config->>'finalVideoUrl' IS NOT NULL 
             AND config->>'finalVideoUrl' != ''
             AND config->>'finalVideoUrl' != 'null')
             OR 
             (config->>'videoUrl' IS NOT NULL 
             AND config->>'videoUrl' != ''
             AND config->>'videoUrl' != 'null')
           )
           AND status != 'completed'
           RETURNING id`
        );
        updatedCount = updateResult.length;
      }
      
      fastify.log.info({ 
        updatedCount, 
        totalWithVideos,
        hasFinalVideoUrlColumn 
      }, 'Fixed projects with final_video_url but not marked as completed');
      
      return reply.send({
        success: true,
        updatedCount,
        totalWithVideos,
        hasFinalVideoUrlColumn,
        message: `Updated ${updatedCount} project(s) to completed status`
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message, stack: error.stack }, 'Failed to fix completed status');
      return reply.code(500).send({
        error: 'Failed to fix completed status',
        message: error.message
      });
    }
  });

}
