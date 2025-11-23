import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import { config } from './config';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { assetRoutes } from './routes/assets';
import { jobRoutes } from './routes/jobs';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { imageRoutes } from './routes/images';
import multipart from '@fastify/multipart';
import { setFastifyInstance } from './middleware/cognito';
import { testConnection } from './services/database';
// Redis/job queue is disabled - using synchronous generation instead
// Worker import removed - all video generation is now synchronous via /api/projects/:id/generate-sync

// Initialize Sentry
if (config.sentry.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    tracesSampleRate: 1.0,
  });
}

const fastify = Fastify({
  disableRequestLogging: true,
  logger: {
    level: config.logLevel,
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        colorize: true,
      },
    } : undefined,
  },
});

// Set fastify instance for Cognito middleware logging
setFastifyInstance(fastify);

// Register plugins
async function registerPlugins() {
  // CORS - must be registered FIRST, before other plugins
  // Convert readonly array to regular array and log for debugging
  const allowedOriginsArray = Array.from(config.allowedOrigins);
  fastify.log.info({ allowedOrigins: allowedOriginsArray, frontendUrl: config.frontendUrl, nodeEnv: config.nodeEnv }, 'CORS configuration');
  
  await fastify.register(cors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOriginsArray.includes(origin)) {
        return callback(null, true);
      }
      fastify.log.warn({ origin, allowedOrigins: allowedOriginsArray }, 'CORS: Origin not allowed');
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    strictPreflight: false,
  });

  // Security headers - configure to allow CORS
  await fastify.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // Disable CSP to avoid CORS issues
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.maxRequests,
    timeWindow: config.rateLimit.windowMs,
    skipOnError: true,
  });

  // Multipart form data support
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
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
  await fastify.register(authRoutes, { prefix: '/api' });
  await fastify.register(projectRoutes, { prefix: '/api' });
  await fastify.register(assetRoutes, { prefix: '/api' });
  await fastify.register(jobRoutes, { prefix: '/api' });
  await fastify.register(chatRoutes, { prefix: '/api' });
  await fastify.register(imageRoutes, { prefix: '/api' });
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
    // Test database connection
    fastify.log.info('Testing database connection...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      fastify.log.warn('⚠️  Database connection failed. Server will start but database operations will fail.');
      fastify.log.warn('Please check your DATABASE_URL in backend/.env and ensure RDS is configured.');
    } else {
      fastify.log.info('✓ Database connection successful');
    }

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

