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

  // Function to refresh tokens
  const refreshTokens = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem('cognito_refresh_token');
    const idToken = localStorage.getItem('cognito_id_token');
    if (!refreshToken) {
      return false;
    }

    const backendUrl = getBackendUrl();
    try {
      // Include ID token to extract username for secret hash calculation
      const response = await fetch(`${backendUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          refreshToken,
          ...(idToken && { idToken }),
        }),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      
      // Update tokens
      if (data.accessToken) {
        localStorage.setItem('cognito_access_token', data.accessToken);
      }
      if (data.idToken) {
        localStorage.setItem('cognito_id_token', data.idToken);
      }

      // Decode ID token to update user info
      if (data.idToken) {
        const payload = JSON.parse(atob(data.idToken.split('.')[1]));
        localStorage.setItem('cognito_user', JSON.stringify({
          sub: payload.sub,
          email: payload.email,
          username: payload['cognito:username'] || payload.email,
        }));
      }

      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  };

  useEffect(() => {
    checkUser();
    
    // Set up periodic token refresh (check every 5 minutes)
    const tokenRefreshInterval = setInterval(async () => {
      const accessToken = localStorage.getItem('cognito_access_token');
      const refreshToken = localStorage.getItem('cognito_refresh_token');
      
      if (!accessToken || !refreshToken) {
        return;
      }

      try {
        const payload = JSON.parse(atob(accessToken.split('.')[1]));
        const expiresAt = payload.exp * 1000;
        const now = Date.now();
        const timeUntilExpiry = expiresAt - now;
        
        // Refresh token if it expires in less than 15 minutes (refresh before expiry)
        // This ensures tokens are always fresh without interrupting the user
        if (timeUntilExpiry < 15 * 60 * 1000 && timeUntilExpiry > 0) {
          console.log('Access token expiring soon, refreshing...');
          const refreshed = await refreshTokens();
          if (!refreshed) {
            // Refresh failed, clear tokens and log out
            localStorage.removeItem('cognito_access_token');
            localStorage.removeItem('cognito_id_token');
            localStorage.removeItem('cognito_refresh_token');
            localStorage.removeItem('cognito_user');
            setUser(null);
            if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
              window.location.href = '/login';
            }
          }
        } else if (timeUntilExpiry <= 0) {
          // Token already expired, try to refresh
          console.log('Access token expired, attempting refresh...');
          const refreshed = await refreshTokens();
          if (!refreshed) {
            // Refresh failed, clear tokens and log out
            localStorage.removeItem('cognito_access_token');
            localStorage.removeItem('cognito_id_token');
            localStorage.removeItem('cognito_refresh_token');
            localStorage.removeItem('cognito_user');
            setUser(null);
            if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
              window.location.href = '/login';
            }
          }
        }
      } catch (error) {
        console.error('Error checking token expiration:', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    return () => {
      clearInterval(tokenRefreshInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const checkUser = async () => {
    try {
      // Check for tokens from backend OAuth
      const accessToken = localStorage.getItem('cognito_access_token');
      const idToken = localStorage.getItem('cognito_id_token');
      const userStr = localStorage.getItem('cognito_user');

      if (accessToken && idToken) {
        // Validate token expiration
        try {
          const accessPayload = JSON.parse(atob(accessToken.split('.')[1]));
          const idPayload = JSON.parse(atob(idToken.split('.')[1]));
          
          // Calculate token expiration times
          const accessTokenExpiresAt = accessPayload.exp * 1000;
          const idTokenExpiresAt = idPayload.exp * 1000;
          const now = Date.now();
          const accessTokenValidFor = Math.max(0, accessTokenExpiresAt - now);
          const idTokenValidFor = Math.max(0, idTokenExpiresAt - now);
          
          // Log token expiration details (only once per session)
          if (!localStorage.getItem('token_expiry_logged')) {
            console.log('Token Expiration Details:', {
              accessToken: {
                expiresAt: new Date(accessTokenExpiresAt).toISOString(),
                validForSeconds: Math.round(accessTokenValidFor / 1000),
                validForMinutes: Math.round(accessTokenValidFor / 60000),
                validForHours: (accessTokenValidFor / 3600000).toFixed(2),
              },
              idToken: {
                expiresAt: new Date(idTokenExpiresAt).toISOString(),
                validForSeconds: Math.round(idTokenValidFor / 1000),
                validForMinutes: Math.round(idTokenValidFor / 60000),
                validForHours: (idTokenValidFor / 3600000).toFixed(2),
              },
            });
            localStorage.setItem('token_expiry_logged', 'true');
            // Clear the flag after 1 hour
            setTimeout(() => localStorage.removeItem('token_expiry_logged'), 3600000);
          }
          
          // Check if access token is expired
          const isAccessTokenExpired = accessTokenExpiresAt <= now;
          // Check if ID token is expired (with 1 day buffer for safety - allows refresh token to work)
          const isIdTokenExpired = idTokenExpiresAt <= (now + 24 * 60 * 60 * 1000);
          
          if (isAccessTokenExpired) {
            // Access token expired, try to refresh it
            const refreshToken = localStorage.getItem('cognito_refresh_token');
            if (refreshToken) {
              // Try to refresh tokens
              const backendUrl = getBackendUrl();
              try {
                const refreshResponse = await fetch(`${backendUrl}/api/auth/refresh`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ refreshToken }),
                });

                if (refreshResponse.ok) {
                  const refreshData = await refreshResponse.json();
                  if (refreshData.accessToken) {
                    localStorage.setItem('cognito_access_token', refreshData.accessToken);
                  }
                  if (refreshData.idToken) {
                    localStorage.setItem('cognito_id_token', refreshData.idToken);
                    const newPayload = JSON.parse(atob(refreshData.idToken.split('.')[1]));
                    localStorage.setItem('cognito_user', JSON.stringify({
                      sub: newPayload.sub,
                      email: newPayload.email,
                      username: newPayload['cognito:username'] || newPayload.email,
                    }));
                  }
                  // Tokens refreshed, continue with user setup below
                } else {
                  // Refresh failed, clear everything and redirect to login
                  localStorage.removeItem('cognito_access_token');
                  localStorage.removeItem('cognito_id_token');
                  localStorage.removeItem('cognito_refresh_token');
                  localStorage.removeItem('cognito_user');
                  setUser(null);
                  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                    window.location.href = '/login';
                  }
                  return;
                }
              } catch (refreshError) {
                // Refresh failed, clear everything and redirect to login
                localStorage.removeItem('cognito_access_token');
                localStorage.removeItem('cognito_id_token');
                localStorage.removeItem('cognito_refresh_token');
                localStorage.removeItem('cognito_user');
                setUser(null);
                if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                  window.location.href = '/login';
                }
                return;
              }
            } else {
              // No refresh token, clear everything and redirect to login
              localStorage.removeItem('cognito_access_token');
              localStorage.removeItem('cognito_id_token');
              localStorage.removeItem('cognito_refresh_token');
              localStorage.removeItem('cognito_user');
              setUser(null);
              if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                window.location.href = '/login';
              }
              return;
            }
          } else if (isIdTokenExpired) {
            // ID token expired but access token is still valid, just log a warning
            console.warn('ID token expired, but access token is still valid. User can continue using the app.');
          }
          
          // Tokens are valid, set user
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
              setUser({
                userId: idPayload.sub || '',
                username: idPayload.email || idPayload['cognito:username'] || '',
                email: idPayload.email,
              });
            }
          } else {
            // Decode ID token to get user info
            setUser({
              userId: idPayload.sub || '',
              username: idPayload.email || idPayload['cognito:username'] || '',
              email: idPayload.email,
            });
          }
        } catch (decodeError) {
          // Error decoding tokens, treat as invalid
          localStorage.removeItem('cognito_access_token');
          localStorage.removeItem('cognito_id_token');
          localStorage.removeItem('cognito_refresh_token');
          localStorage.removeItem('cognito_user');
          setUser(null);
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          return;
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
        const expiresAt = payload.exp * 1000;
        const now = Date.now();
        
        if (expiresAt > now) {
          return accessToken;
        } else {
          // Token expired, try to refresh it
          const refreshToken = localStorage.getItem('cognito_refresh_token');
          const idToken = localStorage.getItem('cognito_id_token');
          if (refreshToken) {
            const backendUrl = getBackendUrl();
            try {
              const refreshResponse = await fetch(`${backendUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                  refreshToken,
                  ...(idToken && { idToken }),
                }),
              });

              if (refreshResponse.ok) {
                const refreshData = await refreshResponse.json();
                if (refreshData.accessToken) {
                  localStorage.setItem('cognito_access_token', refreshData.accessToken);
                  if (refreshData.idToken) {
                    localStorage.setItem('cognito_id_token', refreshData.idToken);
                  }
                  return refreshData.accessToken;
                }
              }
            } catch (refreshError) {
              console.error('Token refresh failed in getAccessToken:', refreshError);
            }
          }
          
          // Refresh failed or no refresh token, clear everything
          localStorage.removeItem('cognito_access_token');
          localStorage.removeItem('cognito_id_token');
          localStorage.removeItem('cognito_refresh_token');
          localStorage.removeItem('cognito_user');
          setUser(null);
          // Redirect to login if not already there
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
          return null;
        }
      } catch (error) {
        // Error decoding, treat as invalid
        localStorage.removeItem('cognito_access_token');
        localStorage.removeItem('cognito_id_token');
        localStorage.removeItem('cognito_refresh_token');
        localStorage.removeItem('cognito_user');
        setUser(null);
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return null;
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

