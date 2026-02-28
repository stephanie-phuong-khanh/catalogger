/**
 * Map ONE SKU to its image folder using LLM tree-walk (OpenAI gpt-4o-mini).
 * Writes/merges into a single output file: SKU → input_folder_path, output_folder_path.
 *
 * READ-ONLY on --image-root: only reads directory structure. All writes go to --out-file.
 *
 * Usage:
 *   npm run map-sku-to-images -- --sku "100006" --image-root /path/to/elina_images
 *   npm run map-sku-to-images -- --sku "100006" --image-root ./data/elina_images --out-file data/parsed-pricing-sheets/elina_sku_to_images.json
 *   Output is written to --output-dir (default: data/elina/processed). Use that to create the per-SKU folder and run the (placeholder) edit+write step after confirm.
 *   Add --yes to skip the "Does this look correct? (y/n)" prompt and proceed as if yes.
 *
 * Writes vendor_site_photos.jpg (stacked vendor site images) to the per-SKU output folder.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import sharp from 'sharp';
import { processImage, saveProcessedImage } from '../../lib/images/edit-image';
import { createVisionClient } from '../../lib/images/vision-client';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const CONFIG = {
  inputFile: 'data/parsed-pricing-sheets/elina_pilates_products_site.json',
  outFile: 'data/parsed-pricing-sheets/elina_sku_to_images.json',
  imageRootDefault: '/Users/sdoan/Google Drive/My Drive/Elina Pilates',
  outputDirDefault: '/Users/sdoan/Google Drive/My Drive/Prepared images: Elina Pilates <> Dansons',
  imageExtensions: new Set(['.jpg', '.jpeg', '.png', '.webp']),
};

type Item = { article_ref: string; [k: string]: unknown };
type Site = { product_name?: string; reference?: string; image_urls?: string[]; [k: string]: unknown };
type Group = { product_name?: string; items: Item[]; site?: Site };
type SiteInput = { groups: Group[] };

export type SkuImageMapping = {
  input_folder_path: string;
  output_folder_path?: string;
};

export type SkuToImagesOutput = {
  skus: Record<string, SkuImageMapping>;
};

function parseArg(name: string, defaultValue: string): string {
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.split('=').slice(1).join('=').trim();
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].trim();
  return defaultValue;
}

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function askLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Reject = halt. Accept = proceed. Amend = prompt for new folder path, then proceed with it. */
async function askConfirmWithAmend(options: {
  productName: string;
  productColor: string | null;
  vendorUrl: string | null;
  folderPath: string;
  outputDirPathRelative: string | null;
}): Promise<{ action: 'reject' | 'accept'; folderPath: string }> {
  const { productName, productColor, vendorUrl, folderPath, outputDirPathRelative } = options;
  console.log('\n' + '─'.repeat(60));
  console.log('  Product:  ' + productName);
  console.log('  Color:    ' + (productColor ?? '(none)'));
  if (vendorUrl) {
    console.log('  Vendor:   ' + vendorUrl);
  } else {
    console.log('  Vendor:   (no URL in data)');
  }
  console.log('');
  console.log('  Mapped Folder:  ' + folderPath);
  console.log('');
  if (outputDirPathRelative) console.log('  Will write output to:  ' + outputDirPathRelative);
  console.log('─'.repeat(60));

  for (;;) {
    const raw = await askLine('Accept (y), Reject (n), Amend path (a)? [y] ');
    const choice = raw.toLowerCase().trim();
    if (choice === '' || choice === 'y' || choice === 'yes' || choice === 'accept') {
      return { action: 'accept', folderPath };
    }
    if (choice === 'r' || choice === 'reject' || choice === 'n' || choice === 'no') {
      return { action: 'reject', folderPath };
    }
    if (choice === 'a' || choice === 'amend') {
      const newPath = await askLine('Enter folder path: ');
      if (newPath) {
        console.log('Using amended path:', newPath);
        return { action: 'accept', folderPath: newPath };
      }
      console.log('Empty path ignored. Accept (y), Reject (n), Amend path (a).');
    } else {
      console.log('Accept (y), Reject (n), Amend path (a).');
    }
  }
}

