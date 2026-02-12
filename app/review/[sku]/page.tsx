'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function ReviewSkuPage() {
  const params = useParams();
  const sku = params.sku as string;

  return (
    <main>
      <h1>Product: {decodeURIComponent(sku)}</h1>
      <p>Generate listing and compare sheet vs vendor — coming next.</p>
      <Link href="/review" style={{ marginTop: '1rem', display: 'inline-block' }}>
        ← Back to list
      </Link>
    </main>
  );
}
