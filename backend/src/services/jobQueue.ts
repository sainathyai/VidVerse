import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config';
import { ConnectionOptions } from 'bullmq';

// Redis connection options - only if Redis is enabled and URL is provided
const getConnection = (): ConnectionOptions | undefined => {
  // Check if Redis is enabled via ENABLE_REDIS flag
  if (!config.redis.enabled) {
    return undefined;
  }
  
  // Check if REDIS_URL is provided
  if (!process.env.REDIS_URL) {
    return undefined;
  }
  
  const url = config.redis.url;
  
  // Parse Redis URL (supports both redis://host:port and redis://:password@host:port)
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const port = parseInt(urlObj.port || '6379', 10);
    const password = urlObj.password || undefined;
    
    return {
      host,
      port,
      password,
    };
  } catch (error) {
    // Fallback to simple parsing for redis://host:port format
    const match = url.match(/redis:\/\/(?:([^:@]+):([^@]+)@)?([^:]+):?(\d+)?/);
    if (match) {
      return {
        host: match[3] || 'localhost',
        port: parseInt(match[4] || '6379', 10),
        password: match[2] || undefined,
      };
    }
    return undefined;
  }
};

const connection = getConnection();

// Video generation queue - only create if Redis is configured
export const videoGenerationQueue: Queue | null = connection
  ? new Queue('video-generation', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100, // Keep max 100 completed jobs
        },
        removeOnFail: {
          age: 24 * 3600, // Keep failed jobs for 24 hours
        },
      },
    })
  : null;

export interface VideoGenerationJobData {
  projectId: string;
  userId: string;
  prompt: string;
  duration: number;
  style?: string;
  mood?: string;
  audioUrl?: string;
}

export interface VideoGenerationJobResult {
  videoUrl: string;
  sceneUrls: string[];
  frameUrls: { first: string; last: string }[];
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Add a video generation job to the queue
 * Returns null if Redis is not enabled/configured
 */
export async function enqueueVideoGeneration(
  data: VideoGenerationJobData
): Promise<Job<VideoGenerationJobData, VideoGenerationJobResult> | null> {
  if (!videoGenerationQueue) {
    return null;
  }
  const job = await videoGenerationQueue.add('generate-video', data, {
    jobId: `video-${data.projectId}-${Date.now()}`,
  });
  return job;
}

/**
 * Get job status
 * Returns null if Redis is not enabled/configured
 */
export async function getJobStatus(jobId: string): Promise<{
  id: string;
  status: string;
  progress: number;
  result?: VideoGenerationJobResult;
  error?: string;
} | null> {
  if (!videoGenerationQueue) {
    return null;
  }
  const job = await videoGenerationQueue.getJob(jobId);
  
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress as number || 0;

  return {
    id: job.id!,
    status: state,
    progress,
    result: job.returnvalue,
    error: job.failedReason,
  };
}

