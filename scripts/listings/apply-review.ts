/**
 * Apply reviewer corrections from an exported review JSON to elina_sku_to_images.json.
 *
 * Usage:
 *   npm run apply-review -- --file ~/Downloads/review-100006.json
 *   npm run apply-review -- --file ./data/elina/review/100006/review-data.json --out-file data/parsed-pricing-sheets/elina_sku_to_images.json
 *
 * The --file must be the JSON you downloaded after editing the review HTML
 * (Export corrections). It contains: skuKey, vendor_to_folder_index, include_extras,
 * vendor_urls, folder_files.
 */

import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
  outFile: 'data/parsed-pricing-sheets/elina_sku_to_images.json',
};

type FolderFile = { index: number; relativePath: string; name: string };
type ReviewPayload = {
  skuKey: string;
  folder_path?: string;
  vendor_to_folder_index: (number | null)[];
  include_extras: string[];
  vendor_urls: string[];
  folder_files: FolderFile[];
};

type SkuImageMapping = {
  vendor_site_images: string[];
  folder_path: string;
  selected_folder_images: string[];
  missing_from_folder: string[];
};

type SkuToImagesOutput = { skus: Record<string, SkuImageMapping> };

function parseArg(name: string, defaultValue: string): string {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.split('=').slice(1).join('=').trim();
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return defaultValue;
}

function main() {
  const fileArg = parseArg('file', '');
  const outFile = parseArg('out-file', CONFIG.outFile);

  if (!fileArg || !fs.existsSync(fileArg)) {
    console.error('Usage: npm run apply-review -- --file <path-to-downloaded-review.json> [--out-file=...]');
    console.error('The file is the JSON you downloaded from the review page (Export corrections).');
    process.exit(1);
  }

  let payload: ReviewPayload;
  try {
    payload = JSON.parse(fs.readFileSync(fileArg, 'utf-8')) as ReviewPayload;
  } catch (e) {
    console.error('Invalid JSON in', fileArg, e);
    process.exit(1);
  }

  const { skuKey, folder_path: payloadFolderPath, vendor_to_folder_index, include_extras, vendor_urls, folder_files } = payload;
  if (!skuKey || !Array.isArray(vendor_to_folder_index) || !Array.isArray(vendor_urls) || !Array.isArray(folder_files)) {
    console.error('Invalid review JSON: need skuKey, vendor_to_folder_index, vendor_urls, folder_files.');
    process.exit(1);
  }

  const indexToPath = new Map<number, string>();
  folder_files.forEach((f) => indexToPath.set(f.index, f.relativePath));

  const matchedPaths = new Set<string>();
  vendor_to_folder_index.forEach((idx) => {
    if (idx != null && indexToPath.has(idx)) matchedPaths.add(indexToPath.get(idx)!);
  });
  include_extras.forEach((p) => matchedPaths.add(p));

  const selected_folder_images = [...matchedPaths];
  const missing_from_folder = vendor_urls.filter((_, i) => vendor_to_folder_index[i] == null);

  const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);
  if (!fs.existsSync(outPath)) {
    console.error('Output file not found:', outPath);
    process.exit(1);
  }

  let existing: SkuToImagesOutput;
  try {
    existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as SkuToImagesOutput;
    if (!existing.skus) existing.skus = {};
  } catch (e) {
    console.error('Could not read output file:', outPath, e);
    process.exit(1);
  }

  const prev = existing.skus[skuKey];
  const folder_path = payloadFolderPath ?? prev?.folder_path ?? '';

  existing.skus[skuKey] = {
    vendor_site_images: vendor_urls,
    folder_path,
    selected_folder_images,
    missing_from_folder,
  };

  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log('Updated', outPath, 'for SKU', skuKey);
  console.log('  selected_folder_images:', selected_folder_images.length);
  console.log('  missing_from_folder:', missing_from_folder.length);
}

main();
