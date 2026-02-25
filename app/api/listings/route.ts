import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

const PREFIX = 'listings/';

/** Disable static/cache so listing always reflects current blob store (e.g. after sync). */
export const dynamic = 'force-dynamic';

/** GET /api/listings — returns tree: { folders: { [folderName]: string[] } } (file pathnames under each folder) */
export async function GET() {
  const token = process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Blob store not configured' }, { status: 503 });
  }

  const pathnames: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await list({
      prefix: PREFIX,
      limit: 1000,
      cursor,
      token,
    });
    for (const blob of result.blobs ?? []) {
      if (blob.pathname) pathnames.push(blob.pathname);
    }
    cursor = result.cursor;
  } while (cursor);

  // Build tree: pathname is "listings/tab_01_most_popular/DYN-6103-01.json"
  const folders: Record<string, string[]> = {};
  for (const pathname of pathnames) {
    if (!pathname.startsWith(PREFIX)) continue;
    const rest = pathname.slice(PREFIX.length);
    const parts = rest.split('/');
    if (parts.length < 2) continue; // skip root-level files if any
    const [folder, ...fileParts] = parts;
    const fileName = fileParts.join('/');
    if (folder.startsWith('_') || fileName.startsWith('_')) continue;
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(fileName);
  }

  // Sort folder names, sort files within each folder
  const sorted: Record<string, string[]> = {};
  for (const folder of Object.keys(folders).sort()) {
    sorted[folder] = [...folders[folder]].sort();
  }

  return NextResponse.json({ folders: sorted }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
