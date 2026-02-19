/**
 * Export _all_listings.json to ONE combined TXT file for review (e.g. paste into Google Doc).
 * Output: same folder as input, _all_listings_for_review.txt
 *
 * Sections per listing: (1) Generated listing, (2) Pricing sheet data, (3) Vendor website data + link.
 * Separators: ======== between sections; ***sku*** <SKU> between listings (Ctrl+F to find, then make header in gdocs).
 */
import fs from 'fs';
import path from 'path';
import { formatProductAsPricingSheetText } from '../lib/parse-sheet';
import { formatProductAsVendorSiteText } from '../lib/search-vendor';

const SECTION_SEP = '========================================================================';

const SKU_MARKER = '***sku***';

function skuHeader(sku: string): string {
  return `${SKU_MARKER} ${sku}`;
}

function formatSpecTable(spec: { tableTitle: string; columns: string[]; rows: { label: string; values: string[] }[] }): string {
  const headers = ['Row', ...spec.columns];
  const rows = spec.rows.map((r) => [r.label, ...r.values]);
  const colCount = headers.length;
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = headers[c]!.length;
    for (const row of rows) max = Math.max(max, (row[c] ?? '').length);
    widths.push(Math.max(max, 2));
  }
  const line = (cells: string[]) =>
    '| ' + cells.map((cell, c) => (cell ?? '').padEnd(widths[c]!)).join(' | ') + ' |';
  const sep = '|' + widths.map((w) => '_'.repeat(w + 2)).join('|') + '|';
  const out: string[] = [spec.tableTitle, '', line(headers), sep, ...rows.map((r) => line(r))];
  return out.join('\n');
}

type Listing = {
  sku: string;
  title: string;
  features: string[];
  overviewParagraph: string | { overviewParagraph?: string };
  specifications: { tableTitle: string; columns: string[]; rows: { label: string; values: string[] }[] };
  vendorPageUrl: string | null;
  _raw?: Record<string, unknown>;
  _vendorData?: { title: string; url: string; body: string[]; price?: string } | null;
};

function overviewText(listing: Listing): string {
  const o = listing.overviewParagraph;
  if (typeof o === 'string') return o;
  return (o && (o as { overviewParagraph?: string }).overviewParagraph) || '';
}

function listingToTxt(listing: Listing): string {
  const spec = listing.specifications;
  const sheetBlock = listing._raw
    ? formatProductAsPricingSheetText(listing._raw as any)
    : '(No sheet data in this file.)';
  const vendorBlock = listing._vendorData
    ? formatProductAsVendorSiteText(listing._vendorData as any)
    : '(No vendor data in this file.)';
  const vendorUrl = listing.vendorPageUrl || '';

  const specTable = formatSpecTable(spec);

  const parts: string[] = [
    SECTION_SEP,
    '1. GENERATED LISTING',
    SECTION_SEP,
    '',
    'TITLE:',
    listing.title,
    '',
    'OVERVIEW:',
    overviewText(listing),
    '',
    'FEATURES:',
    ...listing.features.map((f) => `  • ${f}`),
    '',
    'SPECIFICATIONS:',
    specTable,
    '',
    SECTION_SEP,
    '2. PRICING SHEET DATA (as extracted)',
    SECTION_SEP,
    '',
    sheetBlock,
    '',
    SECTION_SEP,
    '3. VENDOR WEBSITE DATA',
    SECTION_SEP,
    '',
  ];
  if (vendorUrl) {
    parts.push(`Vendor page: ${vendorUrl}`);
    parts.push('');
  }
  parts.push(vendorBlock);

  return parts.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  if (!inputPath) {
    console.error('Usage: npx ts-node scripts/export-listing-for-review.ts <path-to-_all_listings.json>');
    console.error('Example: npx ts-node scripts/export-listing-for-review.ts data/listings/tab_4_dynamic_ultra_emf/_all_listings.json');
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error('File not found:', resolvedInput);
    process.exit(1);
  }

  const outDir = path.dirname(resolvedInput);
  const outPath = path.join(outDir, '_all_listings_for_review.txt');

  let listings: Listing[] = [];
  try {
    const content = fs.readFileSync(resolvedInput, 'utf-8');
    const parsed = JSON.parse(content);
    listings = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error('Invalid JSON:', resolvedInput);
    process.exit(1);
  }

  if (listings.length === 0) {
    console.error('No listings in file.');
    process.exit(1);
  }

  const body = listings
    .map((listing, i) => {
      const block = listingToTxt(listing);
      const header = skuHeader(listing.sku);
      return i === 0 ? [header, '', block].join('\n') : [header, '', block].join('\n');
    })
    .join('\n\n');

  const preamble = [
    `Listing review (${listings.length} product(s))`,
    '',
  ].join('\n');

  fs.writeFileSync(outPath, preamble + body, 'utf-8');
  console.log('Wrote', outPath, `(${listings.length} listings)`);
}

main();
