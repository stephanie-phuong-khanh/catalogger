'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { ElinaListing, GoldenDesignsListing } from '../../types/listings';
import { ELINA_DRIVE_BASE_URLS } from '../../constants/elina-drive';
import {
  normalizeKey,
  TOP_SECTION_KEYS,
  PRODUCT_DIMENSION_KEYS,
  CARTON_KEYS,
  BOTTOM_KEYS,
  valueAsArray,
} from '../../lib/listings/pricing-sheet-groups';

type LoadedListing = ElinaListing | GoldenDesignsListing;

function isElinaListing(listing: LoadedListing): listing is ElinaListing {
  return (listing as { _listingFormat?: string })._listingFormat === 'elina_pilates';
}

/** Infer format from shape when _listingFormat is missing (legacy JSON). */
function normalizeParsedListing(data: unknown): LoadedListing | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj._listingFormat === 'elina_pilates') return data as ElinaListing;
  if (obj._listingFormat === 'golden_designs') return data as GoldenDesignsListing;
  if (obj.status !== undefined && Array.isArray(obj.variants) && obj.productName != null) return data as ElinaListing;
  if (obj.sku != null) return data as GoldenDesignsListing;
  return null;
}

/** Coerce to string for display; some blobs have overviewParagraph/title as { overviewParagraph } / { title }. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value != null && typeof value === 'object' && 'overviewParagraph' in value) return asText((value as { overviewParagraph: unknown }).overviewParagraph);
  if (value != null && typeof value === 'object' && 'title' in value) return asText((value as { title: unknown }).title);
  return '';
}

function ElinaListingView({ listing, path: pathSegments }: { listing: ElinaListing; path: string[] }) {
  const [, file] = pathSegments;
  const isFull = listing.status === 'full';
  const full = isFull ? listing : null;
  const displayTitle = (listing.productName ?? (full ? asText(full.title) : '')) || (file?.replace(/\.json$/i, '') ?? '');
  const spec = full?.specifications;
  const hasVendorLinks = listing.variants.some((v) => v.vendorPageUrl);
  const isStub = listing.status === 'vendor_site_unavailable';

  return (
    <>
      <header style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111', margin: 0 }}>{displayTitle}</h1>
      </header>

      {isStub && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', background: '#fffbe6', border: '1px solid #d4b106', borderRadius: '4px' }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.875rem', color: '#8a7000' }}>No vendor website — generated content not available.</p>
        </div>
      )}

      {full && asText(full.title) && (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Title</h2>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>{asText(full.title)}</p>
        </section>
      )}

      {full && asText(full.overviewParagraph) && (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Overview</h2>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>{asText(full.overviewParagraph)}</p>
        </section>
      )}

      {full && full.features?.length ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Features</h2>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>
            {full.features.map((f, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {full && full.inclusions?.length ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Inclusions</h2>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>
            {full.inclusions.map((item, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {full && spec && spec.rows?.length ? (
        <section style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.5rem', color: '#111' }}>{spec.tableTitle ?? 'Specifications'}</h2>
          <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                {(spec.columns ?? []).map((col, i) => (
                  <th key={i} style={{ padding: '0.375rem 0.75rem 0.375rem 0', textAlign: 'left', fontWeight: 600 }}>{col}</th>
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
        </section>
      ) : null}

      {full && full.youtubeUrls?.length ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Videos</h2>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, fontSize: '0.875rem' }}>
            {full.youtubeUrls.map((url, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#0566e8', textDecoration: 'underline' }}>{url}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section style={{ marginTop: '2rem' }}>
        <hr style={{ border: 'none', borderTop: '2px solid #111', margin: '0 0 1rem 0' }} />
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem 0', color: '#111' }}>Variants</h2>
        {!hasVendorLinks && (
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', color: '#666' }}>Product not found in vendor website.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem' }}>
          {listing.variants.map((v, index) => (
            <li
              key={v.sku}
              style={{
                padding: '0.75rem 0',
                borderBottom: index < listing.variants.length - 1 ? '1px solid #ddd' : 'none',
              }}
            >
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>SKU:</div>
                <div>{v.sku}</div>
              </div>
              {v.vendorPageUrl && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Vendor site URL:</div>
                  <div>
                    <a href={v.vendorPageUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#0566e8', textDecoration: 'underline' }}>{v.vendorPageUrl}</a>
                  </div>
                </div>
              )}
              {v.googleDriveLinks?.length ? (
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Google Drive image folders:</div>
                  <ul style={{ listStyle: 'disc', paddingLeft: '1.25rem', margin: 0 }}>
                    {v.googleDriveLinks.map((link) => {
                      const baseUrl = ELINA_DRIVE_BASE_URLS[link.baseUrlConstantKey];
                      const pathParts = link.path.split('/');
                      return (
                        <li key={link.baseUrlConstantKey} style={{ marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.8125rem', paddingRight: '0.5rem' }}>
                            {link.label?.endsWith(':') ? link.label : `${link.label ?? ''}:`}
                          </span>
                          {baseUrl ? (
                            <span>
                              <a href={baseUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#0566e8', textDecoration: 'underline' }}>Folder</a>
                              <span style={{ color: '#111' }}>
                                {' '}→{' '}
                                {pathParts.map((part, i) => (
                                  <span key={i}>
                                    {part}
                                    {i < pathParts.length - 1 ? <strong> / </strong> : null}
                                  </span>
                                ))}
                              </span>
                            </span>
                          ) : (
                            <span style={{ color: '#111', marginLeft: '0.25rem' }}>
                              {pathParts.map((part, i) => (
                                <span key={i}>
                                  {part}
                                  {i < pathParts.length - 1 ? <strong> / </strong> : null}
                                </span>
                              ))}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {v._source && (
                <>
                  {v._source.description != null && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Description (Pricing Sheet):</div>
                      <div>{v._source.description}</div>
                    </div>
                  )}
                  {v._source.priceUsd != null && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Price USD:</div>
                      <div>${v._source.priceUsd}</div>
                    </div>
                  )}
                  {v._source.barcode != null && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>Barcode:</div>
                      <div>{v._source.barcode}</div>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function GoldenDesignsListingView({ listing, path: pathSegments, raw }: { listing: GoldenDesignsListing; path: string[]; raw: string | null }) {
  const [, file] = pathSegments;
  const spec = 'specifications' in listing ? listing.specifications : undefined;
  const vendorUrl = listing.vendorPageUrl ?? listing._vendorData?.url ?? null;
  const hasDataSources = (listing._raw && Object.keys(listing._raw).length > 0) || listing._vendorData;
  const displaySku = listing.sku ?? file?.replace(/\.json$/i, '') ?? file;
  const isIncomplete = 'incompletePricingData' in listing && listing.incompletePricingData === true;
  const noVendorData = !isIncomplete && !vendorUrl && !listing._vendorData;

  return (
    <>
      <header style={{ marginTop: '1.5rem', marginBottom: isIncomplete || noVendorData ? '1rem' : '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111', margin: 0 }}>{displaySku}</h1>
      </header>

      {isIncomplete && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', background: '#fff0f0', border: '1px solid #c00', borderRadius: '4px' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.875rem', color: '#c00' }}>
            <span aria-hidden>!</span> Incomplete data from pricing sheet
          </p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#333' }}>
            Product listing was not generated due to crucial missing info. Please check the pricing sheet for this product.
          </p>
        </div>
      )}

      {noVendorData && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', background: '#fffbe6', border: '1px solid #d4b106', borderRadius: '4px' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.875rem', color: '#8a7000' }}>
            <span aria-hidden>⚠</span> No vendor website found for product
          </p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#333' }}>
            Generated product listing without vendor website to reference. Please double check the generated listing.
          </p>
        </div>
      )}

      {!isIncomplete && 'title' in listing && asText(listing.title) ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Title:</h2>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>{asText(listing.title)}</p>
        </section>
      ) : null}

      {!isIncomplete && 'overviewParagraph' in listing && asText(listing.overviewParagraph) ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Overview:</h2>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>{asText(listing.overviewParagraph)}</p>
        </section>
      ) : null}

      {!isIncomplete && 'features' in listing && (listing.features?.length ?? 0) > 0 ? (
        <section style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.25rem', color: '#333' }}>Features:</h2>
          <ul style={{ paddingLeft: '1.25rem', margin: 0, lineHeight: 1.5, fontSize: '0.875rem' }}>
            {listing.features!.map((f, i) => (
              <li key={i} style={{ marginBottom: '0.25rem' }}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!isIncomplete && spec && (spec.rows?.length ?? 0) > 0 ? (
        <section style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.5rem', color: '#111' }}>{spec.tableTitle ?? 'Specifications'}</h2>
          <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
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
        </section>
      ) : null}

      {!isIncomplete && hasDataSources && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid #ccc', margin: '2rem 0' }} />
          {listing._raw && Object.keys(listing._raw).length > 0 && (() => {
            const HIDDEN = new Set(['2025-2026 Dealer Cost', 'MAP', 'MSRP', 'Shipping Cost']);
            const rawObj = listing._raw as Record<string, unknown>;
            const rawEntries = Object.entries(rawObj).filter(([key]) => !HIDDEN.has(normalizeKey(key)));
            const rawByNorm = new Map<string, { key: string; value: unknown }>();
            for (const [key, value] of rawEntries) rawByNorm.set(normalizeKey(key), { key, value });
            const ordered = (groupKeys: readonly string[]) =>
              groupKeys.map((gk) => rawByNorm.get(normalizeKey(gk))).filter((x): x is { key: string; value: unknown } => x != null);
            const topEntries = ordered(TOP_SECTION_KEYS);
            const productDimEntries = ordered(PRODUCT_DIMENSION_KEYS);
            const bottomEntries = ordered(BOTTOM_KEYS);
            const cartonVals = CARTON_KEYS.map((k: string) => valueAsArray(rawObj[k]));
            const nCartons = Math.max(1, ...cartonVals.map((a: string[]) => a.length));
            const groupNormSet = new Set([...TOP_SECTION_KEYS.map(normalizeKey), ...PRODUCT_DIMENSION_KEYS.map(normalizeKey), ...CARTON_KEYS.map(normalizeKey), ...BOTTOM_KEYS.map(normalizeKey)]);
            const otherEntries = rawEntries.filter(([key]) => !groupNormSet.has(normalizeKey(key)));
            const itemBlock = (key: string, value: unknown) => (
              <div key={key} style={{ marginBottom: '0.25rem' }}>
                <strong>{key.trimEnd()}{key.trimEnd().endsWith(':') ? '' : ':'}</strong>{' '}
                {Array.isArray(value) ? (
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>{value.map((item, i) => (
                    <li key={i} style={{ marginBottom: '0.2rem' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                  ))}</ul>
                ) : value != null && typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </div>
            );
            const groupStyle = { marginBottom: '1.25rem', fontSize: '0.875rem', lineHeight: 1.5 };
            return (
              <section style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#111' }}>Pricing Sheet</h2>
                <div style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
                  {otherEntries.length > 0 && <div style={groupStyle}>{otherEntries.map(([key, value]) => itemBlock(key, value))}</div>}
                  {topEntries.length > 0 && <div style={groupStyle}>{topEntries.map(({ key, value }) => itemBlock(key, value))}</div>}
                  {productDimEntries.length > 0 && <div style={groupStyle}>{productDimEntries.map(({ key, value }) => itemBlock(key, value))}</div>}
                  {nCartons > 0 && CARTON_KEYS.some((k: string) => rawObj[k] != null) && (
                    <div style={groupStyle}>
                      {Array.from({ length: nCartons }, (_, i) => (
                        <div key={i} style={{ marginBottom: i < nCartons - 1 ? '1rem' : 0 }}>
                          {CARTON_KEYS.map((gk: string) => {
                            const pair = rawByNorm.get(normalizeKey(gk));
                            if (!pair) return null;
                            const arr = valueAsArray(pair.value);
                            return (
                              <div key={pair.key} style={{ marginBottom: '0.25rem' }}>
                                <strong>{pair.key.trimEnd()}{pair.key.trimEnd().endsWith(':') ? '' : ':'}</strong> {arr[i] ?? ''}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                  {bottomEntries.length > 0 && <div style={{ ...groupStyle, marginBottom: 0 }}>{bottomEntries.map(({ key, value }) => itemBlock(key, value))}</div>}
                </div>
              </section>
            );
          })()}
          {(listing._raw && Object.keys(listing._raw).length > 0) && (vendorUrl || listing._vendorData) && <hr style={{ border: 'none', borderTop: '1px solid #ccc', margin: '2rem 0' }} />}
          {(vendorUrl || listing._vendorData) && (
            <section>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#111' }}>Vendor Website</h2>
              <div style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>
                {vendorUrl && (
                  <p style={{ marginBottom: '0.5rem' }}>
                    <strong>Vendor page:</strong>{' '}
                    <a href={vendorUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#0566e8', textDecoration: 'underline' }}>{vendorUrl}</a>
                  </p>
                )}
                {listing._vendorData?.title != null && String(listing._vendorData.title).trim() !== '' && (
                  <p style={{ marginBottom: '0.5rem' }}><strong>Title:</strong> {String(listing._vendorData.title)}</p>
                )}
                {listing._vendorData?.price != null && String(listing._vendorData.price).trim() !== '' && (
                  <p style={{ marginBottom: '0.5rem' }}><strong>Price:</strong> {String(listing._vendorData.price)}</p>
                )}
                {listing._vendorData?.url != null && String(listing._vendorData.url).trim() !== '' && !vendorUrl && (
                  <p style={{ marginBottom: '0.5rem' }}>
                    <strong>URL:</strong>{' '}
                    <a href={String(listing._vendorData.url)} target="_blank" rel="noopener noreferrer" style={{ color: '#0566e8', textDecoration: 'underline' }}>{String(listing._vendorData.url)}</a>
                  </p>
                )}
                {listing._vendorData?.body != null && Array.isArray(listing._vendorData.body) && listing._vendorData.body.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <strong>Body:</strong>
                    <div style={{ marginTop: '0.5rem' }}>
                      {listing._vendorData.body.map((item, i) => (
                        <p key={i} style={{ margin: '0 0 0.5rem 0' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</p>
                      ))}
                    </div>
                  </div>
                )}
                {listing._vendorData && (() => {
                  const known = new Set(['title', 'url', 'price', 'body']);
                  const rest = Object.entries(listing._vendorData).filter(([k]) => !known.has(k));
                  if (rest.length === 0) return null;
                  return (
                    <div style={{ marginTop: '0.75rem' }}>
                      {rest.map(([key, value]) => (
                        <div key={key} style={{ marginBottom: '0.35rem' }}>
                          <strong>{key}:</strong>{' '}
                          {Array.isArray(value) ? value.join(', ') : value != null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function ListingViewPage() {
  const params = useParams();
  const path = (params.path as string[]) ?? [];

  const [listing, setListing] = useState<LoadedListing | null>(null);
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
          const data = JSON.parse(text) as unknown;
          const single = Array.isArray(data) ? data[0] ?? null : data;
          setListing(normalizeParsedListing(single));
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

  const linkStyle = { fontSize: '0.875rem' as const, color: '#333' };
  const mainStyle = { maxWidth: '52rem', margin: '0 auto', padding: '1.5rem 1rem' };

  if (listing && isElinaListing(listing)) {
    return (
      <main style={mainStyle}>
        <Link href="/" style={linkStyle}>&larr; Back to listings</Link>
        <ElinaListingView listing={listing} path={path} />
      </main>
    );
  }

  if (listing) {
    return (
      <main style={mainStyle}>
        <Link href="/" style={linkStyle}>&larr; Back to listings</Link>
        <GoldenDesignsListingView listing={listing} path={path} raw={raw} />
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <Link href="/" style={linkStyle}>&larr; Back to listings</Link>
      {raw ? (
        <pre style={{ fontSize: '0.75rem', overflow: 'auto', marginTop: '1rem' }}>{raw.slice(0, 2000)}{raw.length > 2000 ? '…' : ''}</pre>
      ) : (
        <p style={{ marginTop: '1rem' }}>No listing data.</p>
      )}
    </main>
  );
}
