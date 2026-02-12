'use client';

import { useState } from 'react';

export default function Home() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    // TODO: wire to pipeline or API — for now just log
    console.log({ excelFile: excelFile?.name, websiteUrl });
    setIsSubmitting(false);
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
          {isSubmitting ? 'Processing…' : 'Generate listings'}
        </button>
      </form>
    </main>
  );
}
