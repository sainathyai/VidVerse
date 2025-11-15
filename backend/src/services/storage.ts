import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

// Initialize S3 client
const s3Client = new S3Client({
  region: config.storage.region,
  endpoint: config.storage.endpoint,
  credentials: config.storage.accessKeyId
    ? {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      }
    : undefined,
  forcePathStyle: config.storage.endpoint?.includes('localhost') || config.storage.endpoint?.includes('127.0.0.1'),
});

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
}

export type AssetType = 'audio' | 'image' | 'video' | 'frame' | 'brand_kit';

/**
 * Generate S3 key path for organized storage
 */
function generateS3Key(
  userId: string,
  assetType: AssetType,
  projectId?: string,
  filename?: string
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename ? filename.replace(/[^a-zA-Z0-9.-]/g, '_') : `${timestamp}`;
  
  if (projectId) {
    // Organized by project: users/{userId}/projects/{projectId}/{type}/{filename}
    return `users/${userId}/projects/${projectId}/${assetType}/${timestamp}-${sanitizedFilename}`;
  } else {
    // General uploads: users/{userId}/{type}/{filename}
    return `users/${userId}/${assetType}/${timestamp}-${sanitizedFilename}`;
  }
}

/**
 * Generate a presigned URL for uploading a file
 */
export async function generateUploadUrl(
  userId: string,
  assetType: AssetType,
  contentType: string,
  projectId?: string,
  filename?: string,
  expiresIn: number = 3600
): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  const key = generateS3Key(userId, assetType, projectId, filename);
  const bucket = config.storage.bucketName;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    // Allow public read (adjust based on your needs)
    ACL: 'public-read',
    // Add metadata for tracking
    Metadata: {
      userId,
      assetType,
      projectId: projectId || '',
      uploadedAt: new Date().toISOString(),
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

  // Construct public URL
  const publicUrl = config.storage.endpoint
    ? `${config.storage.endpoint}/${bucket}/${key}`
    : `https://${bucket}.s3.${config.storage.region}.amazonaws.com/${key}`;

  return {
    uploadUrl,
    key,
    publicUrl,
  };
}

/**
 * Generate a presigned URL for downloading/viewing a file
 */
export async function generateDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.storage.bucketName,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Upload file directly to S3 (for server-side uploads)
 * Used for generated videos, frames, and processed assets
 */
export async function uploadFile(
  buffer: Buffer,
  userId: string,
  assetType: AssetType,
  contentType: string,
  projectId?: string,
  filename?: string
): Promise<UploadResult> {
  const key = generateS3Key(userId, assetType, projectId, filename);
  const bucket = config.storage.bucketName;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: 'public-read',
    Metadata: {
      userId,
      assetType,
      projectId: projectId || '',
      uploadedAt: new Date().toISOString(),
      source: 'server-generated',
    },
  });

  await s3Client.send(command);

  const publicUrl = config.storage.endpoint
    ? `${config.storage.endpoint}/${bucket}/${key}`
    : `https://${bucket}.s3.${config.storage.region}.amazonaws.com/${key}`;

  return {
    url: publicUrl,
    key,
    bucket,
  };
}

/**
 * Upload generated video to S3
 */
export async function uploadGeneratedVideo(
  videoBuffer: Buffer,
  userId: string,
  projectId: string,
  filename: string = 'output.mp4'
): Promise<UploadResult> {
  return uploadFile(
    videoBuffer,
    userId,
    'video',
    'video/mp4',
    projectId,
    filename
  );
}

/**
 * Upload frame (first/last frame) to S3
 */
export async function uploadFrame(
  frameBuffer: Buffer,
  userId: string,
  projectId: string,
  sceneId: string,
  frameType: 'first' | 'last',
  filename?: string
): Promise<UploadResult> {
  const frameFilename = filename || `${frameType}-frame-${sceneId}.jpg`;
  return uploadFile(
    frameBuffer,
    userId,
    'frame',
    'image/jpeg',
    projectId,
    frameFilename
  );
}

/**
 * Upload generated or processed audio to S3
 */
export async function uploadAudio(
  audioBuffer: Buffer,
  userId: string,
  projectId: string,
  filename: string = 'audio.mp3'
): Promise<UploadResult> {
  return uploadFile(
    audioBuffer,
    userId,
    'audio',
    'audio/mpeg',
    projectId,
    filename
  );
}
