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
      // Check if OpenRouter API key is configured
      const { config: appConfig } = await import('../config');
      if (!appConfig.openrouter.apiKey) {
        return reply.code(503).send({
          error: 'OpenRouter API key not configured',
          message: 'Please set OPENROUTER_API_KEY in your environment variables',
        });
      }

      const duration = config.duration || 60;
      const videoDuration = duration; // Duration in seconds

      // Build comprehensive prompt for elaborate script generation
      const systemPrompt = `You are an expert video script writer specializing in creating highly detailed, elaborate video scripts for AI video generation. Your task is to create an extremely detailed script with approximately 10,000 words that breaks down a video concept into multiple scenes with rich, vivid descriptions.

CRITICAL REQUIREMENTS:
1. Generate approximately 10,000 words of detailed script content
2. Break the video into multiple scenes (typically 5-10 scenes for a ${videoDuration}-second video)
3. Each scene must have:
   - Detailed visual descriptions (camera angles, movements, lighting, composition)
   - Specific visual elements, colors, textures, and details
   - Precise timing (startTime and endTime in seconds)
   - Scene duration that adds up to the total video duration
   - Elaborate prompt descriptions suitable for AI video generation
4. Include overall creative direction, mood, style, and pacing
5. Output MUST be valid JSON format matching the exact structure specified below

OUTPUT FORMAT (JSON):
{
  "overallPrompt": "The original user prompt",
  "parsedPrompt": {
    "style": "Detailed style description",
    "mood": "Detailed mood description",
    "duration": ${videoDuration},
    "keywords": ["keyword1", "keyword2", ...]
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "Extremely detailed, elaborate scene description (500-2000 words) with specific visual details, camera movements, lighting, colors, textures, composition, and all visual elements needed for AI video generation",
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
- Be creative, vivid, and specific in your descriptions
- Focus on visual details that will help AI video generation models create stunning visuals`;

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

Generate an elaborate script with approximately 10,000 words, breaking this into multiple detailed scenes. Each scene should have rich, vivid descriptions perfect for AI video generation. Include specific details about camera movements, lighting, colors, textures, composition, and all visual elements.`;

      // Call OpenRouter API with Claude Sonnet 4.5
      const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
          temperature: 0.8,
          max_tokens: 16000, // Allow for 10,000+ word responses
        }),
      });

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

      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      let scriptJson: any;
      try {
        // Try to parse as-is first
        scriptJson = JSON.parse(aiResponse);
      } catch (parseError) {
        // Try to extract JSON from markdown code blocks
        const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            scriptJson = JSON.parse(jsonMatch[1]);
          } catch (e) {
            // If still fails, try to find JSON object in the text
            const jsonObjectMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonObjectMatch) {
              scriptJson = JSON.parse(jsonObjectMatch[0]);
            } else {
              throw new Error('Could not extract JSON from AI response');
            }
          }
        } else {
          throw parseError;
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

      // Return the script
      return {
        script: JSON.stringify(scriptJson, null, 2),
        scenes: scenes,
      };
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
    fastify.log.info({ projectId, userId: user.sub }, 'Starting synchronous video generation');

    try {
      // Update project status to generating
      fastify.log.info({ projectId }, 'Step 0: Updating project status to "generating"');
      await query(
        'UPDATE projects SET status = $1 WHERE id = $2',
        ['generating', projectId]
      );
      fastify.log.info({ projectId }, 'Step 0: Project status updated successfully');

      // 1. Parse prompt
      fastify.log.info({ projectId, promptLength: projectData.prompt?.length || 0 }, 'Step 1: Parsing prompt');
      const parsedPrompt = parsePrompt(projectData.prompt, config.duration || 60);
      if (config.style) parsedPrompt.style = config.style;
      if (config.mood) parsedPrompt.mood = config.mood;
      fastify.log.info({ 
        projectId, 
        parsedStyle: parsedPrompt.style,
        parsedMood: parsedPrompt.mood,
        keywordsCount: parsedPrompt.keywords?.length || 0,
      }, 'Step 1: Prompt parsed successfully');

      // 2. Plan scenes
      fastify.log.info({ projectId, duration: config.duration || 60 }, 'Step 2: Planning scenes');
      const scenes = planScenes(projectData.prompt, parsedPrompt, config.duration || 60);
      fastify.log.info({ 
        projectId, 
        sceneCount: scenes.length,
        scenes: scenes.map(s => ({ 
          number: s.sceneNumber, 
          duration: s.duration, 
          promptLength: s.prompt?.length || 0 
        })),
      }, 'Step 2: Scenes planned successfully');

      // 3. Generate videos for each scene
      fastify.log.info({ projectId, totalScenes: scenes.length }, 'Step 3: Starting video generation for all scenes');
      const sceneVideos: string[] = [];
      const frameUrls: { first: string; last: string }[] = [];

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
        }, `Step 3.${i + 1}: Generating video for scene ${scene.sceneNumber}/${scenes.length} with unique prompt`);

        try {
          // Generate video for scene with user's selected video model and aspect ratio
          const result = await generateVideo({
            prompt: scene.prompt,
            duration: scene.duration,
            videoModelId: config.videoModelId || 'google/veo-3.1', // Pass user's selected video model
            aspectRatio: config.aspectRatio || '16:9', // Pass aspect ratio (default to 16:9 landscape)
          });

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
    } else if (data.style || data.mood || data.constraints || data.audioUrl) {
      // Partial config update (merge with existing)
      const config = typeof project.config === 'string' ? JSON.parse(project.config) : (project.config || {});
      if (data.style) config.style = data.style;
      if (data.mood) config.mood = data.mood;
      if (data.constraints) config.constraints = data.constraints;
      if (data.audioUrl) config.audioUrl = data.audioUrl;
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
