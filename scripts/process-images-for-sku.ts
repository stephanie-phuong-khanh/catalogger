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
 * The desired output for each SKU should be edited images that satisfy the Dansons Medical preferences.
 * Ordering and classifying images explicitly is out of scope for this script.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { processImage, saveProcessedImage } from '../lib/edit-image';
import { createVisionClient } from '../lib/vision-client';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const COPY_AS_IS_EXT = new Set(['.pdf']);
const FILE_EXT = new Set([...IMAGE_EXT, ...COPY_AS_IS_EXT]);

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
  const files = entries
    .filter((e) => e.isFile() && FILE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  console.log('Input directory:', inputDir);
  console.log('Output directory:', outputDir);
  console.log(`Processing ${files.length} files:`, files);
  console.log('');

  const visionClient = createVisionClient();
  let resizedImages: string[] = [];
  let unchangedImages: string[] = [];
  let copiedAsIs: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const srcPath = path.join(inputDir, file);
    const ext = path.extname(file).toLowerCase();

    console.log();
    console.log(`[${i + 1} / ${files.length}] ${file}`);

    if (COPY_AS_IS_EXT.has(ext)) {
      const outPath = path.join(outputDir, file);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.copyFileSync(srcPath, outPath);
      console.log('  ✓ copied as-is (no processing)');
      copiedAsIs.push(file);
      continue;
    }

    const imageBuffer = fs.readFileSync(srcPath);

    try {
      const resizedBuffer = await processImage(imageBuffer, 1500, 1500, visionClient);
      const baseName = path.basename(file, ext);
      const outputFileName = ext === '.webp' ? baseName + '.jpg' : file;
      const outPath = path.join(outputDir, outputFileName);
      saveProcessedImage(resizedBuffer, outPath);

      console.log('  ✓', file);
      resizedImages.push(file);
    } catch (err) {
      const outPath = path.join(outputDir, '[ORIG] ' + file);
      saveProcessedImage(imageBuffer, outPath);

      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] Saved original file as "[ORIG] ${file}" for reason: ${message}`);
      unchangedImages.push(file);
    }
  }

  console.log('');
  console.log(`Processed ${files.length} files.`);
  console.log(`Resized: ${resizedImages.length}. Copied as-is (e.g. PDF): ${copiedAsIs.length}. Saved original on error: ${unchangedImages.length}.`);
  console.log(`Output: ${outputDir}`);
}

main();
