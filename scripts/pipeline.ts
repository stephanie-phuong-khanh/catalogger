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
  sheetIndex: 0,          // Tab index (0-based). 0 = "Most Popular"
  headerRow: 3,           // 0-indexed row where headers are (row 4 in Excel)
  skuColumn: 'GDINA Item #',
  priceColumn: 'MSRP',

  // Vendor website
  vendorBaseUrl: 'https://goldendesigninc.com',

  // Output
  outputDir: 'data/listings',
};

/**
 * Supplier-specific context injected into the listing prompt.
 * These are patterns learned from this supplier's data and the store owner's preferences.
 * Eventually this would be auto-generated from user-edited example listings.
 */
const SUPPLIER_CONTEXT = `
Title: Always start with "Golden Designs". The supplier uses sub-brands like "Dynamic Saunas" and "Maxxus Saunas" — include the sub-brand as a product line name (e.g. "Golden Designs Dynamic Avila..."), but never start the title with the sub-brand.

Features — supplier-specific patterns:
- Combine the Color field (e.g. "Honey Dark Stain") with the wood type into one bullet.
- For infrared heating panels: include count, EMF level with measurement (e.g. "5-10 mG at 2-3\""), and placement locations (e.g. "rear walls, side walls, and under the bench").
- For electrical requirements: rewrite as "Requires [voltage/amp] Outlet and Non-CAFCI/GFCI Breaker ([recommendation])". This supplier's products require non-CAFCI breakers even though the source data only mentions GFCI.

Overview — this supplier's products:
- Mention health/wellness benefits when applicable (e.g. muscle relaxation, stress relief, improved circulation).
- The supplier's ad-copy often lists suitable room types (basements, master baths, walk-in closets, fitness rooms) — include these when available.
`.trim();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log('=== CATALOGGER PIPELINE ===\n');

  // Step 1: Parse sheet
  console.log('STEP 1: Parsing spreadsheet...');
  const products = parseSheet({
    filePath: CONFIG.sheetFile,
    sheetIndex: CONFIG.sheetIndex,
    headerRow: CONFIG.headerRow,
    skuColumn: CONFIG.skuColumn,
  });

  // Save parsed products for reference
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }
  const parsedPath = path.join(CONFIG.outputDir, '_parsed_products.json');
  fs.writeFileSync(parsedPath, JSON.stringify(products, null, 2));
  console.log(`  Saved parsed products to ${parsedPath}\n`);

  const listings: GeneratedListing[] = [];
  // Step 2: Process each product
  for (const product of products) {
    const sku = product[CONFIG.skuColumn];
    if (!sku) continue;

    if (sku !== 'DYN-6103-01') continue; // TMP for debugging

    console.log(`\n--- Processing ${sku} ---`);

    // Step 2: Search vendor site for this product
    console.log('STEP 2: Searching vendor website...');
    const description = product['Description'] || '';
    const vendorData = await searchVendorSite(
      openai,
      CONFIG.vendorBaseUrl,
      sku,
      description,
    );

    if (vendorData) {
      console.log(`  ✓ Matched: "${vendorData.title}"`);
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
        CONFIG.priceColumn,
        vendorData,
        CONFIG.supplierName,
        SUPPLIER_CONTEXT,
      );
      listings.push(listing);

      // Save individual listing
      const individualPath = path.join(CONFIG.outputDir, `${sku}.json`);
      fs.writeFileSync(individualPath, JSON.stringify(listing, null, 2));
      console.log(`  → Saved ${individualPath}`);
    } catch (err: any) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  // Save all listings
  const allPath = path.join(CONFIG.outputDir, '_all_listings.json');
  fs.writeFileSync(allPath, JSON.stringify(listings, null, 2));
  console.log(`\n=== DONE ===`);
  console.log(`${listings.length}/${products.length} listings generated.`);
  console.log(`All listings saved to ${allPath}`);
}

main();
