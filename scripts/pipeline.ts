/**
 * Entry point: run the full pipeline (parse sheet, search vendor, generate listing).
 * All logic lives in lib/parse-sheet.ts, lib/search-vendor.ts, and lib/generate-listing.ts.
 *
 * Usage:
 *   npm run pipeline              # run full pipeline
 *   npm run pipeline -- --single DYN-6103-01   # run only this SKU
 *   npm run pipeline -- --print-only            # log to console only (no file write)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { parseSheet } from '../lib/parse-sheet';
import { searchVendorSite } from '../lib/search-vendor';
import { generateListing, GeneratedListing } from '../lib/generate-listing';

dotenv.config();

// [HARDCODED] All vendor-specific configuration lives here.
const CONFIG = {
  supplierName: 'Golden Designs',
  sheetFile: 'data/2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx',
  sheetIndex: 10,           // Tab index (0-based). 10 = "Tab 11 - DCT Chillers"
  headerRow: 2,           // 0-indexed row where headers are (row 5 in Excel)
  skuColumn: 'GDINA Item #',
  // Vendor website
  vendorBaseUrl: 'https://goldendesigninc.com',
  // Output
  outputDir: 'data/listings/tab_11_dct_chillers',
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const printOnly = process.argv.includes('--print-only');
  console.log('=== CATALOGGER PIPELINE ===\n');
  const listings: GeneratedListing[] = [];

  // Step 1: Parse sheet
  console.log('STEP 1: Parsing spreadsheet...');
  const products = parseSheet({
    filePath: CONFIG.sheetFile,
    sheetIndex: CONFIG.sheetIndex,
    headerRow: CONFIG.headerRow,
    skuColumn: CONFIG.skuColumn,
  });

  // Optional: process only one SKU (e.g. npm run pipeline -- --single DYN-6103-01)
  const onlySku = (() => {
    const i = process.argv.indexOf('--single');
    if (i === -1) return undefined;
    return process.argv[i + 1]?.trim();
  })();
  if (onlySku) {
    console.log(`  Only processing SKU: ${onlySku}\n`);
  }

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  // Process each product
  for (const product of products) {
    const sku = product[CONFIG.skuColumn];
    if (!sku) continue;
    if (onlySku && sku !== onlySku) continue;

    console.log(`\n--- Processing ${sku} ---`);

    // Step 2: Search vendor site for this product
    console.log('STEP 2: Searching vendor website...');
    const description = product['Description'] || '';
    const vendorSiteData = await searchVendorSite(
      openai,
      CONFIG.vendorBaseUrl,
      sku,
      description,
    );

    if (vendorSiteData) {
      console.log(`  ✓ Matched: "${vendorSiteData.title}"`);
    } else {
      console.log(`  ✗ No vendor match found (will generate from sheet data only)`);
    }

    // Step 3: Generate listing with both sources
    console.log('STEP 3: Generating listing...');
    try {
      const listing = await generateListing(
        openai,
        product,
        CONFIG.skuColumn,
        vendorSiteData,
        CONFIG.supplierName,
      );
      listings.push(listing);

      // Save individual listing
      if (printOnly) {
        console.log(JSON.stringify(listing, null, 2));
        continue;
      }
      const individualPath = path.join(CONFIG.outputDir, `${sku}.json`);
      fs.writeFileSync(individualPath, JSON.stringify(listing, null, 2));
      console.log(`  → Saved ${individualPath}`);
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  // Save all listings
  if (!printOnly) {
    const allPath = path.join(CONFIG.outputDir, '_all_listings.json');
    fs.writeFileSync(allPath, JSON.stringify(listings, null, 2));
    console.log(`\n=== DONE ===`);
    console.log(`${listings.length}/${products.length} listings generated.`);
    console.log(`All listings saved to ${allPath}`);
  }
}

main();
