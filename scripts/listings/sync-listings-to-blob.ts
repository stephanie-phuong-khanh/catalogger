/**
 * Sync data/listings to Vercel Blob store.
 * - Walks data/listings recursively.
 * - Skips any file or directory whose name starts with _ (e.g. _all_listings.json).
 * - Uploads each file with pathname: listings/<relative-path> (e.g. listings/tab_11_dct_chillers/SKU.json).
 *
 * Modes:
 * - Default: uploads local files and overwrites existing blobs with the same pathname.
 * - --full: wipes all blobs under listings/ in the store, then uploads current local files.
 *   Use this to make Blob exactly match local (handles renames, deletes, and updates).
 * - --single <path>: upload only one file. Path is relative to data/listings (e.g. tab_09_gdina_traditional/GDI-8005-01.json).
 * - --only <path>: upload only files under this subpath (e.g. elina_pilates). Path is relative to data/listings.
 *
 * Requires CATALOGGER_LISTINGS_READ_WRITE_TOKEN in .env or .env.local (from the private listings Blob store).
 *
 * Usage:
 *   npm run sync-listings-to-blob                              # upload all (overwrite existing)
 *   npm run sync-listings-to-blob -- --full                    # full sync: wipe then upload
 *   npm run sync-listings-to-blob -- --single elina_pilates/Reformer-Elite.json  # one file
 *   npm run sync-listings-to-blob -- --only elina_pilates      # only files under data/listings/elina_pilates/
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

const CONFIG = {
  listingsDir: path.join(process.cwd(), 'data', 'listings'),
  blobPrefix: 'listings',
};

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
      yield { absolutePath: abs, blobPathname: `${CONFIG.blobPrefix}/${rel}` };
    }
  }
}

async function main() {
  if (!process.env.CATALOGGER_LISTINGS_READ_WRITE_TOKEN) {
    console.error('Missing CATALOGGER_LISTINGS_READ_WRITE_TOKEN. Add it to .env or .env.local (from the private listings Blob store).');
    process.exit(1);
  }

  const fullSync = process.argv.includes('--full');
  const singleIdx = process.argv.indexOf('--single');
  const singlePath = singleIdx !== -1 ? process.argv[singleIdx + 1]?.trim() : undefined;
  const onlyIdx = process.argv.indexOf('--only');
  const onlyPath = onlyIdx !== -1 ? process.argv[onlyIdx + 1]?.trim() : undefined;

  if (fullSync) {
    console.log('Full sync: listing existing blobs under listings/...');
    const toDelete = await listAllPathnamesUnderPrefix(CONFIG.blobPrefix);
    if (toDelete.length > 0) {
      console.log(`  Deleting ${toDelete.length} existing blob(s)...`);
      await del(toDelete, { token: token() });
      console.log('  Done.\n');
    } else {
      console.log('  None found.\n');
    }
  }

  if (!fs.existsSync(CONFIG.listingsDir)) {
    console.error('Listings dir not found:', CONFIG.listingsDir);
    process.exit(1);
  }

  const startDir = onlyPath
    ? path.join(CONFIG.listingsDir, onlyPath.replace(/^\.\//, '').replace(/\\/g, '/'))
    : CONFIG.listingsDir;
  const initialRelativeDir = onlyPath ? onlyPath.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '') : '';

  if (onlyPath && (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory())) {
    console.error(`Path not found or not a directory: data/listings/${onlyPath}`);
    process.exit(1);
  }

  let files: { absolutePath: string; blobPathname: string }[] = [
    ...walkListingFiles(startDir, initialRelativeDir),
  ];

  if (singlePath) {
    const normalized = singlePath.replace(/^\.\//, '').replace(/\\/g, '/');
    const blobPathname = `${CONFIG.blobPrefix}/${normalized}`;
    const absolutePath = path.join(CONFIG.listingsDir, normalized);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      console.error(`File not found: data/listings/${normalized}`);
      process.exit(1);
    }
    if (shouldSkip(path.basename(normalized))) {
      console.error('Cannot sync files or dirs whose name starts with _.');
      process.exit(1);
    }
    files = [{ absolutePath, blobPathname }];
    console.log(`Syncing 1 file: ${blobPathname}\n`);
  }

  if (files.length === 0) {
    console.log('No listing files to sync (nothing under data/listings besides _*).');
    return;
  }

  if (!singlePath) {
    const scope = onlyPath ? ` (under ${onlyPath}/)` : '';
    console.log(`Uploading ${files.length} file(s) to Vercel Blob (prefix: ${CONFIG.blobPrefix}/)${scope}...\n`);
  }

  for (const { absolutePath, blobPathname } of files) {
    const content = fs.readFileSync(absolutePath, 'utf-8');
    await put(blobPathname, content, {
      access: 'private',
      contentType: blobPathname.endsWith('.json') ? 'application/json' : 'text/plain',
      addRandomSuffix: false,
      token: token(),
      allowOverwrite: true,
    });
    console.log('  ', blobPathname);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
