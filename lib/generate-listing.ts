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
    columns: z
      .array(z.string())
      .describe('Exactly 4 column headers in this order: Weight, Length, Width, Height'),
    rows: z.array(
      z.object({
        label: z.string().describe('Row label, e.g. "Sauna (Exterior)" or "Carton A – Shipping"'),
        values: z
          .array(z.string())
          .length(4)
          .describe(
            'Exactly 4 values in column order: [weight e.g. "250 lbs", length e.g. "36\\"", width, height]. Use "—" for missing. First value MUST be weight, then length, width, height.',
          ),
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
 * Regex to extract lines that contain dimension information.
 * Matches patterns like "Exterior dimensions (WDH): 39" x 36" x 73""
 * or "Dimensions: 36" L x 39" W x 73" H" — any line with a dimensions
 * label followed by values separated by "x".
 */
const DIMENSION_LINE_RE = /^.*\bdimensions?\b.*\d+.*x.*\d+.*$/gim;

/**
 * Use a focused LLM call to normalize extracted dimension lines into
 * a consistent "Label: Length: ..., Width: ..., Height: ..." format.
 * This is more reliable than regex-based axis remapping because the LLM
 * can interpret any ordering convention (WDH, LWH, etc.) or free-form text.
 */
async function normalizeDimensions(openai: OpenAI, text: string): Promise<string> {
  const matches = text.match(DIMENSION_LINE_RE);
  if (!matches || matches.length === 0) return text;

  const lines = matches.map(l => l.trim());

  const response = await openai.responses.create({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You normalize product dimension lines into a consistent format. For each input line, output ONLY the rewritten line. Preserve the label (e.g. "Exterior dimensions", "Interior dimensions"). Output exactly one line per input line, in the same order.',
      },
      {
        role: 'user',
        content: `Rewrite each dimension line below so the values are explicitly labeled as Length, Width, and Height. Note: Depth = Length (same axis).

Example input:  Exterior dimensions (WDH): 30" x 20" x 40"
Example output: Exterior dimensions: Length: 20", Width: 30", Height: 40"

Lines to normalize:
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
      },
    ],
  });

  const outputText = response.output_text.trim();
  const normalizedLines = outputText.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim());

  let result = text;
  for (let i = 0; i < lines.length; i++) {
    if (normalizedLines[i]) {
      result = result.replace(lines[i], normalizedLines[i]);
    }
  }

  return result;
}

/**
 * Build the LLM prompt with sheet data and optional vendor website data.
 * The base prompt is generic — it works for any product from any supplier.
 * Supplier- or product-type-specific patterns are injected via `supplierContext`.
 */
function buildPrompt(
  product: RawProduct,
  vendorBodyText: string | null,
  vendorTitle: string | null,
  supplierName?: string,
  supplierContext?: string,
): string {
  const sheetData = Object.entries(product)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  let vendorWebsiteData = '';
  if (vendorBodyText) {
    vendorWebsiteData = `Website title: ${vendorTitle}\nWebsite body:\n${vendorBodyText}`;
  }

  const supplierLine = supplierName ? ` The supplier/vendor is "${supplierName}".` : '';

  const contextBlock = supplierContext
    ? `\nSupplier-specific patterns (follow these closely):\n-----\n${supplierContext}\n-----\n`
    : '';

  return `You are writing a product listing for a Shopify eCommerce store (Dansons Medical).${supplierLine} You are given the raw data we have for one product.

Vendor website data:
-----
${vendorWebsiteData}
-----

Pricing sheet data:
-----
${sheetData}
-----
${contextBlock}
Generate the following:

1. "title": A clean product title.${supplierName ? ` MUST START with "${supplierName}".` : ''} Include the product line or model name, and the most important differentiators (capacity, key technology, material — whatever is most relevant). Do NOT include the SKU or quotation marks around product names. Do not include the wood type in the title.

2. "features": Customer-facing bullet points. This is the MOST IMPORTANT section.
   RULES:
   - Include EVERY distinct feature and detail from both sources. Do NOT EVER DROP FEATURES.
   - Be TERSE but COMPLETE. State facts plainly, no filler or marketing fluff. Do NOT over-abbreviate or reword. Preserve the full detail from the source, verbatim if possible.
   - Preserve specific numbers, measurements, and parenthetical qualifiers exactly as they appear.
   - Combine the product's finish/color with its material in a single bullet when both are available.
   - BUT DO NOT COMBINE ANY OTHER FEATURES INTO THE SAME BULLET.
   - Do not drop the ° symbol for temperatures.
   - Keep safety warnings VERBATIM.
   - Include warranty information as a bullet.
   - Delivery/shipping as the LAST bullet — combine all shipping details (method, pallet, box count, carrier) into one bullet.
   - Do NOT include the SKU.
   - DO NOT include vendor disclaimers, boilerplate, or color accuracy notices.
   - IMPORTANT: DO NOT include dimensions, weights, or measurements in this section. This information goes ONLY in the specifications table.

3. "overviewParagraph": A single paragraph (3-4 sentences) summarizing the product. RULES:
   - Open with the full product name and what it is designed for.
   - Write a concise NARRATIVE — synthesize, don't enumerate features.
   - Mention health/wellness benefits and suitable installation locations if the source provides them.
   - Weave in 1-2 standout features naturally.
   - No pricing. Do NOT make up information.

4. "specifications": A measurements/dimensions table.
   - Columns MUST be exactly ["Weight", "Length", "Width", "Height"] in that order.
   - Each row MUST have exactly 4 values in that same order: [weight, length, width, height]. First value = weight (e.g. "250 lbs" or "—"), second = length, third = width, fourth = height. Do not put weight in the last position or dimensions in the weight column.
   - Map each source value to the correct column by meaning (weight goes in column 1, length in column 2, etc.). Depth = Length.
   - One row per physical element (product exterior, product interior, each shipping carton, pallet, etc.).
   - Use "—" for missing values.
   - Include ALL weights and dimensions from the sources.
   - Always include units (e.g. "250 lbs", "36\\"", not bare numbers).
   - Do NOT include qualitative features (glass type, temperature, electrical, etc.).
   - Exclude internal/dealer data (cost, ship zip, process time).
   - Give the table a descriptive title in the format "Key Measurements of the [Product Name]".

Be THOROUGH. Every distinct detail from the source data matters.`;
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
  supplierContext?: string,
): Promise<GeneratedListing> {
  const sku = product[skuColumn];
  const price = product[priceColumn];

  if (!sku) {
    throw new Error(`No SKU found in column "${skuColumn}"`);
  }

  // Pre-process vendor body: strip HTML, then normalize dimensions via focused LLM call
  let vendorBodyText: string | null = null;
  let vendorTitle: string | null = null;
  if (vendorData?.body) {
    const stripped = stripHtml(vendorData.body);
    console.log(`  Normalizing vendor dimensions...`);
    vendorBodyText = await normalizeDimensions(openai, stripped);
    vendorTitle = vendorData.title;
  }

  const prompt = buildPrompt(product, vendorBodyText, vendorTitle, supplierName, supplierContext);
  console.log(`  Generating listing with LLM...`);

  console.log(`*** Prompt: ${prompt}`); // TMP for debugging

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [
      {
        role: 'system',
        content: 'You are a precise eCommerce copywriter for a medical/wellness equipment distributor. Be terse and factual. Do not add filler or marketing fluff. Match the tone of the source material.',
      },
      { role: 'user', content: prompt },
    ],
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
