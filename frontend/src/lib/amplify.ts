import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
      region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
      loginWith: {
        email: true,
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

