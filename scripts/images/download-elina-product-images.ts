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
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Page } from 'puppeteer';
import { processImage, saveProcessedImage } from '../../lib/images/edit-image';
import { createVisionClient } from '../../lib/images/vision-client';

puppeteer.use(StealthPlugin());

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const CONFIG = {
  inputPath: path.join(process.cwd(), 'data/elina/elina_pilates_products_site.json'),
  // Use an absolute path so output is not under process.cwd(); override with --out-dir.
  outputPath: '/Users/sdoan/Google Drive/My Drive/Scraped from vendor: Elina Pilates <> Dansons',
  reportPath: path.join(process.cwd(), 'data/elina/download-elina-product-images-report.json'),
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

const ELINA_ORIGIN = 'https://www.elinapilates.com';
const IMAGE_FETCH_DELAY_MS = 400;

/** Fetch image via Puppeteer so the request runs in a real browser (avoids 403 from bot blocking). */
async function downloadImage(page: Page, url: string): Promise<Buffer> {
  const response = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
  if (!response) throw new Error(`No response: ${url}`);
  if (!response.ok()) throw new Error(`HTTP ${response.status()}: ${url}`);
  const buffer = await response.buffer();
  return Buffer.from(buffer);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );

  try {
    console.log('Loading site to establish session...');
    await page.goto(ELINA_ORIGIN + '/eu/en/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);
    console.log('Session ready. Downloading images...\n');
  } catch (e) {
    console.error('Failed to load site:', e);
    await browser.close();
    process.exit(1);
  }

  let totalWritten = 0;
  let totalSkipped = 0;
  const successes: { productName: string; articleRef: string; imageIndex: number; path: string }[] = [];
  const skipped: { productName: string; articleRef: string; reason: string }[] = [];
  const failures: { productName: string; articleRef: string; imageIndex: number; url: string; error: string }[] = [];

  try {
    for (const group of groups) {
      const productName = group.product_name ?? 'Unknown';
      const productDirName = sanitizeFolderName(productName);

      for (const item of group.items ?? []) {
        const articleRef = item.article_ref ?? 'unknown';
        const imageUrls = item.image_urls ?? [];
        if (imageUrls.length === 0) {
          const reason = 'no image_urls';
          skipped.push({ productName, articleRef, reason });
          console.log(`[skip] ${productName} / ${articleRef}: ${reason}`);
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
          const fullPath = path.resolve(outPath);

          try {
            const buffer = await downloadImage(page, url);
            const processed = await processImage(buffer, 1500, 1500, visionClient);
            saveProcessedImage(processed, outPath);
            successes.push({ productName, articleRef, imageIndex: oneBased, path: fullPath });
            console.log(`[ok] ${fullPath}`);
            totalWritten++;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            failures.push({ productName, articleRef, imageIndex: oneBased, url, error: errorMsg });
            console.error(`[fail] ${productDirName}/${articleRef} image ${oneBased} (${url}):`, err);
            totalSkipped++;
          }
          await delay(IMAGE_FETCH_DELAY_MS);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. Written: ${totalWritten}, skipped/failed: ${totalSkipped}`);
  if (totalWritten > 0) console.log('Images saved under:', outputBase);

  const reportPath = path.resolve(CONFIG.reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        summary: { totalWritten, totalSkipped, successCount: successes.length, skippedCount: skipped.length, failureCount: failures.length },
        successes,
        skipped,
        failures,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\nReport written to: ${reportPath}`);

  if (successes.length > 0) {
    console.log('\n--- Successful downloads ---');
    for (const s of successes) {
      console.log(`  ${s.productName} / ${s.articleRef} image ${s.imageIndex}: ${s.path}`);
    }
  }
  if (skipped.length > 0) {
    console.log('\n--- Skipped ---');
    for (const s of skipped) {
      console.log(`  ${s.productName} / ${s.articleRef}: ${s.reason}`);
    }
  }
  if (failures.length > 0) {
    console.log('\n--- Failed ---');
    for (const f of failures) {
      console.log(`  ${f.productName} / ${f.articleRef} image ${f.imageIndex}: ${f.url}`);
      console.log(`    → ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
