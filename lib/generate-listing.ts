import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { getFeaturesRelevantFromSheet, getSpecsRelevantFromSheet, RawProduct } from './parse-sheet';
import { separateVendorBodyWithLLM, VendorSiteProduct } from './search-vendor';

const TitleOutput = z.object({
  title: z.string().describe('The generated product title only, with no preamble or explanation'),
});
const FeaturesOutput = z.object({
  features: z.array(z.string()).describe('The list of features for the product listing'),
});
const OverviewParagraph = z.object({
  overviewParagraph: z.string().describe('The generated overview paragraph for the product listing'),
});
const SpecsTable = z.object({
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
});

export interface GeneratedListing {
  sku: string;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: typeof SpecsTable;
  vendorPageUrl: string | null;
  _raw: RawProduct;
  _vendorData: VendorSiteProduct | null;
}

function generateTitle(
  _openai: OpenAI,
  productNameFromPriceSheet: string,
  vendorSiteProductTitle: string | null,
  supplierName: string | undefined,
): Promise<string> {
  const vendorSiteProductTitleText = vendorSiteProductTitle ? `The name of the product on the vendor site is "${vendorSiteProductTitle}".` : '';
  const supplierNameText = supplierName ? `- Always start with the supplier name "${supplierName}". The supplier uses sub-brands like "Dynamic Saunas" adn "Maxxus Saunas" - include the sub-brand after the supplier name (e.g. "${supplierName} Dynamic Avila..."), but never start the title with the sub-brand.` : '';

  const prompt = `You are writing a title for a product listing for an eCommerce store. 
  The primary name of the product is "${productNameFromPriceSheet}".
  ${vendorSiteProductTitleText}
  Generate a title for the product listing that is a concise and descriptive title that captures the key features and benefits of the product.
  RULES:
  ${supplierNameText}
  - Include the product line or model name, and the most important differentiators (capacity, key technology, material - whatever is most relevant).
  - Capitalize the first letter of every word in the title (e.g. "1-2 Person" instead of "1-2 person")
  - Do not include the wood type in the title.
  - Do not include the SKU or quotation marks in the title.

  Example:
  The primary name of the product is: Dynamic Avila 1-2-person Low EMF (Between 5-10 MG) FAR Infrared Sauna (Canadian Hemlock)
  The vendor site product title is: Dynamic "Avila" 1-2 Person Low EMF FAR IR Sauna (DYN-6103-01)
  The generated title should be: Golden Designs Dynamic Avila 1-2 Person Low EMF FAR Infrared Sauna
  `;

  return _openai.responses
    .parse({
      model: 'gpt-4o',
      temperature: 0,
      input: [{ role: 'user', content: prompt }],
      text: { format: zodTextFormat(TitleOutput, 'title_output') },
    })
    .then((response) => response.output_parsed?.title ?? '');
}


