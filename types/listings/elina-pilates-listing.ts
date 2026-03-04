/**
 * Schema and types for Elina Pilates generated listings.
 * One JSON file per product group: data/listings/elina_pilates/{productGroupSlug}.json
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
}

/** One variant (SKU) within a product group. */
export interface ElinaVariant {
  sku: string;
  vendorPageUrl: string | null;
  googleDriveUrls: string[];
  _source: ElinaListingSource;
}

/** Full listing when vendor site was available and content was generated. */
export interface ElinaListingFull {
  _listingFormat: 'elina_pilates';
  status: 'full';
  productName: string;
  title: string;
  overviewParagraph: string;
  features: string[];
  inclusions: string[];
  specifications: ElinaSpecifications;
  youtubeUrls: string[];
  variants: ElinaVariant[];
}

/** Stub listing when no vendor site; no generated content. */
export interface ElinaListingStub {
  _listingFormat: 'elina_pilates';
  status: 'vendor_site_unavailable';
  productName: string;
  variants: ElinaVariant[];
}

/** Discriminated union: full listing or stub (no vendor site). */
export type ElinaListing = ElinaListingFull | ElinaListingStub;
