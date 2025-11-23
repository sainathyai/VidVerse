/**
 * Helper functions for importing structured project data from AI chat responses
 */

export interface ProjectAsset {
  name: string;
  prompt: string;
}

export interface ProjectScene {
  sceneNumber: number;
  prompt: string;
  assetIds: string[]; // Array of asset names that match ProjectAsset names
}

export interface ProjectMusic {
  lyrics?: string;
  prompt?: string;
  bitrate?: string;
  sample_rate?: string;
  audio_format?: string;
}

export interface ProjectData {
  script?: string;
  assets: ProjectAsset[];
  scenes: ProjectScene[];
  music: ProjectMusic;
}

/**
 * Extract structured project JSON from chat response text
 * Looks for JSON code blocks and parses them
 */
export function extractProjectJSON(responseText: string): ProjectData | null {
  try {
    // Try to find JSON in code blocks first
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (validateProjectData(parsed)) {
        return parsed as ProjectData;
      }
    }

    // Try to find JSON without code blocks (might be wrapped in other markdown)
    const jsonPattern = /\{[\s\S]*"assets"[\s\S]*"scenes"[\s\S]*"music"[\s\S]*\}/;
    const match = responseText.match(jsonPattern);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (validateProjectData(parsed)) {
        return parsed as ProjectData;
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to extract project JSON:', error);
    return null;
  }
}

/**
 * Validate that project data has the correct structure
 */
export function validateProjectData(data: any): data is ProjectData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  // Check assets array
  if (!Array.isArray(data.assets) || data.assets.length === 0) {
    return false;
  }

  // Validate asset count (3-5, max 5)
  if (data.assets.length < 3 || data.assets.length > 5) {
    console.warn(`Asset count ${data.assets.length} is outside valid range (3-5)`);
    // Still allow it, but warn
  }

  // Validate each asset has name and prompt
  for (const asset of data.assets) {
    if (!asset.name || !asset.prompt) {
      return false;
    }
  }

  // Check scenes array
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    return false;
  }

  // Validate scene count (3-8)
  if (data.scenes.length < 3 || data.scenes.length > 8) {
    console.warn(`Scene count ${data.scenes.length} is outside valid range (3-8)`);
    // Still allow it, but warn
  }

  // Validate each scene has sceneNumber and prompt
  for (const scene of data.scenes) {
    if (typeof scene.sceneNumber !== 'number' || !scene.prompt) {
      return false;
    }
    // assetIds should be an array (can be empty)
    if (!Array.isArray(scene.assetIds)) {
      return false;
    }
  }

  // Check music object
  if (!data.music || typeof data.music !== 'object') {
    return false;
  }

  // Music should have at least prompt or lyrics
  if (!data.music.prompt && !data.music.lyrics) {
    return false;
  }

  return true;
}

/**
 * Calculate recommended scene count based on video duration
 * - Short duration (≤30s): 3 scenes
 * - Medium duration (31-60s): 5 scenes
 * - Long duration (>60s): 8 scenes
 */
export function calculateSceneCount(duration: number): number {
  if (duration <= 30) {
    return 3;
  } else if (duration <= 60) {
    return 5;
  } else {
    return 8;
  }
}

/**
 * Normalize project data to ensure it matches UI requirements
 * - Limit assets to 5 maximum
 * - Ensure scene numbers are sequential starting from 1
 * - Map asset names to consistent IDs
 */
export function normalizeProjectData(data: ProjectData): ProjectData {
  // Limit assets to 5
  const normalizedAssets = data.assets.slice(0, 5);

  // Create asset name to index mapping
  const assetNameToIndex = new Map<string, number>();
  normalizedAssets.forEach((asset, index) => {
    assetNameToIndex.set(asset.name, index);
  });

  // Normalize scenes - ensure sequential scene numbers and map asset names to indices
  const normalizedScenes = data.scenes
    .sort((a, b) => a.sceneNumber - b.sceneNumber) // Sort by scene number
    .map((scene, index) => ({
      ...scene,
      sceneNumber: index + 1, // Ensure sequential numbering starting from 1
      assetIds: scene.assetIds
        .map(assetName => {
          // Map asset name to index if it exists
          const assetIndex = assetNameToIndex.get(assetName);
          return assetIndex !== undefined ? assetIndex.toString() : null;
        })
        .filter((id): id is string => id !== null), // Remove null values
    }));

  return {
    ...data,
    assets: normalizedAssets,
    scenes: normalizedScenes,
  };
}

