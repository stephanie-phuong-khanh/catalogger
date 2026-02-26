/**
 * Rename image files in a prepared Golden Designs output tree to "SKU (1).ext", "SKU (2).ext", etc.
 * per folder, for easier search and categorization (e.g. in GDrive).
 *
 * Usage:
 *   npm run rename-sku-images -- --root-dir "/path/to/Prepared images: Golden Designs"
 *   npm run rename-sku-images -- --root-dir "/path/to/Prepared images" --dry-run
 *
 * Behavior:
 * - Walks the tree under --root-dir and, for each directory that contains image files,
 *   uses that directory's name as the SKU and renames all images to "SKU (1).ext", "SKU (2).ext", ...
 * - Files are ordered alphabetically by current filename before assigning numbers.
 * - Original extension is preserved (.jpg, .JPG, .png, etc.).
 * - Uses a two-phase rename (temp names then final) so existing "SKU (N).ext" files are not overwritten.
 * - Only .jpg, .jpeg, .png are renamed. PDFs are left as-is. Any other file type causes an error.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Extensions we rename to "SKU (N).ext". No webp. */
const RENAME_EXT = new Set(['.jpg', '.jpeg', '.png']);
/** Extensions we leave unchanged (do not rename). */
const COPY_AS_IS_EXT = new Set(['.pdf']);
const ALLOWED_EXT = new Set([...RENAME_EXT, ...COPY_AS_IS_EXT]);
const TEMP_PREFIX = '.__gd_rename_';

/** When this folder name is encountered, images are named after the grandparent + " - Discontinued (N).ext". */
const DISCONTINUED_SUBFOLDER_NAME = 'LED Control Panel - Discontinued 2024';

/**
 * Hardcoded folder name → SKU overrides. Use when the folder name is long/wrong but the desired
 * image prefix is shorter (e.g. "GDI-8010-03 Final Updated Images 07-15-2024" → "GDI-8010-03").
 * Add more entries as needed; safe to re-run the script to fix already-renamed folders.
 */
const FOLDER_TO_SKU_OVERRIDE: Record<string, string> = {
  'MX-J206-01 Seattle': 'MX-J206-01',
  'MX-J306-01 Bellevue': 'MX-J306-01',
  'MX-K206-01 Hemlock': 'MX-K206-01',
  'MX-K306-01 Hemlock': 'MX-K306-01',
  'MX-K356-01 Hemlock': 'MX-K356-01',
  'MX-K406-01 Hemlock': 'MX-K406-01',
  'GDI‐B002‐01 St. Moritz ‐ Barrel Sauna': 'GDI-B002-01',
  'GDI‐B004‐01 Arosa ‐ Barrel Sauna': 'GDI-B004-01',
  'GDI‐B006‐01 Klosters ‐ Barrel Sauna': 'GDI-B006-01',
  'GDI‐B024‐01 Zurich ‐ Barrel Sauna - Acrylic': 'GDI-B024-01',
  'GDI-8523-01 Loviisa': 'GDI-8523-01',
  'GDI-8526-01 Kaskinen': 'GDI-8526-01',
  'GDI-8506-01 Kaarina': 'GDI-8506-01',
  'GDI-8125-01 Gargellen': 'GDI-8125-01',
  'GDI‐8123‐01 Carinthia': 'GDI-8123-01',
  'GDI‐8103‐01 Arlberg': 'GDI-8103-01',
  'GDI‐8105‐01 Vorarlberg': 'GDI-8105-01',
  'GDI-8222-01 Nora': 'GDI-8222-01',
  'GDI-8226-01 Karlstad': 'GDI-8226-01',
  'GDI‐8223‐01 Visby': 'GDI-8223-01',
  'GDI-8203-01 Drammen': 'GDI-8203-01',
  'GDI-8206-01 Bergen': 'GDI-8206-01',
  'GDI‐8202‐01 Narvik': 'GDI-8202-01',
  'GDI-7202-01 Hanko': 'GDI-7202-01',
  'GDI-7203-01 Forssa': 'GDI-7203-01',
  'GDI-7206-01 Kuusamo': 'GDI-7206-01',
  'GDI‐7202‐01 Hanko': 'GDI-7202-01',
  'GDI‐7203‐01 Forssa': 'GDI-7203-01',
  'GDI‐7206‐01 Kuusamo': 'GDI-7206-01',
  'GDI-8503-01  Savonlinna': 'GDI-8503-01',
  'GDI‐7289‐02 Sundsvall 2024-25': 'GDI-7289-02',
  'GDI‐7389‐02 Copenhagen 2024-25': 'GDI-7389-02',
  'GDI‐7689‐02 Osla 2024-25': 'GDI-7689-02',
  'GDI-7289-02 Sundsvall 2024-25': 'GDI-7289-02',
  'GDI-7389-02 Copenhagen 2024-25': 'GDI-7389-02',
  'GDI-7689-02 Osla 2024-25': 'GDI-7689-02',
  'GDI-8010-03 Final Updated Images 07-15-2024': 'GDI-8010-03',
  'GDI-8020-03 Final Updated Images 07-15-2024': 'GDI-8020-03',
  'GDI-8030-03 Final Updated Images 07-15-2024': 'GDI-8030-03',
  'GDI-8040-03 Final Updated Images 07-15-2024': 'GDI-8040-03',
  'MX-M206-01 FS Images Updated 03-01-2024': 'MX-M206-01 FS',
  'MX-M306-01 FS Images Updated 03-01-2024': 'MX-M306-01 FS',
  'MX-M356-01 FS Images Updated 03-01-2024': 'MX-M356-01 FS',
  'Hybrid Sauna Electrical 10-28-2024': 'Hybrid Sauna Electrical',
};

