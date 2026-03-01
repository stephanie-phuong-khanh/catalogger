/**
 * Schema and types for Elina Pilates generated listings.
 * One JSON file per SKU: data/listings/elina_pilates/{PRODUCT_GROUP_FOLDER}/{article_ref}.json
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

/** Optional reference back to source data (for debugging). */
export interface ElinaListingSource {
  product_name?: string;
  article_ref?: string;
  color?: string | null;
}

/**
 * Generated listing for one Elina Pilates SKU.
 * Written to data/listings/elina_pilates/{productGroupFolder}/{sku}.json
 */
export interface ElinaGeneratedListing {
  sku: string;
  title: string;
  overviewParagraph: string;
  features: string[];
  inclusions: string[];
  specifications: ElinaSpecifications;
  vendorPageUrl: string | null;
  googleDriveUrl?: string | null;
  youtubeUrls?: string[];
  _source?: ElinaListingSource;
}
