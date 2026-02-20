import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';

const PREFIX = 'listings/';

/** GET /api/listings/tab_01_most_popular/DYN-6103-01.json — returns blob content (uses get() so private blobs work) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const token = process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Blob store not configured' }, { status: 503 });
  }

  const { path: pathSegments } = await params;
  if (!pathSegments?.length) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  // Decode once (request may have %2520); normalize space to %20 to match Blob pathnames.
  const decoded = pathSegments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const pathnameRaw = PREFIX + decoded.join('/');
  const pathname = pathnameRaw.replace(/ /g, '%20');

  const result = await get(pathname, {
    access: 'private',
    token,
  });

  if (!result || !result.stream) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const contentType = result.blob?.contentType ?? 'application/json';
  return new NextResponse(result.stream, {
    headers: { 'Content-Type': contentType },
  });
}
