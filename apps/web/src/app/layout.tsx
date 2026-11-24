import type { Metadata } from 'next';
import { ThemeSync } from '@/components/shared/theme-sync';
import { themeInitScript } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'GSC Peoples',
  description: 'HR & People CRM - GrowSpark Consulting Business Platform',
  // No brand favicon asset exists yet; an empty data URI stops browsers requesting /favicon.ico
  // (a 404 console error). Replace with the real icon (src/app/icon.*) once the asset is supplied.
  icons: { icon: 'data:,' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen font-sans">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
