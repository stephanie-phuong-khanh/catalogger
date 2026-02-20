/**
 * Sync data/listings to Vercel Blob store.
 * - Walks data/listings recursively.
 * - Skips any file or directory whose name starts with _ (e.g. _all_listings.json).
 * - Uploads each file with pathname: listings/<relative-path> (e.g. listings/tab_11_dct_chillers/SKU.json).
 *
 * Modes:
 * - Default: only uploads local files. Does not delete remote blobs. Renames/deletes locally
 *   are not reflected; re-uploading the same pathname may error (no overwrite in this SDK version).
 * - --full: wipes all blobs under listings/ in the store, then uploads current local files.
 *   Use this to make Blob exactly match local (handles renames, deletes, and updates).
 *
 * Requires CATALOGGER_LISTINGS_READ_WRITE_TOKEN in .env or .env.local (from the private listings Blob store).
 *
 * Usage:
 *   npm run sync-listings-to-blob           # upload only (no remote wipe)
 *   npm run sync-listings-to-blob -- --full # full sync: wipe listings/ then upload
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { put, list, del } from '@vercel/blob';

// Load env (support both .env and .env.local)
dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const LISTINGS_DIR = path.join(process.cwd(), 'data', 'listings');
const BLOB_PREFIX = 'listings';

const token = () => process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN!;

async function listAllPathnamesUnderPrefix(prefix: string): Promise<string[]> {
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({
      prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
      limit: 1000,
      cursor,
      token: token(),
    });
    for (const blob of result.blobs ?? []) {
      if (blob.pathname) pathnames.push(blob.pathname);
    }
    cursor = result.cursor;
  } while (cursor);
  return pathnames;
}

function shouldSkip(name: string): boolean {
  return name.startsWith('_');
}

function* walkListingFiles(
  dir: string,
  relativeDir: string = ''
): Generator<{ absolutePath: string; blobPathname: string }> {
  if (!fs.existsSync(dir)) {
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (shouldSkip(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    const rel = relativeDir ? `${relativeDir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      yield* walkListingFiles(abs, rel);
    } else if (ent.isFile() && (ent.name.endsWith('.json') || ent.name.endsWith('.txt'))) {
      yield { absolutePath: abs, blobPathname: `${BLOB_PREFIX}/${rel}` };
    }
  }
}

async function main() {
  if (!process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN) {
    console.error('Missing CATALOGGER_LISTINGS_READ_WRITE_TOKEN. Add it to .env or .env.local (from the private listings Blob store).');
    process.exit(1);
  }

  const fullSync = process.argv.includes('--full');

  if (fullSync) {
    console.log('Full sync: listing existing blobs under listings/...');
    const toDelete = await listAllPathnamesUnderPrefix(BLOB_PREFIX);
    if (toDelete.length > 0) {
      console.log(`  Deleting ${toDelete.length} existing blob(s)...`);
      await del(toDelete, { token: token() });
      console.log('  Done.\n');
    } else {
      console.log('  None found.\n');
    }
  }

  if (!fs.existsSync(LISTINGS_DIR)) {
    console.error('Listings dir not found:', LISTINGS_DIR);
    process.exit(1);
  }

  const files: { absolutePath: string; blobPathname: string }[] = [
    ...walkListingFiles(LISTINGS_DIR),
  ];

  if (files.length === 0) {
    console.log('No listing files to sync (nothing under data/listings besides _*).');
    return;
  }

  console.log(`Uploading ${files.length} file(s) to Vercel Blob (prefix: ${BLOB_PREFIX}/)...\n`);

  for (const { absolutePath, blobPathname } of files) {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    await put(blobPathname, content, {
      access: 'private',
      contentType: blobPathname.endsWith('.json') ? 'application/json' : 'text/plain',
      addRandomSuffix: false,
      token: token(),
    });
    console.log('  ', blobPathname);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
