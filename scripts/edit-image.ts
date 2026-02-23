/**
 * Serves as an entry point to test individual edits to an image.
 *
 * Usage:
 *   npm run edit-image -- --image-path "path/to/image.jpg"
 *   npm run edit-image -- --image-path "path/to/image.jpg" --overlay-only   # just draw red crop box, save for spot-check
 *
 * Vision provider: set VISION_PROVIDER=openai or gemini (optional); uses OPENAI_API_KEY or GOOGLE_API_KEY.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { resizeImage, saveProcessedImage, drawCenterCropOverlay } from '../lib/edit-image';
import { createVisionClient } from '../lib/vision-client';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png'];

function parseImagePath(): string | undefined {
  const argIndex = process.argv.findIndex((arg) => arg === '--image-path' || arg.startsWith('--image-path='));
  if (argIndex === -1) return undefined;
  const arg = process.argv[argIndex];
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=').trim();
  }
  return process.argv[argIndex + 1];
}

async function main() {
  let imagePath = parseImagePath();
  if (!imagePath) {
    console.error('Missing --image-path argument.');
    process.exit(1);
  }

  if (!SUPPORTED_IMAGE_FORMATS.includes(path.extname(imagePath).slice(1).toLowerCase())) {
    console.error(`Unsupported image format: ${path.extname(imagePath)}`);
    process.exit(1);
  }

  if (imagePath.startsWith('~')) {
    imagePath = path.join(os.homedir(), imagePath.slice(1));
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const overlayOnly = process.argv.includes('--overlay-only');

  if (overlayOnly) {
    const metadata = await sharp(imageBuffer).metadata();
    const w = metadata.width ?? 0;
    const h = metadata.height ?? 0;
    if (w === 0 || h === 0) {
      console.error('Could not read image dimensions.');
      process.exit(1);
    }
    const overlayBuffer = await drawCenterCropOverlay(imageBuffer, w, h);
    const outDir = path.join(process.cwd(), 'data', 'image-experiments');
    const base = path.basename(imagePath, path.extname(imagePath));
    const outPath = path.join(outDir, `[overlay] ${base}.png`);
    saveProcessedImage(overlayBuffer, outPath);
    console.log('Overlay saved (red square = proposed center crop):', outPath);
    return;
  }

  const visionClient = createVisionClient();
  let resizedBuffer: Buffer;
  try {
    resizedBuffer = await resizeImage(imageBuffer, 1500, 1500, visionClient);
  } catch (error) {
    console.error('Error resizing image:', error);
    return;
  }

  const outDir = path.join(process.cwd(), 'data', 'image-experiments');
  const fileName = path.basename(imagePath);
  const outPath = path.join(outDir, `[resized] ${fileName}`);
  saveProcessedImage(resizedBuffer, outPath);
  console.log('Wrote', outPath);
}

main();
