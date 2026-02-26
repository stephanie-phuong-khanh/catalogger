/**
 * Entry point to iterate through the cropping of an image with spacial awareness of the subject via segmentation.
 * 
 * Usage:
 *   npm run crop-with-segmentation -- --image-path "path/to/image.png" --out-dir "path/to/output/dir"
 */


import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { findSegmentationWithMask, drawSegmentationOverlay } from '../../lib/images/segmentation';
import { saveProcessedImage } from '../../lib/images/edit-image';

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

function getBoundingBox(
  polygon: Array<{ x: number; y: number }>,
): { left: number; top: number; right: number; bottom: number } {
  const left = Math.min(...polygon.map((p) => p.x));
  const top = Math.min(...polygon.map((p) => p.y));
  const right = Math.max(...polygon.map((p) => p.x));
  const bottom = Math.max(...polygon.map((p) => p.y));
  return { left, top, right, bottom };
}

/** Draw only the blue bbox rect on a transparent layer (for compositing on top of another image). */
function drawBoundingBoxOverlay(
  imageWidth: number,
  imageHeight: number,
  boundingBox: { left: number; top: number; right: number; bottom: number },
): Promise<Buffer> {
  const w = boundingBox.right - boundingBox.left;
  const h = boundingBox.bottom - boundingBox.top;
  const svg = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${boundingBox.left}" y="${boundingBox.top}" width="${w}" height="${h}" fill="none" stroke="blue" stroke-width="2"/>
  </svg>`,
  );
  return sharp(svg).png().toBuffer();
}

/**
 * Propose a square crop: side = min(imageWidth, imageHeight), centered on the bounding box center, clamped to image.
 */
function proposeSquareCropCenteredOnBbox(
  imageWidth: number,
  imageHeight: number,
  boundingBox: { left: number; top: number; right: number; bottom: number },
): { left: number; top: number; size: number } {
  const size = Math.min(imageWidth, imageHeight);
  const bboxCenterX = (boundingBox.left + boundingBox.right) / 2;
  const bboxCenterY = (boundingBox.top + boundingBox.bottom) / 2;
  let left = Math.round(bboxCenterX - size / 2);
  let top = Math.round(bboxCenterY - size / 2);
  left = Math.max(0, Math.min(imageWidth - size, left));
  top = Math.max(0, Math.min(imageHeight - size, top));
  return { left, top, size };
}

/** Draw the proposed square crop (green rect) on a transparent layer. */
function drawCropOverlay(
  imageWidth: number,
  imageHeight: number,
  crop: { left: number; top: number; size: number },
  strokeWidthPx: number = 4,
): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${crop.left}" y="${crop.top}" width="${crop.size}" height="${crop.size}" fill="none" stroke="green" stroke-width="${strokeWidthPx}"/>
  </svg>`,
  );
  return sharp(svg).png().toBuffer();
}

/** Apply overlay(s) to an image. */
async function applyOverlays(
  imageBuffer: Buffer,
  overlays: Array<Buffer>,
  ext: string,
): Promise<Buffer> {
  let pipeline = sharp(imageBuffer);
  for (const overlay of overlays) {
    pipeline = pipeline.composite([{ input: overlay, top: 0, left: 0 }]);
  }
  const finalBuffer =
    ext === '.jpg' || ext === '.jpeg'
      ? await pipeline.jpeg({ quality: 90 }).toBuffer()
      : await pipeline.png().toBuffer();
  return finalBuffer;
}

/**
 * MAIN
 */
