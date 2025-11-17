import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value?: string, defaultValue = false): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const normalizeOrigins = (value: string | undefined, fallback: string, isDevelopment: boolean): readonly string[] => {
  const tokens = value
    ? value.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  
  // In development, always include localhost origins
  const devOrigins = isDevelopment 
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : [];
  
  // Always include the fallback (FRONTEND_URL)
  const allOrigins = [...tokens, ...devOrigins, fallback];
  
  // Remove duplicates and normalize (remove trailing slashes)
  const deduped = Array.from(new Set(
    allOrigins.map(origin => origin.replace(/\/$/, ''))
  ));

  return deduped as readonly string[];
};

const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';

const DEFAULT_FRONTEND_URL = isDevelopment ? 'http://localhost:3000' : 'https://vidverseai.com';
const DEFAULT_BACKEND_URL = isDevelopment ? 'http://localhost:3001' : 'https://api.vidverseai.com';

const allowedOrigins = normalizeOrigins(process.env.ALLOWED_ORIGINS, process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL, isDevelopment);

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  frontendUrl: process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
  backendUrl: process.env.BACKEND_URL || DEFAULT_BACKEND_URL,
  allowedOrigins,
  isDevelopment,
  logLevel: (process.env.LOG_LEVEL || 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://vidverse:vidverse_dev@localhost:5432/vidverse',
    ssl: parseBoolean(process.env.DATABASE_SSL, false),
    sslRejectUnauthorized: parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    sslCaPath: process.env.DATABASE_SSL_CA_PATH,
  },

  redis: {
    enabled: parseBoolean(process.env.ENABLE_REDIS, false),
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    // AWS ElastiCache Redis configuration
    // For ElastiCache, use: redis://your-cluster.cache.amazonaws.com:6379
    // Or with auth: redis://:password@your-cluster.cache.amazonaws.com:6379
  },

  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  },

  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  storage: {
    bucketName: process.env.S3_BUCKET_NAME || 'vidverse-assets',
    region: process.env.S3_REGION || 'us-west-2',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
    // Use presigned URLs for private buckets (recommended for security)
    // Set to false to use public URLs (requires bucket to be public)
    usePresignedUrls: parseBoolean(process.env.S3_USE_PRESIGNED_URLS, true),
  },

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    clientSecret: process.env.COGNITO_CLIENT_SECRET, // Optional - only for confidential clients
    region: process.env.AWS_REGION || process.env.S3_REGION || 'us-west-2',
    domain: process.env.COGNITO_DOMAIN, // Optional - for hosted UI domain
  },
  
  aws: {
    region: process.env.AWS_REGION || process.env.S3_REGION || 'us-west-2',
  },

  replicate: {
    apiToken: process.env.REPLICATE_API_TOKEN,
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  },

  app: {
    frontendUrl: process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
  },

  ffmpeg: {
    path: process.env.FFMPEG_PATH || 'ffmpeg',
    // Auto-detect ffprobe path if FFMPEG_PATH is set (replace 'ffmpeg' with 'ffprobe' in path)
    ffprobePath: process.env.FFPROBE_PATH || (process.env.FFMPEG_PATH ? process.env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe'),
  },
} as const;

