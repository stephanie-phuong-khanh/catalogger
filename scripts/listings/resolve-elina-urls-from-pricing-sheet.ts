/**
 * Resolve Elina product URLs from the (grouped) pricing sheet: process groups one by one,
 * write article_ref → url to the output file after each group so we can resume.
 *
 * Input: JSON from parse-pdf-pricing-sheet-v2 (has .groups) or legacy flat array (we group by product_name).
 * Output: JSON object article_ref → url. Updated after each group; use --fresh to wipe and start over.
 *
 * Usage:
 *   npm run resolve-elina-urls -- --input-file=data/parsed-pricing-sheets/elina_pilates_pricing_sheet.json --out-file=data/elina-product-urls.json
 *   npm run resolve-elina-urls -- --fresh   # wipe output and resolve all from scratch
 *   npm run resolve-elina-urls              # pick up where we left off (read output, skip done groups)
 *   npm run resolve-elina-urls -- --headed
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveVendorUrlsForGroups } from '../../lib/listings/search-vendor-puppeteer';

const CONFIG = {
  inputFile: 'data/parsed-pricing-sheets/elina_pilates_pricing_sheet.json',
  outFile: 'data/parsed-pricing-sheets/elina_pilates_products_urls.json',
  vendorBaseUrl: 'https://www.elinapilates.com',
};

type PricingRow = { article_ref?: string; product_name?: string; [k: string]: unknown };

type InputGroup = { product_name?: string; items?: PricingRow[]; articleRefs?: string[] };

function parseArg(name: string, defaultValue: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=').trim() : defaultValue;
}

/** Normalize input: grouped format has .groups; legacy flat array we group by product_name. */
function normalizeGroups(input: unknown): { articleRefs: string[] }[] {
  if (input && typeof input === 'object' && 'groups' in input && Array.isArray((input as { groups: unknown }).groups)) {
    const groups = (input as { groups: InputGroup[] }).groups;
    return groups.map((g) => ({
      articleRefs: (g.items ?? [])
        .map((i) => (i.article_ref != null ? String(i.article_ref).trim() : ''))
        .filter(Boolean),
    }));
  }
  if (Array.isArray(input)) {
    const byName = new Map<string, string[]>();
    for (const row of input as PricingRow[]) {
      const name = (row.product_name ?? '').trim() || '(no name)';
      const ref = row.article_ref != null ? String(row.article_ref).trim() : '';
      if (!ref) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(ref);
    }
    return Array.from(byName.values()).map((articleRefs) => ({ articleRefs }));
  }
  return [];
}

async function main() {
  const inputFile = parseArg('input-file', CONFIG.inputFile);
  const outFile = parseArg('out-file', CONFIG.outFile);
  const headed = process.argv.includes('--headed');
  const fresh = process.argv.includes('--fresh');

  const inputPath = path.isAbsolute(inputFile) ? inputFile : path.join(process.cwd(), inputFile);
  const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile);

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let urlMap: Record<string, string> = {};
  if (fresh) {
    fs.writeFileSync(outPath, '{}', 'utf-8');
    console.log('--fresh: wiped output file.');
  } else if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        urlMap = { ...existing };
        console.log(`Loaded ${Object.keys(urlMap).length} existing URL(s) from ${outPath}. Will skip done groups.\n`);
      }
    } catch {
      console.log('Could not parse output file; starting with empty map.\n');
    }
  }

  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found:', inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf-8');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON in', inputPath, e);
    process.exit(1);
  }

  const allGroups = normalizeGroups(input);
  const groupsToDo = allGroups.filter((g) => g.articleRefs.some((ref) => !urlMap[ref]));

  if (groupsToDo.length === 0) {
    console.log('All groups already resolved. Nothing to do.');
    process.exit(0);
  }

  console.log(
    `Groups: ${groupsToDo.length} to do (${allGroups.length - groupsToDo.length} already done). Resolving...\n`,
  );
  if (headed) console.log('(Running in headed mode.)\n');

  const onGroupDone = (groupUrls: Record<string, string>) => {
    Object.assign(urlMap, groupUrls);
    fs.writeFileSync(outPath, JSON.stringify(urlMap, null, 2), 'utf-8');
  };

  await resolveVendorUrlsForGroups(CONFIG.vendorBaseUrl, groupsToDo, {
    headed,
    visitHomepageFirst: true,
    onGroupDone,
  });

  console.log(`Done. ${Object.keys(urlMap).length} URL(s) in ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
