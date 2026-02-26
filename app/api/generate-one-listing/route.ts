import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { generateListing, createIncompleteListing } from '../../../lib/listings/generate-listing';
import { isPricingDataIncomplete } from '../../../lib/listings/pricing-sheet-groups';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// [HARDCODED] Golden Designs sheet columns. Later: from run config or user input.
const SKU_COLUMN = 'GDINA Item #';

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

    if (isPricingDataIncomplete(product)) {
      const listing = createIncompleteListing(sku, product as Record<string, any>, vendorData ?? null);
      return Response.json({
        ok: true,
        listing: {
          sku: listing.sku,
          incompletePricingData: true,
          _raw: listing._raw,
          _vendorData: listing._vendorData,
          vendorPageUrl: listing.vendorPageUrl,
        },
      });
    }

    const listing = await generateListing(
      openai,
      product as Record<string, any>,
      SKU_COLUMN,
      vendorData ?? null,
      supplierName,
    );

    return Response.json({
      ok: true,
      listing: {
        sku: listing.sku,
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
