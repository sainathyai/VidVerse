import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getCognitoUser, authenticateCognito } from '../middleware/cognito';
import { query, queryOne } from '../services/database';
import { saveDraft, loadDraft, deleteDraft, convertS3UrlToPresigned } from '../services/storage';
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
    let counter = 1;
    
    while (true) {
      const existingProject = await queryOne(
        'SELECT id FROM projects WHERE user_id = $1 AND name = $2',
        [userId, finalProjectName]
      );

      if (!existingProject) {
        // Name is available, use it
        break;
      }

      // Name exists, try with number appended
      counter++;
      finalProjectName = `${projectName} ${counter}`;
      
      // Safety check to prevent infinite loop
      if (counter > 1000) {
        finalProjectName = `${projectName} ${Date.now()}`;
        break;
      }
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

      // Detect if the prompt is already a script or just context
      const isScriptFormat = (text: string, duration: number): boolean => {
        if (!text || text.trim().length === 0) return false;
        
        // Factor 1: Length-based detection - if more than 300 words per second, likely a script
        const wordCount = text.trim().split(/\s+/).length;
        const wordsPerSecond = wordCount / duration;
        if (wordsPerSecond >= 300) {
          fastify.log.info({ projectId, wordCount, duration, wordsPerSecond }, 'Detected as script based on length (>=300 words/sec)');
          return true;
        }
        
        // Factor 2: Check for numbered scenes (e.g., "Scene 1", "Scene 2", "Scene:", etc.)
        const sceneNumberPatterns = [
          /scene\s+\d+/i,
          /scene\s*:\s*\d+/i,
          /scene\s*#\s*\d+/i,
          /^\s*\d+\.\s*scene/i,
          /scene\s*number\s*\d+/i,
        ];
        const hasNumberedScenes = sceneNumberPatterns.some(pattern => pattern.test(text));
        if (hasNumberedScenes) {
          fastify.log.info({ projectId }, 'Detected as script based on numbered scenes');
          return true;
        }
        
        // Factor 3: Check for duration mentions in scenes
        const durationPatterns = [
          /duration\s*:\s*\d+/i,
          /duration\s*=\s*\d+/i,
          /\d+\s*seconds?/i,
          /startTime|endTime/i,
        ];
        const hasDurationInfo = durationPatterns.some(pattern => pattern.test(text));
        if (hasDurationInfo && hasNumberedScenes) {
          fastify.log.info({ projectId }, 'Detected as script based on duration info with scenes');
          return true;
        }
        
        // Factor 4: Check for JSON structure with script keywords
        try {
          const parsed = JSON.parse(text);
          // Check if it has script-like structure
          if (parsed.scenes && Array.isArray(parsed.scenes)) {
            return true;
          }
          if (parsed.overallPrompt && parsed.parsedPrompt) {
            return true;
          }
          if (parsed.sceneNumber !== undefined) {
            return true;
          }
        } catch {
          // Not valid JSON, check for script-like patterns
        }
        
        // Factor 5: Check for script-related keywords (case-insensitive)
        const scriptKeywords = [
          '"sceneNumber"', '"scenes"', '"overallPrompt"', '"parsedPrompt"',
          'sceneNumber', 'scenes', 'overallPrompt', 'parsedPrompt',
          'scene 1', 'scene 2', 'scene:', 'scene number',
          'startTime', 'endTime', 'duration', 'scene prompt'
        ];
        
        const lowerText = text.toLowerCase();
        const keywordMatches = scriptKeywords.filter(keyword => 
          lowerText.includes(keyword.toLowerCase())
        );
        
        // If we find multiple script keywords, it's likely a script
        if (keywordMatches.length >= 2) {
          return true;
        }
        
        // Factor 6: Check for JSON-like structure with scenes
        if (/"scenes"\s*:\s*\[/.test(text) || /"sceneNumber"/.test(text)) {
          return true;
        }
        
        return false;
      };

      // Check if the prompt is already a script
      if (isScriptFormat(projectData.prompt, videoDuration)) {
        fastify.log.info({ projectId }, 'Prompt is already a script format, parsing directly');
        
        let scriptJson: any;
        try {
          scriptJson = JSON.parse(projectData.prompt);
        } catch (parseError) {
          // Try to extract JSON from markdown code blocks
          const jsonMatch = projectData.prompt.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              scriptJson = JSON.parse(jsonMatch[1]);
            } catch (e) {
              // Still not JSON, try to parse as text-based script
              scriptJson = null;
            }
          } else {
            // Not JSON, try to parse as text-based script format
            scriptJson = null;
          }
        }

        // If we successfully parsed a JSON script, validate and return it
        if (scriptJson && scriptJson.scenes && Array.isArray(scriptJson.scenes)) {
          // Extract intelligent params from script for video generation
          const extractedParams: any = {};
          
          // Extract style, mood, and other parsed prompt info
          if (scriptJson.parsedPrompt) {
            if (scriptJson.parsedPrompt.style) extractedParams.style = scriptJson.parsedPrompt.style;
            if (scriptJson.parsedPrompt.mood) extractedParams.mood = scriptJson.parsedPrompt.mood;
            if (scriptJson.parsedPrompt.keyElements) extractedParams.keyElements = scriptJson.parsedPrompt.keyElements;
            if (scriptJson.parsedPrompt.keywords) extractedParams.keywords = scriptJson.parsedPrompt.keywords;
          }
          
          // Merge in params from dropdown (config)
          if (config.style) extractedParams.style = config.style;
          if (config.mood) extractedParams.mood = config.mood;
          if (config.aspectRatio) extractedParams.aspectRatio = config.aspectRatio;
          if (config.colorPalette) extractedParams.colorPalette = config.colorPalette;
          if (config.pacing) extractedParams.pacing = config.pacing;
          
          // Use scene references to determine proper splitting
          // If scenes already have timing info, use that; otherwise calculate evenly
          let scenes = scriptJson.scenes;
          const hasTiming = scenes.some((s: any) => s.startTime !== undefined && s.endTime !== undefined);
          
          if (!hasTiming) {
            // Calculate timing based on scene durations or split evenly
            let totalAllocated = 0;
            scenes = scenes.map((scene: any, index: number) => {
              const sceneDuration = scene.duration || (videoDuration / scenes.length);
              const startTime = totalAllocated;
              const endTime = startTime + sceneDuration;
              totalAllocated = endTime;
              
              return {
                sceneNumber: scene.sceneNumber || index + 1,
                prompt: scene.prompt || '',
                duration: sceneDuration,
                startTime: startTime,
                endTime: endTime,
              };
            });
          } else {
            // Use existing timing, but ensure all fields are present
            scenes = scenes.map((scene: any, index: number) => ({
              sceneNumber: scene.sceneNumber || index + 1,
              prompt: scene.prompt || '',
              duration: scene.duration || ((scene.endTime || 0) - (scene.startTime || 0)),
              startTime: scene.startTime || 0,
              endTime: scene.endTime || 0,
            }));
          }

          // Ensure overallPrompt is set
          scriptJson.overallPrompt = scriptJson.overallPrompt || projectData.prompt;
          
          // Update parsedPrompt with merged params
          if (!scriptJson.parsedPrompt) scriptJson.parsedPrompt = {};
          scriptJson.parsedPrompt = { ...scriptJson.parsedPrompt, ...extractedParams };
          
          // Update config with extracted params if they exist
          if (Object.keys(extractedParams).length > 0) {
            const updatedConfig = { ...config, ...extractedParams };
            // Optionally update the project config in database
            // await query('UPDATE projects SET config = $1 WHERE id = $2', [JSON.stringify(updatedConfig), projectId]);
          }

          return reply.send({
            script: JSON.stringify(scriptJson, null, 2),
            scenes: scenes,
          });
        }
        
        // If not JSON, try to parse as text-based script format
        if (!scriptJson) {
          fastify.log.info({ projectId }, 'Attempting to parse text-based script format');
          
          // Parse text-based script with numbered scenes
          const textScript = projectData.prompt;
          const scenes: any[] = [];
          
          // Split by scene markers (Scene 1, Scene 2, etc.)
          const scenePattern = /(?:^|\n)\s*(?:Scene\s*[#:]?\s*(\d+)|(\d+)\.\s*Scene|Scene\s*Number\s*(\d+))/i;
          const sceneMatches = [...textScript.matchAll(new RegExp(scenePattern.source, 'gim'))];
          
          if (sceneMatches.length > 0) {
            // Extract scenes
            for (let i = 0; i < sceneMatches.length; i++) {
              const match = sceneMatches[i];
              const sceneNum = parseInt(match[1] || match[2] || match[3] || String(i + 1));
              const startPos = match.index! + match[0].length;
              const endPos = i < sceneMatches.length - 1 ? sceneMatches[i + 1].index! : textScript.length;
              const sceneText = textScript.substring(startPos, endPos).trim();
              
              // Extract duration from scene text
              const durationMatch = sceneText.match(/duration\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:seconds?|sec)?/i);
              const secondsMatch = sceneText.match(/(\d+(?:\.\d+)?)\s*seconds?/i);
              let sceneDuration: number | undefined;
              
              if (durationMatch) {
                sceneDuration = parseFloat(durationMatch[1]);
              } else if (secondsMatch) {
                sceneDuration = parseFloat(secondsMatch[1]);
              }
              
              // Extract startTime and endTime if present
              const startTimeMatch = sceneText.match(/startTime\s*[=:]\s*(\d+(?:\.\d+)?)/i);
              const endTimeMatch = sceneText.match(/endTime\s*[=:]\s*(\d+(?:\.\d+)?)/i);
              const startTime = startTimeMatch ? parseFloat(startTimeMatch[1]) : undefined;
              const endTime = endTimeMatch ? parseFloat(endTimeMatch[1]) : undefined;
              
              // Clean up the prompt text (remove metadata lines)
              let promptText = sceneText
                .replace(/duration\s*[=:]\s*\d+(?:\.\d+)?\s*(?:seconds?|sec)?/gi, '')
                .replace(/(\d+(?:\.\d+)?)\s*seconds?/gi, '')
                .replace(/startTime\s*[=:]\s*\d+(?:\.\d+)?/gi, '')
                .replace(/endTime\s*[=:]\s*\d+(?:\.\d+)?/gi, '')
                .trim();
              
              scenes.push({
                sceneNumber: sceneNum,
                prompt: promptText,
                duration: sceneDuration,
                startTime: startTime,
                endTime: endTime,
              });
            }
          } else {
            // Fallback: try to split by common delimiters
            const sections = textScript.split(/\n\s*\n+/);
            sections.forEach((section, index) => {
              if (section.trim().length > 50) { // Only include substantial sections
                scenes.push({
                  sceneNumber: index + 1,
                  prompt: section.trim(),
                  duration: undefined,
                  startTime: undefined,
                  endTime: undefined,
                });
              }
            });
          }
          
          if (scenes.length > 0) {
            fastify.log.info({ projectId, sceneCount: scenes.length }, 'Successfully parsed text-based script');
            
            // Calculate timing if not provided
            let totalAllocated = 0;
            const scenesWithTiming = scenes.map((scene, index) => {
              let sceneDuration = scene.duration;
              let startTime = scene.startTime;
              let endTime = scene.endTime;
              
              if (!sceneDuration) {
                // Distribute remaining time evenly
                const remainingScenes = scenes.length - index;
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
            
            // Build the script JSON structure
            const parsedPrompt: any = {
              duration: videoDuration,
            };
            
            // Merge in params from dropdown (config)
      if (config.style) parsedPrompt.style = config.style;
      if (config.mood) parsedPrompt.mood = config.mood;
            if (config.aspectRatio) parsedPrompt.aspectRatio = config.aspectRatio;
            if (config.colorPalette) parsedPrompt.colorPalette = config.colorPalette;
            if (config.pacing) parsedPrompt.pacing = config.pacing;
            
            // Extract key elements and keywords from the script text
            const keyElements: string[] = [];
            const keywords: string[] = [];
            
            // Simple extraction: look for common patterns
            const allText = scenesWithTiming.map(s => s.prompt).join(' ');
            const elementPatterns = [
              /(?:a|an|the)\s+([a-z]+(?:\s+[a-z]+){0,2})\s+(?:calendar|book|watch|phone|laptop|table|chair|desk|pen|paper|picture|photo|frame|wall|door|window)/gi,
            ];
            
            // Extract potential key elements (this is a simple heuristic)
            const commonObjects = ['calendar', 'book', 'watch', 'phone', 'laptop', 'table', 'chair', 'desk'];
            commonObjects.forEach(obj => {
              if (allText.toLowerCase().includes(obj)) {
                keyElements.push(obj);
              }
            });
            
            parsedPrompt.keyElements = keyElements.length > 0 ? keyElements : undefined;
            parsedPrompt.keywords = keywords.length > 0 ? keywords : undefined;
            
            const scriptJson = {
        overallPrompt: projectData.prompt,
              parsedPrompt: parsedPrompt,
              scenes: scenesWithTiming,
            };
            
            return reply.send({
              script: JSON.stringify(scriptJson, null, 2),
              scenes: scenesWithTiming,
            });
          }
        }
      }

      // If not a script, generate one using LLM
      fastify.log.info({ projectId }, 'Prompt is context, generating script using LLM');
      
      // Check if OpenRouter API key is configured
      const { config: appConfig } = await import('../config');
      if (!appConfig.openrouter.apiKey) {
        return reply.code(503).send({
          error: 'OpenRouter API key not configured',
          message: 'Please set OPENROUTER_API_KEY in your environment variables',
        });
      }

      // Build comprehensive prompt for elaborate script generation
      const systemPrompt = `You are an expert video script writer specializing in creating highly detailed, elaborate video scripts for AI video generation. Your task is to create an extremely detailed script with approximately 10,000 words that breaks down a video concept into multiple scenes with rich, vivid descriptions.

CRITICAL REQUIREMENTS:
1. Generate approximately 10,000 words of detailed script content
2. **INTELLIGENT SCENE SPLITTING**: Analyze the concept and identify natural scene breaks based on:
   - Narrative flow and story progression
   - Visual transitions and changes in setting/location
   - Temporal changes (time of day, time progression)
   - Character or object introductions
   - Action sequences or key moments
   - Emotional beats or mood shifts
   Break the video into multiple scenes (typically 5-10 scenes for a ${videoDuration}-second video) based on these natural divisions
3. **EXTRACT KEY ELEMENTS**: Identify and extract key visual elements, objects, characters, props, and recurring themes from the concept (e.g., calendar, books, specific clothing, objects, characters, locations, colors, textures). These elements must be consistently referenced across ALL scenes to maintain visual continuity.
4. Each scene must have:
   - Detailed visual descriptions (camera angles, movements, lighting, composition)
   - Specific visual elements, colors, textures, and details
   - **Consistent key elements** from the overall concept (characters, objects, props, colors, etc.)
   - Precise timing (startTime and endTime in seconds) that adds up exactly to ${videoDuration} seconds
   - Scene duration that matches the narrative importance and visual complexity
   - Elaborate prompt descriptions suitable for AI video generation
5. **PARSE INTELLIGENT PARAMS**: Extract and include in parsedPrompt:
   - Style (visual style, cinematic style, artistic direction)
   - Mood (emotional tone, atmosphere)
   - Key elements array (all important objects, characters, props for consistency)
   - Keywords (important visual and narrative keywords)
6. **MAINTAIN CONSISTENCY**: Each scene prompt must reference the key elements extracted from the concept to ensure visual consistency throughout the video
7. **SCENE REFERENCES**: If the concept mentions specific scenes, scene numbers, or scene breaks, use those as reference points for splitting
8. Output MUST be valid JSON format matching the exact structure specified below

OUTPUT FORMAT (JSON):
{
  "overallPrompt": "The original user prompt",
  "parsedPrompt": {
    "style": "Detailed style description",
    "mood": "Detailed mood description",
    "duration": ${videoDuration},
    "keywords": ["keyword1", "keyword2", ...],
    "keyElements": ["element1", "element2", ...] // Extracted key visual elements, objects, characters, props
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "Extremely detailed, elaborate scene description (500-2000 words) with specific visual details, camera movements, lighting, colors, textures, composition, and all visual elements needed for AI video generation. MUST include references to key elements from the concept for consistency.",
      "duration": X.X,
      "startTime": X.X,
      "endTime": X.X
    },
    ...
  ]
}

IMPORTANT: 
- Each scene prompt should be extremely detailed and elaborate (500-2000 words each)
- Total word count should be approximately 10,000 words
- Scene durations must add up exactly to ${videoDuration} seconds
- **Extract and list key visual elements** (objects, characters, props, colors, textures) from the concept
- **Reference these key elements consistently** in each scene prompt to maintain visual continuity
- Be creative, vivid, and specific in your descriptions
- Focus on visual details that will help AI video generation models create stunning visuals
- Ensure characters, objects, and visual elements remain consistent across all scenes`;

      // Build comprehensive user prompt with all project context
      const userPrompt = `Create an elaborate, detailed video script for the following concept:

PROJECT DETAILS:
- Category: ${projectData.category || 'General'}
- Original Prompt: ${projectData.prompt}
- Duration: ${videoDuration} seconds
${config.style ? `- Style: ${config.style}` : ''}
${config.mood ? `- Mood: ${config.mood}` : ''}
${config.aspectRatio ? `- Aspect Ratio: ${config.aspectRatio}` : ''}
${config.colorPalette ? `- Color Palette: ${config.colorPalette}` : ''}
${config.pacing ? `- Pacing: ${config.pacing}` : ''}
${config.constraints ? `- Constraints: ${config.constraints}` : ''}

CRITICAL INSTRUCTIONS:
1. **Analyze Scene References**: If the concept mentions specific scenes, scene numbers, scene breaks, or natural divisions, use those as reference points for splitting. Pay attention to:
   - Explicit scene mentions (e.g., "Scene 1:", "First scene", "Next scene")
   - Natural narrative breaks or transitions
   - Changes in location, time, or focus
   - Visual or thematic shifts

2. **Extract Key Elements**: Identify all key visual elements from the concept such as:
   - Specific objects, props, or items (e.g., calendar, books, watch, specific clothing items)
   - Characters and their consistent appearance/attributes
   - Recurring visual themes, colors, or textures
   - Locations or settings
   - Any other elements that should remain consistent across scenes

3. **Maintain Consistency**: Each scene must reference these key elements to ensure visual continuity. For example:
   - If a character appears, maintain their consistent appearance, clothing, and attributes
   - If specific objects (like a calendar or book) are mentioned, reference them consistently
   - If specific colors or textures are key to the concept, include them in each scene

4. **Intelligent Scene Splitting**: Break the concept into scenes based on:
   - Natural narrative flow and story progression
   - Visual transitions and setting changes
   - Temporal progression (time of day, time passing)
   - Character or object introductions
   - Key moments or action sequences
   - Emotional or mood shifts
   If the concept already has scene divisions, respect and use those.

5. **Parse Intelligent Params**: Extract and include in the parsedPrompt:
   - Style: Visual/cinematic style from the concept or project settings
   - Mood: Emotional tone and atmosphere
   - Key elements: Array of all important objects, characters, props for consistency
   - Keywords: Important visual and narrative keywords

6. Generate an elaborate script with approximately 10,000 words, breaking this into multiple detailed scenes. Each scene should have rich, vivid descriptions perfect for AI video generation. Include specific details about camera movements, lighting, colors, textures, composition, and all visual elements.

7. List all extracted key elements in the "keyElements" array in parsedPrompt so they can be referenced consistently across all scenes.`;

      // Call OpenRouter API with Claude Sonnet 4.5
      // Add timeout to prevent hanging (5 minutes for large script generation)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes timeout
      
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
            model: 'anthropic/claude-3.5-sonnet', // Updated to correct model name
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.8,
            max_tokens: 32000, // Dramatically increased to allow for very elaborate scripts (20,000+ words)
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          fastify.log.error({ projectId }, 'OpenRouter API request timed out after 5 minutes');
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
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch {
          // Use default error message
        }

        fastify.log.error({ 
          status: openrouterResponse.status,
          error: errorText,
          projectId 
        }, 'OpenRouter API error during script generation');
        
        return reply.code(502).send({
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
      
      if (!aiResponse || typeof aiResponse !== 'string') {
        fastify.log.error({ projectId, response: openrouterData }, 'Invalid AI response format');
        return reply.code(502).send({
          error: 'Invalid response from AI service',
          message: 'The AI service returned an invalid response format',
        });
      }

      fastify.log.info({ projectId, responseLength: aiResponse.length }, 'Received AI response, parsing JSON');

      // Helper function to clean and fix JSON strings with control characters
      const cleanJsonString = (jsonString: string): string => {
        // First, try to extract JSON from markdown code blocks if present
        const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        let jsonToClean = jsonMatch ? jsonMatch[1] : jsonString;
        
        // Try to find JSON object boundaries if not in code block
        if (!jsonMatch) {
          const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
          if (jsonObjectMatch) {
            jsonToClean = jsonObjectMatch[0];
          }
        }
        
        // Fix control characters in JSON string values
        // Process character by character to properly handle escaped sequences
        let cleaned = '';
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < jsonToClean.length; i++) {
          const char = jsonToClean[i];
          const charCode = char.charCodeAt(0);
          
          if (escapeNext) {
            // This character is escaped, keep it as-is
            cleaned += char;
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            // Next character is escaped
            escapeNext = true;
            cleaned += char;
            continue;
          }
          
          if (char === '"') {
            // Toggle string state
            inString = !inString;
            cleaned += char;
            continue;
          }
          
          if (inString) {
            // We're inside a string value
            // Escape control characters (0x00-0x1F except already escaped ones)
            if (charCode >= 0x00 && charCode <= 0x1F) {
              // Map control characters to their escape sequences
              const escapeMap: Record<number, string> = {
                0x08: '\\b',  // Backspace
                0x09: '\\t',  // Tab
                0x0A: '\\n',  // Newline
                0x0C: '\\f',  // Form feed
                0x0D: '\\r',  // Carriage return
              };
              
              if (escapeMap[charCode]) {
                cleaned += escapeMap[charCode];
              } else {
                // Use Unicode escape for other control characters
                cleaned += `\\u${charCode.toString(16).padStart(4, '0')}`;
              }
            } else {
              cleaned += char;
            }
          } else {
            // Outside string, keep as-is
            cleaned += char;
          }
        }
        
        return cleaned;
      };

      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      let scriptJson: any;
      try {
        // Try to parse as-is first
        scriptJson = JSON.parse(aiResponse);
        fastify.log.info({ projectId }, 'Successfully parsed JSON directly from AI response');
      } catch (parseError: any) {
        fastify.log.warn({ projectId, parseError: parseError.message }, 'Direct JSON parse failed, trying to clean and fix JSON');
        
        try {
          // Clean the JSON string to fix control characters
          const cleanedJson = cleanJsonString(aiResponse);
          scriptJson = JSON.parse(cleanedJson);
          fastify.log.info({ projectId }, 'Successfully parsed JSON after cleaning control characters');
        } catch (cleanError: any) {
          fastify.log.warn({ projectId, error: cleanError.message }, 'Cleaned JSON parse failed, trying markdown extraction');
          
          // Try to extract JSON from markdown code blocks
          const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              const cleanedMarkdown = cleanJsonString(jsonMatch[1]);
              scriptJson = JSON.parse(cleanedMarkdown);
              fastify.log.info({ projectId }, 'Successfully parsed JSON from markdown code block after cleaning');
            } catch (e: any) {
              fastify.log.warn({ projectId, error: e.message }, 'Markdown extraction failed, trying regex match with cleaning');
              
              // If still fails, try to find JSON object in the text and clean it
              const jsonObjectMatch = aiResponse.match(/\{[\s\S]*\}/);
              if (jsonObjectMatch) {
                try {
                  const cleanedObject = cleanJsonString(jsonObjectMatch[0]);
                  scriptJson = JSON.parse(cleanedObject);
                  fastify.log.info({ projectId }, 'Successfully parsed JSON using regex match after cleaning');
                } catch (regexError: any) {
                  fastify.log.error({ 
                    projectId, 
                    error: regexError.message, 
                    position: regexError.message.match(/position (\d+)/)?.[1],
                    responsePreview: aiResponse.substring(0, 1000) 
                  }, 'Failed to parse JSON from AI response after all cleaning attempts');
                  
                  // Try one more time with a more aggressive cleaning approach
                  try {
                    // Remove all control characters except those that are properly escaped
                    let aggressiveClean = jsonObjectMatch[0];
                    // Replace unescaped newlines, tabs, etc. in string values
                    aggressiveClean = aggressiveClean.replace(/(?<!\\)"(?:[^"\\]|\\.)*"/g, (match) => {
                      return match
                        .replace(/\n/g, '\\n')
                        .replace(/\r/g, '\\r')
                        .replace(/\t/g, '\\t');
                    });
                    scriptJson = JSON.parse(aggressiveClean);
                    fastify.log.info({ projectId }, 'Successfully parsed JSON using aggressive cleaning');
                  } catch (finalError: any) {
                    fastify.log.error({ projectId, error: finalError.message }, 'All JSON parsing attempts failed');
                    return reply.code(502).send({
                      error: 'Failed to parse script JSON',
                      message: `Could not extract valid JSON from AI response. The response may contain invalid control characters. Error: ${finalError.message}`,
                    });
                  }
                }
              } else {
                fastify.log.error({ projectId, responsePreview: aiResponse.substring(0, 500) }, 'No JSON object found in AI response');
                return reply.code(502).send({
                  error: 'Invalid script format',
                  message: 'Could not extract JSON from AI response. The response may not contain valid JSON.',
                });
              }
            }
          } else {
            fastify.log.error({ projectId, parseError: parseError.message, responsePreview: aiResponse.substring(0, 500) }, 'Failed to parse JSON and no markdown code block found');
            return reply.code(502).send({
              error: 'Failed to parse script JSON',
              message: `Could not parse JSON from AI response: ${parseError.message}`,
            });
          }
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
          videoModelId: { type: 'string' },
          aspectRatio: { type: 'string' },
          style: { type: 'string' },
          mood: { type: 'string' },
          colorPalette: { type: 'string' },
          pacing: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { id: string }; Body?: { useReferenceFrame?: boolean; videoModelId?: string; aspectRatio?: string; style?: string; mood?: string; colorPalette?: string; pacing?: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const requestBody = request.body || {};

    // Verify project belongs to user
    const projectData = await queryOne(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!projectData) {
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
      ...(requestBody.videoModelId !== undefined && { videoModelId: requestBody.videoModelId }),
      ...(requestBody.aspectRatio !== undefined && { aspectRatio: requestBody.aspectRatio }),
      ...(requestBody.style !== undefined && { style: requestBody.style }),
      ...(requestBody.mood !== undefined && { mood: requestBody.mood }),
      ...(requestBody.colorPalette !== undefined && { colorPalette: requestBody.colorPalette }),
      ...(requestBody.pacing !== undefined && { pacing: requestBody.pacing }),
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
      let scenes: Array<{ sceneNumber: number; prompt: string; duration: number; startTime: number; endTime: number }>;
      let scriptParsedPrompt: any = {};
      
      // Detect if the prompt is already a script
      const isScriptFormat = (text: string, duration: number): boolean => {
        if (!text || text.trim().length === 0) return false;
        
        // Factor 1: Length-based detection
        const wordCount = text.trim().split(/\s+/).length;
        const wordsPerSecond = wordCount / duration;
        if (wordsPerSecond >= 300) {
          return true;
        }
        
        // Factor 2: Check for numbered scenes
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
        
        // Factor 3: Check for duration mentions in scenes
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
        
        // Factor 4: Check for JSON structure
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
      
      if (isScriptFormat(projectData.prompt, videoDuration)) {
        fastify.log.info({ projectId }, 'Step 1-2: Prompt is a script, parsing directly');
        
        // Parse script (same logic as generate-script endpoint)
        let scriptJson: any;
        try {
          scriptJson = JSON.parse(projectData.prompt);
        } catch {
          const jsonMatch = projectData.prompt.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            try {
              scriptJson = JSON.parse(jsonMatch[1]);
            } catch {
              scriptJson = null;
            }
          } else {
            scriptJson = null;
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
          
          // Use scenes from script
          scenes = scriptJson.scenes.map((scene: any, index: number) => ({
            sceneNumber: scene.sceneNumber || index + 1,
            prompt: scene.prompt || '',
            duration: scene.duration || ((scene.endTime || 0) - (scene.startTime || 0)),
            startTime: scene.startTime || 0,
            endTime: scene.endTime || 0,
          }));
        } else {
          // Try to parse as text-based script
          const textScript = projectData.prompt;
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
        
        fastify.log.info({ 
          projectId, 
          sceneCount: scenes.length,
          parsedStyle: scriptParsedPrompt.style,
          parsedMood: scriptParsedPrompt.mood,
          parsedAspectRatio: scriptParsedPrompt.aspectRatio,
        }, 'Step 1-2: Script parsed successfully');
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
        scenes = planScenes(projectData.prompt, parsedPrompt, videoDuration);
      fastify.log.info({ 
        projectId, 
        sceneCount: scenes.length,
        scenes: scenes.map(s => ({ 
          number: s.sceneNumber, 
          duration: s.duration, 
          promptLength: s.prompt?.length || 0 
        })),
      }, 'Step 2: Scenes planned successfully');
      }

      // 3. Generate videos for each scene
      fastify.log.info({ projectId, totalScenes: scenes.length }, 'Step 3: Starting video generation for all scenes');
      const sceneVideos: string[] = [];
      const frameUrls: { first: string; last: string }[] = [];
      let previousSceneLastFrameUrl: string | undefined = undefined; // Track last frame from previous scene

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneStartTime = Date.now();
        fastify.log.info({ 
          projectId, 
          sceneNumber: scene.sceneNumber,
          totalScenes: scenes.length,
          scenePrompt: scene.prompt,
          scenePromptPreview: scene.prompt?.substring(0, 150) + '...',
          sceneDuration: scene.duration,
          hasReferenceFrame: !!previousSceneLastFrameUrl,
        }, `Step 3.${i + 1}: Generating video for scene ${scene.sceneNumber}/${scenes.length} with unique prompt`);

        try {
          // Get the selected video model ID - use from config, fallback to default
          const selectedVideoModelId = config.videoModelId || 'google/veo-3.1';
          
          fastify.log.info({ 
            projectId,
            sceneNumber: scene.sceneNumber,
            configVideoModelId: config.videoModelId,
            selectedVideoModelId: selectedVideoModelId,
            usingDefault: !config.videoModelId,
          }, `Step 3.${i + 1}: Video model selection`);
          
          // Build video generation options
          const videoGenOptions: any = {
            prompt: scene.prompt,
            duration: scene.duration,
            videoModelId: selectedVideoModelId, // Pass user's selected video model
            aspectRatio: scriptParsedPrompt.aspectRatio || config.aspectRatio || '16:9', // Use from script or config
            style: scriptParsedPrompt.style || config.style, // Use from script or config
            mood: scriptParsedPrompt.mood || config.mood, // Use from script or config
            colorPalette: scriptParsedPrompt.colorPalette || config.colorPalette, // Use from script or config
            pacing: scriptParsedPrompt.pacing || config.pacing, // Use from script or config
          };
          
          // Use last frame from previous scene as reference for smooth transitions
          // Only if useReferenceFrame is enabled (defaults to false - user must opt-in)
          // Handle both boolean true and string "true" values (JSON parsing can sometimes return strings)
          const useReferenceFrameValue = config.useReferenceFrame;
          const shouldUseReferenceFrame = useReferenceFrameValue === true || useReferenceFrameValue === 'true' || useReferenceFrameValue === 1;
          
          fastify.log.info({ 
            projectId,
            sceneNumber: scene.sceneNumber,
            useReferenceFrameValue,
            useReferenceFrameType: typeof useReferenceFrameValue,
            shouldUseReferenceFrame,
            hasPreviousFrame: !!previousSceneLastFrameUrl,
            isFirstScene: i === 0,
          }, `Step 3.${i + 1}: Reference frame check - useReferenceFrame=${useReferenceFrameValue} (type: ${typeof useReferenceFrameValue}), shouldUse=${shouldUseReferenceFrame}`);
          
          // Explicitly ensure reference frame parameters are not included when disabled
          if (previousSceneLastFrameUrl && i > 0) {
            if (shouldUseReferenceFrame) {
              if (selectedVideoModelId === 'google/veo-3.1') {
                videoGenOptions.lastFrame = previousSceneLastFrameUrl;
                fastify.log.info({ 
                  projectId, 
                  sceneNumber: scene.sceneNumber,
                  lastFrameUrl: previousSceneLastFrameUrl,
                }, `Step 3.${i + 1}: Using last frame from scene ${i} as reference for Veo 3.1`);
              } else {
                // For other models (Veo 3, Veo 3 Fast, Sora 2, Kling), use image parameter
                videoGenOptions.image = previousSceneLastFrameUrl;
                fastify.log.info({ 
                  projectId, 
                  sceneNumber: scene.sceneNumber,
                  referenceImageUrl: previousSceneLastFrameUrl,
                }, `Step 3.${i + 1}: Using last frame from scene ${i} as reference image`);
              }
            } else {
              // Explicitly ensure these are not set when useReferenceFrame is false
              delete videoGenOptions.lastFrame;
              delete videoGenOptions.image;
              fastify.log.info({ 
                projectId, 
                sceneNumber: scene.sceneNumber,
              }, `Step 3.${i + 1}: Skipping reference frame (useReferenceFrame disabled) - not including in Replicate API call`);
            }
          } else {
            // Ensure these are not set for first scene or when no previous frame exists
            delete videoGenOptions.lastFrame;
            delete videoGenOptions.image;
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
              url: videoUrl.substring(0, 100) + '...',
            }, `Step 3.${i + 1}: Using string output as video URL`);
          } else if (Array.isArray(normalizedOutput)) {
            // Array of URLs - take the first one
            videoUrl = normalizedOutput[0];
            fastify.log.info({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              outputType: 'array',
              arrayLength: normalizedOutput.length,
              url: videoUrl.substring(0, 100) + '...',
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
                url: videoUrl.substring(0, 100) + '...',
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
                  url: videoUrl.substring(0, 100) + '...',
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
                url: videoUrl.substring(0, 100) + '...',
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
                url: videoUrl.substring(0, 100) + '...',
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
          
          try {
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
          } catch (uploadError: any) {
            fastify.log.error({ 
              projectId, 
              sceneNumber: scene.sceneNumber,
              error: uploadError.message,
            }, `Step 3.${i + 1}.0: Failed to upload scene video to S3, using Replicate URL as fallback`);
            // Continue with Replicate URL as fallback
          }
          
          sceneVideos.push(videoUrl);

          // Extract frames
          fastify.log.info({ projectId, sceneNumber: scene.sceneNumber }, `Step 3.${i + 1}.1: Extracting frames from scene ${scene.sceneNumber}`);
          const frames = await extractFrames(videoUrl, user.sub, projectId, scene.sceneNumber);
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

          // Store scene in database
          fastify.log.info({ projectId, sceneNumber: scene.sceneNumber }, `Step 3.${i + 1}.2: Storing scene ${scene.sceneNumber} in database`);
          await query(
            `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (project_id, scene_number) DO UPDATE
             SET prompt = $3, duration = $4, start_time = $5, video_url = $6, first_frame_url = $7, last_frame_url = $8, updated_at = NOW()`,
            [
              projectId,
              scene.sceneNumber,
              scene.prompt,
              scene.duration,
              scene.startTime,
              videoUrl,
              frames.firstFrameUrl,
              frames.lastFrameUrl,
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
          sceneVideos: sceneVideos.map((url, idx) => ({ index: idx, url: url.substring(0, 100) }))
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
        sceneUrls: sceneVideos,
        frameUrls,
      };

      const configJson = JSON.stringify(updatedConfig);
      await query(
        'UPDATE projects SET status = $1, config = $2 WHERE id = $3',
        ['completed', configJson, projectId]
      );
      
      // Verify the update was successful
      const verifyProject = await queryOne(
        'SELECT config FROM projects WHERE id = $1',
        [projectId]
      );
      
      if (!verifyProject || !verifyProject.config) {
        fastify.log.error({ projectId }, 'Step 7: WARNING - Config was not saved to database');
      } else {
        fastify.log.info({ 
          projectId, 
          configSaved: !!verifyProject.config,
          hasVideoUrl: updatedConfig.videoUrl ? true : false
        }, 'Step 7: Project updated successfully');
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
      }, 'ERROR: Synchronous video generation failed');

      // Update project status to failed
      try {
        await query(
          'UPDATE projects SET status = $1 WHERE id = $2',
          ['failed', projectId]
        );
        fastify.log.info({ projectId }, 'Project status updated to "failed"');
      } catch (updateError: any) {
        fastify.log.error({ 
          err: updateError, 
          projectId 
        }, 'ERROR: Failed to update project status to "failed"');
      }

      return reply.code(500).send({
        error: 'Video generation failed',
        message: error.message || 'An error occurred during video generation',
      });
    }
  });

  // Stitch scenes together into final video
  fastify.post('/projects/:id/stitch-scenes', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Stitch scene videos together into final video',
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
  }, async (request: FastifyRequest<{ Params: { id: string }; Body?: { sceneUrls?: string[] } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { id: projectId } = request.params;
    const body = request.body || {};

    try {
      // Verify project belongs to user
      const projectData = await queryOne(
        'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
        [projectId, user.sub]
      );

      if (!projectData) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      // Use provided sceneUrls or get from database
      let sceneVideos: string[];
      if (body.sceneUrls && body.sceneUrls.length > 0) {
        sceneVideos = body.sceneUrls;
      } else {
        // Get scenes with video URLs from database
        const scenes = await query(
          `SELECT id, scene_number, video_url 
           FROM scenes 
           WHERE project_id = $1 AND video_url IS NOT NULL AND video_url != ''
           ORDER BY scene_number ASC`,
          [projectId]
        );

        if (scenes.length === 0) {
          fastify.log.warn({ projectId }, 'No scenes with video URLs found for stitching');
          return reply.code(400).send({ 
            error: 'No scenes with video URLs found',
            message: 'Please ensure all scenes have been generated and have video URLs before stitching.'
          });
        }

        sceneVideos = scenes.map(s => s.video_url).filter(Boolean) as string[];
      }
      
      if (sceneVideos.length === 0) {
        fastify.log.warn({ projectId }, 'No valid scene video URLs found after filtering');
        return reply.code(400).send({ 
          error: 'No valid scene video URLs found',
          message: 'Scene videos exist but URLs are invalid. Please regenerate scenes.'
        });
      }

      fastify.log.info({ projectId, sceneCount: sceneVideos.length }, `Found ${sceneVideos.length} scenes to stitch`);

      // Parse existing config
      const config = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});

      // Import video processing functions
      const { concatenateVideos } = await import('../services/videoProcessor');
      const { uploadGeneratedVideo } = await import('../services/storage');

      // Create temp directory
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-stitch-'));
      const concatVideoPath = path.join(tempDir, 'concat.mp4');

      // Concatenate videos
      await concatenateVideos(sceneVideos, concatVideoPath);
      fastify.log.info({ projectId }, 'Videos concatenated successfully');

      // Note: Audio is NOT automatically added during stitching
      // Audio should be added separately via the add-audio endpoint
      // This keeps stitching focused on just combining video scenes
      let finalVideoPath = concatVideoPath;

      // Upload final video
      const finalVideoBuffer = await fs.readFile(finalVideoPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        user.sub,
        projectId,
        'output.mp4'
      );
      fastify.log.info({ projectId, uploadUrl: uploadResult.url }, 'Final video uploaded successfully');

      // Update project config
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
        sceneUrls: sceneVideos,
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
        sceneCount: sceneVideos.length,
      };
    } catch (error: any) {
      fastify.log.error({ 
        err: error,
        projectId,
        errorMessage: error?.message 
      }, 'ERROR: Failed to stitch scenes');
      
      return reply.code(500).send({
        error: 'Failed to stitch scenes',
        message: error.message || 'An error occurred while stitching scenes',
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
      fastify.log.info({ projectId, videoUrl: videoUrlToDownload.substring(0, 100) }, 'Downloading video for audio merge');
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

      // Update project config
      const updatedConfig = {
        ...config,
        videoUrl: uploadResult.url,
        audioUrl: audioUrl,
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
            },
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
      const projects = await query(
        `SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );

      // Convert S3 URLs in config to presigned URLs for secure access
      const projectsWithPresignedUrls = await Promise.all(
        projects.map(async (project: any) => {
          if (project.config) {
            const config = typeof project.config === 'string' 
              ? JSON.parse(project.config) 
              : (project.config || {});
            
            // Convert videoUrl to presigned URL if it exists
            if (config.videoUrl) {
              config.videoUrl = await convertS3UrlToPresigned(config.videoUrl, 3600);
            }
            
            // Convert finalVideoUrl to presigned URL if it exists (preferred over videoUrl)
            if (config.finalVideoUrl) {
              config.finalVideoUrl = await convertS3UrlToPresigned(config.finalVideoUrl, 3600);
            }
            
            // Convert audioUrl to presigned URL if it exists
            if (config.audioUrl) {
              config.audioUrl = await convertS3UrlToPresigned(config.audioUrl, 3600);
            }
            
            project.config = config;
          }
          return project;
        })
      );

      fastify.log.info({ projectCount: projectsWithPresignedUrls.length }, 'Projects fetched successfully');
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
            category: { type: 'string' },
            prompt: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string' },
            config: { 
              type: 'object',
              additionalProperties: true,
            },
          },
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

    // Convert S3 URLs in config to presigned URLs for secure access
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
    
    // Convert videoUrl to presigned URL if it exists
    if (config.videoUrl) {
      config.videoUrl = await convertS3UrlToPresigned(config.videoUrl, 3600);
    }
    
    // Convert finalVideoUrl to presigned URL if it exists (preferred over videoUrl)
    if (config.finalVideoUrl) {
      config.finalVideoUrl = await convertS3UrlToPresigned(config.finalVideoUrl, 3600);
    }
    
    // Convert audioUrl to presigned URL if it exists
    if (config.audioUrl) {
      config.audioUrl = await convertS3UrlToPresigned(config.audioUrl, 3600);
    }
    
    // Always set config, even if it was null/undefined
    // Create a new object to ensure config is always present
    const response = {
      ...project,
      config: config, // Always include config, even if empty object
    };

    fastify.log.info({ 
      projectId: id, 
      hasConfig: !!response.config, 
      hasVideoUrl: !!config.videoUrl,
      configKeys: Object.keys(config),
      configType: typeof response.config,
      status: project.status 
    }, 'Project fetched');

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

    if (data.name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.prompt) {
      updates.push(`prompt = $${paramIndex++}`);
      values.push(data.prompt);
    }
    // Handle config updates - either full config object or individual fields
    if ((request.body as any).config) {
      // Full config update
      const newConfig = (request.body as any).config;
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(newConfig));
    } else if (data.style || data.mood || data.constraints || data.audioUrl || data.videoModelId || data.aspectRatio || data.colorPalette || data.pacing || data.imageModelId) {
      // Partial config update (merge with existing)
      const config = typeof project.config === 'string' ? JSON.parse(project.config) : (project.config || {});
      if (data.style) config.style = data.style;
      if (data.mood) config.mood = data.mood;
      if (data.constraints) config.constraints = data.constraints;
      if (data.audioUrl) config.audioUrl = data.audioUrl;
      if (data.videoModelId) config.videoModelId = data.videoModelId;
      if (data.aspectRatio) config.aspectRatio = data.aspectRatio;
      if (data.colorPalette) config.colorPalette = data.colorPalette;
      if (data.pacing) config.pacing = data.pacing;
      if (data.imageModelId) config.imageModelId = data.imageModelId;
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(config));
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

    // Verify project belongs to user
    const project = await queryOne(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [id, user.sub]
    );

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Get all scenes
    const scenes = await query(
      `SELECT id, scene_number, prompt, duration, start_time, video_url, thumbnail_url, first_frame_url, last_frame_url, created_at, updated_at
       FROM scenes
       WHERE project_id = $1
       ORDER BY scene_number ASC`,
      [id]
    );

    // Convert S3 URLs to presigned URLs for secure access
    const scenesWithPresignedUrls = await Promise.all(
      scenes.map(async (scene: any) => ({
        id: scene.id,
        sceneNumber: scene.scene_number,
        prompt: scene.prompt,
        duration: scene.duration,
        startTime: scene.start_time,
        videoUrl: await convertS3UrlToPresigned(scene.video_url, 3600),
        thumbnailUrl: await convertS3UrlToPresigned(scene.thumbnail_url, 3600),
        firstFrameUrl: await convertS3UrlToPresigned(scene.first_frame_url, 3600),
        lastFrameUrl: await convertS3UrlToPresigned(scene.last_frame_url, 3600),
        createdAt: scene.created_at,
        updatedAt: scene.updated_at,
      }))
    );

    return scenesWithPresignedUrls;
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
}
