/**
 * Scrape Elina product pages and merge vendor (site) data into the URL list.
 *
 * Input:  elina_pilates_products_urls.json (groups with items, each item has url or null)
 * Output: elina_pilates_products_site.json — same structure + group-level "site" (product_name,
 *         text_under_images, tabs, videos). One file so listing generation doesn't reconcile two files.
 *
 * - Writes after every product (group) so we can resume.
 * - When url is null for an item: don't hit the website; copy group from input as-is (no site).
 * - When all items in a group have null url: copy group as-is, no site.
 * - When multiple variant URLs exist in a group: scrape first, then scrape second and compare
 *   shared content; on mismatch HALT (throw + exit 1) so you can inspect.
 *
 * Usage:
 *   npm run scrape-elina-site
 *   npm run scrape-elina-site -- --input-file=... --out-file=...
 *   npm run scrape-elina-site -- --headed
 *   npm run scrape-elina-site -- --fresh   # wipe output and start from input only
 */

import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Page } from 'puppeteer';
import {
  scrapeElinaProductPage,
  normalizeSharedContent,
  type ScrapedProductData,
} from '../../lib/listings/scrape-elina-product-page';

puppeteer.use(StealthPlugin());

const CONFIG = {
  inputFile: 'data/parsed-pricing-sheets/elina_pilates_products_urls.json',
  outFile: 'data/parsed-pricing-sheets/elina_pilates_products_site.json',
  vendorBaseUrl: 'https://www.elinapilates.com',
};

type Item = { article_ref: string; url?: string | null; [k: string]: unknown };
type Group = { product_name?: string; items: Item[]; site?: ScrapedProductData };
type Output = { groups: Group[] };

function parseArg(name: string, defaultValue: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=').trim() : defaultValue;
}

async function dismissCookiePopup(page: Page): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 500));
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
      for (const el of buttons) {
        const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
        if (/accept\s*all|accept\s*all\s*cookies/i.test(text)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      const closeBtn = document.querySelector('[aria-label="Close"], .close, [title="Close"]');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        return true;
      }
      return false;
    });
    if (clicked) await new Promise((r) => setTimeout(r, 300));
  } catch {
    // ignore
  }
}

function haltVariantMismatch(
  productName: string,
  url1: string,
  url2: string,
  norm1: string,
  norm2: string,
): never {
  const msg =
    `[scrape] VARIANT MISMATCH: Same product has different content on two variant URLs.\n` +
    `Product: ${productName}\n` +
    `URL 1: ${url1}\n` +
    `URL 2: ${url2}\n` +
    `Normalized content from URL 1 (first 200 chars): ${norm1.slice(0, 200)}...\n` +
    `Normalized content from URL 2 (first 200 chars): ${norm2.slice(0, 200)}...\n` +
    `Script halted. Inspect and fix before re-running.`;
  console.error(msg);
  process.exit(1);
}

