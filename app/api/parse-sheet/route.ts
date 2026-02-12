import { NextRequest } from 'next/server';
import { parseWorkbookFromBuffer } from '../../../lib/parse-sheet';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const websiteUrl = formData.get('websiteUrl')?.toString()?.trim() ?? '';

    if (!file || !(file instanceof File)) {
      return Response.json(
        { ok: false, error: 'Pricing sheet (Excel file) is required.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tabs = parseWorkbookFromBuffer(buffer);

    return Response.json({
      ok: true,
      tabs,
      vendorUrl: websiteUrl || undefined,
    });
  } catch (err) {
    console.error('parse-sheet API error:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 }
    );
  }
}
