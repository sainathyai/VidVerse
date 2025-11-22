import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { generateUploadUrl, uploadFile, generateDownloadUrl } from '../services/storage';
import { getCognitoUser } from '../middleware/cognito';
import { authenticateCognito } from '../middleware/cognito';
import { z } from 'zod';

const uploadRequestSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  type: z.enum(['audio', 'image', 'video', 'frame', 'brand_kit']),
  projectId: z.string().optional(),
});

export async function assetRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Generate presigned URL for upload
  fastify.post('/assets/upload-url', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get a presigned URL for uploading a file',
      tags: ['assets'],
      body: {
        type: 'object',
        required: ['filename', 'contentType', 'type'],
        properties: {
          filename: { type: 'string' },
          contentType: { type: 'string' },
          type: { type: 'string', enum: ['audio', 'image', 'video', 'brand_kit'] },
          folder: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            uploadUrl: { type: 'string' },
            key: { type: 'string' },
            publicUrl: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const data = uploadRequestSchema.parse(request.body);
    const user = getCognitoUser(request);

    const result = await generateUploadUrl(
      user.sub,
      data.type,
      data.contentType,
      data.projectId,
      data.filename
    );

    return {
      uploadUrl: result.uploadUrl,
      key: result.key,
      publicUrl: result.publicUrl,
      contentType: data.contentType,
    };
  });

  // Upload file directly (server-side)
  fastify.post('/assets/upload', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Upload a file directly to storage',
      tags: ['assets'],
      consumes: ['multipart/form-data'],
    },
  }, async (request, reply) => {
    const data = await request.file();
    
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const user = getCognitoUser(request);
    const buffer = await data.toBuffer();
    
    // Determine asset type from content type or field name
    let assetType: 'audio' | 'image' | 'video' | 'frame' | 'brand_kit' = 'image';
    if (data.mimetype.startsWith('audio/')) assetType = 'audio';
    else if (data.mimetype.startsWith('video/')) assetType = 'video';
    else if (data.fieldname?.includes('frame')) assetType = 'frame';
    else if (data.fieldname?.includes('brand')) assetType = 'brand_kit';

    const result = await uploadFile(
      buffer,
      user.sub,
      assetType,
      data.mimetype,
      undefined, // projectId - can be extracted from form data if needed
      data.filename
    );

    return {
      url: result.url,
      key: result.key,
      bucket: result.bucket,
    };
  });

  // Generate presigned URL for downloading/viewing a file
  fastify.get('/assets/download-url', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get a presigned URL for downloading/viewing a file',
      tags: ['assets'],
      querystring: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string' },
          expiresIn: { type: 'number', default: 3600 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            downloadUrl: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { key, expiresIn = 3600 } = request.query as { key: string; expiresIn?: number };
    
    const downloadUrl = await generateDownloadUrl(key, expiresIn);
    
    return {
      downloadUrl,
    };
  });

  // Get all assets for a project
  fastify.get('/projects/:projectId/assets', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Get all assets for a project',
      tags: ['assets'],
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const user = getCognitoUser(request);
    const { query } = await import('../services/database');

    // Verify project belongs to user
    const project = await query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!project || project.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Get all assets for the project
    const assets = await query(
      `SELECT id, type, url, filename, metadata, created_at
       FROM assets
       WHERE project_id = $1
       ORDER BY created_at ASC`,
      [projectId]
    );

    return assets.map((asset: any) => ({
      id: asset.id,
      type: asset.type,
      url: asset.url,
      filename: asset.filename || '',
      thumbnail: asset.type === 'image' ? asset.url : undefined,
      metadata: asset.metadata || {},
    }));
  });

  // Save asset for a project
  fastify.post('/projects/:projectId/assets', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Save an asset for a project',
      tags: ['assets'],
      params: {
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['type', 'url'],
        properties: {
          type: { type: 'string', enum: ['audio', 'image', 'video', 'brand_kit'] },
          url: { type: 'string' },
          filename: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const user = getCognitoUser(request);
    const body = request.body as { type: string; url: string; filename?: string; metadata?: any };
    const { query } = await import('../services/database');

    // Verify project belongs to user
    const project = await query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, user.sub]
    );

    if (!project || project.length === 0) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Insert asset
    const result = await query(
      `INSERT INTO assets (project_id, type, url, filename, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, url, filename, metadata, created_at`,
      [
        projectId,
        body.type,
        body.url,
        body.filename || null,
        JSON.stringify(body.metadata || {}),
      ]
    );

    const asset = result[0];
    return {
      id: asset.id,
      type: asset.type,
      url: asset.url,
      filename: asset.filename || '',
      thumbnail: asset.type === 'image' ? asset.url : undefined,
      metadata: asset.metadata || {},
    };
  });

  // Delete an asset
  fastify.delete('/assets/:assetId', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Delete an asset',
      tags: ['assets'],
      params: {
        type: 'object',
        required: ['assetId'],
        properties: {
          assetId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const user = getCognitoUser(request);
    const { query } = await import('../services/database');
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const { config } = await import('../config');

    // Verify asset belongs to user's project and get the URL
    const asset = await query(
      `SELECT a.id, a.url FROM assets a
       JOIN projects p ON a.project_id = p.id
       WHERE a.id = $1 AND p.user_id = $2`,
      [assetId, user.sub]
    );

    if (!asset || asset.length === 0) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    const assetUrl = asset[0].url;

    // Delete from S3 if it's an S3 URL
    try {
      if (assetUrl && (assetUrl.includes('amazonaws.com') || assetUrl.includes(config.storage.bucketName))) {
        // Extract S3 key from URL
        const bucket = config.storage.bucketName;
        let s3Key: string | null = null;

        // Try to extract key from URL
        const bucketIndex = assetUrl.indexOf(`/${bucket}/`);
        if (bucketIndex !== -1) {
          s3Key = assetUrl.substring(bucketIndex + bucket.length + 2).split('?')[0];
        } else if (assetUrl.includes(`/${bucket}/`)) {
          const parts = assetUrl.split(`/${bucket}/`);
          if (parts.length > 1) {
            s3Key = parts[1].split('?')[0];
          }
        }

        if (s3Key) {
          const s3Client = new S3Client({
            region: config.storage.region,
            endpoint: config.storage.endpoint,
            credentials: config.storage.accessKeyId && config.storage.secretAccessKey
              ? {
                  accessKeyId: config.storage.accessKeyId,
                  secretAccessKey: config.storage.secretAccessKey,
                }
              : undefined,
            forcePathStyle: config.storage.endpoint?.includes('localhost') || config.storage.endpoint?.includes('127.0.0.1'),
          });

          const deleteCommand = new DeleteObjectCommand({
            Bucket: bucket,
            Key: decodeURIComponent(s3Key),
          });

          await s3Client.send(deleteCommand);
          fastify.log.info({ assetId, s3Key }, 'Deleted asset from S3');
        }
      }
    } catch (s3Error: any) {
      // Log but don't fail - asset might not be in S3 or already deleted
      fastify.log.warn({ assetId, error: s3Error?.message }, 'Failed to delete asset from S3, continuing with database deletion');
    }

    // Delete asset from database
    await query('DELETE FROM assets WHERE id = $1', [assetId]);

    return { success: true };
  });
}

