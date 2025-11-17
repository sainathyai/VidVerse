import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateCognito, getCognitoUser } from '../middleware/cognito';
import { config } from '../config';
import { z } from 'zod';

const chatMessageSchema = z.object({
  message: z.string().min(1).max(5000),
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
            message: { type: 'string', minLength: 1, maxLength: 5000 },
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
      // Build system prompt with project context if available
      let systemPrompt = `You are an expert AI video creation assistant helping users craft exceptional video projects. Your role is to:

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
- Duration: ${projectConfig.duration || 60} seconds
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
- Duration: ${ctx.duration || 60} seconds
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
          model: data.model || config.openrouter.model || 'openai/gpt-4o-mini',
          messages: messages,
          temperature: 0.8, // Slightly higher for more creative and conversational responses
          max_tokens: 2500, // Increased for longer, more detailed responses
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

