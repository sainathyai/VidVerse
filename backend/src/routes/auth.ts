import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { Issuer, Client, generators } from 'openid-client';
import { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand, ConfirmSignUpCommand, ResendConfirmationCodeCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand, AuthFlowType } from '@aws-sdk/client-cognito-identity-provider';
import { createHmac } from 'crypto';
import { config } from '../config';

// Store nonce and state in memory (use session or Redis in production)
const nonces = new Map<string, string>();
const states = new Map<string, string>();

/**
 * OAuth routes for Cognito authentication
 */
export async function authRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  // Initialize OIDC client
  let client: Client | null = null;

  const initClient = async () => {
    if (client) return client;

    if (!config.cognito.userPoolId || !config.cognito.clientId) {
      fastify.log.warn('Cognito OAuth not configured. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
      return null;
    }

    const region = config.cognito.region || config.aws.region || 'us-west-2';
    // Backend callback URL - backend handles the callback to exchange code for tokens
    // After token exchange, backend redirects to frontend with tokens
    const redirectUri = `${config.backendUrl}/api/auth/callback`;

    try {
      // Use Cognito issuer URL format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}
      const issuerUrl = `https://cognito-idp.${region}.amazonaws.com/${config.cognito.userPoolId}`;
      
      fastify.log.info({ 
        redirectUri, 
        backendUrl: config.backendUrl,
        issuerUrl 
      }, 'Initializing OIDC client with redirect URI');
      
      const issuer = await Issuer.discover(issuerUrl);
      
      // Configure client - include client_secret if available (for server-side flows)
      const clientConfig: any = {
        client_id: config.cognito.clientId,
        redirect_uris: [redirectUri],
        response_types: ['code'],
      };

      // Add client_secret if configured (required for server-side OAuth flows)
      if (config.cognito.clientSecret) {
        clientConfig.client_secret = config.cognito.clientSecret;
      }

      client = new issuer.Client(clientConfig);

      fastify.log.info(`OIDC client initialized for ${issuerUrl}`);
      return client;
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to initialize OIDC client');
      return null;
    }
  };

  // Initialize client on startup
  await initClient();

  /**
   * GET /api/auth/login
   * Initiate OAuth login flow
   * Query params:
   *   - provider: Optional identity provider name (e.g., "Google") to bypass Cognito hosted UI
   */
  fastify.get('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const oidcClient = await initClient();
    
    if (!oidcClient) {
      return reply.code(503).send({
        error: 'OAuth not configured',
        message: 'Cognito OAuth is not properly configured',
      });
    }

    // Get provider from query params (e.g., "Google" to bypass Cognito hosted UI)
    const query = request.query as { provider?: string };
    const identityProvider = query.provider;

    // Generate nonce and state for OAuth flow
    const nonce = generators.nonce();
    const state = generators.state();

    // Store nonce and state (use session or Redis in production)
    nonces.set(state, nonce);
    states.set(state, state);

    // Build authorization URL parameters
    const authParams: any = {
      scope: 'openid email profile',
      state: state,
      nonce: nonce,
    };

    // Add identity_provider parameter to bypass Cognito hosted UI and go directly to the provider
    if (identityProvider) {
      authParams.identity_provider = identityProvider;
    }

    // Build authorization URL
    const authUrl = oidcClient.authorizationUrl(authParams);

    fastify.log.info({ 
      authUrl,
      redirectUri: oidcClient.metadata.redirect_uris?.[0],
      clientId: config.cognito.clientId,
      identityProvider
    }, 'Redirecting to OAuth authorization URL');

    // Redirect directly to provider (Google) or Cognito login page
    return reply.redirect(authUrl);
  });

  /**
   * GET /api/auth/callback
   * Handle OAuth callback from Cognito
   */
  fastify.get('/auth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    fastify.log.info({ url: request.url, query: request.query }, 'OAuth callback received');
    
    const oidcClient = await initClient();
    
    if (!oidcClient) {
      fastify.log.error('OIDC client not initialized');
      return reply.code(503).send({
        error: 'OAuth not configured',
        message: 'Cognito OAuth is not properly configured',
      });
    }

    const query = request.query as { code?: string; state?: string; error?: string };

    // Handle errors from Cognito
    if (query.error) {
      fastify.log.error({ error: query.error, errorDescription: query }, 'OAuth error from Cognito');
      return reply.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(query.error)}`);
    }

    if (!query.code || !query.state) {
      fastify.log.warn({ query }, 'Missing code or state in callback');
      return reply.redirect(`${config.frontendUrl}/login?error=missing_parameters`);
    }

    // Retrieve stored nonce and state
    const storedNonce = nonces.get(query.state);
    const storedState = states.get(query.state);
    
    fastify.log.info({ 
      state: query.state, 
      hasNonce: !!storedNonce, 
      hasState: !!storedState,
      storedStates: Array.from(states.keys())
    }, 'Checking stored nonce and state');
    
    if (!storedNonce || !storedState) {
      fastify.log.error({ 
        receivedState: query.state,
        availableStates: Array.from(states.keys())
      }, 'Missing nonce or state in session');
      return reply.redirect(`${config.frontendUrl}/login?error=invalid_state`);
    }

    // Verify state matches
    if (query.state !== storedState) {
      fastify.log.error({ expected: storedState, received: query.state }, 'OAuth state mismatch');
      return reply.redirect(`${config.frontendUrl}/login?error=state_mismatch`);
    }

    try {
      // Get callback parameters from request
      const params = oidcClient.callbackParams(request.url);
      
      // Exchange authorization code for tokens (matching AWS example pattern)
      // Use backend callback URL - this is where Cognito redirects to
      const tokenSet = await oidcClient.callback(
        `${config.backendUrl}/api/auth/callback`,
        params,
        {
          nonce: storedNonce,
          state: storedState
        }
      );

      // Clean up stored values
      nonces.delete(query.state);
      states.delete(query.state);

      // Get user info (matching AWS example pattern exactly)
      // In the AWS example: const userInfo = await client.userinfo(tokenSet.access_token);
      const userInfo = await oidcClient.userinfo(tokenSet.access_token!);

      // In a real application, you would:
      // 1. Store the tokens securely (httpOnly cookies or secure storage)
      // 2. Create or update user in your database
      // 3. Create a session with userInfo

      // Store tokens in httpOnly cookies (secure) or redirect with tokens
      // For now, redirect to frontend with tokens in URL (in production, use httpOnly cookies)
      const redirectUrl = new URL(`${config.frontendUrl}/auth/callback`);
      
      // Pass tokens to frontend
      if (tokenSet.access_token) {
        redirectUrl.searchParams.set('access_token', tokenSet.access_token);
      }
      if (tokenSet.id_token) {
        redirectUrl.searchParams.set('id_token', tokenSet.id_token);
      }
      if (tokenSet.refresh_token) {
        redirectUrl.searchParams.set('refresh_token', tokenSet.refresh_token);
      }
      
      // Also pass user info
      if (userInfo) {
        redirectUrl.searchParams.set('user', JSON.stringify(userInfo));
      }

      fastify.log.info({ redirectUrl: redirectUrl.toString() }, 'Redirecting to frontend with tokens');
      return reply.redirect(redirectUrl.toString());
    } catch (error: any) {
      fastify.log.error({ 
        err: error, 
        message: error?.message,
        stack: error?.stack 
      }, 'OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(error?.message || 'authentication_failed')}`);
    }
  });

  /**
   * GET /api/auth/logout
   * Logout and redirect to Cognito logout
   */
  fastify.get('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const oidcClient = await initClient();
    
    if (!oidcClient) {
      return reply.redirect(`${config.frontendUrl}/login`);
    }

    // Build Cognito logout URL (matching AWS example pattern)
    if (!config.cognito.domain || !config.cognito.clientId) {
      fastify.log.warn('Cognito domain or client ID not configured for logout');
      return reply.redirect(`${config.frontendUrl}/login`);
    }

    const logoutUrl = `${config.frontendUrl}/login`;
    const cognitoLogoutUrl = `https://${config.cognito.domain}/logout?client_id=${config.cognito.clientId}&logout_uri=${encodeURIComponent(logoutUrl)}`;

    return reply.redirect(cognitoLogoutUrl);
  });

  /**
   * GET /api/auth/user
   * Get current user info (requires valid token)
   */
  fastify.get('/auth/user', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Valid access token required',
      });
    }

    const oidcClient = await initClient();
    if (!oidcClient) {
      return reply.code(503).send({
        error: 'OAuth not configured',
      });
    }

    const accessToken = authHeader.replace('Bearer ', '');

    try {
      const userInfo = await oidcClient.userinfo(accessToken);
      return {
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.name,
        email_verified: userInfo.email_verified,
      };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to get user info');
      return reply.code(401).send({
        error: 'Invalid token',
        message: 'Failed to validate access token',
      });
    }
  });

  /**
   * Helper function to compute SECRET_HASH for Cognito
   */
  const computeSecretHash = (username: string): string | undefined => {
    if (!config.cognito.clientSecret) {
      return undefined;
    }
    return createHmac('SHA256', config.cognito.clientSecret)
      .update(username + config.cognito.clientId)
      .digest('base64');
  };

  /**
   * Initialize Cognito Identity Provider Client
   */
  const getCognitoClient = (): CognitoIdentityProviderClient | null => {
    if (!config.cognito.userPoolId || !config.cognito.clientId) {
      return null;
    }
    return new CognitoIdentityProviderClient({
      region: config.cognito.region || config.aws.region || 'us-west-2',
    });
  };

  /**
   * POST /api/auth/signin
   * Sign in with username and password
   */
  fastify.post('/auth/signin', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string; password: string };
    
    if (!body.username || !body.password) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username and password are required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new InitiateAuthCommand({
        ClientId: config.cognito.clientId!,
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        AuthParameters: {
          USERNAME: body.username,
          PASSWORD: body.password,
          ...(secretHash && { SECRET_HASH: secretHash }),
        },
      });

      const response = await cognitoClient.send(command);

      if (!response.AuthenticationResult) {
        return reply.code(401).send({
          error: 'Authentication Failed',
          message: 'Invalid username or password',
        });
      }

      return {
        accessToken: response.AuthenticationResult.AccessToken,
        idToken: response.AuthenticationResult.IdToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
        expiresIn: response.AuthenticationResult.ExpiresIn,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Sign in error');
      return reply.code(401).send({
        error: 'Authentication Failed',
        message: error.message || 'Invalid username or password',
      });
    }
  });

  /**
   * POST /api/auth/signup
   * Sign up with username, password, and email
   */
  fastify.post('/auth/signup', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string; password: string; email: string };
    
    if (!body.username || !body.password || !body.email) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username, password, and email are required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new SignUpCommand({
        ClientId: config.cognito.clientId!,
        Username: body.username,
        Password: body.password,
        UserAttributes: [
          {
            Name: 'email',
            Value: body.email,
          },
        ],
        ...(secretHash && { SecretHash: secretHash }),
      });

      const response = await cognitoClient.send(command);

      return {
        userSub: response.UserSub,
        codeDeliveryDetails: response.CodeDeliveryDetails,
        userConfirmed: response.UserConfirmed,
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Sign up error');
      return reply.code(400).send({
        error: 'Sign Up Failed',
        message: error.message || 'Failed to create account',
      });
    }
  });

  /**
   * POST /api/auth/confirm
   * Confirm sign up with confirmation code
   */
  fastify.post('/auth/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string; code: string };
    
    if (!body.username || !body.code) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username and confirmation code are required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new ConfirmSignUpCommand({
        ClientId: config.cognito.clientId!,
        Username: body.username,
        ConfirmationCode: body.code,
        ...(secretHash && { SecretHash: secretHash }),
      });

      await cognitoClient.send(command);

      return {
        success: true,
        message: 'Account confirmed successfully',
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Confirm sign up error');
      return reply.code(400).send({
        error: 'Confirmation Failed',
        message: error.message || 'Invalid confirmation code',
      });
    }
  });

  /**
   * POST /api/auth/resend-code
   * Resend confirmation code
   */
  fastify.post('/auth/resend-code', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string };
    
    if (!body.username) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username is required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new ResendConfirmationCodeCommand({
        ClientId: config.cognito.clientId!,
        Username: body.username,
        ...(secretHash && { SecretHash: secretHash }),
      });

      const response = await cognitoClient.send(command);

      return {
        success: true,
        codeDeliveryDetails: response.CodeDeliveryDetails,
        message: 'Confirmation code resent successfully',
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Resend code error');
      return reply.code(400).send({
        error: 'Resend Failed',
        message: error.message || 'Failed to resend confirmation code',
      });
    }
  });

  /**
   * POST /api/auth/forgot-password
   * Initiate forgot password flow
   */
  fastify.post('/auth/forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string };
    
    if (!body.username) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username is required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new ForgotPasswordCommand({
        ClientId: config.cognito.clientId!,
        Username: body.username,
        ...(secretHash && { SecretHash: secretHash }),
      });

      const response = await cognitoClient.send(command);

      return {
        success: true,
        codeDeliveryDetails: response.CodeDeliveryDetails,
        message: 'Password reset code sent successfully',
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Forgot password error');
      return reply.code(400).send({
        error: 'Forgot Password Failed',
        message: error.message || 'Failed to send password reset code',
      });
    }
  });

  /**
   * POST /api/auth/confirm-forgot-password
   * Confirm forgot password with code and set new password
   */
  fastify.post('/auth/confirm-forgot-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username: string; code: string; newPassword: string };
    
    if (!body.username || !body.code || !body.newPassword) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Username, code, and new password are required',
      });
    }

    const cognitoClient = getCognitoClient();
    if (!cognitoClient) {
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Cognito is not configured',
      });
    }

    try {
      const secretHash = computeSecretHash(body.username);
      
      const command = new ConfirmForgotPasswordCommand({
        ClientId: config.cognito.clientId!,
        Username: body.username,
        ConfirmationCode: body.code,
        Password: body.newPassword,
        ...(secretHash && { SecretHash: secretHash }),
      });

      await cognitoClient.send(command);

      return {
        success: true,
        message: 'Password reset successfully',
      };
    } catch (error: any) {
      fastify.log.error({ err: error }, 'Confirm forgot password error');
      return reply.code(400).send({
        error: 'Password Reset Failed',
        message: error.message || 'Failed to reset password',
      });
    }
  });
}

