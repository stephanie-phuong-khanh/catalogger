import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const VendorBodySeparationSchema = z.object({
  featuresRelevant: z.string().describe('Lines suitable for customer-facing feature bullets. Exclude section headers like "Features:", "Model: [SKU]", and "DISCLAIMER:..."'),
  specsRelevant: z.string().describe('Lines that are dimensions or weights only, for the specs table. Exclude everything else.'),
});

const ProductSelection = z.object({
  selectedProductId: z.number().describe('The Shopify product ID of the best matching product'),
  reasoning: z.string().describe('Brief explanation of why this product was selected'),
});

/** Normalize for SKU-in-parens comparison: spaces and hyphens treated as equivalent (e.g. "MX-K406-01 CED" ↔ "MX-K406-01-CED"). */
function normalizeSkuForParensMatch(s: string): string {
  return String(s).trim().replace(/[\s-]+/g, '-').replace(/-+/g, '-').toUpperCase();
}

/**
 * True iff title has a parenthesized segment whose content equals the SKU exactly (after normalization).
 * So "(DYN-6202-03)" matches "DYN-6202-03", but "(DYN-6202-03 Elite)" does not—the ( ) must contain only the SKU.
 */
function titleHasExactSkuInParens(title: string, sku: string): boolean {
  const exactSku = String(sku).trim();
  if (!exactSku) return false;
  const normalizedSku = normalizeSkuForParensMatch(exactSku);
  const parenBlocks = title.match(/\([^)]+\)/g) || [];
  return parenBlocks.some((block) => {
    const inner = block.slice(1, -1).trim(); // content between ( and )
    return normalizeSkuForParensMatch(inner) === normalizedSku;
  });
}

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

const LLM_FALLBACK_WARNING = `
  ⚠️  WARNING: VENDOR SELECTED SUBJECTIVELY (LLM FALLBACK)  ⚠️
  No product had exact SKU in parentheses. An LLM picked a "best match" — please verify manually!
  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️  ⚠️
`;

/**
 * Search a Shopify vendor site for a product by SKU.
 * 1) Prefer exact match: title contains the EXACT SKU inside parentheses.
 * 2) Fallback: if none, use LLM to pick best match and log a big warning that it was subjective.
 *
 * [HARDCODED] Assumes the vendor site is Shopify (uses /search/suggest.json endpoint).
 */
export async function searchVendorSite(
  openai: OpenAI,
  vendorBaseUrl: string,
  sku: string,
  productDescription: string,
): Promise<VendorSiteProduct | null> {
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

  // 1) Prefer: exact SKU inside parentheses (golden design convention).
  const exactMatches = products.filter((p: any) => titleHasExactSkuInParens(p.title || '', sku));

  let selected: any;

  if (exactMatches.length > 0) {
    if (exactMatches.length > 1) {
      console.log(`  Multiple products have exact SKU in parens; using first: "${exactMatches[0]?.title}".`);
    }
    selected = exactMatches[0];
  } else {
    // 2) Fallback: LLM pick — and warn loudly that it's subjective.
    console.warn(LLM_FALLBACK_WARNING);
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

/**
 * Use the LLM to separate the full vendor body into features-relevant vs specs-relevant text.
 * Prompt-tunable: instruct the model to ignore "Features:", "Model: [SKU]", "DISCLAIMER:...", etc.
 */
export async function separateVendorBodyWithLLM(
  openai: OpenAI,
  vendor: VendorSiteProduct,
): Promise<{ featuresRelevant: string; specsRelevant: string }> {
  if (!vendor.body?.length) {
    return { featuresRelevant: '', specsRelevant: '' };
  }
  const fullBody = vendor.body.join('\n');
  const prompt = `You are separating product copy into two buckets.

VENDOR BODY (one line per item):
---
${fullBody}
---

Rules:
- featuresRelevant: Include only lines that are suitable for customer-facing feature bullets (capacity, materials, heating, glass, lighting, electrical, temperature, assembly, shipping/delivery, warranty, etc.). Output as a single block of text, one line per bullet.
- specsRelevant: Include only lines that are purely dimensions or weights (e.g. "Exterior Dimensions: ...", "Shipping weight: ..."). Output as a single block of text, one line per bullet.
- EXCLUDE from both buckets: section headers (e.g. "Features:"; "Model: [SKU]")
- EXCLUDE from both buckets: "DISCLAIMER:..." and any legal/color-accuracy boilerplate.
- Other than these excluded lines, keep every line that is relevant to the product features.
- Preserve the exact wording of included lines. Do not add commentary.`;

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(VendorBodySeparationSchema, 'vendor_body_separation') },
  });
  const out = response.output_parsed;
  return {
    featuresRelevant: out?.featuresRelevant?.trim() ?? '',
    specsRelevant: out?.specsRelevant?.trim() ?? '',
  };
}
