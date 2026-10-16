import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { KoUpProvider } from '@/context/KoUpContext';
import Navbar from '@/components/Navbar';
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
      <body
        className={`${plusJakartaSans.className} bg-[#080808] text-[#F4F4F6] min-h-screen flex flex-col selection:bg-white selection:text-black antialiased`}
      >
        <KoUpProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="mt-24 border-t border-white/[0.06] bg-[#080808] py-12 px-6 lg:px-14">
            <div className="max-w-[1680px] mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3.5">
                <img
                  src="/logo-dark.png"
                  alt="KoUp"
                  className="h-9 w-auto object-contain"
                />
                <div>
                  <div className="text-sm font-bold text-white">
                    KoUp Cinema Studio
                  </div>
                  <div className="text-xs text-white/45">
                    K-Drama · C-Drama · Anime & Asya Sineması Arşivi
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-xs text-white/55">
                <Link href="/kesfet?type=dizi" className="hover:text-white">
                  K-Drama & C-Drama
                </Link>
                <Link href="/kesfet?type=anime" className="hover:text-white">
                  Animeler
                </Link>
                <Link href="/kesfet?type=film" className="hover:text-white">
                  Filmler
                </Link>
                <Link href="/oyuncular" className="hover:text-white">
                  Oyuncular & Karakterler
                </Link>
                <Link href="/magazin" className="hover:text-white">
                  Magazin & Gündem
                </Link>
                <Link href="/takvim" className="hover:text-white">
                  Yayın Takvimi
                </Link>
                <Link href="/admin" className="text-amber-300 hover:underline">
                  Admin Kontrol Merkezi
                </Link>
              </div>
            </div>
          </footer>
        </KoUpProvider>
      </body>
    </html>
  );
}