/** All but the final segment of folder_path (e.g. "Reformers/Elite/Reformer Élite gris" -> "Reformers/Elite"). */
function parentOfFolderPath(folderPath: string): string {
  const segments = folderPath.split(/[/\\]/).filter(Boolean);
  if (segments.length <= 1) return '';
  return segments.slice(0, -1).join(path.sep);
}

/** Output extension: webp → jpg, else keep original (lowercase). */
function outputExtForInput(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === '.webp') return '.jpg';
  return ext || '.jpg';
}

/**
 * Process folder images (crop/resize via lib/images) and write to output dir as SKU (N).ext.
 * When productColor is set and filenames are not numeric, filters to images matching that color.
 * On process error, saves original as SKU (N) [ORIG].ext.
 */
async function runEditAndWrite(
  skuKey: string,
  folderPath: string,
  imageRoot: string,
  skuOutputDirFull: string,
  productColor: string | null,
): Promise<void> {
  const allPaths = listImageFilesUnder(imageRoot, folderPath);
  const { paths: imagePaths, message: filterMessage } = filterImagesByColor(allPaths, productColor);
  if (filterMessage) console.log('[map-sku] ' + filterMessage);
  if (imagePaths.length === 0) {
    console.log('[map-sku] No images in folder; nothing to write.');
    return;
  }

  if (!fs.existsSync(skuOutputDirFull)) fs.mkdirSync(skuOutputDirFull, { recursive: true });

  const visionClient = createVisionClient();
  let processed = 0;
  let savedOriginal = 0;

  for (let i = 0; i < imagePaths.length; i++) {
    const rel = imagePaths[i];
    const srcFull = path.join(imageRoot, rel);
    const n = i + 1;
    const outExt = outputExtForInput(rel);
    const outName = `${skuKey} (${n})${outExt}`;
    const outPath = path.join(skuOutputDirFull, outName);

    console.log(`[map-sku] [${n}/${imagePaths.length}] ${path.basename(rel)} → ${outName}`);

    const buffer = fs.readFileSync(srcFull);
    try {
      const processedBuffer = await processImage(buffer, 1500, 1500, visionClient);
      saveProcessedImage(processedBuffer, outPath);
      processed += 1;
    } catch (err) {
      const origName = `${skuKey} (${n}) [ORIG]${outExt}`;
      const origPath = path.join(skuOutputDirFull, origName);
      saveProcessedImage(buffer, origPath);
      savedOriginal += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[map-sku]   Error: ${msg}; saved original as ${origName}`);
    }
  }

  console.log(`[map-sku] Wrote ${processed} processed, ${savedOriginal} originals (on error) to ${skuOutputDirFull}`);
}

const VENDOR_STRIP_WIDTH = 400;
const VENDOR_STRIP_GAP_PX = 16;

/**
 * Fetch vendor site images, resize to low-res, stack vertically with white gaps, save as vendor_site_photos.jpg.
 */
async function buildVendorStrip(vendorImageUrls: string[], skuOutputDirFull: string): Promise<void> {
  if (vendorImageUrls.length === 0) {
    console.log('[map-sku] No vendor site images; skipping vendor_site_photos.jpg');
    return;
  }

  const resized: { buffer: Buffer; width: number; height: number }[] = [];
  for (let i = 0; i < vendorImageUrls.length; i++) {
    try {
      const res = await fetch(vendorImageUrls[i], {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; catalogger/1.0)' },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      if (w === 0 || h === 0) continue;
      const out = await sharp(buf)
        .resize(VENDOR_STRIP_WIDTH, undefined, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      const outMeta = await sharp(out).metadata();
      resized.push({
        buffer: out,
        width: outMeta.width ?? VENDOR_STRIP_WIDTH,
        height: outMeta.height ?? 0,
      });
    } catch {
      // skip failed fetch
    }
  }

  if (resized.length === 0) {
    console.log('[map-sku] Could not fetch any vendor images; skipping vendor_site_photos.jpg');
    return;
  }

  const totalHeight =
    resized.reduce((sum, r) => sum + r.height, 0) + VENDOR_STRIP_GAP_PX * (resized.length - 1);
  const stripWidth = Math.max(...resized.map((r) => r.width), VENDOR_STRIP_WIDTH);

  const whiteBg = await sharp({
    create: {
      width: stripWidth,
      height: Math.round(totalHeight),
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const composites: { input: Buffer; top: number; left: number }[] = [];
  let y = 0;
  for (const r of resized) {
    const left = Math.round((stripWidth - r.width) / 2);
    composites.push({ input: r.buffer, top: y, left });
    y += r.height + VENDOR_STRIP_GAP_PX;
  }

  const outPath = path.join(skuOutputDirFull, 'vendor_site_photos.jpg');
  await sharp(whiteBg)
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(outPath);

  console.log(`[map-sku] Wrote vendor_site_photos.jpg (${resized.length} images) to ${skuOutputDirFull}`);
}

function resolveSku(input: SiteInput, skuArg: string): {
  skuKey: string;
  productName: string;
  productColor: string | null;
  vendorUrl: string | null;
  vendorSiteImages: string[];
} {
  const norm = (s: string) => s.replace(/^ELN\s+/i, '').trim();
  const want = norm(skuArg);
  for (const group of input.groups ?? []) {
    for (const item of group.items ?? []) {
      if (norm(item.article_ref) === want) {
        const raw = (item as unknown as { color?: string; url?: string }).color;
        const url = (item as unknown as { url?: string }).url;
        const color = typeof raw === 'string' ? raw.trim() : null;
        const imageUrls = Array.isArray(group.site?.image_urls) ? group.site.image_urls : [];
        return {
          skuKey: item.article_ref,
          productName: group.site?.product_name ?? group.product_name ?? item.article_ref,
          productColor: color || null,
          vendorUrl: typeof url === 'string' ? url.trim() : null,
          vendorSiteImages: imageUrls,
        };
      }
    }
  }
  throw new Error(`SKU not found: ${skuArg}. Use article_ref (e.g. 100006).`);
}

interface DirNode {
  name: string;
  relativePath: string;
  children: DirNode[];
  hasImages: boolean;
}

function buildFolderTree(imageRoot: string, relativeDir = ''): DirNode[] {
  const fullPath = path.join(imageRoot, relativeDir);
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());
  const hasImagesHere = files.some((f) => CONFIG.imageExtensions.has(path.extname(f.name).toLowerCase()));
  const childTrees: DirNode[] = [];
  for (const d of dirs) {
    const childRel = relativeDir ? `${relativeDir}/${d.name}` : d.name;
    const childNodes = buildFolderTree(imageRoot, childRel);
    const hasImagesBelow = hasImagesHere || childNodes.some((c) => c.hasImages);
    childTrees.push({
      name: d.name,
      relativePath: childRel,
      children: childNodes,
      hasImages: hasImagesBelow,
    });
  }
  return childTrees;
}

function listImageFilesUnder(imageRoot: string, folderPath: string): string[] {
  const full = path.join(imageRoot, folderPath);
  const out: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dir, e.name);
      const rel = path.relative(imageRoot, fullPath);
      if (e.isDirectory()) walk(fullPath);
      else if (CONFIG.imageExtensions.has(path.extname(e.name).toLowerCase())) out.push(rel.replace(/\\/g, '/'));
    }
  }
  walk(full);
  return out.sort();
}

/** Product color (from site) → filename substrings that indicate that color (e.g. gris, negro). */
const COLOR_FILENAME_TOKENS: Record<string, string[]> = {
  GREY: ['gris', 'grey', 'gray'],
  GRAY: ['gris', 'grey', 'gray'],
  BLACK: ['negro', 'black'],
  WHITE: ['blanco', 'white'],
  RED: ['rojo', 'red'],
  BLUE: ['azul', 'blue'],
  GREEN: ['verde', 'green'],
  IVORY: ['marfil', 'ivory'],
  MOCHA: ['mocha'],
};

function isNumericBasename(relativePath: string): boolean {
  const base = path.basename(relativePath, path.extname(relativePath));
  return /^\d+$/.test(base.trim());
}

/**
 * When folder has mixed colors, filter to images whose filename suggests this product's color.
 * If filenames look numeric (e.g. 1.jpg) or no files match, return all and log so user can curate.
 */
function filterImagesByColor(
  imagePaths: string[],
  productColor: string | null,
): { paths: string[]; message: string } {
  if (!productColor || imagePaths.length === 0) {
    return { paths: imagePaths, message: '' };
  }
  const tokens = COLOR_FILENAME_TOKENS[productColor.toUpperCase().trim()];
  if (!tokens || tokens.length === 0) {
    return { paths: imagePaths, message: `No filename tokens for color "${productColor}"; processing all ${imagePaths.length} images.` };
  }
  const numericCount = imagePaths.filter((p) => isNumericBasename(p)).length;
  if (numericCount >= imagePaths.length / 2) {
    return {
      paths: imagePaths,
      message: `Filenames look numeric; not filtering by color. Processing all ${imagePaths.length} images.`,
    };
  }
  const lower = tokens.map((t) => t.toLowerCase());
  const filtered = imagePaths.filter((rel) => {
    const name = path.basename(rel, path.extname(rel)).toLowerCase();
    return lower.some((t) => name.includes(t));
  });
  if (filtered.length === 0) {
    return {
      paths: imagePaths,
      message: `No files matched color (${productColor}); processing all ${imagePaths.length} images. Check if folder has multiple colors.`,
    };
  }
  return {
    paths: filtered,
    message: `Filtered to ${filtered.length} images by color (${productColor}).`,
  };
}

function folderHasImages(imageRoot: string, folderPath: string): boolean {
  return listImageFilesUnder(imageRoot, folderPath).length > 0;
}

function treeWalkPrompt(
  productName: string,
  skuKey: string,
  productColor: string | null,
  currentPath: string,
  childNames: string[],
  currentHasImages: boolean,
): string {
  const atRoot = currentPath === '';
  const canChooseCurrent = !atRoot && currentHasImages;
  const colorLine = productColor
    ? `Product color: ${productColor} — when child folder names include a color (e.g. gris, negro, grey, black), choose the folder that matches this product's color.\n\n`
    : '';
  const instruction = atRoot
    ? 'You are at the ROOT. Do NOT reply CURRENT. Reply with the exact name of ONE child folder from the list above to descend into.'
    : canChooseCurrent
      ? 'Reply with exactly one of:\n- CURRENT — if this folder (not a child) is the one that contains this product\'s image files.\n- Or the exact name of one child folder to go into.'
      : 'Reply with the exact name of one child folder to go into (do not reply CURRENT — this folder has no image files).';
  return `You are choosing the correct image folder for a Pilates equipment product.

Product name: ${productName}
SKU: ${skuKey}
${colorLine}Current folder path: ${currentPath || '(root)'}
Direct child folder names: ${childNames.length ? childNames.join(', ') : '(none)'}
${currentHasImages ? 'This folder (or its descendants) has image files.' : 'No images here.'}

${instruction}

Reply with only that one word or name, nothing else.`;
}

async function pickChildOrCurrentOpenAI(
  openai: OpenAI,
  productName: string,
  skuKey: string,
  productColor: string | null,
  currentPath: string,
  childNames: string[],
  currentHasImages: boolean,
): Promise<'CURRENT' | string> {
  const prompt = treeWalkPrompt(productName, skuKey, productColor, currentPath, childNames, currentHasImages);
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 100,
  });
  const text = (response.choices[0]?.message?.content ?? '').trim();
  const atRoot = currentPath === '';
  if (!atRoot && /^CURRENT$/i.test(text)) return 'CURRENT';
  const match = childNames.find((c) => c === text || c.toLowerCase() === text.toLowerCase());
  if (match) return match;
  if (childNames.length === 0) return 'CURRENT';
  return childNames[0];
}

