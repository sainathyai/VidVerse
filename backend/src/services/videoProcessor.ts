import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { uploadFrame, uploadGeneratedVideo } from './storage';

// Set FFmpeg and FFprobe paths
if (config.ffmpeg.path) {
  ffmpeg.setFfmpegPath(config.ffmpeg.path);
  console.log(`[VIDEO_PROCESSOR] FFmpeg path set to: ${config.ffmpeg.path}`);
}
if (config.ffmpeg.ffprobePath) {
  ffmpeg.setFfprobePath(config.ffmpeg.ffprobePath);
  console.log(`[VIDEO_PROCESSOR] FFprobe path set to: ${config.ffmpeg.ffprobePath}`);
} else {
  console.warn('[VIDEO_PROCESSOR] FFprobe path not set. Frame extraction may fail. Set FFPROBE_PATH in your .env file.');
}

export interface FrameExtractionResult {
  firstFrameUrl: string;
  lastFrameUrl: string;
}

export interface ThumbnailResult {
  thumbnailUrl: string;
}

/**
 * Extract first and last frames from a video
 */
export async function extractFrames(
  videoUrl: string,
  userId: string,
  projectId: string,
  sceneNumber: number
): Promise<FrameExtractionResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-'));
  const videoPath = path.join(tempDir, `video-${sceneNumber}.mp4`);
  const firstFramePath = path.join(tempDir, `first-${sceneNumber}.jpg`);
  const lastFramePath = path.join(tempDir, `last-${sceneNumber}.jpg`);

  try {
    // Check if ffprobe is available
    if (!config.ffmpeg.ffprobePath || config.ffmpeg.ffprobePath === 'ffprobe') {
      console.warn('[VIDEO_PROCESSOR] FFprobe path not configured. Frame extraction may fail.');
    }

    // Download video to local file first (more reliable than processing from URL)
    console.log(`[VIDEO_PROCESSOR] Downloading video from ${videoUrl}`);
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    await fs.writeFile(videoPath, videoBuffer);
    console.log(`[VIDEO_PROCESSOR] Video downloaded, size: ${videoBuffer.length} bytes`);

    return new Promise((resolve, reject) => {
      // Get video duration and frame rate first
      ffmpeg(videoPath)
        .ffprobe((err, metadata) => {
          if (err) {
            // Cleanup temp files (fire-and-forget, don't block on it)
            fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            // If ffprobe is not found, provide helpful error message
            if (err.message && err.message.includes('Cannot find ffprobe')) {
              reject(new Error(`FFprobe not found. Please install FFmpeg and set FFPROBE_PATH in your .env file. On Windows, download from https://ffmpeg.org/download.html and set FFPROBE_PATH to the full path (e.g., C:\\ffmpeg\\bin\\ffprobe.exe)`));
            } else {
              reject(new Error(`FFprobe error: ${err.message}`));
            }
            return;
          }

          const duration = metadata.format?.duration || 0;
          
          // Validate duration
          if (!duration || duration <= 0 || !isFinite(duration)) {
            fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            reject(new Error(`Invalid video duration: ${duration}. Video may be corrupted or empty.`));
            return;
          }
          
          // Get frame rate from video stream
          // Try to get fps from video stream, fallback to r_frame_rate calculation
          let fps = 30; // Default fallback
          if (metadata.streams && metadata.streams.length > 0) {
            const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
            if (videoStream) {
              if (videoStream.r_frame_rate) {
                // r_frame_rate is in format "30/1" or "29970/1000"
                const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
                if (den && den > 0) {
                  fps = num / den;
                }
              } else if (videoStream.avg_frame_rate) {
                const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
                if (den && den > 0) {
                  fps = num / den;
                }
              }
            }
          }
          
          console.log(`[VIDEO_PROCESSOR] Video duration: ${duration} seconds, FPS: ${fps}`);

          // Calculate timestamps
          // First frame: 0.5s to avoid black frames
          const firstTimestamp = Math.min(0.5, duration * 0.1); // Use 10% of duration or 0.5s, whichever is smaller
          
          // Last frame: Calculate exact timestamp of the last frame
          // Frame interval = 1/fps
          // Last frame time = duration - (1/fps) to get the exact last frame
          // For very short videos, ensure it's at least one frame interval after the first frame
          const frameInterval = 1 / fps;
          let lastTimestamp = duration - frameInterval; // Exact last frame timestamp
          
          // Safety check: ensure last frame is after first frame (for very short videos)
          if (lastTimestamp <= firstTimestamp || lastTimestamp < 0) {
            // For extremely short videos, use a position that's at least one frame after the first
            lastTimestamp = Math.max(firstTimestamp + frameInterval, Math.min(duration * 0.9, duration - 0.01)); // At least 0.01s before end, or 90% of duration
            console.warn(`[VIDEO_PROCESSOR] Video is very short (${duration}s), adjusting last frame timestamp to ${lastTimestamp}s`);
          }
          
          // Final validation: ensure timestamps are valid
          if (firstTimestamp < 0 || lastTimestamp < 0 || firstTimestamp >= duration || lastTimestamp >= duration) {
            fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            reject(new Error(`Invalid timestamps calculated: first=${firstTimestamp}s, last=${lastTimestamp}s, duration=${duration}s`));
            return;
          }
          
          console.log(`[VIDEO_PROCESSOR] Extracting first frame at ${firstTimestamp}s and last frame at ${lastTimestamp}s (frame interval: ${frameInterval.toFixed(4)}s)`);

          // Extract first frame
          ffmpeg(videoPath)
            .screenshots({
              timestamps: [firstTimestamp],
              filename: `first-${sceneNumber}.jpg`,
              folder: tempDir,
              size: '1920x1080',
            })
            .on('end', async () => {
              try {
                // Verify first frame file exists
                await fs.access(firstFramePath);
                console.log(`[VIDEO_PROCESSOR] First frame extracted at ${firstTimestamp}s`);
                
                // Extract last frame using calculated timestamp (duration - frame interval)
                // This gives us the exact last frame, not 0.5s before the end
                // Use screenshots with the calculated lastTimestamp which is: duration - (1/fps)
                ffmpeg(videoPath)
                .screenshots({
                  timestamps: [lastTimestamp],
                  filename: `last-${sceneNumber}.jpg`,
                  folder: tempDir,
                  size: '1920x1080',
                })
                .on('end', async () => {
                  try {
                    console.log(`[VIDEO_PROCESSOR] Last frame extracted at ${lastTimestamp}s (calculated from duration ${duration}s - frame interval ${frameInterval.toFixed(4)}s)`);
                    
                    // Verify frame files exist before reading
                    try {
                      await fs.access(firstFramePath);
                      await fs.access(lastFramePath);
                    } catch (accessError) {
                      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
                      reject(new Error(`Frame files not created: ${accessError instanceof Error ? accessError.message : 'Unknown error'}`));
                      return;
                    }
                    
                    // Upload frames to S3
                    const firstFrameBuffer = await fs.readFile(firstFramePath);
                    const lastFrameBuffer = await fs.readFile(lastFramePath);
                    
                    // Validate frame buffers are not empty
                    if (!firstFrameBuffer || firstFrameBuffer.length === 0) {
                      throw new Error('First frame buffer is empty');
                    }
                    if (!lastFrameBuffer || lastFrameBuffer.length === 0) {
                      throw new Error('Last frame buffer is empty');
                    }

                    const [firstFrameResult, lastFrameResult] = await Promise.all([
                      uploadFrame(firstFrameBuffer, userId, projectId, `scene-${sceneNumber}`, 'first'),
                      uploadFrame(lastFrameBuffer, userId, projectId, `scene-${sceneNumber}`, 'last'),
                    ]);

                    // Cleanup temp files
                    await fs.rm(tempDir, { recursive: true, force: true });

                    resolve({
                      firstFrameUrl: firstFrameResult.url,
                      lastFrameUrl: lastFrameResult.url,
                    });
                  } catch (error: any) {
                    await fs.rm(tempDir, { recursive: true, force: true });
                    reject(error);
                  }
                })
                .on('error', async (err) => {
                  await fs.rm(tempDir, { recursive: true, force: true });
                  reject(new Error(`Failed to extract last frame at ${lastTimestamp}s: ${err.message}. Video duration: ${duration}s, FPS: ${fps}, Frame interval: ${frameInterval.toFixed(4)}s`));
                });
              } catch (firstFrameError: any) {
                await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
                reject(new Error(`First frame file not created or inaccessible: ${firstFrameError.message}`));
              }
            })
            .on('error', async (err) => {
              await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
              reject(new Error(`Failed to extract first frame at ${firstTimestamp}s: ${err.message}`));
            });
        });
    });
  } catch (error: any) {
    // Cleanup on any error
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to download video for frame extraction: ${error.message}`);
  }
}

/**
 * Concatenate multiple video clips into one
 */
export async function concatenateVideos(
  videoUrls: string[],
  outputPath: string
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-concat-'));
  const listFile = path.join(tempDir, 'list.txt');

  // Download videos and create concat list
  const localPaths: string[] = [];
  for (let i = 0; i < videoUrls.length; i++) {
    const response = await fetch(videoUrls[i]);
    const buffer = await response.arrayBuffer();
    const localPath = path.join(tempDir, `clip-${i}.mp4`);
    await fs.writeFile(localPath, Buffer.from(buffer));
    localPaths.push(localPath);
  }

  // Create concat list file
  // Use absolute paths with forward slashes for cross-platform compatibility
  const listContent = localPaths.map(p => {
    const normalizedPath = path.resolve(p).replace(/\\/g, '/');
    return `file '${normalizedPath}'`;
  }).join('\n');
  await fs.writeFile(listFile, listContent);

  // Log the list file content for debugging (first 500 chars)
  console.log(`[VIDEO_PROCESSOR] Concat list file content (first 500 chars): ${listContent.substring(0, 500)}`);
  console.log(`[VIDEO_PROCESSOR] FFmpeg path: ${config.ffmpeg.path}, FFprobe path: ${config.ffmpeg.ffprobePath}`);
  console.log(`[VIDEO_PROCESSOR] Output path: ${outputPath}, Temp dir: ${tempDir}`);

  return new Promise((resolve, reject) => {
    const ffmpegCommand = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy']) // Copy codec (no re-encoding for speed)
      .output(outputPath);

    // Add stderr logging to capture ffmpeg output
    let stderrOutput = '';
    ffmpegCommand.on('stderr', (stderrLine) => {
      stderrOutput += stderrLine + '\n';
      console.log(`[VIDEO_PROCESSOR] FFmpeg stderr: ${stderrLine}`);
    });

    ffmpegCommand
      .on('end', async () => {
        console.log(`[VIDEO_PROCESSOR] Video concatenation completed successfully`);
        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
        resolve();
      })
      .on('error', async (err: Error) => {
        const errorMessage = err.message || 'Unknown error';
        const fullError = `FFmpeg concatenation failed: ${errorMessage}\nFFmpeg stderr output:\n${stderrOutput}\nFFmpeg path: ${config.ffmpeg.path}\nFFprobe path: ${config.ffmpeg.ffprobePath}`;
        console.error(`[VIDEO_PROCESSOR] ${fullError}`);
        
        // Check for common errors
        if (errorMessage.includes('Cannot find ffmpeg') || errorMessage.includes('ffmpeg: not found')) {
          reject(new Error(`FFmpeg not found at ${config.ffmpeg.path}. Please ensure FFmpeg is installed and FFMPEG_PATH is set correctly. In Alpine Linux containers, FFmpeg should be at /usr/bin/ffmpeg.`));
        } else if (errorMessage.includes('Invalid data found') || errorMessage.includes('concat')) {
          reject(new Error(`FFmpeg concat error: ${errorMessage}. This may indicate an issue with the video files or the concat list format.`));
        } else {
          reject(new Error(fullError));
        }
        
        // Cleanup on error
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      })
      .run();
  });
}

/**
 * Extract thumbnail (first frame) from a video file
 * This is used for generating project thumbnails from final stitched videos
 */
export async function extractThumbnail(
  videoPath: string,
  userId: string,
  projectId: string
): Promise<ThumbnailResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-thumbnail-'));
  const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');

  try {
    // Check if ffprobe is available
    if (!config.ffmpeg.ffprobePath || config.ffmpeg.ffprobePath === 'ffprobe') {
      console.warn('[VIDEO_PROCESSOR] FFprobe path not configured. Thumbnail extraction may fail.');
    }

    return new Promise((resolve, reject) => {
      // Extract first frame at 0.5 seconds to avoid black frames
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [0.5],
          filename: 'thumbnail.jpg',
          folder: tempDir,
          size: '1920x1080',
        })
        .on('end', async () => {
          try {
            // Verify thumbnail file exists
            await fs.access(thumbnailPath);
            console.log(`[VIDEO_PROCESSOR] Thumbnail extracted successfully`);

            // Read thumbnail buffer
            const thumbnailBuffer = await fs.readFile(thumbnailPath);

            // Validate buffer is not empty
            if (!thumbnailBuffer || thumbnailBuffer.length === 0) {
              throw new Error('Thumbnail buffer is empty');
            }

            // Upload thumbnail to S3
            const { uploadFile } = await import('./storage');
            const thumbnailResult = await uploadFile(
              thumbnailBuffer,
              userId,
              'image',
              'image/jpeg',
              projectId,
              'thumbnail.jpg'
            );

            // Cleanup temp files
            await fs.rm(tempDir, { recursive: true, force: true });

            resolve({
              thumbnailUrl: thumbnailResult.url,
            });
          } catch (error: any) {
            await fs.rm(tempDir, { recursive: true, force: true });
            reject(new Error(`Failed to process thumbnail: ${error.message}`));
          }
        })
        .on('error', async (err) => {
          await fs.rm(tempDir, { recursive: true, force: true });
          reject(new Error(`Failed to extract thumbnail: ${err.message}`));
        });
    });
  } catch (error: any) {
    // Cleanup on any error
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to extract thumbnail: ${error.message}`);
  }
}

