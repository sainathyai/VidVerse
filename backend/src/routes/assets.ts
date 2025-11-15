import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { generateUploadUrl, uploadFile } from '../services/storage';
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
}

