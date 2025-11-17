import Replicate from 'replicate';
import { config } from '../config';

// Initialize Replicate client only if token is provided
let replicate: Replicate | null = null;

if (config.replicate.apiToken) {
  replicate = new Replicate({
    auth: config.replicate.apiToken,
  });
  console.log('[REPLICATE] Client initialized with API token');
} else {
  console.warn('[REPLICATE] WARNING: No API token provided, video generation will fail');
}

// Cache for video generation models
interface VideoModel {
  id: string;
  version?: string; // Specific version ID if available
  name: string;
  description: string;
  maxDuration: number;
  costPerSecond: number; // Estimated cost per second of video generation
  tier: 'budget' | 'economy' | 'standard' | 'advanced' | 'premium';
}

let cachedVideoModels: VideoModel[] | null = null;
let lastModelFetchTime: number = 0;
const MODEL_CACHE_TTL = 3600000; // 1 hour in milliseconds

// Model pricing tiers (cost per second based on Replicate pricing - manually verified)
const MODEL_PRICING: Record<string, { costPerSecond: number; tier: VideoModel['tier'] }> = {
    // Video models - Google Veo 3 series
    'google/veo-3': { costPerSecond: 0.20, tier: 'premium' },
    'google/veo-3.1': { costPerSecond: 0.20, tier: 'premium' },
    'google/veo-3-fast': { costPerSecond: 0.15, tier: 'standard' },
    'openai/sora-2': { costPerSecond: 0.10, tier: 'standard' },
  };

// Model ID to display name mapping for video models
export const VIDEO_MODEL_NAMES: Record<string, string> = {
  'google/veo-3': 'Veo 3',
  'google/veo-3.1': 'Veo 3.1',
  'google/veo-3-fast': 'Veo 3 Fast',
  'openai/sora-2': 'Sora 2',
};

// Model ID to display name mapping for image models
export const IMAGE_MODEL_NAMES: Record<string, string> = {
  'openai/dall-e-3': 'DALL-E 3',
  'google/nano-banana': 'Nano Banana',
  'google/imagen-4-ultra': 'Imagen 4 Ultra',
  'google/imagen-4': 'Imagen 4',
};

// Cost tier thresholds
const COST_TIERS = {
  budget: { min: 0, max: 0.03 }, // $0.00 - $0.03/sec
  economy: { min: 0.03, max: 0.10 }, // $0.03 - $0.10/sec
  standard: { min: 0.10, max: 0.50 }, // $0.10 - $0.50/sec
  advanced: { min: 0.50, max: 1.00 }, // $0.50 - $1.00/sec
  premium: { min: 1.00, max: Infinity }, // $1.00+/sec
};

// Fallback models if API fetch fails - include models for all tiers
const FALLBACK_VIDEO_MODELS: VideoModel[] = [
  {
    id: 'google/veo-3-fast',
    name: 'Google Veo 3 Fast',
    description: 'Fast video generation',
    maxDuration: 5,
    costPerSecond: 0.15,
    tier: 'standard',
  },
  {
    id: 'google/veo-3',
    name: 'Google Veo 3',
    description: 'High quality video generation',
    maxDuration: 5,
    costPerSecond: 0.20,
    tier: 'premium',
  },
  {
    id: 'google/veo-3.1',
    name: 'Google Veo 3.1',
    description: 'Premium video generation',
    maxDuration: 5,
    costPerSecond: 0.20,
    tier: 'premium',
  },
  {
    id: 'luma/dream-machine',
    name: 'Luma Dream Machine',
    description: 'Fast and cost-effective video generation',
    maxDuration: 5,
    costPerSecond: 0.03,
    tier: 'budget',
  },
  {
    id: 'luma/ray',
    name: 'Luma Ray',
    description: 'Fast, high-quality text-to-video and image-to-video',
    maxDuration: 5,
    costPerSecond: 0.05,
    tier: 'economy',
  },
  {
    id: 'anotherjesse/zeroscope-v2-xl',
    name: 'Zeroscope v2 XL',
    description: 'High quality video generation',
    maxDuration: 5,
    costPerSecond: 0.02,
    tier: 'budget',
  },
];

/**
 * Fetch available video generation models from Replicate API
 */
