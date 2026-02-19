import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { RawProduct, SpecsTable } from './parse-sheet';
import { VendorSiteProduct } from './search-vendor';

const TitleOutput = z.object({
  title: z.string().describe('The generated product title only, with no preamble or explanation'),
});

export type { SpecsTable };

export interface GeneratedListing {
  sku: string;
  price: number | string | null;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: SpecsTable;
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

export async function generateListing(
  _openai: OpenAI,
  product: RawProduct,
  skuColumn: string,
  priceColumn: string,
  vendorSiteData: VendorSiteProduct | null,
  _supplierName?: string,
): Promise<GeneratedListing> {
  const sku = product[skuColumn];
  if (!sku) {
    throw new Error(`No SKU found in column "${skuColumn}"`);
  }

  const price = product[priceColumn] || null;

  const productNameFromPriceSheet = product['Description']; // [HARDCODED]
  const title = await generateTitle(
    _openai,
    productNameFromPriceSheet,
    vendorSiteData?.title || null,
    _supplierName,
  );

  // TODO: Generate features

  // TODO: Generate overview paragraph

  // TODO: Generate specifications

  return {
    sku,
    price,
    title,
    features: ['TMP'],
    overviewParagraph: 'TMP',
    specifications: {
      tableTitle: 'TMP',
      columns: ['TMP'],
      rows: [{ label: 'TMP', values: ['TMP'] }],
    },
    vendorPageUrl: vendorSiteData?.url || null,
    _raw: product,
    _vendorData: vendorSiteData,
  };
}
