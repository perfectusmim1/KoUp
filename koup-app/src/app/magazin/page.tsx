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
import { useKoUp } from '@/context/KoUpContext';
import { usePillDragTracking } from '@/hooks/usePillDragTracking';

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

function getMagCategoryActivePill(cat: string): { pill: string; text: string } {
  switch (cat) {
    case 'Dedikodu':
      return {
        pill: 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_18px_rgba(244,63,94,0.45)] border border-rose-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Kore':
      return {
        pill: 'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_0_18px_rgba(16,185,129,0.45)] border border-emerald-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Çin':
      return {
        pill: 'bg-gradient-to-r from-orange-500 to-amber-600 shadow-[0_0_18px_rgba(249,115,22,0.45)] border border-orange-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Dizi':
      return {
        pill: 'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Müzik':
      return {
        pill: 'bg-gradient-to-r from-purple-500 to-pink-600 shadow-[0_0_18px_rgba(168,85,247,0.45)] border border-purple-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Film':
      return {
        pill: 'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(251,191,36,0.45)] border border-amber-400/40',
        text: 'text-white font-extrabold',
      };
    case 'Tayland':
      return {
        pill: 'bg-gradient-to-r from-teal-500 to-emerald-600 shadow-[0_0_18px_rgba(20,184,166,0.45)] border border-teal-400/40',
        text: 'text-white font-extrabold',
      };
    default:
      return {
        pill: 'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
        text: 'text-white font-extrabold',
      };
  }
}

const MAGAZINE_CATEGORIES = [
  'Tümü',
  'Dedikodu',
  'Kore',
  'Dizi',
  'Çin',
  'Müzik',
  'Tayland',
  'Film',
];

export default function MagazineHubPage() {
  const { triggerSound } = useKoUp();
  const [allPosts, setAllPosts] = useState<MagazinePost[]>([]);
  const [activeCategory, setActiveCategory] = useState('Tümü');
  const [activeSource, setActiveSource] = useState<'Tümü' | 'KoreZin' | 'AsyaMag'>('Tümü');

  const { containerRef: categoryTabsRef, dragProps: categoryTabsDragProps } = usePillDragTracking<string>({
    activeTab: activeCategory,
    onTabChange: (newCat) => {
      setActiveCategory(newCat);
    },
    triggerSound,
  });

  const { containerRef: sourceTabsRef, dragProps: sourceTabsDragProps } = usePillDragTracking<'Tümü' | 'KoreZin' | 'AsyaMag'>({
    activeTab: activeSource,
    onTabChange: (newSrc) => {
      setActiveSource(newSrc);
    },
    triggerSound,
  });
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 select-none">
        {/* Category Pills */}
        <div className="overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]">
          <div
            ref={categoryTabsRef}
            {...categoryTabsDragProps}
            className="inline-flex w-max items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 select-none touch-pan-x cursor-pointer sm:cursor-grab sm:active:cursor-grabbing overflow-hidden"
          >
            {MAGAZINE_CATEGORIES.map((cat) => {
              const active = activeCategory === cat;
              const style = getMagCategoryActivePill(cat);

              return (
                <button
                  key={cat}
                  data-tab-id={cat}
                  type="button"
                  onClick={() => {
                    triggerSound?.('click');
                    setActiveCategory(cat);
                  }}
                  className={`relative shrink-0 flex items-center gap-1.5 px-3.5 sm:px-4 h-9 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer select-none touch-manipulation ${
                    active ? style.text : 'text-white/70 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="magazin-category-active-pill"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                      className={`absolute inset-0 rounded-xl ${style.pill} z-0 select-none pointer-events-none`}
                    />
                  )}
                  {cat === 'Dedikodu' && <Flame className="w-3.5 h-3.5 text-rose-300 relative z-10 pointer-events-none" />}
                  <span className="relative z-10 pointer-events-none">{cat}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Source Segmented Switch */}
        <div
          ref={sourceTabsRef}
          {...sourceTabsDragProps}
          className="inline-flex w-max items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 self-start lg:self-auto shrink-0 overflow-x-auto no-scrollbar select-none touch-pan-x cursor-pointer sm:cursor-grab sm:active:cursor-grabbing overflow-hidden"
        >
          {(['Tümü', 'KoreZin', 'AsyaMag'] as const).map((source) => {
            const active = activeSource === source;

            return (
              <button
                key={source}
                data-tab-id={source}
                type="button"
                onClick={() => {
                  triggerSound?.('click');
                  setActiveSource(source);
                }}
                className={`relative shrink-0 flex items-center px-3.5 sm:px-4 h-9 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer select-none touch-manipulation ${
                  active ? 'text-white font-extrabold' : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="magazin-source-active-pill"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                    className={`absolute inset-0 rounded-xl z-0 select-none pointer-events-none ${
                      source === 'KoreZin'
                        ? 'bg-gradient-to-r from-rose-500 to-pink-600 shadow-[0_0_15px_rgba(244,63,94,0.45)] border border-rose-400/40'
                        : source === 'AsyaMag'
                        ? 'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_15px_rgba(14,165,233,0.45)] border border-sky-400/40'
                        : 'bg-gradient-to-r from-indigo-500 to-purple-600 shadow-[0_0_15px_rgba(99,102,241,0.45)] border border-indigo-400/40'
                    }`}
                  />
                )}
                <span className="relative z-10 pointer-events-none">
                  {source === 'Tümü' ? 'Tüm Kaynaklar' : source}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-12">
          {/* Featured Hero Skeleton */}
          <div className="rounded-3xl overflow-hidden bg-[#121216] border border-white/10 grid grid-cols-1 lg:grid-cols-12 animate-pulse min-h-[320px] sm:min-h-[380px]">
            <div className="lg:col-span-7 bg-white/[0.04]" />
            <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="h-6 w-28 rounded-full bg-white/10" />
                <div className="space-y-2">
                  <div className="h-8 w-full rounded-xl bg-white/[0.08]" />
                  <div className="h-8 w-4/5 rounded-xl bg-white/[0.08]" />
                </div>
                <div className="space-y-1.5 pt-2">
                  <div className="h-3.5 w-full rounded bg-white/[0.04]" />
                  <div className="h-3.5 w-2/3 rounded bg-white/[0.04]" />
                </div>
              </div>
              <div className="h-4 w-32 rounded bg-white/[0.05]" />
            </div>
          </div>

          {/* Grid Skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-3xl overflow-hidden bg-[#0f0f12] border border-white/[0.06] flex flex-col animate-pulse"
              >
                <div className="aspect-[16/10] bg-white/[0.04]" />
                <div className="p-5 sm:p-6 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="h-5 w-20 rounded-full bg-white/10" />
                    <div className="h-5 w-full rounded-lg bg-white/[0.08]" />
                    <div className="h-5 w-3/4 rounded-lg bg-white/[0.08]" />
                  </div>
                  <div className="h-3.5 w-24 rounded bg-white/[0.04]" />
                </div>
              </div>
            ))}
          </div>
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
                    {Array.from(new Set((featuredPost.categories || ['Magazin']).map((c) => (c || '').trim()).filter(Boolean))).map((c, idx) => (
                      <span
                        key={`${c}-${idx}`}
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
          <motion.div
            key={`magazin-grid-${activeCategory}-${activeSource}-${searchQuery}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {restPosts.map((post, idx) => {
              const isKoreZin =
                post.source_site === 'KoreZin' ||
                post.slug.startsWith('kz-') ||
                post.source_url?.includes('korezin.com');

              return (
                <motion.div
                  key={post.slug}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: Math.min(idx * 0.02, 0.18),
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="h-full"
                >
                  <Link
                    href={`/magazin/${post.slug}`}
                    className="koup-projection-card rounded-3xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col group h-full"
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
                      {Array.from(new Set((post.categories || ['Magazin']).map((c) => (c || '').trim()).filter(Boolean))).slice(0, 2).map((cat, idx) => (
                        <span
                          key={`${cat}-${idx}`}
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
              </motion.div>
            );
          })}
        </motion.div>
        </>
      )}
    </div>
  );
}
