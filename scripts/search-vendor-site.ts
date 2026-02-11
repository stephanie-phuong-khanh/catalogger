import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const VENDOR_BASE_URL = 'https://goldendesigninc.com';
const SEARCH_TERM = 'MX-K306-01';
const PRODUCT_DESCRIPTION = 'Maxxus 3-Person Low EMF (Between 5-10 MG) FAR Infrared Sauna (Canadian Hemlock)'; // Taken from the pricing sheet.

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// [HARDCODED] Assumes that the vendor uses Shopify and has a search endpoint.
// https://shopify.dev/docs/api/usage/search-syntax
const searchUrl = `${VENDOR_BASE_URL}/search/suggest.json?q=${encodeURIComponent(SEARCH_TERM)}&resources[type]=product`;

async function main() {
  // 1. Search the vendor site for the product, assuming Shopify search endpoint.
  console.log(`Searching ${VENDOR_BASE_URL} for "${SEARCH_TERM}"...\n`);
  console.log(`GET ${searchUrl}\n`);

  const searchResponse = await fetch(searchUrl);

  if (!searchResponse.ok) {
    console.error(`Search failed: ${searchResponse.status} ${searchResponse.statusText}`);
    process.exit(1);
  }

  const data = await searchResponse.json();
  const products = data.resources?.results?.products || [];

  if (products.length === 0) {
    console.log('No products found.');
    return;
  }
  console.log(`Found ${products.length} result(s):\n`);
  for (const product of products) {
    console.log(`  Title: ${product.title}`);
    console.log(`  URL w/o base URL: ${product.url}`);
    console.log(`  URL:   ${VENDOR_BASE_URL}${product.url}`);
    console.log(`  Price: ${product.price}`);
    console.log('');
  }

  // 2. Using LLM with structured outputs, select the correct product from search results.
  const ProductSelection = z.object({
    selectedProductId: z.number().describe('The Shopify product ID of the best matching product'),
    reasoning: z.string().describe('Brief explanation of why this product was selected'),
  });

  const productList = products.map((p: any) => `ID: ${p.id} | Title: ${p.title}`).join('\n');

  const selectProductResponse = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are matching a product from a pricing sheet to a vendor website search result. Pick the single best match.',
      },
      {
        role: 'user',
        content: `SKU: ${SEARCH_TERM}\nDescription: ${PRODUCT_DESCRIPTION}\n\nSearch results:\n${productList}`,
      },
    ],
    text: {
      format: zodTextFormat(ProductSelection, 'product_selection'),
    },
  });

  const selection = selectProductResponse.output_parsed;
  if (!selection) {
    console.error('LLM did not return a valid selection.');
    return;
  }

  console.log(`Selected product ID: ${selection.selectedProductId}`);
  console.log(`Reasoning: ${selection.reasoning}\n`);

  // 3. Get the product details. For now, we'll use the data returned from the search results.
  // However, there is a deeper /products/{handle}.json endpoint that returns the complete Shopify proudct object including all images and all variants.
  const selectedProduct = products.find((p: any) => p.id === selection.selectedProductId);
  if (selectedProduct) {
    console.log('SELECTED PRODUCT:', selectedProduct);
  }

  return selectedProduct;
}

main();
