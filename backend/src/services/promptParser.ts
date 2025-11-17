export interface ParsedPrompt {
  mood?: string;
  style?: string;
  duration: number;
  constraints?: string;
  keywords: string[];
}

/**
 * Basic prompt parser - extracts mood, style, duration, and constraints
 */
export function parsePrompt(prompt: string, duration: number): ParsedPrompt {
  const lowerPrompt = prompt.toLowerCase();
  
  // Extract mood keywords
  const moodKeywords = ['energetic', 'calm', 'mysterious', 'joyful', 'dramatic', 'peaceful', 'intense', 'relaxed'];
  const mood = moodKeywords.find(keyword => lowerPrompt.includes(keyword));

  // Extract style keywords
  const styleKeywords = ['cinematic', 'animated', 'realistic', 'abstract', 'minimalist', 'vibrant', 'dark', 'bright'];
  const style = styleKeywords.find(keyword => lowerPrompt.includes(keyword));

  // Extract constraints (look for phrases like "no X", "avoid Y", "must include Z")
  const constraintPatterns = [
    /(?:no|avoid|don't|do not)\s+([^.,!?]+)/gi,
    /(?:must|should|include|have)\s+([^.,!?]+)/gi,
  ];
  const constraints: string[] = [];
  constraintPatterns.forEach(pattern => {
    const matches = prompt.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        constraints.push(match[1].trim());
      }
    }
  });

  // Extract keywords (remove common words)
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were']);
  const words = prompt.toLowerCase().split(/\s+/).filter(word => 
    word.length > 3 && !commonWords.has(word)
  );
  const keywords = [...new Set(words)].slice(0, 10); // Top 10 unique keywords

  return {
    mood,
    style,
    duration,
    constraints: constraints.length > 0 ? constraints.join('; ') : undefined,
    keywords,
  };
}

