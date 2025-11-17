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

export interface ApiError {
  message: string;
  statusCode?: number;
}

// Helper to get access token from localStorage
async function getAccessTokenFromStorage(): Promise<string | null> {
  const accessToken = localStorage.getItem('cognito_access_token');
  if (accessToken) {
    try {
      // Check if token is expired
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      if (payload.exp * 1000 > Date.now()) {
        return accessToken;
      } else {
        // Token expired, remove it
        localStorage.removeItem('cognito_access_token');
        localStorage.removeItem('cognito_id_token');
        localStorage.removeItem('cognito_refresh_token');
        return null;
      }
    } catch (error) {
      // Error decoding, treat as invalid
      localStorage.removeItem('cognito_access_token');
      return null;
    }
  }
  return null;
}

// Helper to check if we should redirect to login
function handleAuthError(statusCode: number) {
  if (statusCode === 401) {
    // Clear any stored tokens
    localStorage.removeItem('cognito_access_token');
    localStorage.removeItem('cognito_id_token');
    localStorage.removeItem('cognito_refresh_token');
    localStorage.removeItem('cognito_user');
    
    // Redirect to login page
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }
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

  // If no token provided, try to get it from storage
  let token = accessToken;
  if (!token) {
    token = await getAccessTokenFromStorage();
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
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
    
    // Automatically handle 401 errors by redirecting to login
    if (error.statusCode === 401) {
      handleAuthError(401);
    }
    
    throw error;
  }

  // Handle 204 No Content responses (no body to parse)
  if (response.status === 204) {
    return null as T;
  }

  // Check if response has content
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const text = await response.text();
    if (!text || text.trim() === '') {
      return null as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      // If JSON parsing fails, return null
      return null as T;
    }
  }

  // For non-JSON responses, return null
  return null as T;
}

