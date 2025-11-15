export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

/**
 * Get a presigned URL for uploading a file
 */
export async function getUploadUrl(
  file: File,
  type: "audio" | "image" | "video" | "brand_kit",
  projectId?: string
): Promise<UploadUrlResponse> {
  // Get auth token
  const { fetchAuthSession } = await import('aws-amplify/auth');
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch("/api/assets/upload-url", {
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
  onProgress?: (progress: number) => void,
  projectId?: string
): Promise<string> {
  // Get presigned URL
  onProgress?.(10);
  const { uploadUrl, publicUrl } = await getUploadUrl(file, type, projectId);

  // Upload to S3
  onProgress?.(30);
  await uploadToS3(file, uploadUrl);

  onProgress?.(100);
  return publicUrl;
}