/**
 * Add audio overlay to video
 */
export async function addAudioToVideo(
  videoPath: string,
  audioUrl: string,
  outputPath: string
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-audio-'));
  const audioPath = path.join(tempDir, 'audio.mp3');
  const loopedAudioPath = path.join(tempDir, 'audio-looped.mp3');

  // Download audio
  const response = await fetch(audioUrl);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(audioPath, Buffer.from(buffer));

  return new Promise((resolve, reject) => {
    // First, get video duration
    ffmpeg(videoPath)
      .ffprobe((err, metadata) => {
        if (err) {
          fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          reject(new Error(`Failed to probe video: ${err.message}`));
          return;
        }

        const videoDuration = metadata.format?.duration || 0;
        
        if (videoDuration <= 0 || !isFinite(videoDuration)) {
          fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          reject(new Error('Invalid video duration'));
          return;
        }

        // Get audio duration
        ffmpeg(audioPath)
          .ffprobe((audioErr, audioMetadata) => {
            if (audioErr) {
              fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
              reject(new Error(`Failed to probe audio: ${audioErr.message}`));
              return;
            }

            const audioDuration = audioMetadata.format?.duration || 0;
            
            // If audio is shorter than video, loop it to match video length
            if (audioDuration > 0 && audioDuration < videoDuration) {
              const loopCount = Math.ceil(videoDuration / audioDuration);
              console.log(`[VIDEO_PROCESSOR] Audio (${audioDuration.toFixed(2)}s) is shorter than video (${videoDuration.toFixed(2)}s). Looping ${loopCount} times.`);
              
              // Create looped audio using filter_complex
              ffmpeg()
                .input(audioPath)
                .inputOptions(['-stream_loop', String(loopCount - 1)]) // Loop count (0 = no loop, 1 = play twice, etc.)
                .outputOptions([
                  '-t', String(videoDuration), // Trim to exact video duration
                  '-c:a', 'aac',
                ])
                .output(loopedAudioPath)
                .on('end', () => {
                  // Now add the looped audio to video
                  addAudioToVideoWithPath(videoPath, loopedAudioPath, outputPath, tempDir, resolve, reject);
                })
                .on('error', async (loopErr) => {
                  await fs.rm(tempDir, { recursive: true, force: true });
                  reject(new Error(`Failed to loop audio: ${loopErr.message}`));
                })
                .run();
            } else {
              // Audio is long enough, use it directly
              addAudioToVideoWithPath(videoPath, audioPath, outputPath, tempDir, resolve, reject);
            }
          });
      });
  });
}

