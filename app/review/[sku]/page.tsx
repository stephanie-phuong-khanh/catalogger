'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRun, ListingResult, RawProduct } from '../../run-context';

// [HARDCODED] Golden Designs SKU column.
const SKU_COLUMN = 'GDINA Item #';

export default function ReviewSkuPage() {
  const params = useParams();
  const sku = decodeURIComponent(params.sku as string);
  const { run, setListing } = useRun();

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasTriggered = useRef(false);

  // Find the product row from parsed tabs
  const product: RawProduct | null = (() => {
    if (!run) return null;
    for (const tab of run.tabs) {
      const found = tab.products.find((p) => String(p[SKU_COLUMN]) === sku);
      if (found) return found;
    }
    return null;
  })();

  const listing: ListingResult | null = run?.listings[sku] ?? null;

  // Auto-generate on first open if not already generated
  useEffect(() => {
    if (!run || !product || listing || hasTriggered.current) return;
    hasTriggered.current = true;

    async function generate() {
      setIsGenerating(true);
      setError(null);
      try {
        const res = await fetch('/api/generate-one-listing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product, vendorUrl: run!.vendorUrl }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Generation failed');
          return;
        }
        setListing(sku, data.listing as ListingResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Generation failed');
      } finally {
        setIsGenerating(false);
      }
    }

    generate();
  }, [run, product, listing, sku, setListing]);

  if (!run) {
    return (
      <main>
        <p>No run data. <Link href="/">Upload a sheet first.</Link></p>
      </main>
    );
  }

  if (!product) {
    return (
      <main>
        <p>Product {sku} not found in parsed data.</p>
        <Link href="/review">&larr; Back to list</Link>
      </main>
    );
  }

  return (
    <main>
      <Link href="/review" style={{ fontSize: '0.875rem' }}>&larr; Back to list</Link>
      <h1 style={{ fontSize: '1.25rem', marginTop: '0.75rem' }}>{sku}</h1>

      {isGenerating && (
        <p style={{ color: '#666', fontStyle: 'italic', margin: '1rem 0' }}>
          Generating listing... (searching vendor site + LLM)
        </p>
      )}
      {error && (
        <p style={{ color: '#c00', margin: '1rem 0' }}>
          Error: {error}
          <button
            onClick={() => { hasTriggered.current = false; setError(null); }}
            style={{ marginLeft: '0.5rem', fontSize: '0.875rem' }}
          >
            Retry
          </button>
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
        {/* LEFT: Inputs */}
        <div>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Sheet data</h2>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <tbody>
              {Object.entries(product).map(([key, value]) => (
                <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', fontWeight: 600, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    {key}
                  </td>
                  <td style={{ padding: '0.25rem 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {String(value ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RIGHT: Generated listing */}
        <div>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Generated listing</h2>

          {listing ? (
            <div style={{ fontSize: '0.875rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{listing.title}</h3>

              {listing.vendorPageUrl && (
                <p style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.75rem' }}>
                  Vendor page: <a href={listing.vendorPageUrl} target="_blank" rel="noopener">{listing.vendorPageUrl}</a>
                </p>
              )}

              <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Overview</h4>
              <p style={{ marginBottom: '0.75rem' }}>{listing.overviewParagraph}</p>

              <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Features</h4>
              <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.75rem' }}>
                {listing.features.map((f, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>{f}</li>
                ))}
              </ul>

              <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Specifications</h4>
              <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                <tbody>
                  {listing.specifications.map((spec, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', fontWeight: 600 }}>{spec.key}</td>
                      <td style={{ padding: '0.25rem 0' }}>{spec.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#666' }}>
                Price: ${listing.price}
              </p>
            </div>
          ) : !isGenerating ? (
            <p style={{ color: '#999' }}>Not yet generated.</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
