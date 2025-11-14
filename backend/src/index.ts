import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { config } from './config';
import { healthRoutes } from './routes/health';

// Initialize Sentry
if (config.sentry.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    tracesSampleRate: 1.0,
  });
}

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
});

// Register plugins
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: config.frontendUrl,
    credentials: true,
  });

  // Security headers
  await fastify.register(helmet);

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.maxRequests,
    timeWindow: config.rateLimit.windowMs,
  });

  // Swagger documentation
  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'VidVerse API',
        description: 'AI Video Generation Pipeline API',
        version: '0.1.0',
      },
      host: config.backendUrl.replace(/^https?:\/\//, ''),
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });
}

// Register routes
async function registerRoutes() {
  await fastify.register(healthRoutes);
  // More routes will be added in future PRs
}

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);

  // Send to Sentry
  if (config.sentry.dsn) {
    Sentry.captureException(error, {
      tags: {
        path: request.url,
        method: request.method,
      },
    });
  }

  reply.status(error.statusCode || 500).send({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An unexpected error occurred',
    },
  });
});

// Start server
async function start() {
  try {
    await registerPlugins();
    await registerRoutes();

    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    fastify.log.info(`🚀 Server listening on ${address}`);
    fastify.log.info(`📚 API docs available at ${address}/docs`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down gracefully');
  await fastify.close();
  process.exit(0);
});

start();

