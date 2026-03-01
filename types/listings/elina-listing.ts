/**
 * Schema and types for Elina Pilates generated listings.
 * One JSON file per product group: data/listings/elina_pilates/{ProductGroupSlug}.json
 * Product-level content (title, overview, features, inclusions, specs, youtube) is shared;
 * variant-level data (sku, vendor URL, Google Drive images, _source) lives in variants[].
 */

/** One row in the specifications table. */
export interface ElinaSpecRow {
  label: string;
  values: string[];
}

/** Flexible specs table; columns can vary by product type (reformer, accessory, etc.). */
export interface ElinaSpecifications {
  tableTitle: string;
  columns: string[];
  rows: ElinaSpecRow[];
}

/** Per-SKU reference back to the pricing sheet / source row. */
export interface ElinaListingSource {
  articleRef: string;
  description: string;
  priceUsd: number;
  barcode: string;
  color?: string | null;
}

/** One variant (SKU) within a product group. */
export interface ElinaVariant {
  sku: string;
  vendorPageUrl: string | null;
  googleDriveUrls: string[];
  _source: ElinaListingSource;
}

/**
 * Generated listing for one Elina Pilates product group (one file, multiple variants).
 * Written to data/listings/elina_pilates/{productGroupSlug}.json
 */
export interface ElinaGeneratedListing {
  productName: string;
  title: string;
  overviewParagraph: string;
  features: string[];
  inclusions: string[];
  specifications: ElinaSpecifications;
  youtubeUrls: string[];
  variants: ElinaVariant[];
}
