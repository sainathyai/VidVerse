import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getCurrentUser, signOut, fetchAuthSession } from "aws-amplify/auth";
import "@/lib/amplify";

interface User {
  userId: string;
  username: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  confirmSignUp: (username: string, code: string) => Promise<void>;
  resendSignUpCode: (username: string) => Promise<void>;
  forgotPassword: (username: string) => Promise<void>;
  confirmForgotPassword: (username: string, code: string, newPassword: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  checkUser: () => Promise<void>;
}

// Use localhost in development, production URL in production
const getBackendUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Check if we're in development mode
  const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
  return isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com';
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      // Check for tokens from backend OAuth
      const accessToken = localStorage.getItem('cognito_access_token');
      const idToken = localStorage.getItem('cognito_id_token');
      const userStr = localStorage.getItem('cognito_user');

      if (accessToken && idToken) {
        // User is authenticated via backend OAuth
        if (userStr) {
          try {
            const userInfo = JSON.parse(userStr);
            setUser({
              userId: userInfo.sub || userInfo.user_id || '',
              username: userInfo.email || userInfo.username || '',
              email: userInfo.email,
            });
          } catch (e) {
            // Fallback: decode ID token to get user info
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            setUser({
              userId: payload.sub || '',
              username: payload.email || payload['cognito:username'] || '',
              email: payload.email,
            });
          }
        } else {
          // Decode ID token to get user info
          const payload = JSON.parse(atob(idToken.split('.')[1]));
          setUser({
            userId: payload.sub || '',
            username: payload.email || payload['cognito:username'] || '',
            email: payload.email,
          });
        }
      } else if (import.meta.env.VITE_COGNITO_USER_POOL_ID) {
        // Fallback to Amplify if configured
        try {
          const currentUser = await getCurrentUser();
          setUser({
            userId: currentUser.userId,
            username: currentUser.username,
            email: currentUser.signInDetails?.loginId,
          });
        } catch (error) {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (username: string, password: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Sign in failed');
      }

      const data = await response.json();
      
      // Store tokens in localStorage
      if (data.accessToken) {
        localStorage.setItem('cognito_access_token', data.accessToken);
      }
      if (data.idToken) {
        localStorage.setItem('cognito_id_token', data.idToken);
      }
      if (data.refreshToken) {
        localStorage.setItem('cognito_refresh_token', data.refreshToken);
      }

      // Decode ID token to get user info
      if (data.idToken) {
        const payload = JSON.parse(atob(data.idToken.split('.')[1]));
        localStorage.setItem('cognito_user', JSON.stringify({
          sub: payload.sub,
          email: payload.email,
          username: payload['cognito:username'] || payload.email,
        }));
      }

      await checkUser();
    } catch (error: any) {
      throw new Error(error.message || 'Sign in failed');
    }
  };

  const handleSignOut = async () => {
    // Clear tokens from localStorage
    localStorage.removeItem('cognito_access_token');
    localStorage.removeItem('cognito_id_token');
    localStorage.removeItem('cognito_refresh_token');
    localStorage.removeItem('cognito_user');

    // Also try Amplify signout if configured
    if (import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      try {
        await signOut();
      } catch (error) {
        // Ignore errors
      }
    }

    setUser(null);
    
    // Redirect to backend logout (which redirects to Cognito)
    const backendUrl = getBackendUrl();
    window.location.href = `${backendUrl}/api/auth/logout`;
  };

  const handleSignUp = async (username: string, password: string, email: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, email }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Sign up failed');
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      throw new Error(error.message || 'Sign up failed');
    }
  };

  const handleConfirmSignUp = async (username: string, code: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, code }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Confirmation failed');
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(error.message || 'Confirmation failed');
    }
  };

  const handleResendSignUpCode = async (username: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/resend-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to resend code');
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(error.message || 'Failed to resend code');
    }
  };

  const handleForgotPassword = async (username: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send password reset code');
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(error.message || 'Failed to send password reset code');
    }
  };

  const handleConfirmForgotPassword = async (username: string, code: string, newPassword: string) => {
    const backendUrl = getBackendUrl();
    
    try {
      const response = await fetch(`${backendUrl}/api/auth/confirm-forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, code, newPassword }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to reset password');
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(error.message || 'Failed to reset password');
    }
  };

  const getAccessToken = async (): Promise<string | null> => {
    const accessToken = localStorage.getItem('cognito_access_token');
    if (accessToken) {
      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          return accessToken;
        } else {
          // Token expired, remove it
          localStorage.removeItem('cognito_access_token');
          localStorage.removeItem('cognito_id_token');
          localStorage.removeItem('cognito_refresh_token');
        }
      } catch (error) {
        // Error decoding, treat as invalid
        localStorage.removeItem('cognito_access_token');
      }
    }

    if (import.meta.env.VITE_COGNITO_USER_POOL_ID) {
      try {
        const session = await fetchAuthSession();
        return session.tokens?.accessToken?.toString() || null;
      } catch (error) {
        return null;
      }
    }

    return null;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn: handleSignIn,
        signOut: handleSignOut,
        signUp: handleSignUp,
        confirmSignUp: handleConfirmSignUp,
        resendSignUpCode: handleResendSignUpCode,
        forgotPassword: handleForgotPassword,
        confirmForgotPassword: handleConfirmForgotPassword,
        getAccessToken,
        checkUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

