'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

/** Listing shape we display (matches generated listing JSON). */
interface ListingData {
  sku?: string;
  title?: string;
  features?: string[];
  overviewParagraph?: string;
  specifications?: {
    tableTitle?: string;
    columns?: string[];
    rows?: { label: string; values: string[] }[];
  };
  vendorPageUrl?: string | null;
}

export default function ListingViewPage() {
  const params = useParams();
  const path = (params.path as string[]) ?? [];

  const [listing, setListing] = useState<ListingData | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path.length < 2) {
      setLoading(false);
      setError('Invalid path');
      return;
    }
    const apiPath = path.map((p) => encodeURIComponent(p)).join('/');
    fetch(`/api/listings/${apiPath}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : res.statusText);
        return res.text();
      })
      .then((text) => {
        setRaw(text);
        try {
          const data = JSON.parse(text) as ListingData;
          setListing(Array.isArray(data) ? data[0] : data);
        } catch {
          setListing(null);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [path]);

  if (path.length < 2) {
    return (
      <main>
        <p>Invalid path.</p>
        <Link href="/">&larr; Back to listings</Link>
      </main>
    );
  }

  if (loading) return <main><p>Loading…</p></main>;
  if (error) {
    return (
      <main>
        <p>Error: {error}</p>
        <Link href="/">&larr; Back to listings</Link>
      </main>
    );
  }

  const [folder, file] = path;
  const spec = listing?.specifications;

  return (
    <main>
      <Link href="/" style={{ fontSize: '0.875rem' }}>&larr; Back to listings</Link>
      <h1 style={{ fontSize: '1.25rem', marginTop: '0.75rem' }}>
        {listing?.title ?? file}
      </h1>

      {listing?.vendorPageUrl && (
        <p style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.75rem' }}>
          Vendor: <a href={listing.vendorPageUrl} target="_blank" rel="noopener noreferrer">{listing.vendorPageUrl}</a>
        </p>
      )}

      {listing?.overviewParagraph && (
        <>
          <h2 style={{ fontSize: '1rem', marginTop: '1rem', marginBottom: '0.25rem' }}>Overview</h2>
          <p style={{ marginBottom: '1rem' }}>{listing.overviewParagraph}</p>
        </>
      )}

      {listing?.features && listing.features.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Features</h2>
          <ul style={{ paddingLeft: '1.25rem', marginBottom: '1rem' }}>
            {listing.features.map((f, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {spec && (spec.rows?.length ?? 0) > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
            {spec.tableTitle ?? 'Specifications'}
          </h2>
          <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.375rem 0.75rem 0.375rem 0', textAlign: 'left', fontWeight: 600 }}></th>
                {(spec.columns ?? []).map((col, i) => (
                  <th key={i} style={{ padding: '0.375rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(spec.rows ?? []).map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.375rem 0.75rem 0.375rem 0', fontWeight: 600 }}>{row.label}</td>
                  {(row.values ?? []).map((val, j) => (
                    <td key={j} style={{ padding: '0.375rem 0.75rem' }}>{val}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!listing && raw && (
        <pre style={{ fontSize: '0.75rem', overflow: 'auto', marginTop: '1rem' }}>{raw.slice(0, 2000)}{raw.length > 2000 ? '…' : ''}</pre>
      )}
    </main>
  );
}