function generateFeatures(
  _openai: OpenAI,
  productInfo: string,
  vendorSiteInfo: string,
): Promise<string[]> {

  const prompt = `You are writing a list of features for a product listing for an eCommerce store.
  You have information about the product from a raw pricing sheet and from the vendor site product page.

  PRICING SHEET INFO:
  ${productInfo}

  VENDOR SITE INFO:
  ${vendorSiteInfo}

  Generate a list of features for the product listing that are a concise and descriptive list of the key features and benefits of the product.
  RULES:
  - Include EVERY distinct feature and detail from both sources. Do NOT DROP FEATURES.
  - Be concise but complete. State facts plainly, no filler or marketing fluff. Do NOT over-abbreviate or reword. Preserve the full detail from the source, verbatim if possible.
  - Combine information about the electrical service information from the pricing sheet and the vendor site. List GFCI as CAFCI/GFCI. Shown in the example below:
    * PRICING SHEET INFO: Electrical service: Special Electrical 120 V/20 AMP Non GFCI dedicated receptacle and breaker (Not 220/240 V) (Please consult a certified electrician.)
    * VENDOR SITE INFO: Electrical service: 120V/15amp Non GFCI plug & play (Recommended Dedicated Outlet)
    GENERATED FEATURE: Requires 120/15 AMP Outlet and Non-CAFCI/GFCI Breaker (Recommended to be on a dedicated outlet)
  - Combine information about the heating elements from the pricing sheet and the vendor site. For infrared heating panels, keep information about the count, EMF level with measurement (e.g. "5-10 mG at 2-3\""), and placement locations. Shown in the example below:
    * PRICING SHEET INFO: Heating Elements: 7 Dynamic Low EMF (EMF between 5-10MG - 2 to 3 inches from the heating panels) FAR Infrared Carbon heating panels 2 on the rear wall 2 on each side wall and 1 under the bench.
    * VENDOR SITE INFO: 7 Dynamic Low EMF (EMF between 5-10 MG - 2 to 3 inches from the heating panels) FAR Infrared Carbon heating panels.
    * GENERATED FEATURE: 7 Dynamic Low EMF FAR Infrared Carbon heating panels (5-10 mG at 2-3\") placed across the rear walls, side walls, and under the bench for even, soothing heat.
  - Combine the product's color/finish (e.g. "Honey Dark Stain") with its material (e.g. "Canadian Hemlock") into one bullet when both are available. For example: "Honey Dark Stain Pacific Cedar wood construction".
  - BUT DO NOT COMBINE ANY OTHER FEATURES INTO THE SAME BULLET.
  - Do not drop the ° symbol for temperatures.
  - Separate the temperature range and the maximum temperature into two different bullets. Example of generated features:
    * Temperature Range of 120°F-128°F
    * Can heat up to 140°F
  - Keep safety warnings verbatim.
  - Include warranty information as a bullet.
   - Do not include the SKU or disclaimers.
  - Delivery/shipping as the LAST bullet, with combine information from the pricing sheet and the vendor site. Shown in the example below:
    * PRICING SHEET INFO: Delivery: This item will be delivered curbside only on a pallet by a freight carrier.
    * VENDOR SITE INFO: Ships in 1 box
    * GENERATED FEATURE: This item will be delivered curbside only on a pallet in 1 box by a freight carrier.
  - Order the features to list the capacity, electrical service, and heating panels first.
  `;

  return _openai.responses
    .parse({
      model: 'gpt-4o',
      temperature: 0,
      input: [{ role: 'user', content: prompt }],
      text: { format: zodTextFormat(FeaturesOutput, 'features_output') },
    })
    .then((response) => response.output_parsed?.features ?? []);
}


function generateSpecifications(
  _openai: OpenAI,
  productTitle: string,
  productInfo: string,
  vendorSiteInfo: string,
): Promise<typeof SpecsTable> {
  const prompt = `You are writing a list of specifications for a product listing for an eCommerce store.
  You have information about the product from a raw pricing sheet and from the vendor site product page.

  PRODUCT TITLE:
  ${productTitle}

  PRICING SHEET INFO:
  ${productInfo}

  VENDOR SITE INFO:
  ${vendorSiteInfo}

  Generate a list of specifications for the product listing that are a concise and descriptive list of the key specifications and benefits of the product.
  RULES:
  - Columns MUST be exactly ["Weight", "Length", "Width", "Height"] in that order.
  - Each row MUST have exactly 4 values in that same order: [weight, length, width, height]. First value = weight (e.g. "250 lbs" or "—"), second = length (also referenced as "depth"), third = width, fourth = height.
  - Map each source value to the correct column. The source information can be presented in different orders, but the values must be mapped correctly. For example: 
    * SOURCE: Dimensions (HWD): 70" x 60" x 50"
    * GENERATED ROW (ordered correctly): Weight: 250 lbs, Length: 50", Width: 60", Height: 70"
  - One row per physical element (product exterior, product interior, each shipping carton, pallet, etc.).
  - Use "—" for missing values.
  - Include ALL weights and dimensions from the sources.
  - Always include units (e.g. "200 lbs", "30\\""), not bare numbers.
  - Preserve inline notes that appear with dimensions in the source (e.g. "(roof overhang: adds 6.7\\" to depth)") — include them in the same cell as the dimension value, e.g. "60\\" (roof overhang: adds 6.7\\" to depth)".
  - Give the table a descriptive title in the format "Key Measurements of the [Product Name]". Do not include the supplier name or the sub-brand name. For example:
    * PRODUCT TITLE: Golden Designs Dynamic Avila 1-2 Person Low EMF FAR Infrared Sauna
    * GENERATED TABLE TITLE: Key Measurements of the Avila 1-2 Person Low EMF FAR Infrared Sauna
  `;

  return _openai.responses
    .parse({
      model: 'gpt-4o',
      temperature: 0,
      input: [{ role: 'user', content: prompt }],
      text: { format: zodTextFormat(SpecsTable, 'specs_table_output') },
    })
    .then((response) => response.output_parsed) as Promise<typeof SpecsTable>;
}


