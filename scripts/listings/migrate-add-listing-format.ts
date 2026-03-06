/**
 * Migration: add _listingFormat to existing listing JSONs under listings/.
 * Infers format from path (elina_pilates vs golden_designs). Idempotent.
 *
 * Usage: npm run migrate-add-listing-format
 *        npm run migrate-add-listing-format -- --dry-run
 */

import fs from 'fs';
import path from 'path';

const LISTINGS_DIR = path.join(process.cwd(), 'listings');
const FORMAT_ELINA_PILATES = 'elina_pilates';
const FORMAT_GOLDEN_DESIGNS = 'golden_designs';

function inferFormat(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.includes('elina_pilates')) return FORMAT_ELINA_PILATES;
  if (normalized.includes('golden_designs')) return FORMAT_GOLDEN_DESIGNS;
  // Fallback for any other folder (e.g. legacy tab_03_dynamic_low_emf at root)
  return FORMAT_GOLDEN_DESIGNS;
}

function addFormatToObject(obj: Record<string, unknown>, format: string): boolean {
  if (obj._listingFormat === format) return false;
  // Migrate old key if present
  if ('listingFormat' in obj) delete obj.listingFormat;
  obj._listingFormat = format;
  return true;
}

function migrateFile(filePath: string, format: string, dryRun: boolean): { updated: boolean; reason: string } {
  const content = fs.readFileSync(filePath, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { updated: false, reason: 'invalid JSON' };
  }

  let changed = false;

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === 'object' && addFormatToObject(item as Record<string, unknown>, format)) {
        changed = true;
      }
    }
  } else if (data && typeof data === 'object') {
    changed = addFormatToObject(data as Record<string, unknown>, format);
  } else {
    return { updated: false, reason: 'not object or array' };
  }

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    updated: changed,
    reason: changed ? (dryRun ? 'would add _listingFormat' : 'added _listingFormat') : 'already present',
  };
}

function walkDir(dir: string, baseDir: string, dryRun: boolean): { total: number; updated: number; skipped: number } {
  let total = 0;
  let updated = 0;
  let skipped = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      const sub = walkDir(fullPath, baseDir, dryRun);
      total += sub.total;
      updated += sub.updated;
      skipped += sub.skipped;
      continue;
    }

    if (!entry.name.endsWith('.json')) continue;
    total++;

    const fileFormat = inferFormat(relativePath);
    const result = migrateFile(fullPath, fileFormat, dryRun);

    if (result.updated) {
      updated++;
      console.log(`  ${dryRun ? '[dry-run] ' : ''}${relativePath} → _listingFormat: ${fileFormat}`);
    } else {
      skipped++;
      if (result.reason !== 'already present') {
        console.log(`  skip ${relativePath}: ${result.reason}`);
      }
    }
  }

  return { total, updated, skipped };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(LISTINGS_DIR)) {
    console.log('Listings dir not found:', LISTINGS_DIR);
    process.exit(0);
  }

  console.log('=== Migrate: add _listingFormat to listing JSONs ===');
  console.log('Dir:', LISTINGS_DIR);
  if (dryRun) console.log('Mode: dry-run (no writes)\n');

  const { total, updated, skipped } = walkDir(LISTINGS_DIR, LISTINGS_DIR, dryRun);

  console.log('\nDone.');
  console.log(`  Total .json: ${total}`);
  console.log(`  ${dryRun ? 'Would update' : 'Updated'}: ${updated}`);
  console.log(`  Unchanged: ${skipped}`);
}

main();
