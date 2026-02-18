/**
 * Supplier-specific prompt context. One place for all hardcoded supplier patterns.
 * Used by both the CLI pipeline and the app's generate-one-listing API.
 * Eventually: per-supplier config or learned from user-edited examples.
 */

export function getSupplierContext(supplierName: string): string | undefined {
  if (supplierName === 'Golden Designs') {
    return GOLDEN_DESIGNS_CONTEXT;
  }
  return undefined;
}

const GOLDEN_DESIGNS_CONTEXT = `
Features — supplier-specific patterns:
- For infrared heating panels: include count, EMF level with measurement (e.g. "5-10 mG at 2-3\""), and placement locations (e.g. "rear walls, side walls, and under the bench").

Overview — this supplier's products:

`.trim();
