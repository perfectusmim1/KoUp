import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { KoUpProvider } from '@/context/KoUpContext';
import Navbar from '@/components/Navbar';
import CookieConsentBanner from '@/components/CookieConsentBanner';
import ScrollRestoration from '@/components/ScrollRestoration';
import BenchmarkRunner from '@/components/BenchmarkRunner';
import Link from 'next/link';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

import Footer from '@/components/Footer';

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
    '17.509 K-Drama, C-Drama, Anime ve Global Sinema yapımı. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu Apple TV+ & Netflix deneyimi.',
  icons: {
    icon: '/logo-dark.png',
    apple: '/logo-dark.png',
  },
  openGraph: {
    title: 'KoUp | Asya Dizileri, Anime & Global Sinema Platformu',
    description:
      '17.509 K-Drama, C-Drama, Anime ve Global Sinema yapımı. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu Apple TV+ & Netflix deneyimi.',
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
          <main className="flex-1 w-full max-w-full overflow-x-hidden">{children}</main>
          <Footer />
          <CookieConsentBanner />
          <BenchmarkRunner />
        </KoUpProvider>
      </body>
    </html>
  );
}
