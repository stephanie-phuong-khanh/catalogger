/**
 * Schema and types for Golden Designs generated listings.
 * One JSON file per SKU (e.g. data/listings/tab_03_dynamic_low_emf/{sku}.json).
 * Content is LLM-generated from pricing sheet + optional vendor site; _raw and _vendorData
 * preserve source data for debugging and re-runs.
 */

/** One row in the specifications table (Weight, Length, Width, Height). */
export interface GoldenDesignsSpecRow {
  label: string;
  values: string[];
}

/** Specs table: fixed columns [Weight, Length, Width, Height], one row per physical element. */
export interface GoldenDesignsSpecifications {
  tableTitle: string;
  columns: string[];
  rows: GoldenDesignsSpecRow[];
}

/** Vendor site product data we store on the listing (Shopify product page snapshot). */
export interface GoldenDesignsVendorData {
  id: number;
  title: string;
  url: string;
  price: string;
  body: string[];
  image: string;
  handle: string;
}

/** Full listing when pricing data was complete and LLM generation succeeded. */
export interface GoldenDesignsListingFull {
  _listingFormat: 'golden_designs';
  sku: string;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: GoldenDesignsSpecifications;
  vendorPageUrl: string | null;
  _raw: Record<string, unknown>;
  _vendorData: GoldenDesignsVendorData | null;
}

/** Stub listing when pricing data is incomplete; no LLM-generated fields. */
export interface GoldenDesignsListingIncomplete {
  _listingFormat: 'golden_designs';
  sku: string;
  incompletePricingData: true;
  _raw: Record<string, unknown>;
  _vendorData: GoldenDesignsVendorData | null;
  vendorPageUrl: string | null;
}

/** Discriminated union: full listing or incomplete (missing pricing data). */
export type GoldenDesignsListing = GoldenDesignsListingFull | GoldenDesignsListingIncomplete;

/** @deprecated Use GoldenDesignsListingFull */
export type GeneratedListing = GoldenDesignsListingFull;

/** @deprecated Use GoldenDesignsListingIncomplete */
export type IncompleteListing = GoldenDesignsListingIncomplete;