async function main() {
  const inputFile = parseArg('input-file', CONFIG.inputFile);
  const outFile = parseArg('out-file', CONFIG.outFile);
  const headed = process.argv.includes('--headed');
  const fresh = process.argv.includes('--fresh');

  const inputPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile);
  const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  let input: Output;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as Output;
  } catch (e) {
    console.error('Invalid JSON in', inputPath, e);
    process.exit(1);
  }

  if (!input.groups || !Array.isArray(input.groups)) {
    console.error('Input must have "groups" array.');
    process.exit(1);
  }

  // Output = input structure + optional site per group. Always base on input so we keep all fields.
  const output: Output = {
    groups: input.groups.map((g) => ({ product_name: g.product_name, items: [...g.items] })),
  };

  if (fresh) {
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log('--fresh: reset output from input. No site data.\n');
  } else if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as Output;
      if (existing.groups && Array.isArray(existing.groups) && existing.groups.length === output.groups.length) {
        existing.groups.forEach((g, i) => {
          if (g?.site != null && output.groups[i]) (output.groups[i] as Group).site = g.site;
        });
        console.log(`Resuming: loaded existing site data from ${outPath}.\n`);
      }
    } catch {
      console.log('Could not parse output file; starting from input.\n');
    }
  }

  const baseUrl = CONFIG.vendorBaseUrl.replace(/\/$/, '');
  const homepageUrl = `${baseUrl}/eu/en/`;

  const groupsToDo = output.groups.map((g, i) => ({ group: g, index: i })).filter(({ group }) => !('site' in group && group.site != null));

  if (groupsToDo.length === 0) {
    console.log('All groups already have site data. Nothing to do.');
    process.exit(0);
  }

  console.log(`Groups to scrape: ${groupsToDo.length} (${output.groups.length - groupsToDo.length} already done).\n`);
  if (headed) console.log('(Running in headed mode.)\n');

  const browser = await puppeteer.launch({
    headless: !headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('[scrape] Browser started.');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );

  try {
    console.log('[scrape] Loading homepage for session/cookies...');
    await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissCookiePopup(page);
    await new Promise((r) => setTimeout(r, 2000));
    console.log('[scrape] Homepage loaded.\n');
  } catch (e) {
    console.error('Failed to load homepage:', e);
    await browser.close();
    process.exit(1);
  }

  for (const { group, index } of groupsToDo) {
    const productName = group.product_name ?? '?';
    const items = group.items ?? [];
    const urlsWithValue = items.filter((i) => typeof i.url === 'string' && (i.url as string).trim()).map((i) => (i.url as string).trim());

    if (urlsWithValue.length === 0) {
      console.log(`[scrape] Group ${index + 1}: ${productName} — all URLs null, skipping (no site data).`);
      output.groups[index] = { ...input.groups[index], items: [...input.groups[index].items] };
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
      console.log(`[scrape] Wrote ${outPath}.\n`);
      continue;
    }

    const firstUrl = urlsWithValue[0];
    console.log(`[scrape] Group ${index + 1}: ${productName} — scraping ${firstUrl}`);

    let siteData: ScrapedProductData;
    try {
      await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await dismissCookiePopup(page);
      await new Promise((r) => setTimeout(r, 1500));
      siteData = await scrapeElinaProductPage(page);
    } catch (e) {
      console.error(`[scrape] Failed to load or scrape ${firstUrl}:`, e);
      await browser.close();
      process.exit(1);
    }

    if (urlsWithValue.length > 1) {
      const secondUrl = urlsWithValue[1];
      console.log(`[scrape] Group ${index + 1}: checking variant consistency with ${secondUrl}`);
      let secondData: ScrapedProductData;
      const loadAndScrapeSecond = async () => {
        await page.goto(secondUrl, { waitUntil: 'load', timeout: 25000 });
        await dismissCookiePopup(page);
        await new Promise((r) => setTimeout(r, 1500));
        return scrapeElinaProductPage(page);
      };
      try {
        secondData = await loadAndScrapeSecond();
      } catch (e) {
        const isDetached = String((e as Error).message).includes('detached');
        if (isDetached) {
          console.log(`[scrape] Detached frame on second URL, retrying once...`);
          try {
            secondData = await loadAndScrapeSecond();
          } catch (e2) {
            console.error(`[scrape] Failed on retry: ${secondUrl}:`, e2);
            await browser.close();
            process.exit(1);
          }
        } else {
          console.error(`[scrape] Failed to load or scrape second URL ${secondUrl}:`, e);
          await browser.close();
          process.exit(1);
        }
      }
      const norm1 = normalizeSharedContent(siteData);
      const norm2 = normalizeSharedContent(secondData);
      if (norm1 !== norm2) {
        haltVariantMismatch(productName, firstUrl, secondUrl, norm1, norm2);
      }
      console.log(`[scrape] Variant content match OK.`);
    }

    output.groups[index] = { ...input.groups[index], items: [...input.groups[index].items], site: siteData };
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`[scrape] Wrote ${outPath}.\n`);
  }

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
