const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiError {
  message: string;
  statusCode?: number;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  accessToken?: string | null
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      message: `HTTP error! status: ${response.status}`,
      statusCode: response.status,
    }));
    throw error;
  }

  return response.json();
}

