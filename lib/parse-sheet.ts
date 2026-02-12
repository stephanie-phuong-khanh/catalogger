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

/**
 * Merge rows into products: a new product starts when the SKU column is non-empty.
 * Continuation rows get their values appended to the current product.
 */
function mergeRowsBySku(rows: Record<string, any>[], skuColumn: string): RawProduct[] {
  let currentProduct: RawProduct | null = null;
  const products: RawProduct[] = [];

  for (const row of rows) {
    if (row[skuColumn]) {
      if (currentProduct !== null) products.push(currentProduct);
      currentProduct = { ...row };
    } else if (currentProduct !== null) {
      for (const key in row) {
        const val = row[key];
        if (val !== undefined && val !== '') {
          currentProduct[key] = currentProduct[key]
            ? currentProduct[key] + '\n* ' + val
            : val;
        }
      }
    }
  }
  if (currentProduct !== null) products.push(currentProduct);
  return products;
}

/**
 * Parse an .xlsx workbook from a buffer (all tabs). No file written to disk.
 * Returns one entry per sheet. [HARDCODED] Same headerRow and skuColumn for every tab.
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
 * Convert a RawProduct to a markdown string for LLM consumption.
 * Single-value fields become "key: value" lines.
 * Array fields (multi-row data like shipping cartons) become a markdown table
 * so the LLM can see spatial relationships (e.g. Carton A = 154 lbs = 7" x 64" x 71").
 */
export function productToMarkdown(product: RawProduct): string {
  const singleFields: string[] = [];
  const arrayKeys: string[] = [];

  for (const [key, value] of Object.entries(product)) {
    if (Array.isArray(value)) {
      arrayKeys.push(key);
    } else {
      singleFields.push(`${key}: ${value}`);
    }
  }

  let result = singleFields.join('\n');

  if (arrayKeys.length > 0) {
    const rowCount = Math.max(...arrayKeys.map(k => (product[k] as any[]).length));
    const header = `| ${arrayKeys.join(' | ')} |`;
    const divider = `|${arrayKeys.map(() => ' --- ').join('|')}|`;
    const rows: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const cells = arrayKeys.map(k => (product[k] as any[])[i] ?? '');
      rows.push(`| ${cells.join(' | ')} |`);
    }
    result += `\n\nMulti-row data (each row is one shipping carton):\n${header}\n${divider}\n${rows.join('\n')}`;
  }

  return result;
}

/**
 * Parse an .xlsx sheet into an array of product objects (file path).
 * Merges multi-row products (e.g. features spanning multiple rows) into single objects.
 */
export function parseSheet(config: ParseSheetConfig): RawProduct[] {
  const workbook = xlsx.readFile(config.filePath);
  const sheetNames = workbook.SheetNames;
  console.log(`Sheet tabs: ${sheetNames.join(', ')}`);

  const sheetName = sheetNames[config.sheetIndex];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { range: config.headerRow }) as Record<string, any>[];
  const products = mergeRowsBySku(rows, config.skuColumn);

  console.log(`Parsed ${products.length} products from "${sheetName}"`);
  return products;
}
