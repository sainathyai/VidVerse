import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

// Initialize S3 client
const hasCredentials = config.storage.accessKeyId && 
                       config.storage.accessKeyId.trim() !== '' && 
                       config.storage.secretAccessKey && 
                       config.storage.secretAccessKey.trim() !== '';


export const s3Client = new S3Client({
  region: config.storage.region,
  endpoint: config.storage.endpoint,
  credentials: hasCredentials
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
export function extractS3KeyFromUrl(url: string): string | null {
  const bucket = config.storage.bucketName;
  
  try {
    // Pattern 1: Path-style URL: https://s3.region.amazonaws.com/bucket/key
    // Example: https://s3.us-west-2.amazonaws.com/vidverse-assets/users/...
    const pathStylePattern = new RegExp(`https://s3[.-]([^.]+)\\.amazonaws\\.com/${bucket}/(.+?)(?:\\?|$)`, 'i');
    const pathStyleMatch = url.match(pathStylePattern);
    if (pathStyleMatch && pathStyleMatch[2]) {
      // Remove query parameters and handle URL encoding
      let keyWithQuery = decodeURIComponent(pathStyleMatch[2]);
      const key = keyWithQuery.split('?')[0].split('%3F')[0].split('%3f')[0];
      return key;
    }
    
    // Pattern 2: Virtual-hosted-style URL: https://bucket.s3.region.amazonaws.com/key
    // Example: https://vidverse-assets.s3.us-west-2.amazonaws.com/users/...
    const virtualHostedPattern = new RegExp(`https://${bucket}\\.s3[.-]([^.]+)\\.amazonaws\\.com/(.+?)(?:\\?|$)`, 'i');
    const virtualHostedMatch = url.match(virtualHostedPattern);
    if (virtualHostedMatch && virtualHostedMatch[2]) {
      // Remove query parameters if present and decode URL encoding
      let keyWithQuery = decodeURIComponent(virtualHostedMatch[2]);
      // Handle double-encoded URLs (where query params are in the key itself)
      // Split on first ? to get the actual key
      const key = keyWithQuery.split('?')[0];
      // Also handle %3F (encoded ?) in the key
      const cleanKey = key.split('%3F')[0].split('%3f')[0];
      return cleanKey;
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
    // First split on ? to get path part only (removes query string)
    const pathPart = url.split('?')[0];
    const bucketIndex = pathPart.indexOf(`/${bucket}/`);
    if (bucketIndex !== -1) {
      let key = pathPart.substring(bucketIndex + bucket.length + 2);
      // Decode URL encoding (handles %3F, %26, etc.)
      key = decodeURIComponent(key);
      // Remove any query params that might be encoded in the key itself
      // Split on ? (decoded) or %3F/%3f (encoded ?) or %26 (encoded &)
      key = key.split('?')[0].split('%3F')[0].split('%3f')[0];
      // Find where query params start (encoded & is %26)
      const ampIndex = key.indexOf('%26');
      if (ampIndex > 0) {
        key = key.substring(0, ampIndex);
      }
      // Also check for regular & (in case it wasn't encoded)
      const regularAmpIndex = key.indexOf('&');
      if (regularAmpIndex > 0) {
        key = key.substring(0, regularAmpIndex);
      }
      return key;
    }
    
    return null;
  } catch (error) {
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
  
  // Helper function to check if URL contains PUT presigned URL markers
  const hasPutObject = url.includes('x-id=PutObject') || 
                       url.includes('x-id%3DPutObject') || 
                       url.includes('x-id%3dPutObject') ||
                       url.includes('%3Fx-id%3DPutObject') ||
                       url.includes('%3fx-id%3dPutObject');
  
  // Check if it's a PUT presigned URL (x-id=PutObject) - these need to be converted to GET
  if (hasPutObject) {
    // Extract the S3 key from the URL and generate a new GET presigned URL
    const key = extractS3KeyFromUrl(url);
    if (key) {
      try {
        const getCommand = new GetObjectCommand({
          Bucket: config.storage.bucketName,
          Key: key,
        });
        const newPresignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn });
        return newPresignedUrl;
      } catch (error: any) {
        // If conversion fails, return original URL
        return url;
      }
    }
  }
  
  // Skip if already a GET presigned URL (contains X-Amz-Signature but not PutObject)
  if (url.includes('X-Amz-Signature') && !hasPutObject) {
    return url;
  }
  
  // Skip if not an S3 URL (e.g., Replicate URLs, external URLs)
  if (!url.includes('amazonaws.com') && !url.includes(config.storage.bucketName)) {
    return url;
  }
  
  const key = extractS3KeyFromUrl(url);
  if (!key) {
    // If we can't extract the key, return original URL
    return url;
  }
  
  try {
    // Verify S3 client is configured
    if (!s3Client) {
      return url;
    }
    
    // Verify credentials are available
    const hasAccessKeyId = config.storage.accessKeyId && config.storage.accessKeyId.trim() !== '';
    const hasSecretAccessKey = config.storage.secretAccessKey && config.storage.secretAccessKey.trim() !== '';
    
    if (!hasAccessKeyId || !hasSecretAccessKey) {
      return url;
    }
    
    const presignedUrl = await generateDownloadUrl(key, expiresIn);
    return presignedUrl;
  } catch (error: any) {
    // Return original URL on error - this allows fallback to public access if bucket is public
    return url;
  }
}