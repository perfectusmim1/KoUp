'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Flame,
  Search,
  RefreshCw,
  Layers,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  supabase,
  MagazinePost,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { cachedQuery, invalidateCache } from '@/lib/cache';

function getMagCategoryColor(cat: string): string {
  switch (cat) {
    case 'Dedikodu':
      return 'bg-rose-600/85 text-white border-rose-400/50 shadow-sm shadow-black/30';
    case 'Kore':
      return 'bg-emerald-600/85 text-white border-emerald-400/50 shadow-sm shadow-black/30';
    case 'Çin':
      return 'bg-orange-600/85 text-white border-orange-400/50 shadow-sm shadow-black/30';
    case 'Dizi':
      return 'bg-sky-600/85 text-white border-sky-400/50 shadow-sm shadow-black/30';
    case 'Müzik':
      return 'bg-purple-600/85 text-white border-purple-400/50 shadow-sm shadow-black/30';
    case 'Film':
      return 'bg-amber-600/85 text-white border-amber-400/50 shadow-sm shadow-black/30';
    case 'BL GL':
      return 'bg-pink-600/85 text-white border-pink-400/50 shadow-sm shadow-black/30';
    case 'Tayland':
      return 'bg-teal-600/85 text-white border-teal-400/50 shadow-sm shadow-black/30';
    default:
      return 'bg-black/75 text-white border-white/25 shadow-sm shadow-black/30';
  }
}

const MAGAZINE_CATEGORIES = [
  'Tümü',
  'Dedikodu',
  'Kore',
  'Dizi',
  'Çin',
  'Müzik',
  'BL GL',
  'Tayland',
  'Film',
];

