#!/usr/bin/env node
/**
 * Sync S3 videos to RDS database for a specific project
 * Usage: node sync-s3-to-db.mjs <projectId>
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

// Load config manually
const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const config = {
  storage: {
    bucketName: process.env.S3_BUCKET_NAME || 'vidverse-assets',
    region: process.env.S3_REGION || 'us-west-2',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    endpoint: process.env.S3_ENDPOINT,
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://vidverse:vidverse_dev@localhost:5432/vidverse',
    ssl: parseBoolean(process.env.DATABASE_SSL, false),
    sslRejectUnauthorized: parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    sslCaPath: process.env.DATABASE_SSL_CA_PATH,
  },
};

// Database helper functions
let pool = null;

function getDatabasePool() {
  if (!pool) {
    let connectionString = config.database.url;
    const requiresSSL = connectionString.includes('sslmode=require') || connectionString.includes('sslmode=prefer');
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
    
    const poolConfig = {
      connectionString: connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    };

    if (config.database.ssl || requiresSSL) {
      const sslConfig = {
        rejectUnauthorized: config.database.sslRejectUnauthorized,
      };

      if (config.database.sslCaPath) {
        let certPath = config.database.sslCaPath;
        if (!certPath.startsWith('/') && !certPath.match(/^[A-Z]:/)) {
          const cwdPath = resolve(process.cwd(), certPath);
          const dirnamePath = resolve(__dirname, certPath);
          certPath = cwdPath;
        }
        try {
          const certContent = readFileSync(certPath, 'utf-8');
          sslConfig.ca = certContent;
        } catch (error) {
          console.warn(`Could not load SSL certificate: ${error.message}`);
        }
      }

      poolConfig.ssl = sslConfig;
    }

    pool = new Pool(poolConfig);
  }

  return pool;
}

async function query(text, params) {
  const db = getDatabasePool();
  const result = await db.query(text, params);
  return result.rows;
}

async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

dotenv.config();

const projectId = process.argv[2] || 'e9731679-e3ad-4412-ae67-aa1513065d35';

async function main() {
  try {
    console.log(`Syncing S3 videos to database for project: ${projectId}\n`);

    // Get project info from database
    console.log('Getting project info from database...');
    const project = await queryOne(
      'SELECT id, user_id, name, status, config FROM projects WHERE id = $1',
      [projectId]
    );

    if (!project) {
      console.error('Project not found in database!');
      process.exit(1);
    }

    const userId = project.user_id;
    console.log(`Project: ${project.name} (Status: ${project.status})`);
    console.log(`User ID: ${userId}\n`);

    // Initialize S3 client
    const s3Client = new S3Client({
      region: config.storage.region,
      endpoint: config.storage.endpoint,
      credentials: config.storage.accessKeyId && config.storage.secretAccessKey
        ? {
            accessKeyId: config.storage.accessKeyId,
            secretAccessKey: config.storage.secretAccessKey,
          }
        : undefined,
      forcePathStyle: config.storage.endpoint?.includes('localhost') || config.storage.endpoint?.includes('127.0.0.1'),
    });

    // List videos in S3
    const s3Prefix = `users/${userId}/projects/${projectId}/video/`;
    console.log(`Listing videos in S3...`);
    console.log(`Bucket: ${config.storage.bucketName}`);
    console.log(`Prefix: ${s3Prefix}\n`);

    const listCommand = new ListObjectsV2Command({
      Bucket: config.storage.bucketName,
      Prefix: s3Prefix,
    });

    const s3Response = await s3Client.send(listCommand);
    
    if (!s3Response.Contents || s3Response.Contents.length === 0) {
      console.log('No videos found in S3 for this project.');
      return;
    }

    console.log('Found videos in S3:');
    const videoUrls = {};

    for (const object of s3Response.Contents) {
      const key = object.Key;
      const size = object.Size;

      // Extract scene number from filename
      let sceneNumber = null;
      if (key.match(/scene-(\d+)\.mp4/)) {
        sceneNumber = parseInt(key.match(/scene-(\d+)\.mp4/)[1]);
      } else if (key.match(/output\.mp4/)) {
        sceneNumber = 'final';
      }

      // Construct S3 URL
      let s3Url;
      if (config.storage.endpoint) {
        s3Url = `${config.storage.endpoint}/${config.storage.bucketName}/${key}`;
      } else {
        s3Url = `https://${config.storage.bucketName}.s3.${config.storage.region}.amazonaws.com/${key}`;
      }

      if (sceneNumber) {
        console.log(`  Scene ${sceneNumber}: ${s3Url}`);
        videoUrls[sceneNumber] = s3Url;
      } else {
        console.log(`  Other: ${s3Url}`);
      }
    }

    console.log('');

    if (Object.keys(videoUrls).length === 0) {
      console.log('No scene videos found (only found non-scene files).');
      return;
    }

    // Update database with S3 URLs
    console.log('Updating database with S3 URLs...\n');

    for (const [sceneNum, videoUrl] of Object.entries(videoUrls)) {
      if (sceneNum === 'final') {
        // Update project config with final video URL
        console.log('  Updating final video URL in project config...');
        const currentConfig = typeof project.config === 'string' 
          ? JSON.parse(project.config) 
          : (project.config || {});
        currentConfig.videoUrl = videoUrl;
        currentConfig.finalVideoUrl = videoUrl;
        
        await query(
          'UPDATE projects SET config = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(currentConfig), projectId]
        );
        console.log(`    ✓ Final video URL updated: ${videoUrl}`);
      } else {
        // Update scene in database
        const sceneNumInt = parseInt(sceneNum);
        console.log(`  Updating scene ${sceneNumInt} with video URL...`);

        // First, try to update existing scene
        const updateResult = await query(
          `UPDATE scenes 
           SET video_url = $1, updated_at = NOW()
           WHERE project_id = $2 AND scene_number = $3
           RETURNING id`,
          [videoUrl, projectId, sceneNumInt]
        );

        if (updateResult.length === 0) {
          // Scene doesn't exist, create it
          await query(
            `INSERT INTO scenes (project_id, scene_number, video_url, prompt, duration, start_time, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
            [projectId, sceneNumInt, videoUrl, 'Synced from S3', 5.0, 0.0]
          );
          console.log(`    ✓ Scene ${sceneNumInt} created with video URL`);
        } else {
          console.log(`    ✓ Scene ${sceneNumInt} updated successfully`);
        }
      }
    }

    console.log('\nSync completed!');
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

