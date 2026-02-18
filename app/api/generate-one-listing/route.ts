import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { generateListing } from '../../../lib/generate-listing';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// [HARDCODED] Golden Designs sheet columns. Later: from run config or user input.
const SKU_COLUMN = 'GDINA Item #';
const PRICE_COLUMN = 'MSRP';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product, vendorData, supplierName } = body as {
      product: Record<string, unknown>;
      vendorData?: any;
      supplierName?: string;
    };

    if (!product) {
      return Response.json({ ok: false, error: 'Missing product data.' }, { status: 400 });
    }

    const sku = String(product[SKU_COLUMN] ?? '');
    if (!sku) {
      return Response.json({ ok: false, error: 'Product has no SKU.' }, { status: 400 });
    }

    const listing = await generateListing(
      openai,
      product as Record<string, any>,
      SKU_COLUMN,
      PRICE_COLUMN,
      vendorData ?? null,
      supplierName,
    );

    return Response.json({
      ok: true,
      listing: {
        sku: listing.sku,
        price: listing.price,
        title: listing.title,
        features: listing.features,
        overviewParagraph: listing.overviewParagraph,
        specifications: listing.specifications,
        vendorPageUrl: listing.vendorPageUrl,
      },
    });
  } catch (err) {
    console.error('generate-one-listing API error:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 }
    );
  }
}
