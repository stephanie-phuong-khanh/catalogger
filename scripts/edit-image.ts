/**
 * Serves as an entry point to test individual edits to an image.
 *
 * Usage: npm run edit-image -- --image-path "data/images/MX-J206-01-01 3x3 (1).jpg"

 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { resizeImage, saveProcessedImage } from '../lib/edit-image';

const SUPPORTED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png'];

async function main() {
  // Read in the image path from --image-path (supports --image-path=path or --image-path path).
  const argIndex = process.argv.findIndex((arg) => arg === '--image-path' || arg.startsWith('--image-path='));
  let imagePath: string | undefined;
  if (argIndex !== -1) {
    const arg = process.argv[argIndex];
    if (arg.includes('=')) {
      imagePath = arg.split('=').slice(1).join('=').trim(); // in case path contains =
    } else {
      imagePath = process.argv[argIndex + 1];
    }
  }
  if (!imagePath) {
    console.error('Missing --image-path argument.');
    process.exit(1);
  }

	// check if the image format is supported
	if (!SUPPORTED_IMAGE_FORMATS.includes(path.extname(imagePath).slice(1))) {
		console.error(`Unsupported image format: ${path.extname(imagePath)}`);
		
	}

  // Node does not expand ~; do it so paths like ~/Google Drive/... work.
  if (imagePath.startsWith('~')) {
    imagePath = path.join(os.homedir(), imagePath.slice(1));
  }

  const imageBuffer = fs.readFileSync(imagePath);

  let resizedBuffer: Buffer;
  try {
    resizedBuffer = await resizeImage(imageBuffer);
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
