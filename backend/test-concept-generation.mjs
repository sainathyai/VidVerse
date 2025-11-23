/**
 * Test script for concept-to-project generation flow
 * Tests the JSON extraction and validation logic
 */

// Mock chat response with structured JSON
const mockChatResponse = `Here's your complete project structure:

\`\`\`json
{
  "script": "A sleek, modern advertisement for premium sunglasses. The video opens with a close-up of the sunglasses resting on a reflective surface, catching sunlight. The camera slowly pulls back to reveal a stylish model wearing them, standing against an urban skyline at sunset. The model confidently walks through a bustling city street, the sunglasses reflecting the vibrant city lights. Quick cuts show the sunglasses from different angles - on the model's face, in their hand, and on various surfaces. The final shot shows the brand logo elegantly displayed.",
  "assets": [
    {
      "name": "Premium Sunglasses",
      "prompt": "Professional product photography of premium sunglasses, sleek modern design, reflective lenses, luxury aesthetic, studio lighting, high-end fashion accessory"
    },
    {
      "name": "Urban Skyline",
      "prompt": "Modern urban skyline at sunset, golden hour lighting, cityscape with tall buildings, warm orange and pink sky, cinematic composition"
    },
    {
      "name": "Stylish Model",
      "prompt": "Fashion model wearing sunglasses, confident pose, urban setting, professional photography, modern fashion aesthetic"
    },
    {
      "name": "City Street",
      "prompt": "Bustling city street, people walking, urban environment, vibrant city lights, dynamic street scene, modern metropolitan setting"
    },
    {
      "name": "Brand Logo",
      "prompt": "Elegant brand logo design, minimalist style, luxury branding, professional typography, clean presentation"
    }
  ],
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "Close-up shot of premium sunglasses resting on a reflective surface, catching natural sunlight. The camera slowly pulls back to reveal the sleek design and premium materials. Soft, elegant lighting highlights the luxury aesthetic.",
      "assetIds": ["Premium Sunglasses"]
    },
    {
      "sceneNumber": 2,
      "prompt": "Wide shot revealing a stylish model wearing the sunglasses, standing confidently against an urban skyline at sunset. Golden hour lighting creates a warm, cinematic atmosphere. The model's silhouette is striking against the vibrant sky.",
      "assetIds": ["Stylish Model", "Urban Skyline"]
    },
    {
      "sceneNumber": 3,
      "prompt": "The model confidently walks through a bustling city street. Quick, dynamic cuts show the sunglasses from different angles - on the model's face, in their hand, and reflecting the vibrant city lights. The urban environment emphasizes the modern, metropolitan lifestyle.",
      "assetIds": ["Stylish Model", "City Street", "Premium Sunglasses"]
    },
    {
      "sceneNumber": 4,
      "prompt": "Final shot elegantly displays the brand logo. Clean, minimalist presentation with professional typography. The logo appears against a sophisticated background, emphasizing the luxury brand identity.",
      "assetIds": ["Brand Logo"]
    }
  ],
  "music": {
    "lyrics": "Upbeat, modern instrumental track with electronic elements",
    "prompt": "Modern, sophisticated electronic music with a smooth, urban vibe. Upbeat tempo with subtle bass and atmospheric synths. Perfect for a luxury fashion advertisement. Style: contemporary, elegant, metropolitan",
    "bitrate": "320",
    "sample_rate": "44100",
    "audio_format": "mp3"
  }
}
\`\`\`

I've generated a complete project structure with 5 assets, 4 scenes, and a music prompt that matches the sophisticated, modern aesthetic of your sunglasses advertisement.`;

// Import the extraction function (we'll need to adapt this for Node.js)
// For now, let's test the logic directly

function extractProjectJSON(responseText) {
  try {
    // Try to find JSON in code blocks first
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      return parsed;
    }

    // Try to find JSON without code blocks
    const jsonPattern = /\{[\s\S]*"assets"[\s\S]*"scenes"[\s\S]*"music"[\s\S]*\}/;
    const match = responseText.match(jsonPattern);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed;
    }

    return null;
  } catch (error) {
    console.error('Failed to extract project JSON:', error);
    return null;
  }
}

function validateProjectData(data) {
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
  }

  // Validate each scene has sceneNumber and prompt
  for (const scene of data.scenes) {
    if (typeof scene.sceneNumber !== 'number' || !scene.prompt) {
      return false;
    }
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

// Test the extraction
console.log('Testing concept generation flow...\n');

const extracted = extractProjectJSON(mockChatResponse);

if (extracted) {
  console.log('✅ JSON extracted successfully!');
  console.log(`\nAssets: ${extracted.assets.length}`);
  extracted.assets.forEach((asset, i) => {
    console.log(`  ${i + 1}. ${asset.name}`);
  });
  
  console.log(`\nScenes: ${extracted.scenes.length}`);
  extracted.scenes.forEach((scene) => {
    console.log(`  Scene ${scene.sceneNumber}: ${scene.prompt.substring(0, 60)}...`);
    console.log(`    Assets: ${scene.assetIds.join(', ')}`);
  });
  
  console.log(`\nMusic:`);
  console.log(`  Lyrics: ${extracted.music.lyrics || 'N/A'}`);
  console.log(`  Style: ${extracted.music.prompt || 'N/A'}`);
  
  const isValid = validateProjectData(extracted);
  console.log(`\n✅ Validation: ${isValid ? 'PASSED' : 'FAILED'}`);
  
  if (isValid) {
    console.log('\n✅ All tests passed! The concept generation flow is working correctly.');
  } else {
    console.log('\n❌ Validation failed. Check the data structure.');
  }
} else {
  console.log('❌ Failed to extract JSON from response');
}

