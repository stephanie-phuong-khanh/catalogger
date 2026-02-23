/**
 * Serves as an entry point to process images for a given SKU.
 *
 * Usage: npm run process-images-for-sku -- --input-dir "~/Golden Designs/Tab 1 - Most Popular - Top Sellers/MX-J206-01" --output-dir "data/images/tab_1_most_popular/MX-J206-01"
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
import { resizeImage, saveProcessedImage } from '../lib/edit-image';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function parseArg(name: string): string | undefined {
  const i = process.argv.findIndex((arg) => arg === name || arg.startsWith(name + '='));
  if (i === -1) return undefined;
  const arg = process.argv[i];
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=').trim();
  }
  return process.argv[i + 1];
}

function expandTilde(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

async function main() {
  let inputDir = parseArg('--input-dir');
  let outputDir = parseArg('--output-dir');
  if (!inputDir) {
    console.error('Missing --input-dir argument.');
    process.exit(1);
  }
  if (!outputDir) {
    console.error('Missing --output-dir argument.');
    process.exit(1);
  }
  inputDir = expandTilde(inputDir);
  outputDir = expandTilde(outputDir);

  if (!fs.existsSync(inputDir)) {
    console.error('Input directory does not exist:', inputDir);
    process.exit(1);
  }

  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  const imageFiles = entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);

  console.log('Input directory:', inputDir);
  console.log('Output directory:', outputDir);
  console.log(`Processing ${imageFiles.length} image files:`, imageFiles);
  console.log('');

  let resizedImages: string[] = [];
  let unchangedImages: string[] = [];

  for (const file of imageFiles) {
    const srcPath = path.join(inputDir, file);
    const imageBuffer = fs.readFileSync(srcPath);

    try {
      const resizedBuffer = await resizeImage(imageBuffer);
      const outPath = path.join(outputDir, file);
      saveProcessedImage(resizedBuffer, outPath);

      console.log('  ✓', file);
      resizedImages.push(file);
    } catch (err) {
      const outPath = path.join(outputDir, '[ORIG] ' + file);
      saveProcessedImage(imageBuffer, outPath);

      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [!] Saved original file as "[ORIG] ${file}" for reason: ${message}`);
      unchangedImages.push(file);
    }
  }

  // Instead of logging done, please print a short summary of how many images were processed, how many were resized, and how many were not resized. as well as where the images were saved.
  console.log('');
  console.log(`Processed ${imageFiles.length} image files.`);
  console.log(`Resized ${resizedImages.length} images.`);
  console.log(`Saved original files for ${unchangedImages.length} images.`);
  console.log(`Images saved to: ${outputDir}`);
}

main();