async function fetchVideoGenerationModels(): Promise<VideoModel[]> {
  // Check cache first
  const now = Date.now();
  if (cachedVideoModels && (now - lastModelFetchTime) < MODEL_CACHE_TTL) {
    console.log('[REPLICATE] Using cached video generation models');
    return cachedVideoModels;
  }

  if (!replicate) {
    console.warn('[REPLICATE] Cannot fetch models - client not initialized. Using fallback models.');
    return FALLBACK_VIDEO_MODELS;
  }

  try {
    console.log('[REPLICATE] Fetching available video generation models from Replicate API...');
    
    // Try to fetch models from Replicate
    // Note: Replicate API doesn't have a direct "list video models" endpoint,
    // so we'll search for known video-related keywords and collections
    const videoKeywords = ['video', 'text-to-video', 'image-to-video', 'animation'];
    const foundModels: VideoModel[] = [];

    // Known video generation model IDs to check (prioritized by cost and availability)
    const knownVideoModelIds = [
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

    // Check each known model to see if it exists and get its details
    for (const modelId of knownVideoModelIds) {
      try {
        const [owner, name] = modelId.split('/');
        const model = await replicate.models.get(owner, name);
        
        // Check if model has video-related keywords in description or name
        const description = model.description?.toLowerCase() || '';
        const modelName = model.name?.toLowerCase() || '';
        const isVideoModel = videoKeywords.some(keyword => 
          description.includes(keyword) || modelName.includes(keyword)
        );

        if (isVideoModel || modelId.includes('video') || modelId.includes('dream-machine') || modelId.includes('zeroscope') || modelId.includes('ray')) {
          // Try to get the latest version ID
          let latestVersionId: string | undefined;
          try {
            const versions = await replicate.models.versions.list(owner, name);
            if (versions.results && versions.results.length > 0) {
              latestVersionId = versions.results[0].id;
              console.log(`[REPLICATE] Model ${modelId} - Latest version: ${latestVersionId}`);
            }
          } catch (versionError: any) {
            console.debug(`[REPLICATE] Could not fetch versions for ${modelId}: ${versionError.message}`);
          }
          
          // Determine max duration based on model (default to 5 seconds)
          let maxDuration = 5;
          if (modelId.includes('haiper')) {
            maxDuration = 6;
          } else if (modelId.includes('stable-video')) {
            maxDuration = 4;
          }

          // Get pricing information for this model
          const pricing = MODEL_PRICING[modelId] || { costPerSecond: 0.10, tier: 'standard' as const };
          
          foundModels.push({
            id: modelId,
            version: latestVersionId, // Store version ID if available
            name: model.name || modelId,
            description: model.description || 'Video generation model',
            maxDuration,
            costPerSecond: pricing.costPerSecond,
            tier: pricing.tier,
          });
        }
      } catch (error: any) {
        // Model might not exist or be accessible, skip it
        const statusCode = error?.status || error?.statusCode;
        if (statusCode === 404 || statusCode === 422) {
          console.debug(`[REPLICATE] Model ${modelId} not found or not accessible (${statusCode})`);
        } else {
          console.debug(`[REPLICATE] Model ${modelId} error: ${error.message}`);
        }
      }
    }

    if (foundModels.length > 0) {
      // Sort by preference: luma models first (fastest), then others
      foundModels.sort((a, b) => {
        if (a.id.includes('luma')) return -1;
        if (b.id.includes('luma')) return 1;
        if (a.id.includes('zeroscope')) return -1;
        if (b.id.includes('zeroscope')) return 1;
        return 0;
      });

      cachedVideoModels = foundModels;
      lastModelFetchTime = now;
      console.log(`[REPLICATE] Found ${foundModels.length} video generation models:`, foundModels.map(m => m.id).join(', '));
      return foundModels;
    } else {
      console.warn('[REPLICATE] No video models found via API. Using fallback models.');
      cachedVideoModels = FALLBACK_VIDEO_MODELS;
      lastModelFetchTime = now;
      return FALLBACK_VIDEO_MODELS;
    }
  } catch (error: any) {
    console.error('[REPLICATE] Error fetching video generation models:', error.message);
    console.log('[REPLICATE] Using fallback video generation models');
    cachedVideoModels = FALLBACK_VIDEO_MODELS;
    lastModelFetchTime = now;
    return FALLBACK_VIDEO_MODELS;
  }
}

export interface VideoGenerationOptions {
  prompt: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  numFrames?: number;
  videoModelId?: string; // Selected video model ID (e.g., 'google/veo-3.1')
  aspectRatio?: string; // Aspect ratio string like "16:9", "9:16", "1:1", etc.
  // Veo 3.1 specific parameters
  image?: string; // URL of reference image
  lastFrame?: string; // URL of last frame for continuation
  negativePrompt?: string; // Negative prompt
  seed?: number; // Seed for reproducibility
}

export interface ImageGenerationOptions {
  prompt: string;
  imageModelId?: string; // Selected image model ID (e.g., 'openai/dall-e-3')
  width?: number;
  height?: number;
  aspectRatio?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
}

export interface ImageGenerationResult {
  output: string | string[]; // URL(s) to the generated image
  status: 'succeeded' | 'failed' | 'processing';
  error?: string;
}

export interface VideoGenerationResult {
  output: string | string[]; // URL(s) to the generated video
  status: 'succeeded' | 'failed' | 'processing';
  error?: string;
}

/**
 * Generate video using Replicate API with retry logic
 */
export async function generateVideo(
  options: VideoGenerationOptions,
  maxRetries: number = 3
): Promise<VideoGenerationResult> {
  const startTime = Date.now();
  console.log('[REPLICATE] Starting video generation', {
    promptLength: options.prompt?.length || 0,
    duration: options.duration,
    width: options.width,
    height: options.height,
    maxRetries,
  });

  if (!replicate) {
    console.error('[REPLICATE] ERROR: Replicate client not initialized - missing API token');
    return {
      output: '',
      status: 'failed',
      error: 'REPLICATE_API_TOKEN is required. Please set REPLICATE_API_TOKEN in your environment variables.',
    };
  }

  const {
    prompt,
    duration = 5,
    width = 1024,
    height = 576,
    fps = 24,
    aspectRatio,
  } = options;

  // Calculate numFrames based on duration and fps (for reference, not used in API call)
  // const numFrames = Math.ceil(duration * fps);

  // Use the selected video model ID directly
  const selectedModelId = options.videoModelId || 'google/veo-3.1'; // Default to Veo 3.1
  
  let videoGenerationModels: VideoModel[];
  
  // Fetch all models to get details for the selected model
  const allVideoModels = await fetchVideoGenerationModels();
  const selectedModel = allVideoModels.find(m => m.id === selectedModelId);
  
  if (selectedModel) {
    videoGenerationModels = [selectedModel];
    console.log(`[REPLICATE] Using model: ${selectedModel.id} (${selectedModel.name})`);
  } else {
    // Fallback: try to find model in fallback list
    const fallbackModel = FALLBACK_VIDEO_MODELS.find(m => m.id === selectedModelId);
    if (fallbackModel) {
      videoGenerationModels = [fallbackModel];
      console.log(`[REPLICATE] Using fallback model: ${fallbackModel.id} (${fallbackModel.name})`);
    } else {
      // Last resort: use first available model
      console.warn(`[REPLICATE] Model ${selectedModelId} not found, using first available model`);
      videoGenerationModels = allVideoModels.length > 0 ? [allVideoModels[0]] : FALLBACK_VIDEO_MODELS.slice(0, 1);
    }
  }
  
  let lastError: Error | null = null;

  // Try each video generation model in order until one succeeds
  for (let modelIndex = 0; modelIndex < videoGenerationModels.length; modelIndex++) {
    const model = videoGenerationModels[modelIndex];
    const isLastModel = modelIndex === videoGenerationModels.length - 1;
    
    console.log(`[REPLICATE] Trying video generation model ${modelIndex + 1}/${videoGenerationModels.length}: ${model.id} (${model.name})`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let predictionId: string | null = null; // Declare at attempt level for access in catch blocks
      try {
        console.log(`[REPLICATE] Attempt ${attempt}/${maxRetries} with model ${model.id} - Preparing API call`, {
          model: model.id,
          modelName: model.name,
          promptPreview: prompt?.substring(0, 100) + '...',
          promptLength: prompt?.length || 0,
          duration: Math.min(duration, model.maxDuration),
          aspectRatio: `${width}:${height}`,
        });

        // Use replicate.run for simpler API - it handles the prediction lifecycle automatically
        // Truncate prompt to reasonable length to avoid API issues
        if (!prompt || typeof prompt !== 'string') {
          throw new Error(`Invalid prompt: prompt must be a non-empty string, got ${typeof prompt}`);
        }
        const truncatedPrompt = prompt.substring(0, 500);
        
        if (truncatedPrompt.length < prompt.length) {
          console.log(`[REPLICATE] Prompt truncated from ${prompt.length} to ${truncatedPrompt.length} characters`);
        }

        const apiCallStartTime = Date.now();
        console.log(`[REPLICATE] Calling Replicate API with video generation model: ${model.id}`, {
          model: model.id,
          modelName: model.name,
          input: {
            promptLength: truncatedPrompt.length,
            aspect_ratio: `${width}:${height}`,
            duration: Math.min(duration, model.maxDuration),
          },
        });

        let output: string | string[];
        try {
          // Use replicate.run() - simpler API that handles the prediction lifecycle automatically
          console.log(`[REPLICATE] Running model ${model.id}...`);
          
          // Build input object - match the example format exactly
          // For openai/sora-2, prompt is required, aspect_ratio is optional
          const modelInput: any = {
            prompt: truncatedPrompt,
          };
          
          // Handle model-specific parameters
          const isSora2 = model.id === 'openai/sora-2';
          const isVeo3Fast = model.id === 'google/veo-3-fast';
          const isVeo3 = model.id === 'google/veo-3' || model.id === 'google/veo-3.1';
          
          if (isVeo3Fast) {
            // Veo 3 Fast format: prompt and enhance_prompt (boolean)
            modelInput.enhance_prompt = true; // Default to true, can be made configurable later
            console.log(`[REPLICATE] Adding Veo 3 Fast parameters: enhance_prompt=${modelInput.enhance_prompt}`);
          } else if (isSora2) {
            // Sora-2 format: aspect_ratio as "portrait" or "landscape", seconds as 4/8/12
            let soraAspectRatio: string;
            if (aspectRatio) {
              // Normalize aspect ratio format first
              const normalizedAspectRatio = aspectRatio.includes(':') 
                ? aspectRatio 
                : convertAspectRatioToRatio(aspectRatio);
              
              // Convert to Sora-2 format: "portrait" or "landscape"
              if (normalizedAspectRatio) {
                // Check if it's portrait (height > width) or landscape (width >= height)
                const [width, height] = normalizedAspectRatio.split(':').map(Number);
                soraAspectRatio = height > width ? 'portrait' : 'landscape';
              } else {
                // Default to landscape if conversion fails
                soraAspectRatio = 'landscape';
              }
            } else {
              // Default to landscape if not specified
              soraAspectRatio = 'landscape';
            }
            
            modelInput.aspect_ratio = soraAspectRatio;
            console.log(`[REPLICATE] Adding aspect_ratio parameter for Sora-2: ${soraAspectRatio}`);
            
            // Sora-2 requires "seconds" parameter (4, 8, or 12)
            const validSeconds = [4, 8, 12];
            const requestedSeconds = Math.min(duration, 12);
            const soraSeconds = validSeconds.reduce((prev, curr) => 
              Math.abs(curr - requestedSeconds) < Math.abs(prev - requestedSeconds) ? curr : prev
            );
            modelInput.seconds = soraSeconds;
            console.log(`[REPLICATE] Setting seconds parameter for Sora-2: ${soraSeconds} (requested: ${duration})`);
          } else if (isVeo3) {
            // Veo 3/3.1 format: prompt, aspect_ratio, duration, resolution, generate_audio, image, negative_prompt, seed
            // Veo 3.1 also supports: reference_images (array), last_frame
            const isVeo31 = model.id === 'google/veo-3.1';
            
            // Normalize aspect ratio to "W:H" format (e.g., "16:9", "9:16", "1:1")
            let veoAspectRatio: string;
            if (aspectRatio) {
              const normalizedAspectRatio = aspectRatio.includes(':') 
                ? aspectRatio 
                : convertAspectRatioToRatio(aspectRatio);
              veoAspectRatio = normalizedAspectRatio || '16:9';
            } else {
              veoAspectRatio = '16:9'; // Default to 16:9 landscape
            }
            
            // Required parameters
            modelInput.aspect_ratio = veoAspectRatio;
            modelInput.duration = Math.min(duration, 60); // Veo supports up to 60 seconds
            modelInput.resolution = '1080p'; // Default to 1080p
            modelInput.generate_audio = true; // Default to true (as per Veo 3 API)
            
            // Optional parameters - image (reference image)
            if (options.image) {
              modelInput.image = options.image;
              console.log(`[REPLICATE] Adding image parameter for Veo 3: ${options.image}`);
            }
            
            // Optional parameters - negative_prompt
            if (options.negativePrompt) {
              modelInput.negative_prompt = options.negativePrompt;
              console.log(`[REPLICATE] Adding negative_prompt parameter for Veo 3`);
            }
            
            // Optional parameters - seed
            if (options.seed !== undefined && options.seed !== null) {
              modelInput.seed = options.seed;
              console.log(`[REPLICATE] Adding seed parameter for Veo 3: ${options.seed}`);
            }
            
            // Veo 3.1 specific parameters
            if (isVeo31) {
              // Veo 3.1 supports last_frame for video continuation
              if (options.lastFrame) {
                modelInput.last_frame = options.lastFrame;
                console.log(`[REPLICATE] Adding last_frame parameter for Veo 3.1: ${options.lastFrame}`);
              }
              
              // Veo 3.1 supports reference_images (array of URLs)
              // TODO: Add support for reference_images if provided in options
              // if (options.referenceImages && Array.isArray(options.referenceImages)) {
              //   modelInput.reference_images = options.referenceImages;
              // }
            }
            
            console.log(`[REPLICATE] Adding Veo 3 parameters: aspect_ratio=${veoAspectRatio}, duration=${modelInput.duration}, resolution=${modelInput.resolution}, generate_audio=${modelInput.generate_audio}`);
          } else if (aspectRatio) {
            // For other models, log that aspect_ratio is not supported
            console.log(`[REPLICATE] Model ${model.id} does not support aspect_ratio parameter, ignoring`);
          }
          
          // Use model ID directly (Replicate SDK handles version resolution)
          const modelIdToUse = model.id;
          
          console.log(`[REPLICATE] Calling replicate.run("${modelIdToUse}", { input: ${JSON.stringify(modelInput)} })`);
          
          // replicate.run() returns a file-like object or URL string
          // For video models, it typically returns a file-like object with .url() method
          // Match the example: await replicate.run("openai/sora-2", { input })
          const runOutput = await replicate.run(modelIdToUse as any, { input: modelInput });
          
          console.log(`[REPLICATE] Model ${model.id} completed. Output type: ${typeof runOutput}, isArray: ${Array.isArray(runOutput)}`);
          console.log(`[REPLICATE] Output details:`, {
            type: typeof runOutput,
            constructor: runOutput?.constructor?.name,
            hasUrlMethod: typeof (runOutput as any)?.url === 'function',
            hasUrlProperty: runOutput && typeof runOutput === 'object' && 'url' in runOutput,
            keys: runOutput && typeof runOutput === 'object' ? Object.keys(runOutput) : 'N/A',
          });
          
          // Handle different output formats
          // According to the example: output.url() returns the URL string
          if (runOutput && typeof (runOutput as any).url === 'function') {
            // File-like object with .url() method (matches the example)
            output = (runOutput as any).url();
            console.log(`[REPLICATE] Got file-like output, extracted URL via .url() method: ${output}`);
          } else if (typeof runOutput === 'string') {
            // Direct URL string
            output = runOutput;
            console.log(`[REPLICATE] Got direct URL string output: ${output}`);
          } else if (Array.isArray(runOutput)) {
            // Array of outputs (multiple videos or frames)
            output = runOutput.map((item: any, index: number) => {
              if (typeof item === 'string') {
                return item;
              } else if (item && typeof item.url === 'function') {
                return item.url();
              } else if (item && typeof item === 'object' && 'url' in item) {
                return item.url as string;
              }
              console.warn(`[REPLICATE] Unknown array item format at index ${index}:`, typeof item);
              return String(item);
            });
            console.log(`[REPLICATE] Got array output with ${output.length} items`);
          } else if (runOutput && typeof runOutput === 'object' && 'url' in runOutput) {
            // Object with url property
            output = (runOutput as any).url;
            console.log(`[REPLICATE] Got object output with url property: ${output}`);
          } else {
            // Fallback: try to convert to string
            console.warn(`[REPLICATE] Unknown output format, attempting to convert to string. Type: ${typeof runOutput}`);
            const convertedOutput = String(runOutput);
            // Ensure it's a primitive string, not a String object
            output = convertedOutput.valueOf();
            console.log(`[REPLICATE] Converted to string: ${output}`);
          }
          
          // Ensure output is always a primitive string or array of primitive strings
          // This prevents issues with String objects vs primitive strings
          if (typeof output === 'string') {
            output = String(output); // Force primitive string
          } else if (Array.isArray(output)) {
            output = output.map(item => String(item)); // Force primitive strings
          }
          
          console.log(`[REPLICATE] Model ${model.id} completed successfully with output: ${Array.isArray(output) ? output.join(', ') : output}`);
          console.log(`[REPLICATE] Final output type check: ${typeof output}, isArray: ${Array.isArray(output)}`);
          
          // Success! Return the output
          const totalDuration = Date.now() - startTime;
          console.log(`[REPLICATE] SUCCESS: Video generation completed in ${totalDuration}ms using model ${model.id} (${model.name}) on attempt ${attempt}`);
          return {
            output: output as string | string[],
            status: 'succeeded',
          };
        } catch (apiError: any) {
          // Log the full error response for debugging
          const statusCode = apiError?.status || apiError?.statusCode || apiError?.response?.status;
          const errorMessage = apiError?.message || 'No error message';
          const errorBody = apiError?.response?.data || apiError?.body || apiError?.response?.text || 'N/A';
          
          // Safely format error body for logging
          let errorBodyStr = 'N/A';
          try {
            if (typeof errorBody === 'string') {
              errorBodyStr = errorBody.substring(0, 500);
            } else if (errorBody !== undefined && errorBody !== null) {
              const stringified = JSON.stringify(errorBody);
              errorBodyStr = stringified ? stringified.substring(0, 500) : 'N/A';
            }
          } catch (e) {
            errorBodyStr = 'Error formatting error body';
          }
          
          console.error(`[REPLICATE] API call failed for model ${model.id} with detailed error:`, {
            model: model.id,
            modelName: model.name,
            attempt,
            errorType: apiError?.constructor?.name || 'Unknown',
            errorMessage: errorMessage,
            statusCode: statusCode || 'N/A',
            errorBody: errorBodyStr,
            requestUrl: apiError?.request?.url || apiError?.config?.url || 'N/A',
            requestMethod: apiError?.request?.method || apiError?.config?.method || 'N/A',
            stack: (apiError?.stack && typeof apiError.stack === 'string') ? apiError.stack.split('\n').slice(0, 5).join('\n') : 'N/A',
          });
          
          // Check if this is a model not found error (422)
          const isModelNotFound = statusCode === 422; // Model doesn't exist or not accessible
          
          // If model doesn't exist (422), skip to next model immediately
          if (isModelNotFound) {
            console.warn(`[REPLICATE] Model ${model.id} not found or not accessible (422). Error details: ${errorMessage}`);
            throw new Error(`MODEL_NOT_FOUND: Model ${model.id} is not available. Error: ${errorMessage}`);
          }
          
          // Re-throw to be handled by outer catch block
          throw apiError;
        }

      } catch (error: any) {
        lastError = error;
        const isLastAttempt = attempt === maxRetries;
        const isLastModelAttempt = isLastAttempt && isLastModel;
        
        // Extract response body if available (Replicate SDK might have it in different places)
        let responseBody: string = 'N/A';
        if (error?.response?.data) {
          responseBody = typeof error.response.data === 'string' 
            ? error.response.data 
            : JSON.stringify(error.response.data);
        } else if (error?.body) {
          responseBody = typeof error.body === 'string' 
            ? error.body 
            : JSON.stringify(error.body);
        } else if (error?.response?.text) {
          responseBody = typeof error.response.text === 'string'
            ? error.response.text
            : String(error.response.text);
        }
        
        // Ensure responseBody is always a string before calling substring
        const responseBodyStr = typeof responseBody === 'string' 
          ? (responseBody !== 'N/A' ? responseBody.substring(0, 500) : 'N/A')
          : String(responseBody).substring(0, 500);
        
        // Log detailed error information
        const errorDetails = {
          model: model.id,
          modelName: model.name,
          attempt,
          isLastAttempt,
          isLastModel,
          predictionId: predictionId || 'N/A',
          errorType: error?.constructor?.name || 'Unknown',
          errorMessage: error?.message || 'No error message',
          errorStack: error?.stack?.split('\n').slice(0, 10).join('\n') || 'No stack trace', // Limit stack trace length
          statusCode: error?.status || error?.statusCode || error?.response?.status || 'N/A',
          responseBody: responseBodyStr, // Limit response body length
          responseHeaders: error?.response?.headers ? Object.keys(error?.response?.headers) : 'N/A',
          url: error?.config?.url || error?.request?.url || error?.url || 'N/A',
          method: error?.config?.method || error?.request?.method || 'N/A',
          // Additional Replicate-specific error fields
          replicateError: error?.error || 'N/A',
          replicateDetail: error?.detail || 'N/A',
        };

        console.error(`[REPLICATE] ERROR on attempt ${attempt}/${maxRetries} with model ${model.id}:`, JSON.stringify(errorDetails, null, 2));
        
        // Check if this is a MODEL_NOT_FOUND error - skip to next model immediately
        const isModelNotFound = error?.message?.includes('MODEL_NOT_FOUND');
        if (isModelNotFound) {
          console.log(`[REPLICATE] Model ${model.id} not available. Skipping to next model...`);
          break; // Break out of retry loop to try next model immediately
        }
        
        // Extract more detailed error information
        let errorMessage = `Video generation failed with model ${model.id}`;
        
        // Check for HTTP status codes in error
        const statusCode = error.status || error.statusCode || (error.response?.status);
        
        if (error.message) {
          // Check if error message contains status information
          if (error.message.includes('500')) {
            errorMessage = `Model ${model.id} is experiencing temporary issues (500 Internal Server Error).`;
          } else if (error.message.includes('422')) {
            errorMessage = `Model ${model.id} is not available or not accessible (422).`;
          } else if (error.message.includes('429')) {
            errorMessage = `Rate limit exceeded for model ${model.id}.`;
          } else if (error.message.includes('401') || error.message.includes('403')) {
            errorMessage = 'Authentication failed. Please check your REPLICATE_API_TOKEN in the backend .env file.';
          } else {
            errorMessage = `${model.id}: ${error.message}`;
          }
        } else if (statusCode === 500) {
          errorMessage = `Model ${model.id} is experiencing temporary issues (500 Internal Server Error).`;
        } else if (statusCode === 422) {
          errorMessage = `Model ${model.id} is not available or not accessible (422).`;
        } else if (statusCode === 429) {
          errorMessage = `Rate limit exceeded for model ${model.id}.`;
        } else if (statusCode === 401 || statusCode === 403) {
          errorMessage = 'Authentication failed. Please check your REPLICATE_API_TOKEN in the backend .env file.';
        } else if (error.response?.data?.detail) {
          errorMessage = `Model ${model.id}: ${error.response.data.detail}`;
        }
        
        // If this is the last attempt on the last model, return failure
        if (isLastModelAttempt) {
          const totalDuration = Date.now() - startTime;
          console.error(`[REPLICATE] FAILED: All ${maxRetries} attempts exhausted on all ${videoGenerationModels.length} video generation models after ${totalDuration}ms`);
          return {
            output: '',
            status: 'failed',
            error: `All video generation models failed. Last error: ${errorMessage}`,
          };
        }

        // If this is the last attempt for this model, try next model
        if (isLastAttempt) {
          console.log(`[REPLICATE] Model ${model.id} failed after ${maxRetries} attempts. Trying next video generation model...`);
          break; // Break out of retry loop to try next model
        }

        // Exponential backoff: wait longer for 500 errors (they're usually temporary)
        const baseWaitTime = statusCode === 500 ? 10000 : 2000; // 10 seconds for 500 errors, 2 seconds otherwise
        const waitTime = Math.pow(2, attempt) * baseWaitTime;
        console.log(`[REPLICATE] Retrying model ${model.id} in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  const totalDuration = Date.now() - startTime;
  console.error(`[REPLICATE] FAILED: Video generation failed after ${totalDuration}ms`);
  return {
    output: '',
    status: 'failed',
    error: lastError?.message || 'Video generation failed after retries',
  };
}

/**
 * Convert aspect ratio string to "W:H" format
 * Handles common formats like "16:9", "landscape", "portrait", "square", etc.
 */
function convertAspectRatioToRatio(aspectRatio: string): string | null {
  const normalized = aspectRatio.toLowerCase().trim();
  
  // Common aspect ratio mappings
  const aspectRatioMap: Record<string, string> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '1:1': '1:1',
    '4:3': '4:3',
    '3:4': '3:4',
    '21:9': '21:9',
    'landscape': '16:9',
    'portrait': '9:16',
    'square': '1:1',
    'widescreen': '16:9',
    'vertical': '9:16',
    'mobile': '9:16',
    'desktop': '16:9',
  };
  
  if (aspectRatioMap[normalized]) {
    return aspectRatioMap[normalized];
  }
  
  // If it already contains a colon, return as-is
  if (normalized.includes(':')) {
    return normalized;
  }
  
  // Default to 16:9 if unknown format
  console.warn(`[REPLICATE] Unknown aspect ratio format: ${aspectRatio}, defaulting to 16:9`);
  return '16:9';
}

/**
 * Generate image using Replicate API
 */
export async function generateImage(
  options: ImageGenerationOptions,
  maxRetries: number = 3
): Promise<ImageGenerationResult> {
  console.log('[REPLICATE] Starting image generation', {
    promptLength: options.prompt?.length || 0,
    modelId: options.imageModelId,
  });

  if (!replicate) {
    console.error('[REPLICATE] ERROR: Replicate client not initialized - missing API token');
    return {
      output: '',
      status: 'failed',
      error: 'REPLICATE_API_TOKEN is required. Please set REPLICATE_API_TOKEN in your environment variables.',
    };
  }

  const {
    prompt,
    imageModelId = 'openai/dall-e-3',
    aspectRatio,
  } = options;

  const modelIdToUse = imageModelId;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[REPLICATE] Attempt ${attempt}/${maxRetries} with model ${modelIdToUse}`);
      
      const truncatedPrompt = prompt.substring(0, 1000);
      
      const modelInput: any = {
        prompt: truncatedPrompt,
      };
      
      // Add aspect_ratio if specified
      if (aspectRatio) {
        const normalizedAspectRatio = aspectRatio.includes(':') 
          ? aspectRatio 
          : convertAspectRatioToRatio(aspectRatio);
        
        if (normalizedAspectRatio) {
          modelInput.aspect_ratio = normalizedAspectRatio;
        }
      }
      
      console.log(`[REPLICATE] Calling replicate.run("${modelIdToUse}", { input: ${JSON.stringify(modelInput)} })`);
      
      const runOutput = await replicate.run(modelIdToUse as any, { input: modelInput });
      
      let output: string | string[];
      
      // Handle different output formats (similar to video generation)
      if (runOutput && typeof (runOutput as any).url === 'function') {
        output = (runOutput as any).url();
      } else if (typeof runOutput === 'string') {
        output = runOutput;
      } else if (Array.isArray(runOutput)) {
        output = runOutput.map((item: any) => {
          if (typeof item === 'string') return item;
          if (item && typeof item.url === 'function') return item.url();
          if (item && typeof item === 'object' && 'url' in item) return item.url as string;
          return String(item);
        });
      } else if (runOutput && typeof runOutput === 'object' && 'url' in runOutput) {
        output = (runOutput as any).url;
      } else {
        output = String(runOutput);
      }
      
      if (typeof output === 'string') {
        output = String(output);
      } else if (Array.isArray(output)) {
        output = output.map(String);
      }
      
      console.log(`[REPLICATE] Image generation succeeded with model ${modelIdToUse}`);
      return {
        output,
        status: 'succeeded',
      };
    } catch (error: any) {
      console.error(`[REPLICATE] Attempt ${attempt}/${maxRetries} failed:`, error);
      
      if (attempt === maxRetries) {
        return {
          output: '',
          status: 'failed',
          error: error.message || 'Image generation failed',
        };
      }
      
      const waitTime = Math.pow(2, attempt) * 2000;
      console.log(`[REPLICATE] Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  return {
    output: '',
    status: 'failed',
    error: 'Image generation failed after retries',
  };
}

/**
 * Check status of a running prediction
 */
export async function checkPredictionStatus(predictionId: string): Promise<VideoGenerationResult> {
  if (!replicate) {
    return {
      output: '',
      status: 'failed',
      error: 'REPLICATE_API_TOKEN is required. Please set REPLICATE_API_TOKEN in your environment variables.',
    };
  }

  try {
    const prediction = await replicate.predictions.get(predictionId);
    
    if (prediction.status === 'succeeded') {
      return {
        output: (prediction.output as string | string[]) || '',
        status: 'succeeded',
      };
    } else if (prediction.status === 'failed') {
      return {
        output: '',
        status: 'failed',
        error: (prediction.error as string) || 'Prediction failed',
      };
    } else {
      return {
        output: '',
        status: 'processing',
      };
    }
  } catch (error: any) {
    return {
      output: '',
      status: 'failed',
      error: error.message || 'Failed to check prediction status',
    };
  }
}

