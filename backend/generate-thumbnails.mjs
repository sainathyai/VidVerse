/**
 * Script to generate thumbnails from the first frame of final videos
 * and store them in the database and config
 * 
 * Usage: node generate-thumbnails.mjs [--project-id=<id>] [--dry-run]
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Load environment variables
dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const projectIdArg = args.find(arg => arg.startsWith('--project-id='));
const projectId = projectIdArg ? projectIdArg.split('=')[1] : null;
const dryRun = args.includes('--dry-run');

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://vidverse:vidverse_dev@localhost:5432/vidverse',
  ssl: process.env.DATABASE_SSL === 'true',
  sslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  sslCaPath: process.env.DATABASE_SSL_CA_PATH,
};

// S3 configuration
const s3Config = {
  bucketName: process.env.S3_BUCKET_NAME || 'vidverse-assets',
  region: process.env.S3_REGION || 'us-west-2',
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  endpoint: process.env.S3_ENDPOINT,
  usePresignedUrls: process.env.S3_USE_PRESIGNED_URLS !== 'false',
};

// FFmpeg configuration
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 
  (process.env.FFMPEG_PATH ? process.env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : 'ffprobe');

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Initialize S3 client
const s3Client = new S3Client({
  region: s3Config.region,
  endpoint: s3Config.endpoint,
  credentials: s3Config.accessKeyId && s3Config.secretAccessKey
    ? {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      }
    : undefined,
  forcePathStyle: s3Config.endpoint?.includes('localhost') || s3Config.endpoint?.includes('127.0.0.1'),
});

// Initialize database pool
let pool;
try {
  // Remove sslmode from connection string if present - we'll handle SSL via config
  let connectionString = dbConfig.connectionString;
  const requiresSSL = connectionString.includes('sslmode=require') || connectionString.includes('sslmode=prefer');
  connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
  
  const poolConfig = {
    connectionString: connectionString,
    max: 5,
  };

  // Enable SSL if explicitly configured OR if connection string requires it
  if (dbConfig.ssl || requiresSSL) {
    const sslConfig = {
      // For RDS connections, always set rejectUnauthorized to false to avoid certificate chain issues
      rejectUnauthorized: false,
    };

    if (dbConfig.sslCaPath) {
      let certPath = dbConfig.sslCaPath;
      if (!certPath.startsWith('/') && !certPath.match(/^[A-Z]:/)) {
        // Try relative to current working directory
        certPath = resolve(process.cwd(), certPath);
      }
      if (existsSync(certPath)) {
        try {
          sslConfig.ca = readFileSync(certPath, 'utf-8');
          console.log(`SSL certificate loaded from: ${certPath}`);
        } catch (error) {
          console.warn(`Failed to read SSL certificate: ${error.message}`);
        }
      }
    }
    poolConfig.ssl = sslConfig;
  }

  pool = new Pool(poolConfig);
} catch (error) {
  console.error('Failed to initialize database pool:', error);
  process.exit(1);
}

/**
 * Generate S3 key for thumbnail
 */
function generateThumbnailKey(userId, projectId) {
  const timestamp = Date.now();
  return `users/${userId}/projects/${projectId}/thumbnails/${timestamp}-thumbnail.jpg`;
}

/**
 * Upload thumbnail to S3
 */
async function uploadThumbnail(buffer, userId, projectId) {
  const key = generateThumbnailKey(userId, projectId);
  const bucket = s3Config.bucketName;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
    Metadata: {
      userId,
      projectId,
      uploadedAt: new Date().toISOString(),
      type: 'thumbnail',
    },
  });

  await s3Client.send(command);

  // Generate public URL or presigned URL for GET (viewing/downloading)
  // Note: S3 presigned URLs have a maximum expiration of 7 days (604800 seconds)
  // IMPORTANT: We need a GET presigned URL, not PUT. Use GetObjectCommand for viewing.
  let url;
  if (s3Config.usePresignedUrls) {
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    url = await getSignedUrl(s3Client, getCommand, { expiresIn: 604800 }); // 7 days (max allowed)
  } else {
    url = s3Config.endpoint
      ? `${s3Config.endpoint}/${bucket}/${key}`
      : `https://${bucket}.s3.${s3Config.region}.amazonaws.com/${key}`;
  }

  return { url, key };
}

/**
 * Extract first frame from video
 */
