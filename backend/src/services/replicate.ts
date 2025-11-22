import Replicate from 'replicate';
import { config } from '../config';
import { convertS3UrlToPresigned } from './storage';

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
    'openai/sora-2-pro': { costPerSecond: 0.15, tier: 'premium' },
    'kwaivgi/kling-v2.5-turbo-pro': { costPerSecond: 0.07, tier: 'economy' },
  };

// Model ID to display name mapping for video models
export const VIDEO_MODEL_NAMES: Record<string, string> = {
  'google/veo-3': 'Veo 3',
  'google/veo-3.1': 'Veo 3.1',
  'google/veo-3-fast': 'Veo 3 Fast',
  'openai/sora-2': 'Sora 2',
  'openai/sora-2-pro': 'Sora 2 Pro',
  'kwaivgi/kling-v2.5-turbo-pro': 'Kling 2.5 Turbo Pro',
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
// Fallback models - only include models that are in the dropdown
// This matches the frontend dropdown options in SimpleCreatePage.tsx
const FALLBACK_VIDEO_MODELS: VideoModel[] = [
  {
    id: 'google/veo-3.1',
    name: 'Google Veo 3.1',
    description: 'Premium video generation',
    maxDuration: 8,
    costPerSecond: 0.20,
    tier: 'premium',
  },
  {
    id: 'google/veo-3',
    name: 'Google Veo 3',
    description: 'High quality video generation',
    maxDuration: 60,
    costPerSecond: 0.20,
    tier: 'premium',
  },
  {
    id: 'google/veo-3-fast',
    name: 'Google Veo 3 Fast',
    description: 'Fast video generation',
    maxDuration: 60,
    costPerSecond: 0.15,
    tier: 'standard',
  },
  {
    id: 'openai/sora-2-pro',
    name: 'Sora 2 Pro',
    description: 'OpenAI\'s most advanced synced-audio video generation',
    maxDuration: 4,
    costPerSecond: 0.15,
    tier: 'premium',
  },
  {
    id: 'openai/sora-2',
    name: 'Sora 2',
    description: 'OpenAI\'s video generation model',
    maxDuration: 12,
    costPerSecond: 0.10,
    tier: 'standard',
  },
  {
    id: 'kwaivgi/kling-v2.5-turbo-pro',
    name: 'Kling 2.5 Turbo Pro',
    description: 'High quality video generation',
    maxDuration: 60,
    costPerSecond: 0.07,
    tier: 'economy',
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

    // Only fetch models that are in the dropdown list (user-selected models)
    // This matches the frontend dropdown options in SimpleCreatePage.tsx
    const knownVideoModelIds = [
      'openai/sora-2-pro',
      'google/veo-3',
      'google/veo-3.1',
      'google/veo-3-fast',
      'openai/sora-2',
      'kwaivgi/kling-v2.5-turbo-pro',
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

        // Known video model patterns - explicitly include these even if keywords don't match
        const isKnownVideoModel = modelId.includes('video') || 
          modelId.includes('dream-machine') || 
          modelId.includes('zeroscope') || 
          modelId.includes('ray') ||
          modelId.includes('veo') ||
          modelId.includes('sora') ||
          modelId.includes('kling') ||
          modelId.includes('seedance') ||
          modelId.includes('haiper') ||
          modelId.includes('hunyuan') ||
          modelId.includes('mochi') ||
          modelId.includes('gen3') ||
          modelId.includes('pika') ||
          modelId.includes('wan-');

        if (isVideoModel || isKnownVideoModel) {
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
  // Style and mood parameters
  style?: string; // Visual style
  mood?: string; // Emotional tone
  colorPalette?: string; // Color palette
  pacing?: string; // Pacing/style
  // Veo 3.1 specific parameters
  image?: string; // URL of reference image (first frame/starting image)
  resolution?: string; // Resolution setting for Veo 3.1
  lastFrame?: string; // URL of last frame for continuation
  video?: string; // URL of previous video clip for extension (extends the video)
  referenceImages?: string[]; // Array of reference image URLs (for characters, artifacts, style consistency)
  negativePrompt?: string; // Negative prompt
  seed?: number; // Seed for reproducibility
  withAudio?: boolean; // Enable audio generation (default: true)
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
  videoId?: string; // Video ID from Replicate (if available)
  videoObject?: any; // The video object/result from Replicate (for extension)
  gcsUri?: string; // Google Cloud Storage URI (for Veo 3.1)
}

/**
 * Convert and validate image URL for Replicate API
 * - Converts S3 URLs to presigned URLs (24 hour expiration for Replicate access)
 * - Validates URL is accessible via HEAD request
 * - Returns null if URL is invalid or inaccessible (caller should skip parameter)
 */
async function prepareImageUrlForReplicate(
  url: string | undefined | null,
  urlType: 'lastFrame' | 'image' | 'video' | 'reference_image' = 'image'
): Promise<string | null> {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return null;
  }

  const trimmedUrl = url.trim();

  // Validate URL format (must be HTTPS)
  try {
    const urlObj = new URL(trimmedUrl);
    if (urlObj.protocol !== 'https:') {
      console.warn(`[REPLICATE] ${urlType} URL must use HTTPS protocol: ${trimmedUrl.substring(0, 100)}`);
      return null;
    }
  } catch (error) {
    console.warn(`[REPLICATE] Invalid ${urlType} URL format: ${trimmedUrl.substring(0, 100)}`, error);
    return null;
  }

  // Check URL length (Replicate may have limits)
  if (trimmedUrl.length > 2048) {
    console.warn(`[REPLICATE] ${urlType} URL is too long (${trimmedUrl.length} chars, max ~2048): ${trimmedUrl.substring(0, 100)}...`);
    return null;
  }

  try {
    // Convert S3 URLs to presigned URLs (24 hour expiration for Replicate to access)
    const presignedUrl = await convertS3UrlToPresigned(trimmedUrl, 86400); // 24 hours
    
    if (!presignedUrl) {
      console.warn(`[REPLICATE] Failed to convert ${urlType} URL to presigned URL: ${trimmedUrl.substring(0, 100)}`);
      return null;
    }
    
    // Verify that presigned URL was actually generated (should contain signature parameters)
    const isPresigned = presignedUrl.includes('X-Amz-Signature') || presignedUrl.includes('AWSAccessKeyId') || presignedUrl.includes('?');
    if (!isPresigned && presignedUrl === trimmedUrl) {
      // If URL wasn't converted and it's an S3 URL, log a warning
      if (trimmedUrl.includes('amazonaws.com') || trimmedUrl.includes('s3.')) {
        console.warn(`[REPLICATE] WARNING: ${urlType} S3 URL was not converted to presigned URL. Using original URL: ${trimmedUrl.substring(0, 100)}`);
        // Still return the URL - it might work if bucket is public, but this is not ideal
      }
    }

    // Validate URL is accessible via HEAD request (with timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(presignedUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VidVerse/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[REPLICATE] ${urlType} URL is not accessible (HTTP ${response.status}): ${presignedUrl.substring(0, 100)}`);
        return null;
      }

      // Check content type if available
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) {
        console.warn(`[REPLICATE] ${urlType} URL does not point to an image (Content-Type: ${contentType}): ${presignedUrl.substring(0, 100)}`);
        // Still return URL - some servers don't set content-type correctly
      }

      console.log(`[REPLICATE] Successfully validated ${urlType} URL (${response.status}, ${contentType || 'unknown type'}): ${presignedUrl.substring(0, 100)}...`);
      return presignedUrl;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.warn(`[REPLICATE] ${urlType} URL validation timed out: ${presignedUrl.substring(0, 100)}`);
      } else {
        console.warn(`[REPLICATE] ${urlType} URL validation failed: ${presignedUrl.substring(0, 100)}`, fetchError.message);
      }
      // Return URL anyway - validation failure doesn't mean Replicate can't access it
      // (might be network issue, CORS, etc.)
      return presignedUrl;
    }
  } catch (error: any) {
    console.error(`[REPLICATE] Error preparing ${urlType} URL for Replicate: ${trimmedUrl.substring(0, 100)}`, error?.message || error);
    return null;
  }
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
    style,
    mood,
    colorPalette,
    pacing,
  } = options;
  
  // Sanitize prompt: Remove ALL special characters, emojis, and formatting - keep ONLY pure text
  const sanitizePrompt = (text: string): string => {
    if (!text || typeof text !== 'string') return text;
    
    let cleaned = text;
    
    // Step 1: Remove ALL emojis and special Unicode symbols (comprehensive removal)
    // Remove emoji ranges
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}]/gu, ''); // Emoji range
    cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Miscellaneous symbols (includes clocks, etc.)
    cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
    cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and map symbols
    cleaned = cleaned.replace(/[\u{1F700}-\u{1F77F}]/gu, ''); // Alchemical symbols
    cleaned = cleaned.replace(/[\u{1F780}-\u{1F7FF}]/gu, ''); // Geometric shapes extended
    cleaned = cleaned.replace(/[\u{1F800}-\u{1F8FF}]/gu, ''); // Supplemental arrows-C
    cleaned = cleaned.replace(/[\u{1F900}-\u{1F9FF}]/gu, ''); // Supplemental symbols and pictographs
    cleaned = cleaned.replace(/[\u{1FA00}-\u{1FA6F}]/gu, ''); // Chess symbols
    cleaned = cleaned.replace(/[\u{1FA70}-\u{1FAFF}]/gu, ''); // Symbols and pictographs extended-A
    cleaned = cleaned.replace(/[\u{FE00}-\u{FE0F}]/gu, ''); // Variation selectors
    cleaned = cleaned.replace(/[\u{200D}]/gu, ''); // Zero width joiner
    cleaned = cleaned.replace(/[\u{FEFF}]/gu, ''); // Zero width no-break space
    
    // Step 2: Remove ALL box-drawing and special line characters
    cleaned = cleaned.replace(/[━─═─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╌╍╎╏═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿]/g, '');
    
    // Step 3: Remove metadata lines with special characters (Time: X.Xs - Y.Ys, etc.)
    cleaned = cleaned.replace(/.*Time:\s*\d+\.\d+s\s*-\s*\d+\.\d+s.*/gi, '');
    cleaned = cleaned.replace(/.*⏰.*/g, ''); // Remove any line with clock emoji
    cleaned = cleaned.replace(/.*⏱️.*/g, ''); // Remove any line with timer emoji
    cleaned = cleaned.replace(/.*📋.*/g, ''); // Remove any line with clipboard emoji
    
    // Step 4: Remove "Prompt:" labels and section headers
    cleaned = cleaned.replace(/.*Prompt:\s*/gi, '');
    cleaned = cleaned.replace(/.*PROMPT:\s*/gi, '');
    
    // Step 5: Remove "Visual specifications:" lines
    cleaned = cleaned.replace(/Visual specifications:.*$/gim, '');
    cleaned = cleaned.replace(/VISUAL SPECIFICATIONS:.*$/gim, '');
    
    // Step 6: Remove separator lines (lines with only dashes, equals, or special chars)
    cleaned = cleaned.replace(/^[━─═\s]+$/gm, '');
    cleaned = cleaned.replace(/^[─\s]+$/gm, '');
    cleaned = cleaned.replace(/^[═\s]+$/gm, '');
    
    // Step 7: Keep ONLY alphanumeric, basic punctuation, spaces, and newlines
    // Allow: letters (a-z, A-Z), numbers (0-9), spaces, newlines, and basic punctuation: . , ! ? : ; - ' " ( ) [ ]
    cleaned = cleaned.split('').map(char => {
      const code = char.charCodeAt(0);
      // Allow: letters, numbers, spaces, newlines, tabs, and basic punctuation
      if (
        (code >= 32 && code <= 126) || // ASCII printable (includes punctuation)
        code === 9 || // Tab
        code === 10 || // Newline
        code === 13 // Carriage return
      ) {
        return char;
      }
      return ' '; // Replace other characters with space
    }).join('');
    
    // Step 8: Clean up whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
    cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
    cleaned = cleaned.replace(/^\s+|\s+$/gm, ''); // Trim each line
    cleaned = cleaned.trim(); // Trim entire string
    
    // Step 9: Remove empty lines
    cleaned = cleaned.split('\n').filter(line => line.trim().length > 0).join('\n');
    
    return cleaned.trim();
  };
  
  // Sanitize the prompt first
  let sanitizedPrompt = sanitizePrompt(prompt);
  
  // Enhance prompt with style, mood, colorPalette, and pacing if provided
  let enhancedPrompt = sanitizedPrompt;
  const enhancements: string[] = [];
  
  if (style) {
    enhancements.push(`Style: ${style}`);
  }
  if (mood) {
    enhancements.push(`Mood: ${mood}`);
  }
  if (colorPalette) {
    enhancements.push(`Color palette: ${colorPalette}`);
  }
  if (pacing) {
    enhancements.push(`Pacing: ${pacing}`);
  }
  
  if (enhancements.length > 0) {
    enhancedPrompt = `${sanitizedPrompt}\n\nVisual specifications: ${enhancements.join(', ')}`;
  }
  
  // Log prompt sanitization details
  if (prompt !== sanitizedPrompt) {
    console.log('[REPLICATE] Prompt sanitized:', {
      originalLength: prompt.length,
      sanitizedLength: sanitizedPrompt.length,
      originalPreview: prompt.substring(0, 200) + '...',
      sanitizedPreview: sanitizedPrompt.substring(0, 200) + '...',
      removedSpecialChars: prompt.length - sanitizedPrompt.length,
    });
  }
  
  // Log prompt enhancement for debugging
  console.log(`[REPLICATE] Prompt enhancement:`, {
    originalPromptLength: prompt?.length || 0,
    enhancedPromptLength: enhancedPrompt?.length || 0,
    enhancementsAdded: enhancements.length,
    originalPromptPreview: prompt?.substring(0, 200) + (prompt && prompt.length > 200 ? '...' : ''),
    enhancedPromptPreview: enhancedPrompt?.substring(0, 200) + (enhancedPrompt && enhancedPrompt.length > 200 ? '...' : ''),
  });

  // Calculate numFrames based on duration and fps (for reference, not used in API call)
  // const numFrames = Math.ceil(duration * fps);

  // Use the selected video model ID directly
  const selectedModelId = options.videoModelId || 'google/veo-3.1'; // Default to Veo 3.1
  
  let videoGenerationModels: VideoModel[];
  
  // Only fetch/validate the specific model that was requested, not all models
  // First check fallback list (no API call needed)
  const fallbackModel = FALLBACK_VIDEO_MODELS.find(m => m.id === selectedModelId);
  
  if (fallbackModel) {
    // Use fallback model directly without API call
    videoGenerationModels = [fallbackModel];
    console.log(`[REPLICATE] Using model: ${fallbackModel.id} (${fallbackModel.name}) from fallback list`);
  } else if (replicate) {
    // Only if not in fallback, try to fetch just this one model from API
    try {
      const [owner, name] = selectedModelId.split('/');
      const model = await replicate.models.get(owner, name);
      
      // Get pricing information for this model
      const pricing = MODEL_PRICING[selectedModelId] || { costPerSecond: 0.10, tier: 'standard' as const };
      
      // Try to get version (optional, don't fail if it doesn't expose versions)
      let latestVersionId: string | undefined;
      try {
        const versions = await replicate.models.versions.list(owner, name);
        if (versions.results && versions.results.length > 0) {
          latestVersionId = versions.results[0].id;
        }
      } catch (versionError: any) {
        // Many models don't expose versions - this is fine, just log it
        console.debug(`[REPLICATE] Model ${selectedModelId} does not expose versions (this is normal)`);
      }
      
      // Determine max duration based on model
      let maxDuration = 60; // Default
      if (selectedModelId.includes('sora-2-pro')) {
        maxDuration = 4;
      } else if (selectedModelId.includes('sora-2')) {
        maxDuration = 12;
      } else if (selectedModelId.includes('veo-3.1')) {
        maxDuration = 8;
      }
      
      const fetchedModel: VideoModel = {
        id: selectedModelId,
        version: latestVersionId,
        name: model.name || selectedModelId,
        description: model.description || 'Video generation model',
        maxDuration,
        costPerSecond: pricing.costPerSecond,
        tier: pricing.tier,
      };
      
      videoGenerationModels = [fetchedModel];
      console.log(`[REPLICATE] Using model: ${fetchedModel.id} (${fetchedModel.name}) from API`);
    } catch (apiError: any) {
      // If API fetch fails, return error
      console.error(`[REPLICATE] Model ${selectedModelId} not found or not accessible: ${apiError.message}`);
      return {
        output: '',
        status: 'failed',
        error: `MODEL_NOT_FOUND: Model ${selectedModelId} is not available. Please select a different model.`,
      };
    }
  } else {
    // No replicate client and not in fallback
    console.error(`[REPLICATE] Model ${selectedModelId} not found in fallback list and Replicate client not initialized`);
    return {
      output: '',
      status: 'failed',
      error: `MODEL_NOT_FOUND: Model ${selectedModelId} is not available. Please select a different model.`,
    };
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
        // For Sora-2 models, aspect ratio determines fixed resolution:
        // Portrait = 720x1280, Landscape = 1280x720
        // For other models, use width/height defaults
        const isSora2 = model.id === 'openai/sora-2' || model.id === 'openai/sora-2-pro';
        const logAspectRatio = isSora2 
          ? (aspectRatio ? `(${aspectRatio} -> ${aspectRatio.includes('9:16') || aspectRatio.toLowerCase().includes('portrait') ? 'portrait (720x1280)' : 'landscape (1280x720)'})` : 'landscape (1280x720)')
          : `${width}:${height}`;
        
        console.log(`[REPLICATE] Attempt ${attempt}/${maxRetries} with model ${model.id} - Preparing API call`, {
          model: model.id,
          modelName: model.name,
          promptPreview: prompt?.substring(0, 100) + '...',
          promptLength: prompt?.length || 0,
          duration: Math.min(duration, model.maxDuration),
          aspectRatio: logAspectRatio,
        });

        // Use replicate.run for simpler API - it handles the prediction lifecycle automatically
        // Truncate prompt to model-specific limits to avoid API issues
        if (!enhancedPrompt || typeof enhancedPrompt !== 'string') {
          throw new Error(`Invalid prompt: prompt must be a non-empty string, got ${typeof enhancedPrompt}`);
        }
        
        // Model-specific prompt length limits (characters)
        const modelPromptLimits: Record<string, number> = {
          'openai/sora-2': 12000,        // Sora 2 supports very long prompts
          'openai/sora-2-pro': 12000,    // Sora 2 Pro supports very long prompts
          'google/veo-3': 12000,         // Veo 3 supports very long prompts
          'google/veo-3.1': 5000,        // Veo 3.1 prompt limit set to 5000 characters
          'google/veo-3-fast': 12000,    // Veo 3 Fast supports very long prompts
          'kwaivgi/kling-v2.5-turbo-pro': 12000, // Kling supports very long prompts
        };
        
        const maxPromptLength = modelPromptLimits[model.id] || 12000; // Default to 12000 characters
        const truncatedPrompt = enhancedPrompt.length > maxPromptLength 
          ? enhancedPrompt.substring(0, maxPromptLength - 3) + '...'
          : enhancedPrompt;
        
        // Log prompt length at each stage for debugging
        console.log(`[REPLICATE] ========== PROMPT LENGTH TRACKING ==========`);
        console.log(`[REPLICATE] Original prompt length: ${prompt?.length || 0} characters`);
        console.log(`[REPLICATE] Sanitized prompt length: ${sanitizedPrompt?.length || 0} characters`);
        console.log(`[REPLICATE] Enhanced prompt length: ${enhancedPrompt?.length || 0} characters`);
        console.log(`[REPLICATE] Model: ${model.id}, Max limit: ${maxPromptLength} characters`);
        console.log(`[REPLICATE] Final prompt length (after truncation): ${truncatedPrompt.length} characters`);
        
        if (truncatedPrompt.length < enhancedPrompt.length) {
          console.log(`[REPLICATE] ⚠️ PROMPT TRUNCATED from ${enhancedPrompt.length} to ${truncatedPrompt.length} characters (model: ${model.id}, limit: ${maxPromptLength})`);
          console.log(`[REPLICATE] Truncated prompt preview (first 200 chars): ${truncatedPrompt.substring(0, 200)}...`);
          console.log(`[REPLICATE] Truncated prompt preview (last 200 chars): ...${truncatedPrompt.substring(truncatedPrompt.length - 200)}`);
        } else {
          console.log(`[REPLICATE] ✓ Prompt length OK: ${enhancedPrompt.length} characters (limit: ${maxPromptLength}, model: ${model.id})`);
        }
        console.log(`[REPLICATE] ===========================================`);

        const apiCallStartTime = Date.now();
        // For Sora-2, show the actual aspect_ratio value that will be sent (portrait/landscape)
        // For other models, show width:height format
        const logInputAspectRatio = isSora2
          ? (aspectRatio ? (aspectRatio.includes('9:16') || aspectRatio.toLowerCase().includes('portrait') ? 'portrait (720x1280)' : 'landscape (1280x720)') : 'landscape (1280x720)')
          : `${width}:${height}`;
        
        console.log(`[REPLICATE] Calling Replicate API with video generation model: ${model.id}`, {
          model: model.id,
          modelName: model.name,
          input: {
            promptLength: truncatedPrompt.length,
            aspect_ratio: logInputAspectRatio,
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
          const isSora2Pro = model.id === 'openai/sora-2-pro';
          const isVeo3Fast = model.id === 'google/veo-3-fast';
          const isVeo3 = model.id === 'google/veo-3' || model.id === 'google/veo-3.1';
          const isKling = model.id === 'kwaivgi/kling-v2.5-turbo-pro';
          
          if (isVeo3Fast) {
            // Veo 3 Fast format: prompt, aspect_ratio, duration, resolution, generate_audio, image, negative_prompt, seed, enhance_prompt
            // Normalize aspect ratio to "W:H" format (e.g., "16:9", "9:16", "1:1")
            let veoFastAspectRatio: string;
            if (aspectRatio) {
              const normalizedAspectRatio = aspectRatio.includes(':') 
                ? aspectRatio 
                : convertAspectRatioToRatio(aspectRatio);
              veoFastAspectRatio = normalizedAspectRatio || '16:9';
            } else {
              veoFastAspectRatio = '16:9'; // Default to 16:9 landscape
            }
            
            // Required parameters
            modelInput.aspect_ratio = veoFastAspectRatio;
            modelInput.duration = Math.min(duration, 60); // Veo supports up to 60 seconds
            modelInput.resolution = '1080p'; // Default to 1080p
            modelInput.generate_audio = true; // Default to true
            modelInput.enhance_prompt = true; // Default to true (Veo 3 Fast specific)
            
            // Optional parameters - image (reference image)
            if (options.image) {
              const preparedImageUrl = await prepareImageUrlForReplicate(options.image, 'image');
              if (preparedImageUrl) {
                modelInput.image = preparedImageUrl;
                console.log(`[REPLICATE] Adding image parameter for Veo 3 Fast: ${preparedImageUrl.substring(0, 100)}...`);
              } else {
                console.warn(`[REPLICATE] Skipping image parameter for Veo 3 Fast - URL validation/conversion failed: ${options.image.substring(0, 100)}`);
              }
            }
            
            // Optional parameters - negative_prompt
            if (options.negativePrompt) {
              modelInput.negative_prompt = options.negativePrompt;
              console.log(`[REPLICATE] Adding negative_prompt parameter for Veo 3 Fast`);
            }
            
            // Optional parameters - seed
            if (options.seed !== undefined && options.seed !== null) {
              modelInput.seed = options.seed;
              console.log(`[REPLICATE] Adding seed parameter for Veo 3 Fast: ${options.seed}`);
            }
            
            console.log(`[REPLICATE] Adding Veo 3 Fast parameters: aspect_ratio=${veoFastAspectRatio}, duration=${modelInput.duration}, resolution=${modelInput.resolution}, generate_audio=${modelInput.generate_audio}, enhance_prompt=${modelInput.enhance_prompt}`);
          } else if (isSora2 || isSora2Pro) {
            // Sora-2 and Sora-2 Pro format: prompt, aspect_ratio, seconds, input_reference (optional), resolution (Pro only)
            // IMPORTANT: Sora-2 uses fixed resolutions based on aspect_ratio:
            // - Portrait (9:16): 720x1280
            // - Landscape (16:9): 1280x720
            // The width/height parameters are NOT used for Sora-2 models
            let soraAspectRatio: string;
            if (aspectRatio) {
              // Normalize aspect ratio format first
              const normalizedAspectRatio = aspectRatio.includes(':') 
                ? aspectRatio 
                : convertAspectRatioToRatio(aspectRatio);
              
              // Convert to Sora format: "portrait" or "landscape"
              if (normalizedAspectRatio) {
                // Check if it's portrait (height > width) or landscape (width >= height)
                const [width, height] = normalizedAspectRatio.split(':').map(Number);
                soraAspectRatio = height > width ? 'portrait' : 'landscape';
              } else {
                // Default to portrait for Sora-2 Pro, landscape for Sora-2
                soraAspectRatio = isSora2Pro ? 'portrait' : 'landscape';
              }
            } else {
              // Default to portrait for Sora-2 Pro, landscape for Sora-2
              soraAspectRatio = isSora2Pro ? 'portrait' : 'landscape';
            }
            
            modelInput.aspect_ratio = soraAspectRatio;
            const soraResolution = soraAspectRatio === 'portrait' ? '720x1280' : '1280x720';
            console.log(`[REPLICATE] Adding aspect_ratio parameter for ${isSora2Pro ? 'Sora-2 Pro' : 'Sora-2'}: ${soraAspectRatio} (resolution: ${soraResolution})`);
            
            // Sora-2 and Sora-2 Pro support "seconds" parameter (optional, has defaults)
            // Sora-2: 4, 8, or 12 (defaults to 4 if not specified)
            // Sora-2 Pro: 4 (default, may support more)
            // Only include seconds if duration is explicitly provided and valid
            if (duration && duration > 0) {
              const validSeconds = isSora2Pro ? [4] : [4, 8, 12];
              const requestedSeconds = Math.min(duration, isSora2Pro ? 4 : 12);
              const soraSeconds = validSeconds.reduce((prev, curr) => 
                Math.abs(curr - requestedSeconds) < Math.abs(prev - requestedSeconds) ? curr : prev
              );
              modelInput.seconds = soraSeconds;
              console.log(`[REPLICATE] Setting seconds parameter for ${isSora2Pro ? 'Sora-2 Pro' : 'Sora-2'}: ${soraSeconds} (requested: ${duration})`);
            } else {
              console.log(`[REPLICATE] No duration specified for ${isSora2Pro ? 'Sora-2 Pro' : 'Sora-2'}, using model default`);
            }
            
            // Sora-2 and Sora-2 Pro support input_reference (image URL for first frame)
            if (options.image) {
              const preparedImageUrl = await prepareImageUrlForReplicate(options.image, 'image');
              if (preparedImageUrl) {
                modelInput.input_reference = preparedImageUrl;
                console.log(`[REPLICATE] Adding input_reference parameter for ${isSora2Pro ? 'Sora-2 Pro' : 'Sora-2'}: ${preparedImageUrl.substring(0, 100)}...`);
              } else {
                console.warn(`[REPLICATE] Skipping input_reference parameter for ${isSora2Pro ? 'Sora-2 Pro' : 'Sora-2'} - URL validation/conversion failed: ${options.image.substring(0, 100)}`);
              }
            }
            
            // Sora-2 Pro specific: resolution parameter ("standard" or "high")
            if (isSora2Pro) {
              modelInput.resolution = 'standard'; // Default to "standard" (720p), can be "high" (1024p)
              console.log(`[REPLICATE] Setting resolution parameter for Sora-2 Pro: ${modelInput.resolution}`);
            }
          } else if (isVeo3) {
            // Veo 3/3.1 format: prompt, aspect_ratio, duration, resolution, generate_audio, image, negative_prompt, seed
            // Veo 3.1 also supports: reference_images (array), last_frame
            const isVeo31 = model.id === 'google/veo-3.1';
            
            // Always use 16:9 aspect ratio for Veo 3.1
            modelInput.aspect_ratio = '16:9';
            
            // Veo 3.1 duration must be one of: 4, 6, or 8
            // Veo 3 duration can be up to 60 seconds
            if (isVeo31) {
              const validDurations = [4, 6, 8];
              const requestedDuration = Math.min(duration, 8);
              modelInput.duration = validDurations.reduce((prev, curr) => 
                Math.abs(curr - requestedDuration) < Math.abs(prev - requestedDuration) ? curr : prev
              );
              console.log(`[REPLICATE] Veo 3.1 duration set to ${modelInput.duration} (requested: ${duration}, valid: 4, 6, 8)`);
            } else {
              modelInput.duration = Math.min(duration, 60); // Veo 3 supports up to 60 seconds
            }
            
            // Only set resolution if explicitly provided, otherwise use Veo 3.1 default
            // Veo 3.1 default resolution is typically 1080p, but we let the model decide
            if (options.resolution) {
              modelInput.resolution = options.resolution;
            }
            // Use 'generate_audio' for all Veo models (3, 3.1, 3 Fast)
            modelInput.generate_audio = options.withAudio !== false; // Default to true, but allow override
            
            // Optional parameters - image (starting/reference image for scene continuation)
            // This is used for all Veo models (3, 3.1, 3 Fast) as the reference/starting image
            if (options.image) {
              console.log(`[REPLICATE] Preparing image URL for Veo 3 - Original URL: ${options.image.substring(0, 150)}`);
              const preparedImageUrl = await prepareImageUrlForReplicate(options.image, 'image');
              if (preparedImageUrl) {
                modelInput.image = preparedImageUrl;
                const isPresigned = preparedImageUrl.includes('X-Amz-Signature') || preparedImageUrl.includes('AWSAccessKeyId');
                console.log(`[REPLICATE] Adding image parameter for Veo 3 - Presigned URL: ${preparedImageUrl.substring(0, 150)}...`);
                console.log(`[REPLICATE] Image URL is presigned: ${isPresigned ? 'YES' : 'NO'}`);
                console.log(`[REPLICATE] Image URL changed: ${options.image !== preparedImageUrl ? 'YES (converted to presigned)' : 'NO (same URL)'}`);
              } else {
                console.warn(`[REPLICATE] Skipping image parameter for Veo 3 - URL validation/conversion failed: ${options.image.substring(0, 100)}`);
              }
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
              // Veo 3.1 supports 'video' parameter for extending a previous video clip
              // When 'video' is provided, it extends the previous clip with the new prompt
              // This is different from 'image' which is for starting from a frame
              // Can pass either: video ID (string), video object, or video URL (string)
              if (options.video) {
                // Check if it's a video object (has id property or is an object)
                if (typeof options.video === 'object' && options.video !== null && !Array.isArray(options.video)) {
                  // It's a video object - pass it directly (Replicate SDK handles it)
                  modelInput.video = options.video;
                  const hasId = 'id' in options.video;
                  console.log(`[REPLICATE] Adding video parameter for Veo 3.1 extension - Video object${hasId ? ` (ID: ${(options.video as any).id})` : ''}`);
                  console.log(`[REPLICATE] This is a VIDEO EXTENSION call - will extend the previous video clip using video object`);
                } else if (typeof options.video === 'string') {
                  // It's a string - could be video ID or URL
                  // Check if it looks like a video ID (starts with vid_ or similar) or is a URL
                  if (options.video.startsWith('vid_') || (!options.video.startsWith('http://') && !options.video.startsWith('https://'))) {
                    // It's a video ID - pass as object with id property
                    modelInput.video = { id: options.video };
                    console.log(`[REPLICATE] Adding video parameter for Veo 3.1 extension - Video ID: ${options.video}`);
                    console.log(`[REPLICATE] This is a VIDEO EXTENSION call - will extend the previous video clip using video ID`);
                  } else {
                    // It's a URL - prepare it (convert to presigned if needed)
                    console.log(`[REPLICATE] Preparing video URL for Veo 3.1 extension - Original URL: ${options.video.substring(0, 150)}`);
                    const preparedVideoUrl = await prepareImageUrlForReplicate(options.video, 'video');
                    if (preparedVideoUrl) {
                      modelInput.video = preparedVideoUrl;
                      const isPresigned = preparedVideoUrl.includes('X-Amz-Signature') || preparedVideoUrl.includes('AWSAccessKeyId');
                      console.log(`[REPLICATE] Adding video parameter for Veo 3.1 extension - Presigned URL: ${preparedVideoUrl.substring(0, 150)}...`);
                      console.log(`[REPLICATE] Video URL is presigned: ${isPresigned ? 'YES' : 'NO'}`);
                      console.log(`[REPLICATE] This is a VIDEO EXTENSION call - will extend the previous video clip using video URL`);
                    } else {
                      console.warn(`[REPLICATE] Skipping video parameter for Veo 3.1 - URL validation/conversion failed: ${options.video.substring(0, 100)}`);
                    }
                  }
                }
              }
              
              // Veo 3.1 supports 'last_frame' parameter for specifying the desired end frame
              // 'image' = starting/reference frame (for scene continuation)
              // 'last_frame' = desired end frame (optional, for controlling the ending)
              // Note: 'last_frame' is typically not used when 'video' is provided (video extension)
              if (options.lastFrame && !options.video) {
                console.log(`[REPLICATE] Preparing last_frame URL for Veo 3.1 - Original URL: ${options.lastFrame.substring(0, 150)}`);
                const preparedLastFrameUrl = await prepareImageUrlForReplicate(options.lastFrame, 'lastFrame');
                if (preparedLastFrameUrl) {
                  modelInput.last_frame = preparedLastFrameUrl;
                  const isPresigned = preparedLastFrameUrl.includes('X-Amz-Signature') || preparedLastFrameUrl.includes('AWSAccessKeyId');
                  console.log(`[REPLICATE] Adding last_frame parameter for Veo 3.1 - Presigned URL: ${preparedLastFrameUrl.substring(0, 150)}...`);
                  console.log(`[REPLICATE] Last frame URL is presigned: ${isPresigned ? 'YES' : 'NO'}`);
                } else {
                  console.warn(`[REPLICATE] Skipping last_frame parameter for Veo 3.1 - URL validation/conversion failed: ${options.lastFrame.substring(0, 100)}`);
                }
              } else if (options.lastFrame && options.video) {
                console.log(`[REPLICATE] Skipping last_frame parameter - video extension mode (video parameter takes precedence)`);
              }
              
              // Veo 3.1 supports reference_images (array of URLs) - separate from 'image' parameter
              // reference_images are used for characters, artifacts, and style consistency
              // 'image' is used for first frame/starting point
              // 'last_frame' is used for continuation (different from 'image')
              if (options.referenceImages && Array.isArray(options.referenceImages) && options.referenceImages.length > 0) {
                // Prepare reference image URLs (convert to presigned if needed)
                const preparedReferenceImages: string[] = [];
                for (const refImageUrl of options.referenceImages) {
                  const preparedUrl = await prepareImageUrlForReplicate(refImageUrl, 'reference_image');
                  if (preparedUrl) {
                    preparedReferenceImages.push(preparedUrl);
                  } else {
                    console.warn(`[REPLICATE] Skipping reference image - URL validation/conversion failed: ${refImageUrl.substring(0, 100)}`);
                  }
                }
                
                if (preparedReferenceImages.length > 0) {
                  modelInput.reference_images = preparedReferenceImages;
                  console.log(`[REPLICATE] Adding reference_images parameter for Veo 3.1: ${preparedReferenceImages.length} reference image(s)`);
                  console.log(`[REPLICATE] Reference images URLs: ${preparedReferenceImages.map(url => url.substring(0, 100) + '...').join(', ')}`);
                } else {
                  console.warn(`[REPLICATE] No valid reference images after preparation - skipping reference_images parameter`);
                }
              }
            }
            
            console.log(`[REPLICATE] Adding Veo 3 parameters: aspect_ratio=${modelInput.aspect_ratio}, duration=${modelInput.duration}, resolution=${modelInput.resolution || 'default'}, generate_audio=${modelInput.generate_audio}`);
            
            // Log the complete input object for debugging
            console.log(`[REPLICATE] Complete Veo 3.1 input object:`, JSON.stringify(modelInput, null, 2));
          } else if (isKling) {
            // Kling 2.5 Turbo Pro format: prompt, aspect_ratio, duration, start_image (optional), negative_prompt (optional)
            // Normalize aspect ratio to "W:H" format (e.g., "16:9", "9:16", "1:1")
            let klingAspectRatio: string;
            if (aspectRatio) {
              const normalizedAspectRatio = aspectRatio.includes(':') 
                ? aspectRatio 
                : convertAspectRatioToRatio(aspectRatio);
              klingAspectRatio = normalizedAspectRatio || '16:9';
            } else {
              klingAspectRatio = '16:9'; // Default to 16:9 landscape
            }
            
            // Required parameters
            modelInput.aspect_ratio = klingAspectRatio;
            modelInput.duration = Math.min(duration, 60); // Kling supports up to 60 seconds
            
            // Optional parameters - start_image (first frame)
            if (options.image) {
              const preparedImageUrl = await prepareImageUrlForReplicate(options.image, 'image');
              if (preparedImageUrl) {
                modelInput.start_image = preparedImageUrl;
                console.log(`[REPLICATE] Adding start_image parameter for Kling: ${preparedImageUrl.substring(0, 100)}...`);
              } else {
                console.warn(`[REPLICATE] Skipping start_image parameter for Kling - URL validation/conversion failed: ${options.image.substring(0, 100)}`);
              }
            }
            
            // Optional parameters - negative_prompt
            if (options.negativePrompt) {
              modelInput.negative_prompt = options.negativePrompt;
              console.log(`[REPLICATE] Adding negative_prompt parameter for Kling`);
            }
            
            console.log(`[REPLICATE] Adding Kling parameters: aspect_ratio=${klingAspectRatio}, duration=${modelInput.duration}`);
          } else if (aspectRatio) {
            // For other models, log that aspect_ratio is not supported
            console.log(`[REPLICATE] Model ${model.id} does not support aspect_ratio parameter, ignoring`);
          }
          
          // Use model ID directly (Replicate SDK handles version resolution)
          const modelIdToUse = model.id;
          
          // Log the complete request payload for debugging
          console.log(`[REPLICATE] ========== COMPLETE API REQUEST PAYLOAD ==========`);
          console.log(`[REPLICATE] Model: ${modelIdToUse}`);
          console.log(`[REPLICATE] Full Input JSON:`, JSON.stringify(modelInput, null, 2));
          console.log(`[REPLICATE] PROMPT DETAILS:`, {
            promptLength: modelInput.prompt?.length || 0,
            promptFirst500: modelInput.prompt?.substring(0, 500) || '',
            promptLast500: modelInput.prompt && modelInput.prompt.length > 500 ? modelInput.prompt.substring(modelInput.prompt.length - 500) : modelInput.prompt || '',
            promptFull: modelInput.prompt || '',
          });
          console.log(`[REPLICATE] Input Summary:`, {
            promptLength: modelInput.prompt?.length || 0,
            aspect_ratio: modelInput.aspect_ratio,
            duration: modelInput.duration,
            resolution: modelInput.resolution,
            generate_audio: modelInput.generate_audio,
            hasLastFrame: !!modelInput.last_frame,
            lastFrameUrl: modelInput.last_frame ? (modelInput.last_frame.substring(0, 100) + '...') : null,
            hasImage: !!modelInput.image,
            imageUrl: modelInput.image ? (modelInput.image.substring(0, 100) + '...') : null,
            hasReferenceImages: !!modelInput.reference_images && Array.isArray(modelInput.reference_images) && modelInput.reference_images.length > 0,
            referenceImagesCount: modelInput.reference_images && Array.isArray(modelInput.reference_images) ? modelInput.reference_images.length : 0,
            hasNegativePrompt: !!modelInput.negative_prompt,
            hasSeed: modelInput.seed !== undefined,
          });
          console.log(`[REPLICATE] ==================================================`);
          
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
            hasId: runOutput && typeof runOutput === 'object' && 'id' in runOutput,
            keys: runOutput && typeof runOutput === 'object' ? Object.keys(runOutput) : 'N/A',
          });
          
          // Store the video object/ID for extension (Veo 3.1)
          let videoId: string | undefined;
          let videoObject: any = undefined;
          let gcsUri: string | undefined; // Google Cloud Storage URI for Veo 3.1
          
          // Handle Veo 3.1 response format: { generated_samples: [{ video: { uri: "gs://...", mime_type: "video/mp4" } }] }
          if (runOutput && typeof runOutput === 'object' && 'generated_samples' in runOutput) {
            const generatedSamples = (runOutput as any).generated_samples;
            if (Array.isArray(generatedSamples) && generatedSamples.length > 0) {
              const firstSample = generatedSamples[0];
              if (firstSample && firstSample.video && firstSample.video.uri) {
                gcsUri = firstSample.video.uri;
                console.log(`[REPLICATE] Found GCS URI from Veo 3.1: ${gcsUri}`);
                // Store the entire sample object for extension
                videoObject = firstSample;
                // Extract video ID if available
                if (firstSample.video.id) {
                  videoId = firstSample.video.id;
                }
                // For now, we'll need to convert GCS URI to a downloadable URL
                // This might require additional processing or the URI might be accessible directly
                // For now, use the GCS URI as the output (may need to be converted to HTTP URL later)
                output = gcsUri;
                console.log(`[REPLICATE] Using GCS URI as output: ${output}`);
              }
            }
          }
          
          // If not Veo 3.1 format, handle other output formats
          if (!gcsUri) {
            // Check if runOutput has an ID (for video extension)
            if (runOutput && typeof runOutput === 'object') {
              if ('id' in runOutput && typeof (runOutput as any).id === 'string') {
                videoId = (runOutput as any).id;
                console.log(`[REPLICATE] Found video ID: ${videoId}`);
              }
              // Store the entire object for extension (can be passed directly to video parameter)
              videoObject = runOutput;
            }
            
            // Handle different output formats
            // According to the example: output.url() returns the URL string (async)
            if (runOutput && typeof (runOutput as any).url === 'function') {
              // File-like object with .url() method (matches the example)
              // First check if the object itself has a url property (some FileOutput objects expose it directly)
              if (runOutput && typeof runOutput === 'object' && 'url' in runOutput && typeof (runOutput as any).url === 'string') {
                output = (runOutput as any).url.trim();
                console.log(`[REPLICATE] Got file-like output, extracted URL from object.url property: ${output}`);
              } else {
                // .url() is async, so we need to await it
                const urlResult = await (runOutput as any).url();
                
                // Handle case where .url() returns a string or an object
                if (typeof urlResult === 'string' && urlResult.trim() !== '') {
                  output = urlResult.trim();
                } else if (urlResult && typeof urlResult === 'object') {
                  // If .url() returns an object, it might have a url property or be a File object
                  if ('url' in urlResult && typeof urlResult.url === 'string') {
                    output = urlResult.url.trim();
                  } else if (typeof (urlResult as any).toString === 'function') {
                    // Try to convert to string
                    const str = (urlResult as any).toString();
                    if (typeof str === 'string' && str.trim() !== '' && (str.startsWith('http') || str.startsWith('blob:'))) {
                      output = str.trim();
                    } else {
                      // Log the object structure for debugging
                      console.log(`[REPLICATE] .url() returned object that cannot be converted:`, {
                        keys: Object.keys(urlResult),
                        constructor: urlResult.constructor?.name,
                        preview: JSON.stringify(urlResult).substring(0, 200),
                      });
                      throw new Error(`Replicate .url() method returned an object that cannot be converted to a URL. Object keys: ${Object.keys(urlResult).join(', ')}`);
                    }
                  } else {
                    // Log the object structure for debugging
                    console.log(`[REPLICATE] .url() returned object:`, {
                      keys: Object.keys(urlResult),
                      constructor: urlResult.constructor?.name,
                      preview: JSON.stringify(urlResult).substring(0, 200),
                    });
                    throw new Error(`Replicate .url() method returned an object instead of a URL string. Object keys: ${Object.keys(urlResult).join(', ')}`);
                  }
                } else {
                  throw new Error(`Replicate .url() method returned invalid value: ${typeof urlResult}`);
                }
                console.log(`[REPLICATE] Got file-like output, extracted URL via .url() method: ${output}`);
              }
            } else if (typeof runOutput === 'string') {
              // Direct URL string
              output = runOutput;
              console.log(`[REPLICATE] Got direct URL string output: ${output}`);
            } else if (Array.isArray(runOutput)) {
              // Array of outputs (multiple videos or frames)
              // Check if first item has an ID
              if (runOutput.length > 0 && runOutput[0] && typeof runOutput[0] === 'object' && 'id' in runOutput[0]) {
                videoId = (runOutput[0] as any).id;
                videoObject = runOutput[0];
              }
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
          if (videoId) {
            console.log(`[REPLICATE] Video ID stored for extension: ${videoId}`);
          }
          
          // Success! Return the output with video ID/object for extension
          const totalDuration = Date.now() - startTime;
          console.log(`[REPLICATE] SUCCESS: Video generation completed in ${totalDuration}ms using model ${model.id} (${model.name}) on attempt ${attempt}`);
          if (gcsUri) {
            console.log(`[REPLICATE] Storing GCS URI for future reference: ${gcsUri}`);
          }
          return {
            output: output as string | string[],
            status: 'succeeded',
            videoId: videoId,
            videoObject: videoObject, // Store the video object for extension
            gcsUri: gcsUri, // Store GCS URI for Veo 3.1
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
        
        // Check if this is an input/validation error - don't retry, fail immediately
        const statusCode = error?.status || error?.statusCode || error?.response?.status;
        let errorMessage = error?.message || '';
        const isInputError = 
          statusCode === 400 || // Bad Request
          statusCode === 422 || // Unprocessable Entity
          errorMessage.includes('invalid') ||
          errorMessage.includes('validation') ||
          errorMessage.includes('bad request') ||
          errorMessage.includes('cannot be converted to a URL') ||
          errorMessage.includes('returned an object instead of a URL');
        
        if (isInputError) {
          console.error(`[REPLICATE] Input/validation error detected (status: ${statusCode}). Skipping retries to save time.`);
          throw error; // Fail immediately, don't retry
        }
        
        // Extract more detailed error information
        errorMessage = `Video generation failed with model ${model.id}`;
        
        // Helper function to extract text from HTML error responses
        const extractTextFromHtml = (html: string): string => {
          // Remove HTML tags and decode entities
          let text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          // Extract meaningful error text (e.g., "Server Error", "Please try again in 30 seconds")
          const match = text.match(/(?:Error|error):\s*([^\.]+)/i);
          if (match) {
            return match[1].trim();
          }
          return text.substring(0, 100); // Limit length
        };
        
        // Handle specific HTTP status codes first
        if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
          errorMessage = `Model ${model.id} is temporarily unavailable (${statusCode} Bad Gateway). The service may be experiencing high load. Please try again in a few moments.`;
        } else if (statusCode === 500) {
          errorMessage = `Model ${model.id} is experiencing temporary issues (500 Internal Server Error). Please try again.`;
        } else if (statusCode === 422) {
          errorMessage = `Model ${model.id} is not available or not accessible (422).`;
        } else if (statusCode === 429) {
          errorMessage = `Rate limit exceeded for model ${model.id}. Please wait a moment and try again.`;
        } else if (statusCode === 401 || statusCode === 403) {
          errorMessage = 'Authentication failed. Please check your REPLICATE_API_TOKEN in the backend .env file.';
        } else if (error.response?.data?.detail) {
          // Extract detail from JSON response
          const detail = typeof error.response.data.detail === 'string' 
            ? error.response.data.detail 
            : JSON.stringify(error.response.data.detail);
          errorMessage = `Model ${model.id}: ${detail}`;
        } else if (error.message) {
          // Check if error message contains HTML (502/503 responses often do)
          if (error.message.includes('<html>') || error.message.includes('<body>')) {
            const cleanMessage = extractTextFromHtml(error.message);
            if (statusCode) {
              errorMessage = `Model ${model.id} returned ${statusCode} error: ${cleanMessage}`;
            } else {
              errorMessage = `Model ${model.id}: ${cleanMessage}`;
            }
          } else if (error.message.includes('502') || error.message.includes('503') || error.message.includes('504')) {
            errorMessage = `Model ${model.id} is temporarily unavailable (Bad Gateway). The service may be experiencing high load. Please try again in a few moments.`;
          } else if (error.message.includes('500')) {
            errorMessage = `Model ${model.id} is experiencing temporary issues (500 Internal Server Error).`;
          } else if (error.message.includes('422')) {
            errorMessage = `Model ${model.id} is not available or not accessible (422).`;
          } else if (error.message.includes('429')) {
            errorMessage = `Rate limit exceeded for model ${model.id}.`;
          } else if (error.message.includes('401') || error.message.includes('403')) {
            errorMessage = 'Authentication failed. Please check your REPLICATE_API_TOKEN in the backend .env file.';
          } else {
            // Clean up the error message - remove URLs and HTML if present
            let cleanMsg = error.message;
            if (cleanMsg.includes('Request to')) {
              // Extract just the status code and error type
              const statusMatch = cleanMsg.match(/status (\d+)/);
              const errorTypeMatch = cleanMsg.match(/(\d+ [^:]+)/);
              if (statusMatch && errorTypeMatch) {
                cleanMsg = `${errorTypeMatch[1]}`;
              }
            }
            // Remove HTML if present
            if (cleanMsg.includes('<html>')) {
              cleanMsg = extractTextFromHtml(cleanMsg);
            }
            errorMessage = `${model.id}: ${cleanMsg}`;
          }
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
  const isImagen4Ultra = modelIdToUse === 'google/imagen-4-ultra' || modelIdToUse === 'google/imagen-4';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[REPLICATE] Attempt ${attempt}/${maxRetries} with model ${modelIdToUse}`);
      
      // For Imagen 4 Ultra, use full prompt (no truncation), for others use 1000 char limit
      const promptToUse = isImagen4Ultra ? prompt : prompt.substring(0, 1000);
      
      const modelInput: any = {
        prompt: promptToUse,
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
      
      // Add Imagen 4 Ultra specific parameters
      if (isImagen4Ultra) {
        modelInput.output_format = 'jpg';
        modelInput.safety_filter_level = 'block_only_high';
      }
      
      console.log(`[REPLICATE] Calling replicate.run("${modelIdToUse}", { input: ${JSON.stringify(modelInput)} })`);
      
      const runOutput = await replicate.run(modelIdToUse as any, { input: modelInput });
      
      console.log(`[REPLICATE] Raw output from Replicate:`, {
        type: typeof runOutput,
        isArray: Array.isArray(runOutput),
        isNull: runOutput === null,
        isUndefined: runOutput === undefined,
        hasUrl: runOutput && typeof runOutput === 'object' && 'url' in runOutput,
        hasUrlFunction: runOutput && typeof (runOutput as any)?.url === 'function',
        keys: runOutput && typeof runOutput === 'object' ? Object.keys(runOutput) : [],
        preview: typeof runOutput === 'string' 
          ? (runOutput as string).substring(0, 200)
          : Array.isArray(runOutput)
          ? `Array[${runOutput.length}]`
          : typeof runOutput === 'object'
          ? JSON.stringify(runOutput, null, 2).substring(0, 500)
          : String(runOutput).substring(0, 200),
      });
      
      let output: string | string[];
      
      // Handle different output formats (similar to video generation)
      if (runOutput === null || runOutput === undefined) {
        throw new Error('Replicate returned null or undefined output');
      } else if (runOutput && typeof (runOutput as any).url === 'function') {
        // File-like object with .url() method (most common for Replicate)
        const urlResult = await (runOutput as any).url();
        
        // Handle case where .url() returns an object (might be a File/Blob object)
        let url: string;
        if (typeof urlResult === 'string' && urlResult.trim() !== '') {
          url = urlResult.trim();
        } else if (urlResult && typeof urlResult === 'object') {
          // If .url() returns an object, it might have a url property or be a File object
          if ('url' in urlResult && typeof urlResult.url === 'string') {
            url = urlResult.url.trim();
          } else if (typeof (urlResult as any).toString === 'function') {
            // Try to convert to string
            const str = (urlResult as any).toString();
            if (typeof str === 'string' && str.trim() !== '' && (str.startsWith('http') || str.startsWith('blob:'))) {
              url = str.trim();
            } else {
              throw new Error(`Replicate .url() method returned an object that cannot be converted to a URL. Object keys: ${Object.keys(urlResult).join(', ')}`);
            }
          } else {
            // Log the object structure for debugging
            console.log(`[REPLICATE] .url() returned object:`, {
              keys: Object.keys(urlResult),
              constructor: urlResult.constructor?.name,
              preview: JSON.stringify(urlResult).substring(0, 200),
            });
            throw new Error(`Replicate .url() method returned an object instead of a URL string. Object keys: ${Object.keys(urlResult).join(', ')}`);
          }
        } else {
          throw new Error(`Replicate .url() method returned invalid value: ${typeof urlResult}`);
        }
        
        if (url && url.trim() !== '') {
          output = url;
        } else {
          throw new Error(`Replicate .url() method returned an empty or invalid URL`);
        }
      } else if (typeof runOutput === 'string') {
        // Direct URL string
        if ((runOutput as string).trim() === '') {
          throw new Error('Replicate returned an empty string');
        }
        output = runOutput;
      } else if (Array.isArray(runOutput)) {
        // Array of outputs
        if (runOutput.length === 0) {
          throw new Error('Replicate returned an empty array');
        }
        const urls: string[] = [];
        for (const item of runOutput) {
          if (typeof item === 'string' && item.trim() !== '') {
            urls.push(item.trim());
          } else if (item && typeof (item as any).url === 'function') {
            // File-like object in array
            const urlResult = await (item as any).url();
            let url: string | null = null;
            
            if (typeof urlResult === 'string' && urlResult.trim() !== '') {
              url = urlResult.trim();
            } else if (urlResult && typeof urlResult === 'object' && 'url' in urlResult && typeof urlResult.url === 'string') {
              url = urlResult.url.trim();
            }
            
            if (url && url.trim() !== '') {
              urls.push(url);
            }
          } else if (item && typeof item === 'object' && 'url' in item) {
            // Object with url property
            const url = (item as any).url;
            if (typeof url === 'string' && url.trim() !== '') {
              urls.push(url.trim());
            }
          }
        }
        if (urls.length === 0) {
          throw new Error('Replicate returned an array with no valid URLs');
        }
        output = urls.length === 1 ? urls[0] : urls;
      } else if (runOutput && typeof runOutput === 'object') {
        // Object output - check for various URL properties
        if ('url' in runOutput) {
          const url = (runOutput as any).url;
          if (typeof url === 'string' && url.trim() !== '') {
            output = url.trim();
          } else if (typeof url === 'function') {
            // url is a function
            const urlValue = await url();
            if (typeof urlValue === 'string' && urlValue.trim() !== '') {
              output = urlValue.trim();
            } else {
              throw new Error(`Replicate object.url() returned invalid value: ${typeof urlValue}`);
            }
          } else {
            throw new Error(`Replicate returned object with invalid url property: ${typeof url}`);
          }
        } else if ('output' in runOutput) {
          // Nested output property
          const nestedOutput = (runOutput as any).output;
          if (typeof nestedOutput === 'string' && nestedOutput.trim() !== '') {
            output = nestedOutput.trim();
          } else if (Array.isArray(nestedOutput) && nestedOutput.length > 0) {
            // Recursively handle nested array
            const urls: string[] = [];
            for (const item of nestedOutput) {
              if (typeof item === 'string' && item.trim() !== '') {
                urls.push(item.trim());
              } else if (item && typeof (item as any).url === 'function') {
                const url = await (item as any).url();
                if (typeof url === 'string' && url.trim() !== '') {
                  urls.push(url.trim());
                }
              }
            }
            if (urls.length === 0) {
              throw new Error('Replicate nested output array has no valid URLs');
            }
            output = urls.length === 1 ? urls[0] : urls;
          } else {
            throw new Error(`Replicate returned object with invalid nested output: ${typeof nestedOutput}`);
          }
        } else {
          // Try to convert object to string (might be a File/Blob-like object)
          // Check if it's a ReadableStream or similar
          if (typeof (runOutput as any).toString === 'function') {
            const str = (runOutput as any).toString();
            if (typeof str === 'string' && str.trim() !== '' && str.startsWith('http')) {
              output = str.trim();
            } else {
              throw new Error(`Replicate returned an object that cannot be converted to a URL. Object keys: ${Object.keys(runOutput).join(', ')}`);
            }
          } else {
            throw new Error(`Replicate returned an object that cannot be converted to a URL. Object keys: ${Object.keys(runOutput).join(', ')}`);
          }
        }
      } else {
        throw new Error(`Unexpected output format from Replicate: ${typeof runOutput}`);
      }
      
      // Final validation
      if (typeof output === 'string') {
        if (output.trim() === '') {
          throw new Error('Output is an empty string after processing');
        }
        output = output.trim();
      } else if (Array.isArray(output)) {
        if (output.length === 0) {
          throw new Error('Output is an empty array after processing');
        }
        output = output.filter(url => typeof url === 'string' && url.trim() !== '').map(url => url.trim());
        if (output.length === 0) {
          throw new Error('Output array has no valid URLs after filtering');
        }
      }
      
      console.log(`[REPLICATE] Image generation succeeded with model ${modelIdToUse}`, {
        outputType: typeof output,
        isArray: Array.isArray(output),
        outputLength: Array.isArray(output) ? output.length : 'N/A',
        outputPreview: typeof output === 'string' 
          ? output.substring(0, 100) + '...'
          : Array.isArray(output) && output.length > 0
          ? output[0].substring(0, 100) + '...'
          : 'N/A',
      });
      
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

/**
 * Generate music using Minimax Music 1.5
 */
export async function generateMusic(
  lyrics: string,
  prompt?: string,
  options?: {
    bitrate?: number;
    sample_rate?: number;
    audio_format?: string;
  }
): Promise<string> {
  if (!replicate) {
    throw new Error('Replicate client not initialized');
  }

  const model = 'minimax/music-1.5';
  
  // Validate input parameters according to model requirements
  // Lyrics: required string
  // Prompt: required string (style description)
  const validatedLyrics = lyrics.trim();
  const validatedPrompt = (prompt || 'Jazz, Smooth Jazz, Romantic, Dreamy').trim();

  if (!validatedLyrics || validatedLyrics.length === 0) {
    throw new Error(`Lyrics is required and cannot be empty`);
  }

  if (!validatedPrompt || validatedPrompt.length === 0) {
    throw new Error(`Prompt is required and cannot be empty`);
  }
  
  console.log(`[REPLICATE] Generating music with model ${model}`);
  console.log(`[REPLICATE] Lyrics length: ${validatedLyrics.length}`);
  console.log(`[REPLICATE] Prompt: ${validatedPrompt}`);
  console.log(`[REPLICATE] Options:`, options);

  try {
    // Build input according to model API - match exact format from example
    // Format: lyrics, prompt, bitrate, sample_rate, audio_format
    const input: any = {
      lyrics: validatedLyrics,
      prompt: validatedPrompt,
      bitrate: options?.bitrate || 256000,
      sample_rate: options?.sample_rate || 44100,
      audio_format: options?.audio_format || 'mp3',
    };

    console.log(`[REPLICATE] ========== MUSIC GENERATION PAYLOAD ==========`);
    console.log(`[REPLICATE] Model: ${model}`);
    console.log(`[REPLICATE] Complete input payload:`, JSON.stringify(input, null, 2));
    console.log(`[REPLICATE] Payload keys:`, Object.keys(input));
    console.log(`[REPLICATE] Payload values:`, {
      lyricsLength: input.lyrics.length,
      prompt: input.prompt,
      bitrate: input.bitrate,
      sample_rate: input.sample_rate,
      audio_format: input.audio_format
    });
    console.log(`[REPLICATE] ==============================================`);

    // Use replicate.run with proper error handling
    let output: any;
    try {
      output = await replicate.run(model, { input });
    } catch (runError: any) {
      console.error(`[REPLICATE] Error calling replicate.run:`, runError);
      // Check if it's a prediction error
      if (runError.message && runError.message.includes('prediction')) {
        throw new Error(`Replicate prediction failed: ${runError.message}`);
      }
      throw runError;
    }

    // Log detailed output information
    console.log(`[REPLICATE] Raw output from ${model}:`, output);
    console.log(`[REPLICATE] Output type:`, typeof output);
    console.log(`[REPLICATE] Is array:`, Array.isArray(output));
    console.log(`[REPLICATE] Is null:`, output === null);
    console.log(`[REPLICATE] Is undefined:`, output === undefined);
    
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      console.log(`[REPLICATE] Output constructor:`, output.constructor?.name);
      console.log(`[REPLICATE] Output has url property:`, 'url' in output);
      console.log(`[REPLICATE] Output has url() method:`, typeof (output as any).url === 'function');
      console.log(`[REPLICATE] Output has audio property:`, 'audio' in output);
      console.log(`[REPLICATE] Output has error property:`, 'error' in output);
      if ('error' in output) {
        console.error(`[REPLICATE] Model returned error:`, (output as any).error);
      }
    }

    // Handle different output formats
    // According to Replicate docs, minimax/music-1.5 returns a FileOutput object with .url() method
    let musicUrl: string | null = null;
    
    // Check if output is a string (direct URL)
    if (typeof output === 'string') {
      if (output.trim()) {
        musicUrl = output;
      }
    } 
    // Check if output is an array
    else if (Array.isArray(output) && output.length > 0) {
      const firstItem = output[0];
      if (typeof firstItem === 'string' && firstItem.trim()) {
        musicUrl = firstItem;
      } else if (firstItem && typeof firstItem === 'object') {
        // Try calling .url() method (FileOutput object)
        if (typeof (firstItem as any).url === 'function') {
          try {
            const urlResult = await (firstItem as any).url();
            if (typeof urlResult === 'string' && urlResult.trim()) {
              musicUrl = urlResult;
            }
          } catch (e) {
            console.warn(`[REPLICATE] Error calling url() method on array item:`, e);
          }
        } else if ('url' in firstItem && typeof firstItem.url === 'string') {
          musicUrl = firstItem.url;
        }
      }
    }
    // Check if output is an object (FileOutput)
    else if (output && typeof output === 'object' && output !== null) {
      // FIRST: Try calling .url() method (this is the standard FileOutput interface)
      // FileOutput objects may have non-enumerable properties, so Object.keys() might be empty
      // but the .url() method still works - so we must try this FIRST before checking if empty
      if (typeof (output as any).url === 'function') {
        try {
          console.log(`[REPLICATE] Calling .url() method on output object`);
          const urlResult = await (output as any).url();
          console.log(`[REPLICATE] .url() method returned:`, typeof urlResult, urlResult);
          
          if (typeof urlResult === 'string' && urlResult.trim()) {
            musicUrl = urlResult;
            console.log(`[REPLICATE] Got string URL from .url() method`);
          } else if (urlResult && typeof urlResult === 'object') {
            // .url() might return a URL object - extract href property (this is what we're seeing in the logs)
            // URL objects have href as a property that can be accessed directly
            if (urlResult.href) {
              // href might be a string or a getter, try to get it as string
              const hrefValue = String(urlResult.href);
              if (hrefValue && hrefValue.startsWith('http')) {
                musicUrl = hrefValue;
                console.log(`[REPLICATE] Extracted URL from href property: ${musicUrl.substring(0, 100)}...`);
              }
            }
            
            // If still no URL, try toString() method
            if (!musicUrl && urlResult.toString && typeof urlResult.toString === 'function') {
              try {
                const urlString = urlResult.toString();
                if (urlString && typeof urlString === 'string' && (urlString.startsWith('http://') || urlString.startsWith('https://'))) {
                  musicUrl = urlString;
                  console.log(`[REPLICATE] Extracted URL from toString(): ${musicUrl.substring(0, 100)}...`);
                }
              } catch (e) {
                console.warn(`[REPLICATE] Error calling toString():`, e);
              }
            }
            
            // Last resort: check for url property
            if (!musicUrl && 'url' in urlResult && typeof urlResult.url === 'string') {
              musicUrl = urlResult.url;
              console.log(`[REPLICATE] Extracted URL from url property: ${musicUrl.substring(0, 100)}...`);
            }
          }
        } catch (e) {
          console.error(`[REPLICATE] Error calling .url() method:`, e);
        }
      }

      // Only check if object is empty if we haven't gotten a URL yet
      // FileOutput objects may have non-enumerable properties, so Object.keys() might be empty
      // but the .url() method still works
      if (!musicUrl) {
        const keys = Object.keys(output);
        if (keys.length === 0 && typeof (output as any).url !== 'function') {
          console.error(`[REPLICATE] Output is an empty object with no .url() method: {}`);
          throw new Error(`Empty output object returned from ${model}. The model may have failed or returned no result.`);
        }
      }

      // If .url() didn't work, check for direct URL properties
      if (!musicUrl) {
        const urlKeys = ['url', 'audio', 'file', 'output', 'file_url', 'audio_url'];
        for (const key of urlKeys) {
          if (key in output) {
            const value = (output as any)[key];
            if (typeof value === 'string' && value.trim()) {
              musicUrl = value;
              break;
            }
          }
        }
      }

      // Check all string properties for URLs
      if (!musicUrl) {
        const keys = Object.keys(output);
        for (const key of keys) {
          const value = (output as any)[key];
          if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
            musicUrl = value;
            break;
          }
        }
      }
    }

    // Validate that musicUrl is actually a string
    if (!musicUrl || typeof musicUrl !== 'string' || !musicUrl.trim()) {
      console.error(`[REPLICATE] Failed to extract URL from output. Output structure:`, {
        type: typeof output,
        isArray: Array.isArray(output),
        keys: output && typeof output === 'object' ? Object.keys(output) : null,
        output: JSON.stringify(output, null, 2)
      });
      throw new Error(`Invalid music URL returned from ${model}. Output: ${JSON.stringify(output)}`);
    }

    // Validate URL format
    if (!musicUrl.startsWith('http://') && !musicUrl.startsWith('https://')) {
      console.warn(`[REPLICATE] Extracted URL doesn't start with http/https: ${musicUrl.substring(0, 100)}`);
    }

    console.log(`[REPLICATE] Music generated successfully: ${musicUrl.substring(0, 100)}...`);
    return musicUrl;
  } catch (error: any) {
    console.error(`[REPLICATE] Failed to generate music with ${model}:`, error);
    throw new Error(`Music generation failed: ${error.message || 'Unknown error'}`);
  }
}

