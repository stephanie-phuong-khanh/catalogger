/**
 * Download Elina product images from elina_pilates_products_site.json, run each through
 * edit-image (resize to 1500x1500; already square images just get resized), and write to
 * CONFIG.outputPath as: {Product Name}/{article_ref}/{article_ref} (001).ext, etc.
 *
 * Usage:
 *   npm run download-elina-product-images
 *   npm run download-elina-product-images -- --out-dir /path/to/output
 *   npm run download-elina-product-images -- --single "Reformer Elite"
 *
 * CONFIG.outputPath can be overridden via --out-dir. Use --single to process only one product group.
 * Images are named "{article_ref} (001).ext", "{article_ref} (002).ext", ... (e.g. 100006 (001).jpg).
 * Extension is taken from the image URL or defaults to .jpg.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { processImage, saveProcessedImage } from '../../lib/images/edit-image';
import { createVisionClient } from '../../lib/images/vision-client';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const CONFIG = {
  inputPath: path.join(process.cwd(), 'data/elina/elina_pilates_products_site.json'),
  // Use an absolute path so output is not under process.cwd(); override with --out-dir.
  outputPath: '/Users/sdoan/Google Drive/My Drive/Scraped from vendor: Elina Pilates <> Dansons',
};

type Item = { article_ref: string; product_name?: string; image_urls?: string[]; [k: string]: unknown };
type Group = { product_name?: string; items: Item[]; [k: string]: unknown };
type SiteInput = { groups: Group[] };

function parseArg(name: string): string | undefined {
  const argIndex = process.argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (argIndex === -1) return undefined;
  const arg = process.argv[argIndex];
  const value = arg?.includes('=') ? arg.split('=').slice(1).join('=').trim() : process.argv[argIndex + 1];
  return value || undefined;
}

function parseOutDir(): string {
  const value = parseArg('out-dir');
  if (value) return value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
  return CONFIG.outputPath;
}

/** Sanitize product name for use as a folder name (no slashes or backslashes). */
function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\]/g, '-').trim() || 'product';
}

/** Get file extension from URL (e.g. .jpg) or default .jpg. */
function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {
    // ignore
  }
  return '.jpg';
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; catalogger/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const outputBase = path.resolve(parseOutDir());
  console.log('Output directory:', outputBase);
  if (!fs.existsSync(CONFIG.inputPath)) {
    console.error('Input file not found:', CONFIG.inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG.inputPath, 'utf-8');
  const data: SiteInput = JSON.parse(raw);
  const visionClient = createVisionClient();

  let groups = data.groups ?? [];
  const singleProduct = parseArg('single');
  if (singleProduct) {
    const want = singleProduct.trim().toLowerCase();
    groups = groups.filter((g) => (g.product_name ?? '').trim().toLowerCase() === want);
    if (groups.length === 0) {
      const names = (data.groups ?? []).map((g) => g.product_name ?? 'Unknown').join(', ');
      console.error(`No product group matching "${singleProduct}". Available: ${names}`);
      process.exit(1);
    }
  }

  let totalWritten = 0;
  let totalSkipped = 0;

  for (const group of groups) {
    const productName = group.product_name ?? 'Unknown';
    const productDirName = sanitizeFolderName(productName);

    for (const item of group.items ?? []) {
      const articleRef = item.article_ref ?? 'unknown';
      const imageUrls = item.image_urls ?? [];
      if (imageUrls.length === 0) {
        console.log(`[skip] ${productName} / ${articleRef}: no image_urls`);
        totalSkipped++;
        continue;
      }

      const skuDir = path.join(outputBase, productDirName, articleRef);

      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const oneBased = i + 1;
        const indexStr = String(oneBased).padStart(3, '0');
        const ext = getExtFromUrl(url);
        const fileName = `${articleRef} (${indexStr})${ext}`;
        const outPath = path.join(skuDir, fileName);

        try {
          const buffer = await downloadImage(url);
          const processed = await processImage(buffer, 1500, 1500, visionClient);
          saveProcessedImage(processed, outPath);
          console.log(`[ok] ${path.resolve(outPath)}`);
          totalWritten++;
        } catch (err) {
          console.error(`[fail] ${productDirName}/${articleRef} image ${oneBased} (${url}):`, err);
          totalSkipped++;
        }
      }
    }
  }

  console.log(`\nDone. Written: ${totalWritten}, skipped/failed: ${totalSkipped}`);
  if (totalWritten > 0) console.log('Images saved under:', outputBase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
