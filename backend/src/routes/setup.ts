import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function setupRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Stub endpoints for setup routes (to prevent 500 errors from non-existent SetupProgress component)
  fastify.get('/setup/components', {
    schema: {
      description: 'Setup components endpoint (stub)',
      tags: ['setup'],
      response: {
        200: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    // Return empty array to prevent errors
    return [];
  });

  fastify.get('/setup/progress', {
    schema: {
      description: 'Setup progress endpoint (stub)',
      tags: ['setup'],
      response: {
        200: {
          type: 'object',
          properties: {
            completed: { type: 'boolean' },
            progress: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Return completed status to prevent errors
    return {
      completed: true,
      progress: 100,
    };
  });
}

