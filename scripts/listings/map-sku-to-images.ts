/**
 * Map ONE SKU to its image folder and selected images, using LLM tree-walk + vision.
 * Writes/merges into a single output file: SKU → vendor_site_images, folder_path,
 * selected_folder_images, missing_from_folder.
 *
 * READ-ONLY on --image-root: This script never modifies, creates, or deletes anything
 * inside the image folder. It only reads directory structure and file contents (for vision).
 * All writes go to --out-file (e.g. elina_sku_to_images.json) only.
 *
 * Usage:
 *   npm run map-sku-to-images -- --sku "100006" --image-root /path/to/elina_images
 *   npm run map-sku-to-images -- --sku "100006" --image-root ./data/elina_images --out-file data/parsed-pricing-sheets/elina_sku_to_images.json
 *
 * Requires: OPENAI_API_KEY (gpt-4o-mini) or GOOGLE_API_KEY (Gemini). Images are resized before sending to save tokens.
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sharp from 'sharp';

dotenv.config();
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  dotenv.config({ path: '.env.local', override: true });
}

const CONFIG = {
  inputFile: 'data/parsed-pricing-sheets/elina_pilates_products_site.json',
  outFile: 'data/parsed-pricing-sheets/elina_sku_to_images.json',
  imageRootDefault: '',
  maxImageDimension: 512,
  imageExtensions: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
};

type Item = { article_ref: string; [k: string]: unknown };
type Site = { product_name?: string; reference?: string; image_urls?: string[]; [k: string]: unknown };
type Group = { product_name?: string; items: Item[]; site?: Site };
type SiteInput = { groups: Group[] };

export type SkuImageMapping = {
  vendor_site_images: string[];
  folder_path: string;
  selected_folder_images: string[];
  missing_from_folder: string[];
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

function resolveSku(input: SiteInput, skuArg: string): {
  skuKey: string;
  productName: string;
  vendorSiteImages: string[];
  productColor: string | null;
} {
  const norm = (s: string) => s.replace(/^ELN\s+/i, '').trim();
  const want = norm(skuArg);
  for (const group of input.groups ?? []) {
    for (const item of group.items ?? []) {
      if (norm(item.article_ref) === want && group.site?.image_urls) {
        const raw = (item as unknown as { color?: string }).color;
        const color = typeof raw === 'string' ? raw.trim() : null;
        return {
          skuKey: item.article_ref,
          productName: group.site.product_name ?? group.product_name ?? item.article_ref,
          vendorSiteImages: group.site.image_urls,
          productColor: color || null,
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

function treeWalkPrompt(productName: string, skuKey: string, productColor: string | null, currentPath: string, childNames: string[], currentHasImages: boolean): string {
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

async function pickChildOrCurrent(
  genai: GoogleGenAI,
  productName: string,
  skuKey: string,
  productColor: string | null,
  currentPath: string,
  childNames: string[],
  currentHasImages: boolean,
): Promise<'CURRENT' | string> {
  const prompt = treeWalkPrompt(productName, skuKey, productColor, currentPath, childNames, currentHasImages);

  const response = await genai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [{ text: prompt }],
    config: { temperature: 0, maxOutputTokens: 100 },
  });
  const text = (response.text ?? '').trim();
  const atRoot = currentPath === '';
  if (!atRoot && /^CURRENT$/i.test(text)) return 'CURRENT';
  const match = childNames.find((c) => c === text || c.toLowerCase() === text.toLowerCase());
  if (match) return match;
  if (childNames.length === 0) return 'CURRENT';
  return childNames[0];
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
    const childrenLabel =
      childNames.length > 0 ? childNames.join(', ') : '(none — leaf or empty)';
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

async function resizeImageBuffer(buf: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const pipeline = sharp(buf);
  const meta = await pipeline.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const max = CONFIG.maxImageDimension;
  if (w <= max && h <= max) return { buffer: buf, mimeType };
  const resized = await pipeline.resize(max, max, { fit: 'inside' }).toBuffer();
  const outMime = mimeType.startsWith('image/png') ? 'image/png' : 'image/jpeg';
  const out = await sharp(resized).toFormat(outMime === 'image/png' ? 'png' : 'jpeg', { quality: 85 }).toBuffer();
  return { buffer: out, mimeType: outMime };
}

async function fetchAndResizeVendorImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; catalogger/1.0)' } });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    return resizeImageBuffer(buf, mime);
  } catch {
    return null;
  }
}

async function visionSelectImages(
  genai: GoogleGenAI,
  vendorImages: { url: string; buffer: Buffer; mimeType: string }[],
  folderImages: { relativePath: string; buffer: Buffer; mimeType: string }[],
  productName: string,
  skuKey: string,
): Promise<{ selected_folder_images: string[]; missing_from_folder: string[] }> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  parts.push({
    text: `You are matching product images for a Pilates equipment SKU.

Product: ${productName}
SKU: ${skuKey}

There are ${vendorImages.length} reference images from the VENDOR SITE (shown first, in order).
There are ${folderImages.length} images from a LOCAL FOLDER (shown after the vendor images, in order).

Tasks:
1. Which of the LOCAL FOLDER images show this same product? (Include all that match — same product, different angles or color variants. Exclude images that are clearly a different product or only B&W duplicates of an already-selected image.)
2. Which VENDOR SITE images have NO corresponding image in the folder? (List the 1-based index of each missing vendor image, e.g. 1, 3, 5.)

Reply with a JSON object only, no markdown:
{
  "selected_folder_images": ["path/to/file1.jpg", "path/to/file2.jpg"],
  "missing_vendor_indices": [1, 3]
}

Use the exact relative path for each selected folder image as provided in the captions below.`,
  });
  vendorImages.forEach((v, i) => {
    parts.push({ text: `[Vendor image ${i + 1}]` });
    parts.push({ inlineData: { mimeType: v.mimeType, data: v.buffer.toString('base64') } });
  });
  folderImages.forEach((f) => {
    parts.push({ text: `[Folder image: ${f.relativePath}]` });
    parts.push({ inlineData: { mimeType: f.mimeType, data: f.buffer.toString('base64') } });
  });
  parts.push({
    text: 'Reply with only the JSON object: selected_folder_images (array of path strings) and missing_vendor_indices (array of 1-based integers).',
  });

  const response = await genai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: parts,
    config: { temperature: 0, responseMimeType: 'application/json' },
  });
  const raw = (response.text ?? '').trim();
  const parsed = JSON.parse(raw) as { selected_folder_images?: string[]; missing_vendor_indices?: number[] };
  const selected = Array.isArray(parsed.selected_folder_images) ? parsed.selected_folder_images : [];
  const indices = Array.isArray(parsed.missing_vendor_indices) ? parsed.missing_vendor_indices : [];
  const missingUrls = indices
    .filter((i) => i >= 1 && i <= vendorImages.length)
    .map((i) => vendorImages[i - 1].url);
  return { selected_folder_images: selected, missing_from_folder: missingUrls };
}

async function visionSelectImagesOpenAI(
  openai: OpenAI,
  vendorImages: { url: string; buffer: Buffer; mimeType: string }[],
  folderImages: { relativePath: string; buffer: Buffer; mimeType: string }[],
  productName: string,
  skuKey: string,
): Promise<{ selected_folder_images: string[]; missing_from_folder: string[] }> {
  const systemPrompt = `You are matching product images for a Pilates equipment SKU.

Product: ${productName}
SKU: ${skuKey}

There are ${vendorImages.length} reference images from the VENDOR SITE (shown first, in order).
There are ${folderImages.length} images from a LOCAL FOLDER (shown after the vendor images, in order).

Tasks:
1. Which of the LOCAL FOLDER images show this same product? (Include all that match — same product, different angles or color variants. Exclude images that are clearly a different product or only B&W duplicates of an already-selected image.)
2. Which VENDOR SITE images have NO corresponding image in the folder? (List the 1-based index of each missing vendor image, e.g. 1, 3, 5.)

Reply with a JSON object only, no markdown:
{
  "selected_folder_images": ["path/to/file1.jpg", "path/to/file2.jpg"],
  "missing_vendor_indices": [1, 3]
}

Use the exact relative path for each selected folder image as provided in the captions below.`;

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: systemPrompt },
  ];
  vendorImages.forEach((v, i) => {
    content.push({ type: 'text', text: `[Vendor image ${i + 1}]` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${v.mimeType};base64,${v.buffer.toString('base64')}`, detail: 'low' as const },
    });
  });
  folderImages.forEach((f) => {
    content.push({ type: 'text', text: `[Folder image: ${f.relativePath}]` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${f.mimeType};base64,${f.buffer.toString('base64')}`, detail: 'low' as const },
    });
  });
  content.push({
    type: 'text',
    text: 'Reply with only the JSON object: selected_folder_images (array of path strings) and missing_vendor_indices (array of 1-based integers).',
  });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content }],
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const raw = (response.choices[0]?.message?.content ?? '').trim();
  const parsed = JSON.parse(raw) as { selected_folder_images?: string[]; missing_vendor_indices?: number[] };
  const selected = Array.isArray(parsed.selected_folder_images) ? parsed.selected_folder_images : [];
  const indices = Array.isArray(parsed.missing_vendor_indices) ? parsed.missing_vendor_indices : [];
  const missingUrls = indices
    .filter((i) => i >= 1 && i <= vendorImages.length)
    .map((i) => vendorImages[i - 1].url);
  return { selected_folder_images: selected, missing_from_folder: missingUrls };
}

async function main() {
  const inputFile = parseArg('input-file', CONFIG.inputFile);
  const outFile = parseArg('out-file', CONFIG.outFile);
  const imageRoot = parseArg('image-root', CONFIG.imageRootDefault);
  const skuArg = parseArg('sku', '');

  if (!skuArg) {
    console.error('Usage: npx ts-node scripts/listings/map-sku-to-images.ts --sku <article_ref e.g. 100006> --image-root <path> [--input-file=...] [--out-file=...]');
    process.exit(1);
  }
  if (!imageRoot || !fs.existsSync(imageRoot)) {
    console.error('--image-root must be an existing directory.');
    process.exit(1);
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const googleKey = process.env.GOOGLE_API_KEY?.trim();
  if (!openaiKey && !googleKey) {
    console.error('Set OPENAI_API_KEY or GOOGLE_API_KEY (for Gemini).');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  const input: SiteInput = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const { skuKey, productName, vendorSiteImages, productColor } = resolveSku(input, skuArg);
  console.log(`[map-sku] SKU: ${skuKey}, product: ${productName}, color: ${productColor ?? '(none)'}, vendor images: ${vendorSiteImages.length}`);

  const useOpenAI = Boolean(openaiKey);
  if (useOpenAI) console.log('[map-sku] Using OpenAI (gpt-4o-mini).');
  else console.log('[map-sku] Using Gemini (gemini-2.0-flash).');

  const openai = useOpenAI ? new OpenAI({ apiKey: openaiKey! }) : null;
  const genai = !useOpenAI ? new GoogleGenAI({ apiKey: googleKey! }) : null;

  const picker: TreeWalkPicker = useOpenAI
    ? (name, sku, color, curr, children, hasImg) =>
        pickChildOrCurrentOpenAI(openai!, name, sku, color, curr, children, hasImg)
    : (name, sku, color, curr, children, hasImg) =>
        pickChildOrCurrent(genai!, name, sku, color, curr, children, hasImg);

  console.log('[map-sku] Tree-walk to select folder...');
  console.log('[map-sku] (Stops when the model replies CURRENT for a folder that has images, or when its choice does not match any child.)');
  const folderPath = await treeWalkToFolder(imageRoot, productName, skuKey, productColor, picker);
  console.log('[map-sku] Selected folder:', folderPath);
  console.log('[map-sku] (Exiting after tree-walk only. Remove this exit to run vision + write.)');
  process.exit(0);

  // const folderImagePaths = listImageFilesUnder(imageRoot, folderPath);
  // console.log('[map-sku] Image files in folder:', folderImagePaths.length);

  // const vendorWithBuffers: { url: string; buffer: Buffer; mimeType: string }[] = [];
  // for (let i = 0; i < vendorSiteImages.length; i++) {
  //   const r = await fetchAndResizeVendorImage(vendorSiteImages[i]);
  //   if (r) vendorWithBuffers.push({ url: vendorSiteImages[i], buffer: r.buffer, mimeType: r.mimeType });
  //   else console.warn('[map-sku] Could not fetch vendor image:', vendorSiteImages[i]);
  // }

  // const folderWithBuffers: { relativePath: string; buffer: Buffer; mimeType: string }[] = [];
  // for (const rel of folderImagePaths) {
  //   const full = path.join(imageRoot, rel);
  //   const buf = fs.readFileSync(full);
  //   const mime = rel.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  //   const resized = await resizeImageBuffer(buf, mime);
  //   folderWithBuffers.push({ relativePath: rel, buffer: resized.buffer, mimeType: resized.mimeType });
  // }

  // if (folderWithBuffers.length === 0) {
  //   console.warn('[map-sku] No images in folder; selected_folder_images will be empty, missing_from_folder may be all vendor URLs.');
  // }

  // console.log('[map-sku] Vision: select folder images and identify missing vendor images...');
  // const { selected_folder_images, missing_from_folder } = useOpenAI
  //   ? await visionSelectImagesOpenAI(openai!, vendorWithBuffers, folderWithBuffers, productName, skuKey)
  //   : await visionSelectImages(genai!, vendorWithBuffers, folderWithBuffers, productName, skuKey);

  // const mapping: SkuImageMapping = {
  //   vendor_site_images: vendorSiteImages,
  //   folder_path: folderPath,
  //   selected_folder_images,
  //   missing_from_folder,
  // };

  // const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);
  // const outDir = path.dirname(outPath);
  // if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // let existing: SkuToImagesOutput = { skus: {} };
  // if (fs.existsSync(outPath)) {
  //   try {
  //     existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as SkuToImagesOutput;
  //     if (!existing.skus) existing.skus = {};
  //   } catch {
  //     // start fresh
  //   }
  // }
  // existing.skus[skuKey] = mapping;
  // fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf-8');
  // console.log('[map-sku] Wrote', outPath);
  // console.log('[map-sku] selected_folder_images:', selected_folder_images.length);
  // console.log('[map-sku] missing_from_folder:', missing_from_folder.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
