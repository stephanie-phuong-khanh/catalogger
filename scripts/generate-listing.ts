/**
 * Entry point: generate a listing from sheet data only (no vendor site lookup).
 * All prompt and LLM logic lives in lib/generate-listing.ts.
 *
 * Run scripts/parse-sheet.ts first to produce the products JSON.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { RawProduct } from '../lib/parse-sheet';
import { generateListing, createIncompleteListing, GeneratedListing, IncompleteListing } from '../lib/generate-listing';
import { isPricingDataIncomplete } from '../lib/pricing-sheet-groups';

dotenv.config();

const CONFIG = {
  productsFile: 'data/parsed_products.json',
  outputDir: 'data/listings_sheet_data_only',
  skuColumn: 'GDINA Item #',
  /** Set to a specific SKU to run one product, or null to run all. */
  singleSku: 'MX-K306-01' as string | null,
};

async function main() {
  const productsPath = path.resolve(CONFIG.productsFile);
  if (!fs.existsSync(productsPath)) {
    console.error(`Products file not found: ${productsPath}`);
    console.error('Run "npx ts-node scripts/parse-sheet.ts" first.');
    process.exit(1);
  }

  const products: RawProduct[] = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const toProcess = CONFIG.singleSku
    ? products.filter((p) => p[CONFIG.skuColumn] === CONFIG.singleSku)
    : products;

  if (toProcess.length === 0) {
    console.error(`No products to process (singleSku: ${CONFIG.singleSku ?? 'all'}).`);
    process.exit(1);
  }

  console.log(`Generating listings for ${toProcess.length} product(s)...\n`);

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const listings: (GeneratedListing | IncompleteListing)[] = [];

  for (const product of toProcess) {
    const sku = product[CONFIG.skuColumn];
    console.log(`--- ${sku} ---`);
    if (isPricingDataIncomplete(product as Record<string, unknown>)) {
      console.log('  Incomplete pricing data — skipping generation.');
      const listing = createIncompleteListing(sku, product, null);
      listings.push(listing);
      const outPath = path.join(CONFIG.outputDir, `${sku}.json`);
      fs.writeFileSync(outPath, JSON.stringify(listing, null, 2));
      console.log(`  → Saved ${outPath} (incomplete)\n`);
      continue;
    }
    try {
      const listing = await generateListing(
        openai,
        product,
        CONFIG.skuColumn,
        null, // no vendor data
      );
      listings.push(listing);

      const outPath = path.join(CONFIG.outputDir, `${sku}.json`);
      fs.writeFileSync(outPath, JSON.stringify(listing, null, 2));
      console.log(`  → Saved ${outPath}\n`);
    } catch (err: any) {
      console.error(`  ✗ ${err.message}\n`);
    }
  }

  const allPath = path.join(CONFIG.outputDir, '_all_listings.json');
  fs.writeFileSync(allPath, JSON.stringify(listings, null, 2));
  console.log(`Done. ${listings.length}/${toProcess.length} listings saved to ${CONFIG.outputDir}`);
}

main();
