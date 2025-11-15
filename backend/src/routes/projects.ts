import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { getCognitoUser, authenticateCognito } from '../middleware/cognito';

const createProjectSchema = z.object({
  category: z.enum(['music_video', 'ad_creative', 'explainer']),
  prompt: z.string().min(10).max(1000),
  duration: z.number().min(15).max(300),
  style: z.string().optional(),
  mood: z.string().optional(),
  constraints: z.string().optional(),
  mode: z.enum(['classic', 'agentic']).default('classic'),
  audioUrl: z.string().url().optional(), // Store uploaded audio URL
});

const updateProjectSchema = createProjectSchema.partial();

// In-memory store for demo (replace with database in production)
const projectsStore: Map<string, any> = new Map();

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
          category: { type: 'string', enum: ['music_video', 'ad_creative', 'explainer'] },
          prompt: { type: 'string', minLength: 10, maxLength: 1000 },
          duration: { type: 'number', minimum: 15, maximum: 300 },
          style: { type: 'string' },
          mood: { type: 'string' },
          constraints: { type: 'string' },
          mode: { type: 'string', enum: ['classic', 'agentic'], default: 'classic' },
          audioUrl: { type: 'string' },
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

    const project = {
      id: crypto.randomUUID(),
      user_id: userId,
      ...data,
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Store in memory (replace with database)
    projectsStore.set(project.id, project);

    // TODO: If audioUrl provided, create asset record in database
    if (data.audioUrl) {
      // In production: await db.assets.create({ project_id: project.id, type: 'audio', url: data.audioUrl })
      fastify.log.info(`Asset created for project ${project.id}: ${data.audioUrl}`);
    }

    return reply.code(201).send(project);
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
    const user = getCognitoUser(request);
    const userId = user.sub;

    // Get all projects for user (in production: query database)
    const projects = Array.from(projectsStore.values())
      .filter((p: any) => p.user_id === userId)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return projects;
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
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const project = projectsStore.get(id);

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    return project;
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
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateProjectSchema.parse(request.body);

    const project = projectsStore.get(id);

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const updated = {
      ...project,
      ...data,
      updated_at: new Date().toISOString(),
    };

    projectsStore.set(id, updated);

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
          id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const project = projectsStore.get(id);

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    projectsStore.delete(id);

    return reply.code(204).send();
  });
}
