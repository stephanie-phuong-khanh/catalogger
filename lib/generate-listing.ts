import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { RawProduct } from './parse-sheet';
import { VendorProduct } from './search-vendor';

// ---- Zod schemas for each LLM call ----

/** Call 1: Triage raw data into features-relevant vs specs-relevant */
const TriageOutput = z.object({
  featuresData: z.string().describe(
    'All qualitative/descriptive information that belongs in the features and overview sections: ' +
    'product capabilities, materials, technology, included accessories, safety warnings, warranty, delivery info, etc. ' +
    'Copy the relevant text verbatim from the sources.'
  ),
  specsData: z.string().describe(
    'All quantitative/measurement information that belongs in a dimensions & weights table: ' +
    'product dimensions, product weight, shipping carton dimensions and weights, pallet dimensions and weights, capacities. ' +
    'Preserve the tabular structure — use markdown table format if appropriate.'
  ),
});

/** Call 2: Generate features + overview + title from qualitative data */
const FeaturesOutput = z.object({
  title: z.string().describe('Product title: manufacturer brand + product line + key differentiator + material'),
  features: z.array(z.string()).describe('Thorough customer-facing bullet points'),
  overviewParagraph: z.string().describe('3-5 sentence product summary'),
});

/** Call 3: Generate specs as a flexible table with dynamic columns */
const SpecsOutput = z.object({
  tableTitle: z.string().describe('Title for the specs table, e.g. "Key Measurements of the Maxxus 3-Person Low EMF FAR Infrared Sauna"'),
  columns: z.array(z.string()).describe('Column headers, e.g. ["Weight", "Length", "Width", "Height"]'),
  rows: z.array(
    z.object({
      label: z.string().describe('Row label, e.g. "Infrared Sauna (Exterior)" or "Carton A – Shipping"'),
      values: z.array(z.string()).describe('Values for each column in order. Use "—" for missing values.'),
    })
  ).describe('One row per physical element: product exterior, interior, each shipping carton, pallet, etc.'),
});

// ---- Public types ----

export interface SpecsTable {
  tableTitle: string;
  columns: string[];
  rows: { label: string; values: string[] }[];
}

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

// ---- Helpers ----

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

/** Build combined raw source text from sheet + vendor site */
function buildSourceText(product: RawProduct, vendorData: VendorProduct | null): string {
  const sheetMarkdown = product._markdown || '(no sheet data)';

  // Key-value pairs for non-table fields
  const kvPairs = Object.entries(product)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  let vendorText = '';
  if (vendorData && vendorData.body) {
    vendorText = `\n\nVendor website title: ${vendorData.title}\nVendor website body:\n${stripHtml(vendorData.body)}`;
  }

  return `Pricing sheet (key-value):\n${kvPairs}\n\nPricing sheet (table view):\n${sheetMarkdown}${vendorText}`;
}

// ---- The three LLM calls ----

/**
 * Call 1: Triage — split raw data into features-relevant vs specs-relevant.
 */
async function triageData(
  openai: OpenAI,
  sourceText: string,
): Promise<{ featuresData: string; specsData: string }> {
  console.log('  [1/3] Triaging data into features vs specs...');

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a data organizer for product listings. Your job is to split raw product data into two buckets:\n' +
          '1. SPECS DATA: quantitative measurements — dimensions and measurements of product components, including shipping components. Only include measurements with units. Quantities do not count as measurements.\n\n' +
          '2. FEATURES DATA: information not included in specs data, which includes but is not limited to just qualitative information. Includes product capabilities, materials, technology, accessories, safety warnings, warranty, delivery/shipping method, disclaimers.\n' +
          'Copy the relevant data verbatim from the sources. Do not paraphrase. Do not drop anything. ' +
          'If something could go in either bucket, put it in features. ' +
          'For specs data, preserve the tabular structure using markdown tables where the source data has rows (e.g. multiple shipping cartons).',
      },
      {
        role: 'user',
        content: `Here is ALL the raw data for one product from two sources. Split it into features data vs specs data.\n\n${sourceText}`,
      },
    ],
    temperature: 0.3,
    text: { format: zodTextFormat(TriageOutput, 'triage_output') },
  });

  const result = response.output_parsed;
  if (!result) throw new Error('Empty triage response');
  console.log('  ✓ Triage complete');
  return result;
}

/**
 * Call 2: Generate features, overview, and title from the qualitative data.
 */
