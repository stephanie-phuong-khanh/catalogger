'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRun } from './run-context';

export default function Home() {
  const router = useRouter();
  const { setRun } = useRun();
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('https://goldendesigninc.com');
  const [supplierName, setSupplierName] = useState('Golden Designs');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      if (excelFile) formData.append('file', excelFile);
      formData.append('websiteUrl', websiteUrl);

      const res = await fetch('/api/parse-sheet', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Request failed');
        return;
      }

      setRun(data.tabs, data.vendorUrl, supplierName);
      router.push('/review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Catalogger</h1>
      <p>Upload your sources and generate listings.</p>

      <form onSubmit={handleSubmit} style={{ marginTop: '2rem' }}>
        <label htmlFor="excel">Pricing sheet (Excel)</label>
        <p className="placeholder-note">For this demo, please upload the Golden Designs pricing sheet (.xlsx). Other sheets are not yet supported.</p>
        <input
          id="excel"
          type="file"
          accept=".xlsx,.xls"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcelFile(e.target.files?.[0] ?? null)}
        />

        <label htmlFor="supplier">Supplier / vendor name</label>
        <input
          id="supplier"
          type="text"
          value={supplierName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSupplierName(e.target.value)}
        />

        <label htmlFor="website">Vendor website</label>
        <input
          id="website"
          type="url"
          placeholder="https://..."
          value={websiteUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWebsiteUrl(e.target.value)}
        />

        <label>Image Drive (coming soon)</label>
        <p className="placeholder-note">We will later support linking a Drive folder for images to be edited in preferred style.</p>
        <input type="text" placeholder="Link to image folder" disabled />

        <label>YouTube channel / playlist (coming soon)</label>
        <input type="text" placeholder="Link to channel or playlist" disabled />

        <button type="submit" disabled={isSubmitting} style={{ marginTop: '1rem' }}>
          {isSubmitting ? 'Processing...' : 'Start'}
        </button>

        {error && <p style={{ marginTop: '1rem', color: '#c00' }}>{error}</p>}
      </form>
    </main>
  );
}
