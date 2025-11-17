import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from backend directory
dotenv.config({ path: resolve(__dirname, '../.env') });

// Parse boolean helper
const parseBoolean = (value, defaultValue = false) => {
  if (!value) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

// Setup SSL config
let sslConfig = false;
if (parseBoolean(process.env.DATABASE_SSL, false)) {
  sslConfig = {
    rejectUnauthorized: parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
  };
  
  if (process.env.DATABASE_SSL_CA_PATH) {
    let certPath = process.env.DATABASE_SSL_CA_PATH;
    if (!certPath.startsWith('/') && !certPath.match(/^[A-Z]:/)) {
      certPath = resolve(__dirname, '..', certPath);
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
}

// Create database connection
const connectionString = process.env.DATABASE_URL?.replace(/[?&]sslmode=[^&]*/g, '') || '';
const pool = new Pool({
  connectionString,
  ssl: sslConfig,
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function checkVideoUrls() {
  try {
    console.log('Checking database for video URLs in the latest project...\n');

    // Get the latest project
    const projects = await query(
      `SELECT id, name, status, config, created_at 
       FROM projects 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    console.log(`Found ${projects.length} projects\n`);
    console.log('='.repeat(100));

    for (const project of projects) {
      console.log(`\nProject ID: ${project.id}`);
      console.log(`Name: ${project.name || 'N/A'}`);
      console.log(`Status: ${project.status}`);
      console.log(`Created: ${project.created_at}`);

      if (!project.config) {
        console.log('❌ Config: NULL or undefined');
        continue;
      }

      let config;
      try {
        config = typeof project.config === 'string' 
          ? JSON.parse(project.config) 
          : project.config;
      } catch (e) {
        console.log(`❌ Config: Invalid JSON - ${e.message}`);
        console.log(`Raw config: ${project.config}`);
        continue;
      }

      if (!config || Object.keys(config).length === 0) {
        console.log('⚠️  Config: Empty object');
        continue;
      }

      console.log('✅ Config: Valid JSON');
      
      // Check for videoUrl
      if (config.videoUrl) {
        console.log(`✅ videoUrl: ${config.videoUrl.substring(0, 100)}${config.videoUrl.length > 100 ? '...' : ''}`);
      } else {
        console.log('❌ videoUrl: Missing');
        console.log(`   Config keys: ${Object.keys(config).join(', ')}`);
        console.log(`   Full config: ${JSON.stringify(config, null, 2)}`);
      }

      // Check for sceneUrls
      if (config.sceneUrls && Array.isArray(config.sceneUrls)) {
        console.log(`✅ sceneUrls: ${config.sceneUrls.length} scenes`);
        config.sceneUrls.forEach((url, idx) => {
          console.log(`   Scene ${idx + 1}: ${url.substring(0, 80)}${url.length > 80 ? '...' : ''}`);
        });
      } else {
        console.log('❌ sceneUrls: Missing or not an array');
      }

      // Check for frameUrls
      if (config.frameUrls && Array.isArray(config.frameUrls)) {
        console.log(`✅ frameUrls: ${config.frameUrls.length} frame sets`);
      } else {
        console.log('❌ frameUrls: Missing or not an array');
      }

      // Check for audioUrl
      if (config.audioUrl) {
        console.log(`✅ audioUrl: ${config.audioUrl.substring(0, 80)}${config.audioUrl.length > 80 ? '...' : ''}`);
      }

      console.log('-'.repeat(100));
    }

    // Summary
    console.log('\n\nSUMMARY:');
    console.log('='.repeat(100));
    
    const withConfig = projects.filter(p => p.config);
    const withVideoUrl = projects.filter(p => {
      if (!p.config) return false;
      try {
        const config = typeof p.config === 'string' ? JSON.parse(p.config) : p.config;
        return config && config.videoUrl;
      } catch {
        return false;
      }
    });
    const completed = projects.filter(p => p.status === 'completed');
    const completedWithVideo = completed.filter(p => {
      if (!p.config) return false;
      try {
        const config = typeof p.config === 'string' ? JSON.parse(p.config) : p.config;
        return config && config.videoUrl;
      } catch {
        return false;
      }
    });

    console.log(`Total projects: ${projects.length}`);
    console.log(`Projects with config: ${withConfig.length}`);
    console.log(`Projects with videoUrl: ${withVideoUrl.length}`);
    console.log(`Completed projects: ${completed.length}`);
    console.log(`Completed projects with videoUrl: ${completedWithVideo.length}`);
    
    if (completed.length > 0 && completedWithVideo.length < completed.length) {
      console.log(`\n⚠️  WARNING: ${completed.length - completedWithVideo.length} completed projects are missing videoUrl!`);
    }

  } catch (error) {
    console.error('Error checking database:', error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

checkVideoUrls();