export default function MagazineHubPage() {
  const [allPosts, setAllPosts] = useState<MagazinePost[]>([]);
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [activeSource, setActiveSource] = useState<'Tümü' | 'KoreZin' | 'AsyaMag'>('Tümü');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sourceMode, setSourceMode] = useState<string>('combined_live');

  const loadMagazine = useCallback(async (forceFresh = false) => {
    if (forceFresh) {
      setIsRefreshing(true);
      invalidateCache('magazin_');
    } else {
      setIsLoading(true);
    }

    try {
      // 1. Canlı AsyaMag ve KoreZin kombine akışını çek
      const liveJson = await cachedQuery('magazin_live_posts', 180_000, async () => {
        const liveRes = await fetch(`/api/magazin/live?limit=48${forceFresh ? '&fresh=1' : ''}`);
        return liveRes.json();
      });
      const livePosts: MagazinePost[] = liveJson?.posts || [];
      if (liveJson?.source) setSourceMode(liveJson.source);

      // 2. Supabase arşivindeki haberlerle birleştir (mükerrer slug'ları tekilleştir)
      const dbData = await cachedQuery('magazin_db_posts', 300_000, async () => {
        const { data } = await supabase
          .from('magazine_posts')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(300);
        return (data as MagazinePost[]) || [];
      });

      const seenSlugs = new Set<string>();
      const seenTitles = new Set<string>();
      const merged: MagazinePost[] = [];

      for (const p of [...livePosts, ...(dbData || [])]) {
        if (!p?.slug || seenSlugs.has(p.slug)) continue;
        const normTitle = (p.title || '').trim().toLowerCase();
        if (normTitle && seenTitles.has(normTitle)) continue;

        seenSlugs.add(p.slug);
        if (normTitle) seenTitles.add(normTitle);
        merged.push(p);
      }

      merged.sort(
        (a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );
      setAllPosts(merged);
    } catch {
      const { data } = await supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(300);
      setAllPosts((data as MagazinePost[]) || []);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMagazine(false);
  }, [loadMagazine]);

  const filteredPosts = useMemo(() => {
    return allPosts.filter((p) => {
      // Kaynak Filtresi (KoreZin / AsyaMag / Tümü)
      if (activeSource !== 'Tümü') {
        const isKZ =
          p.source_site === 'KoreZin' ||
          p.slug.startsWith('kz-') ||
          p.author_name?.includes('KoreZin') ||
          p.source_url?.includes('korezin.com');

        if (activeSource === 'KoreZin' && !isKZ) return false;
        if (activeSource === 'AsyaMag' && isKZ) return false;
      }

      // Kategori Filtresi
      if (activeCategory !== 'Tümü') {
        const cats = p.categories || [];
        if (
          !cats.includes(activeCategory) &&
          !(activeCategory === 'Dedikodu' && p.is_gossip)
        ) {
          return false;
        }
      }

      // Arama Filtresi
      if (searchQuery.trim().length >= 2) {
        const q = searchQuery.trim().toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          (p.excerpt || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allPosts, activeSource, activeCategory, searchQuery]);

  const featuredPost = filteredPosts[0];
  const restPosts = filteredPosts.slice(1);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-10">
      {/* HEADER */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Magazin
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row items-center sm:items-center gap-3 w-full sm:w-auto">
          <button
            onClick={() => loadMagazine(true)}
            disabled={isRefreshing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full apple-glass-pill text-xs font-bold text-amber-300 hover:text-white border border-amber-400/30 cursor-pointer mx-auto sm:mx-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Canlı Çekiliyor...' : 'Canlı Akışı Yenile'}</span>
          </button>

          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] mx-auto sm:mx-0">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Haber, oyuncu veya dedikodu ara..."
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56 font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-white/40 hover:text-white transition-colors cursor-pointer"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CATEGORY & SOURCE FILTER TABS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {MAGAZINE_CATEGORIES.map((cat) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-colors duration-200 cursor-pointer ${
                  active
                    ? 'text-black'
                    : 'glass-pill text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="magazin-category-active-pill"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                  />
                )}
                {cat === 'Dedikodu' && <Flame className="w-3.5 h-3.5 text-rose-400 relative z-10" />}
                <span className="relative z-10">{cat}</span>
              </button>
            );
          })}
        </div>

        {/* Source Segmented Switch */}
        <div className="flex items-center gap-1 p-1 rounded-full glass-pill-dark border border-white/12 self-start sm:self-auto shrink-0">
          {(['Tümü', 'KoreZin', 'AsyaMag'] as const).map((source) => {
            const active = activeSource === source;
            return (
              <button
                key={source}
                onClick={() => setActiveSource(source)}
                className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors duration-200 cursor-pointer ${
                  active
                    ? 'text-white'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="magazin-source-active-pill"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                    className={`absolute inset-0 rounded-full shadow-md ${
                      source === 'KoreZin'
                        ? 'bg-gradient-to-r from-rose-500 to-pink-500 shadow-[0_0_15px_rgba(244,63,94,0.45)]'
                        : source === 'AsyaMag'
                        ? 'bg-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.45)]'
                        : 'bg-white/20 border border-white/20'
                    }`}
                  />
                )}
                <span className="relative z-10">
                  {source === 'Tümü' ? 'Tüm Kaynaklar' : source}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-amber-300 animate-pulse">
          Canlı AsyaMag ve KoreZin Akışı Çekiliyor...
        </div>
      ) : (
        <>
          {/* FEATURED EDITORIAL HERO ARTICLE */}
          {featuredPost && (
            <Link
              href={`/magazin/${featuredPost.slug}`}
              className="koup-projection-card block rounded-3xl overflow-hidden bg-[#121216] border border-white/15 grid grid-cols-1 lg:grid-cols-12 group"
            >
              <div className="lg:col-span-7 relative min-h-[280px] sm:min-h-[380px] overflow-hidden">
                <img
                  src={getProxiedImageUrl(featuredPost.featured_image)}
                  alt={featuredPost.title}
                  loading="eager"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-transparent lg:hidden" />
              </div>
              <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-mono font-bold border shadow-sm shadow-black/30 ${
                        featuredPost.source_site === 'KoreZin' || featuredPost.slug.startsWith('kz-')
                          ? 'bg-rose-600/85 text-white border-rose-400/50'
                          : 'bg-sky-600/85 text-white border-sky-400/50'
                      }`}
                    >
                      {featuredPost.source_site === 'KoreZin' || featuredPost.slug.startsWith('kz-')
                        ? 'KoreZin'
                        : 'AsyaMag'}
                    </span>
                    {(featuredPost.categories || ['Magazin']).map((c) => (
                      <span
                        key={c}
                        className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${getMagCategoryColor(c)}`}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight group-hover:text-sky-300 transition-colors">
                    {featuredPost.title}
                  </h2>
                  <p className="text-sm text-white/70 leading-relaxed line-clamp-4">
                    {featuredPost.excerpt}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs font-mono text-white/50">
                  <span>
                    {new Date(featuredPost.published_at).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="text-sky-400 font-bold">
                    Tam Metin KoUp İçinde Oku →
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* ARTICLES BENTO GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {restPosts.map((post) => {
              const isKoreZin =
                post.source_site === 'KoreZin' ||
                post.slug.startsWith('kz-') ||
                post.source_url?.includes('korezin.com');

              return (
                <Link
                  key={post.slug}
                  href={`/magazin/${post.slug}`}
                  className="koup-projection-card cv-card rounded-3xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col group [content-visibility:auto] [contain-intrinsic-size:auto_380px]"
                >
                  <div className="relative h-52 overflow-hidden">
                    <img
                      src={getProxiedImageUrl(post.featured_image)}
                      alt={post.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent pointer-events-none" />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 z-10">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border shadow-sm shadow-black/30 ${
                          isKoreZin
                            ? 'bg-rose-600/85 text-white border-rose-400/50'
                            : 'bg-sky-600/85 text-white border-sky-400/50'
                        }`}
                      >
                        {isKoreZin ? 'KoreZin' : 'AsyaMag'}
                      </span>
                      {(post.categories || ['Magazin']).slice(0, 2).map((cat) => (
                        <span
                          key={cat}
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${getMagCategoryColor(cat)}`}
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-2">
                        {post.title}
                      </h3>
                      <p className="text-xs text-white/60 mt-2 line-clamp-3 leading-relaxed">
                        {post.excerpt}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/45">
                      <span>
                        {new Date(post.published_at).toLocaleDateString('tr-TR')}
                      </span>
                      <span className="text-sky-400">Haberi Oku →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
