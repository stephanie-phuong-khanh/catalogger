import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const ProductSelection = z.object({
  selectedProductId: z.number().describe('The Shopify product ID of the best matching product'),
  reasoning: z.string().describe('Brief explanation of why this product was selected'),
});

export interface VendorProduct {
  id: number;
  title: string;
  url: string;
  price: string;
  body: string;       // HTML description from the vendor site
  image: string;       // featured image URL
  handle: string;
}

/**
 * Search a Shopify vendor site for a product by SKU, then use LLM to pick the best match.
 * Returns the matched product's data (including the body HTML), or null if not found.
 *
 * [HARDCODED] Assumes the vendor site is Shopify (uses /search/suggest.json endpoint).
 */
export async function searchVendorSite(
  openai: OpenAI,
  vendorBaseUrl: string,
  sku: string,
  productDescription: string,
): Promise<VendorProduct | null> {
  // 1. Search the vendor site
  const searchUrl = `${vendorBaseUrl}/search/suggest.json?q=${encodeURIComponent(sku)}&resources[type]=product`;
  console.log(`  Searching vendor site for "${sku}"...`);

  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) {
    console.error(`  Search failed: ${searchResponse.status} ${searchResponse.statusText}`);
    return null;
  }

  const data = await searchResponse.json();
  const products = data.resources?.results?.products || [];

  if (products.length === 0) {
    console.log(`  No results found on vendor site.`);
    return null;
  }

  console.log(`  Found ${products.length} result(s) on vendor site.`);

  // 2. If only one result, use it directly. Otherwise, LLM selects.
  let selected: any;

  if (products.length === 1) {
    selected = products[0];
  } else {
    const productList = products.map((p: any) => `ID: ${p.id} | Title: ${p.title}`).join('\n');

    const response = await openai.responses.parse({
      model: 'gpt-4o',
      temperature: 0,
      input: [
        {
          role: 'system',
          content: 'You are matching a product from a pricing sheet to a vendor website search result. Pick the single best match.',
        },
        {
          role: 'user',
          content: `SKU: ${sku}\nDescription: ${productDescription}\n\nSearch results:\n${productList}`,
        },
      ],
      text: {
        format: zodTextFormat(ProductSelection, 'product_selection'),
      },
    });

    const selection = response.output_parsed;
    if (!selection) {
      console.error(`  LLM did not return a valid selection.`);
      return null;
    }

    console.log(`  LLM selected: ${selection.reasoning}`);
    selected = products.find((p: any) => p.id === selection.selectedProductId);

    if (!selected) {
      console.error(`  LLM selected ID ${selection.selectedProductId} but it wasn't in the results.`);
      return null;
    }
  }

  return {
    id: selected.id,
    title: selected.title,
    url: `${vendorBaseUrl}${selected.url}`,
    price: selected.price,
    body: selected.body || '',
    image: selected.image || selected.featured_image?.url || '',
    handle: selected.handle || '',
  };
}
