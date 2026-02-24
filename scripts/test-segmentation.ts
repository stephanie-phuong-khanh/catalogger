/**
 * Test segmentation: run rembg, get outline, save polygon overlay and mask overlay for inspection.
 *
 * Setup (one-time) – use Docker:
 *   1. Install Docker Desktop and start it.
 *   2. docker pull danielgatis/rembg
 *
 * Usage:
 *   npm run test-segmentation -- --image-path "path/to/image.png"
 *   npm run test-segmentation -- --image-path "path/to/image.jpg" --out-dir "data/my-seg"
 *   npm run test-segmentation -- --image-path "path/to/image.png" --out-dir "data/my-seg" --invert-mask
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { findSegmentationWithMask, drawSegmentationOverlay, drawMaskOverlay } from '../lib/segmentation';
import { saveProcessedImage } from '../lib/edit-image';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png'];
const DEFAULT_OUT_DIR = path.join(process.cwd(), 'data', 'segmentation-tests');

function parseImagePath(): string | undefined {
  const argIndex = process.argv.findIndex((arg) => arg === '--image-path' || arg.startsWith('--image-path='));
  if (argIndex === -1) return undefined;
  const arg = process.argv[argIndex];
  if (arg.includes('=')) return arg.split('=').slice(1).join('=').trim();
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

  let invertMask = false;
  const invertMaskIndex = process.argv.findIndex((arg) => arg === '--invert-mask' || arg.startsWith('--invert-mask='));
  if (invertMaskIndex !== -1) {
    invertMask = true;
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
  const metadata = await sharp(imageBuffer).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  if (w === 0 || h === 0) {
    console.error('Could not read image dimensions.');
    process.exit(1);
  }

  console.log('Running segmentation (rembg)...');
  const { segmentation, mask } = await findSegmentationWithMask(imageBuffer);

  if (segmentation.polygons.length === 0) {
    console.log('No polygons (rembg failed or no contour). Save original with no overlay.');
  } else {
    console.log(
      `Got ${segmentation.polygons.length} polygon(s), ${segmentation.polygons.flat().length} total points.`,
    );
  }
  if (mask) {
    const d = mask.data;
    let min = 1, max = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    console.log(`Mask ${mask.width}x${mask.height}, values in [${min.toFixed(3)}, ${max.toFixed(3)}]`);
  }

  const outDir = parseOutDir();
  const base = path.basename(imagePath, path.extname(imagePath));

  const overlayBuffer = await drawSegmentationOverlay(imageBuffer, segmentation);
  saveProcessedImage(overlayBuffer, path.join(outDir, `[segmentation] ${base}.png`));
  console.log('Saved polygon overlay:', path.join(outDir, `[segmentation] ${base}.png`));

  if (mask) {
    const maskOverlayBuffer = await drawMaskOverlay(
      imageBuffer,
      mask.data,
      mask.width,
      mask.height,
    );
    saveProcessedImage(maskOverlayBuffer, path.join(outDir, `[mask] ${base}.png`));
    console.log('Saved mask overlay:', path.join(outDir, `[mask] ${base}.png`));
  }
}

main();
