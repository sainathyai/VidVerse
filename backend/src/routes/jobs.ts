import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getCognitoUser, authenticateCognito } from '../middleware/cognito';

const generateVideoSchema = z.object({
  projectId: z.string().uuid(),
});

export async function jobRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Start video generation job
  fastify.post('/jobs/generate-video', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Start video generation for a project',
      tags: ['jobs'],
      body: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: { projectId: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { projectId } = request.body;

    // Verify project belongs to user
    const { query } = await import('../services/database');
    const project = await query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!project || project.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const projectData = project[0];

    // Redirect to synchronous generation endpoint
    // Job queue is disabled - use direct synchronous generation instead
    return reply.code(307).redirect(`/api/projects/${projectId}/generate-sync`);
  });

  // Get job status - deprecated, use project status instead
  fastify.get('/jobs/:jobId', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get job status (deprecated - use project status instead)',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
    // Job queue is disabled - return not found
    return reply.code(404).send({ 
      error: 'Job not found',
      message: 'Job queue is disabled. Check project status directly from /api/projects/:id',
    });
  });

  // Get jobs for a project
  fastify.get('/projects/:projectId/jobs', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get all jobs for a project',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { projectId } = request.params;

    // Verify project belongs to user
    const { query } = await import('../services/database');
    const project = await query(
      'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!project || project.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Job queue is disabled - get jobs from database if they exist
    const dbJobs = await query(
      'SELECT * FROM jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100',
      [projectId]
    );

    const jobsWithStatus = dbJobs.map((job: any) => ({
      id: job.id,
      status: job.status,
      progress: job.progress || 0,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
    }));

    return { jobs: jobsWithStatus };
  });
}

