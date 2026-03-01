/**
 * For Elina Pilates, we're in the final step of the pipeline, which we run in stages:
 * 1. parse-pdf-pricing-sheet: Parse the pricing sheet, which is a PDF. This outputs data/elina/elina_pilates_pricing_sheet.json.
 * 2. resolve-elina-urls: Resolve the URLs for the products. This outputs data/elina/elina_pilates_products_urls.json. This step involved resolving the URLs for the products using Puppeteer.
 * 3. scrape-elina-site: For the URL for each SKU, scrape the vendor site and save the data to data/elina/elina_pilates_products_site.json. This step involved scraping the vendor site for the products using Puppeteer.
 * 4. map-sku-to-images: Map the SKUs to the image folders that are on the local machine. This outputs data/elina/elina_sku_to_images.json. This was an assisted step that was done manually by running this script.
 * 5. Finally, here we generate the listings from data saved from the previous steps.
 *
 * Input: data/elina/elina_pilates_products_site.json.
 * Output: data/listings/elina_pilates/{PRODUCT_GROUP_FOLDER}/{SKU}.json.
 *
 * Usage:
 *   npm run generate-listings-elina
 *   npm run generate-listings-elina -- --single 100002   # generate only for this SKU (article_ref)
 *   npm run generate-listings-elina -- --print-only     # print the listings to the console, no file write
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { ElinaGeneratedListing } from '../../types/listings/elina-listing';

dotenv.config();

const CONFIG = {
  inputFile: 'data/elina/elina_pilates_products_site.json',
  outputDir: 'data/listings/elina_pilates',
};

/** Normalize product group name for use as a folder name: trim, replace / with -, collapse spaces. */
function productGroupToFolder(productName: string): string {
  return productName
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(): { singleSku: string | null; printOnly: boolean } {
  const args = process.argv.slice(2);
  const singleIdx = args.indexOf('--single');
  const singleSku =
    singleIdx !== -1 && args[singleIdx + 1] ? args[singleIdx + 1].trim() : null;
  const printOnly = args.includes('--print-only');
  return { singleSku, printOnly };
}

/** Build a placeholder listing for one item (Part A: skeleton; content filled in later steps). */
function buildPlaceholderListing(
  articleRef: string,
  productName: string,
  color: string | null,
  vendorPageUrl: string | null,
): ElinaGeneratedListing {
  return {
    sku: articleRef,
    title: '',
    overviewParagraph: '',
    features: [],
    inclusions: [],
    specifications: {
      tableTitle: '',
      columns: [],
      rows: [],
    },
    vendorPageUrl: vendorPageUrl ?? null,
    _source: {
      product_name: productName,
      article_ref: articleRef,
      color: color ?? undefined,
    },
  };
}

async function main() {
  const { singleSku, printOnly } = parseArgs();

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
    const folderName = productGroupToFolder(productName);
    const items = group.items ?? [];

    for (const item of items) {
      const articleRef = item.article_ref;
      if (!articleRef) continue;

      if (singleSku != null && String(articleRef) !== singleSku) continue;

      const color = item.color != null ? String(item.color).trim() || null : null;
      const url = item.url != null ? String(item.url).trim() || null : null;

      const listing = buildPlaceholderListing(
        String(articleRef),
        productName,
        color,
        url,
      );

      if (printOnly) {
        console.log(JSON.stringify(listing, null, 2));
        count += 1;
        continue;
      }

      const groupDir = path.join(outputDir, folderName);
      if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir, { recursive: true });
      }
      const outPath = path.join(groupDir, `${articleRef}.json`);
      fs.writeFileSync(outPath, JSON.stringify(listing, null, 2), 'utf-8');
      console.log(`  → ${path.relative(process.cwd(), outPath)}`);
      count += 1;
    }
  }

  console.log(`\nDone. ${count} listing(s) ${printOnly ? 'printed' : 'written'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
