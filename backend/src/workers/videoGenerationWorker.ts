import { Worker, Job, ConnectionOptions } from 'bullmq';
import { config } from '../config';
import { videoGenerationQueue, VideoGenerationJobData, VideoGenerationJobResult } from '../services/jobQueue';
import { parsePrompt } from '../services/promptParser';
import { planScenes } from '../services/scenePlanner';
import { generateVideo } from '../services/replicate';
import { extractFrames, concatenateVideos, addAudioToVideo } from '../services/videoProcessor';
import { uploadGeneratedVideo } from '../services/storage';
import { query, queryOne } from '../services/database';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Only create connection if Redis is enabled
const getConnection = (): ConnectionOptions | undefined => {
  if (!config.redis.enabled || !process.env.REDIS_URL) {
    return undefined;
  }
  
  const url = config.redis.url;
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

// Create worker to process video generation jobs - only if Redis is configured
export const videoGenerationWorker: Worker<VideoGenerationJobData, VideoGenerationJobResult> | null = connection && videoGenerationQueue
  ? new Worker<VideoGenerationJobData, VideoGenerationJobResult>(
  'video-generation',
  async (job: Job<VideoGenerationJobData, VideoGenerationJobResult>) => {
    const { projectId, userId, prompt, duration, style, mood, audioUrl } = job.data;

    // Get project data from database
    const projectData = await queryOne(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );

    if (!projectData) {
      throw new Error('Project not found');
    }

    try {
      // Update job progress
      await job.updateProgress(5);

      // 1. Parse prompt
      const parsedPrompt = parsePrompt(prompt, duration);
      if (style) parsedPrompt.style = style;
      if (mood) parsedPrompt.mood = mood;
      await job.updateProgress(10);

      // 2. Plan scenes
      const scenes = planScenes(prompt, parsedPrompt, duration);
      await job.updateProgress(15);

      // 3. Generate videos for each scene
      const sceneVideos: string[] = [];
      const frameUrls: { first: string; last: string }[] = [];

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneProgress = 15 + (i / scenes.length) * 60; // 15% to 75%

        await job.updateProgress(sceneProgress);

        // Generate video for scene
        const result = await generateVideo({
          prompt: scene.prompt,
          duration: scene.duration,
        });

        if (result.status === 'failed') {
          throw new Error(`Scene ${scene.sceneNumber} generation failed: ${result.error}`);
        }

        // Handle different output formats from Replicate
        let videoUrl: string;
        if (Array.isArray(result.output)) {
          videoUrl = result.output[0];
        } else if (typeof result.output === 'string') {
          videoUrl = result.output;
        } else {
          throw new Error(`Unexpected output format from Replicate: ${typeof result.output}`);
        }

        // Download scene video from Replicate and upload to S3
        try {
          const videoResponse = await fetch(videoUrl);
          if (!videoResponse.ok) {
            throw new Error(`Failed to download video from Replicate: ${videoResponse.statusText}`);
          }
          const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
          
          const sceneVideoUpload = await uploadGeneratedVideo(
            videoBuffer,
            userId,
            projectId,
            `scene-${scene.sceneNumber}.mp4`
          );
          
          // Use S3 URL instead of Replicate URL
          videoUrl = sceneVideoUpload.url;
        } catch (uploadError: any) {
          console.error(`Failed to upload scene ${scene.sceneNumber} video to S3, using Replicate URL as fallback:`, uploadError.message);
          // Continue with Replicate URL as fallback
        }
        
        sceneVideos.push(videoUrl);

        // Extract frames
        const frames = await extractFrames(videoUrl, userId, projectId, scene.sceneNumber);
        frameUrls.push({ first: frames.firstFrameUrl, last: frames.lastFrameUrl });

        // Store scene in database
        await query(
          `INSERT INTO scenes (project_id, scene_number, prompt, duration, start_time, video_url, first_frame_url, last_frame_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (project_id, scene_number) DO UPDATE
           SET prompt = $3, duration = $4, start_time = $5, video_url = $6, first_frame_url = $7, last_frame_url = $8, updated_at = NOW()`,
          [
            projectId,
            scene.sceneNumber,
            scene.prompt,
            scene.duration,
            scene.startTime,
            videoUrl,
            frames.firstFrameUrl,
            frames.lastFrameUrl,
          ]
        );
      }

      await job.updateProgress(75);

      // 4. Concatenate videos
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-final-'));
      const concatVideoPath = path.join(tempDir, 'concat.mp4');
      await concatenateVideos(sceneVideos, concatVideoPath);
      await job.updateProgress(85);

      // 5. Add audio if provided
      let finalVideoPath = concatVideoPath;
      if (audioUrl) {
        const finalPath = path.join(tempDir, 'final.mp4');
        await addAudioToVideo(concatVideoPath, audioUrl, finalPath);
        finalVideoPath = finalPath;
      }
      await job.updateProgress(90);

      // 6. Upload final video to S3
      const finalVideoBuffer = await fs.readFile(finalVideoPath);
      const uploadResult = await uploadGeneratedVideo(
        finalVideoBuffer,
        userId,
        projectId,
        'output.mp4'
      );
      await job.updateProgress(95);

      // 7. Update project in database
      const currentConfig = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});
      currentConfig.videoUrl = uploadResult.url;
      await query(
        `UPDATE projects SET status = 'completed', config = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(currentConfig), projectId]
      );

      // Cleanup temp files
      await fs.rm(tempDir, { recursive: true, force: true });

      await job.updateProgress(100);

      return {
        videoUrl: uploadResult.url,
        sceneUrls: sceneVideos,
        frameUrls,
        status: 'completed',
      };
    } catch (error: any) {
      // Update project status to failed
      await query(
        `UPDATE projects SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [projectId]
      );

      throw error;
    }
  },
      {
        connection,
        concurrency: 2, // Process 2 jobs concurrently
      }
    )
  : null;

// Worker event handlers - only if worker is created
if (videoGenerationWorker) {
  videoGenerationWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed successfully`);
  });

  videoGenerationWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err);
  });

  videoGenerationWorker.on('error', (err) => {
    console.error('Worker error:', err);
  });
} else {
  console.warn('⚠️  Redis not enabled. Video generation worker is disabled. Set ENABLE_REDIS=true and REDIS_URL to enable job queues.');
}