type TreeWalkPicker = (
  productName: string,
  skuKey: string,
  productColor: string | null,
  currentPath: string,
  childNames: string[],
  currentHasImages: boolean,
) => Promise<'CURRENT' | string>;

async function treeWalkToFolder(
  imageRoot: string,
  productName: string,
  skuKey: string,
  productColor: string | null,
  pick: TreeWalkPicker,
): Promise<string> {
  const rootChildren = buildFolderTree(imageRoot, '');
  let currentPath = '';
  let currentChildren = rootChildren;
  let step = 0;

  for (;;) {
    step += 1;
    const childNames = currentChildren.map((c) => c.name);
    const currentHasImages = folderHasImages(imageRoot, currentPath);
    const pathLabel = currentPath || '(root)';
    const childrenLabel = childNames.length > 0 ? childNames.join(', ') : '(none — leaf or empty)';
    console.log(`[map-sku] Step ${step}: At ${pathLabel}`);
    console.log(`[map-sku]   Children: ${childrenLabel}`);
    console.log(`[map-sku]   Has images here: ${currentHasImages ? 'yes' : 'no'}`);

    const choice = await pick(productName, skuKey, productColor, currentPath, childNames, currentHasImages);
    console.log(`[map-sku]   → Chose: ${choice}`);

    if (choice === 'CURRENT') {
      console.log(`[map-sku] Stop: model said CURRENT (this folder is the product's image folder).`);
      return currentPath || '.';
    }
    const next = currentChildren.find((c) => c.name === choice || c.name.toLowerCase() === choice.toLowerCase());
    if (!next) {
      console.log(`[map-sku] Stop: choice did not match any child; using current folder.`);
      return currentPath || '.';
    }
    currentPath = next.relativePath;
    currentChildren = next.children;
  }
}

