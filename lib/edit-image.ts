/**
 * This file contains functions that apply individual edits to an image.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { ImageVisionClient } from './vision-client';
import { findSegmentationWithMask } from './segmentation';

/** Threshold for considering an image "almost square" (within 2% of square). */
const ALMOST_SQUARE_THRESHOLD = 0.02;
/** Minimum margin around subject as a fraction of crop size (e.g. 0.02 = 2%). Subject must be this far inside the crop on all sides. */
const CROP_SUBJECT_MARGIN_RATIO = 0.02;
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
 * Crop a square region from the image. Preserves format. Used by centerCropToSquare and by the segmentation-based crop path.
 */
async function cropToSquare(
  input: Buffer,
  left: number,
  top: number,
  size: number,
): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const format = metadata.format;
  if (format === undefined) throw new Error('Could not determine image format.');
  const pipeline = sharp(input).extract({ left, top, width: size, height: size });
  return encodePipelineByFormat(pipeline, format);
}

/**
 * Center-crop the image to a square (side = min(width, height)). Preserves format.
 * Used when isAlmostSquare or for negligible_background/cutout.
 */
async function centerCropToSquare(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  if (w === 0 || h === 0) throw new Error(`Invalid image dimensions: ${w}x${h}`);
  const size = Math.min(w, h);
  const left = Math.floor((w - size) / 2);
  const top = Math.floor((h - size) / 2);
  return cropToSquare(input, left, top, size);
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
 * Get the bounding box of a polygon.
 */
function getBoundingBox(
  polygon: Array<{ x: number; y: number }>,
): { left: number; top: number; right: number; bottom: number } {
  const left = Math.min(...polygon.map((p) => p.x));
  const top = Math.min(...polygon.map((p) => p.y));
  const right = Math.max(...polygon.map((p) => p.x));
  const bottom = Math.max(...polygon.map((p) => p.y));
  return { left, top, right, bottom };
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

    if (classification.kind === 'contextual') {
      console.log('Image context classification: contextual. Padding with white to square.');
      toResize = await padWithWhiteToSquare(input);
    } else if (classification.kind === 'negligible_background' || classification.kind === 'cutout') {
      console.log(`Image context classification: ${classification.kind}. TODO: Implement intelligent crop using segmentation of image subject.`);

      // Get segmentation of image subject.
      const { segmentation } = await findSegmentationWithMask(input);

      if (segmentation.polygons.length !== 1) {
        // If there's not exactly one polygon, either throw error or padWithWhiteToSquare.
        // TODO: log a fat red exclamation mark to make sure it's visible. Consider simply throwing an error.
        console.error(`Expected exactly one polygon, identified: ${segmentation.polygons.length}`);
        toResize = await padWithWhiteToSquare(input);
      } else {
        const polygon = segmentation.polygons[0];
        console.log(`Identified 1 polygon, segmentation has${polygon.length} total points.`);

        // Get bounding box of segmentation
        const boundingBox = getBoundingBox(polygon);
        console.log(
          `Bounding box [left=${boundingBox.left}, top=${boundingBox.top}, right=${boundingBox.right}, bottom=${boundingBox.bottom}] on image with dimensions [w=${w}, h=${h}].`,
        );

        // Propose a square crop centered on the bounding box.
        const proposedCrop = proposeSquareCropCenteredOnBbox(w, h, boundingBox);
        console.log(
          `Proposed square crop [left=${proposedCrop.left}, top=${proposedCrop.top}, size=${proposedCrop.size}] on image with dimensions [w=${w}, h=${h}].`,
        );

        // Check if the bounding box fits cleanly inside the proposed crop with a margin of padding.
        const marginPx = Math.floor(CROP_SUBJECT_MARGIN_RATIO * proposedCrop.size);
        const fitsWithMargin =
          boundingBox.left >= proposedCrop.left + marginPx &&
          boundingBox.right <= proposedCrop.left + proposedCrop.size - marginPx &&
          boundingBox.top >= proposedCrop.top + marginPx &&
          boundingBox.bottom <= proposedCrop.top + proposedCrop.size - marginPx;
        if (fitsWithMargin) {
          toResize = await cropToSquare(input, proposedCrop.left, proposedCrop.top, proposedCrop.size);
        } else {
          console.warn('Proposed crop would cut through the subject bounding box. Aborting. Consider white-pad or different crop.');
          toResize = await padWithWhiteToSquare(input);
        }
      }
    } else {
      throw new Error(`Unsupported image context classification: ${classification.kind}`);
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
