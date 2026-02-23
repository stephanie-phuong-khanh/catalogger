/**
 * This file contains functions that apply individual edits to an image.
 */

import sharp from 'sharp';

/**
 * Resize an image to the target dimensions. Image is passed as a Buffer (e.g. from fs.readFileSync).
 * Uses "contain" fit: image fits inside the rectangle, padded with white to fill 1500x1500.
 * Returns a Buffer of the resized PNG.
 */
export async function resizeImage(
  input: Buffer,
  targetWidthPixels: number = 1500,
  targetHeightPixels: number = 1500,
): Promise<Buffer> {
	const metadata = await sharp(input).metadata();
	const originalWidth = metadata.width;
	const originalHeight = metadata.height;

	if (originalWidth === targetWidthPixels && originalHeight === targetHeightPixels) {
		return input;
	}
	if (originalWidth != originalHeight) {
		throw new Error(`Image is not square. Original dimensions: ${originalWidth}x${originalHeight}`);
	}
	if (originalWidth < targetWidthPixels || originalHeight < targetHeightPixels) {
		console.warn(`Image is smaller than the target dimensions. Not sure what will happen. Original dimensions: ${originalWidth}x${originalHeight}, Target dimensions: ${targetWidthPixels}x${targetHeightPixels}`);
	}
	
  return sharp(input)
    .resize({
      width: targetWidthPixels,
      height: targetHeightPixels,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255 },
    })
    .png()
    .toBuffer();
}
