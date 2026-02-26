/**
 * This is a library to parse a pricing sheet that is an Excel file.
 * Currently, this handles only the Golden Designs pricing sheet.
 */

import * as xlsx from 'xlsx';

export type RawProduct = Record<string, any>;

interface ParseSheetConfig {
  filePath: string;
  sheetIndex: number;   // [HARDCODED] which tab to parse
  headerRow: number;     // [HARDCODED] 0-indexed row number for headers
  skuColumn: string;     // [HARDCODED] column name that identifies a new product row
}

// [HARDCODED] Golden Designs sheet structure. Later: LLM or config to infer.
const GOLDEN_DESIGNS_CONFIG = {
  headerRow: 3,
  skuColumn: 'GDINA Item #',
};

export interface TabProducts {
  name: string;
  products: RawProduct[];
}

/** If value is a string with newlines, return array of trimmed non-empty lines; else return single value. */
function toMultiValue(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  const s = String(val).trim();
  if (!s) return [];
  if (s.includes('\n')) return s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [val];
}

/**
 * Merge rows into products: a new product starts when the SKU column is non-empty.
 * Continuation rows merge into the current product: multi-value fields become arrays
 * (e.g. "Carton": ["A", "B"], "Features": ["Delivery:...", "Capacity:...", ...]).
 */
function mergeRowsBySku(rows: Record<string, any>[], skuColumn: string): RawProduct[] {
  let currentProduct: RawProduct | null = null;
  const products: RawProduct[] = [];

  for (const row of rows) {
    if (row[skuColumn]) {
      if (currentProduct !== null) products.push(currentProduct);
      currentProduct = {};
      for (const key in row) {
        const val = row[key];
        if (val === undefined || val === '') continue;
        const parts = toMultiValue(val);
        if (parts.length === 0) continue;
        currentProduct[key] = parts.length === 1 ? parts[0]! : parts;
      }
    } else if (currentProduct !== null) {
      for (const key in row) {
        const val = row[key];
        if (val === undefined || val === '') continue;
        const parts = toMultiValue(val);
        if (parts.length === 0) continue;
        let existing = currentProduct[key];
        if (!Array.isArray(existing)) existing = existing !== undefined && existing !== '' ? [existing] : [];
        if (existing.length === 0) {
          currentProduct[key] = parts.length === 1 ? parts[0]! : parts;
        } else {
          currentProduct[key] = [...existing, ...parts];
        }
      }
    }
  }
  if (currentProduct !== null) products.push(currentProduct);
  return products;
}

/**
 * Parse an .xlsx workbook from a buffer (all tabs). No file written to disk.
 */
export function parseWorkbookFromBuffer(buffer: Buffer): TabProducts[] {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;
  const tabs: TabProducts[] = [];

  // [HARDCODED] Only parse the first tab for the demo.
  const tabsToParse = sheetNames.slice(0, 1);

  for (const sheetName of tabsToParse) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { range: GOLDEN_DESIGNS_CONFIG.headerRow }) as Record<string, any>[];
    const products = mergeRowsBySku(rows, GOLDEN_DESIGNS_CONFIG.skuColumn);
    if (products.length > 0) {
      tabs.push({ name: sheetName, products });
    }
  }
  return tabs;
}

/**
 * Parse an .xlsx sheet into an array of product objects (file path).
 */
export function parseSheet(config: ParseSheetConfig): RawProduct[] {
  const workbook = xlsx.readFile(config.filePath);
  const sheetNames = workbook.SheetNames;

  const sheetName = sheetNames[config.sheetIndex];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { range: config.headerRow }) as Record<string, any>[];
  const products = mergeRowsBySku(rows, config.skuColumn);

  if (rows.length > 0 && products.length === 0) {
    const headerKeys = Object.keys(rows[0]).filter((k) => k && String(k).trim());
    console.warn(`  No products found. Header row has ${rows.length} row(s). Column names: ${headerKeys.slice(0, 12).join(', ')}${headerKeys.length > 12 ? '...' : ''}`);
    console.warn(`  Looking for SKU column: "${config.skuColumn}"`);
  }
  console.log(`Parsed ${products.length} products from tab "${sheetName}"`);
  return products;
}

// --- Format parsed product as human-readable text (for prompts or debugging) ---
// This is hardcoded to the Golden Designs sheet structure.

/** Keys for the top section, in display order. Sheet headers may contain newlines. */
const TOP_SECTION_KEYS = [
  'Description',
  'EMF\n(Low, Ultra Low, Near Zero)',
  'Color',
  'Wood Type\nHemlock\nRed Cedar\nOther',
  'Brand Name',
  'Product Ad-Copy',
  'Features',
];
const PRODUCT_DIMENSION_KEYS = ['Product Weight', 'Dimensions', 'Length', 'Width', 'Height'];
const CARTON_KEYS = ['Carton', 'Ship Weight', 'Ship Dimensions', 'Ship Length', 'Ship Width', 'Ship Height'];
const BOTTOM_KEYS = ['Ship Ground or LTL', 'LTL Pallet Dims', 'LTL Pallet Weight'];

