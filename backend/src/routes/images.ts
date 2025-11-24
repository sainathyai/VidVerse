import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticateCognito, getCognitoUser } from '../middleware/cognito';
import { config } from '../config';
import { z } from 'zod';

const imageGenerationSchema = z.object({
  prompt: z.string().min(10).max(4000),
  imageModelId: z.string().optional(),
  aspectRatio: z.string().optional(),
  projectId: z.string().uuid().optional(),
  filename: z.string().optional(),
  assetNumber: z.number().int().positive().optional(), // Asset position/order (1-based)
});

const sanitizeFilename = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    return `generated-image-${Date.now()}.jpg`;
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const inferExtension = (contentType?: string | null, sourceUrl?: string): string => {
  if (contentType) {
    const [, subtype] = contentType.split('/');
    if (subtype) {
      const cleanSubtype = subtype.split(';')[0]?.split('+')[0]?.trim();
      if (cleanSubtype) {
        return cleanSubtype === 'jpeg' ? 'jpg' : cleanSubtype;
      }
    }
  }

  if (sourceUrl) {
    const match = sourceUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match && match[1]) {
      const fromUrl = match[1].toLowerCase();
      return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
    }
  }

  return 'jpg';
};

export async function imageRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  fastify.post('/generate-image', {
    preHandler: [authenticateCognito],
    schema: {
      description: 'Generate a reference image via Replicate',
      tags: ['assets'],
      body: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 10, maxLength: 4000 },
          imageModelId: { type: 'string' },
          aspectRatio: { type: 'string' },
          projectId: { type: 'string', format: 'uuid' },
          filename: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            imageUrl: { type: 'string' },
            isTemporary: { type: 'boolean' },
            message: { type: 'string' },
            assetId: { type: 'string', format: 'uuid', nullable: true },
          },
          required: ['imageUrl', 'isTemporary'],
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        503: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!config.replicate.apiToken) {
      return reply.code(503).send({
        error: 'Replicate API token not configured',
        message: 'Set REPLICATE_API_TOKEN in backend/.env to enable image generation.',
      });
    }

    const user = getCognitoUser(request);
    const body = imageGenerationSchema.parse(request.body);

    try {
      const { generateImage } = await import('../services/replicate');
      const generationResult = await generateImage({
        prompt: body.prompt.trim(),
        imageModelId: body.imageModelId || 'google/imagen-4-ultra',
        aspectRatio: body.aspectRatio,
      });

      if (generationResult.status !== 'succeeded' || !generationResult.output) {
        fastify.log.error({
          status: generationResult.status,
          error: generationResult.error,
        }, 'Image generation failed');

        return reply.code(502).send({
          error: 'ImageGenerationFailed',
          message: generationResult.error || 'Replicate did not return an image URL.',
        });
      }

      const primaryOutput = typeof generationResult.output === 'string'
        ? generationResult.output
        : generationResult.output[0];

      if (!primaryOutput) {
        return reply.code(502).send({
          error: 'ImageGenerationFailed',
          message: 'Replicate returned an empty response.',
        });
      }

      // ALWAYS download and upload to S3 - this is mandatory
      fastify.log.info({
        userId: user.sub,
        projectId: body.projectId,
        replicateUrl: primaryOutput,
      }, 'Downloading generated image from Replicate and uploading to S3');

      const response = await fetch(primaryOutput);
      if (!response.ok) {
        fastify.log.error({
          status: response.status,
          statusText: response.statusText,
          url: primaryOutput,
        }, 'Failed to download generated image from Replicate');
        return reply.code(502).send({
          error: 'ImageDownloadFailed',
          message: `Failed to download image from Replicate: ${response.statusText}`,
        });
      }

      const contentTypeHeader = response.headers.get('content-type') || 'image/jpeg';
      const normalizedContentType = contentTypeHeader.toLowerCase().startsWith('image/')
        ? contentTypeHeader.split(';')[0]
        : 'image/jpeg';

      const extension = inferExtension(normalizedContentType, primaryOutput);
      const filename = sanitizeFilename(body.filename || `generated-image-${Date.now()}.${extension}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      fastify.log.info({
        userId: user.sub,
        projectId: body.projectId,
        filename,
        contentType: normalizedContentType,
        size: buffer.length,
      }, 'Uploading image to S3');

      // Upload to S3 - this is mandatory, no fallback
      const { uploadFile } = await import('../services/storage');
      let uploadResult;
      try {
        uploadResult = await uploadFile(
          buffer,
          user.sub,
          'image',
          normalizedContentType,
          body.projectId,
          filename
        );
        fastify.log.info({
          userId: user.sub,
          projectId: body.projectId,
          s3Url: uploadResult.url,
          s3Key: uploadResult.key,
        }, 'Image successfully uploaded to S3');
      } catch (uploadError: any) {
        fastify.log.error({
          err: uploadError,
          userId: user.sub,
          projectId: body.projectId,
          filename,
        }, 'Failed to upload image to S3 - this is a critical error');
        return reply.code(500).send({
          error: 'S3UploadFailed',
          message: `Failed to upload image to S3: ${uploadError?.message || 'Unknown error'}`,
        });
      }

      const finalUrl = uploadResult.url;
      let assetId: string | null = null;

      // Save to database if projectId is provided
      if (body.projectId) {
        try {
          const { query } = await import('../services/database');
          const project = await query(
            'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
            [body.projectId, user.sub]
          );

          if (!project || project.length === 0) {
            fastify.log.warn({
              projectId: body.projectId,
              userId: user.sub,
            }, 'Project not found when saving asset to database');
            return reply.code(404).send({
              error: 'ProjectNotFound',
              message: 'Project not found or you do not have access to it.',
            });
          }

          const metadata = {
            prompt: body.prompt,
            imageModelId: body.imageModelId || 'google/imagen-4-ultra',
            aspectRatio: body.aspectRatio,
            source: 'generate-image',
            assetNumber: body.assetNumber || null, // Save asset order/position
          };

          const insertResult = await query(
            `INSERT INTO assets (project_id, type, url, filename, mime_type, metadata, size_bytes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              body.projectId,
              'image',
              uploadResult.url,
              filename,
              normalizedContentType,
              JSON.stringify(metadata),
              buffer.length,
            ]
          );

          assetId = insertResult[0]?.id || null;
          fastify.log.info({
            userId: user.sub,
            projectId: body.projectId,
            assetId,
            s3Url: uploadResult.url,
          }, 'Asset saved to database');
        } catch (dbError: any) {
          fastify.log.error({
            err: dbError,
            userId: user.sub,
            projectId: body.projectId,
          }, 'Failed to save asset to database, but S3 upload succeeded');
          // Don't fail the request if DB save fails - S3 upload is more important
        }
      }

      return {
        imageUrl: finalUrl,
        isTemporary: false, // Always false now since we always upload to S3
        assetId,
        message: 'Image stored successfully in S3.',
      };
    } catch (error: any) {
      fastify.log.error({
        err: error,
      }, 'Unexpected error during image generation');

      return reply.code(500).send({
        error: 'InternalServerError',
        message: error?.message || 'Unexpected error generating image.',
      });
    }
  });
}

