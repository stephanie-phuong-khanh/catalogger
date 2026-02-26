/**
 * Pricing sheet field groups used for prompt formatting and UI display.
 * Matches the structure in lib/listings/parse-sheet.ts (Golden Designs sheet).
 * Client-safe (no Node/buffer deps).
 */

export function normalizeKey(key: string): string {
  return key.replace(/\n/g, ' ').trim();
}

/** Top section: description, EMF, color, wood type, brand, ad-copy, features. */
export const TOP_SECTION_KEYS = [
  'Description',
  'EMF\n(Low, Ultra Low, Near Zero)',
  'Color',
  'Wood Type\nHemlock\nRed Cedar\nOther',
  'Brand Name',
  'Product Ad-Copy',
  'Features',
];

/** Product dimensions. */
export const PRODUCT_DIMENSION_KEYS = ['Product Weight', 'Dimensions', 'Length', 'Width', 'Height'];

/** Per-carton shipping fields; arrays are indexed by carton. */
export const CARTON_KEYS = ['Carton', 'Ship Weight', 'Ship Dimensions', 'Ship Length', 'Ship Width', 'Ship Height'];

/** LTL / shipping at end. */
export const BOTTOM_KEYS = ['Ship Ground or LTL', 'LTL Pallet Dims', 'LTL Pallet Weight'];

export function valueAsArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  return s ? [s] : [];
}

/** True when pricing row is missing required data (e.g. Description). Used to skip LLM generation. */
export function isPricingDataIncomplete(raw: Record<string, unknown>): boolean {
  const normToKey = new Map<string, string>();
  for (const key of Object.keys(raw)) normToKey.set(normalizeKey(key), key);
  const descKey = normToKey.get('Description');
  if (!descKey) return true;
  const v = raw[descKey];
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}
