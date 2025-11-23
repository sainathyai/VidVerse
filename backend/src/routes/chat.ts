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
   - CRITICAL: Generate EXACTLY 3 to 5 assets (no more, no less). Prioritize the most important visual elements.
   - IMPORTANT: When generating assets, prioritize LEAD CHARACTERS when applicable (e.g., main character portraits, key personas). For products like sunglasses, generate only ONE pair of glasses asset, not multiple variations. Focus on unique, distinct assets rather than duplicates.

3. **Scenes Array**: Break the script into logical scenes. Each scene should have:
   - sceneNumber: Sequential number (1, 2, 3, etc.)
   - prompt: EXTENSIVE scene description with visual specifications (MINIMUM 400-600 characters per scene)
   - assetIds: Array of asset names/IDs that belong to this scene (matching asset names from assets array)
   - CRITICAL SCENE PLANNING: Each scene must be MAXIMUM 8 seconds long. Calculate the number of scenes needed: ${projectDuration} seconds ÷ 8 seconds per scene = ${Math.ceil(projectDuration / 8)} scenes minimum. Generate ${targetSceneCount} scenes based on the project duration (${projectDuration} seconds). For short videos (≤30s), use 3-4 scenes. For medium videos (31-60s), use 5-8 scenes. For long videos (>60s), use 8-15 scenes. Each scene duration must be ≤ 8 seconds.
   - CONSISTENCY REQUIREMENTS: All scenes must maintain:
     * The same visual theme and aesthetic style
     * Consistent camera style (e.g., if using "cinematic wide shots", maintain that style throughout)
     * Consistent color palette and lighting approach
     * Consistent character appearances (if characters are present)
     * Smooth visual transitions between scenes
   - SCENE PROMPT DETAILS: Each scene prompt must be 400-600+ characters and include:
     * Detailed visual description of the scene
     * Specific camera angle, movement, and framing
     * Lighting conditions and mood
     * Color palette and visual style
     * Character positioning and actions (if applicable)
     * Environmental details and setting
     * Reference to maintaining consistency with previous scenes

4. **Music Prompt**: Generate a JSON-formatted music prompt with:
   - lyrics: Song lyrics or description (10-600 characters, if applicable)
   - prompt: Musical style description ONLY (10-300 characters, keep it short and focused on style like "Jazz, Smooth Jazz, Romantic, Dreamy" or "Electronic, Upbeat, Energetic")
   - bitrate: "320" (default)
   - sample_rate: "44100" (default)
   - audio_format: "mp3" (default)
   - CRITICAL: The prompt field must be 10-300 characters and contain ONLY the musical style/genre description. Do NOT include lyrics, descriptions, or explanations in the prompt field.

CRITICAL FORMATTING REQUIREMENTS:
- Your response must be in PLAIN TEXT format for user readability
- But it MUST contain a valid JSON object that can be extracted and parsed
- The JSON should be wrapped in \`\`\`json code blocks for easy extraction
- The JSON structure must be:
{
  "script": "Full detailed script text here...",
  "assets": [
    {
      "name": "Asset Name 1",
      "prompt": "Detailed prompt for generating this asset..."
    },
    ...
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "EXTENSIVE scene description (400-600+ characters) with visual specifications, camera style, lighting, and consistency notes...",
      "assetIds": ["Asset Name 1", "Asset Name 2"]
    },
    ...
  ],
  "music": {
    "lyrics": "Song lyrics or description (10-600 characters)",
    "prompt": "Musical style description ONLY (10-300 characters, e.g., 'Jazz, Smooth Jazz, Romantic, Dreamy')",
    "bitrate": "320",
    "sample_rate": "44100",
    "audio_format": "mp3"
  }
}

- Include EXTENSIVE details in each scene prompt (400-600+ characters minimum)
- Establish and maintain consistent theme, camera style, and visual aesthetic across ALL scenes
- Determine which assets belong to which scenes based on the script
- Make the script comprehensive and cinematic
- Ensure all prompts are detailed enough for AI video/image generation

After generating the JSON, provide a brief summary in plain text explaining what was generated.

IMPORTANT CONSTRAINTS:
- Generate EXACTLY 3 to 5 assets (prioritize the most important visual elements, especially lead characters when applicable)
- For products like sunglasses, generate only ONE pair, not multiple variations
- Generate ${targetSceneCount} scenes based on the project duration (${projectDuration} seconds)
- Each scene must be MAXIMUM 8 seconds long (plan accordingly: ${projectDuration}s ÷ 8s = ${Math.ceil(projectDuration / 8)} scenes minimum)
- Each scene prompt must be 400-600+ characters with extensive visual details
- ALL scenes must maintain consistent theme, camera style, color palette, and visual aesthetic
- Map assets to scenes based on which assets appear in each scene
- Music prompt field must be 10-300 characters and contain ONLY the musical style/genre (e.g., "Jazz, Smooth Jazz, Romantic, Dreamy" or "Electronic, Upbeat, Energetic"). Do NOT include lyrics, descriptions, or explanations in the prompt field. Keep it short and style-focused only.`
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

      // Call OpenRouter API
      const openrouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      });

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