function addAudioToVideoWithPath(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  tempDir: string,
  resolve: () => void,
  reject: (err: Error) => void
): void {
  ffmpeg(videoPath)
    .input(audioPath)
    .outputOptions([
      '-c:v', 'copy', // Copy video codec
      '-c:a', 'aac', // Encode audio as AAC
      '-shortest', // Match shortest stream (should be video now since audio is looped/extended)
      '-map', '0:v:0', // Map video from first input
      '-map', '1:a:0', // Map audio from second input
    ])
    .output(outputPath)
    .on('end', async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
      resolve();
    })
    .on('error', async (err) => {
      await fs.rm(tempDir, { recursive: true, force: true });
      reject(err);
    })
    .run();
}

/**
 * Trim video to specific time range
 */
export async function trimVideo(
  videoPath: string,
  startTime: number,
  endTime: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .outputOptions([
        '-c', 'copy', // Copy codec for speed (no re-encoding)
      ])
      .output(outputPath)
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

/**
 * Apply video effect
 */
export async function applyVideoEffect(
  videoPath: string,
  effect: string,
  effectParams: Record<string, any> = {},
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let ffmpegCommand = ffmpeg(videoPath);

    switch (effect) {
      case 'fade_in':
        const fadeInDuration = effectParams.duration || 1;
        ffmpegCommand = ffmpegCommand.videoFilters(`fade=t=in:st=0:d=${fadeInDuration}`);
        break;
      
      case 'fade_out':
        // Need video duration first
        ffmpeg(videoPath).ffprobe((err, metadata) => {
          if (err) return reject(err);
          const duration = metadata.format.duration || 0;
          const fadeOutDuration = effectParams.duration || 1;
          const fadeStart = Math.max(0, duration - fadeOutDuration);
          ffmpegCommand = ffmpeg(videoPath).videoFilters(`fade=t=out:st=${fadeStart}:d=${fadeOutDuration}`);
          processEffect();
        });
        return;

      case 'blur':
        const blurAmount = effectParams.amount || 5;
        ffmpegCommand = ffmpegCommand.videoFilters(`boxblur=${blurAmount}:${blurAmount}`);
        break;

      case 'brightness':
        const brightness = effectParams.value || 0;
        ffmpegCommand = ffmpegCommand.videoFilters(`eq=brightness=${brightness}`);
        break;

      case 'contrast':
        const contrast = effectParams.value || 1;
        ffmpegCommand = ffmpegCommand.videoFilters(`eq=contrast=${contrast}`);
        break;

      case 'saturation':
        const saturation = effectParams.value || 1;
        ffmpegCommand = ffmpegCommand.videoFilters(`eq=saturation=${saturation}`);
        break;

      case 'vintage':
        ffmpegCommand = ffmpegCommand.videoFilters([
          'curves=vintage',
          'eq=saturation=0.8:contrast=1.1'
        ]);
        break;

      case 'black_white':
        ffmpegCommand = ffmpegCommand.videoFilters('hue=s=0');
        break;

      default:
        return reject(new Error(`Unknown effect: ${effect}`));
    }

    processEffect();

    function processEffect() {
      ffmpegCommand
        .outputOptions(['-c:a', 'copy'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    }
  });
}

/**
 * Apply transition between two videos
 */
export async function applyTransition(
  video1Path: string,
  video2Path: string,
  transition: string,
  duration: number = 1,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get video durations
    ffmpeg(video1Path).ffprobe((err1, metadata1) => {
      if (err1) return reject(err1);
      
      ffmpeg(video2Path).ffprobe((err2, metadata2) => {
        if (err2) return reject(err2);

        const duration1 = metadata1.format.duration || 0;
        const duration2 = metadata2.format.duration || 0;
        const transitionDuration = Math.min(duration, duration1, duration2);

        let filterComplex = '';

        switch (transition) {
          case 'fade':
            filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'slide_left':
            filterComplex = `[0:v][1:v]xfade=transition=slideleft:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'slide_right':
            filterComplex = `[0:v][1:v]xfade=transition=slideright:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'slide_up':
            filterComplex = `[0:v][1:v]xfade=transition=slideup:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'slide_down':
            filterComplex = `[0:v][1:v]xfade=transition=slidedown:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'zoom_in':
            filterComplex = `[0:v][1:v]xfade=transition=zoomin:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'zoom_out':
            filterComplex = `[0:v][1:v]xfade=transition=zoomout:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'circle_open':
            filterComplex = `[0:v][1:v]xfade=transition=circleopen:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          case 'circle_close':
            filterComplex = `[0:v][1:v]xfade=transition=circleclose:duration=${transitionDuration}:offset=${duration1 - transitionDuration}[v]`;
            break;
          
          default:
            return reject(new Error(`Unknown transition: ${transition}`));
        }

        ffmpeg()
          .input(video1Path)
          .input(video2Path)
          .complexFilter([filterComplex])
          .outputOptions(['-map', '[v]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23'])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .run();
      });
    });
  });
}

/**
 * Add audio to video with volume control
 */
export async function addAudioToVideoWithVolume(
  videoPath: string,
  audioUrl: string,
  volume: number = 0.5,
  outputPath: string
): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-audio-'));
  const audioPath = path.join(tempDir, 'audio.mp3');

  // Download audio
  const response = await fetch(audioUrl);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(audioPath, Buffer.from(buffer));

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v', 'copy', // Copy video codec
        '-c:a', 'aac', // Encode audio as AAC
        '-filter:a', `volume=${volume}`, // Apply volume
        '-shortest', // Match shortest stream
        '-map', '0:v:0', // Map video from first input
        '-map', '1:a:0', // Map audio from second input
      ])
      .output(outputPath)
      .on('end', async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        resolve();
      })
      .on('error', async (err) => {
        await fs.rm(tempDir, { recursive: true, force: true });
        reject(err);
      })
      .run();
  });
}

/**
 * Merge multiple audio tracks with video
 * Supports multiple audio tracks with different start times, durations, and volumes
 */
export async function mergeAudioTracksWithVideo(
  videoPath: string,
  audioTracks: Array<{ url: string; startTime: number; duration: number; volume: number }>,
  outputPath: string
): Promise<void> {
  if (!audioTracks || audioTracks.length === 0) {
    // No audio tracks, just copy video
    await fs.copyFile(videoPath, outputPath);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidverse-merge-audio-'));
  const audioPaths: string[] = [];

  try {
    // Download all audio files
    for (let i = 0; i < audioTracks.length; i++) {
      const track = audioTracks[i];
      const response = await fetch(track.url);
      const buffer = await response.arrayBuffer();
      const audioPath = path.join(tempDir, `audio-${i}.mp3`);
      await fs.writeFile(audioPath, Buffer.from(buffer));
      audioPaths.push(audioPath);
    }

    // Build complex filter for mixing multiple audio tracks
    const filterParts: string[] = [];
    
    // Create audio inputs and filters for each track
    for (let i = 0; i < audioPaths.length; i++) {
      const track = audioTracks[i];
      // Apply volume and delay (startTime) to each audio track
      const delayMs = Math.round(track.startTime * 1000);
      filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=${track.volume}[a${i}]`);
    }

    // Mix all audio tracks together
    const audioLabels = audioTracks.map((_, i) => `[a${i}]`).join('');
    filterParts.push(`${audioLabels}amix=inputs=${audioTracks.length}:duration=longest:dropout_transition=2[audio]`);

    const filterComplex = filterParts.join(';');

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(videoPath);
      
      // Add all audio inputs
      for (const audioPath of audioPaths) {
        ffmpegCommand.input(audioPath);
      }

      ffmpegCommand
        .complexFilter([filterComplex])
        .outputOptions([
          '-c:v', 'copy', // Copy video codec
          '-c:a', 'aac', // Encode audio as AAC
          '-map', '0:v:0', // Map video from first input
          '-map', '[audio]', // Map mixed audio
          '-shortest', // Match shortest stream
        ])
        .output(outputPath)
        .on('end', async () => {
          await fs.rm(tempDir, { recursive: true, force: true });
          resolve();
        })
        .on('error', async (err) => {
          await fs.rm(tempDir, { recursive: true, force: true });
          reject(err);
        })
        .run();
    });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

