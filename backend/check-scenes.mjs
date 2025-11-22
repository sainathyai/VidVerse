import { query } from './dist/services/database.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
dotenv.config({ path: join(__dirname, '.env') });

// Log the database URL (masked) for debugging
const dbUrl = process.env.DATABASE_URL || 'postgresql://vidverse:vidverse_dev@localhost:5432/vidverse';
const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
console.log(`Database: ${maskedUrl}\n`);

const projectId = 'e9731679-e3ad-4412-ae67-aa1513065d35';

try {
  console.log(`Checking scenes for project: ${projectId}\n`);

  // Check if project exists
  const project = await query(
    'SELECT id, name, status, created_at FROM projects WHERE id = $1',
    [projectId]
  );

  if (project.length === 0) {
    console.log('❌ Project not found in database');
    process.exit(1);
  }

  console.log('✅ Project found:');
  console.log(JSON.stringify(project[0], null, 2));
  console.log('\n');

  // Check scenes
  const scenes = await query(
    `SELECT 
      id, 
      scene_number, 
      prompt, 
      duration, 
      start_time, 
      video_url, 
      first_frame_url, 
      last_frame_url, 
      created_at, 
      updated_at
     FROM scenes
     WHERE project_id = $1
     ORDER BY scene_number ASC`,
    [projectId]
  );

  console.log(`Found ${scenes.length} scene(s) in database:\n`);

  if (scenes.length === 0) {
    console.log('❌ No scenes found for this project');
    console.log('\nThis means scenes were not saved to the database when they were generated.');
    console.log('Scenes generated after the save code was added should be in the database.');
  } else {
    scenes.forEach((scene) => {
      console.log(`Scene ${scene.scene_number}:`);
      console.log(`  ID: ${scene.id}`);
      console.log(`  Prompt: ${scene.prompt?.substring(0, 100)}${scene.prompt?.length > 100 ? '...' : ''}`);
      console.log(`  Video URL: ${scene.video_url ? scene.video_url.substring(0, 100) + '...' : 'NULL ❌'}`);
      console.log(`  First Frame: ${scene.first_frame_url ? scene.first_frame_url.substring(0, 100) + '...' : 'NULL'}`);
      console.log(`  Last Frame: ${scene.last_frame_url ? scene.last_frame_url.substring(0, 100) + '...' : 'NULL'}`);
      console.log(`  Created: ${scene.created_at}`);
      console.log(`  Updated: ${scene.updated_at}`);
      console.log('');
    });
  }

  // Also check project config for sceneUrls (legacy)
  const projectWithConfig = await query(
    'SELECT config FROM projects WHERE id = $1',
    [projectId]
  );

  if (projectWithConfig.length > 0) {
    const config = typeof projectWithConfig[0].config === 'string' 
      ? JSON.parse(projectWithConfig[0].config)
      : projectWithConfig[0].config;

    console.log('\n📋 Project Config Analysis:');
    console.log(`  Has sceneUrls: ${!!(config.sceneUrls && Array.isArray(config.sceneUrls) && config.sceneUrls.length > 0)}`);
    console.log(`  Has script.scenes: ${!!(config.script?.scenes && Array.isArray(config.script.scenes) && config.script.scenes.length > 0)}`);
    
    if (config.sceneUrls && Array.isArray(config.sceneUrls) && config.sceneUrls.length > 0) {
      console.log(`\n⚠️  Found ${config.sceneUrls.length} scene URL(s) in project config (legacy):`);
      config.sceneUrls.forEach((url, index) => {
        console.log(`  Scene ${index + 1}: ${url.substring(0, 100)}...`);
      });
    }
    
    if (config.script?.scenes && Array.isArray(config.script.scenes) && config.script.scenes.length > 0) {
      console.log(`\n📝 Found ${config.script.scenes.length} scene(s) in script:`);
      config.script.scenes.forEach((scene, index) => {
        console.log(`  Scene ${index + 1}: ${scene.prompt?.substring(0, 80)}...`);
      });
    }
  }

  process.exit(0);
} catch (error) {
  console.error('Error checking database:', error.message);
  console.error(error.stack);
  process.exit(1);
}

