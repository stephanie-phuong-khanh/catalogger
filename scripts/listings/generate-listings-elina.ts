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
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type {
  ElinaListing,
  ElinaListingFull,
  ElinaListingStub,
  ElinaVariant,
  ElinaListingSource,
} from '../../types/listings/elina-listing';

dotenv.config();

const TitleOutput = z.object({
  title: z.string().describe('The generated product title only, with no preamble or explanation'),
});

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

const ELINA_PREFIX = 'Elina Pilates ';

/**
 * Format vendor site product name for title: strip ™®©, title-case words, collapse spaces.
 * Returns only the product part (no "Elina Pilates " prefix).
 */
function formatTitleFromSiteName(siteProductName: string): string {
  let s = String(siteProductName ?? '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return s;
  s = s
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return s;
}

/**
 * LLM fallback when no vendor site: fix awkward word order from pricing sheet and normalize casing.
 * Returns only the product part (no "Elina Pilates " prefix).
 */
async function generateTitleFromPricingSheet(
  openai: OpenAI,
  productNameFromGroup: string,
): Promise<string> {
  const prompt = `You are writing the product name part of a listing title for an eCommerce store (Pilates equipment and accessories).
  The product name from the pricing sheet is: "${productNameFromGroup.trim()}"
  This wording may be awkward or in an unnatural order. Output a clear product title with words in a natural, customer-friendly order and proper capitalization (first letter of each word capitalized).
  Output ONLY the product name part. Do not include "Elina Pilates" or any prefix. Do not include SKU, quotation marks, or extra explanation.
  Example: "Physio Reformer Master Instructor" → "Master Instructor Physio Reformer"
  `;

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(TitleOutput, 'title_output') },
  });
  const productPart = response.output_parsed?.title?.trim() ?? productNameFromGroup.trim();
  return productPart;
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
    let text = (bulletMatch?.[1] ?? line).trim();
    if (!text) continue;
    if (text.endsWith('.')) text = text.slice(0, -1);
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

type ItemInput = {
  article_ref: string;
  description_raw?: string;
  price_usd?: number;
  barcode?: string;
  url?: string | null;
};

function buildVariantsFromItems(items: ItemInput[]): ElinaVariant[] {
  return items.map((item) => {
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
}

/** Stub when no vendor site; no generated content. */
function buildStubListing(productName: string, items: ItemInput[]): ElinaListingStub {
  return {
    status: 'vendor_site_unavailable',
    productName,
    variants: buildVariantsFromItems(items),
  };
}

/** Full listing when vendor site exists; placeholder content filled in later steps. */
function buildFullListingPlaceholder(
  productName: string,
  site: unknown,
  items: ItemInput[],
): ElinaListingFull {
  const variants = buildVariantsFromItems(items);
  return {
    status: 'full',
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

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

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

    let listing: ElinaListing;

    if (!site) {
      listing = buildStubListing(productName, items);
    } else {
      listing = buildFullListingPlaceholder(productName, site, items);
      const siteProductName =
        typeof site === 'object' && (site as { product_name?: string }).product_name
          ? String((site as { product_name: string }).product_name).trim()
          : null;

      if (siteProductName) {
        listing.title = ELINA_PREFIX + formatTitleFromSiteName(siteProductName);
      } else if (openai) {
        listing.title =
          ELINA_PREFIX + (await generateTitleFromPricingSheet(openai, productName));
      } else {
        listing.title = ELINA_PREFIX + productName;
      }
    }

    if (printOnly) {
      console.log(JSON.stringify(listing, null, 2));
      count += 1;
      continue;
    }

    const slug = productGroupToSlug(productName);
    const outPath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(listing, null, 2), 'utf-8');
    const label =
      listing.status === 'vendor_site_unavailable'
        ? 'stub (no vendor site)'
        : `${items.length} variant(s)`;
    console.log(`  → ${path.relative(process.cwd(), outPath)} (${label})`);
    count += 1;
  }

  console.log(`\nDone. ${count} listing(s) ${printOnly ? 'printed' : 'written'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
