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

/** Build a placeholder listing for one product group (Part A: skeleton; content filled in later steps). */
function buildPlaceholderListingForGroup(
  productName: string,
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
      color: item.color != null ? String(item.color).trim() || null : null,
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
    inclusions: [],
    specifications: {
      tableTitle: '',
      columns: [],
      rows: [],
    },
    youtubeUrls: [],
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
    const items = group.items ?? [];

    if (singleProductName != null) {
      const nameMatch =
        productName.trim().toLowerCase() ===
        singleProductName.trim().toLowerCase();
      if (!nameMatch) continue;
    }

    const listing = buildPlaceholderListingForGroup(productName, items);

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
