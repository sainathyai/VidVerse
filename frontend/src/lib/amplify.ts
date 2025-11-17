import { Amplify } from 'aws-amplify';

// Detect development mode
const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
const defaultRedirectSignIn = isDev 
  ? 'http://localhost:3000/auth/callback' 
  : 'https://vidverseai.com/auth/callback';
const defaultRedirectSignOut = isDev 
  ? 'http://localhost:3000/login' 
  : 'https://vidverseai.com/login';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
      region: import.meta.env.VITE_AWS_REGION || 'us-west-2',
      loginWith: {
        email: true,
        oauth: {
          domain: import.meta.env.VITE_COGNITO_DOMAIN || '',
          scopes: ['email', 'openid', 'profile'],
          redirectSignIn: [import.meta.env.VITE_OAUTH_REDIRECT_SIGN_IN || defaultRedirectSignIn],
          redirectSignOut: [import.meta.env.VITE_OAUTH_REDIRECT_SIGN_OUT || defaultRedirectSignOut],
          responseType: 'code',
          providers: ['Google'], // Add 'Apple' if configured
        },
      },
    },
  },
};

// Configure Amplify - will work even with empty values (for development)
try {
  Amplify.configure(amplifyConfig);
} catch (error) {
  console.warn('Amplify configuration skipped:', error);
}

export { Amplify };

