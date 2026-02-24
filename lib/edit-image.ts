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

/**
 * True if the image is close enough to square that a center-crop is safe (won't cut meaningful content).
 */
function isAlmostSquare(width: number, height: number): boolean {
  const minSide = Math.min(width, height);
  const diff = Math.abs(width - height);
  return minSide > 0 && diff / minSide <= ALMOST_SQUARE_THRESHOLD;
}

/**
 * Encode a sharp pipeline to a buffer using the image format (jpeg/png). Used in centerCropToSquare, padWithWhiteToSquare, resizeImage.
 */
function encodePipelineByFormat(
  pipeline: ReturnType<typeof sharp>,
  format: string,
): Promise<Buffer> {
  if (format === 'jpeg' || format === 'jpg') return pipeline.jpeg().toBuffer();
  if (format === 'png') return pipeline.png().toBuffer();
  throw new Error(`Unsupported image format: ${format}`);
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
 * Center-crop the image to a square (side = min(width, height)). Preserves format. 
 * Used when isAlmostSquare or for negligible_background/cutout.
 */
async function centerCropToSquare(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  const format = metadata.format;
  if (w === 0 || h === 0) throw new Error(`Invalid image dimensions: ${w}x${h}`);
  const size = Math.min(w, h);
  const left = Math.floor((w - size) / 2);
  const top = Math.floor((h - size) / 2);
  let pipeline = sharp(input);
  if (w !== size || h !== size) {
    pipeline = pipeline.extract({ left, top, width: size, height: size });
  }
  return encodePipelineByFormat(pipeline, format);
}

const WHITE = { r: 255, g: 255, b: 255 };

/**
 * Pad image with white so the result is square. Wide image → pad top/bottom evenly; tall image → pad left/right evenly. Preserves format.
 */
async function padWithWhiteToSquare(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  const format = metadata.format;
  if (w === 0 || h === 0) throw new Error(`Invalid image dimensions: ${w}x${h}`);
  if (w === h) {
    return encodePipelineByFormat(sharp(input), format);
  }
  const diff = Math.abs(w - h);
  const pad1 = Math.floor(diff / 2);
  const pad2 = diff - pad1;
  const extend =
    w > h
      ? { top: pad1, bottom: pad2, left: 0, right: 0, background: WHITE }
      : { left: pad1, right: pad2, top: 0, bottom: 0, background: WHITE };
  const pipeline = sharp(input).extend(extend);
  return encodePipelineByFormat(pipeline, format);
}


/**
 * Prepare an individual image for ecommerce catalogue.
 * - If already square or "almost square" (within 2%): center-crop to square, then downscale to target.
 * - Otherwise: classify image context as either contextual or cutout, with empty (or negligible) background.
 * - If contextual: pad with white to square.
 * - If cutout: Find segmentation of image subject and crop to center the subject.
 * - Finally, resize to target dimensions.
 * 
 * TODO: Make visionClient required.
 * 
 * Output format matches the input (jpeg → jpeg, png → png, etc.). Returns the encoded Buffer.
 */
export async function processImage(
  input: Buffer,
  targetWidthPixels: number = 1500,
  targetHeightPixels: number = 1500,
  visionClient: ImageVisionClient,
): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  const format = metadata.format;

  if (w === 0 || h === 0) {
    throw new Error(`Invalid image dimensions: ${w}x${h}`);
  }

  let toResize: Buffer = input;

  if (w === h) {
    console.log(`Image is already square: ${w}x${h}`);
  } else if (isAlmostSquare(w, h)) {
    console.log(`Image is almost square: ${w}x${h}. Will center-crop to square.`);
    toResize = await centerCropToSquare(input);
  } else {
    console.log('Image is neither square nor almost square. Classifying image context to determine edit strategy.');

    const downscaled = await downscaleForVision(input, VISION_MAX_DIMENSION);
    const didResize = w > VISION_MAX_DIMENSION || h > VISION_MAX_DIMENSION;
    const mimeType = didResize ? 'image/jpeg' : (format === 'png' ? 'image/png' : 'image/jpeg');
    const classification = await visionClient.classifyImageContext(downscaled, mimeType);

    if (classification.kind === 'negligible_background' || classification.kind === 'cutout') {
      console.log(`Image context classification: ${classification.kind}. TODO: Implement intelligent crop using segmentation of image subject.`);
      // TODO: Implement intelligent crop using segmentation of image subject.

      
    } else if (classification.kind === 'contextual') {
      console.log('Image context classification: contextual. Padding with white to square.');
      toResize = await padWithWhiteToSquare(input);
    }
  }

  // Resize to target dimensions, which always happens unless an error is thrown.
  const pipeline = sharp(toResize)
    .resize(targetWidthPixels, targetHeightPixels)
    .keepIccProfile();

  return encodePipelineByFormat(pipeline, format);
}

/**
 * Write a processed image buffer to disk. Creates the parent directory if needed.
 */
export function saveProcessedImage(buffer: Buffer, outputPath: string): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}
