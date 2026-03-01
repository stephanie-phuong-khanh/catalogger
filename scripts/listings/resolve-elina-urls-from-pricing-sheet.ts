/**
 * Resolve Elina product URLs from the (grouped) pricing sheet: process groups one by one,
 * write article_ref → url to the output file after each group so we can resume.
 *
 * Input: JSON from parse-pdf-pricing-sheet (has .groups) or legacy flat array (we group by product_name).
 * Output: JSON object article_ref → url. Updated after each group; use --fresh to wipe and start over.
 *
 * Usage:
 *   npm run resolve-elina-urls -- --input-file=data/elina/elina_pilates_pricing_sheet.json --out-file=data/elina-product-urls.json
 *   npm run resolve-elina-urls -- --fresh   # wipe output and resolve all from scratch
 *   npm run resolve-elina-urls              # pick up where we left off (read output, skip done groups)
 *   npm run resolve-elina-urls -- --headed
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveVendorUrlsForGroups } from '../../lib/listings/search-vendor-puppeteer';

const CONFIG = {
  inputFile: 'data/elina/elina_pilates_pricing_sheet.json',
  outFile: 'data/elina/elina_pilates_products_urls.json',
  vendorBaseUrl: 'https://www.elinapilates.com',
};

type PricingRow = { article_ref?: string; product_name?: string; [k: string]: unknown };

type InputGroup = { product_name?: string; items?: PricingRow[]; articleRefs?: string[] };

function parseArg(name: string, defaultValue: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=').trim() : defaultValue;
}

type NormalizedGroup = { articleRefs: string[]; product_name?: string };

type NestedUrlOutput = {
  groups: Array<{
    product_name?: string;
    items: Array<{ article_ref: string; url?: string | null; [k: string]: unknown }>;
  }>;
};

/** Build article_ref -> { product_name, color } from input for logging. */
function buildRefToInfo(input: unknown): Record<string, { product_name?: string; color?: string | null }> {
  const out: Record<string, { product_name?: string; color?: string | null }> = {};
  if (input && typeof input === 'object' && 'groups' in input && Array.isArray((input as { groups: unknown }).groups)) {
    for (const g of (input as { groups: InputGroup[] }).groups) {
      const productName = g.product_name;
      for (const item of g.items ?? []) {
        const ref = item.article_ref != null ? String(item.article_ref).trim() : '';
        if (ref) out[ref] = { product_name: productName ?? item.product_name as string, color: item.color as string | null };
      }
    }
  }
  return out;
}

