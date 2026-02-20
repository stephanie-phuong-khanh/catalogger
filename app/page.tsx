'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Tree = Record<string, string[]>;

export default function Home() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/listings')
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data: { folders: Tree }) => {
        setTree(data.folders ?? {});
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main><p>Loading…</p></main>;
  if (error) return <main><p>Error: {error}</p></main>;
  if (!tree || Object.keys(tree).length === 0) return <main><p>No listings.</p></main>;

  const folderNames = Object.keys(tree).sort();

  return (
    <main>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>listings/</h1>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.875rem' }}>
        {folderNames.map((folder) => (
          <FolderRow key={folder} folder={folder} files={tree[folder]} defaultOpen />
        ))}
      </div>
    </main>
  );
}

function FolderRow({
  folder,
  files,
  defaultOpen,
}: {
  folder: string;
  files: string[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: '0.25rem' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: 'none',
          border: 'none',
          padding: '0.15rem 0',
          cursor: 'pointer',
          color: 'inherit',
          fontSize: 'inherit',
        }}
        aria-expanded={open}
      >
        <span style={{ width: '1rem', textAlign: 'center', color: '#666' }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ fontWeight: 600 }}>{folder}/</span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', paddingLeft: '1.5rem', margin: '0.15rem 0 0 0' }}>
          {files.map((file) => (
            <li key={file} style={{ marginBottom: '0.15rem' }}>
              <Link
                href={`/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {file}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