async function main() {
  const inputFile = parseArg('input-file', CONFIG.inputFile);
  const outFile = parseArg('out-file', CONFIG.outFile);
  const imageRoot = parseArg('image-root', CONFIG.imageRootDefault);
  const outputDirArg = parseArg('output-dir', CONFIG.outputDirDefault);
  const skuArg = parseArg('sku', '');
  const skipConfirm = parseFlag('yes');

  if (!skuArg) {
    console.error(
      'Usage: npx ts-node scripts/listings/map-sku-to-images.ts --sku <article_ref> --image-root <path> [--input-file=...] [--out-file=...] [--output-dir=...] [--yes]',
    );
    process.exit(1);
  }
  if (!imageRoot || !fs.existsSync(imageRoot)) {
    console.error('--image-root must be an existing directory.');
    process.exit(1);
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    console.error('OPENAI_API_KEY is required (tree-walk uses gpt-4o-mini).');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  const input: SiteInput = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const { skuKey, productName, productColor, vendorUrl, vendorSiteImages } = resolveSku(input, skuArg);
  console.log(`[map-sku] SKU: ${skuKey}, product: ${productName}, color: ${productColor ?? '(none)'}`);

  const openai = new OpenAI({ apiKey: openaiKey });
  const picker: TreeWalkPicker = (name, sku, color, curr, children, hasImg) =>
    pickChildOrCurrentOpenAI(openai, name, sku, color, curr, children, hasImg);

  console.log('[map-sku] Tree-walk to select folder...');
  let folderPath = await treeWalkToFolder(imageRoot, productName, skuKey, productColor, picker);
  console.log('[map-sku] Selected folder:', folderPath);

  const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);
  const outputDirResolved = outputDirArg
    ? path.isAbsolute(outputDirArg)
      ? outputDirArg
      : path.join(process.cwd(), outputDirArg)
    : '';
  const parentSegments = parentOfFolderPath(folderPath);
  const skuOutputDirFull = outputDirResolved
    ? path.join(outputDirResolved, parentSegments, skuKey)
    : '';
  const outputDirPathRelative = outputDirResolved
    ? path.relative(outputDirResolved, skuOutputDirFull)
    : null;

  let result: { action: 'reject' | 'accept'; folderPath: string };
  if (skipConfirm) {
    result = { action: 'accept', folderPath };
  } else {
    result = await askConfirmWithAmend({
      productName,
      productColor,
      vendorUrl,
      folderPath,
      outputDirPathRelative,
    });
  }

  if (result.action === 'reject') {
    console.log('[map-sku] Rejected. No files written.');
    process.exit(0);
  }
  folderPath = result.folderPath;

  const mapping: SkuImageMapping = {
    input_folder_path: folderPath,
    ...(outputDirPathRelative ? { output_folder_path: outputDirPathRelative } : {}),
  };
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let existing: SkuToImagesOutput = { skus: {} };
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as SkuToImagesOutput;
      if (!existing.skus) existing.skus = {};
    } catch {
      // start fresh
    }
  }
  existing.skus[skuKey] = mapping;
  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log('[map-sku] Wrote', outPath);

  if (outputDirResolved && skuOutputDirFull) {
    await runEditAndWrite(skuKey, folderPath, imageRoot, skuOutputDirFull, productColor);
    await buildVendorStrip(vendorSiteImages, skuOutputDirFull);
  } else {
    console.log('[map-sku] (Omit --output-dir to skip edit+write step; use --output-dir <path> to create per-SKU output folder.)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
