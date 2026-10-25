import type { Metadata } from 'next';
import { getHomeDataServer } from '@/lib/server/homeData';
import HomeClient from './HomeClient';

// Incremental Static Regeneration (ISR): Cache homepage for 5 minutes
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'KoUp TV+ | Cinema Studio — Asya Dizileri, K-Drama ve Anime Platformu',
  description:
    '24.700+ Master Yapımlık dev arşiv: K-Drama, C-Drama, Anime ve Asya Sineması. MyDramaList, AniList, IMDb ve AsyaMag entegrasyonlu reklamsız Apple TV+ & Netflix akıcılığı.',
  keywords: [
    'KoUp TV+',
    'K-Drama izle',
    'Kore dizileri',
    'Asya dizileri',
    'Anime izle',
    'Türkçe altyazılı dizi izle',
    'Çin dizileri izle',
    'BL dizi izle',
    'Asya sineması',
  ],
  alternates: {
    canonical: 'https://koup.tv',
  },
  openGraph: {
    title: 'KoUp TV+ | Cinema Studio — Asya Dizileri, K-Drama ve Anime Platformu',
    description:
      '24.700+ Master Yapımlık dev arşiv: K-Drama, C-Drama, Anime ve Asya Sineması. Apple TV+ & Netflix akıcılığında reklamsız ve kesintisiz izleyin.',
    url: 'https://koup.tv',
    siteName: 'KoUp TV+',
    locale: 'tr_TR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KoUp TV+ | Cinema Studio — Asya Dizileri, K-Drama ve Anime Platformu',
    description:
      '24.700+ Master Yapımlık dev arşiv: K-Drama, C-Drama, Anime ve Asya Sineması.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default async function HomePage() {
  const initialBundle = await getHomeDataServer();

  return <HomeClient initialBundle={initialBundle} />;
}
