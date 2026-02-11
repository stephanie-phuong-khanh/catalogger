/**
 * Entry point: search a Shopify vendor site for one product by SKU.
 * All search and LLM selection logic lives in lib/search-vendor.ts.
 */
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { searchVendorSite } from '../lib/search-vendor';

dotenv.config();

const CONFIG = {
  vendorBaseUrl: 'https://goldendesigninc.com',
  sku: 'MX-K306-01',
  productDescription: 'Maxxus 3-Person Low EMF (Between 5-10 MG) FAR Infrared Sauna (Canadian Hemlock)',
};

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`Searching ${CONFIG.vendorBaseUrl} for "${CONFIG.sku}"...\n`);

  const result = await searchVendorSite(
    openai,
    CONFIG.vendorBaseUrl,
    CONFIG.sku,
    CONFIG.productDescription,
  );

  if (result) {
    console.log('\nMatched product:');
    console.log(`  Title: ${result.title}`);
    console.log(`  URL:   ${result.url}`);
    console.log(`  Price: ${result.price}`);
    console.log(`  Body length: ${result.body?.length ?? 0} chars`);
  } else {
    console.log('\nNo match found.');
  }
}

main();
