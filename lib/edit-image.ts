/**
 * This file contains functions that apply individual edits to an image.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ALMOST_SQUARE_THRESHOLD = 0.02; // 2%: if (diff / minSide) <= this, center-crop to square

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
 * Output format matches the input (jpeg → jpeg, png → png, etc.). Returns the encoded Buffer.
 */
export async function resizeImage(
  input: Buffer,
  targetWidthPixels: number = 1500,
  targetHeightPixels: number = 1500,
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
		// TODO: Intelligent cropping.
    throw new Error(`Not square. Original dimensions: ${w}x${h}. Ratio diff ${((Math.abs(w - h) / Math.min(w, h)) * 100).toFixed(2)}% exceeds ${ALMOST_SQUARE_THRESHOLD * 100}% threshold.`);
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
 * TODO:Intelligent cropping.
 */
function intelligentCrop(input: Buffer): Buffer {
  return input;
}

/**
 * Write a processed image buffer to disk. Creates the parent directory if needed.
 */
export function saveProcessedImage(buffer: Buffer, outputPath: string): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}
