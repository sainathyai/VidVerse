const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Resolve paths relative to the project root
const projectRoot = path.resolve(__dirname, '../..');
const inputPath = path.join(projectRoot, 'frontend/public/logo.png');
const outputPath = path.join(projectRoot, 'frontend/public/logo_transparent.png');
const finalPath = path.join(projectRoot, 'frontend/public/logo.png');

async function removeBackground() {
  try {
    // Read the image and get its metadata
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    // Get raw pixel data
    const { data, info } = await image
      .ensureAlpha() // Ensure alpha channel exists
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Process each pixel to remove white/light backgrounds
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Remove white pixels (RGB values close to 255)
      // Also remove light gray pixels (checkered pattern)
      // Threshold: if all RGB values are > 240, make transparent
      if (r > 240 && g > 240 && b > 240) {
        data[i + 3] = 0; // Set alpha to 0 (fully transparent)
      }
      // Also handle gray checkered pattern (equal RGB values > 200)
      else if (r === g && g === b && r > 200) {
        data[i + 3] = 0; // Set alpha to 0 (fully transparent)
      }
    }
    
    // Save the processed image to a temporary file first
    await sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4
      }
    })
    .png()
    .toFile(outputPath);
    
    // Replace the original file
    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
    }
    fs.renameSync(outputPath, finalPath);
    
    console.log('✅ Logo background removed successfully!');
    console.log(`   Processed ${info.width}x${info.height} image`);
  } catch (error) {
    console.error('❌ Error processing image:', error);
    process.exit(1);
  }
}

removeBackground();

