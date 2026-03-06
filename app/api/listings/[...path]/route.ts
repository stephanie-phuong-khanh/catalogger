import fs from 'fs';
import path from 'path';
import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';

const PREFIX = 'listings/';

/** GET /api/listings/... — returns listing content (from local file or blob) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  if (!pathSegments?.length) {
    return NextResponse.json({ error: 'Path required' }, { status: 400 });
  }

  const decoded = pathSegments.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const relativePath = decoded.join('/');

  const useLocal = process.env.LISTINGS_SOURCE === 'local';

  if (useLocal) {
    const listingsDir = path.resolve(process.cwd(), 'listings');
    const fullPath = path.resolve(listingsDir, relativePath);
    const rel = path.relative(listingsDir, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    const contentType = fullPath.endsWith('.json') ? 'application/json' : 'text/plain';
    return new NextResponse(content, {
      headers: { 'Content-Type': contentType },
    });
  }

  const token = process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Blob store not configured' }, { status: 503 });
  }

  const pathnameRaw = PREFIX + relativePath;
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
