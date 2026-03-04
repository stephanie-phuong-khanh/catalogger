/**
 * Central export for all listing format types.
 * Use these for backend generation and for typed access to listing JSON.
 */

export type {
  ElinaListing,
  ElinaListingFull,
  ElinaListingStub,
  ElinaSpecifications,
  ElinaSpecRow,
  ElinaVariant,
  ElinaListingSource,
} from './elina-listing';

export type {
  GoldenDesignsListing,
  GoldenDesignsListingFull,
  GoldenDesignsListingIncomplete,
  GoldenDesignsSpecifications,
  GoldenDesignsSpecRow,
  GoldenDesignsVendorData,
  GeneratedListing,
  IncompleteListing,
} from './golden-designs-listing';