async function main() {
  let imagePath = parseImagePath();
  if (!imagePath) {
    console.error('Missing --image-path argument.');
    process.exit(1);
  }

  const outDir = parseOutDir();
  const base = path.basename(imagePath, path.extname(imagePath));

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
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (imageWidth === 0 || imageHeight === 0) {
    console.error('Could not read image dimensions.');
    process.exit(1);
  }

  console.log('Running segmentation (rembg)...');
  const { segmentation } = await findSegmentationWithMask(imageBuffer);

  if (segmentation.polygons.length === 0) {
    console.log('No polygons (rembg failed or no contour). Unable to proceed.');
    process.exit(1);
  } else if (segmentation.polygons.length > 1) {
    console.warn('Identified multiple polygons (rembg returned multiple contours). Unable to handle this case yet.');
    process.exit(1);
  } else {
    console.log(`Identified 1 polygon, ${segmentation.polygons.flat().length} total points.`);
  }

  const polygon = segmentation.polygons[0]

  const boundingBox = getBoundingBox(polygon);
  console.log(
    `Image dimensions: ${imageWidth}x${imageHeight}`,
    `Bounding box: ${boundingBox.left}, ${boundingBox.top}, ${boundingBox.right}, ${boundingBox.bottom}`,
  );

  // Base = image + red polygon; then composite blue bbox on top so both are visible.
  const segmentationOverlayBuffer = await drawSegmentationOverlay(imageBuffer, segmentation);
  const bboxOnlyBuffer = await drawBoundingBoxOverlay(imageWidth, imageHeight, boundingBox);
  const segBboxExt = path.extname(imagePath).toLowerCase();
  let segBboxPipeline = sharp(segmentationOverlayBuffer).composite([{ input: bboxOnlyBuffer, top: 0, left: 0 }]);
  const segBboxBuffer =
    segBboxExt === '.jpg' || segBboxExt === '.jpeg'
      ? await segBboxPipeline.jpeg({ quality: 90 }).toBuffer()
      : await segBboxPipeline.png().toBuffer();
  const segBboxOutPath = path.join(outDir, `[seg-bbox] ${base}${path.extname(imagePath).toLowerCase()}`);
  saveProcessedImage(
    segBboxBuffer,
    segBboxOutPath,
  );
  console.log('Saved image with segmentation and bounding box:', segBboxOutPath);

  
  // Propose a square crop: side = min(W, H), centered on the bbox, clamped to image.
  const proposedCrop = proposeSquareCropCenteredOnBbox(imageWidth, imageHeight, boundingBox);
  console.log(
    `Proposed square crop: left=${proposedCrop.left} top=${proposedCrop.top} size=${proposedCrop.size}`,
  );

  // If the crop would cut the bounding box (subject), warn and exit.
  const cropCutsBbox =
    boundingBox.left < proposedCrop.left ||
    boundingBox.right > proposedCrop.left + proposedCrop.size ||
    boundingBox.top < proposedCrop.top ||
    boundingBox.bottom > proposedCrop.top + proposedCrop.size;
  if (cropCutsBbox) {
    console.warn(
      'Proposed crop would cut through the subject bounding box. Aborting. Consider white-pad or different crop.',
    );
    process.exit(1);
  }

  // Save image with segmentation, bbox, and proposed crop overlay: [seg-bbox-crop] <base>.<ext>.
  const cropOverlayBuffer = await drawCropOverlay(imageWidth, imageHeight, proposedCrop);
  const segBboxCropBuffer = await applyOverlays(
    segBboxBuffer,
    [cropOverlayBuffer],
    path.extname(imagePath).toLowerCase(),
  );
  const segBboxCropOutPath = path.join(outDir, `[seg-bbox-crop] ${base}${path.extname(imagePath).toLowerCase()}`);
  saveProcessedImage(segBboxCropBuffer, segBboxCropOutPath);
  console.log('Saved image with segmentation, bbox, and proposed crop:', segBboxCropOutPath);

  // Crop the image to the proposed square and save: [seg-bbox-cropped] <base>.<ext>.
  const ext = path.extname(imagePath).toLowerCase();
  const croppedPipeline = sharp(imageBuffer).extract({
    left: proposedCrop.left,
    top: proposedCrop.top,
    width: proposedCrop.size,
    height: proposedCrop.size,
  });
  const croppedBuffer =
    ext === '.jpg' || ext === '.jpeg'
      ? await croppedPipeline.jpeg({ quality: 90 }).toBuffer()
      : await croppedPipeline.png().toBuffer();
  const segBboxCroppedOutPath = path.join(outDir, `[seg-bbox-cropped] ${base}${path.extname(imagePath).toLowerCase()}`);
  saveProcessedImage(croppedBuffer, segBboxCroppedOutPath);
  console.log('Saved cropped image:', segBboxCroppedOutPath);
}

main();