/** File names to skip (not validate, not rename). e.g. macOS .DS_Store */
const IGNORED_FILE_NAMES = new Set(['.DS_Store']);

function parseArg(name: string): string | undefined {
  const i = process.argv.findIndex((arg) => arg === name || arg.startsWith(name + '='));
  if (i === -1) return undefined;
  const arg = process.argv[i];
  if (arg.includes('=')) {
    return arg.split('=').slice(1).join('=').trim();
  }
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function expandTilde(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function isRenameableImage(name: string): boolean {
  return RENAME_EXT.has(path.extname(name).toLowerCase());
}

function isCopyAsIs(name: string): boolean {
  return COPY_AS_IS_EXT.has(path.extname(name).toLowerCase());
}

function checkAllowedExt(filePath: string, fileName: string): void {
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(
      `Unexpected file type: ${path.extname(fileName)} in ${filePath}. ` +
        `Only .jpg, .jpeg, .png are renamed; .pdf are left as-is.`
    );
  }
}

/**
 * Collect all directories that contain at least one renameable image (recursively under dir).
 * Validates that every file in each dir has an allowed extension; throws on unknown types.
 */
function collectSkuDirs(rootDir: string): string[] {
  const skuDirs: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const fileEntries = entries.filter((e) => e.isFile());
    for (const e of fileEntries) {
      if (IGNORED_FILE_NAMES.has(e.name)) continue;
      checkAllowedExt(path.join(dir, e.name), e.name);
    }
    const renameableCount = fileEntries.filter(
      (e) => !IGNORED_FILE_NAMES.has(e.name) && isRenameableImage(e.name)
    ).length;
    if (renameableCount > 0) {
      skuDirs.push(dir);
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(path.join(dir, e.name));
      }
    }
  }
  walk(rootDir);
  return skuDirs;
}

function main() {
  const rootDirRaw = parseArg('--root-dir');
  const dryRun = hasFlag('--dry-run');
  if (!rootDirRaw) {
    console.error('Missing --root-dir argument.');
    console.error('Usage: npm run rename-sku-images -- --root-dir "/path/to/Prepared images" [--dry-run]');
    process.exit(1);
  }
  const rootDir = expandTilde(rootDirRaw);

  if (!fs.existsSync(rootDir)) {
    console.error('Root directory does not exist:', rootDir);
    process.exit(1);
  }

  const skuDirs = collectSkuDirs(rootDir);
  console.log(`Found ${skuDirs.length} folder(s) with images under ${rootDir}`);
  if (dryRun) {
    console.log('(dry run – no files will be changed)\n');
  }

  let totalRenamed = 0;
  for (const dir of skuDirs) {
    const folderName = path.basename(dir);
    const sku =
      folderName === DISCONTINUED_SUBFOLDER_NAME
        ? path.basename(path.dirname(dir)) + ' - Discontinued'
        : FOLDER_TO_SKU_OVERRIDE[folderName] ?? folderName;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && isRenameableImage(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const copyAsIsFiles = entries
      .filter((e) => e.isFile() && isCopyAsIs(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    if (files.length === 0) continue;

    // Two-phase rename to avoid overwriting existing "SKU (N).ext"
    // Phase 1: current name -> temp name
    // Phase 2: temp name -> "SKU (i).ext"
    const renames: { from: string; to: string }[] = [];
    const tempNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const ext = path.extname(files[i]); // preserve original case
      tempNames.push(`${TEMP_PREFIX}${i}${ext}`);
    }
    for (let i = 0; i < files.length; i++) {
      renames.push({ from: path.join(dir, files[i]), to: path.join(dir, tempNames[i]) });
    }
    for (let i = 0; i < files.length; i++) {
      const ext = path.extname(files[i]);
      const finalName = `${sku} (${i + 1})${ext}`;
      renames.push({ from: path.join(dir, tempNames[i]), to: path.join(dir, finalName) });
    }

    console.log(`\n${path.relative(rootDir, dir) || sku} (${files.length} images)`);
    for (let i = 0; i < files.length; i++) {
      const ext = path.extname(files[i]);
      const finalName = `${sku} (${i + 1})${ext}`;
      console.log(`  ${files[i]}  →  ${finalName}`);
    }
    if (copyAsIsFiles.length > 0) {
      for (const name of copyAsIsFiles) {
        console.log(`  ${name}  →  (copied verbatim)`);
      }
    }

    if (!dryRun) {
      for (const { from, to } of renames) {
        fs.renameSync(from, to);
      }
    }
    totalRenamed += files.length;
  }

  console.log('\n' + (dryRun ? 'Would rename' : 'Renamed') + ` ${totalRenamed} file(s) total.`);
}

main();
