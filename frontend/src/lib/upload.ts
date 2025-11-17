export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  contentType: string;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
}

// Use localhost in development, production URL in production
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Check if we're in development mode
  const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
  return isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com';
};

const API_BASE_URL = getApiBaseUrl();

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
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('Upload URL error:', {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    });
    if (response.status === 401) {
      // Clear tokens and redirect to login
      localStorage.removeItem('cognito_access_token');
      localStorage.removeItem('cognito_id_token');
      localStorage.removeItem('cognito_refresh_token');
      localStorage.removeItem('cognito_user');
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error("Authentication failed. Please log in again.");
    }
    throw new Error(`Failed to get upload URL: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Upload file to S3 using presigned URL
 */
export async function uploadToS3(
  file: File,
  uploadUrl: string,
  contentType: string
): Promise<void> {
  // Parse the presigned URL to extract any required headers
  const url = new URL(uploadUrl);
  
  // Extract headers from query params if present
  const headers: HeadersInit = {
    "Content-Type": contentType,
  };

  // S3 presigned URLs may require specific headers - include them if present in URL
  // Note: The presigned URL signature includes the Content-Type, so it must match exactly
  
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: headers,
    body: file,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('S3 Upload Error:', {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
      url: uploadUrl.substring(0, 100) + '...',
    });
    throw new Error(`Failed to upload file: ${response.status} ${response.statusText}`);
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
): Promise<{ url: string; key: string }> {
  // Get presigned URL
  onProgress?.(10);
  const { uploadUrl, publicUrl, key, contentType } = await getUploadUrl(file, type, projectId, accessToken);

  // Upload to S3 - use the exact Content-Type from the backend response
  // This ensures it matches what was used to sign the presigned URL
  onProgress?.(30);
  await uploadToS3(file, uploadUrl, contentType || file.type);

  // Get presigned download URL since files are not publicly accessible
  onProgress?.(80);
  const downloadUrl = await getDownloadUrl(key, accessToken);

  onProgress?.(100);
  return { url: downloadUrl, key };
}

/**
 * Get a presigned download URL for an S3 file
 */
export async function getDownloadUrl(
  key: string,
  accessToken?: string | null,
  expiresIn: number = 3600
): Promise<string> {
  const headers: HeadersInit = {};

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(
    `${API_BASE_URL}/api/assets/download-url?key=${encodeURIComponent(key)}&expiresIn=${expiresIn}`,
    {
      method: "GET",
      headers,
    }
  );

  if (!response.ok) {
    if (response.status === 401) {
      // Clear tokens and redirect to login
      localStorage.removeItem('cognito_access_token');
      localStorage.removeItem('cognito_id_token');
      localStorage.removeItem('cognito_refresh_token');
      localStorage.removeItem('cognito_user');
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error("Authentication failed. Please log in again.");
    }
    throw new Error("Failed to get download URL");
  }

  const data: DownloadUrlResponse = await response.json();
  return data.downloadUrl;
}

