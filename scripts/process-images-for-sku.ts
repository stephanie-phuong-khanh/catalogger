/**
 * Serves as an entry point to process images for a given SKU.
 *
 * Usage: npm run process-images-for-sku -- --sku "MX-J206-01" --input-dir "~/Golden Designs/Tab 1 - Most Popular - Top Sellers/MX-J206-01" --output-dir "data/images/tab_1_most_popular/MX-J206-01"
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

function main() {
  // Read in the input directory from --input-dir (supports --input-dir=path or --input-dir path).
  const argIndex = process.argv.findIndex((arg) => arg === '--input-dir' || arg.startsWith('--input-dir='));
  let inputDir: string | undefined;
  if (argIndex !== -1) {
    const arg = process.argv[argIndex];
    if (arg.includes('=')) {
      inputDir = arg.split('=').slice(1).join('=').trim(); // in case path contains =
    } else {
      inputDir = process.argv[argIndex + 1];
    }
  }
  if (!inputDir) {
    console.error('Missing --input-dir argument.');
    process.exit(1);
  }
  // Node does not expand ~; do it so paths like ~/Google Drive/... work.
  if (inputDir.startsWith('~')) {
    inputDir = path.join(os.homedir(), inputDir.slice(1));
  }
  if (!fs.existsSync(inputDir)) {
    console.error('Input directory does not exist:', inputDir);
    process.exit(1);
  }
  console.log('Input directory:', inputDir);
  console.log('');
  console.log(path.basename(inputDir) || inputDir);
  const files = fs.readdirSync(inputDir);

  console.log('Files:', files);
  for (const file of files) {
    console.log(`- ${file}`);
  }

  // Apply classification logic to the files into categories.
}

main();
