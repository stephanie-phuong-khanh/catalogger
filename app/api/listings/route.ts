import fs from 'fs';
import path from 'path';
import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

const PREFIX = 'listings/';

/** Disable static/cache so listing always reflects current data (blob or local). */
export const dynamic = 'force-dynamic';

function shouldSkip(name: string): boolean {
  return name.startsWith('_');
}

function* walkListingFiles(dir: string, relativeDir = ''): Generator<string> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (shouldSkip(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = relativeDir ? `${relativeDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      yield* walkListingFiles(abs, rel);
    } else if (ent.isFile() && (ent.name.endsWith('.json') || ent.name.endsWith('.txt'))) {
      yield `${PREFIX}${rel}`;
    }
  }
}

function buildFoldersTree(pathnames: string[]): Record<string, string[]> {
  const folders: Record<string, string[]> = {};
  for (const pathname of pathnames) {
    if (!pathname.startsWith(PREFIX)) continue;
    const rest = pathname.slice(PREFIX.length);
    const parts = rest.split('/');
    if (parts.length < 2) continue;
    const [folder, ...fileParts] = parts;
    const fileName = fileParts.join('/');
    if (folder.startsWith('_') || fileName.startsWith('_')) continue;
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(fileName);
  }
  const sorted: Record<string, string[]> = {};
  for (const folder of Object.keys(folders).sort()) {
    sorted[folder] = [...folders[folder]].sort();
  }
  return sorted;
}

/** GET /api/listings — returns tree: { folders: { [folderName]: string[] } } (file pathnames under each folder) */
export async function GET() {
  const useLocal = process.env.LISTINGS_SOURCE === 'local';

  if (useLocal) {
    const listingsDir = path.join(process.cwd(), 'listings');
    const pathnames = [...walkListingFiles(listingsDir)];
    const folders = buildFoldersTree(pathnames);
    return NextResponse.json({ folders }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

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

  const folders = buildFoldersTree(pathnames);
  return NextResponse.json({ folders }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
