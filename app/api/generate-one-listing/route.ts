import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { generateListing } from '../../../lib/generate-listing';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// [HARDCODED] Golden Designs config. Later: from run config or user input.
const SKU_COLUMN = 'GDINA Item #';
const PRICE_COLUMN = 'MSRP';

// Same supplier context as pipeline.ts so app and CLI produce the same quality.
const SUPPLIER_CONTEXT = `
Title: Always start with "Golden Designs". The supplier uses sub-brands like "Dynamic Saunas" and "Maxxus Saunas" — include the sub-brand as a product line name (e.g. "Golden Designs Dynamic Avila..."), but never start the title with the sub-brand.

Features — supplier-specific patterns:
- Combine the Color field (e.g. "Honey Dark Stain") with the wood type into one bullet.
- For infrared heating panels: include count, EMF level with measurement (e.g. "5-10 mG at 2-3\""), and placement locations (e.g. "rear walls, side walls, and under the bench").
- For electrical requirements: rewrite as "Requires [voltage/amp] Outlet and Non-CAFCI/GFCI Breaker ([recommendation])". This supplier's products require non-CAFCI breakers even though the source data only mentions GFCI.

Overview — this supplier's products:
- Mention health/wellness benefits when applicable (e.g. muscle relaxation, stress relief, improved circulation).
- The supplier's ad-copy often lists suitable room types (basements, master baths, walk-in closets, fitness rooms) — include these when available.
`.trim();

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
      supplierName === 'Golden Designs' ? SUPPLIER_CONTEXT : undefined,
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
