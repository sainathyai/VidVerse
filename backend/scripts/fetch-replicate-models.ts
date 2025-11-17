/**
 * Script to fetch video generation models and their pricing from Replicate API
 * Run with: npx tsx backend/scripts/fetch-replicate-models.ts
 */

import Replicate from 'replicate';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!REPLICATE_API_TOKEN) {
  console.error('ERROR: REPLICATE_API_TOKEN not found in environment variables');
  process.exit(1);
}

const replicate = new Replicate({
  auth: REPLICATE_API_TOKEN,
});

// Known video generation model IDs to check (prioritized by cost and availability)
const VIDEO_MODEL_IDS = [
  // Budget tier - ByteDance (cheapest)
  'bytedance/seedance-1-pro-fast',
  'bytedance/seedance-1-pro',
  'luma/dream-machine',
  'anotherjesse/zeroscope-v2-xl',
  // Economy tier
  'wan-video/wan-2.5-i2v',
  'luma/ray',
  'stability-ai/stable-video-diffusion',
  'kwaivgi/kling-v2.5-turbo-pro',
  'deforum/deforum-stable-diffusion',
  // Standard tier - Sora 2 for standard
  'openai/sora-2',
  'wan-video/wan-2.5-i2v-720p',
  'wan-video/wan-2.5-i2v-1080p',
  'haiper-ai/haiper-video-2',
  'google/veo-3.1',
  'tencent/hunyuan-video',
  'genmoai/mochi-1',
  'minimax/video-01-live',
  'google/veo-3.1-audio',
  // Advanced tier
  'runway/gen3-alpha-turbo',
  'pika/pika-1.5',
  // Premium tier
  'runway/gen3-alpha',
];

interface ModelInfo {
  id: string;
  owner: string;
  name: string;
  description: string;
  visibility: string;
  github_url?: string;
  paper_url?: string;
  license_url?: string;
  cover_image_url?: string;
  default_example?: any;
  latest_version?: {
    id: string;
    created_at: string;
    cog_version: string;
    openapi_schema?: any;
  };
  pricing?: {
    predict?: string; // Pricing info if available
  };
  url?: string;
}

interface ModelVersionInfo {
  id: string;
  created_at: string;
  cog_version: string;
  openapi_schema?: {
    components?: {
      schemas?: {
        Input?: {
          properties?: any;
        };
      };
    };
  };
}

