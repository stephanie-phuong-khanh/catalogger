import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { RawProduct, productToMarkdown } from './parse-sheet';
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
  // This is the raw data from the pricing sheet, formatted as markdown
  const sheetData = productToMarkdown(product);

  // Copy from the vendor website
  let vendorWebsiteData = '';
  if (vendorData && vendorData.body) {
    const vendorWebsiteBody = stripHtml(vendorData.body);

    vendorWebsiteData = `Website title: ${vendorData.title}\nWebsite body: ${vendorWebsiteBody}`;
  }

  return `You are writing a product listing for a Shopify eCommerce store (Dansons Medical). You are given the raw data we have for one product.

  Below is the information from the vendor website:
  -----
  ${vendorWebsiteData}
  -----

  Below is the information from the pricing sheet:
  -----
  ${sheetData}
  -----

Generate the following for this product:

1. "title": A clean product title for the Shopify listing. Include the manufacturer/parent brand name, product line or model name, and the most important differentiators (e.g. capacity, size, key technology, or material — whatever is relevant for this product type).

2. "features": Thorough, customer-facing bullet points. This is the MOST IMPORTANT section.
   RULES:
   - Include EVERY distinct feature, capability, and detail from both sources. More bullets is better than fewer.
   - Be TERSE. State facts plainly. Do NOT add filler phrases, qualifiers, or marketing fluff (e.g. write "3 person capacity" NOT "3-person capacity for spacious relaxation"). Match the tone and brevity of the source material.
   - Keep specific numbers and details as they appear in the source (e.g. counts, placements, measurements). Do NOT generalize specifics into vague statements.
   - Keep safety warnings and disclaimers VERBATIM — copy the exact wording from the source, including any "do not" / "not" clauses (e.g. voltage exclusions, usage restrictions). Do not paraphrase or shorten these.
   - Include warranty information as a bullet.
   - Include delivery/shipping info as the LAST bullet.
   - ONE fact per bullet. Do NOT combine two separate details into a single bullet (e.g. "Easy assembly with a roof vent" should be two bullets: one for assembly, one for the roof vent). When in doubt, split.

3. "overviewParagraph": A single paragraph (3-5 sentences) summarizing what this product IS and what makes it notable. State facts — materials, technology, capacity, key specs. Do NOT use vague marketing language like "offers a spacious and luxurious experience" or "for a comfortable session." If you can delete a phrase and the sentence still makes sense, delete it. Do NOT mention pricing. Write plainly, like a knowledgeable salesperson explaining the product to a customer.

4. "specifications": Key-value pairs for a specs/dimensions table. This should contain ONLY measurements, weights, and capacities — the kind of data that belongs in a "Key Dimensions" or "Key Measurements" table. Include: product dimensions (exterior, interior if available), product weight, shipping carton dimensions and weights (per carton if data is available), pallet dimensions, and any capacity measurements (e.g. weight capacity for lifts). Do NOT include features like glass type, temperature range, electrical requirements, sound system, lighting, etc. — those belong in the features list. Use clean, human-readable keys. Exclude internal data (dealer cost, ship zip, process time).

IMPORTANT — the store owner wants THOROUGH listings. Every distinct detail matters. Do NOT condense or summarize — be comprehensive.
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

  console.log(`\n--- LLM PROMPT START ---\n${prompt}\n--- LLM PROMPT END ---\n`);
  console.log(`  Generating listing with LLM...`);

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    input: [
      {
        role: 'system',
        content: 'You are a precise eCommerce copywriter for a medical/wellness equipment distributor. You never drop details — every feature and safety note from the source data must appear in the listing. Be terse and factual. Do not add filler or marketing fluff. Match the tone of the source material.',
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
