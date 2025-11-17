import { FastifyRequest, FastifyReply } from 'fastify';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from '../config';

// Import fastify instance for logging (will be passed in)
let fastifyInstance: any = null;

export function setFastifyInstance(instance: any) {
  fastifyInstance = instance;
}

// Create JWT verifier
let verifier: any = null;

if (config.cognito.userPoolId && config.cognito.clientId) {
  verifier = CognitoJwtVerifier.create({
    userPoolId: config.cognito.userPoolId,
    tokenUse: 'access' as const,
    clientId: config.cognito.clientId,
  });
}

export interface CognitoUser {
  sub: string; // User ID
  email?: string;
  username: string;
  'cognito:groups'?: string[];
}

/**
 * Verify Cognito JWT token and extract user information
 */
export async function verifyCognitoToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<CognitoUser | null> {
  // Skip verification in development if no Cognito config
  if (!verifier || !config.cognito.userPoolId) {
    // Development fallback
    return {
      sub: 'dev-user-123',
      username: 'dev-user',
      email: 'dev@example.com',
    };
  }

  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = await verifier.verify(token);
    
    if (fastifyInstance) {
      fastifyInstance.log.debug({ sub: payload.sub, email: payload.email }, 'Token verified successfully');
    }
    
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      username: (payload.username || payload['cognito:username'] || payload.email) as string,
      'cognito:groups': payload['cognito:groups'] as string[] | undefined,
    };
  } catch (error: any) {
    // Log error with details for debugging
    if (fastifyInstance) {
      fastifyInstance.log.error({ 
        err: error,
        message: error?.message,
        name: error?.name,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 20) + '...'
      }, 'Token verification failed');
    }
    return null;
  }
}

/**
 * Authentication middleware for protected routes
 */
export async function authenticateCognito(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = await verifyCognitoToken(request, reply);

  if (!user) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Valid authentication token required',
    });
  }

  // Attach user to request
  (request as any).user = user;
}

/**
 * Get current user from request (after authentication)
 */
export function getCognitoUser(request: FastifyRequest): CognitoUser {
  return (request as any).user;
}

