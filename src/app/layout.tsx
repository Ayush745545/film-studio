import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { currentUser } from '@/lib/security/auth';
import { buildBootstrap, type BootstrapPayload } from '@/lib/bootstrap';
import { isThemeId, DEFAULT_THEME } from '@/lib/themes';

export const metadata: Metadata = {
  title: 'AI Film Studio',
  description: 'A professional editor, an AI film studio and a production pipeline in one workspace.',
  applicationName: 'AI Film Studio',
  icons: { icon: [{ url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%2311100E"/><path d="M9 8h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" fill="none" stroke="%23D99A32" stroke-width="1.6"/><path d="M11 8v16M21 8v16M7 13h4M7 19h4M21 13h4M21 19h4" stroke="%23D99A32" stroke-width="1.2" opacity=".65"/><circle cx="16" cy="16" r="2.6" fill="%23F0B347"/></svg>', type: 'image/svg+xml' }] }
};

export const viewport: Viewport = {
  themeColor: 'rgb(var(--bg-rgb))',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5
};

/**
 * The layout resolves the bootstrap payload on the server and hands it to the
 * client stores, so the first paint is the real workspace — no loading splash
 * that swaps out a moment later.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let initial: BootstrapPayload | null = null;
  try {
    const user = await currentUser();
    if (user) initial = await buildBootstrap(user);
  } catch (err) {
    // Never fail the page because a preload failed — the client refetches.
    console.warn('[layout] bootstrap preload skipped:', (err as Error).message);
  }
  const theme = isThemeId(initial?.user.theme) ? (initial!.user.theme as string) : DEFAULT_THEME;
  return (
    // data-theme is resolved on the server, so the very first paint is already
    // in the user's palette — no flash of the default theme on load.
    <html lang="en" className="dark" data-theme={theme} suppressHydrationWarning>
      <body>
        <Providers initialBoot={initial}>{children}</Providers>
      </body>
    </html>
  );
}
