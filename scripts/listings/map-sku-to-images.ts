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
 * TODO: Vendor site photo strip — Fetch images from vendor site (from site input), resize to low-res,
 * stack vertically with white spacing into one composite image, and save in the per-SKU output folder.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';
import OpenAI from 'openai';
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
 * On process error, saves original as SKU (N) [ORIG].ext.
 * TODO: Vendor site photo strip — fetch vendor images, stack into one composite, save in skuOutputDirFull.
 */
async function runEditAndWrite(
  skuKey: string,
  folderPath: string,
  imageRoot: string,
  skuOutputDirFull: string,
): Promise<void> {
  const imagePaths = listImageFilesUnder(imageRoot, folderPath);
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

function resolveSku(input: SiteInput, skuArg: string): {
  skuKey: string;
  productName: string;
  productColor: string | null;
  vendorUrl: string | null;
} {
  const norm = (s: string) => s.replace(/^ELN\s+/i, '').trim();
  const want = norm(skuArg);
  for (const group of input.groups ?? []) {
    for (const item of group.items ?? []) {
      if (norm(item.article_ref) === want) {
        const raw = (item as unknown as { color?: string; url?: string }).color;
        const url = (item as unknown as { url?: string }).url;
        const color = typeof raw === 'string' ? raw.trim() : null;
        return {
          skuKey: item.article_ref,
          productName: group.site?.product_name ?? group.product_name ?? item.article_ref,
          productColor: color || null,
          vendorUrl: typeof url === 'string' ? url.trim() : null,
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
  const { skuKey, productName, productColor, vendorUrl } = resolveSku(input, skuArg);
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
    await runEditAndWrite(skuKey, folderPath, imageRoot, skuOutputDirFull);
  } else {
    console.log('[map-sku] (Omit --output-dir to skip edit+write step; use --output-dir <path> to create per-SKU output folder.)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