function lineLabel(key: string): string {
  return key.replace(/\n/g, ' ') + ': ';
}

/** Get value as string (arrays joined with newline for backward compat). */
function getStr(p: RawProduct, key: string): string {
  const v = p[key];
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join('\n');
  return String(v).trim();
}

/** Get value as array (single values become one-element array). */
function valueAsArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

/**
 * Convert a single parsed product (JSON) into the human-readable "pricing sheet input" text format.
 * Handles multiple cartons by splitting newline-separated Carton / Ship Weight / Ship Dimensions etc. into separate blocks.
 */
export function formatProductAsPricingSheetText(product: RawProduct): string {
  const lines: string[] = [];

  // Top section
  for (const key of TOP_SECTION_KEYS) {
    const label = lineLabel(key);
    if (key === 'Features') {
      const featureLines = valueAsArray(product[key]);
      if (featureLines.length === 0) continue;
      lines.push('Features:');
      for (const featureLine of featureLines) lines.push(featureLine);
      lines.push('');
    } else {
      const val = getStr(product, key);
      if (!val) continue;
      lines.push(label + val);
    }
    lines.push('');
  }
  if (lines.length && lines[lines.length - 1] !== '') lines.push('');

  // Product dimensions
  for (const key of PRODUCT_DIMENSION_KEYS) {
    const val = getStr(product, key);
    if (val === '' && key !== 'Product Weight') continue;
    lines.push(lineLabel(key) + (val || ''));
  }
  lines.push('');

  // Carton blocks: each carton is an index into the Carton / Ship Weight / etc. arrays
  const cartonVals = CARTON_KEYS.map((key) => valueAsArray(product[key]));
  const nCartons = Math.max(1, ...cartonVals.map((a) => a.length));
  for (let i = 0; i < nCartons; i++) {
    lines.push(lineLabel('Carton') + (cartonVals[0][i] ?? ''));
    lines.push(lineLabel('Ship Weight') + (cartonVals[1][i] ?? ''));
    lines.push(lineLabel('Ship Dimensions') + (cartonVals[2][i] ?? ''));
    lines.push(lineLabel('Ship Length') + (cartonVals[3][i] ?? ''));
    lines.push(lineLabel('Ship Width') + (cartonVals[4][i] ?? ''));
    lines.push(lineLabel('Ship Height') + (cartonVals[5][i] ?? ''));
    lines.push('');
  }

  // LTL / shipping at end
  for (const key of BOTTOM_KEYS) {
    const val = getStr(product, key);
    lines.push(lineLabel(key) + val);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

// --- Separate features-relevant vs specs-relevant for listing generation ---

/**
 * Extract from the pricing sheet only the information relevant to customer-facing features
 * (description, EMF, color, wood type, brand, ad-copy, features list). Excludes dimensions/weights.
 */
export function getFeaturesRelevantFromSheet(product: RawProduct): string {
  const lines: string[] = [];
  for (const key of TOP_SECTION_KEYS) {
    const label = lineLabel(key);
    if (key === 'Features') {
      const featureLines = valueAsArray(product[key]);
      if (featureLines.length === 0) continue;
      lines.push('Features:');
      for (const featureLine of featureLines) lines.push(featureLine);
    } else {
      const val = getStr(product, key);
      if (!val) continue;
      lines.push(label + val);
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Extract from the pricing sheet only the information relevant to the specifications table
 * (product weight, dimensions, each carton block, LTL). Excludes descriptive/copy.
 */
export function getSpecsRelevantFromSheet(product: RawProduct): string {
  const lines: string[] = [];
  for (const key of PRODUCT_DIMENSION_KEYS) {
    const val = getStr(product, key);
    if (val === '' && key !== 'Product Weight') continue;
    lines.push(lineLabel(key) + (val || ''));
  }
  lines.push('');
  const cartonVals = CARTON_KEYS.map((key) => valueAsArray(product[key]));
  const nCartons = Math.max(1, ...cartonVals.map((a) => a.length));
  for (let i = 0; i < nCartons; i++) {
    lines.push(lineLabel('Carton') + (cartonVals[0][i] ?? ''));
    lines.push(lineLabel('Ship Weight') + (cartonVals[1][i] ?? ''));
    lines.push(lineLabel('Ship Dimensions') + (cartonVals[2][i] ?? ''));
    lines.push(lineLabel('Ship Length') + (cartonVals[3][i] ?? ''));
    lines.push(lineLabel('Ship Width') + (cartonVals[4][i] ?? ''));
    lines.push(lineLabel('Ship Height') + (cartonVals[5][i] ?? ''));
    lines.push('');
  }
  for (const key of BOTTOM_KEYS) {
    const val = getStr(product, key);
    lines.push(lineLabel(key) + val);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
