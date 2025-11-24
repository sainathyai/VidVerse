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

  // Get job status
  fastify.get('/jobs/:jobId', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get job status with progress',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
      },
    },
  }, async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
    const user = getCognitoUser(request);
    const { jobId } = request.params;

    // Get job from database
    const { query } = await import('../services/database');
    const jobs = await query(
      `SELECT j.*, p.user_id 
       FROM jobs j
       JOIN projects p ON j.project_id = p.id
       WHERE j.id = $1 AND p.user_id = $2`,
      [jobId, user.sub]
    );

    if (!jobs || jobs.length === 0) {
      return reply.code(404).send({ 
        error: 'Job not found',
      });
    }

    const job = jobs[0];
    return {
      id: job.id,
      status: job.status,
      progress: job.progress || 0,
      current_stage: job.current_stage || '',
      cost_usd: job.cost_usd || 0,
      result: job.result,
      error: job.error,
      error_details: job.error_details,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    };
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

