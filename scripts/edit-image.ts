/**
 * Serves as an entry point to test individual edits to an image.
 *
 * Usage: npm run edit-image -- --image-path "data/images/MX-J206-01-01 3x3 (1).jpg"
 * 
 * Dansons Medical preferences:
 * - 1500x1500 images
 * - White background when applicable.
 * - Order:
 *   - Product on white background
 *   - Lifestyle image(s)
 *   - Other angles
 *   - Detail shots e.g. outlet type
 * 
 * Observations about Golden Designs images:
 * - The dimensions are often above 1500px by 1500px, so we have to downscale them, cropping them or adding padding if not square. Many images are actually very close to being square, so we should implement a heuristic to blindly crop if the image is close enough to being square such that a square crop will likely not cut off important content.
 * - Naming convention (assume the SKU is MX-J206-01):
 *   - Product on white background, of different angles: "MX-J206-01-01 3x3 (1).jpg", "MX-J206-01-01 3x3 (2).jpg", etc.
 *   - Lifestyle image (usually one, but sometimes multiple): "MX-J206-01-02 BG.jpg"
 *   - Detail shots have inconsistent names, simply describing the part photographed:
 *     - "15 Amp.jpg"
 *     - "Chromotherapy Light 07-11-2024 7 Colors + Red Light.jpg"
 *     - "control panel.JPG"
 *     - "MP3 Aux Connection.jpg"
 * - The images are already with a white background, so we don't need to implement background removal and placement on white background. However, this probably won't be true for other vendors, so we will implement this later.
 * 
 * Steps:
 * 1. Classify the image based on the naming convention and optionally with multimodal LLM.
 * 2. For each image, have LLM judge if its current state satisfies the Dansons Medical preferences. If not, propose edits.
 * 3. Apply the edits to the image.
 * 4. [TBD] Have LLM judge if the edits satisfy the Dansons Medical preferences.
 * 5. Oh also somewhere in this, we have to make the dimensions 1500x1500 for every image.
 * 6. Save the edited image.
 * 
 * The desired output for each SKU should be edited images, classified as either
 *  (a) product on white background, one of which is proposed as the first image, 
 *  (b) lifestyle image(s), 
 *  (c) detail shot(s). 
 * Images that are failed to be classified or deemed as redundant or irrelevant should be kept and presented as such for human review.
 * 
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { resizeImage } from '../lib/edit-image';

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

  // Node does not expand ~; do it so paths like ~/Google Drive/... work.
  if (imagePath.startsWith('~')) {
    imagePath = path.join(os.homedir(), imagePath.slice(1));
  }

  // Read the file into a Buffer (raw bytes).
  const imageBuffer = fs.readFileSync(imagePath);

	let resizedBuffer: Buffer | null = null;
  // try to resize the image, this could throw an error so try-catch!
	try {
		resizedBuffer = await resizeImage(imageBuffer);
	} catch (error) {
		console.error('Error resizing image:', error);
		return;
	}

  // Write out so you can check the result.
  const outDir = path.join(process.cwd(), 'data', 'image-experiments');
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = path.basename(imagePath);
  const outPath = path.join(outDir, `[resized] ${fileName}.png`);
  fs.writeFileSync(outPath, resizedBuffer);
  console.log('Wrote', outPath);
}

main();
