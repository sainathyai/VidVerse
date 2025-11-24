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

    // Parse config (may be string or object)
    const config = typeof projectData.config === 'string' 
      ? JSON.parse(projectData.config) 
      : (projectData.config || {});

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
      let previousSceneLastFrameUrl: string | undefined = undefined; // Track last frame from previous scene

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneProgress = 15 + (i / scenes.length) * 60; // 15% to 75%

        await job.updateProgress(sceneProgress);

        // Build video generation options
        const videoGenOptions: any = {
          prompt: scene.prompt,
          duration: scene.duration,
          videoModelId: config.videoModelId || 'google/veo-3.1', // Pass user's selected video model
          aspectRatio: config.aspectRatio || '16:9', // Pass aspect ratio
          style: config.style || style,
          mood: config.mood || mood,
          colorPalette: config.colorPalette,
          pacing: config.pacing,
        };
        
        // Use last frame from previous scene as reference for smooth transitions
        // Only if useReferenceFrame is enabled (defaults to false - user must opt-in)
        const shouldUseReferenceFrame = config.useReferenceFrame === true;
        
        // Explicitly ensure reference frame parameters are not included when disabled
        if (previousSceneLastFrameUrl && i > 0) {
          if (shouldUseReferenceFrame) {
            // For all models including Veo 3.1, use 'image' parameter for reference image from previous scene
            // The 'image' parameter is used as a reference/starting point for the next clip
            videoGenOptions.image = previousSceneLastFrameUrl;
            const selectedModelId = config.videoModelId || 'google/veo-3.1';
            console.log(`[WORKER] Using last frame from scene ${i} as reference image for next clip (model: ${selectedModelId}): ${previousSceneLastFrameUrl}`);
          } else {
            // Explicitly ensure these are not set when useReferenceFrame is false
            delete videoGenOptions.image;
            delete videoGenOptions.lastFrame;
            console.log(`[WORKER] Skipping reference frame for scene ${i + 1} (useReferenceFrame disabled) - not including in Replicate API call`);
          }
        } else {
          // Ensure these are not set for first scene or when no previous frame exists
          delete videoGenOptions.image;
          delete videoGenOptions.lastFrame; // Keep for backward compatibility, but not used
        }

        // Generate video for scene with user's selected video model and aspect ratio
        const result = await generateVideo(videoGenOptions);

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

        // Download scene video from Replicate and upload to S3 - MANDATORY
        console.log(`[WORKER] Downloading scene ${scene.sceneNumber} video from Replicate and uploading to S3`);
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video from Replicate: ${videoResponse.statusText}`);
        }
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        console.log(`[WORKER] Video downloaded (${videoBuffer.length} bytes), uploading to S3`);
        
        const sceneVideoUpload = await uploadGeneratedVideo(
          videoBuffer,
          userId,
          projectId,
          `scene-${scene.sceneNumber}.mp4`
        );
        
        // Use S3 URL instead of Replicate URL
        videoUrl = sceneVideoUpload.url;
        console.log(`[WORKER] Scene ${scene.sceneNumber} video successfully uploaded to S3: ${videoUrl}`);
        
        sceneVideos.push(videoUrl);

        // Extract frames (non-blocking - if it fails, we still save the scene)
        let frames: { firstFrameUrl: string; lastFrameUrl: string } | null = null;
        try {
          frames = await extractFrames(videoUrl, userId, projectId, scene.sceneNumber);
          frameUrls.push({ first: frames.firstFrameUrl, last: frames.lastFrameUrl });
          
          // Store last frame URL for next scene (use full S3 URL)
          previousSceneLastFrameUrl = frames.lastFrameUrl;
          console.log(`[WORKER] Stored last frame URL for scene ${scene.sceneNumber}: ${previousSceneLastFrameUrl} (will use for next scene: ${i < scenes.length - 1})`);
        } catch (frameError: any) {
          console.warn(`[WORKER] Frame extraction failed for scene ${scene.sceneNumber}, continuing without frames:`, frameError.message);
          // Continue without frames - video URL is more important
        }

        // Store scene in database (ALWAYS save video URL, even if frame extraction failed)
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
            videoUrl, // Always save video URL - this is the critical data
            frames?.firstFrameUrl || null, // NULL if frame extraction failed
            frames?.lastFrameUrl || null, // NULL if frame extraction failed
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
      await job.updateProgress(92);

      // 6.5. Extract and upload thumbnail from final video
      let thumbnailUrl: string | null = null;
      try {
        console.log(`[WORKER] Extracting thumbnail from final video for project ${projectId}`);
        const { extractThumbnail } = await import('../services/videoProcessor');
        const thumbnailResult = await extractThumbnail(finalVideoPath, userId, projectId);
        thumbnailUrl = thumbnailResult.thumbnailUrl;
        console.log(`[WORKER] Thumbnail extracted and uploaded successfully: ${thumbnailUrl}`);
      } catch (thumbnailError: any) {
        console.warn(`[WORKER] Failed to extract thumbnail for project ${projectId}, continuing without it:`, thumbnailError.message);
        // Don't fail the entire job if thumbnail extraction fails
      }
      await job.updateProgress(95);

      // 7. Update project in database
      const currentConfig = typeof projectData.config === 'string' 
        ? JSON.parse(projectData.config) 
        : (projectData.config || {});
      currentConfig.videoUrl = uploadResult.url;
      currentConfig.finalVideoUrl = uploadResult.url; // Also save as finalVideoUrl for frontend compatibility
      currentConfig.sceneUrls = sceneVideos; // Save scene URLs
      if (thumbnailUrl) {
        currentConfig.thumbnailUrl = thumbnailUrl;
      }

      // Check if thumbnail_url column exists and update it
      const columnCheck = await query(
        `SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'projects' 
          AND column_name = 'thumbnail_url'
        ) as exists`
      );
      const hasThumbnailUrlColumn = columnCheck[0]?.exists || false;

      if (hasThumbnailUrlColumn && thumbnailUrl) {
        await query(
          `UPDATE projects 
           SET status = 'completed', 
               config = $1, 
               thumbnail_url = $2,
               updated_at = NOW() 
           WHERE id = $3`,
          [JSON.stringify(currentConfig), thumbnailUrl, projectId]
        );
      } else {
        await query(
          `UPDATE projects SET status = 'completed', config = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(currentConfig), projectId]
        );
      }

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

