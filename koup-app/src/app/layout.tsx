import type { Metadata } from 'next';
import './globals.css';
import { KoUpProvider } from '@/context/KoUpContext';
import Navbar from '@/components/Navbar';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'KoUp | Asya Dizileri, Anime & Global Sinema Platformu',
  description:
    '17.509 K-Drama, C-Drama, Anime ve Global Sinema yapımı. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu Apple TV+ & Netflix deneyimi.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#08080A] text-[#F4F4F6] min-h-screen flex flex-col selection:bg-sky-400 selection:text-black">
        <KoUpProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="mt-24 border-t border-white/[0.07] bg-[#060608] py-12 px-6 lg:px-14">
            <div className="max-w-[1680px] mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3.5">
                <img
                  src="/logo-dark.png"
                  alt="KoUp"
                  className="w-9 h-9 object-contain"
                />
                <div>
                  <div className="text-sm font-bold text-white">
                    KoUp Cinema Studio
                  </div>
                  <div className="text-xs text-white/45">
                    MyDramaList · AniList · IMDb · TMDB · AsyaMag Entegre Arşiv
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
                  AsyaMag Dedikodu
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
