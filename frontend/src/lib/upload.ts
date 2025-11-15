export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Get a presigned URL for uploading a file
 */
export async function getUploadUrl(
  file: File,
  type: "audio" | "image" | "video" | "brand_kit",
  projectId?: string,
  accessToken?: string | null
): Promise<UploadUrlResponse> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/assets/upload-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      type,
      projectId,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to get upload URL");
  }

  return response.json();
}

/**
 * Upload file to S3 using presigned URL
 */
export async function uploadToS3(
  file: File,
  uploadUrl: string
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Failed to upload file");
  }
}

/**
 * Complete upload flow: get URL, upload file, return public URL
 */
export async function uploadFile(
  file: File,
  type: "audio" | "image" | "video" | "brand_kit",
  accessToken?: string | null,
  onProgress?: (progress: number) => void,
  projectId?: string
): Promise<string> {
  // Get presigned URL
  onProgress?.(10);
  const { uploadUrl, publicUrl } = await getUploadUrl(file, type, projectId, accessToken);

  // Upload to S3
  onProgress?.(30);
  await uploadToS3(file, uploadUrl);

  onProgress?.(100);
  return publicUrl;
}

