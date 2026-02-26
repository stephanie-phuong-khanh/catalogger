/**
 * Entry point: parse a pricing sheet and write products to JSON.
 * All parsing logic lives in lib/listings/parse-sheet.ts.
 *
 * Usage:
 *   npm run parse-sheet              # parse full sheet
 *   npm run parse-sheet -- --single DYN-6103-01   # parse and output only this SKU
 *   npm run parse-sheet -- --print-only            # log to console only (no file write)
 *   npm run parse-sheet -- --print-only-json         # log to console only (no file write)
 
 * Future: LLM-assisted parsing to infer sheet structure (headers, SKU column, etc.).
 * TODO: Match products across sheets; count unique products.
 */
import fs from 'fs';
import path from 'path';
import { parseSheet, formatProductAsPricingSheetText } from '../../lib/listings/parse-sheet';

const CONFIG = {
  sheetFile: 'data/input/2025-2026 Ecommerce Saunas 08-01-2025 Final - Revised.xlsx',
  sheetIndex: 3,       // 0-based tab index (0 = "Tab 1 - Most Popular")
  headerRow: 3,        // 0-based row where headers live (row 4 in Excel)
  skuColumn: 'GDINA Item #',
  outputFile: 'data/parsed-pricing-sheets/golden_designs.json',
};

function main() {
  const onlySku = (() => {
    const i = process.argv.indexOf('--single');
    if (i === -1) return undefined;
    return process.argv[i + 1]?.trim();
  })();
  const printOnly = process.argv.includes('--print-only');
  const printOnlyJson = process.argv.includes('--print-only-json');

  let products = parseSheet({
    filePath: CONFIG.sheetFile,
    sheetIndex: CONFIG.sheetIndex,
    headerRow: CONFIG.headerRow,
    skuColumn: CONFIG.skuColumn,
  });

  if (onlySku) {
    products = products.filter((p) => (p[CONFIG.skuColumn] ?? '').toString().trim() === onlySku);
    if (products.length === 0) {
      console.error(`No product found with ${CONFIG.skuColumn} = "${onlySku}".`);
      process.exit(1);
    }
    console.log(`Filtered to 1 product: ${onlySku}`);
  }

  console.log('');

  if (printOnlyJson) {
    console.log(JSON.stringify(products, null, 2));
    return;
  }

  if (printOnly) {
    for (const product of products) {
      console.log(formatProductAsPricingSheetText(product));
    }
    return;
  }

  const outPath = path.resolve(CONFIG.outputFile);
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(products, null, 2));
  console.log(`Wrote ${products.length} product(s) to ${outPath}`);
}

main();