/** Normalize input: grouped format has .groups; legacy flat array we group by product_name. */
function normalizeGroups(input: unknown): NormalizedGroup[] {
  if (input && typeof input === 'object' && 'groups' in input && Array.isArray((input as { groups: unknown }).groups)) {
    const groups = (input as { groups: InputGroup[] }).groups;
    return groups.map((g) => ({
      product_name: g.product_name,
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
    return Array.from(byName.entries()).map(([product_name, articleRefs]) => ({ product_name, articleRefs }));
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

  /** article_ref -> resolved url (null = tried but not found, for resume we skip groups where every ref is in urlMap). */
  let urlMap: Record<string, string | null> = {};
  /** When output file uses nested { groups: [...] } format, keep it so we can write back in same shape. */
  let nestedOutput: NestedUrlOutput | null = null;

  if (fresh) {
    fs.writeFileSync(outPath, '{}', 'utf-8');
    console.log('--fresh: wiped output file.');
  } else if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        if (existing.groups && Array.isArray(existing.groups)) {
          for (const g of existing.groups) {
            for (const item of g.items ?? []) {
              const ref = item.article_ref != null ? String(item.article_ref).trim() : '';
              if (!ref) continue;
              urlMap[ref] = typeof item.url === 'string' ? item.url.trim() : null;
            }
          }
          nestedOutput = existing as NestedUrlOutput;
          console.log(
            `Loaded ${Object.keys(urlMap).length} existing URL(s) from nested format in ${outPath}. Will skip done groups.\n`,
          );
        } else {
          urlMap = { ...existing };
          console.log(`Loaded ${Object.keys(urlMap).length} existing URL(s) from ${outPath}. Will skip done groups.\n`);
        }
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
  const refToInfo = buildRefToInfo(input);
  const groupsToDo = allGroups.filter((g) => g.articleRefs.some((ref) => !(ref in urlMap)));

  if (groupsToDo.length === 0) {
    console.log('All groups already resolved. Nothing to do.');
    process.exit(0);
  }

  console.log(
    `Groups: ${groupsToDo.length} to do (${allGroups.length - groupsToDo.length} already done). Resolving...\n`,
  );
  if (headed) console.log('(Running in headed mode.)\n');

  const onGroupStart = (group: { articleRefs: string[] }, groupIndex: number) => {
    const productName = groupsToDo[groupIndex]?.product_name ?? '?';
    console.log(`\n--- Group ${groupIndex + 1}: ${productName} ---`);
    console.log('Looking for article_refs:');
    for (const ref of group.articleRefs) {
      const info = refToInfo[ref];
      const color = info?.color != null ? String(info.color) : '(no color)';
      console.log(`  • ${ref}  →  ${productName}  /  ${color}`);
    }
    console.log('(Starting Puppeteer for this group...)\n');
  };

  const onVariantMatch = (ref: string, url: string) => {
    const info = refToInfo[ref];
    const color = info?.color != null ? String(info.color) : '?';
    console.log(`  [MATCH] ${ref} (${color}) → ${url}`);
  };

  const onGroupDone = (groupUrls: Record<string, string>, articleRefs: string[]) => {
    for (const ref of articleRefs) {
      urlMap[ref] = groupUrls[ref] ?? null;
    }
    const found = articleRefs.filter((r) => groupUrls[r]).length;
    console.log(`\n[resolve] Group done: ${found}/${articleRefs.length} URL(s) resolved. Writing to ${outPath}...`);

    if (nestedOutput) {
      const refSet = new Set(articleRefs);
      let updated = false;
      for (const g of nestedOutput.groups) {
        const groupRefs = (g.items ?? []).map((i) => String(i.article_ref ?? '').trim());
        if (articleRefs.every((r) => groupRefs.includes(r))) {
          for (const item of g.items ?? []) {
            const ref = String(item.article_ref ?? '').trim();
            if (refSet.has(ref)) {
              item.url = groupUrls[ref] ?? null;
            }
          }
          updated = true;
          break;
        }
      }
      if (!updated && articleRefs.length > 0) {
        const inputGroups = input && typeof input === 'object' && 'groups' in input && Array.isArray((input as { groups: unknown }).groups)
          ? (input as { groups: InputGroup[] }).groups
          : [];
        const inputGroup = inputGroups.find(
          (g) => (g.items ?? []).some((i) => refSet.has(String(i.article_ref ?? '').trim())),
        );
        const items: NestedUrlOutput['groups'][0]['items'] = inputGroup
          ? (inputGroup.items ?? [])
              .filter((i) => refSet.has(String(i.article_ref ?? '').trim()))
              .map((i) => {
                const ref = String(i.article_ref ?? '').trim();
                return { ...i, article_ref: ref, url: groupUrls[ref] ?? null };
              })
          : articleRefs.map((article_ref) => ({ article_ref, url: groupUrls[article_ref] ?? null }));
        nestedOutput.groups.push({
          product_name: inputGroup?.product_name ?? allGroups.find((gr) => articleRefs.every((r) => gr.articleRefs.includes(r)))?.product_name,
          items,
        });
      }
      fs.writeFileSync(outPath, JSON.stringify(nestedOutput, null, 2), 'utf-8');
    } else {
      fs.writeFileSync(outPath, JSON.stringify(urlMap, null, 2), 'utf-8');
    }
    console.log(`[resolve] Wrote ${outPath}.\n`);
  };

  await resolveVendorUrlsForGroups(CONFIG.vendorBaseUrl, groupsToDo, {
    headed,
    visitHomepageFirst: true,
    onGroupStart,
    onVariantMatch,
    onGroupDone,
  });

  const totalRefs = Object.keys(urlMap).length;
  const foundRefs = Object.values(urlMap).filter((u): u is string => typeof u === 'string').length;
  console.log(`Done. ${foundRefs}/${totalRefs} URL(s) in ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
