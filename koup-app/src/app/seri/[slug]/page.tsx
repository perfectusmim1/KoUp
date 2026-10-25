import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeriesDataServer } from '@/lib/server/seriesData';
import SeriesDetailClient from './SeriesDetailClient';
import { cleanMediaTitle, cleanOverviewText, getProxiedImageUrl } from '@/lib/supabase';

// Incremental Static Regeneration (ISR): Cache rendered series page for 1 hour
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { media } = await getSeriesDataServer(slug);

  if (!media) {
    return {
      title: 'Dizi / Yapım Bulunamadı | KoUp TV+',
      description: 'Aradığınız dizi veya film arşivimizde bulunamadı.',
    };
  }

  const cleanTitle = cleanMediaTitle(media.title);
  const yearText = media.release_year ? `(${media.release_year})` : '';
  const title = `${cleanTitle} ${yearText} Türkçe Altyazılı İzle | KoUp TV+`.trim();
  const rawOverview = cleanOverviewText(media.overview);
  const description = rawOverview
    ? `${cleanTitle} tüm bölümleriyle kesintisiz, donmadan ve full HD Türkçe altyazılı olarak KoUp TV+'ta. ${rawOverview.slice(0, 160)}...`
    : `${cleanTitle} ${yearText} yapımını reklamsız, kesintisiz ve yüksek kalitede KoUp TV+ ile izleyin.`;

  const ogImage = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.title,
    null,
    'w1280',
    'banner'
  );

  const canonicalUrl = `https://koup.tv/seri/${media.slug}`;

  return {
    title,
    description,
    keywords: [
      cleanTitle,
      `${cleanTitle} izle`,
      `${cleanTitle} türkçe altyazılı`,
      `${cleanTitle} kore dizisi`,
      `${cleanTitle} full hd`,
      ...(media.categories || []),
    ],
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${cleanTitle} | KoUp TV+ Cinema Studio`,
      description,
      url: canonicalUrl,
      siteName: 'KoUp TV+',
      locale: 'tr_TR',
      type: media.content_type === 'film' ? 'video.movie' : 'video.tv_show',
      images: [
        {
          url: ogImage,
          width: 1280,
          height: 720,
          alt: cleanTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${cleanTitle} | KoUp TV+`,
      description,
      images: [ogImage],
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
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decodedSlug = decodeURIComponent(slug || '').trim();
  const data = await getSeriesDataServer(decodedSlug);

  if (!data.media) {
    notFound();
  }

  const { media, episodes, cast, franchise } = data;

  // Canonical clean URL redirect: if visited with competitor suffix or numeric ID, 301-redirect to pristine slug
  if (
    media.slug &&
    media.slug !== decodedSlug &&
    (decodedSlug.includes('animecix') ||
      decodedSlug.includes('asyaanimeleri') ||
      !Number.isNaN(Number(decodedSlug)))
  ) {
    permanentRedirect(`/seri/${media.slug}`);
  }
  const cleanTitle = cleanMediaTitle(media.title);
  const cleanOverview = cleanOverviewText(media.overview);
  const posterUrl = getProxiedImageUrl(media.cover_image, media.title, null, 'w500');

  // Google Rich Snippets / Schema.org Structured Data (TVSeries / Movie)
  const isFilm = media.content_type === 'film';
  const ratingValue = media.mdl_rating || media.imdb_rating || media.site_rating;

  const jsonLd: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': isFilm ? 'Movie' : 'TVSeries',
    name: cleanTitle,
    alternateName: media.native_title || undefined,
    description: cleanOverview,
    image: posterUrl,
    datePublished: media.release_year ? String(media.release_year) : undefined,
    genre: media.categories && media.categories.length > 0 ? media.categories : undefined,
    inLanguage: media.country_code === 'KR' ? 'ko' : media.country_code === 'CN' ? 'zh' : media.country_code === 'JP' ? 'ja' : 'en',
    numberOfEpisodes: !isFilm && (media.episode_count || episodes.length > 0) ? (media.episode_count || episodes.length) : undefined,
  };

  if (ratingValue && Number(ratingValue) > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(ratingValue),
      bestRating: 10,
      worstRating: 1,
      ratingCount: media.site_rating_count || 50,
    };
  }

  if (cast && cast.length > 0) {
    jsonLd.actor = cast.slice(0, 8).map((c) => ({
      '@type': 'Person',
      name: c.people?.name || c.character_name,
    }));
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SeriesDetailClient
        slug={slug}
        initialMedia={media}
        initialEpisodes={episodes}
        initialCast={cast}
        initialFranchise={franchise}
      />
    </>
  );
}
