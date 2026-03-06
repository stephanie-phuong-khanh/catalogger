/**
 * For Elina Pilates, we're in the final step of the pipeline, which we run in stages:
 * 1. parse-pdf-pricing-sheet: Parse the pricing sheet, which is a PDF. This outputs data/elina/elina_pilates_pricing_sheet.json.
 * 2. resolve-elina-urls: Resolve the URLs for the products. This outputs data/elina/elina_pilates_products_urls.json. This step involved resolving the URLs for the products using Puppeteer.
 * 3. scrape-elina-site: For the URL for each SKU, scrape the vendor site and save the data to data/elina/elina_pilates_products_site.json. This step involved scraping the vendor site for the products using Puppeteer.
 * 4. map-elina-sku-to-images: Map the SKUs to the image folders that are on the local machine. This outputs data/elina/elina_sku_to_images.json. This was an assisted step that was done manually by running this script.
 * 5. Finally, here we generate the listings from data saved from the previous steps.
 *
 * Input: data/elina/elina_pilates_products_site.json.
 * Output: data/listings/elina_pilates/{ProductGroupSlug}.json (one file per product group; each file has variants[] for each SKU).
 *
 * Usage:
 *   npm run generate-listings-elina
 *   npm run generate-listings-elina -- --single "Reformer Elite"   # generate only this product group (by name)
 *   npm run generate-listings-elina -- --print-only     # print the listings to the console, no file write
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type {
  ElinaListing,
  ElinaListingFull,
  ElinaListingStub,
  ElinaSpecifications,
  ElinaVariant,
  ElinaListingSource,
  GoogleDriveLink,
} from '../../types/listings/elina-pilates-listing';

dotenv.config();

const TitleOutput = z.object({
  title: z.string().describe('The generated product title only, with no preamble or explanation'),
});
const FeaturesOutput = z.object({
  features: z.array(z.string()).describe('The list of features for the product listing'),
});
const WarrantyBulletOutput = z.object({
  bullet: z.string().describe('One concise warranty bullet point'),
});
const OverviewParagraphOutput = z.object({
  overviewParagraph: z.string().describe('The generated overview paragraph for the product listing'),
});
const SpecsTableOutput = z.object({
  rows: z.array(
    z.object({
      label: z.string().describe('Left column: specification name (e.g. Reformer Length)'),
      value: z.string().describe('Right column: measurement value, imperial only when both given'),
    }),
  ),
});
const CONFIG = {
  inputFile: 'data/elina/elina_pilates_products_site.json',
  skuToImagesFile: 'data/elina/elina_sku_to_images.json',
  outputDir: 'data/listings/elina_pilates',
};

type SkuToImagesEntry = { input_folder_path: string | null; output_folder_path: string | null };
type SkuToImages = { skus: Record<string, SkuToImagesEntry> };

/** Normalize product group name for use as a filename slug: trim, replace / with -, collapse spaces to single dash. */
function productGroupToSlug(productName: string): string {
  return productName
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function parseArgs(): { singleProductName: string | null; printOnly: boolean } {
  const args = process.argv.slice(2);
  const singleIdx = args.indexOf('--single');
  const singleProductName =
    singleIdx !== -1 && args[singleIdx + 1] ? args[singleIdx + 1].trim() : null;
  const printOnly = args.includes('--print-only');
  return { singleProductName, printOnly };
}

const ELINA_PREFIX = 'Elina Pilates ';

/**
 * Format vendor site product name for title: strip ™®©, title-case words, collapse spaces.
 * Returns only the product part (no "Elina Pilates " prefix).
 */
function formatTitleFromSiteName(siteProductName: string): string {
  let s = String(siteProductName ?? '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return s;
  s = s
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  return s;
}

/**
 * LLM fallback when no vendor site: fix awkward word order from pricing sheet and normalize casing.
 * Returns only the product part (no "Elina Pilates " prefix).
 */
async function generateTitleFromPricingSheet(
  openai: OpenAI,
  productNameFromGroup: string,
): Promise<string> {
  const prompt = `You are writing the product name part of a listing title for an eCommerce store (Pilates equipment and accessories).
  The product name from the pricing sheet is: "${productNameFromGroup.trim()}"
  This wording may be awkward or in an unnatural order. Output a clear product title with words in a natural, customer-friendly order and proper capitalization (first letter of each word capitalized).
  Output ONLY the product name part. Do not include "Elina Pilates" or any prefix. Do not include SKU, quotation marks, or extra explanation.
  Example: "Physio Reformer Master Instructor" → "Master Instructor Physio Reformer"
  `;

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(TitleOutput, 'title_output') },
  });
  const productPart = response.output_parsed?.title?.trim() ?? productNameFromGroup.trim();
  return productPart;
}

