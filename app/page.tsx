'use client';

import { useState } from 'react';

export default function Home() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
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
      setMessage(data.tabs?.length ? `Parsed ${data.tabs.length} tab(s). Ready to generate listings.` : 'Sheet parsed. Ready to generate listings.');

      // TEMP: auto-download API response to inspect the parsed sheet (remove when no longer needed)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parse-result-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
        <p className="placeholder-note">This is the canonical product list.</p>
        <input
          id="excel"
          type="file"
          accept=".xlsx,.xls"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcelFile(e.target.files?.[0] ?? null)}
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
          {isSubmitting ? 'Processing…' : 'Start'}
        </button>

        {message && <p style={{ marginTop: '1rem', color: 'var(--success, #0a0)' }}>{message}</p>}
        {error && <p style={{ marginTop: '1rem', color: 'var(--error, #c00)' }}>{error}</p>}
      </form>
    </main>
  );
}
