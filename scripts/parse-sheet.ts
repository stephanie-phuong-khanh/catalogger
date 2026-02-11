/**
 * Entry point: parse a pricing sheet and write products to JSON.
 * All parsing logic lives in lib/parse-sheet.ts.
 *
 * Future: LLM-assisted parsing to infer sheet structure (headers, SKU column, etc.).
 * TODO: Match products across sheets; count unique products.
 */
import fs from 'fs';
import path from 'path';
import { parseSheet } from '../lib/parse-sheet';

const CONFIG = {
  sheetFile: 'data/2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx',
  sheetIndex: 1,       // 0-based tab index (1 = "Tab 1 - Most Popular")
  headerRow: 3,        // 0-based row where headers live (row 4 in Excel)
  skuColumn: 'GDINA Item #',
  outputFile: 'data/parsed_products.json',
};

function main() {
  const products = parseSheet({
    filePath: CONFIG.sheetFile,
    sheetIndex: CONFIG.sheetIndex,
    headerRow: CONFIG.headerRow,
    skuColumn: CONFIG.skuColumn,
  });

  const outPath = path.resolve(CONFIG.outputFile);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(products, null, 2));
  console.log(`Wrote ${products.length} products to ${outPath}`);
}

main();
