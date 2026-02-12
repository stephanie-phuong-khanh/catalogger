import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { RawProduct, SpecsTable } from './parse-sheet';
import { VendorProduct } from './search-vendor';

// --- Zod schema for structured LLM output ---
const ListingOutput = z.object({
  title: z.string().describe('Product title: manufacturer brand + product line + key differentiator + material'),
  features: z.array(z.string()).describe('Thorough customer-facing bullet points'),
  overviewParagraph: z.string().describe('3-5 sentence product summary'),
  specifications: z.object({
    tableTitle: z.string().describe('Descriptive title for the measurements table'),
    columns: z.array(z.string()).describe('Column headers, e.g. ["Weight", "Length", "Width", "Height"]'),
    rows: z.array(
      z.object({
        label: z.string().describe('Row label, e.g. "Infrared Sauna (Exterior)" or "Carton A – Shipping"'),
        values: z.array(z.string()).describe('Values for each column in order. Use "—" for missing values.'),
      })
    ).describe('One row per physical element'),
  }).describe('Dimensions and weights table'),
});

export type { SpecsTable };

export interface GeneratedListing {
  sku: string;
  price: number;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: SpecsTable;
  vendorPageUrl: string | null;
  _raw: RawProduct;
  _vendorData: VendorProduct | null;
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
 * Build the LLM prompt with sheet data and optional vendor website data.
 */
function buildPrompt(product: RawProduct, vendorData: VendorProduct | null, supplierName?: string): string {
  const sheetData = Object.entries(product)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  let vendorWebsiteData = '';
  if (vendorData && vendorData.body) {
    vendorWebsiteData = `Website title: ${vendorData.title}\nWebsite body:\n${stripHtml(vendorData.body)}`;
  }

  const supplierLine = supplierName ? ` The supplier/vendor is "${supplierName}".` : '';

  return `You are writing a product listing for a Shopify eCommerce store (Dansons Medical).${supplierLine} You are given the raw data we have for one product.

Vendor website data:
-----
${vendorWebsiteData}
-----

Pricing sheet data:
-----
${sheetData}
-----

Generate the following:

1. "title": A clean product title.${supplierName ? ` MUST START with "${supplierName}".` : ''} Include the product line or model name, and the most important differentiators (capacity, key technology, material — whatever is relevant). Do NOT include the SKU.

2. "features": Customer-facing bullet points. This is the MOST IMPORTANT section.
   RULES:
   - Include EVERY distinct feature, capability, and detail from both sources. More bullets is better than fewer.
   - Be TERSE. State facts plainly. Do NOT add filler phrases, qualifiers, or marketing fluff.
   - Keep specific numbers and details as they appear in the source.
   - Keep safety warnings and disclaimers VERBATIM.
   - Do NOT include dimensions, weights, or shipping carton measurements — those go in the specifications table.
   - Include warranty information as a bullet.
   - Include delivery/shipping method as the LAST bullet.
   - Do not mention the SKU in the features.
   - ONE fact per bullet. When in doubt, split.

3. "overviewParagraph": A single paragraph (3-5 sentences) summarizing what this product IS. State facts — materials, technology, capacity. No vague marketing language. No pricing.

4. "specifications": A measurements/dimensions table.
   - Choose columns that fit the data (e.g. "Weight", "Length", "Width", "Height").
   - Use the EXACT dimension labels and order from the source data. Do NOT rename or reorder.
   - One row per physical element: product exterior, product interior, each shipping carton, LTL pallet.
   - Use clear row labels like "Infrared Sauna (Exterior)", "Carton A – Shipping", "LTL Pallet Shipping".
   - Use "—" for missing values.
   - Include ALL cartons and ALL weights/dimensions from the source. Do NOT omit any.
   - Include notes like "(roof overhang: adds 5.9" to depth)" inline with the relevant value.
   - Do NOT include qualitative features (glass type, temperature, electrical, etc.).
   - Exclude internal data (dealer cost, ship zip, process time).
   - Give the table a descriptive title.

IMPORTANT — the store owner wants THOROUGH listings. Every distinct detail matters.`;
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
  supplierName?: string,
): Promise<GeneratedListing> {
  const sku = product[skuColumn];
  const price = product[priceColumn];

  if (!sku) {
    throw new Error(`No SKU found in column "${skuColumn}"`);
  }

  const prompt = buildPrompt(product, vendorData, supplierName);
  console.log(`  Generating listing with LLM...`);

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a precise eCommerce copywriter for a medical/wellness equipment distributor. Be terse and factual. Do not add filler or marketing fluff. Match the tone of the source material.',
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

  console.log(`  ✓ "${generated.title}" — ${generated.features.length} features, ${generated.specifications.rows.length} spec rows`);

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
