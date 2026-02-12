'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const RUN_STORAGE_KEY = 'catalogger-run';

type RawProduct = Record<string, unknown>;

interface TabProducts {
  name: string;
  products: RawProduct[];
}

interface StoredRun {
  tabs: TabProducts[];
  vendorUrl?: string;
}

// [HARDCODED] Golden Designs SKU column. Later: from config or run.
const SKU_COLUMN = 'GDINA Item #';

export default function ReviewPage() {
  const [run, setRun] = useState<StoredRun | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(RUN_STORAGE_KEY);
    if (raw) {
      try {
        setRun(JSON.parse(raw) as StoredRun);
      } catch {
        setRun(null);
      }
    }
  }, []);

  if (run === null) {
    return (
      <main>
        <h1>Review listings</h1>
        <p>No parsed data. Upload a sheet on the home page first.</p>
        <Link href="/" style={{ marginTop: '1rem', display: 'inline-block' }}>
          ← Back to upload
        </Link>
      </main>
    );
  }

  const { tabs, vendorUrl } = run;

  return (
    <main>
      <h1>Review listings</h1>
      {vendorUrl && (
        <p className="placeholder-note" style={{ marginBottom: '1rem' }}>
          Vendor: {vendorUrl}
        </p>
      )}
      <Link href="/" style={{ marginBottom: '1.5rem', display: 'inline-block', fontSize: '0.875rem' }}>
        ← Upload a different sheet
      </Link>

      {tabs.length === 0 ? (
        <p>No products found in any tab.</p>
      ) : (
        tabs.map((tab) => (
          <section key={tab.name} style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: '0.75rem' }}>{tab.name}</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {tab.products.map((product) => {
                const sku = String(product[SKU_COLUMN] ?? '');
                const description = product['Description'] ?? product['Brand Name'] ?? '';
                const label = sku ? (description ? `${sku} — ${description}` : sku) : 'No SKU';
                return (
                  <li key={sku || Math.random()} style={{ marginBottom: '0.5rem' }}>
                    <Link
                      href={sku ? `/review/${encodeURIComponent(sku)}` : '#'}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
