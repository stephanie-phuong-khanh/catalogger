'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// --- Types ---

export type RawProduct = Record<string, unknown>;

export interface TabProducts {
  name: string;
  products: RawProduct[];
}

/** The subset of GeneratedListing we care about on the client (no _raw, _vendorData). */
export interface ListingResult {
  sku: string;
  price: number;
  title: string;
  features: string[];
  overviewParagraph: string;
  specifications: { key: string; value: string }[];
  vendorPageUrl: string | null;
}

export interface RunData {
  tabs: TabProducts[];
  vendorUrl?: string;
  /** Listings generated so far, keyed by SKU. */
  listings: Record<string, ListingResult>;
}

interface RunContextValue {
  run: RunData | null;
  /** Set the run after parsing a sheet. Clears any previous listings. */
  setRun: (tabs: TabProducts[], vendorUrl?: string) => void;
  /** Store a generated listing for a SKU. */
  setListing: (sku: string, listing: ListingResult) => void;
  /** Clear the entire run. */
  clearRun: () => void;
}

const RunContext = createContext<RunContextValue | null>(null);

// --- Storage key ---

const STORAGE_KEY = 'catalogger-run';

function saveToStorage(data: RunData) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

function loadFromStorage(): RunData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RunData;
  } catch {
    return null;
  }
}

// --- Provider ---

export function RunProvider({ children }: { children: React.ReactNode }) {
  const [run, setRunState] = useState<RunData | null>(null);

  // Rehydrate from sessionStorage on first mount (survives refresh)
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) setRunState(stored);
  }, []);

  const setRun = useCallback((tabs: TabProducts[], vendorUrl?: string) => {
    const data: RunData = { tabs, vendorUrl, listings: {} };
    setRunState(data);
    saveToStorage(data);
  }, []);

  const setListing = useCallback((sku: string, listing: ListingResult) => {
    setRunState((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, listings: { ...prev.listings, [sku]: listing } };
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const clearRun = useCallback(() => {
    setRunState(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return (
    <RunContext.Provider value={{ run, setRun, setListing, clearRun }}>
      {children}
    </RunContext.Provider>
  );
}

// --- Hook ---

export function useRun(): RunContextValue {
  const ctx = useContext(RunContext);
  if (!ctx) throw new Error('useRun must be used within <RunProvider>');
  return ctx;
}
