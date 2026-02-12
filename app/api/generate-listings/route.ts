import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const websiteUrl = formData.get('websiteUrl')?.toString()?.trim();

    if (!file || !(file instanceof File)) {
      return Response.json(
        { ok: false, error: 'Pricing sheet (Excel file) is required.' },
        { status: 400 }
      );
    }
    if (!websiteUrl) {
      return Response.json(
        { ok: false, error: 'Vendor website URL is required.' },
        { status: 400 }
      );
    }

    // Save uploaded file so the pipeline can use it later
    const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload.xlsx';
    const filePath = path.join(uploadsDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    // TODO: Run pipeline here (no LLM calls yet).
    // - parseSheet({ filePath, sheetIndex, headerRow, skuColumn })
    // - for each product: searchVendorSite(openai, websiteUrl, sku, description)
    // - for each product: generateListing(openai, product, skuColumn, priceColumn, vendorData)
    // - write listings to data/listings/ and return them

    return Response.json({
      ok: true,
      message: 'Request received. Pipeline integration coming next.',
      listings: [],
    });
  } catch (err) {
    console.error('generate-listings API error:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 }
    );
  }
}
