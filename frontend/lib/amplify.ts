import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
      userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
      region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
      loginWith: {
        email: true,
      },
    },
  },
};

// Configure Amplify - will work even with empty values (for development)
// The AuthProvider will check if credentials exist before using auth functions
try {
  Amplify.configure(amplifyConfig);
} catch (error) {
  // Silently fail if configuration fails (e.g., in development without credentials)
  console.warn('Amplify configuration skipped:', error);
}

export { Amplify };

