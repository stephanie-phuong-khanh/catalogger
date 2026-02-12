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
 * Group rows by SKU, then build each product directly as:
 *  - flat key-value from the primary row (for UI, lookups)
 *  - _markdown: a markdown table of ALL rows for this SKU, preserving
 *    the exact column structure from the spreadsheet
 */
function groupRowsBySku(
  rows: Record<string, any>[],
  skuColumn: string,
  allColumns: string[],
): RawProduct[] {
  const products: RawProduct[] = [];
  let currentRows: Record<string, any>[] = [];

  for (const row of rows) {
    if (row[skuColumn]) {
      if (currentRows.length > 0) {
        products.push(buildProduct(currentRows, allColumns));
      }
      currentRows = [row];
    } else if (currentRows.length > 0) {
      currentRows.push(row);
    }
  }
  if (currentRows.length > 0) {
    products.push(buildProduct(currentRows, allColumns));
  }
  return products;
}

/**
 * Build a RawProduct from a group of rows (primary + continuation rows).
 * The primary row's values are spread as top-level keys for easy access.
 * _markdown contains a markdown table of ALL rows with the original columns.
 */
function buildProduct(rows: Record<string, any>[], allColumns: string[]): RawProduct {
  // Primary row provides flat key-value access
  const product: RawProduct = { ...rows[0] };

  // Sanitize a cell value: replace in-cell newlines with spaces
  // so they don't break the markdown table row structure
  const sanitize = (val: any): string => {
    if (val === undefined || val === null) return '';
    return String(val).replace(/\n/g, ' ');
  };

  // Build markdown table directly from the raw rows
  const header = `| ${allColumns.map(sanitize).join(' | ')} |`;
  const divider = `|${allColumns.map(() => ' --- ').join('|')}|`;
  const dataRows = rows.map(row => {
    const cells = allColumns.map(col => sanitize(row[col]));
    return `| ${cells.join(' | ')} |`;
  });

  product._markdown = `${header}\n${divider}\n${dataRows.join('\n')}`;

  return product;
}

/**
 * Get ALL column headers from a sheet's header row.
 * This gives us the full column list regardless of which rows have data.
 */
function getColumnHeaders(sheet: xlsx.WorkSheet, headerRow: number): string[] {
  const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
  const headers: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = xlsx.utils.encode_cell({ r: headerRow, c: col });
    const cell = sheet[cellAddr];
    if (cell && cell.v !== undefined && cell.v !== '') {
      headers.push(String(cell.v));
    }
  }
  return headers;
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
    const allColumns = getColumnHeaders(sheet, GOLDEN_DESIGNS_CONFIG.headerRow);
    const rows = xlsx.utils.sheet_to_json(sheet, { range: GOLDEN_DESIGNS_CONFIG.headerRow }) as Record<string, any>[];
    const products = groupRowsBySku(rows, GOLDEN_DESIGNS_CONFIG.skuColumn, allColumns);
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
  console.log(`Sheet tabs: ${sheetNames.join(', ')}`);

  const sheetName = sheetNames[config.sheetIndex];
  const sheet = workbook.Sheets[sheetName];
  const allColumns = getColumnHeaders(sheet, config.headerRow);
  const rows = xlsx.utils.sheet_to_json(sheet, { range: config.headerRow }) as Record<string, any>[];
  const products = groupRowsBySku(rows, config.skuColumn, allColumns);

  console.log(`Parsed ${products.length} products from "${sheetName}"`);
  return products;
}
