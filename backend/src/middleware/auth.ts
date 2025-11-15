import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Simple authentication middleware
 * In production, replace with proper JWT validation (Clerk, Auth0, etc.)
 */
export async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // For now, we'll use a simple header-based auth
  // In production, validate JWT token from Clerk/Auth0
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    // For development, allow requests without auth
    // In production, uncomment the following:
    // return reply.code(401).send({ error: 'Unauthorized' });
    (request as any).user = { id: 'user-123', email: 'dev@example.com' };
    return;
  }

  // Extract token from "Bearer <token>"
  const token = authHeader.replace('Bearer ', '');

  // TODO: Validate JWT token
  // const decoded = await verifyJWT(token);
  // (request as any).user = await getUserById(decoded.sub);

  // For now, accept any token in development
  (request as any).user = { id: 'user-123', email: 'dev@example.com' };
}

/**
 * Get current user from request
 */
export function getCurrentUser(request: FastifyRequest): { id: string; email: string } {
  return (request as any).user || { id: 'user-123', email: 'dev@example.com' };
}

