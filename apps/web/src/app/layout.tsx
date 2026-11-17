import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@kavach/shared';
import { Providers } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Construction material inventory',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
