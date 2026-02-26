import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { searchVendorSite } from '../../../lib/listings/search-vendor';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// [HARDCODED] Golden Designs config.
const SKU_COLUMN = 'GDINA Item #';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product, vendorUrl } = body as {
      product: Record<string, unknown>;
      vendorUrl?: string;
    };

    if (!product || !vendorUrl) {
      return Response.json({ ok: true, vendorData: null });
    }

    const sku = String(product[SKU_COLUMN] ?? '');
    if (!sku) {
      return Response.json({ ok: true, vendorData: null });
    }

    const description = String(product['Description'] ?? '');
    const vendorData = await searchVendorSite(openai, vendorUrl, sku, description);

    return Response.json({ ok: true, vendorData });
  } catch (err) {
    console.error('search-vendor API error:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Vendor search failed.' },
      { status: 500 }
    );
  }
}
