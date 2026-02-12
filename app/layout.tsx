import type { Metadata } from 'next';
import './globals.css';
import { RunProvider } from './run-context';

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
      <body>
        <RunProvider>{children}</RunProvider>
      </body>
    </html>
  );
}
