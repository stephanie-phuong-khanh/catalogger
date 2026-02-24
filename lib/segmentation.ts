/**
 * Subject segmentation: mask → contours (polygons), find outline, and overlay drawing.
 * Uses rembg (via segmentation-rembg.ts) for the mask; d3-contour for outline extraction.
 */
/// <reference path="../types/d3-contour.d.ts" />

import sharp from 'sharp';
import { runRembgSegmentation } from './segmentation-rembg';

/** Segmentation result: outline of subject as polygon(s) in pixel coordinates. */
export interface SegmentationResult {
  polygons: Array<Array<{ x: number; y: number }>>;
  imageWidth: number;
  imageHeight: number;
}

const SEGMENTATION_MASK_THRESHOLD = 0.5;

/** Drop polygons that are the full-image frame (d3-contour can return both subject outline and image boundary). */
function isImageFramePolygon(
  points: Array<{ x: number; y: number }>,
  imageWidth: number,
  imageHeight: number,
  tolerancePx: number = 3,
): boolean {
  if (points.length < 4) return false;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  return (
    minX <= tolerancePx &&
    maxX >= imageWidth - tolerancePx &&
    minY <= tolerancePx &&
    maxY >= imageHeight - tolerancePx
  );
}

async function maskToPolygons(
  data: Float32Array,
  maskWidth: number,
  maskHeight: number,
  imageWidth: number,
  imageHeight: number,
): Promise<Array<Array<{ x: number; y: number }>>> {
  const scaleX = imageWidth / maskWidth;
  const scaleY = imageHeight / maskHeight;
  try {
    const { contours } = await import('d3-contour');
    const gen = contours().size([maskWidth, maskHeight]);
    const multiPoly = gen.contour(Array.from(data), SEGMENTATION_MASK_THRESHOLD) as {
      coordinates: number[][][][];
    };
    if (!multiPoly?.coordinates?.length) return [];
    const all = multiPoly.coordinates.map((poly: number[][][]) => {
      const ring = poly[0];
      if (!ring?.length) return [];
      return ring.map(([x, y]: number[]) => ({
        x: Math.round(x * scaleX),
        y: Math.round(y * scaleY),
      }));
    });
    return all.filter(
      (pts) => pts.length >= 3 && !isImageFramePolygon(pts, imageWidth, imageHeight),
    );
  } catch {
    return [];
  }
}

/**
 * Get subject outline as polygon coordinates (for crop proposal). Uses rembg subprocess + contour extraction.
 * Requires: Docker with danielgatis/rembg (see lib/segmentation-rembg.ts).
 */
export async function findSegmentation(input: Buffer): Promise<SegmentationResult> {
  const out = await findSegmentationWithMask(input);
  return {
    polygons: out.segmentation.polygons,
    imageWidth: out.segmentation.imageWidth,
    imageHeight: out.segmentation.imageHeight,
  };
}

/**
 * Same as findSegmentation but also returns the raw mask (for visual inspection overlay).
 */
export async function findSegmentationWithMask(input: Buffer): Promise<{
  segmentation: SegmentationResult;
  mask: { data: Float32Array; width: number; height: number } | null;
}> {
  const metadata = await sharp(input).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (imageWidth === 0 || imageHeight === 0) {
    return {
      segmentation: { polygons: [], imageWidth: 0, imageHeight: 0 },
      mask: null,
    };
  }
  const maskResult = await runRembgSegmentation(input);
  if (!maskResult) {
    return {
      segmentation: { polygons: [], imageWidth, imageHeight },
      mask: null,
    };
  }
  const polygons = await maskToPolygons(
    maskResult.data,
    maskResult.width,
    maskResult.height,
    imageWidth,
    imageHeight,
  );
  return {
    segmentation: { polygons, imageWidth, imageHeight },
    mask: { data: maskResult.data, width: maskResult.width, height: maskResult.height },
  };
}

/**
 * Draw the mask as a semi-transparent red overlay (for visual inspection).
 */
export async function drawMaskOverlay(
  input: Buffer,
  maskData: Float32Array,
  maskWidth: number,
  maskHeight: number,
  threshold: number = SEGMENTATION_MASK_THRESHOLD,
): Promise<Buffer> {
  const metadata = await sharp(input).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (imageWidth === 0 || imageHeight === 0) return input;
  const rgba = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = rgba;
  const w = info.width;
  const h = info.height;
  const scaleX = maskWidth / w;
  const scaleY = maskHeight / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.min(Math.floor(x * scaleX), maskWidth - 1);
      const my = Math.min(Math.floor(y * scaleY), maskHeight - 1);
      const v = maskData[my * maskWidth + mx] ?? 0;
      if (v >= threshold) {
        const i = (y * w + x) * 4;
        data[i] = Math.min(255, Math.round((data[i] ?? 0) * 0.5 + 255 * 0.5));
        data[i + 1] = Math.min(255, Math.round((data[i + 1] ?? 0) * 0.3));
        data[i + 2] = Math.min(255, Math.round((data[i + 2] ?? 0) * 0.3));
      }
    }
  }
  return sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * Draw segmentation polygon outline on the image (for visual inspection).
 */
export async function drawSegmentationOverlay(
  input: Buffer,
  segmentation: SegmentationResult,
  strokeWidthPx: number = 4,
): Promise<Buffer> {
  const { polygons, imageWidth, imageHeight } = segmentation;
  if (polygons.length === 0) return sharp(input).png().toBuffer();
  const pathData = polygons
    .map((poly) => {
      if (poly.length < 2) return '';
      const points = poly.map((p) => `${p.x},${p.y}`).join(' ');
      return `<polygon points="${points}" fill="none" stroke="red" stroke-width="${strokeWidthPx}"/>`;
    })
    .filter(Boolean)
    .join('\n  ');
  const svg = Buffer.from(
    `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
  ${pathData}
</svg>`,
  );
  const overlay = await sharp(svg).png().toBuffer();
  return sharp(input).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}
