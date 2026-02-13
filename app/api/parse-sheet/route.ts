import { NextRequest } from 'next/server';
import { del } from '@vercel/blob';
import { parseWorkbookFromBuffer } from '../../../lib/parse-sheet';

/**
 * Parse the pricing sheet. Accepts either:
 * - JSON { blobUrl, websiteUrl }: fetch file from Vercel Blob (used after client upload; avoids 4.5MB limit)
 * - FormData with file + websiteUrl: direct upload (for local dev or small files)
 * When using blobUrl, the blob is deleted after a successful parse to avoid unbounded storage growth.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    let buffer: Buffer;
    let websiteUrl = '';
    let blobUrlToDelete: string | null = null;

    if (contentType.includes('application/json')) {
      const body = await request.json() as { blobUrl?: string; websiteUrl?: string };
      const blobUrl = body.blobUrl?.trim();
      websiteUrl = body.websiteUrl?.toString()?.trim() ?? '';

      if (!blobUrl) {
        return Response.json(
          { ok: false, error: 'blobUrl is required when sending JSON.' },
          { status: 400 }
        );
      }

      blobUrlToDelete = blobUrl;

      const res = await fetch(blobUrl);
      if (!res.ok) {
        return Response.json(
          { ok: false, error: `Failed to fetch file from blob (${res.status}).` },
          { status: 400 }
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      const formData = await request.formData();
      const file = formData.get('file');
      websiteUrl = formData.get('websiteUrl')?.toString()?.trim() ?? '';

      if (!file || !(file instanceof File)) {
        return Response.json(
          { ok: false, error: 'Pricing sheet (Excel file) is required.' },
          { status: 400 }
        );
      }

      buffer = Buffer.from(await file.arrayBuffer());
    }

    const tabs = parseWorkbookFromBuffer(buffer);

    // Delete the blob after successful parse so storage doesn't grow indefinitely
    if (blobUrlToDelete) {
      try {
        await del(blobUrlToDelete);
      } catch (e) {
        console.warn('parse-sheet: failed to delete blob after parse', e);
      }
    }

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
