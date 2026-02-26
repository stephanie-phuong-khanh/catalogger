/**
 * Parse a PDF pricing sheet into JSON using text extraction only (no AI).
 * Uses pdf-parse to get raw text, then line-by-line parsing to produce one JSON
 * object per table row. Output is suitable for later scripts or LLMs to normalize.
 *
 * Usage:
 *   npm run parse-pdf-pricing-sheet-v2 -- --input-file="path/to/file.pdf"
 *   npm run parse-pdf-pricing-sheet-v2 -- --input-file="path/to/file.pdf" --out-dir="data/parsed-pricing-sheets"
 */

import fs from 'fs';
import path from 'path';

// pdf-parse v2 (mehmet-kozan): use PDFParse class + getText()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require('pdf-parse');

const CONFIG = {
  inputFile: '',
  outDir: 'data/parsed-pricing-sheets',
};

export interface ParsedPricingRow {
  article_ref: string;   // e.g. "USA 100006" or "100006"
  description: string;
  price_raw: string;     // as in PDF e.g. "$3.995,00"
  price_usd: number;     // normalized number
  barcode: string;
}

/** Parse European-style price (e.g. $3.995,00 or $650,00) to number. */
function parsePrice(raw: string): number {
  const cleaned = raw.replace(/\$/g, '').trim();
  if (!cleaned) return NaN;
  // European: thousands = . or , and decimal = , (e.g. 3.995,00 or 1,521,00)
  const lastComma = cleaned.lastIndexOf(',');
  if (lastComma >= 0) {
    const decimalPart = cleaned.slice(lastComma + 1);
    const intPart = cleaned.slice(0, lastComma).replace(/[.,\s]/g, '');
    const joined = `${intPart}.${decimalPart}`;
    return parseFloat(joined);
  }
  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.') || '0');
}

/** True if line looks like a header or section marker we should skip. */
function isNonDataLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^Article Ref\./i.test(t) || /^Description Prices/i.test(t) || /^Prices \$ Barcodes/i.test(t)) return true;
  if (/^PRICE LIST/i.test(t) || /^--\s*\d+\s+of\s+\d+\s*--/.test(t)) return true;
  if (/^CLASSIC LINE$/i.test(t) || /^NEW MODELS$/i.test(t)) return true;
  return false;
}

/** Match a data row: USA + digits + description + price + barcode. Returns null if not a data row. */
function parseDataLine(line: string): ParsedPricingRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Article ref: "USA " or "USA" followed by 6+ digits (e.g. USA 100006 or USA300311)
  const usaMatch = trimmed.match(/^USA\s*(\d{6,})\s+(.+)$/);
  if (!usaMatch) return null;

  const afterRef = usaMatch[2]!.trim();
  // Price: $X.XXX,XX or $X,XX before barcode; barcode = 13 digits at end (allow tab/space before $)
  const priceBarcode = afterRef.match(/\s+\$([\d.,]+)\s+(\d{13})$/);
  if (!priceBarcode) return null;

  const priceStart = afterRef.search(/\s+\$[\d.,]+\s+\d{13}$/);
  const description = (priceStart >= 0 ? afterRef.slice(0, priceStart) : afterRef).trim();
  const priceRaw = '$' + priceBarcode[1];
  const priceUsd = parsePrice(priceRaw);
  const barcode = priceBarcode[2]!;
  return {
    article_ref: `USA ${usaMatch[1]}`,
    description,
    price_raw: priceRaw,
    price_usd: isNaN(priceUsd) ? 0 : priceUsd,
    barcode,
  };
}

/** Extract text from PDF buffer using pdf-parse (PDFParse + getText). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result && (result as { text?: string }).text) ?? '';
  } finally {
    await parser.destroy();
  }
}

/** Parse PDF buffer into array of row objects. */
export async function parsePdfPricingToRows(buffer: Buffer): Promise<ParsedPricingRow[]> {
  const text = await extractPdfText(buffer);
  const lines = text.split(/\r?\n/);
  const rows: ParsedPricingRow[] = [];

  for (const line of lines) {
    if (isNonDataLine(line)) continue;
    const row = parseDataLine(line);
    if (row) rows.push(row);
  }

  return rows;
}

async function main(): Promise<void> {
  const inputFileArg = process.argv.find((arg) => arg.startsWith('--input-file'));
  if (inputFileArg) {
    CONFIG.inputFile = inputFileArg.includes('=') ? inputFileArg.split('=')[1]!.trim() : (process.argv[process.argv.indexOf('--input-file') + 1] ?? '').trim();
  }
  const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir'));
  if (outDirArg) {
    CONFIG.outDir = outDirArg.includes('=') ? outDirArg.split('=')[1]!.trim() : (process.argv[process.argv.indexOf('--out-dir') + 1] ?? CONFIG.outDir).trim();
  }

  if (!CONFIG.inputFile?.endsWith('.pdf')) {
    console.error('Usage: --input-file="path/to/file.pdf" [--out-dir="data/parsed-pricing-sheets"]');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(CONFIG.inputFile) ? CONFIG.inputFile : path.join(process.cwd(), CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputPath);
  const rows = await parsePdfPricingToRows(buffer);

  const outPath = path.join(CONFIG.outDir, `${path.basename(CONFIG.inputFile, '.pdf')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} row(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
