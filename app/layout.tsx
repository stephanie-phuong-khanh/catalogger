import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Catalogger',
  description: 'Assisted product listing for distributors',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
