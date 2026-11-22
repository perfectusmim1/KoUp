'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { MediaItem, EpisodeData } from '@/lib/supabase';

const ShortsDetailClientInner = dynamic(
  () => import('./ShortsWatchClient').then((m) => m.ShortsDetailClient),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#070709] pt-28 pb-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-8">
          <div className="w-36 sm:w-52 md:w-60 aspect-[2/3] sm:aspect-[9/16] rounded-3xl bg-white/[0.04] border border-white/10 animate-pulse mx-auto md:mx-0" />
          <div className="flex-1 space-y-4">
            <div className="h-8 w-2/3 rounded-xl bg-white/[0.06] animate-pulse" />
            <div className="h-4 w-full rounded-lg bg-white/[0.04] animate-pulse" />
            <div className="h-4 w-4/5 rounded-lg bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      </div>
    ),
  }
);

export default function LazyShortsDetailClient({
  media,
  episodes,
}: {
  media: MediaItem;
  episodes: EpisodeData[];
}) {
  return <ShortsDetailClientInner media={media} episodes={episodes} />;
}
