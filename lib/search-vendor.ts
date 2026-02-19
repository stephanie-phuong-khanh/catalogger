import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const ProductSelection = z.object({
  selectedProductId: z.number().describe('The Shopify product ID of the best matching product'),
  reasoning: z.string().describe('Brief explanation of why this product was selected'),
});

export interface VendorSiteProduct {
  id: number;
  title: string;
  url: string;
  price: string;
  body: string[];   // Body split into lines, each line is a string
  image: string;     // featured image URL
  handle: string;
}

/**
 * Strip HTML tags to get plain text, preserving block structure as newlines.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|ul|ol)\b[^>]*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Extract the features array from body text by finding a "Features:" section and
 * collecting the following lines until an empty line (section boundary).
 * If no "Features:" heading is found, returns [].
 */
function parseFeaturesFromBody(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const features: string[] = [];
  let inFeatures = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    const featuresMatch = trimmed.match(/^Features\s*:\s*(.*)$/i);
    if (featuresMatch) {
      inFeatures = true;
      const afterColon = featuresMatch[1]!.trim();
      if (afterColon) features.push(afterColon);
      continue;
    }

    if (inFeatures) {
      if (trimmed === '') break; // end of section
      features.push(trimmed);
    }
  }

  return features;
}

/**
 * Search a Shopify vendor site for a product by SKU, then use LLM to pick the best match.
 * Returns the matched product's data (body is plain text with HTML stripped), or null if not found.
 *
 * [HARDCODED] Assumes the vendor site is Shopify (uses /search/suggest.json endpoint).
 */
export async function searchVendorSite(
  openai: OpenAI,
  vendorBaseUrl: string,
  sku: string,
  productDescription: string,
): Promise<VendorSiteProduct | null> {
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

  const rawBody = selected.body || '';
  const body = stripHtml(rawBody);

  return {
    id: selected.id,
    title: selected.title,
    url: `${vendorBaseUrl}${selected.url}`,
    price: selected.price,
    body: body.split(/\r?\n/).map((s) => s.trim()),
    image: selected.image || selected.featured_image?.url || '',
    handle: selected.handle || '',
  };
}

/**
 * Format a vendor product as human-readable text (for prompts or debugging),
 * analogous to formatProductAsPricingSheetText in parse-sheet.
 */
export function formatProductAsVendorSiteText(product: VendorSiteProduct): string {
  const lines: string[] = [];
  lines.push(`Title: ${product.title}`);
  lines.push(`URL: ${product.url}`);
  lines.push(`Price: ${product.price}`);
  lines.push('');
  lines.push('Body:');
  for (const bodySegment of product.body) lines.push(bodySegment);
  return lines.join('\n').trimEnd();
}
