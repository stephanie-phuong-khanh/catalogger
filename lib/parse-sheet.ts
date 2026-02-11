import xlsx from 'xlsx';

export type RawProduct = Record<string, any>;

interface ParseSheetConfig {
  filePath: string;
  sheetIndex: number;   // [HARDCODED] which tab to parse
  headerRow: number;     // [HARDCODED] 0-indexed row number for headers
  skuColumn: string;     // [HARDCODED] column name that identifies a new product row
}

/**
 * Parse an .xlsx sheet into an array of product objects.
 * Merges multi-row products (e.g. features spanning multiple rows) into single objects.
 */
export function parseSheet(config: ParseSheetConfig): RawProduct[] {
  const workbook = xlsx.readFile(config.filePath);
  const sheetNames = workbook.SheetNames;
  console.log(`Sheet tabs: ${sheetNames.join(', ')}`);

  const sheetName = sheetNames[config.sheetIndex];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { range: config.headerRow });

  // Merge multi-row products: a new product starts when the SKU column is non-empty.
  // Continuation rows (no SKU) get their values appended to the current product.
  let currentProduct: RawProduct | null = null;
  const products: RawProduct[] = [];

  for (const row of rows) {
    if ((row as any)[config.skuColumn]) {
      if (currentProduct !== null) {
        products.push(currentProduct);
      }
      currentProduct = { ...(row as any) };
    } else if (currentProduct !== null) {
      for (const key in row as any) {
        const val = (row as any)[key];
        if (val !== undefined && val !== '') {
          currentProduct[key] = currentProduct[key]
            ? currentProduct[key] + '\n* ' + val
            : val;
        }
      }
    }
  }
  if (currentProduct !== null) {
    products.push(currentProduct);
  }

  console.log(`Parsed ${products.length} products from "${sheetName}"`);
  return products;
}