function generateOverviewParagraph(
  _openai: OpenAI,
  productTitle: string,
  featuresList: string[],
): Promise<string> {
  const prompt = `You are writing an overview paragraph for a product listing for an eCommerce store.
  You have information about the product from its title and from the comprehensive list of features to be included in the listing.

  PRODUCT TITLE:
  ${productTitle}

  FEATURES LIST:
  ${featuresList.join('\n')}

  Write a 3-4 sentence product overview optimized for conversion and search relevance.
  RULES:
  - Open with the product title and clearly state what the product is and its primary purpose.
  - Clearly explain what the product is for, how to use it, and why the customer would care to buy the product.
  - Highlight tangible health/wellness benefits (e.g., muscle relaxation, stress relief, improved circulation) if supported by source material.
  - Incorporate 1-2 specific differentiators (e.g., number of heating panels, material type, connectivity features) naturally within the narrative.
  - Mention suitable installation locations if provided (e.g. basements, master baths, walk-in closets, fitness rooms).
  - Write in a confident, benefit-driven tone. Do NOT list features mechanically, such as how many people the product can accommodate. Include features that are most relevant to the product's appeal.
  - No pricing. Do NOT fabricate or infer unsupported claims.
  - Do not use repetitive language or sentence structure.
  - Do not use marketing fluff or filler words.

  EXAMPLE OVERVIEW PARAGRAPH:
  The Golden Designs Avila 1-2 Person Low EMF FAR Infrared Sauna provides a compact, luxurious wellness experience for home use. Crafted from Honey Dark Canadian Hemlock wood, this sauna features 7 dynamic Low EMF FAR infrared carbon heating panels that deliver soothing, energy-efficient heat for muscle relaxation, stress relief, and improved circulation. Perfect for indoor spaces like basements, master bathrooms, walk-in closets, or fitness rooms, the Avila sauna also includes Bluetooth and MP3 connectivity with built-in speakers for a personalized, spa-like experience.
  `;

  return _openai.responses
    .parse({
      model: 'gpt-4o',
      temperature: 0,
      input: [{ role: 'user', content: prompt }],
      text: { format: zodTextFormat(OverviewParagraph, 'overview_paragraph_output') },
    })
    .then((response) => response.output_parsed) as Promise<string>;
}

export async function generateListing(
  _openai: OpenAI,
  product: RawProduct,
  skuColumn: string,
  vendorSiteData: VendorSiteProduct | null,
  _supplierName?: string,
): Promise<GeneratedListing> {
  const sku = product[skuColumn];
  if (!sku) {
    throw new Error(`No SKU found in column "${skuColumn}"`);
  }

  const productNameFromPriceSheet = product['Description']; // [HARDCODED]
  const title = await generateTitle(
    _openai,
    productNameFromPriceSheet,
    vendorSiteData?.title || null,
    _supplierName,
  );

  // Separate features-related information from specs-related information, from both sources.
  const featuresRelevant = {
    fromSheet: getFeaturesRelevantFromSheet(product),
    fromVendor: '',
  };
  const specsRelevant = {
    fromSheet: getSpecsRelevantFromSheet(product),
    fromVendor: '',
  };
  if (vendorSiteData) {
    const vendorSeparated = await separateVendorBodyWithLLM(_openai, vendorSiteData);
    featuresRelevant.fromVendor = vendorSeparated.featuresRelevant;
    specsRelevant.fromVendor = vendorSeparated.specsRelevant;
  }

  // console.log('\n\n=== featuresRelevant from sheet === \n', featuresRelevant.fromSheet);
  // console.log('\n\n=== specsRelevant from sheet ===\n', specsRelevant.fromSheet);
  // console.log('\n\n=== featuresRelevant from vendor ===\n', featuresRelevant.fromVendor);
  // console.log('\n\n=== specsRelevant from vendor ===\n\n\n', specsRelevant.fromVendor);

  const features = await generateFeatures(_openai, featuresRelevant.fromSheet, featuresRelevant.fromVendor);

  const specifications = await generateSpecifications(_openai, title, specsRelevant.fromSheet, specsRelevant.fromVendor);

  const overviewParagraph = await generateOverviewParagraph(_openai, title, features);

  return {
    sku,
    title,
    features,
    specifications,
    overviewParagraph,
    vendorPageUrl: vendorSiteData?.url || null,
    _raw: product,
    _vendorData: vendorSiteData,
  };
}
