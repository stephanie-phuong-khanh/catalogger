/**
 * Entry point: search a Shopify vendor site for one product by SKU.
 * All search logic lives in lib/listings/search-vendor.ts.
 *
 * Usage:
 *   npm run search-vendor              # search full sheet
 *   npm run search-vendor -- --json     # output only JSON
 */
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { searchVendorSite, formatProductAsVendorSiteText } from '../../lib/listings/search-vendor';

dotenv.config();

const CONFIG = {
  vendorBaseUrl: 'https://goldendesigninc.com',
  sku: 'DYN-1101-01 Elite',
  productDescription: 'Dynamic 1 Person (Compact) Ultra Low EMF (Between 3-5MG) FAR Infrared Sauna (Pacific Cedar)',
};

async function main() {
  const printOnlyJson = process.argv.includes('--json');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`Searching ${CONFIG.vendorBaseUrl} for "${CONFIG.sku}"...\n`);

  const result = await searchVendorSite(
    openai,
    CONFIG.vendorBaseUrl,
    CONFIG.sku,
    CONFIG.productDescription,
  );

  if (result) {
    if (printOnlyJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatProductAsVendorSiteText(result));
  } else {
    console.log('\nNo match found.');
  }
}

main();
