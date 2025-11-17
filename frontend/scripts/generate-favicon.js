import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '..', 'public');
const logoSvg = join(publicDir, 'logo.svg');
const faviconPath = join(publicDir, 'favicon.ico');

async function generateFavicon() {
  try {
    console.log('Generating larger favicon from logo.svg...');
    
    // Read the SVG
    const svgBuffer = await sharp(logoSvg).toBuffer();
    
    // Generate multiple sizes for the ICO file
    // Standard favicon sizes: 16x16, 32x32, 48x48, 64x64
    // We'll create larger sizes: 32x32, 48x48, 64x64, 128x128 for better visibility
    const sizes = [32, 48, 64, 128];
    
    // Create PNG buffers for each size
    const pngBuffers = await Promise.all(
      sizes.map(size => 
        sharp(svgBuffer)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 }
          })
          .png()
          .toBuffer()
      )
    );
    
    // For ICO format, we'll use the largest size (128x128) as the main favicon
    // Most modern browsers support PNG favicons, so we can also create a PNG version
    const largestPng = pngBuffers[pngBuffers.length - 1];
    
    // Save as ICO (using the 64x64 size as it's a good balance)
    // Note: sharp doesn't directly support ICO format, so we'll save as PNG
    // and update the HTML to use PNG instead, or we can use a library
    // For now, let's create a larger PNG favicon and update the reference
    
    // Save 256x256 as favicon.ico (actually PNG format, but browsers accept it)
    // Larger size provides better quality when browser scales it for the tab
    await sharp(svgBuffer)
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(faviconPath);
    
    console.log(`✓ Generated favicon.ico (256x256) at ${faviconPath}`);
    
    // Also create a 128x128 version as favicon-128.png for high-DPI displays
    const favicon128Path = join(publicDir, 'favicon-128.png');
    await sharp(svgBuffer)
      .resize(128, 128, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(favicon128Path);
    
    console.log(`✓ Generated favicon-128.png (128x128) at ${favicon128Path}`);
    console.log('Done!');
    
  } catch (error) {
    console.error('Error generating favicon:', error);
    process.exit(1);
  }
}

generateFavicon();

