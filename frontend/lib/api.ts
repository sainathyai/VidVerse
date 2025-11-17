// Use localhost in development, production URL in production
const getApiBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  const isDev = process.env.NODE_ENV === 'development';
  return isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com';
};

const API_BASE_URL = getApiBaseUrl();

// Get auth token from Amplify
async function getAuthToken(): Promise<string | null> {
  try {
    // In Amplify v6, we need to fetch the session
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() || null;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = await getAuthToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Redirect to login if unauthorized
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    const error = await response.json().catch(() => ({ message: 'An error occurred' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Projects API
export const projectsApi = {
  create: async (data: {
    category: string;
    prompt: string;
    duration: number;
    style?: string;
    mood?: string;
    constraints?: string;
    mode?: 'classic' | 'agentic';
    audioUrl?: string;
  }) => {
    return apiRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getAll: async () => {
    return apiRequest('/api/projects');
  },

  getById: async (id: string) => {
    return apiRequest(`/api/projects/${id}`);
  },

  update: async (id: string, data: Partial<{
    prompt: string;
    style: string;
    mood: string;
  }>) => {
    return apiRequest(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return apiRequest(`/api/projects/${id}`, {
      method: 'DELETE',
    });
  },
};
