import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { KoUpProvider } from '@/context/KoUpContext';
import Navbar from '@/components/Navbar';
import DeferredCookieBanner from '@/components/DeferredCookieBanner';
import ScrollRestoration from '@/components/ScrollRestoration';
import PageTransition from '@/components/PageTransition';
import Footer from '@/components/Footer';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

function resolveSafeOrigin(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed env origin
  }
  return null;
}

const r2PublicOrigin = resolveSafeOrigin(
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL
);

export const viewport: Viewport = {
  themeColor: '#080808',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: 'KoUp | Asya Dizileri, Anime & Global Sinema Platformu',
    template: '%s | KoUp Cinema',
  },
  description:
    '24.700+ K-Drama, C-Drama, Anime ve Global Sinema yapımı. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu Apple TV+ & Netflix deneyimi.',
  icons: {
    icon: '/logo-dark.png',
    apple: '/logo-dark.png',
  },
  openGraph: {
    title: 'KoUp | Asya Dizileri, Anime & Global Sinema Platformu',
    description:
      '24.700+ K-Drama, C-Drama, Anime ve Global Sinema yapımı. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu Apple TV+ & Netflix deneyimi.',
    siteName: 'KoUp Cinema',
    locale: 'tr_TR',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="tr"
      className={`dark ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://image.tmdb.org" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://image.tmdb.org" />
        {r2PublicOrigin && (
          <>
            <link rel="preconnect" href={r2PublicOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={r2PublicOrigin} />
          </>
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(typeof window!=='undefined'&&'scrollRestoration' in history){history.scrollRestoration='manual';}`,
          }}
        />
      </head>
      <body
        className={`${plusJakartaSans.className} bg-[#080808] text-[#F4F4F6] min-h-screen flex flex-col selection:bg-white selection:text-black antialiased w-full max-w-full`}
      >
        <KoUpProvider>
          <ScrollRestoration />
          <Navbar />
          <main className="flex-1 w-full max-w-full">
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
          <DeferredCookieBanner />
        </KoUpProvider>
      </body>
    </html>
  );
}
