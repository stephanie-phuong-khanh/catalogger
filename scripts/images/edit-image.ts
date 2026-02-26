/**
 * Serves as an entry point to test individual edits to an image.
 *
 * Usage:
 *   npm run edit-image -- --image-path "path/to/image.jpg" --out-dir "path/to/output/directory"
 *   npm run edit-image -- --image-path "path/to/image.jpg" --out-dir "path/to/output/directory" --overlay-only   # draw red center-crop box, save for spot-check
 *
 * Vision provider: set VISION_PROVIDER=openai or gemini (optional); uses OPENAI_API_KEY or GOOGLE_API_KEY.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import {
  processImage,
  saveProcessedImage,
  drawCenterCropOverlay,
} from '../../lib/images/edit-image';
import { createVisionClient } from '../../lib/images/vision-client';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const DEFAULT_OUT_DIR = path.join(process.cwd(), 'data', 'image-experiments');

function parseImagePath(): string | undefined {
  const argIndex = process.argv.findIndex((arg) => arg === '--image-path' || arg.startsWith('--image-path='));
  if (argIndex === -1) return undefined;
  const arg = process.argv[argIndex];
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=').trim();
  }
  return process.argv[argIndex + 1];
}

function parseOutDir(): string {
  const argIndex = process.argv.findIndex((arg) => arg === '--out-dir' || arg.startsWith('--out-dir='));
  if (argIndex === -1) return DEFAULT_OUT_DIR;
  const arg = process.argv[argIndex];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=').trim();
  return process.argv[argIndex + 1] ?? DEFAULT_OUT_DIR;
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

  if (!fs.existsSync(imagePath)) {
    console.error('File not found:', imagePath);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const overlayOnly = process.argv.includes('--overlay-only');
  const outDir = parseOutDir();
  const ext = path.extname(imagePath).toLowerCase();
  const baseName = path.basename(imagePath, ext);
  const outputFileName = ext === '.webp' ? baseName + '.jpg' : path.basename(imagePath);
  const outPathBase = path.join(outDir, outputFileName);

  if (overlayOnly) {
    const overlayBuffer = await drawCenterCropOverlay(imageBuffer);
    saveProcessedImage(overlayBuffer, outPathBase);
    console.log('Wrote overlay (red center-crop box):', outPathBase);
    return;
  }

  const visionClient = createVisionClient();
  try {
    const resizedBuffer = await processImage(imageBuffer, 1500, 1500, visionClient);
    saveProcessedImage(resizedBuffer, outPathBase);
    console.log('Wrote', outPathBase);
  } catch (error) {
    console.error('Error processing image:', error);
    process.exit(1);
  }
}

main();
