'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';

/** Flat shape from API: folder name -> list of file paths (path can contain / for nesting). */
type FlatTree = Record<string, string[]>;

/** Nested node: direct files in this folder, and child folders. */
type TreeNode = {
  directFiles: string[];
  children: Record<string, TreeNode>;
};

function displayFileName(file: string): string {
  return file.replace(/\.json$/i, '');
}

function buildTree(files: string[]): TreeNode {
  const directFiles = files.filter((f) => !f.includes('/'));
  const withSlash = files.filter((f) => f.includes('/'));
  const groups: Record<string, string[]> = {};
  for (const f of withSlash) {
    const idx = f.indexOf('/');
    const first = f.slice(0, idx);
    const rest = f.slice(idx + 1);
    if (!groups[first]) groups[first] = [];
    groups[first].push(rest);
  }
  const children: Record<string, TreeNode> = {};
  for (const [name, restPaths] of Object.entries(groups)) {
    children[name] = buildTree(restPaths);
  }
  return { directFiles, children };
}

function getAllFolderPaths(tree: Record<string, TreeNode>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [name, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${name}` : name;
    keys.push(path);
    keys.push(...getAllFolderPaths(node.children, path));
  }
  return keys;
}

export default function Home() {
  const [flatTree, setFlatTree] = useState<FlatTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const nestedTree = useMemo(() => {
    if (!flatTree) return null;
    return Object.fromEntries(
      Object.entries(flatTree).map(([k, v]) => [k, buildTree(v)])
    ) as Record<string, TreeNode>;
  }, [flatTree]);

  const allFolderPaths = useMemo(() => {
    if (!nestedTree) return [];
    return getAllFolderPaths(nestedTree);
  }, [nestedTree]);

  useEffect(() => {
    fetch('/api/listings')
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data: { folders: FlatTree }) => {
        const folders = data.folders ?? {};
        setFlatTree(folders);
        setExpandedFolders(new Set(getAllFolderPaths(
          Object.fromEntries(Object.entries(folders).map(([k, v]) => [k, buildTree(v)])) as Record<string, TreeNode>
        )));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleFolder = useCallback((folderPathKey: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPathKey)) next.delete(folderPathKey);
      else next.add(folderPathKey);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpandedFolders(new Set()), []);
  const expandAll = useCallback(() => {
    setExpandedFolders(new Set(allFolderPaths));
  }, [allFolderPaths]);

  if (loading) return <main><p>Loading…</p></main>;
  if (error) return <main><p>Error: {error}</p></main>;
  if (!nestedTree || Object.keys(nestedTree).length === 0) return <main><p>No listings.</p></main>;

  const topFolderNames = Object.keys(nestedTree).sort();
  const allExpanded = allFolderPaths.length > 0 && allFolderPaths.every((p) => expandedFolders.has(p));

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Listings</h1>
        <span style={{ fontSize: '0.8125rem', color: '#666' }}>
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontSize: 'inherit', textDecoration: 'underline' }}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </span>
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.875rem' }}>
        {topFolderNames.map((folder) => (
          <FolderRow
            key={folder}
            folderPathKey={folder}
            node={nestedTree[folder]}
            topLevelFolder={folder}
            pathFromTop=""
            expandedFolders={expandedFolders}
            onToggle={toggleFolder}
            displayFileName={displayFileName}
          />
        ))}
      </div>
    </main>
  );
}

function FolderRow({
  folderPathKey,
  node,
  topLevelFolder,
  pathFromTop,
  expandedFolders,
  onToggle,
  displayFileName,
}: {
  folderPathKey: string;
  node: TreeNode;
  topLevelFolder: string;
  pathFromTop: string;
  expandedFolders: Set<string>;
  onToggle: (key: string) => void;
  displayFileName: (file: string) => string;
}) {
  const open = expandedFolders.has(folderPathKey);
  const childNames = Object.keys(node.children).sort();
  const folderLabel = folderPathKey.split('/').pop() ?? folderPathKey;

  return (
    <div style={{ marginBottom: '0.25rem' }}>
      <button
        type="button"
        onClick={() => onToggle(folderPathKey)}
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
        <span style={{ fontWeight: 600 }}>{folderLabel}/</span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', paddingLeft: '1.5rem', margin: '0.15rem 0 0 0' }}>
          {childNames.map((name) => {
            const childPathKey = folderPathKey + '/' + name;
            const childPathFromTop = pathFromTop ? pathFromTop + '/' + name : name;
            return (
              <li key={childPathKey} style={{ marginBottom: '0.15rem' }}>
                <FolderRow
                  folderPathKey={childPathKey}
                  node={node.children[name]}
                  topLevelFolder={topLevelFolder}
                  pathFromTop={childPathFromTop}
                  expandedFolders={expandedFolders}
                  onToggle={onToggle}
                  displayFileName={displayFileName}
                />
              </li>
            );
          })}
          {node.directFiles.map((file) => {
            const filePath = pathFromTop ? pathFromTop + '/' + file : file;
            return (
              <li key={filePath} style={{ marginBottom: '0.15rem' }}>
                <Link
                  href={`/${encodeURIComponent(topLevelFolder)}/${encodeURIComponent(filePath)}`}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  {displayFileName(file)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
