'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type Tree = Record<string, string[]>;

function displayFileName(file: string): string {
  return file.replace(/\.json$/i, '');
}

export default function Home() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/listings')
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data: { folders: Tree }) => {
        const folders = data.folders ?? {};
        setTree(folders);
        setExpandedFolders(new Set(Object.keys(folders).sort()));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleFolder = useCallback((folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpandedFolders(new Set()), []);
  const expandAll = useCallback(() => {
    if (tree) setExpandedFolders(new Set(Object.keys(tree).sort()));
  }, [tree]);

  if (loading) return <main><p>Loading…</p></main>;
  if (error) return <main><p>Error: {error}</p></main>;
  if (!tree || Object.keys(tree).length === 0) return <main><p>No listings.</p></main>;

  const folderNames = Object.keys(tree).sort();
  const allExpanded = folderNames.length > 0 && folderNames.every((f) => expandedFolders.has(f));

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>listings/</h1>
        <span style={{ fontSize: '0.8125rem', color: '#666' }}>
          <button type="button" onClick={allExpanded ? collapseAll : expandAll} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontSize: 'inherit', textDecoration: 'underline' }}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </span>
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.875rem' }}>
        {folderNames.map((folder) => (
          <FolderRow
            key={folder}
            folder={folder}
            files={tree[folder]}
            open={expandedFolders.has(folder)}
            onToggle={() => toggleFolder(folder)}
            displayFileName={displayFileName}
          />
        ))}
      </div>
    </main>
  );
}

function FolderRow({
  folder,
  files,
  open,
  onToggle,
  displayFileName,
}: {
  folder: string;
  files: string[];
  open: boolean;
  onToggle: () => void;
  displayFileName: (file: string) => string;
}) {
  return (
    <div style={{ marginBottom: '0.25rem' }}>
      <button
        type="button"
        onClick={onToggle}
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
                {displayFileName(file)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
