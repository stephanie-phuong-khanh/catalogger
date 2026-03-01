/**
 * Parse a PDF pricing sheet into JSON: text extraction (no AI) then optional LLM
 * step to split description_raw into product_name and color.
 *
 * 1. pdf-parse extracts text; we parse rows to get description_raw, price, barcode.
 * 2. A cheap OpenAI call (batched) parses each description_raw → product_name + color.
 *
 * Usage:
 *   npm run parse-pdf-pricing-sheet -- --input-file="path/to/file.pdf"
 *   npm run parse-pdf-pricing-sheet -- --input-file="path/to/file.pdf" --out-dir="data/elina"
 *   npm run parse-pdf-pricing-sheet -- --input-file="path/to/file.pdf" --no-llm   # skip LLM; product_name/color left empty
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

dotenv.config();
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });

// pdf-parse v2 (mehmet-kozan): use PDFParse class + getText()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PDFParse } = require('pdf-parse');

const CONFIG = {
  inputFile: 'data/input/elina_pilates_pricing_sheet.pdf',
  outDir: 'data/elina',
  useLlm: true,
};

export interface ParsedPricingRow {
  article_ref: string;
  description_raw: string;
  product_name: string;   // title case, base name without color (filled by LLM or empty if --no-llm)
  color: string | null;  // e.g. "BLACK", "GREY", or null (filled by LLM or null if --no-llm)
  price_raw: string;
  price_usd: number;
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
  const description_raw = (priceStart >= 0 ? afterRef.slice(0, priceStart) : afterRef).trim();
  const priceRaw = '$' + priceBarcode[1];
  const priceUsd = parsePrice(priceRaw);
  const barcode = priceBarcode[2]!;
  return {
    article_ref: usaMatch[1]!,
    description_raw,
    product_name: '',
    color: null as string | null,
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

const BATCH_SIZE = 30;

const ParseDescriptionsSchema = z.object({
  items: z.array(z.object({
    product_name: z.string().describe('Product base name in Title Case, with no color word. E.g. "Reformer", "Reformer With Tower".'),
    color: z.string().nullable().describe('Color in ALL CAPS if present (e.g. BLACK, GREY), or null if the description has no color.'),
  })),
});

/** Call OpenAI to parse description_raw into product_name and color (batched). */
async function parseDescriptionsWithLLM(
  openai: OpenAI,
  descriptions: string[],
): Promise<{ product_name: string; color: string | null }[]> {
  if (descriptions.length === 0) return [];
  const response = await openai.responses.parse({
    model: 'gpt-4o-mini',
    temperature: 0,
    input: [
      {
        role: 'system',
        content: `You parse product description strings from a pricing sheet into a product name (no color) and an optional color.

Rules:
- product_name: Title Case, the base product name with the color word REMOVED. The color may appear at the end after an underscore (e.g. REFORMER_BLACK → "Reformer") or in the middle (e.g. REFORMER WITH BLACK TOWER → "Reformer With Tower"). Output the product name only, no color.
- color: The color in ALL CAPS (BLACK, GREY, IVORY, etc.) if present, or null if there is no color in the description.

Examples:
- REFORMER_BLACK → product_name: "Reformer", color: "BLACK"
- REFORMER MASTER INSTRUCTOR_BLACK → product_name: "Reformer Master Instructor", color: "BLACK"
- REFORMER WITH BLACK TOWER → product_name: "Reformer With Tower", color: "BLACK"
- REFORMER WITH TOWER_GREY → product_name: "Reformer With Tower", color: "GREY"
- TOWER FOR ALUMINIUM REFORMER → product_name: "Tower For Aluminium Reformer", color: null

Return one item per input description, in the same order.`,
      },
      {
        role: 'user',
        content: `Parse these ${descriptions.length} descriptions:\n\n${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}`,
      },
    ],
    text: { format: zodTextFormat(ParseDescriptionsSchema, 'parse_descriptions') },
  });
  const parsed = response.output_parsed as z.infer<typeof ParseDescriptionsSchema> | undefined;
  if (!parsed?.items || parsed.items.length !== descriptions.length) {
    throw new Error(`LLM returned ${parsed?.items?.length ?? 0} items, expected ${descriptions.length}`);
  }
  return parsed.items;
}

/** Fill product_name and color on rows using batched LLM calls. */
async function fillProductNameAndColor(rows: ParsedPricingRow[], openai: OpenAI): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const descriptions = batch.map((r) => r.description_raw);
    const results = await parseDescriptionsWithLLM(openai, descriptions);
    for (let j = 0; j < batch.length; j++) {
      batch[j]!.product_name = results[j]!.product_name;
      batch[j]!.color = results[j]!.color;
    }
    console.log(`  LLM parsed ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} descriptions`);
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

/** Group rows by product_name for downstream use (e.g. one search per product). */
export function groupRowsByProductName(rows: ParsedPricingRow[]): { product_name: string; items: ParsedPricingRow[] }[] {
  const byName = new Map<string, ParsedPricingRow[]>();
  for (const row of rows) {
    const name = (row.product_name ?? '').trim() || '(no name)';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(row);
  }
  return Array.from(byName.entries()).map(([product_name, items]) => ({ product_name, items }));
}

export type ParsedPricingSheetGrouped = {
  groups: { product_name: string; items: ParsedPricingRow[] }[];
};

async function main(): Promise<void> {
  const inputFileArg = process.argv.find((arg) => arg.startsWith('--input-file'));
  if (inputFileArg) {
    CONFIG.inputFile = inputFileArg.includes('=') ? inputFileArg.split('=')[1]!.trim() : (process.argv[process.argv.indexOf('--input-file') + 1] ?? '').trim();
  }
  const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir'));
  if (outDirArg) {
    CONFIG.outDir = outDirArg.includes('=') ? outDirArg.split('=')[1]!.trim() : (process.argv[process.argv.indexOf('--out-dir') + 1] ?? CONFIG.outDir).trim();
  }
  if (process.argv.includes('--no-llm')) {
    CONFIG.useLlm = false;
  }

  if (!CONFIG.inputFile?.endsWith('.pdf')) {
    console.error('Usage: --input-file="path/to/file.pdf" [--out-dir="data/elina"] [--no-llm]');
    process.exit(1);
  }

  const inputPath = path.isAbsolute(CONFIG.inputFile) ? CONFIG.inputFile : path.join(process.cwd(), CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputPath);
  const rows = await parsePdfPricingToRows(buffer);
  console.log(`Parsed ${rows.length} row(s) from PDF`);

  if (CONFIG.useLlm) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      console.error('OPENAI_API_KEY is not set. Add to .env or .env.local, or run with --no-llm to skip product_name/color.');
      process.exit(1);
    }
    const openai = new OpenAI({ apiKey });
    await fillProductNameAndColor(rows, openai);
  }

  const groups = groupRowsByProductName(rows);
  const output: ParsedPricingSheetGrouped = { groups };
  const outPath = path.join(CONFIG.outDir, `${path.basename(CONFIG.inputFile, '.pdf')}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${rows.length} row(s) in ${groups.length} group(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
