import './globals.css';
import { SuppressDigestRejection } from '@/components/SuppressDigestRejection';

export const metadata = {
  title: 'Atoms Demo',
};

/** Server-side: sanitize API base so client never sees unsubstituted $NEXT_PUBLIC_API_URL. */
function getServerApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || '';
  if (
    !raw ||
    raw.startsWith('$') ||
    raw === '$NEXT_PUBLIC_API_URL' ||
    raw.includes('$NEXT_PUBLIC_API_URL')
  ) {
    return '';
  }
  return raw.replace(/\/$/, '');
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiBase = getServerApiBase();
  // Only inject when we have a runtime value; otherwise client uses build-time NEXT_PUBLIC_API_URL from the bundle
  const scriptContent = apiBase
    ? `window.__API_BASE__=${JSON.stringify(apiBase)};`
    : 'window.__API_BASE__=undefined;';
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <SuppressDigestRejection />
        {children}
      </body>
    </html>
  );
}
