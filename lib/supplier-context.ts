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
Title: Always start with "Golden Designs". The supplier uses sub-brands like "Dynamic Saunas" and "Maxxus Saunas" — include the sub-brand as a product line name (e.g. "Golden Designs Dynamic Avila..."), but never start the title with the sub-brand. Do not include the wood type in the title.

Features — supplier-specific patterns:
- Combine the Color field (e.g. "Honey Dark Stain") with the wood type into one bullet.
- For infrared heating panels: include count, EMF level with measurement (e.g. "5-10 mG at 2-3\""), and placement locations (e.g. "rear walls, side walls, and under the bench").
- For electrical requirements: rewrite as "Requires [voltage/amp] Outlet and Non-CAFCI/GFCI Breaker ([recommendation])". This supplier's products require non-CAFCI breakers even though the source data only mentions GFCI.

Overview — this supplier's products:
- Mention health/wellness benefits when applicable (e.g. muscle relaxation, stress relief, improved circulation).
- The supplier's ad-copy often lists suitable room types (basements, master baths, walk-in closets, fitness rooms) — include these when available.
`.trim();
