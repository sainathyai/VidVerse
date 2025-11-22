import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

// Initialize S3 client
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

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
}

export type AssetType = 'audio' | 'image' | 'video' | 'frame' | 'brand_kit' | 'draft';

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
    // For drafts, use a fixed filename: draft.json
    if (assetType === 'draft') {
      return `users/${userId}/projects/${projectId}/draft.json`;
    }
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
    // Note: ACL is removed - use bucket policy for public access instead
    // ACL: 'public-read', // Removed - many S3 buckets block ACLs
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
    // Note: ACL is removed - use bucket policy for public access instead
    // ACL: 'public-read', // Removed - many S3 buckets block ACLs
    Metadata: {
      userId,
      assetType,
      projectId: projectId || '',
      uploadedAt: new Date().toISOString(),
      source: 'server-generated',
    },
  });

  await s3Client.send(command);

  // Generate presigned URL if enabled, otherwise use public URL
  let url: string;
  if (config.storage.usePresignedUrls) {
    // Generate presigned URL (24 hour expiration for long-term access)
    url = await generateDownloadUrl(key, 86400); // 24 hours
    console.log(`[STORAGE] Generated presigned URL for uploaded file: ${key.substring(0, 50)}...`);
  } else {
    // Use public URL if presigned URLs are disabled
    url = config.storage.endpoint
      ? `${config.storage.endpoint}/${bucket}/${key}`
      : `https://${bucket}.s3.${config.storage.region}.amazonaws.com/${key}`;
  }

  return {
    url,
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

/**
 * Save draft data to S3 as JSON
 */
export async function saveDraft(
  draftData: any,
  userId: string,
  projectId: string
): Promise<UploadResult> {
  const jsonString = JSON.stringify(draftData, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');
  
  return uploadFile(
    buffer,
    userId,
    'draft',
    'application/json',
    projectId,
    'draft.json'
  );
}

/**
 * Load draft data from S3
 */
export async function loadDraft(
  userId: string,
  projectId: string
): Promise<any | null> {
  const key = `users/${userId}/projects/${projectId}/draft.json`;
  const bucket = config.storage.bucketName;

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      return null;
    }

    // Convert stream to string
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const jsonString = buffer.toString('utf-8');
    
    return JSON.parse(jsonString);
  } catch (error: any) {
    // If file doesn't exist, return null
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete draft from S3
 */
export async function deleteDraft(
  userId: string,
  projectId: string
): Promise<void> {
  const key = `users/${userId}/projects/${projectId}/draft.json`;
  const bucket = config.storage.bucketName;

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error: any) {
    // Ignore if file doesn't exist
    if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
      throw error;
    }
  }
}

/**
 * Extract S3 key from a public S3 URL
 * Handles multiple S3 URL formats:
 * 1. https://s3.region.amazonaws.com/bucket/key (path-style)
 * 2. https://bucket.s3.region.amazonaws.com/key (virtual-hosted-style)
 * 3. https://endpoint/bucket/key (custom endpoint)
 */
function extractS3KeyFromUrl(url: string): string | null {
  const bucket = config.storage.bucketName;
  
  try {
    // Pattern 1: Path-style URL: https://s3.region.amazonaws.com/bucket/key
    // Example: https://s3.us-west-2.amazonaws.com/vidverse-assets/users/...
    const pathStylePattern = new RegExp(`https://s3[.-]([^.]+)\\.amazonaws\\.com/${bucket}/(.+)`, 'i');
    const pathStyleMatch = url.match(pathStylePattern);
    if (pathStyleMatch && pathStyleMatch[2]) {
      return decodeURIComponent(pathStyleMatch[2]);
    }
    
    // Pattern 2: Virtual-hosted-style URL: https://bucket.s3.region.amazonaws.com/key
    // Example: https://vidverse-assets.s3.us-west-2.amazonaws.com/users/...
    const virtualHostedPattern = new RegExp(`https://${bucket}\\.s3[.-]([^.]+)\\.amazonaws\\.com/(.+)`, 'i');
    const virtualHostedMatch = url.match(virtualHostedPattern);
    if (virtualHostedMatch && virtualHostedMatch[2]) {
      return decodeURIComponent(virtualHostedMatch[2]);
    }
    
    // Pattern 3: Custom endpoint format: https://endpoint/bucket/key
    if (config.storage.endpoint) {
      const escapedEndpoint = config.storage.endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const endpointPattern = new RegExp(`${escapedEndpoint}/${bucket}/(.+)`, 'i');
      const endpointMatch = url.match(endpointPattern);
      if (endpointMatch && endpointMatch[1]) {
        return decodeURIComponent(endpointMatch[1]);
      }
    }
    
    // Pattern 4: Try to extract key by finding bucket name in URL
    const bucketIndex = url.indexOf(`/${bucket}/`);
    if (bucketIndex !== -1) {
      const key = url.substring(bucketIndex + bucket.length + 2);
      // Remove query parameters if any
      const keyWithoutQuery = key.split('?')[0];
      return decodeURIComponent(keyWithoutQuery);
    }
    
    console.warn(`[STORAGE] Could not extract S3 key from URL: ${url}`);
    return null;
  } catch (error) {
    console.error(`[STORAGE] Error extracting S3 key from URL: ${url}`, error);
    return null;
  }
}

/**
 * Convert an S3 public URL to a presigned URL for secure access
 * Returns the original URL if it's not an S3 URL or if key extraction fails
 * 
 * Note: Presigned URLs work with HTML5 video elements and support CORS if
 * the bucket has proper CORS configuration. They are valid for the specified
 * expiration time (default 1 hour).
 * 
 * If S3_USE_PRESIGNED_URLS=false, returns the original public URL.
 */
export async function convertS3UrlToPresigned(
  url: string | null | undefined,
  expiresIn: number = 3600
): Promise<string | null | undefined> {
  if (!url || typeof url !== 'string') {
    return url;
  }
  
  // If presigned URLs are disabled, return original URL (requires public bucket)
  if (!config.storage.usePresignedUrls) {
    return url;
  }
  
  // Skip if already a presigned URL (contains query parameters with signature)
  if (url.includes('X-Amz-Signature') || url.includes('AWSAccessKeyId')) {
    return url;
  }
  
  // Skip if not an S3 URL (e.g., Replicate URLs, external URLs)
  if (!url.includes('amazonaws.com') && !url.includes(config.storage.bucketName)) {
    return url;
  }
  
  const key = extractS3KeyFromUrl(url);
  if (!key) {
    // If we can't extract the key, return original URL
    console.warn(`[STORAGE] Could not extract S3 key from URL: ${url}`);
    return url;
  }
  
  try {
    const presignedUrl = await generateDownloadUrl(key, expiresIn);
    console.log(`[STORAGE] Generated presigned URL for key: ${key.substring(0, 50)}...`);
    return presignedUrl;
  } catch (error: any) {
    console.error(`[STORAGE] Error generating presigned URL for key ${key}:`, error?.message || error);
    // Return original URL on error - this allows fallback to public access if bucket is public
    return url;
  }
}