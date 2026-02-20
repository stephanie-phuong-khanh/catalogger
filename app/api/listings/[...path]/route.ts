import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

const PREFIX = 'listings/';

/** GET /api/listings/tab_01_most_popular/DYN-6103-01.json — returns blob content */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Blob store not configured' }, { status: 503 });
  }

  const { path: pathSegments } = await params;
  if (!pathSegments?.length) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const pathname = PREFIX + pathSegments.join('/');

  const { blobs } = await list({
    prefix: pathname,
    limit: 1,
    token,
  });

  const blob = blobs?.[0];
  if (!blob?.url) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const res = await fetch(blob.url);
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch blob' }, { status: 502 });
  }

  return new NextResponse(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
    },
  });
}
