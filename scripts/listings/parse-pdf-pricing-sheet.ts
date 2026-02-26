/**
 * This is a script to parse a PDF pricing sheet.
 * Currently, this handles only the Elina Pilates pricing sheet.
 * 
 * Usage:
 *   npm run parse-pdf-pricing-sheet -- --input-file "data/elina_pilates_pricing_sheet.pdf"
 */

import fs from 'fs';
import path from 'path';

const CONFIG = {
  inputFile: 'data/elina_pilates_pricing_sheet.pdf',
  outDir: 'data/parsed-pricing-sheets',
};

// TODO: Use if flag is provided, override CONFIG. If not, use CONFIG.
function main() {
  const inputFile = process.argv.find((arg) => arg.startsWith('--input-file'));
  if (inputFile) {
    CONFIG.inputFile = inputFile.split('=')[1];
  }
  const outDir = process.argv.find((arg) => arg.startsWith('--out-dir'));
  if (outDir) {
    CONFIG.outDir = outDir.split('=')[1];
  }

  if (!CONFIG.inputFile.endsWith('.pdf')) {
    throw new Error('Input file must be a pdf');
  }

  // TODO: Define a JSON schema structure corresponding to the pricing sheet's main table and desired output.
  // TODO: Call LlamaParse API to parse the pdf and return with StructuredOutput.
  const parsedData: any[] = [];

  // TODO: Output JSON to the outDir, with the same name as the input file but with a .json extension.
  const outPath = path.join(CONFIG.outDir, `${path.basename(CONFIG.inputFile, '.pdf')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(parsedData, null, 2));
  console.log(`Wrote ${parsedData.length} product(s) to ${outPath}`);
}

main();