async function fetchModelInfo(modelId: string): Promise<ModelInfo | null> {
  try {
    const [owner, name] = modelId.split('/');
    console.log(`Fetching model: ${modelId}...`);
    
    const model = await replicate.models.get(owner, name);
    
    // Try to get latest version
    let latestVersion: ModelVersionInfo | null = null;
    try {
      const versions = await replicate.models.versions.list(owner, name);
      if (versions.results && versions.results.length > 0) {
        latestVersion = versions.results[0] as ModelVersionInfo;
      }
    } catch (versionError: any) {
      console.warn(`  Could not fetch versions for ${modelId}: ${versionError.message}`);
    }
    
    return {
      id: modelId,
      owner: model.owner || owner,
      name: model.name || name,
      description: model.description || '',
      visibility: model.visibility || 'public',
      github_url: model.github_url || undefined,
      paper_url: model.paper_url || undefined,
      license_url: model.license_url || undefined,
      cover_image_url: model.cover_image_url || undefined,
      default_example: model.default_example || undefined,
      latest_version: latestVersion ? {
        id: latestVersion.id,
        created_at: latestVersion.created_at,
        cog_version: latestVersion.cog_version,
        openapi_schema: latestVersion.openapi_schema,
      } : undefined,
      url: model.url || `https://replicate.com/${modelId}`,
    };
  } catch (error: any) {
    if (error.status === 404 || error.status === 422) {
      console.warn(`  Model ${modelId} not found or not accessible (${error.status})`);
      return null;
    }
    console.error(`  Error fetching ${modelId}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Fetching video generation models from Replicate API...\n');
  
  const results: Array<ModelInfo & { status: 'found' | 'not_found' | 'error' }> = [];
  
  for (const modelId of VIDEO_MODEL_IDS) {
    const modelInfo = await fetchModelInfo(modelId);
    if (modelInfo) {
      results.push({ ...modelInfo, status: 'found' });
      console.log(`✓ Found: ${modelId}`);
      if (modelInfo.latest_version) {
        console.log(`  Latest version: ${modelInfo.latest_version.id}`);
        console.log(`  Created: ${modelInfo.latest_version.created_at}`);
      }
    } else {
      results.push({
        id: modelId,
        owner: modelId.split('/')[0],
        name: modelId.split('/')[1],
        description: '',
        visibility: 'unknown',
        status: 'not_found',
      });
      console.log(`✗ Not found: ${modelId}\n`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Generate TypeScript code with model information
  const foundModels = results.filter(r => r.status === 'found');
  
  console.log('\n=== SUMMARY ===');
  console.log(`Found ${foundModels.length} out of ${VIDEO_MODEL_IDS.length} models\n`);
  
  // Generate model configuration code
  const modelConfigCode = `// Auto-generated model configuration from Replicate API
// Generated at: ${new Date().toISOString()}
// Run: npx tsx backend/scripts/fetch-replicate-models.ts

export const REPLICATE_VIDEO_MODELS = [
${foundModels.map(model => {
  // Extract version ID if available
  const versionId = model.latest_version?.id || 'latest';
  const modelId = model.id;
  
  // Determine pricing tier based on manually verified pricing information
  let estimatedCostPerSecond = 0.10;
  let tier: 'budget' | 'economy' | 'standard' | 'advanced' | 'premium' = 'standard';
  
  // Budget tier ($0.00 - $0.03/sec)
  if (modelId.includes('bytedance/seedance-1-pro') && !modelId.includes('1080p')) {
    estimatedCostPerSecond = 0.03; // 480p
    tier = 'budget';
  } else if (modelId.includes('luma/dream-machine') || modelId.includes('zeroscope')) {
    estimatedCostPerSecond = 0.03;
    tier = 'budget';
  }
  // Economy tier ($0.03 - $0.10/sec)
  else if (modelId.includes('wan-video/wan-2.5-i2v') && !modelId.includes('720p') && !modelId.includes('1080p')) {
    estimatedCostPerSecond = 0.05; // 480p
    tier = 'economy';
  } else if (modelId.includes('luma/ray') || modelId.includes('stable-video')) {
    estimatedCostPerSecond = 0.05;
    tier = 'economy';
  } else if (modelId.includes('kwaivgi/kling-v2.5-turbo-pro')) {
    estimatedCostPerSecond = 0.07;
    tier = 'economy';
  } else if (modelId.includes('deforum')) {
    estimatedCostPerSecond = 0.10;
    tier = 'economy';
  }
  // Standard tier ($0.10 - $0.50/sec)
  else if (modelId.includes('wan-video/wan-2.5-i2v-720p') || modelId.includes('openai/sora-2')) {
    estimatedCostPerSecond = 0.10;
    tier = 'standard';
  } else if (modelId.includes('wan-video/wan-2.5-i2v-1080p')) {
    estimatedCostPerSecond = 0.15;
    tier = 'standard';
  } else if (modelId.includes('haiper')) {
    estimatedCostPerSecond = 0.15;
    tier = 'standard';
  } else if (modelId.includes('google/veo-3.1') && !modelId.includes('audio')) {
    estimatedCostPerSecond = 0.20; // w/o audio
    tier = 'standard';
  } else if (modelId.includes('tencent') || modelId.includes('genmo')) {
    estimatedCostPerSecond = 0.20;
    tier = 'standard';
  } else if (modelId.includes('minimax')) {
    estimatedCostPerSecond = 0.30;
    tier = 'standard';
  } else if (modelId.includes('google/veo-3.1-audio')) {
    estimatedCostPerSecond = 0.40; // w/ audio
    tier = 'standard';
  }
  // Advanced tier ($0.50 - $1.00/sec)
  else if (modelId.includes('runway/gen3-alpha-turbo') || modelId.includes('pika')) {
    estimatedCostPerSecond = 0.50;
    tier = 'advanced';
  }
  // Premium tier ($1.00+/sec)
  else if (modelId.includes('runway/gen3-alpha')) {
    estimatedCostPerSecond = 1.00;
    tier = 'premium';
  }
  
  // Determine max duration (most models support 5 seconds, some support more)
  let maxDuration = 5;
  if (modelId.includes('haiper')) {
    maxDuration = 6;
  } else if (modelId.includes('stable-video')) {
    maxDuration = 4;
  }
  
  return `  {
    id: '${modelId}',
    version: '${versionId}',
    name: ${JSON.stringify(model.name)},
    description: ${JSON.stringify(model.description || 'Video generation model')},
    maxDuration: ${maxDuration},
    costPerSecond: ${estimatedCostPerSecond},
    tier: '${tier}',
    url: '${model.url || `https://replicate.com/${modelId}`}',
    latestVersionId: ${model.latest_version ? `'${model.latest_version.id}'` : 'undefined'},
    createdAt: ${model.latest_version ? `'${model.latest_version.created_at}'` : 'undefined'},
  },`;
}).join('\n')}
];

// Model pricing lookup
export const MODEL_PRICING: Record<string, { costPerSecond: number; tier: 'budget' | 'economy' | 'standard' | 'advanced' | 'premium' }> = {
${foundModels.map(model => {
  // Determine pricing tier based on manually verified pricing information
  let estimatedCostPerSecond = 0.10;
  let tier: 'budget' | 'economy' | 'standard' | 'advanced' | 'premium' = 'standard';
  
  // Budget tier ($0.00 - $0.03/sec)
  if (model.id.includes('bytedance/seedance-1-pro') && !model.id.includes('1080p')) {
    estimatedCostPerSecond = 0.03; // 480p
    tier = 'budget';
  } else if (model.id.includes('luma/dream-machine') || model.id.includes('zeroscope')) {
    estimatedCostPerSecond = 0.03;
    tier = 'budget';
  }
  // Economy tier ($0.03 - $0.10/sec)
  else if (model.id.includes('wan-video/wan-2.5-i2v') && !model.id.includes('720p') && !model.id.includes('1080p')) {
    estimatedCostPerSecond = 0.05; // 480p
    tier = 'economy';
  } else if (model.id.includes('luma/ray') || model.id.includes('stable-video')) {
    estimatedCostPerSecond = 0.05;
    tier = 'economy';
  } else if (model.id.includes('kwaivgi/kling-v2.5-turbo-pro')) {
    estimatedCostPerSecond = 0.07;
    tier = 'economy';
  } else if (model.id.includes('deforum')) {
    estimatedCostPerSecond = 0.10;
    tier = 'economy';
  }
  // Standard tier ($0.10 - $0.50/sec)
  else if (model.id.includes('wan-video/wan-2.5-i2v-720p') || model.id.includes('openai/sora-2')) {
    estimatedCostPerSecond = 0.10;
    tier = 'standard';
  } else if (model.id.includes('wan-video/wan-2.5-i2v-1080p')) {
    estimatedCostPerSecond = 0.15;
    tier = 'standard';
  } else if (model.id.includes('haiper')) {
    estimatedCostPerSecond = 0.15;
    tier = 'standard';
  } else if (model.id.includes('google/veo-3.1') && !model.id.includes('audio')) {
    estimatedCostPerSecond = 0.20; // w/o audio
    tier = 'standard';
  } else if (model.id.includes('tencent') || model.id.includes('genmo')) {
    estimatedCostPerSecond = 0.20;
    tier = 'standard';
  } else if (model.id.includes('minimax')) {
    estimatedCostPerSecond = 0.30;
    tier = 'standard';
  } else if (model.id.includes('google/veo-3.1-audio')) {
    estimatedCostPerSecond = 0.40; // w/ audio
    tier = 'standard';
  }
  // Advanced tier ($0.50 - $1.00/sec)
  else if (model.id.includes('runway/gen3-alpha-turbo') || model.id.includes('pika')) {
    estimatedCostPerSecond = 0.50;
    tier = 'advanced';
  }
  // Premium tier ($1.00+/sec)
  else if (model.id.includes('runway/gen3-alpha')) {
    estimatedCostPerSecond = 1.00;
    tier = 'premium';
  }
  
  return `  '${model.id}': { costPerSecond: ${estimatedCostPerSecond}, tier: '${tier}' },`;
}).join('\n')}
};
`;

  // Write to file
  const outputPath = path.join(__dirname, '../src/services/replicate-models.ts');
  fs.writeFileSync(outputPath, modelConfigCode);
  console.log(`\n✓ Generated model configuration: ${outputPath}`);
  
  // Also write JSON for reference
  const jsonPath = path.join(__dirname, '../src/services/replicate-models.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`✓ Generated JSON reference: ${jsonPath}`);
  
  console.log('\n=== FOUND MODELS ===');
  foundModels.forEach(model => {
    console.log(`- ${model.id}`);
    if (model.latest_version) {
      console.log(`  Version: ${model.latest_version.id}`);
    }
    console.log(`  URL: ${model.url || `https://replicate.com/${model.id}`}`);
    console.log('');
  });
}

main().catch(console.error);