function normalizeYouTubeUrl(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  // Convert embed URLs to watch URLs (keep id, drop extra params).
  const embedMatch = s.match(/youtube\.com\/embed\/([^?&#/]+)/i);
  if (embedMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${embedMatch[1]}`;
  }

  // Normalize youtu.be short links to watch.
  const shortMatch = s.match(/youtu\.be\/([^?&#/]+)/i);
  if (shortMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
  }

  return s;
}

function collectYouTubeUrls(site: unknown): string[] {
  const urls: string[] = [];
  if (!site || typeof site !== 'object') return urls;

  const siteObj = site as {
    videos?: unknown;
    tabs?: Array<{ id?: unknown; title?: unknown; content?: unknown; videos?: unknown }>;
  };

  const pushAll = (v: unknown) => {
    if (!Array.isArray(v)) return;
    for (const x of v) {
      const u = normalizeYouTubeUrl(String(x ?? ''));
      if (u) urls.push(u);
    }
  };

  pushAll(siteObj.videos);
  for (const tab of siteObj.tabs ?? []) pushAll(tab?.videos);

  // Dedupe, preserve order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** Get description tab content from site, or null if missing. */
function getDescriptionContent(site: unknown): string | null {
  if (!site || typeof site !== 'object') return null;
  const tabs = (site as { tabs?: unknown }).tabs;
  if (!Array.isArray(tabs)) return null;
  const descTab = tabs.find((t) => {
    if (!t || typeof t !== 'object') return false;
    const id = String((t as { id?: unknown }).id ?? '').trim().toLowerCase();
    const title = String((t as { title?: unknown }).title ?? '').trim().toLowerCase();
    return id === 'description' || title === 'description';
  }) as { content?: unknown } | undefined;
  const content = descTab?.content;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
}

/**
 * Split description into sections. Header = line that is all caps and surrounded by \n\n,
 * or markdown ##, or a short line ending with "includes:", "measurements:", etc. (Cadillac Reformer–style).
 * Chunks whose first line is a known header (e.g. WARRANTY) are split so that header becomes its own section.
 */
function parseDescriptionIntoSections(
  content: string,
): Array<{ name: string; body: string }> {
  const chunks = content.split(/\n\n+/).map((c) => c.trim()).filter(Boolean);
  function isHeaderChunk(chunk: string): boolean {
    if (chunk.length === 0 || chunk.length >= 120) return false;
    // Single-line chunk that is a known section name in any case (e.g. "Features", "Included", "Colors", "Dimensions", "Warranty")
    if (!chunk.includes('\n') && chunk.length <= 50 && KNOWN_SECTION_HEADERS.has(normalizeSectionName(chunk))) return true;
    if (chunk.includes('\n')) return false;
    // All-caps header (e.g. "### FEATURES")
    if (chunk === chunk.toUpperCase()) return true;
    // Markdown-style header in any case (e.g. "### Features", "### Includes")
    if (/^#+\s+\S/.test(chunk)) return true;
    // Short line ending with "includes:", "inclusions:", "measurements:", "dimensions:" (e.g. Cadillac Reformer)
    if (/^(includes|inclusions|measurements|dimensions):\s*$/i.test(chunk)) return true;
    const lower = chunk.toLowerCase();
    if (chunk.length <= 80 && (lower.endsWith(' includes:') || lower.endsWith(' inclusions:') || lower.endsWith(' measurements:') || lower.endsWith(' dimensions:'))) return true;
    // Standalone "Measures" or "Measurements" (e.g. Cadillac description tab)
    if (chunk.length <= 20 && /^measures?$/i.test(chunk.trim())) return true;
    return false;
  }
  /** First line of a chunk is a section header we recognize (e.g. WARRANTY with body on next line). */
  function firstLineIsStandaloneHeader(chunk: string): { name: string; body: string } | null {
    if (!chunk.includes('\n')) return null;
    const idx = chunk.indexOf('\n');
    const firstLine = chunk.slice(0, idx).trim();
    const rest = chunk.slice(idx + 1).trim();
    if (!firstLine) return null;
    const norm = firstLine.replace(/:\s*$/, '').toUpperCase();
    if (NON_INCLUSION_HEADERS.has(norm)) return { name: firstLine, body: rest };
    if (KNOWN_SECTION_HEADERS.has(normalizeSectionName(firstLine))) return { name: firstLine, body: rest };
    if (firstLine === firstLine.toUpperCase() && firstLine.length <= 40) return { name: firstLine, body: rest };
    return null;
  }
  const sections: Array<{ name: string; body: string }> = [];
  let currentName = '';
  const currentBody: string[] = [];
  for (const chunk of chunks) {
    const split = firstLineIsStandaloneHeader(chunk);
    if (split) {
      if (currentName !== '' || currentBody.length > 0) {
        sections.push({ name: currentName, body: currentBody.join('\n\n') });
      }
      currentName = split.name;
      currentBody.length = 0;
      if (split.body) currentBody.push(split.body);
    } else if (isHeaderChunk(chunk)) {
      if (currentName !== '' || currentBody.length > 0) {
        sections.push({ name: currentName, body: currentBody.join('\n\n') });
      }
      currentName = chunk;
      currentBody.length = 0;
    } else {
      currentBody.push(chunk);
    }
  }
  if (currentName !== '' || currentBody.length > 0) {
    sections.push({ name: currentName, body: currentBody.join('\n\n') });
  }
  return sections;
}

/** Normalize section name for lookup: strip markdown header prefix (e.g. "### ") and uppercase. */
function normalizeSectionName(name: string): string {
  return name.replace(/^#+\s*/, '').trim().toUpperCase();
}

/** Section headers that are not inclusions — stop parsing inclusion body when we hit one (e.g. single-\n after header). */
const NON_INCLUSION_HEADERS = new Set([
  'WARRANTY',
  'GUARANTEE',
  'MEASURES',
  'MEASUREMENTS',
  'DIMENSIONS',
  'SPECIFICATIONS',
  'SPECS',
]);

/** Known section header names (any case). Used to recognize title-case headers like "Features", "Included", "Colors". */
const KNOWN_SECTION_HEADERS = new Set([
  'FEATURES',
  'CHARACTERISTICS',
  'INCLUDE',
  'INCLUDED',
  'INCLUDES',
  'COLORS',
  'DIMENSIONS',
  'MEASUREMENTS',
  'MEASURES',
  'WARRANTY',
  'GUARANTEE',
  'SPECIFICATIONS',
  'SPECS',
]);

/** Trim body to only the part before the first line that looks like a non-inclusion section header. */
function trimInclusionsBody(body: string): string {
  const lines = body.split(/\r?\n/);
  const keep: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/:\s*$/, '').trim().toUpperCase();
    if (NON_INCLUSION_HEADERS.has(normalized)) break;
    keep.push(line);
  }
  return keep.join('\n');
}

/** Parse INCLUDES section body into list of inclusion strings (bullets, strip trailing period). */
function parseInclusionsFromBody(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bulletMatch = trimmed.match(/^[-•*]\s+(.*)$/);
    let text = (bulletMatch?.[1] ?? trimmed).trim();
    if (!text) continue;
    if (text.endsWith('.')) text = text.slice(0, -1);
    out.push(text);
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}

function extractInclusionsFromSections(
  sections: Array<{ name: string; body: string }>,
): string[] {
  // Exact "INCLUDE"/"INCLUDES"/"INCLUDED" or any section whose normalized name ends with those (e.g. "The Cadillac includes:", "### Include", "### Included")
  const includesSections = sections.filter((s) => {
    const n = normalizeSectionName(s.name).replace(/:$/, '');
    return (
      n === 'INCLUDE' ||
      n === 'INCLUDES' ||
      n === 'INCLUDED' ||
      n.endsWith(' INCLUDE') ||
      n.endsWith(' INCLUDE:') ||
      n.endsWith(' INCLUDES') ||
      n.endsWith(' INCLUDES:') ||
      n.endsWith(' INCLUDED') ||
      n.endsWith(' INCLUDED:')
    );
  });
  if (includesSections.length === 0) return [];
  const combined: string[] = [];
  const seen = new Set<string>();
  for (const sec of includesSections) {
    for (const item of parseInclusionsFromBody(trimInclusionsBody(sec.body))) {
      const key = item.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }
  }
  return combined;
}

function extractInclusionsFromDescription(site: unknown): string[] {
  const content = getDescriptionContent(site);
  if (!content) return [];
  return extractInclusionsFromSections(parseDescriptionIntoSections(content));
}

/**
 * Get the text to send to the features LLM. Uses strict headers (\n\n + all caps).
 * When FEATURES section exists: pass INTRO + FEATURES (caller adds text_under_images).
 * When no FEATURES but CHARACTERISTICS exists: use CHARACTERISTICS as features input (same format).
 * Otherwise: pass entire description (fallback).
 */
function getFeaturesSourceFromSections(
  sections: Array<{ name: string; body: string }>,
  fullContent: string,
): string {
  const featuresSection = sections.find(
    (s) => normalizeSectionName(s.name) === 'FEATURES',
  );
  const characteristicsSection = sections.find(
    (s) => normalizeSectionName(s.name) === 'CHARACTERISTICS',
  );
  const section = featuresSection ?? characteristicsSection;
  if (section) {
    const introSection = sections.find((s) => s.name === '');
    const introBlock =
      introSection?.body?.trim() ?? '';
    const featuresBlock = section.body.trim();
    if (introBlock) {
      return `INTRO (optional context):\n\n${introBlock}\n\nFEATURES:\n\n${featuresBlock}`;
    }
    return `FEATURES:\n\n${featuresBlock}`;
  }

  return `DESCRIPTION (full):\n\n${fullContent}`;
}

/** Label for logging: what getFeaturesSourceFromSections returned. */
function getFeaturesSourceLabel(
  sections: Array<{ name: string; body: string }>,
  featuresSource: string,
): string {
  if (featuresSource.startsWith('DESCRIPTION (full):')) return 'description (full)';
  const hasFeatures = sections.some((s) => normalizeSectionName(s.name) === 'FEATURES');
  const hasCharacteristics = sections.some((s) => normalizeSectionName(s.name) === 'CHARACTERISTICS');
  if (featuresSource.startsWith('INTRO (optional context):'))
    return hasFeatures ? 'intro+FEATURES' : 'intro+CHARACTERISTICS';
  if (featuresSource.startsWith('FEATURES:'))
    return hasFeatures ? 'FEATURES' : 'CHARACTERISTICS';
  return 'description (full)';
}

/** Return the body of the WARRANTY section if present; otherwise null. */
function getWarrantySectionBody(
  sections: Array<{ name: string; body: string }>,
): string | null {
  const section = sections.find(
    (s) => normalizeSectionName(s.name) === 'WARRANTY',
  );
  if (!section?.body?.trim()) return null;
  return section.body.trim();
}

/** Return the body of the DIMENSIONS, MEASUREMENTS, or MEASURES section if present; otherwise null. */
function getDimensionsSectionBody(
  sections: Array<{ name: string; body: string }>,
): string | null {
  const section = sections.find((s) => {
    const n = normalizeSectionName(s.name).replace(/:$/, '');
    return n === 'DIMENSIONS' || n === 'MEASUREMENTS' || n === 'MEASURES';
  });
  if (!section?.body?.trim()) return null;
  return section.body.trim();
}

function getTextUnderImages(site: unknown): string {
  if (!site || typeof site !== 'object') return '';
  const s = (site as { text_under_images?: unknown }).text_under_images;
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * Generate concise features list for Elina. Pass intro + FEATURES + text_under_images when FEATURES exists;
 * otherwise full description + text_under_images. LLM de-dupes overlapping points.
 */
async function generateFeaturesElina(
  openai: OpenAI,
  featuresSourceText: string,
  textUnderImages: string,
): Promise<string[]> {
  const optionalContext = textUnderImages
    ? `\n\nSHORT TEXT (may have repeated info from vendor content):\n${textUnderImages}`
    : '';

  const prompt = `You are writing a clear, concise list of features for a product listing. Features should be scannable: key benefits and differentiators only, very short phrases.

PRODUCT CONTENT:
${featuresSourceText || '(none)'}${optionalContext}

RULES:
- Prioritize key benefits and differentiators. Curate to what matters for a scanning customer; omit minor or highly technical details that belong in a specs table. Do not list every spec from the source.
- Fewer than 7 words per bullet (guideline). Lead with the feature name, then the key modifier (e.g. "Aluminum frame" not "Frame made of aluminium").
- One idea per bullet = one feature/component/benefit. Combine when it's the same part and the phrase stays short (e.g. "Collapisble tower, 3 heights" in one bullet). Split only when a single bullet would get long or mix unrelated things.
- If available, have product material info in the first bullet.
- Keep numbers as digits. Preserve materials and key specs that customers care about (e.g. "Anodized aluminum & stainless steel frame", "7 color-coded metal springs").
- Aim for a scannable list; soft cap ~18 bullets. No minimum; if the vendor content is short, use fewer bullets.
- Deduplicate repeated content. Do not combine unrelated points into one bullet.
- Use benefit-led, plain language: "Durable upholstery" not "High-quality upholstery for intense, continuous use". No filler, no full sentences, no marketing fluff, no SKU/disclaimers/quotes.
- Output only the list of feature strings. No preamble or numbering. No periods after the bullets.
- Do not structure bullets like "Feature: Modifier". Just list the modifier before the feature name.
- Use & instead of "and" where it keeps the bullet short.
- Do not mention information about colors.
`;

  const response = await openai.responses.parse({
    model: 'gpt-5.2',
    // temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(FeaturesOutput, 'features_output') },
  });
  return response.output_parsed?.features ?? [];
}

/**
 * Generate overview paragraph for Elina listing (conversion- and search-optimized, 3–4 sentences).
 * - When text_under_images is available: uses product title + that content (+ description intro when available to reduce fluff).
 * - When not available: uses product title + full vendor content; prompt asks model to extract strongest features.
 */
async function generateOverviewParagraphElina(
  openai: OpenAI,
  productTitle: string,
  featuresSourceText: string,
  textUnderImages: string,
  descriptionIntro?: string,
): Promise<string> {
  const hasTextUnderImages = textUnderImages.trim().length > 0;
  const intro = (descriptionIntro ?? '').trim();
  if (!hasTextUnderImages) {
    console.error('🔴 ❌ 🔴 NO text_under_images for overview paragraph — product:', productTitle);
  }

  const commonRules = `- For key features you mention, briefly state the outcome or benefit (what the feature enables for the user). State what it allows them to do or achieve, rather than only naming the feature.
- Write in a confident, benefit-driven tone. Do NOT list features mechanically.
- No pricing. Do NOT fabricate or infer unsupported claims.
- Do not use repetitive language. Vary sentence structure and word choice.
- DO NOT USE MARKETING FLUFF OR FILLER WORDS. BE EXTREMELY CONCISE AND TO THE POINT.`;

  const prompt = hasTextUnderImages
    ? `You are writing an overview paragraph for a product listing for an eCommerce store.
You have the product title and the supplier-highlighted content (text the supplier chose to show under product images). This content represents what the supplier considers the main differentiators.${intro ? ' You also have the description intro below—use it to add substance; do not add filler.' : ''}

PRODUCT TITLE:
${productTitle}

SUPPLIER-HIGHLIGHTED CONTENT (text under product images; use as primary source):
${textUnderImages.trim()}${intro ? `

DESCRIPTION INTRO (use to enrich the overview; avoid fluff):
${intro}` : ''}

Write a 3-4 sentence product overview optimized for conversion and search relevance. Customers should immediately understand what makes this product stand out.
RULES:
- Always start the first sentence with the product title verbatim. Use the sentence structure "The [product title]..."
- Lead with the strongest, most important features so the reader immediately sees what makes this product stand out; then add supporting details as needed.
- Clearly explain what the product is for and why the customer would care to buy it.
- Highlight tangible health/wellness benefits if supported by the source.
- Do not mention shipping date or stock availability in the overview paragraph.

${commonRules}`

    : `You are writing an overview paragraph for a product listing for an eCommerce store.
You have the product title and the vendor's full description and features. From this you must extract the strongest, most important features so customers immediately understand what makes this product stand out.

PRODUCT TITLE:
${productTitle}

VENDOR CONTENT (description intro and features if present, or full description):
${featuresSourceText || '(none)'}

Write a 3-4 sentence product overview optimized for conversion and search relevance. Your job is to identify what truly differentiates this product and lead with that—customers should immediately understand what makes it stand out.
RULES:
- First mentally identify the 1-2 strongest differentiators or most important features in the vendor content; then lead with those so the reader immediately sees what makes this product stand out. Add supporting details (product type, materials, use cases) after.
- Clearly explain what the product is for, how to use it, and why the customer would care to buy the product.
- Highlight tangible health/wellness benefits if supported by source material. Include only features that are most relevant to the product's appeal.
${commonRules}`;

  const response = await openai.responses.parse({
    model: 'gpt-5.2',
    // temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(OverviewParagraphOutput, 'overview_paragraph_output') },
  });
  return response.output_parsed?.overviewParagraph ?? '';
}

/**
 * Turn warranty section text into a single concise bullet for the features list.
 * Uses gpt-4o-mini for cost.
 */
async function generateWarrantyBullet(
  openai: OpenAI,
  warrantyBody: string,
): Promise<string> {
  const prompt = `Turn this warranty text into a single concise bullet point for a product features list. Output only the bullet text, no preamble or numbering. Use fewer than 10 words.

WARRANTY TEXT:
${warrantyBody}`;
  const response = await openai.responses.parse({
    model: 'gpt-4o-mini',
    temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(WarrantyBulletOutput, 'warranty_bullet') },
  });
  const bullet = response.output_parsed?.bullet?.trim();
  return bullet ?? '';
}

/** True if value looks like a measurement (contains a number and a known unit). Used to filter out non-spec rows. */
function valueLooksLikeMeasurement(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const hasNumber = /\d/.test(v);
  const hasUnit =
    /\b(cm|in\.?|inch|inches|ft|feet|mm|m\b|lb|kg|g\b|oz|"|')\b/i.test(v) ||
    /["']\s*$/.test(v); // inch symbol at end
  return hasNumber && hasUnit;
}

/**
 * Generate a two-column specs table (key, value) from the DIMENSIONS section,
 * or from full description when no dimensions section exists (fallback).
 * Keeps imperial only when both in/cm or lb/kg are given; excludes EAN/Reference.
 * When fromFullDescription is true, only rows whose value looks like a measurement are kept (sanity check).
 */
async function generateSpecsTableElina(
  openai: OpenAI,
  content: string,
  productTitle: string,
  options?: { fromFullDescription?: boolean },
): Promise<ElinaSpecifications> {
  const fromFullDescription = options?.fromFullDescription === true;

  const prompt = fromFullDescription
    ? `You are creating a two-column specifications table for a product listing. You are given a FULL PRODUCT DESCRIPTION (not a dedicated dimensions section). Your job is to EXTRACT only explicitly stated, measurable specifications.

FULL PRODUCT DESCRIPTION:
${content}

RULES:
- Extract ONLY measurable specifications: dimensions (length, width, height, total dimensions, barrel dimensions, etc.), weight, capacity. Look for them in bullets, paragraphs, or inline text (e.g. "Total dimensions: 95 cm x 120 cm" or "Barrel 55 cm x 88 cm").
- Do NOT include colors, feature names, warranty text, or narrative. Do NOT invent or infer numbers that are not explicitly in the text.
- If no clear measurements are present in the text, output an empty table (rows: []).
- SANITY CHECK: Only include a row if the value is a number with a unit (e.g. cm, in, ", lb, kg). Every value must contain at least one number and one unit. Omit any row that would have a non-measurement value.
- Output a two-column table: left column = specification name (key), right column = measurement value only.
- When both imperial and metric are given, keep ONLY imperial for lengths; for weights keep both with a slash (e.g. "187 lb / 85 kg").
- Use the inch symbol (") for inch dimensions. Use "lb" for weight. Only number(s) and unit(s) in the value cell.`
    : `You are creating a two-column specifications table for a product listing. The table has a title, and each row has a key (left column) and a value (right column).

DIMENSIONS SECTION (from vendor):
${content}

RULES:
- Output a two-column table: left column = specification name (key), right column = measurement value only.
- When a line gives both imperial and metric, keep ONLY imperial for lengths (inches, feet) and exclude metric. For weights, keep both imperial and metric (lb, kg)
- Separate imperial and metric values with a slash (/) instead of a pipe (|). e.g. "187.40 lb / 85 kg".
- Include only actual measurements (length, width, height, weight, capacity, box dimensions). Exclude reference codes, EAN, barcodes.
- Labels: Use clear names exactly as given in the source.
- Values: Use the inch symbol (") for inch dimensions so values are compact (e.g. "94.88"" for length; "20.50\" x 10.75\" x 15.00\"" for three-part box dimensions). Use "lb" for weight. Do not put qualifiers or notes in the value cell—only the number(s) and unit(s).
- DO NOT DROP ANY QUALIFIERS FROM THE SOURCE, e.g. "without accessories", "incl. tower", "incl. jump board", etc.
`;

  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [{ role: 'user', content: prompt }],
    text: { format: zodTextFormat(SpecsTableOutput, 'specs_table_output') },
  });
  const parsed = response.output_parsed;
  if (!parsed?.rows?.length) {
    return { tableTitle: '', columns: [], rows: [] };
  }
  let rows = parsed.rows.map((r) => ({
    label: r.label.trim(),
    values: [r.value.trim()],
  }));
  if (fromFullDescription) {
    rows = rows.filter((r) => valueLooksLikeMeasurement(r.values[0] ?? ''));
  }
  if (rows.length === 0) {
    return { tableTitle: '', columns: [], rows: [] };
  }
  return {
    tableTitle: `Key dimensions of ${productTitle}`,
    columns: ['Specification', 'Value'],
    rows,
  };
}

type ItemInput = {
  article_ref: string;
  description_raw?: string;
  price_usd?: number;
  barcode?: string;
  url?: string | null;
};

function buildVariantsFromItems(items: ItemInput[]): ElinaVariant[] {
  return items.map((item) => {
    const source: ElinaListingSource = {
      articleRef: String(item.article_ref),
      description: item.description_raw ?? '',
      priceUsd: typeof item.price_usd === 'number' ? item.price_usd : 0,
      barcode: item.barcode != null ? String(item.barcode) : '',
    };
    return {
      sku: String(item.article_ref),
      vendorPageUrl: item.url != null ? String(item.url).trim() || null : null,
      googleDriveLinks: [],
      _source: source,
    };
  });
}

function buildGoogleDriveLinks(
  productName: string,
  sku: string,
  vendorPageUrl: string | null,
  skuToImages: SkuToImages,
): GoogleDriveLink[] {
  const links: GoogleDriveLink[] = [];
  const hasVendorSite = vendorPageUrl != null && vendorPageUrl.trim() !== '';
  if (hasVendorSite) {
    const vendorPath = `${productName.trim()}/${sku}`;
    links.push({
      label: 'Scraped from vendor site:',
      baseUrlConstantKey: 'vendorSiteScraped',
      path: vendorPath,
    });
  }
  const entry = skuToImages.skus?.[sku];
  const elinaPath = entry?.output_folder_path ?? null;
  if (elinaPath != null && elinaPath.trim() !== '') {
    links.push({
      label: 'Images provided by vendor:',
      baseUrlConstantKey: 'elinaProvided',
      path: elinaPath,
    });
  }
  return links;
}

function enrichListingWithGoogleDriveLinks(
  listing: ElinaListing,
  skuToImages: SkuToImages,
): ElinaListing {
  const productName = listing.productName ?? 'Unknown';
  const variants: ElinaVariant[] = listing.variants.map((v) => ({
    ...v,
    googleDriveLinks: buildGoogleDriveLinks(
      productName,
      v.sku,
      v.vendorPageUrl ?? null,
      skuToImages,
    ),
  }));
  return { ...listing, variants };
}

/** Stub when no vendor site; no generated content. */
function buildStubListing(productName: string, items: ItemInput[]): ElinaListingStub {
  return {
    _listingFormat: 'elina_pilates',
    status: 'vendor_site_unavailable',
    productName,
    variants: buildVariantsFromItems(items),
  };
}

/** Full listing when vendor site exists; placeholder content filled in later steps. */
function buildFullListingPlaceholder(
  productName: string,
  site: unknown,
  items: ItemInput[],
): ElinaListingFull {
  const variants = buildVariantsFromItems(items);
  return {
    _listingFormat: 'elina_pilates',
    status: 'full',
    productName,
    title: '',
    overviewParagraph: '',
    features: [],
    inclusions: extractInclusionsFromDescription(site),
    specifications: {
      tableTitle: '',
      columns: [],
      rows: [],
    },
    youtubeUrls: collectYouTubeUrls(site),
    variants,
  };
}

async function main() {
  const { singleProductName, printOnly } = parseArgs();

  const inputPath = path.isAbsolute(CONFIG.inputFile)
    ? CONFIG.inputFile
    : path.join(process.cwd(), CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const groups = data.groups ?? [];

  const skuToImagesPath = path.isAbsolute(CONFIG.skuToImagesFile)
    ? CONFIG.skuToImagesFile
    : path.join(process.cwd(), CONFIG.skuToImagesFile);
  let skuToImages: SkuToImages = { skus: {} };
  if (fs.existsSync(skuToImagesPath)) {
    skuToImages = JSON.parse(fs.readFileSync(skuToImagesPath, 'utf-8')) as SkuToImages;
    if (!skuToImages.skus || typeof skuToImages.skus !== 'object') skuToImages.skus = {};
  }

  const outputDir = path.join(process.cwd(), CONFIG.outputDir);
  if (!printOnly && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  let count = 0;
  for (const group of groups) {
    const productName = group.product_name ?? 'Unknown';
    const site = group.site ?? null;
    const items = group.items ?? [];

    if (singleProductName != null) {
      const nameMatch =
        productName.trim().toLowerCase() ===
        singleProductName.trim().toLowerCase();
      if (!nameMatch) continue;
    }

    let listing: ElinaListing;

    if (!site) {
      listing = buildStubListing(productName, items);
    } else {
      listing = buildFullListingPlaceholder(productName, site, items);
      const siteProductName =
        typeof site === 'object' && (site as { product_name?: string }).product_name
          ? String((site as { product_name: string }).product_name).trim()
          : null;

      // Title: use formatted title from site, or generate from pricing sheet, or use product name
      let title = '';
      if (siteProductName) {
        title = formatTitleFromSiteName(siteProductName);
      } else if (openai) {
        title = await generateTitleFromPricingSheet(openai, productName);
      } else {
        title = productName;
      }
      listing.title = ELINA_PREFIX + title;

      if (openai) {
        const descContent = getDescriptionContent(site);
        const sections =
          descContent != null ? parseDescriptionIntoSections(descContent) : [];
        const featuresSource =
          descContent != null
            ? getFeaturesSourceFromSections(sections, descContent)
            : '';
        listing.features = await generateFeaturesElina(
          openai,
          featuresSource,
          getTextUnderImages(site),
        );
        const warrantyBody = getWarrantySectionBody(sections);
        if (warrantyBody) {
          const warrantyBullet = await generateWarrantyBullet(openai, warrantyBody);
          if (warrantyBullet) listing.features.push(warrantyBullet);
        }
        listing.features = listing.features.map((f) => f.replace(/\.$/, ''));
        const overviewIntro =
          sections.find((s) => s.name === '')?.body?.trim() ?? '';
        listing.overviewParagraph = await generateOverviewParagraphElina(
          openai,
          title,
          featuresSource,
          getTextUnderImages(site),
          overviewIntro || undefined,
        );
        const dimensionsBody = getDimensionsSectionBody(sections);
        let specsFromFullDescription = false;
        if (dimensionsBody) {
          listing.specifications = await generateSpecsTableElina(
            openai,
            dimensionsBody,
            title, // should exclude "Elina Pilates " prefix
          );
        } else if (descContent && descContent.trim().length > 0) {
          listing.specifications = await generateSpecsTableElina(
            openai,
            descContent,
            title,
            { fromFullDescription: true },
          );
          specsFromFullDescription = true;
        }

        // Spot-check logging: what went into each part of the listing
        const sectionNames = sections.map((s) => s.name || '(intro)').join(', ') || '(none)';
        const overviewSource = getTextUnderImages(site)
          ? overviewIntro.length > 0
            ? 'title + intro + text_under_images'
            : 'title + text_under_images'
          : `title + ${getFeaturesSourceLabel(sections, featuresSource)}`;
        const featuresLabel = getFeaturesSourceLabel(sections, featuresSource);
        const featuresSources = [
          featuresLabel,
          getTextUnderImages(site) ? 'text_under_images' : null,
          warrantyBody ? 'WARRANTY' : null,
        ]
          .filter(Boolean)
          .join(', ');
        const inclusionsSectionNames = sections
          .filter((s) => {
            const n = normalizeSectionName(s.name).replace(/:$/, '');
            return (
              n === 'INCLUDE' ||
              n === 'INCLUDES' ||
              n === 'INCLUDED' ||
              n.endsWith(' INCLUDES') ||
              n.endsWith(' INCLUDES:') ||
              n.endsWith(' INCLUDED') ||
              n.endsWith(' INCLUDED:')
            );
          })
          .map((s) => s.name)
          .join(', ') || '(none)';
        const specsSection = sections.find((s) => {
          const n = normalizeSectionName(s.name).replace(/:$/, '');
          return n === 'DIMENSIONS' || n === 'MEASUREMENTS' || n === 'MEASURES';
        });
        const specsSource = specsFromFullDescription
          ? 'full description (fallback)'
          : specsSection
            ? specsSection.name
            : '(none)';
        console.log(`PRODUCT: ${productName}`);
        console.log(`SECTIONS: ${sectionNames}`);
        console.log();
        console.log(`OVERVIEW: ${overviewSource}`);
        console.log(`FEATURES: ${featuresSources}`);
        console.log(`INCLUSIONS: ${inclusionsSectionNames}`);
        console.log(`SPECIFICATIONS: ${specsSource}`);
      }
    }

    listing = enrichListingWithGoogleDriveLinks(listing, skuToImages);

    if (printOnly) {
      console.log(JSON.stringify(listing, null, 2));
      count += 1;
      continue;
    }

    const slug = productGroupToSlug(productName);
    const outPath = path.join(outputDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(listing, null, 2), 'utf-8');
    const label =
      listing.status === 'vendor_site_unavailable'
        ? 'stub (no vendor site)'
        : `${items.length} variant(s)`;
    console.log(`  → ${path.relative(process.cwd(), outPath)} (${label})`);
    count += 1;
  }

  console.log(`\nDone. ${count} listing(s) ${printOnly ? 'printed' : 'written'}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
