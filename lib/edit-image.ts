/**
 * This file contains functions that apply individual edits to an image.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { ImageVisionClient } from './vision-client';

const ALMOST_SQUARE_THRESHOLD = 0.02; // 2%: if (diff / minSide) <= this, center-crop to square

/** Max dimension when sending images to the LLM (saves tokens/cost). */
const VISION_MAX_DIMENSION = 768;

/** Default prompt for LLM when asking whether the red-square center crop is acceptable. */
export const DEFAULT_PROPOSE_CROP_PROMPT =
  'The image has a red square drawn on it showing the proposed square crop. Only the area inside the red square would be kept. Use "left" and "right" from the viewer\'s perspective (left = left side of the image, right = right side).\n\n' +
  'IMPORTANT: For a non-square image, a center crop always removes equal amounts from BOTH sides of the longer dimension. So the product can be cut on the left, the right, or BOTH. Look carefully at whether the left edge and right edge of the red square both fall completely outside the product. If either edge cuts into the product at all, REJECT and say which side(s): left, right, or both.\n\n' +
  'REJECT if the red square cuts off ANY part of the main product (e.g. the sauna interior, exterior, or any visible part). The WHOLE product must be fully inside the red square. Even a small trim of the product (e.g. control panel, wall edge) means REJECT.\n\n' +
  'REJECT if the background is plain or insignificant (e.g. solid white) and the main subject is off-center. Then a center crop would either cut the product or leave a badly composed image; the image should be off-center cropped instead. Reason: e.g. "subject off-center with plain background; should be off-center cropped."\n\n' +
  'REJECT if the crop would cut through furniture, people, or other prominent scene elements in a jarring way (e.g. lifestyle shots).\n\n' +
  'APPROVE only when you are certain the entire product is fully inside the red square with no trim on any side, and the composition looks deliberate. When in doubt, REJECT.';

/**
 * True if the image is close enough to square that a center-crop is safe (won't cut meaningful content).
 */
function isAlmostSquare(width: number, height: number): boolean {
  const minSide = Math.min(width, height);
  const diff = Math.abs(width - height);
  return minSide > 0 && diff / minSide <= ALMOST_SQUARE_THRESHOLD;
}

/**
 * Resize an image to the target dimensions (default 1500×1500).
 * - If already square or "almost square" (within 2%): center-crop to square, then downscale to target.
 * - Otherwise: throws "Not square" (padding path not implemented yet).
 * visionClient is optional; when provided it can be used later for intelligent crop (non–almost-square).
 * Output format matches the input (jpeg → jpeg, png → png, etc.). Returns the encoded Buffer.
 */
export async function resizeImage(
  input: Buffer,
  targetWidthPixels: number = 1500,
  targetHeightPixels: number = 1500,
  visionClient?: ImageVisionClient | null,
  proposeCropPrompt: string = DEFAULT_PROPOSE_CROP_PROMPT,
): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  const format = metadata.format;

  if (w === 0 || h === 0) {
    throw new Error(`Invalid image dimensions: ${w}x${h}`);
  }

  if (w === h) {
    console.log(`Image is already square: ${w}x${h}`);
  } else if (isAlmostSquare(w, h)) {
    console.log(`Image is almost square: ${w}x${h}. Will center-crop to square.`);
  } else {
    if (visionClient) {
      // TODO: Implement LLM call which classifies the image as cutout or lifestyle.
    } else {
      throw new Error(
        `Not square. Original dimensions: ${w}x${h}. Ratio diff ${((Math.abs(w - h) / Math.min(w, h)) * 100).toFixed(2)}% exceeds ${ALMOST_SQUARE_THRESHOLD * 100}% threshold. ` +
          `Pass a vision client to ask the LLM if center crop is acceptable.`,
      );
    }
  }

  const size = Math.min(w, h);
  const left = Math.floor((w - size) / 2);
  const top = Math.floor((h - size) / 2);

  let pipeline = sharp(input);
  if (w !== size || h !== size) {
    pipeline = pipeline.extract({ left, top, width: size, height: size });
  }
  pipeline = pipeline
    .resize(targetWidthPixels, targetHeightPixels)
    .keepIccProfile();

  if (format === 'jpeg' || format === 'jpg') {
    return pipeline.jpeg().toBuffer();
  } else if (format === 'png') {
    return pipeline.png().toBuffer();
  } else {
    throw new Error(`Unsupported image format: ${format}`);
  }
}

/**
 * Downscale an image so the longer side is at most maxDimension. Used before sending to the LLM to save tokens.
 */
async function downscaleForVision(imageBuffer: Buffer, maxDimension: number): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= maxDimension && h <= maxDimension) return imageBuffer;
  const scale = maxDimension / Math.max(w, h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  return sharp(imageBuffer)
    .resize(newW, newH)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Draw a red rectangle (crop region) on a copy of the image and return the new buffer.
 * Used so the LLM can see the proposed crop and approve or reject.
 */
export async function drawCropOverlay(
  input: Buffer,
  left: number,
  top: number,
  cropWidth: number,
  cropHeight: number,
  imageWidth: number,
  imageHeight: number,
  strokeWidthPx: number = 4,
): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${left}" y="${top}" width="${cropWidth}" height="${cropHeight}" fill="none" stroke="red" stroke-width="${strokeWidthPx}"/>
</svg>`,
  );
  const overlay = await sharp(svg).png().toBuffer();
  return sharp(input)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Draw the center-crop overlay by computing the center square and calling drawCropOverlay.
 */
export async function drawCenterCropOverlay(
  input: Buffer,
  width: number,
  height: number,
  strokeWidthPx: number = 4,
): Promise<Buffer> {
  const size = Math.min(width, height);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);
  return drawCropOverlay(input, left, top, size, size, width, height, strokeWidthPx);
}

/**
 * Write a processed image buffer to disk. Creates the parent directory if needed.
 */
export function saveProcessedImage(buffer: Buffer, outputPath: string): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}
