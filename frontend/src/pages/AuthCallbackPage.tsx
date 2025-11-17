import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../components/auth/AuthProvider';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for OAuth errors in URL params
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        
        if (error) {
          console.error('OAuth error:', error, errorDescription);
          navigate(`/login?error=${encodeURIComponent(errorDescription || error)}`);
          return;
        }

        // Check if we have a code parameter (direct callback from Cognito to frontend)
        // If so, forward it to the backend to exchange for tokens
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const accessToken = searchParams.get('access_token');
        const idToken = searchParams.get('id_token');
        const refreshToken = searchParams.get('refresh_token');
        const userParam = searchParams.get('user');

        // If we have a code but no tokens, forward to backend
        if (code && state && !accessToken) {
          console.log('Received code from Cognito, forwarding to backend...');
          const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
          const backendUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
          // Forward the callback to the backend
          window.location.href = `${backendUrl}/api/auth/callback?code=${code}&state=${state}`;
          return;
        }

        if (accessToken && idToken) {
          // Store tokens in localStorage (in production, use httpOnly cookies)
          localStorage.setItem('cognito_access_token', accessToken);
          localStorage.setItem('cognito_id_token', idToken);
          if (refreshToken) {
            localStorage.setItem('cognito_refresh_token', refreshToken);
          }

          // Parse user info if provided
          if (userParam) {
            try {
              const userInfo = JSON.parse(userParam);
              localStorage.setItem('cognito_user', JSON.stringify(userInfo));
            } catch (e) {
              console.warn('Failed to parse user info:', e);
            }
          }

          // Refresh user state
          await auth.checkUser();
          navigate('/dashboard');
        } else {
          // No tokens, redirect to login
          console.warn('No tokens in callback URL');
          navigate('/login?error=authentication_failed');
        }
      } catch (error: any) {
        console.error('Auth callback error:', error);
        if (error.message) {
          console.error('Error message:', error.message);
        }
        navigate(`/login?error=${encodeURIComponent(error.message || 'authentication_failed')}`);
      } finally {
        setLoading(false);
      }
    };

    handleCallback();
  }, [navigate, auth, searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
        <p className="text-white">Completing sign-in...</p>
      </div>
    </div>
  );
}

