/**
 * Eval: compare "specifications" section of generated listings (data/listings)
 * to golden reference (data/reference_golden). Row labels differ between the two
 * (e.g. "Sauna (Exterior)" vs "Infrared Sauna (Exterior)"), so we interleave
 * programmatic checks with LLM-based semantic comparison (row alignment + value equivalence).
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

dotenv.config();

const CONFIG = {
  listingsDir: path.join(process.cwd(), 'data', 'listings'),
  referenceDir: path.join(process.cwd(), 'data', 'reference_golden'),
};

// --- Programmatic: extract all numeric values from a spec table for rough comparison ---
function extractNumericValues(specs: { rows: { values: string[] }[] }): Set<string> {
  const nums = new Set<string>();
  for (const row of specs.rows) {
    for (const v of row.values) {
      // Match numbers (including decimals): 250, 36", 9.4, etc.
      const matches = v.replace(/"/g, '').match(/\d+\.?\d*/g);
      if (matches) matches.forEach(n => nums.add(n));
    }
  }
  return nums;
}

// --- Programmatic: column and row count checks ---
function programmaticChecks(
  generated: { columns: string[]; rows: { label: string; values: string[] }[] },
  reference: { columns: string[]; rows: { label: string; values: string[] }[] },
): { columnsMatch: boolean; rowCountMatch: boolean; numericOverlap: number; refNums: number } {
  const columnsMatch =
    JSON.stringify(generated.columns) === JSON.stringify(reference.columns);
  const rowCountMatch = generated.rows.length === reference.rows.length;
  const genNums = extractNumericValues(generated);
  const refNums = extractNumericValues(reference);
  const overlap = [...refNums].filter(n => genNums.has(n)).length;
  return {
    columnsMatch,
    rowCountMatch,
    numericOverlap: overlap,
    refNums: refNums.size,
  };
}

// --- LLM: structured comparison (row alignment + equivalence) ---
const SpecComparisonSchema = z.object({
  rowAlignment: z.array(
    z.object({
      generatedLabel: z.string().describe('Label from generated listing'),
      referenceLabel: z.string().describe('Label from reference that best matches this row'),
      equivalent: z.boolean().describe('True if the two rows represent the same physical element and values are equivalent'),
      issues: z.array(z.string()).describe('e.g. missing roof overhang note, wrong weight; use empty array if none'),
    }),
  ),
  summary: z.object({
    overall: z.enum(['full', 'partial', 'poor']).describe('full = all rows aligned and equivalent, partial = minor differences, poor = wrong/missing rows or values'),
    missingInGenerated: z.array(z.string()).describe('Important details present in reference but missing in generated (e.g. "roof overhang note on exterior row")'),
    valueMismatches: z.array(z.string()).describe('e.g. "Carton A weight: reference 260 lbs, generated 285 lbs"'),
  }),
});

