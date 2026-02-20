'use client';

import Link from 'next/link';
import { useRun } from '../../run-context';

// [HARDCODED] Golden Designs SKU column. Later: from config or run.
const SKU_COLUMN = 'GDINA Item #';

export default function ReviewPage() {
  const { run } = useRun();

  if (!run) {
    return (
      <main>
        <h1>Review listings</h1>
        <p>No parsed data. Upload a sheet on the home page first.</p>
        <Link href="/generate" style={{ marginTop: '1rem', display: 'inline-block' }}>
          &larr; Back to upload
        </Link>
      </main>
    );
  }

  const { tabs, vendorUrl, listings } = run;
  const generatedCount = Object.keys(listings).length;
  const totalProducts = tabs.reduce((sum, tab) => sum + tab.products.length, 0);

  function handleDownload() {
    const allListings = Object.values(listings);
    if (allListings.length === 0) return;
    const blob = new Blob([JSON.stringify(allListings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catalogger-listings.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <h1>Review listings</h1>

      {vendorUrl && (
        <p className="placeholder-note" style={{ marginBottom: '0.5rem' }}>
          Vendor website: <a href={vendorUrl} target="_blank" rel="noopener noreferrer">{vendorUrl}</a>
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <Link href="/generate" style={{ fontSize: '0.875rem' }}>
          &larr; Upload a different sheet
        </Link>
        <button
          onClick={handleDownload}
          disabled={generatedCount === 0}
          style={{ fontSize: '0.875rem', opacity: generatedCount === 0 ? 0.4 : 1 }}
        >
          Download {generatedCount} generated listing{generatedCount !== 1 ? 's' : ''}
        </button>
      </div>

      <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: '1.5rem' }}>
        {generatedCount} of {totalProducts} listings generated. Click a product to generate its listing.
      </p>

      {tabs.length === 0 ? (
        <p>No products found in any tab.</p>
      ) : (
        tabs.map((tab) => (
          <section key={tab.name} style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: '0.75rem' }}>{tab.name}</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {tab.products.map((product) => {
                const sku = String(product[SKU_COLUMN] ?? '');
                const description = String(product['Description'] ?? product['Brand Name'] ?? '');
                const label = sku ? (description ? `${sku} — ${description}` : sku) : 'No SKU';
                const isGenerated = sku in listings;

                return (
                  <li
                    key={sku || Math.random()}
                    style={{
                      marginBottom: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isGenerated ? '#0a0' : '#ccc',
                      flexShrink: 0,
                    }} />
                    <Link
                      href={sku ? `/generate/review/${encodeURIComponent(sku)}` : '#'}
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
