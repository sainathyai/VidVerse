import { ParsedPrompt } from './promptParser';

export interface Scene {
  sceneNumber: number;
  prompt: string;
  duration: number;
  startTime: number;
  endTime: number;
}

/**
 * Intelligent scene planner - determines optimal number of scenes based on duration and content
 */
export function planScenes(
  overallPrompt: string,
  parsedPrompt: ParsedPrompt,
  totalDuration: number
): Scene[] {
  // Determine number of scenes based on duration and content complexity
  let numScenes: number;
  const promptLength = overallPrompt.length;
  const isComplex = promptLength > 200 || (parsedPrompt.keywords && parsedPrompt.keywords.length > 5);
  
  if (totalDuration <= 5) {
    // Maximum 2 scenes for 5 sec video
    numScenes = isComplex ? 2 : 1;
  } else if (totalDuration <= 15) {
    // Maximum 3 scenes for 15 seconds
    numScenes = isComplex ? 3 : 2;
  } else if (totalDuration <= 30) {
    // Maximum 5 scenes for 30 secs
    numScenes = isComplex ? 5 : 3;
  } else {
    // 5-8 scenes for 60 sec video depending on concept and script length
    if (totalDuration <= 60) {
      numScenes = isComplex ? Math.min(8, Math.max(5, Math.floor(promptLength / 100))) : 5;
    } else {
      // For longer videos, scale up proportionally
      numScenes = Math.min(10, Math.max(5, Math.floor(totalDuration / 10)));
    }
  }

  const sceneDuration = totalDuration / numScenes;
  const scenes: Scene[] = [];

  for (let i = 0; i < numScenes; i++) {
    const startTime = i * sceneDuration;
    const endTime = (i + 1) * sceneDuration;
    
    // Generate scene-specific prompt
    const scenePrompt = generateScenePrompt(
      overallPrompt,
      parsedPrompt,
      i + 1,
      numScenes,
      startTime,
      endTime
    );

    scenes.push({
      sceneNumber: i + 1,
      prompt: scenePrompt,
      duration: sceneDuration,
      startTime,
      endTime,
    });
  }

  return scenes;
}

/**
 * Generate a scene-specific prompt based on overall prompt and scene position
 * Intelligently splits the prompt into unique sequential scenes
 */
function generateScenePrompt(
  overallPrompt: string,
  parsedPrompt: ParsedPrompt,
  sceneNumber: number,
  totalScenes: number,
  startTime: number,
  endTime: number
): string {
  const position = sceneNumber / totalScenes;
  
  // Split prompt into sentences or key phrases
  // Look for sentence boundaries, newlines, or numbered items
  let promptParts: string[] = [];
  
  // Try splitting by newlines first (common in structured prompts)
  if (overallPrompt.includes('\n')) {
    promptParts = overallPrompt.split('\n').map(p => p.trim()).filter(p => p.length > 0);
  } else {
    // Split by sentences (period, exclamation, question mark followed by space)
    promptParts = overallPrompt.split(/[.!?]\s+/).map(p => p.trim()).filter(p => p.length > 0);
  }
  
  // If we have fewer parts than scenes, try splitting by commas for longer phrases
  if (promptParts.length < totalScenes && overallPrompt.includes(',')) {
    const commaParts = overallPrompt.split(',').map(p => p.trim()).filter(p => p.length > 10);
    if (commaParts.length >= totalScenes) {
      promptParts = commaParts;
    }
  }
  
  // If still not enough parts, split by keywords or evenly
  if (promptParts.length < totalScenes) {
    // Try to split by keywords from parsed prompt
    if (parsedPrompt.keywords && parsedPrompt.keywords.length > 0) {
      // Use keywords to find natural break points
      const words = overallPrompt.split(/\s+/);
      const chunkSize = Math.ceil(words.length / totalScenes);
      promptParts = [];
      for (let i = 0; i < totalScenes; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, words.length);
        promptParts.push(words.slice(start, end).join(' '));
      }
    } else {
      // Last resort: split evenly by character count
      const chunkSize = Math.ceil(overallPrompt.length / totalScenes);
      promptParts = [];
      for (let i = 0; i < totalScenes; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, overallPrompt.length);
        promptParts.push(overallPrompt.substring(start, end).trim());
      }
    }
  }
  
  // Select the appropriate part(s) for this scene
  let sceneContent = '';
  if (promptParts.length >= totalScenes) {
    // Use one part per scene
    sceneContent = promptParts[sceneNumber - 1];
  } else {
    // Distribute parts across scenes
    const partsPerScene = Math.ceil(promptParts.length / totalScenes);
    const startPart = Math.min((sceneNumber - 1) * partsPerScene, promptParts.length - 1);
    const endPart = Math.min(startPart + partsPerScene, promptParts.length);
    sceneContent = promptParts.slice(startPart, endPart).join('. ');
  }
  
  // Add scene position context with continuity references
  let sceneContext = '';
  if (position <= 0.2) {
    sceneContext = 'Opening scene, establishing shot: ';
  } else if (position >= 0.8) {
    sceneContext = 'Closing scene, finale: ';
  } else if (position >= 0.4 && position <= 0.6) {
    sceneContext = 'Middle scene, main action: ';
  } else {
    // For transition scenes, add continuity context
    if (sceneNumber > 1) {
      sceneContext = `Transition scene (continuing from previous scene, maintaining visual consistency): `;
    } else {
      sceneContext = 'Transition scene: ';
    }
  }

  // Add style and mood if available
  const styleMood = [
    parsedPrompt.style && `in ${parsedPrompt.style} style`,
    parsedPrompt.mood && `with ${parsedPrompt.mood} mood`,
  ].filter(Boolean).join(', ');

  // Build scene prompt with unique content
  let scenePrompt = sceneContext + sceneContent;
  
  // Add continuity instructions for scenes after the first
  if (sceneNumber > 1) {
    scenePrompt += `. Maintain visual continuity with previous scenes, same style and aesthetic.`;
  }
  
  if (styleMood) {
    scenePrompt += `. ${styleMood}`;
  }

  // Add timing context
  scenePrompt += ` (${Math.round(startTime)}s - ${Math.round(endTime)}s)`;

  return scenePrompt;
}