async function llmCompareSpecs(
  openai: OpenAI,
  sku: string,
  generatedSpecs: object,
  referenceSpecs: object,
): Promise<z.infer<typeof SpecComparisonSchema>> {
  const response = await openai.responses.parse({
    model: 'gpt-4o',
    temperature: 0,
    input: [
      {
        role: 'system',
        content: `You compare two product specification tables (dimensions/weights). The "generated" table comes from an AI; the "reference" is the golden standard. Row labels often differ (e.g. "Sauna (Exterior)" vs "Infrared Sauna (Exterior)", "Carton A – Shipping" vs "Shipping Box"). Your job: (1) Align each generated row to the reference row that represents the same physical element. (2) For each pair, say if values are equivalent (same numbers, same units; include inline notes like "roof overhang: adds X to depth" in your notion of equivalence). (3) List any important details missing in generated or any value mismatches.`,
      },
      {
        role: 'user',
        content: `SKU: ${sku}

Generated specifications:
${JSON.stringify(generatedSpecs, null, 2)}

Reference (golden) specifications:
${JSON.stringify(referenceSpecs, null, 2)}

Output rowAlignment for each generated row (match to reference by meaning, not exact label). Then summary with overall (full/partial/poor), missingInGenerated, and valueMismatches.`,
      },
    ],
    text: {
      format: zodTextFormat(SpecComparisonSchema, 'spec_comparison'),
    },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error(`LLM returned no structured output for ${sku}`);
  return parsed;
}

// --- Main ---
async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required');
    process.exit(1);
  }

  const listingFiles = fs.readdirSync(CONFIG.listingsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const referenceFiles = fs.readdirSync(CONFIG.referenceDir).filter(
    f => f.endsWith('.json') && !['index.json', 'template.json'].includes(f),
  );

  const listingSkus = new Set(listingFiles.map(f => f.replace(/\.json$/, '')));
  const referenceSkus = new Set(referenceFiles.map(f => f.replace(/\.json$/, '')));
  const commonSkus = [...listingSkus].filter(sku => referenceSkus.has(sku)).sort();

  if (commonSkus.length === 0) {
    console.log('No SKUs in common between data/listings and data/reference_golden.');
    process.exit(0);
  }

  console.log('=== SPECS EVAL ===\n');
  console.log(`Comparing specs for ${commonSkus.length} SKUs: ${commonSkus.join(', ')}\n`);

  const results: {
    sku: string;
    programmatic: ReturnType<typeof programmaticChecks>;
    llm?: z.infer<typeof SpecComparisonSchema>;
    error?: string;
  }[] = [];

  for (const sku of commonSkus) {
    try {
      const genPath = path.join(CONFIG.listingsDir, `${sku}.json`);
      const refPath = path.join(CONFIG.referenceDir, `${sku}.json`);
      const generated = JSON.parse(fs.readFileSync(genPath, 'utf-8'));
      const reference = JSON.parse(fs.readFileSync(refPath, 'utf-8'));

      const genSpecs = generated.specifications;
      const refSpecs = reference.specifications;
      if (!genSpecs || !refSpecs) {
        results.push({ sku, programmatic: { columnsMatch: false, rowCountMatch: false, numericOverlap: 0, refNums: 0 }, error: 'Missing specifications' });
        continue;
      }

      const programmatic = programmaticChecks(genSpecs, refSpecs);
      const llm = await llmCompareSpecs(openai, sku, genSpecs, refSpecs);
      results.push({ sku, programmatic, llm });
    } catch (err) {
      results.push({
        sku,
        programmatic: { columnsMatch: false, rowCountMatch: false, numericOverlap: 0, refNums: 0 },
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Report ---
  console.log('--- Per-SKU ---\n');
  for (const r of results) {
    console.log(`SKU: ${r.sku}`);
    if (r.error) {
      console.log(`  Error: ${r.error}\n`);
      continue;
    }
    console.log(`  Programmatic: columnsMatch=${r.programmatic.columnsMatch} rowCountMatch=${r.programmatic.rowCountMatch} numericOverlap=${r.programmatic.numericOverlap}/${r.programmatic.refNums}`);
    if (r.llm) {
      console.log(`  LLM overall: ${r.llm.summary.overall}`);
      if (r.llm.summary.missingInGenerated.length) {
        console.log(`  Missing in generated: ${r.llm.summary.missingInGenerated.join('; ')}`);
      }
      if (r.llm.summary.valueMismatches.length) {
        console.log(`  Value mismatches: ${r.llm.summary.valueMismatches.join('; ')}`);
      }
      const notEquivalent = r.llm.rowAlignment.filter(a => !a.equivalent);
      if (notEquivalent.length) {
        console.log(`  Rows not equivalent: ${notEquivalent.map(a => `${a.generatedLabel} vs ${a.referenceLabel}`).join('; ')}`);
      }
    }
    console.log('');
  }

  const withLlm = results.filter(r => r.llm);
  const full = withLlm.filter(r => r.llm!.summary.overall === 'full').length;
  const partial = withLlm.filter(r => r.llm!.summary.overall === 'partial').length;
  const poor = withLlm.filter(r => r.llm!.summary.overall === 'poor').length;
  console.log('--- Summary ---');
  console.log(`Overall: full=${full} partial=${partial} poor=${poor} (of ${withLlm.length} compared)`);
  console.log(`Programmatic: ${results.filter(r => r.programmatic.columnsMatch && r.programmatic.rowCountMatch).length}/${results.length} have matching columns and row count`);
}

main();
