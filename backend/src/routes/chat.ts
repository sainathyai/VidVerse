import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateCognito, getCognitoUser } from '../middleware/cognito';
import { config } from '../config';
import { z } from 'zod';

const chatMessageSchema = z.object({
  message: z.string().min(1).max(50000), // Increased to 50000 characters for very long messages
  projectId: z.string().uuid().optional(),
  conversationId: z.string().optional(),
  model: z.string().optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
  projectContext: z.object({
    name: z.string().optional(),
    category: z.string().optional(),
    prompt: z.string().optional(),
    style: z.string().optional(),
    mood: z.string().optional(),
    aspectRatio: z.string().optional(),
    colorPalette: z.string().optional(),
    pacing: z.string().optional(),
    duration: z.number().optional(),
  }).optional(),
  attachments: z.array(z.object({
    type: z.string(),
    url: z.string(),
    filename: z.string().optional(),
  })).optional(),
});

export async function chatRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Chat endpoint
  fastify.post('/chat', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Send a message to the AI assistant',
      tags: ['chat'],
      body: {
        type: 'object',
        required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 50000 }, // Increased to 50000 characters
            projectId: { type: 'string', format: 'uuid' },
            conversationId: { type: 'string' },
            model: { type: 'string' },
            conversationHistory: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
              },
            },
            projectContext: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                category: { type: 'string' },
                prompt: { type: 'string' },
                style: { type: 'string' },
                mood: { type: 'string' },
                aspectRatio: { type: 'string' },
                colorPalette: { type: 'string' },
                pacing: { type: 'string' },
                duration: { type: 'number' },
              },
            },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  url: { type: 'string' },
                  filename: { type: 'string' },
                },
              },
            },
          },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            response: { type: 'string' },
            conversationId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!config.openrouter.apiKey) {
      return reply.code(503).send({
        error: 'OpenRouter API key not configured',
        message: 'Please set OPENROUTER_API_KEY in your environment variables',
      });
    }

    // Validate API key format
    if (!config.openrouter.apiKey.startsWith('sk-or-v1-')) {
      fastify.log.warn('OpenRouter API key format may be incorrect. Expected format: sk-or-v1-...');
    }

    const user = getCognitoUser(request);
    const data = chatMessageSchema.parse(request.body);

    try {
      // Check if user is requesting structured project generation (concept to full project)
      const isConceptGeneration = /(generate|create|build|make).*(full|complete|entire|whole|project|script|scenes|assets|music)/i.test(data.message) || 
                                   /(concept|idea|basic).*(elaborate|expand|generate|create|build)/i.test(data.message) ||
                                   /(import|json|structured|format)/i.test(data.message) ||
                                   /(need|want|create).*(ad|video|commercial|promo).*(for|about)/i.test(data.message);

      // Get project duration first to calculate scene count (needed for system prompt)
      let projectDuration = 60; // Default
      if (data.projectId) {
        const { query } = await import('../services/database');
        const projects = await query(
          'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
          [data.projectId, user.sub]
        );
        if (projects.length > 0) {
          const projectConfig = typeof projects[0].config === 'string' 
            ? JSON.parse(projects[0].config) 
            : (projects[0].config || {});
          projectDuration = projectConfig.duration || 60;
        }
      } else if (data.projectContext) {
        projectDuration = data.projectContext.duration || 60;
      }

      // Calculate scene count based on duration
      let targetSceneCount = 5; // Default
      if (projectDuration <= 30) {
        targetSceneCount = 3;
      } else if (projectDuration <= 60) {
        targetSceneCount = 5;
      } else {
        targetSceneCount = 8;
      }

      // Build system prompt with project context if available
      // Use template literal with calculated values
      let systemPrompt = isConceptGeneration 
        ? `You are an expert AI video creation assistant specializing in generating complete, structured video projects from basic concepts. 

When a user provides a basic concept (2-3 lines), you must generate a COMPLETE structured project in JSON format that includes:

1. **Detailed Script**: A comprehensive, detailed script that elaborates on the concept with rich visual descriptions, camera movements, transitions, and narrative flow. The script must establish a CONSISTENT THEME and CAMERA STYLE that will be maintained across all scenes.

2. **Assets Array**: Extract all key visual assets mentioned in the script. Each asset should have:
   - name: A descriptive name (e.g., "Vintage Tour Bus", "Desert Highway", "Lead Character Portrait")
   - prompt: A detailed prompt for generating that asset as an image
   - category: Asset type - one of: "character", "environment", "prop", "style-reference", "ambience"
   - CRITICAL: Generate a maximum of 5 assets. Prioritize the most important visual elements.
   - CRITICAL: LEAD CHARACTERS must be included in Scene 1. Generate lead character assets (main character portraits, key personas) and ensure they are assigned to Scene 1 in the sceneAssetMap. Do not delay character introductions - they must appear in the first scene.
   - IMPORTANT: When generating assets, prioritize LEAD CHARACTERS when applicable (e.g., main character portraits, key personas). For products like sunglasses, generate only ONE pair of glasses asset, not multiple variations. Focus on unique, distinct assets rather than duplicates.
   - Track which assets appear in multiple scenes - prioritize generating assets with higher usage across scenes

3. **Scenes Array**: Break the script into logical scenes. Each scene should have:
   - sceneNumber: Sequential number (1, 2, 3, etc.)
   - prompt: EXTENSIVE scene description with visual specifications (MINIMUM 400-600 characters per scene)
   - assetIds: Array of asset names/IDs that belong to this scene (matching asset names from assets array). BE CONSERVATIVE: Only include assets that are ACTUALLY needed and visible in this specific scene. Do NOT try to use all assets in every scene - only reference assets when they are essential to the scene's story or visual requirements. It's better to have fewer assets per scene than to overload a scene with too many asset references.
   - transitionNotes: Brief description of how this scene connects to the previous one (maintains continuity, lighting transitions, camera movement, etc.)
   - CRITICAL SCENE PLANNING: Each scene must be MAXIMUM 8 seconds long. Calculate the number of scenes needed: ${projectDuration} seconds ÷ 8 seconds per scene = ${Math.ceil(projectDuration / 8)} scenes minimum. Generate ${targetSceneCount} scenes based on the project duration (${projectDuration} seconds). For short videos (≤30s), use 3-4 scenes. For medium videos (31-60s), use 5-8 scenes. For long videos (>60s), use 8-15 scenes. Each scene duration must be ≤ 8 seconds.
   - CRITICAL: Scene 1 MUST introduce all lead/main characters immediately. Do not delay character introductions to later scenes - introduce them in the first scene to establish the story quickly and avoid slow pacing. Lead characters should appear and be established in Scene 1.
   - CONSISTENCY REQUIREMENTS: All scenes must maintain:
     * The same visual theme and aesthetic style
     * Consistent camera style (e.g., if using "cinematic wide shots", maintain that style throughout)
     * Consistent color palette and lighting approach
     * Consistent character appearances (if characters are present)
     * Smooth visual transitions between scenes
   - SCENE PROMPT DETAILS: Each scene prompt must be 400-600+ characters with PRIMARY focus on:
     * PRIMARY: Story progression, narrative flow, concept, and emotional beats
     * PRIMARY: What happens in the scene, actions, and story elements
     * SECONDARY: Visual consistency, ambience, and continuity (achieved primarily through asset references)
     * SECONDARY: Camera angle, movement, and framing
     * SECONDARY: Lighting conditions and mood
     * SECONDARY: Environmental details and setting
     * CRITICAL: Do NOT re-describe character appearances in detail - reference the asset by name instead (e.g., "using [Asset Name]" or "featuring the character from [Asset Name]")
     * CRITICAL: Character consistency is handled by the assets - focus scene description on story, not character appearance details
     * CRITICAL: BE CONSERVATIVE with asset references - only reference assets when they are essential to the scene. Do NOT try to include all assets in every scene. Each scene should only reference the minimum number of assets needed for that specific scene's story and visual requirements. Too many asset references in a single scene can make it difficult to properly incorporate them all.

4. **Music Prompt**: Generate a JSON-formatted music prompt with:
   - lyrics: ACTUAL song lyrics (10-600 characters, minimum 10 characters required). Lyrics can be multi-line using newline characters (\\n) to separate lines. Supports special markers: [Intro], [Verse], [Chorus], [Bridge], [Outro] to structure the lyrics. If the music prompt indicates "no lyrics", "subtle lyrics", "instrumental", or similar, generate appropriate subtle, minimal, non-intrusive vocalizations that match the music style (e.g., for orchestral: "Ah", "Ooh", gentle humming; for jazz: "La la la", "Mm hmm", soft scatting; for ambient: "Hmm", "Ah", breathy textures). DO NOT use random repeated characters like "oooooo" or meaningless text. The vocalizations should be musically appropriate, minimal (10-50 characters typically), and blend seamlessly with the instrumental music. DO NOT put music descriptions, instrumental descriptions, or style descriptions here - those belong in the "prompt" field. For instrumental music, always use appropriate subtle vocalizations (at least 10 characters) rather than leaving empty or using random characters.
   - prompt: Musical style description INCLUDING duration in seconds (e.g., "Romantic French Café Jazz, Acoustic Guitar, Soft Accordion, Ambient, Dreamy, Warm, 60 seconds" or "Electronic, Upbeat, Energetic, 30 seconds"). The prompt must include the duration at the end (e.g., "${projectDuration} seconds") to match the total video duration of ${projectDuration} seconds. This is where you describe the musical style, instruments, mood, and atmosphere.
   - bitrate: "320" (default)
   - sample_rate: "44100" (default)
   - audio_format: "mp3" (default)
   - CRITICAL: The prompt field must include the musical style/genre description AND the duration in seconds at the end (e.g., "Jazz, Smooth Jazz, Romantic, Dreamy, ${projectDuration} seconds"). Do NOT include a separate duration field - duration must be part of the prompt text.

CRITICAL FORMATTING REQUIREMENTS:
- Your response must be in PLAIN TEXT format for user readability
- But it MUST contain a valid JSON object that can be extracted and parsed
- The JSON should be wrapped in \`\`\`json code blocks for easy extraction
- The JSON structure must be:
{
  "script": "Full detailed script text here...",
  "globalStyle": {
    "colorPalette": "Description of overall color scheme (e.g., 'warm earth tones', 'cool blues and grays')",
    "lighting": "Overall lighting mood (e.g., 'golden hour', 'soft natural light', 'dramatic shadows')",
    "cameraStyle": "Overall camera approach (e.g., 'cinematic wide shots', 'handheld documentary style', 'smooth tracking shots')",
    "visualAesthetic": "Overall visual style description (e.g., 'modern minimalist', 'vintage film', 'high-tech futuristic')"
  },
  "assets": [
    {
      "name": "Asset Name 1",
      "prompt": "Detailed prompt for generating this asset...",
      "category": "character"
    },
    ...
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "EXTENSIVE scene description (400-600+ characters) focusing on story/concept first, then visual consistency and ambience...",
      "assetIds": ["Asset Name 1", "Asset Name 2"],
      "transitionNotes": "How this scene connects to previous (if scene 1, describe opening style)"
    },
    ...
  ],
  "sceneAssetMap": {
    "1": [1, 2],
    "2": [3],
    ...
  },
  "assetUsage": {
    "Asset Name 1": 4,
    "Asset Name 2": 2,
    ...
  },
  "sceneDependencies": {
    "1": ["Asset Name 1", "Asset Name 2"],
    "2": ["Asset Name 1", "Asset Name 3"],
    ...
  },
  "music": {
    "lyrics": "Actual song lyrics or subtle vocalizations (10-600 characters, minimum 10 required). Can be multi-line using newline characters to separate lines. Supports markers: [Intro], [Verse], [Chorus], [Bridge], [Outro]. For instrumental music or when prompt indicates 'no lyrics'/'subtle lyrics', use musically appropriate minimal vocalizations (e.g., orchestral: 'Ah', 'Ooh'; jazz: 'La la la', 'Mm hmm'; ambient: 'Hmm', breathy textures). DO NOT use random repeated characters. Must be musically appropriate and blend with the music style.",
    "prompt": "Musical style description INCLUDING duration (e.g., 'Jazz, Smooth Jazz, Romantic, Dreamy, ${projectDuration} seconds')",
    "bitrate": "320",
    "sample_rate": "44100",
    "audio_format": "mp3"
  }
}

- Include EXTENSIVE details in each scene prompt (400-600+ characters minimum)
- Scene prompts should focus PRIMARILY on story, concept, and narrative flow
- Visual consistency, ambience, and character consistency are SECONDARY and achieved through asset references
- Do NOT re-describe character appearances in scene prompts - reference assets by name instead
- Include a "globalStyle" object with overall color palette, lighting, camera style, and visual aesthetic (scenes reference this)
- Include a "sceneAssetMap" object mapping scene numbers (as strings) to arrays of asset numbers (as integers, 1-based index matching the asset's position in the assets array) for easy import to checkboxes (e.g., {"1": [1, 2], "2": [3]})
- Include an "assetUsage" object showing how many scenes each asset appears in (helps prioritize asset generation)
- Include a "sceneDependencies" object mapping scene numbers to their required asset names (validates asset references)
- Each scene should include "transitionNotes" describing how it connects to the previous scene (maintains continuity)
- Each asset should include a "category" field: "character", "environment", "prop", "style-reference", or "ambience"
- Establish and maintain consistent theme, camera style, and visual aesthetic across ALL scenes (via globalStyle and assets)
- Determine which assets belong to which scenes based on the script - BE CONSERVATIVE: only assign assets to scenes where they are actually needed and visible. Do NOT try to use all assets in every scene.
- Track asset usage frequency - prioritize generating assets that appear in multiple scenes, but remember that not every asset needs to appear in every scene
- Make the script comprehensive and cinematic
- Ensure all prompts are detailed enough for AI video/image generation

After generating the JSON, provide a brief summary in plain text explaining what was generated.

IMPORTANT CONSTRAINTS:
- Generate a maximum of 5 assets (prioritize the most important visual elements, especially lead characters when applicable)
- For products like sunglasses, generate only ONE pair, not multiple variations
- Generate ${targetSceneCount} scenes based on the project duration (${projectDuration} seconds)
- Each scene must be MAXIMUM 8 seconds long (plan accordingly: ${projectDuration}s ÷ 8s = ${Math.ceil(projectDuration / 8)} scenes minimum)
- Each scene prompt must be 400-600+ characters focusing PRIMARILY on story/concept, SECONDARILY on visual consistency
- Do NOT re-describe character appearances in scenes - reference assets by name instead (character consistency handled by assets)
- ALL scenes must maintain consistent theme, camera style, color palette, and visual aesthetic (achieved through globalStyle object and asset references)
- Map assets to scenes conservatively - only assign assets to scenes where they are actually needed and visible. Do NOT try to include all assets in every scene. Each scene should only reference the minimum number of assets required for that scene's story and visual needs.
- Include "globalStyle" object with overall visual style (color palette, lighting, camera style, visual aesthetic)
- Include "sceneAssetMap" in JSON output mapping scene numbers (as strings) to arrays of asset numbers (as integers, 1-based index matching the asset's position in the assets array) for easy import to checkboxes (e.g., {"1": [1, 2], "2": [3]})
- Include "assetUsage" object showing frequency of each asset across scenes (e.g., {"Asset Name 1": 4, "Asset Name 2": 2})
- Include "sceneDependencies" object mapping each scene to its required assets (validates all asset references exist)
- Include "transitionNotes" in each scene describing continuity with previous scene
- Include "category" field in each asset: "character", "environment", "prop", "style-reference", or "ambience"
- Music prompt field must include the musical style/genre AND duration in seconds at the end (e.g., "Jazz, Smooth Jazz, Romantic, Dreamy, ${projectDuration} seconds" or "Electronic, Upbeat, Energetic, ${projectDuration} seconds"). The duration must be included in the prompt text, not as a separate field. The music should be approximately ${projectDuration} seconds long.
- CRITICAL: The "lyrics" field must contain ONLY actual song lyrics or subtle vocalizations (minimum 10 characters required). Lyrics can be multi-line using newline characters to separate lines and support special markers: [Intro], [Verse], [Chorus], [Bridge], [Outro] to structure the lyrics. When the music prompt indicates "no lyrics", "subtle lyrics", "instrumental", or similar, generate musically appropriate subtle vocalizations that match the music style (e.g., orchestral: "Ah", "Ooh"; jazz: "La la la", "Mm hmm"; ambient: "Hmm", breathy textures). DO NOT use random repeated characters like "oooooo" or meaningless text - the vocalizations must be musically appropriate and minimal (typically 10-50 characters). The vocalizations should blend seamlessly with the instrumental music. DO NOT put music style descriptions, instrumental descriptions, or atmosphere descriptions in the lyrics field - those belong in the "prompt" field.`
        : `You are an expert AI video creation assistant helping users craft exceptional video projects. Your role is to:

1. **Context Awareness**: 
   - You have access to the user's current project settings and conversation history
   - NEVER ask questions about information you already know from the context
   - Reference what the user has already told you or what's in their project settings
   - If the user has specified mood, style, category, or other settings, acknowledge and use them
   - Build on existing information rather than asking for it again

2. **Ask Insightful Clarifying Questions**: 
   - Only ask questions about information you DON'T already have
   - Ask thoughtful, specific questions that show you value their input
   - Avoid repetitive questions - check conversation history first
   - If you've already asked about something, don't ask again unless the user's answer was unclear

3. **Make Users Feel Valued**: 
   - Acknowledge their ideas and preferences enthusiastically
   - Build on their suggestions rather than replacing them
   - Show genuine interest in their vision
   - Use phrases like "That's a great idea!", "I love that direction!", "Your vision is clear and compelling!"
   - Reference their existing choices: "I see you've chosen [mood/style] - that's perfect for..."

4. **Steer Toward Great Output**:
   - Gradually refine and enhance their ideas through conversation
   - Offer creative suggestions that align with their preferences
   - Help them think through details they might not have considered
   - Guide them toward a comprehensive, detailed prompt/script

5. **Conversation Flow**:
   - Review conversation history to avoid repeating questions
   - If you have enough context, move forward with suggestions rather than asking more questions
   - As you understand their vision, begin synthesizing their ideas
   - Present a draft prompt/script and ask for their feedback
   - Iterate based on their preferences until they're satisfied

6. **Final Output Format**:
   - When the user is ready, provide a comprehensive video prompt/script
   - Format it clearly and professionally
   - Include all the details discussed: visual elements, style, mood, pacing, transitions, etc.
   - Make it ready for AI video generation

CRITICAL: Review the conversation history and project context before asking any questions. Do NOT ask about information that has already been provided.`;

      // Build project context from either projectId (existing project) or projectContext (new project)
      let projectContextText = '';
      
      if (data.projectId) {
        // Fetch project details for context
        const { query } = await import('../services/database');
        const projects = await query(
          'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
          [data.projectId, user.sub]
        );

        if (projects.length > 0) {
          const project = projects[0];
          const projectConfig = typeof project.config === 'string' 
            ? JSON.parse(project.config) 
            : (project.config || {});

          projectContextText = `\n\nCurrent Project Context:
- Name: ${project.name || 'Untitled'}
- Category: ${project.category}
- Prompt: ${project.prompt}
- Duration: ${projectDuration} seconds
- Style: ${projectConfig.style || 'Not specified'}
- Mood: ${projectConfig.mood || 'Not specified'}
- Aspect Ratio: ${projectConfig.aspectRatio || 'Not specified'}
- Color Palette: ${projectConfig.colorPalette || 'Not specified'}
- Pacing: ${projectConfig.pacing || 'Not specified'}
- Constraints: ${projectConfig.constraints || 'None'}`;
        }
      } else if (data.projectContext) {
        // Use provided project context (for new projects)
        const ctx = data.projectContext;
        
        projectContextText = `\n\nCurrent Project Context:
- Name: ${ctx.name || 'Untitled'}
- Category: ${ctx.category || 'Not specified'}
- Prompt: ${ctx.prompt || 'Not specified'}
- Duration: ${projectDuration} seconds
- Style: ${ctx.style || 'Not specified'}
- Mood: ${ctx.mood || 'Not specified'}
- Aspect Ratio: ${ctx.aspectRatio || 'Not specified'}
- Color Palette: ${ctx.colorPalette || 'Not specified'}
- Pacing: ${ctx.pacing || 'Not specified'}`;
      }
      
      if (projectContextText) {
        systemPrompt += projectContextText;
      }

      // Build messages array with conversation history
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
      ];

      // Add conversation history if provided (for context awareness)
      if (data.conversationHistory && data.conversationHistory.length > 0) {
        // Add previous conversation messages (excluding the current one)
        data.conversationHistory.forEach((msg) => {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        });
      }

      // Add current user message
      messages.push({ role: 'user', content: data.message });

      // Call OpenRouter API with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout for large AI responses

      let openrouterResponse;
      try {
        openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.openrouter.apiKey}`,
            'HTTP-Referer': config.app.frontendUrl || 'https://vidverseai.com',
            'X-Title': 'VidVerse AI Assistant',
          },
          body: JSON.stringify({
            model: data.model || config.openrouter.model || 'anthropic/claude-4.5-sonnet',
            messages: messages,
            temperature: 0.8, // Slightly higher for more creative and conversational responses
            max_tokens: 16000, // Dramatically increased for very long, detailed responses
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError' || fetchError.message?.includes('timeout') || fetchError.message?.includes('Timeout')) {
          fastify.log.error({ error: fetchError.message }, 'OpenRouter API request timeout');
          return reply.code(504).send({
            error: 'Request timeout',
            message: 'The AI service took too long to respond. Please try again with a shorter message or try again later.',
          });
        }
        // Handle connection errors
        if (fetchError.message?.includes('ECONNREFUSED') || fetchError.message?.includes('ENOTFOUND') || fetchError.message?.includes('Connect Timeout')) {
          fastify.log.error({ error: fetchError.message }, 'OpenRouter API connection error');
          return reply.code(503).send({
            error: 'Connection error',
            message: 'Unable to connect to the AI service. Please check your internet connection and try again.',
          });
        }
        // Re-throw other errors
        throw fetchError;
      }

      if (!openrouterResponse.ok) {
        const errorText = await openrouterResponse.text();
        let errorMessage = 'The AI service is temporarily unavailable. Please try again.';
        let statusCode = 502;
        
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
            // If it's an authentication error, provide more helpful message
            if (openrouterResponse.status === 401) {
              errorMessage = 'OpenRouter API key is invalid or expired. Please check your OPENROUTER_API_KEY in the backend .env file and ensure it is valid.';
              statusCode = 503; // Service unavailable due to configuration
            }
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // If parsing fails, use default message
          if (openrouterResponse.status === 401) {
            errorMessage = 'OpenRouter API key is invalid or expired. Please check your OPENROUTER_API_KEY in the backend .env file.';
            statusCode = 503;
          }
        }
        
        fastify.log.error({ 
          status: openrouterResponse.status,
          statusText: openrouterResponse.statusText,
          error: errorText,
          apiKeyPrefix: config.openrouter.apiKey?.substring(0, 10) + '...' // Log only prefix for security
        }, 'OpenRouter API error');
        
        return reply.code(statusCode).send({
          error: 'Failed to get AI response',
          message: errorMessage,
        });
      }

      const openrouterData = await openrouterResponse.json();

      if (!openrouterData.choices || !openrouterData.choices[0]) {
        return reply.code(502).send({
          error: 'Invalid response from AI service',
        });
      }

      const aiResponse = openrouterData.choices[0].message.content;

      return {
        response: aiResponse,
        conversationId: data.conversationId || `conv-${Date.now()}`,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Chat error');
      return reply.code(500).send({
        error: 'Internal server error',
        message: error.message || 'Failed to process chat message',
      });
    }
  });
}