async function generateFeatures(
  openai: OpenAI,
  featuresData: string,
): Promise<{ title: string; features: string[]; overviewParagraph: string }> {
  console.log('  [2/3] Generating features + overview + title...');

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a precise eCommerce copywriter for a medical/wellness equipment distributor. Be terse and factual. Do not add filler or marketing fluff. Match the tone of the source material.',
      },
      {
        role: 'user',
        content: `You are writing a product listing for Dansons Medical (Shopify store). Below is the FEATURES-RELEVANT data for one product. Dimensions and weights are handled separately — do NOT include them.

-----
${featuresData}
-----

Generate:

1. "title": A clean product title. Include manufacturer/brand name, product line or model name, and the most important differentiators (capacity, key technology, material — whatever is relevant).

2. "features": Customer-facing bullet points.
   RULES:
   - Include EVERY distinct feature, capability, and detail. More bullets is better than fewer.
   - Be TERSE. State facts plainly. Do NOT add filler phrases, qualifiers, or marketing fluff (e.g. "3 person capacity" NOT "3-person capacity for spacious relaxation").
   - Keep specific numbers and details as they appear in the source.
   - Keep safety warnings and disclaimers VERBATIM.
   - Include warranty information as a bullet.
   - Include delivery/shipping info as the LAST bullet.
   - ONE fact per bullet. Do NOT combine two separate details into one bullet. When in doubt, split.
   - Do NOT include dimensions, weights, or shipping carton measurements — those are in the specs table.

3. "overviewParagraph": A single paragraph (3-5 sentences) summarizing what this product IS and what makes it notable. State facts — materials, technology, capacity. Do NOT use vague marketing language. If you can delete a phrase and the sentence still makes sense, delete it. Do NOT mention pricing.

IMPORTANT — the store owner wants THOROUGH listings. Every distinct detail matters.`,
      },
    ],
    temperature: 0.7,
    text: { format: zodTextFormat(FeaturesOutput, 'features_output') },
  });

  const result = response.output_parsed;
  if (!result) throw new Error('Empty features response');
  console.log(`  ✓ "${result.title}" — ${result.features.length} features`);
  return result;
}

/**
 * Call 3: Generate specs/dimensions table from the quantitative data.
 */
async function generateSpecs(
  openai: OpenAI,
  specsData: string,
): Promise<SpecsTable> {
  console.log('  [3/3] Generating specifications table...');

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a data formatter. Your job is to take raw measurement data and output a clean, complete specifications table. Do not drop any data. Every dimension and weight from the source must appear.',
      },
      {
        role: 'user',
        content: `Below is the SPECS/MEASUREMENTS data for one product. Format it as a multi-column table.

-----
${specsData}
-----

RULES:
- Choose columns that best represent the data (e.g. "Weight", "Length", "Width", "Height" for products with dimensions).
- Use the EXACT dimension labels and order from the source data. Do NOT rename or reorder dimensions.
- One row per physical element: product exterior, product interior, each shipping carton, LTL pallet, etc.
- Use clear row labels like "Infrared Sauna (Exterior)", "Carton A – Shipping", "LTL Pallet Shipping".
- Use "—" for missing values (e.g. interior weight if not provided).
- Include ALL cartons — do NOT omit any.
- Include ALL weights and dimensions from the source.
- Include notes like "(roof overhang: adds 5.9" to depth)" inline with the relevant value.
- Do NOT include qualitative features (glass type, temperature, electrical, etc.).
- Exclude internal data (dealer cost, ship zip, process time).
- Give the table a descriptive title.`,
      },
    ],
    temperature: 0.3,
    text: { format: zodTextFormat(SpecsOutput, 'specs_output') },
  });

  const result = response.output_parsed;
  if (!result) throw new Error('Empty specs response');
  console.log(`  ✓ ${result.rows.length} spec rows, ${result.columns.length} columns`);
  return result;
}

// ---- Main entry point (same interface as before) ----

/**
 * Generate a listing for one product using sheet data + optional vendor website data.
 * Uses 3 sequential LLM calls: triage → features → specs.
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

  // Build combined source text once
  const sourceText = buildSourceText(product, vendorData);

  // Call 1: Triage
  const { featuresData, specsData } = await triageData(openai, sourceText);

  // Call 2: Features + overview + title (can run in parallel with Call 3)
  // Call 3: Specs table
  const [featuresResult, specifications] = await Promise.all([
    generateFeatures(openai, featuresData),
    generateSpecs(openai, specsData),
  ]);

  console.log(`  ✓ Complete: "${featuresResult.title}" — ${featuresResult.features.length} features, ${specifications.rows.length} spec rows`);

  return {
    sku,
    price,
    title: featuresResult.title,
    features: featuresResult.features,
    overviewParagraph: featuresResult.overviewParagraph,
    specifications,
    vendorPageUrl: vendorData?.url || null,
    _raw: product,
    _vendorData: vendorData,
  };
}
