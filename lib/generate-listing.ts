import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { RawProduct } from './parse-sheet';
import { VendorProduct } from './search-vendor';

// --- Zod schema for structured LLM output ---
const ListingOutput = z.object({
  title: z.string().describe('Product title: manufacturer brand + product line + key differentiator + material'),
  features: z.array(z.string()).describe('Thorough customer-facing bullet points. Keep ALL distinct details from sources.'),
  overviewParagraph: z.string().describe('3-5 sentence product description with specific details and benefits'),
  specifications: z.array(
    z.object({
      key: z.string().describe('Human-readable spec name'),
      value: z.string().describe('The spec value'),
    })
  ).describe('Key-value pairs for a specs table'),
});

export interface GeneratedListing {
  sku: string;
  price: number;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: { key: string; value: string }[];
  vendorPageUrl: string | null;
  _raw: RawProduct;
  _vendorData: VendorProduct | null;
}

/**
 * Strip HTML tags to get plain text, preserving block structure as newlines.
 */
function stripHtml(html: string): string {
  return html
    // Preserve structure: block elements and list items become newlines
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|ul|ol)\b[^>]*\/?>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]*>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse runs of spaces (but preserve newlines)
    .replace(/[ \t]+/g, ' ')
    // Collapse multiple blank lines into one
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Build the LLM prompt with sheet data and optional vendor website data.
 */
function buildPrompt(product: RawProduct, vendorData: VendorProduct | null): string {
  const dataLines = Object.entries(product)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  let vendorSection = '';
  if (vendorData && vendorData.body) {
    const vendorText = stripHtml(vendorData.body);
    vendorSection = `

---

**Additional information from the vendor's website (${vendorData.title}):**

${vendorText}
`;
  }

  return `You are writing a product listing for a Shopify eCommerce store (Dansons Medical).

Below is ALL the raw data we have for one product, copied from a supplier pricing sheet. The column names are exactly as they appear in the spreadsheet. Some fields are customer-facing (features, descriptions). Some are internal (dealer cost, shipping logistics). Use your judgment to determine what's relevant for a customer-facing listing.
${vendorSection}
Cross-reference both sources. The vendor website may have additional details not in the spreadsheet. Include the most complete and accurate information from either source. If there are conflicts, prefer the spreadsheet data (it's the pricing source of truth).

IMPORTANT — the store owner wants THOROUGH listings. Every distinct detail matters. Do NOT condense or summarize — be comprehensive.

Generate the following for this product:

1. "title": A clean product title for the Shopify listing. Include the manufacturer/parent brand name, product line or model name, and the most important differentiators (e.g. capacity, size, key technology, or material — whatever is relevant for this product type).

2. "features": Thorough, customer-facing bullet points. This is the MOST IMPORTANT section.
   RULES:
   - Include EVERY distinct feature, capability, and detail from both sources. More bullets is better than fewer.
   - Keep specific numbers and details as they appear in the source (e.g. counts, placements, measurements). Do NOT generalize specifics into vague statements.
   - Keep safety warnings VERBATIM.
   - Include warranty information as a bullet.
   - Include delivery/shipping info as the LAST bullet.
   - De-duplicate: if the same fact appears in both sources, include it once. But do NOT merge two different facts into one vague bullet.

3. "overviewParagraph": A single paragraph (3-5 sentences) describing the product in a professional, warm tone. Be SPECIFIC — reference the product's standout features and benefits by name, based on what's in the data. Do NOT write generic filler. Do NOT mention pricing. Write for a customer who is browsing and comparing products.

4. "specifications": Key-value pairs for a specs table. Include only QUANTITATIVE or CATEGORICAL facts: dimensions, weights, capacities, electrical requirements, materials, warranty, and similar measurable data. Do NOT repeat qualitative features here (e.g. if "Bluetooth speakers" is already a feature bullet, don't add a "Sound System" spec). The specs table should complement the features, not duplicate them. Use clean, human-readable keys. Exclude internal data (dealer cost, ship zip, process time).

---

**Raw Product Data (from pricing sheet):**

${dataLines}
`;
}

/**
 * Generate a listing for one product using sheet data + optional vendor website data.
 */
export async function generateListing(
  openai: OpenAI,
  product: RawProduct,
  skuColumn: string,
  priceColumn: string,
  vendorData: VendorProduct | null,
): Promise<GeneratedListing> {
  const sku = product[skuColumn];
  const price = product[priceColumn];

  if (!sku) {
    throw new Error(`No SKU found in column "${skuColumn}"`);
  }

  const prompt = buildPrompt(product, vendorData);

  console.log(`  Generating listing with LLM...`);

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a thorough eCommerce copywriter for a medical/wellness equipment distributor. You never drop details — every feature, spec, and safety note from the source data must appear in the listing. Comprehensiveness is more important than brevity.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    text: {
      format: zodTextFormat(ListingOutput, 'listing_output'),
    },
  });

  const generated = response.output_parsed;
  if (!generated) throw new Error(`Empty response for ${sku}`);

  console.log(`  ✓ "${generated.title}"`);
  console.log(`  ✓ ${generated.features.length} features, ${generated.specifications.length} specs`);

  return {
    sku,
    price,
    title: generated.title,
    features: generated.features,
    overviewParagraph: generated.overviewParagraph,
    specifications: generated.specifications,
    vendorPageUrl: vendorData?.url || null,
    _raw: product,
    _vendorData: vendorData,
  };
}