async function extractFirstFrame(videoUrl) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-'));
  const videoPath = path.join(tempDir, 'video.mp4');
  const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');

  try {
    // Download video
    console.log(`  Downloading video from ${videoUrl.substring(0, 100)}...`);
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    await fs.writeFile(videoPath, videoBuffer);

    // Extract first frame at 0.1 seconds (to avoid black frames)
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [0.1],
          filename: 'thumbnail.jpg',
          folder: tempDir,
          size: '1920x1080',
        })
        .on('end', async () => {
          try {
            const thumbnailBuffer = await fs.readFile(thumbnailPath);
            await fs.rm(tempDir, { recursive: true, force: true });
            resolve(thumbnailBuffer);
          } catch (error) {
            await fs.rm(tempDir, { recursive: true, force: true });
            reject(error);
          }
        })
        .on('error', async (err) => {
          await fs.rm(tempDir, { recursive: true, force: true });
          reject(new Error(`Failed to extract frame: ${err.message}`));
        });
    });
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Process a single project
 */
async function processProject(project) {
  const { id, user_id, final_video_url, config: configJson } = project;
  
  console.log(`\nProcessing project ${id} (user: ${user_id})`);
  console.log(`  Video URL: ${final_video_url?.substring(0, 100)}...`);

  // Check if thumbnail already exists
  const currentConfig = typeof configJson === 'string' ? JSON.parse(configJson) : (configJson || {});
  if (currentConfig.thumbnailUrl && !dryRun) {
    console.log(`  ✓ Thumbnail already exists: ${currentConfig.thumbnailUrl.substring(0, 100)}...`);
    return { skipped: true, reason: 'thumbnail_exists' };
  }

  if (!final_video_url || final_video_url.trim() === '') {
    console.log(`  ⚠ Skipping: No final_video_url`);
    return { skipped: true, reason: 'no_video_url' };
  }

  try {
    // Extract first frame
    console.log(`  Extracting first frame...`);
    const thumbnailBuffer = await extractFirstFrame(final_video_url);
    console.log(`  ✓ Frame extracted (${thumbnailBuffer.length} bytes)`);

    if (dryRun) {
      console.log(`  [DRY RUN] Would upload thumbnail and update database`);
      return { success: true, dryRun: true };
    }

    // Upload to S3
    console.log(`  Uploading thumbnail to S3...`);
    const { url: thumbnailUrl } = await uploadThumbnail(thumbnailBuffer, user_id, id);
    console.log(`  ✓ Thumbnail uploaded: ${thumbnailUrl.substring(0, 100)}...`);

    // Update database
    console.log(`  Updating database...`);
    
    // Update config with thumbnail URL
    currentConfig.thumbnailUrl = thumbnailUrl;
    
    // Update both thumbnail_url column and config JSONB
    const updateQuery = `
      UPDATE projects 
      SET thumbnail_url = $1,
          config = $2,
          updated_at = NOW()
      WHERE id = $3
    `;
    
    await pool.query(updateQuery, [
      thumbnailUrl,
      JSON.stringify(currentConfig),
      id,
    ]);

    console.log(`  ✓ Database updated`);
    return { success: true, thumbnailUrl };
  } catch (error) {
    console.error(`  ✗ Error processing project ${id}:`, error.message);
    console.error(`  Full error:`, error);
    // Exit immediately on failure
    console.error('\n❌ Script failed. Exiting...');
    await pool.end();
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Thumbnail Generation Script ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`FFmpeg: ${ffmpegPath}`);
  console.log(`FFprobe: ${ffprobePath}`);
  console.log(`S3 Bucket: ${s3Config.bucketName}`);
  console.log(`Project ID filter: ${projectId || 'all projects'}\n`);

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✓ Database connection successful\n');

    // Fetch projects with final_video_url
    let queryText = `
      SELECT id, user_id, final_video_url, config
      FROM projects
      WHERE final_video_url IS NOT NULL 
        AND final_video_url != ''
        AND final_video_url != 'null'
    `;
    const queryParams = [];

    if (projectId) {
      queryText += ' AND id = $1';
      queryParams.push(projectId);
    }

    queryText += ' ORDER BY created_at DESC';

    const projects = await pool.query(queryText, queryParams);
    console.log(`Found ${projects.rows.length} project(s) with final_video_url\n`);

    if (projects.rows.length === 0) {
      console.log('No projects to process.');
      await pool.end();
      process.exit(0);
    }

    // Process each project
    const results = {
      total: projects.rows.length,
      success: 0,
      skipped: 0,
      failed: 0,
    };

    for (const project of projects.rows) {
      const result = await processProject(project);
      if (result.success) {
        results.success++;
      } else if (result.skipped) {
        results.skipped++;
      } else {
        results.failed++;
      }
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total projects: ${results.total}`);
    console.log(`Success: ${results.success}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log(`Failed: ${results.failed}`);

    await pool.end();
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error:', error);
    await pool.end();
    process.exit(1);
  }
}

// Run the script
main();

