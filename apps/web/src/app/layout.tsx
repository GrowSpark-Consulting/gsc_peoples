import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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

/*
 * Same families and weights as before (Inter 400/500/600, JetBrains Mono 400/500), now self-hosted by next/font:
 * no render-blocking stylesheet from fonts.googleapis.com, no extra cross-origin connections, latin subset only, and
 * a metric-matched fallback so text does not shift when the web font arrives.
 */
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap' });
// Numbers/code only: not preloaded, so it never competes with the main text font on first paint.
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', preload: false });

// The design tokens in globals.css name the families; point them at the self-hosted faces (fallback stacks unchanged).
const fontTokens = {
  '--gs-font-sans': `${inter.style.fontFamily}, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  '--gs-font-mono': `${mono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
} as React.CSSProperties;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" style={fontTokens} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
