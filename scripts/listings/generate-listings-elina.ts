/**
 * For Elina Pilates, we're in the final step of the pipeline, which we run in stages:
 * 1. parse-pdf-pricing-sheet: Parse the pricing sheet, which is a PDF. This outputs data/elina/elina_pilates_pricing_sheet.json.
 * 2. resolve-elina-urls: Resolve the URLs for the products. This outputs data/elina/elina_pilates_products_urls.json. This step involved resolving the URLs for the products using Puppeteer.
 * 3. scrape-elina-site: For the URL for each SKU, scrape the vendor site and save the data to data/elina/elina_pilates_products_site.json. This step involved scraping the vendor site for the products using Puppeteer.
 * 4. map-sku-to-images: Map the SKUs to the image folders that are on the local machine. This outputs data/elina/elina_sku_to_images.json. This was an assisted step that was done manually by running this script.
 * 5. Finally, here we generate the listings from data saved from the previous steps.
 *
 * Input: data/elina/elina_pilates_products_site.json.
 * Output: data/listings/elina_pilates/{ProductGroupSlug}.json (one file per product group; each file has variants[] for each SKU).
 *
 * Usage:
 *   npm run generate-listings-elina
 *   npm run generate-listings-elina -- --single "Reformer Elite"   # generate only this product group (by name)
 *   npm run generate-listings-elina -- --print-only     # print the listings to the console, no file write
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type {
  ElinaGeneratedListing,
  ElinaVariant,
  ElinaListingSource,
} from '../../types/listings/elina-listing';

dotenv.config();

const CONFIG = {
  inputFile: 'data/elina/elina_pilates_products_site.json',
  outputDir: 'data/listings/elina_pilates',
};

/** Normalize product group name for use as a filename slug: trim, replace / with -, collapse spaces to single dash. */
function productGroupToSlug(productName: string): string {
  return productName
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function parseArgs(): { singleProductName: string | null; printOnly: boolean } {
  const args = process.argv.slice(2);
  const singleIdx = args.indexOf('--single');
  const singleProductName =
    singleIdx !== -1 && args[singleIdx + 1] ? args[singleIdx + 1].trim() : null;
  const printOnly = args.includes('--print-only');
  return { singleProductName, printOnly };
}

function normalizeYouTubeUrl(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  // Convert embed URLs to watch URLs (keep id, drop extra params).
  const embedMatch = s.match(/youtube\.com\/embed\/([^?&#/]+)/i);
  if (embedMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${embedMatch[1]}`;
  }

  // Normalize youtu.be short links to watch.
  const shortMatch = s.match(/youtu\.be\/([^?&#/]+)/i);
  if (shortMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
  }

  return s;
}

function collectYouTubeUrls(site: unknown): string[] {
  const urls: string[] = [];
  if (!site || typeof site !== 'object') return urls;

  const siteObj = site as {
    videos?: unknown;
    tabs?: Array<{ id?: unknown; title?: unknown; content?: unknown; videos?: unknown }>;
  };

  const pushAll = (v: unknown) => {
    if (!Array.isArray(v)) return;
    for (const x of v) {
      const u = normalizeYouTubeUrl(String(x ?? ''));
      if (u) urls.push(u);
    }
  };

  pushAll(siteObj.videos);
  for (const tab of siteObj.tabs ?? []) pushAll(tab?.videos);

  // Dedupe, preserve order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function extractInclusionsFromDescription(site: unknown): string[] {
  if (!site || typeof site !== 'object') return [];

  const tabs = (site as { tabs?: unknown }).tabs;
  if (!Array.isArray(tabs)) return [];

  const descTab = tabs.find((t) => {
    if (!t || typeof t !== 'object') return false;
    const id = String((t as { id?: unknown }).id ?? '').trim().toLowerCase();
    const title = String((t as { title?: unknown }).title ?? '').trim().toLowerCase();
    return id === 'description' || title === 'description';
  }) as { content?: unknown } | undefined;

  const content = descTab?.content;
  if (typeof content !== 'string' || content.trim() === '') return [];

  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inIncludes = false;

  const isHeader = (line: string): boolean => {
    const s = line.trim();
    if (!s) return false;
    // Common section headers on Elina pages (often all-caps, sometimes markdown ###).
    return /^(#{1,6}\s*)?(FEATURES|INCLUDES|COLORS|DIMENSIONS|WARRANTY|SHIPPING|ASSEMBLY|VIDEOS|REVIEWS)\b/i.test(
      s,
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inIncludes) {
      if (/^(#{1,6}\s*)?INCLUDES\b/i.test(line)) {
        inIncludes = true;
      }
      continue;
    }

    if (line === '') continue;
    // Stop when next section starts (but ignore the INCLUDES header itself, which we already consumed).
    if (isHeader(line) && !/^(#{1,6}\s*)?INCLUDES\b/i.test(line)) break;

    // Bullets are usually "- ..."; keep content as-is otherwise.
    const bulletMatch = line.match(/^[-•*]\s+(.*)$/);
    const text = (bulletMatch?.[1] ?? line).trim();
    if (!text) continue;
    out.push(text);
  }

  // Dedupe, preserve order.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const x of out) {
    if (seen.has(x)) continue;
    seen.add(x);
    deduped.push(x);
  }
  return deduped;
}

/** Build a placeholder listing for one product group (Part A: skeleton; content filled in later steps). */
function buildPlaceholderListingForGroup(
  productName: string,
  site: unknown,
  items: Array<{
    article_ref: string;
    description_raw?: string;
    price_usd?: number;
    barcode?: string;
    color?: string | null;
    url?: string | null;
  }>,
): ElinaGeneratedListing {
  const variants: ElinaVariant[] = items.map((item) => {
    const source: ElinaListingSource = {
      articleRef: String(item.article_ref),
      description: item.description_raw ?? '',
      priceUsd: typeof item.price_usd === 'number' ? item.price_usd : 0,
      barcode: item.barcode != null ? String(item.barcode) : '',
    };
    return {
      sku: String(item.article_ref),
      vendorPageUrl: item.url != null ? String(item.url).trim() || null : null,
      googleDriveUrls: [],
      _source: source,
    };
  });

  return {
    productName,
    title: '',
    overviewParagraph: '',
    features: [],
    inclusions: extractInclusionsFromDescription(site),
    specifications: {
      tableTitle: '',
      columns: [],
      rows: [],
    },
    youtubeUrls: collectYouTubeUrls(site),
    variants,
  };
}

async function main() {
  const { singleProductName, printOnly } = parseArgs();

  const inputPath = path.isAbsolute(CONFIG.inputFile)
    ? CONFIG.inputFile
    : path.join(process.cwd(), CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const groups = data.groups ?? [];

  const outputDir = path.join(process.cwd(), CONFIG.outputDir);
  if (!printOnly && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let count = 0;
  for (const group of groups) {
    const productName = group.product_name ?? 'Unknown';
    const site = group.site ?? null;
    const items = group.items ?? [];

    if (singleProductName != null) {
      const nameMatch =
        productName.trim().toLowerCase() ===
        singleProductName.trim().toLowerCase();
      if (!nameMatch) continue;
    }

    const listing = buildPlaceholderListingForGroup(productName, site, items);

    if (printOnly) {
      console.log(JSON.stringify(listing, null, 2));
      count += 1;
      continue;
    }

    const slug = productGroupToSlug(productName);
    const outPath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(listing, null, 2), 'utf-8');
    console.log(`  → ${path.relative(process.cwd(), outPath)} (${items.length} variant(s))`);
    count += 1;
  }

  console.log(`\nDone. ${count} listing(s) ${printOnly ? 'printed' : 'written'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
