'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useRun, ListingResult, RawProduct } from '../../run-context';

// [HARDCODED] Golden Designs SKU column.
const SKU_COLUMN = 'GDINA Item #';

type Step = 'idle' | 'searching' | 'vendor-found' | 'vendor-not-found' | 'generating' | 'done' | 'error';

interface VendorInfo {
  title: string;
  url: string;
}

export default function ReviewSkuPage() {
  const params = useParams();
  const sku = decodeURIComponent(params.sku as string);
  const { run, setListing } = useRun();

  const [step, setStep] = useState<Step>('idle');
  const [vendorInfo, setVendorInfo] = useState<VendorInfo | null>(null);
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

    async function runPipeline() {
      setError(null);

      // Step 1: Search vendor site
      let vendorData: any = null;
      if (run!.vendorUrl) {
        setStep('searching');
        try {
          const res = await fetch('/api/search-vendor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, vendorUrl: run!.vendorUrl }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error ?? 'Vendor search failed');
            setStep('error');
            return;
          }
          vendorData = data.vendorData;
          if (vendorData) {
            setVendorInfo({ title: vendorData.title, url: vendorData.url });
            setStep('vendor-found');
          } else {
            setStep('vendor-not-found');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Vendor search failed');
          setStep('error');
          return;
        }
      }

      // Step 2: Generate listing
      setStep('generating');
      try {
        const res = await fetch('/api/generate-one-listing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product, vendorData, supplierName: run?.supplierName }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Generation failed');
          setStep('error');
          return;
        }
        setListing(sku, data.listing as ListingResult);
        setStep('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Generation failed');
        setStep('error');
      }
    }

    runPipeline();
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

  // If we already have a listing (e.g. revisiting), pull vendorPageUrl for display
  const displayVendorUrl = listing?.vendorPageUrl ?? vendorInfo?.url ?? null;
  const displayVendorTitle = vendorInfo?.title ?? null;

  return (
    <main>
      <Link href="/review" style={{ fontSize: '0.875rem' }}>&larr; Back to list</Link>
      <h1 style={{ fontSize: '1.25rem', marginTop: '0.75rem' }}>{sku}</h1>

      {/* Progress steps */}
      {step !== 'idle' && !listing && (
        <div style={{ margin: '1rem 0', fontSize: '0.875rem', lineHeight: '1.8' }}>
          <StepLine
            label="Searching vendor website for product..."
            status={step === 'searching' ? 'active' : 'done'}
          />
          {vendorInfo && step !== 'searching' && (
            <StepLine label={`Found: ${vendorInfo.title}`} status="done" detail={vendorInfo.url} />
          )}
          {step === 'vendor-not-found' && (
            <StepLine label="No vendor page found (will generate from sheet data only)" status="warn" />
          )}
          {(step === 'generating' || step === 'done') && (
            <StepLine
              label="Generating listing..."
              status={step === 'generating' ? 'active' : 'done'}
            />
          )}
        </div>
      )}

      {error && (
        <p style={{ color: '#c00', margin: '1rem 0' }}>
          Error: {error}
          <button
            onClick={() => { hasTriggered.current = false; setError(null); setStep('idle'); }}
            style={{ marginLeft: '0.5rem', fontSize: '0.875rem' }}
          >
            Retry
          </button>
        </p>
      )}

      {/* Generated listing (top) */}
      <section style={{ marginTop: '1.5rem' }}>
        {displayVendorUrl && (
          <p style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.75rem' }}>
            Vendor page: <a href={displayVendorUrl} target="_blank" rel="noopener">{displayVendorUrl}</a>
          </p>
        )}

        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Generated listing</h2>

        {listing ? (
          <div style={{ fontSize: '0.875rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{listing.title}</h3>

            <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Overview</h4>
            <p style={{ marginBottom: '0.75rem' }}>{listing.overviewParagraph}</p>

            <h4 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Features</h4>
            <ul style={{ paddingLeft: '1.25rem', marginBottom: '0.75rem' }}>
              {listing.features.map((f, i) => (
                <li key={i} style={{ marginBottom: '0.25rem' }}>{f}</li>
              ))}
            </ul>

            <h4 style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
              {listing.specifications.tableTitle || 'Specifications'}
            </h4>
            <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '0.375rem 0.75rem 0.375rem 0', textAlign: 'left', fontWeight: 600 }}></th>
                  {listing.specifications.columns.map((col, i) => (
                    <th key={i} style={{ padding: '0.375rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listing.specifications.rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.375rem 0.75rem 0.375rem 0', fontWeight: 600 }}>{row.label}</td>
                    {row.values.map((val, j) => (
                      <td key={j} style={{ padding: '0.375rem 0.75rem' }}>{val}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#666' }}>
              Price: ${listing.price}
            </p>
          </div>
        ) : step !== 'error' && step !== 'idle' ? null : (
          <p style={{ color: '#999' }}>Not yet generated.</p>
        )}
      </section>

      {/* Sheet data (below, horizontal scroll like a spreadsheet) */}
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Sheet data</h2>
        <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: '6px' }}>
          <table style={{ fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                {Object.keys(product).map((key) => (
                  <th key={key} style={{ padding: '0.375rem 0.75rem', borderBottom: '2px solid #ddd', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {Object.entries(product).map(([key, value]) => {
                  const text = String(value ?? '');
                  const len = text.length;
                  const minWidth = len < 20 ? 80 : len < 80 ? 180 : len < 200 ? 320 : 450;
                  return (
                    <td key={key} style={{ padding: '0.375rem 0.75rem', borderBottom: '1px solid #eee', whiteSpace: 'pre-wrap', minWidth: `${minWidth}px`, verticalAlign: 'top' }}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// --- Step indicator component ---

function StepLine({ label, status, detail }: { label: string; status: 'active' | 'done' | 'warn'; detail?: string }) {
  const icon = status === 'active' ? '...' : status === 'done' ? '✓' : '—';
  const color = status === 'active' ? '#666' : status === 'done' ? '#0a0' : '#b80';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
      <span style={{ color, fontWeight: 600, width: '1.25rem', textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontStyle: status === 'active' ? 'italic' : 'normal', color: status === 'active' ? '#666' : '#1a1a1a' }}>
        {label}
        {detail && (
          <a href={detail} target="_blank" rel="noopener" style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#666' }}>
            {detail}
          </a>
        )}
      </span>
    </div>
  );
}
