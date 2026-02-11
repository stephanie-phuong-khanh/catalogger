import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

// --- Minimal config: only the things we MUST know programmatically ---
// These are the only hardcoded references to specific column names.
// Everything else, the LLM figures out from the raw data.
const CONFIG = {
  productsFile: 'data/Products_GoldenDesigns_Tab 1 - Most Popular.json',
  outputDir: 'data/listings',
  skuColumn: 'GDINA Item #',    // TODO: Have LLM recognize which column is the unique product ID
  priceColumn: 'MSRP',          // TODO: Have LLM recognize which column is the listing price
};

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Boilerplate sections (same on every Dansons listing) ---
// In the future, these come from user configuration / the store's existing listings.
const BOILERPLATE = {
  affordability: `Dansons Medical believes that everyone, especially those struggling with illness, injury, or aging, should have access to affordable medical equipment. We offer free shipping on all products and a price-match guarantee. Our customer service team is available to assist you with any questions or concerns.`,
  shipping: `Free shipping on all orders. Most items ship within 1-2 business days. Large items (saunas, patient lifts) ship via freight carrier with curbside delivery. You will receive tracking information via email once your order ships.`,
  warranty: `All products come with the manufacturer's warranty. If you experience any issues, please contact our customer service team for assistance with warranty claims and returns.`,
};

// --- Types ---
// Raw product is just whatever came out of the spreadsheet — any keys, any values.
type RawProduct = Record<string, any>;

interface GeneratedListing {
  sku: string;
  price: number;
  // Everything below is LLM-generated from the raw data
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: Record<string, any>;
  boilerplate: typeof BOILERPLATE;
  _raw: RawProduct;
}

// --- LLM prompt ---
function buildPrompt(product: RawProduct): string {
  // Dump ALL the raw key-value pairs into the prompt.
  // The LLM is smart enough to figure out what's what.
  const dataLines = Object.entries(product)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return `You are writing a product listing for a Shopify eCommerce store (Dansons Medical).

Below is ALL the raw data we have for one product, copied from a supplier pricing sheet. The column names are exactly as they appear in the spreadsheet. Some fields are customer-facing (features, descriptions). Some are internal (dealer cost, shipping logistics). Use your judgment to determine what's relevant for a customer-facing listing.

Your job is to generate a JSON object with these keys:

1. "title" (string): A clean product title for the Shopify listing. Should include brand, product name, key differentiator (e.g. capacity, technology), and material if relevant.

2. "features" (array of strings): Clean, concise bullet points for customers. Pull from any fields that describe the product's capabilities, construction, or included features. Remove duplicates. Fix formatting. Exclude delivery/shipping logistics — that's handled separately.

3. "overviewParagraph" (string): A single paragraph (3-5 sentences) describing the product in a professional, warm tone. Highlight the most compelling selling points. Do NOT mention pricing. Write for a customer who is browsing and comparing products.

4. "specifications" (object): A flat object of key-value pairs for a specs table. Include things like dimensions, weight, capacity, materials, electrical requirements, warranty — whatever is relevant from the data. Use clean, human-readable keys (e.g. "Exterior Dimensions" not "Dimensions"). Exclude internal/logistics data (dealer cost, ship zip, process time).

Return ONLY the JSON object, no markdown fences.

---

**Raw Product Data:**

${dataLines}
`;
}

// --- Generate listing for one product ---
async function generateListing(product: RawProduct): Promise<GeneratedListing> {
  const sku = product[CONFIG.skuColumn];
  const price = product[CONFIG.priceColumn];

  if (!sku) {
    throw new Error(`No SKU found in column "${CONFIG.skuColumn}"`);
  }

  const prompt = buildPrompt(product);

  console.log(`\n--- Generating listing for ${sku} ---`);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful eCommerce copywriter. Always respond with valid JSON only.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error(`Empty response for ${sku}`);

  const generated = JSON.parse(content) as {
    title: string;
    features: string[];
    overviewParagraph: string;
    specifications: Record<string, any>;
  };

  console.log(`  ✓ "${generated.title}"`);
  console.log(`  ✓ ${generated.features.length} features, ${Object.keys(generated.specifications).length} specs`);

  return {
    sku,
    price,
    title: generated.title,
    features: generated.features,
    overviewParagraph: generated.overviewParagraph,
    specifications: generated.specifications,
    boilerplate: BOILERPLATE,
    _raw: product,
  };
}

// --- Main ---
async function main() {
  // Load parsed products
  const productsPath = path.resolve(CONFIG.productsFile);
  if (!fs.existsSync(productsPath)) {
    console.error(`Products file not found: ${productsPath}`);
    console.error(`Run "npx ts-node scripts/parse-sheet.ts" first.`);
    process.exit(1);
  }

  const products: RawProduct[] = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  console.log(`Loaded ${products.length} products from ${CONFIG.productsFile}`);

  // Create output directory
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  // Generate listings
  const listings: GeneratedListing[] = [];
  for (const product of products) {
    try {
      const listing = await generateListing(product);
      listings.push(listing);

      // Save individual listing
      const individualPath = path.join(CONFIG.outputDir, `${listing.sku}.json`);
      fs.writeFileSync(individualPath, JSON.stringify(listing, null, 2));
      console.log(`  → Saved ${individualPath}`);
    } catch (err: any) {
      console.error(`  ✗ Failed:`, err.message);
    }
  }

  // Save all listings
  const allPath = path.join(CONFIG.outputDir, '_all_listings.json');
  fs.writeFileSync(allPath, JSON.stringify(listings, null, 2));
  console.log(`\nDone! ${listings.length}/${products.length} listings generated.`);
  console.log(`All listings saved to ${allPath}`);
}

main();
