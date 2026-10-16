'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Flame,
  Search,
  RefreshCw,
  Newspaper,
} from 'lucide-react';
import {
  supabase,
  MagazinePost,
  getProxiedImageUrl,
} from '@/lib/supabase';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sourceMode, setSourceMode] = useState<'live_api' | 'supabase_cache'>('live_api');

  const loadMagazine = useCallback(async (forceFresh = false) => {
    if (forceFresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      // 1. Canlı AsyaMag WordPress REST API akışını çek
      const liveRes = await fetch(`/api/magazin/live?limit=30${forceFresh ? '&fresh=1' : ''}`);
      const liveJson = await liveRes.json();
      const livePosts: MagazinePost[] = liveJson?.posts || [];
      if (liveJson?.source) setSourceMode(liveJson.source);

      // 2. Supabase arşivindeki haberlerle birleştir (mükerrer slug'ları tekilleştir)
      const { data: dbData } = await supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(75);

      const seenSlugs = new Set<string>();
      const merged: MagazinePost[] = [];

      for (const p of [...livePosts, ...((dbData as MagazinePost[]) || [])]) {
        if (!p?.slug || seenSlugs.has(p.slug)) continue;
        seenSlugs.add(p.slug);
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
        .limit(60);
      setAllPosts((data as MagazinePost[]) || []);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMagazine(false);
  }, [loadMagazine]);

  const filteredPosts = allPosts.filter((p) => {
    if (activeCategory !== 'Tümü') {
      const cats = p.categories || [];
      if (
        !cats.includes(activeCategory) &&
        !(activeCategory === 'Dedikodu' && p.is_gossip)
      ) {
        return false;
      }
    }
    if (searchQuery.trim().length >= 2) {
      const q = searchQuery.trim().toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        (p.excerpt || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const featuredPost = filteredPosts[0];
  const restPosts = filteredPosts.slice(1);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-10">
      {/* HEADER */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold uppercase tracking-widest text-white/50">
            <Newspaper className="w-4 h-4 text-white/60" />
            <span>Magazin & Gündem</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Magazin & Dizi Gündemi
          </h1>
          <p className="text-sm text-white/65 max-w-2xl">
            Güney Kore, Çin, Tayland ve Japonya eğlence dünyasındaki en son haberler, dedikodular, oyuncu gelişmeleri ve dizi duyuruları.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => loadMagazine(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full apple-glass-pill text-xs font-bold text-amber-300 hover:text-white border border-amber-400/30 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Canlı Çekiliyor...' : 'Canlı Akışı Yenile'}</span>
          </button>

          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/55 border border-white/15">
            <Search className="w-4 h-4 text-amber-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Haber, oyuncu veya dedikodu ara..."
              className="bg-transparent text-sm text-white placeholder-white/40 focus:outline-none w-56"
            />
          </div>
        </div>
      </div>

      {/* CATEGORY FILTER TABS */}
      <div className="flex flex-wrap items-center gap-2">
        {MAGAZINE_CATEGORIES.map((cat) => {
          const active = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                active
                  ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.4)]'
                  : 'glass-pill text-white/75 hover:text-white'
              }`}
            >
              {cat === 'Dedikodu' && <Flame className="w-3.5 h-3.5" />}
              <span>{cat}</span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-amber-300 animate-pulse">
          Canlı Magazin ve Dedikodu Akışı Çekiliyor...
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
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-transparent lg:hidden" />
              </div>
              <div className="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(featuredPost.categories || ['Magazin']).map((c) => (
                      <span
                        key={c}
                        className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/35"
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
            {restPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/magazin/${post.slug}`}
                className="koup-projection-card rounded-3xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col group"
              >
                <div className="relative h-52 overflow-hidden">
                  <img
                    src={getProxiedImageUrl(post.featured_image)}
                    alt={post.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    {(post.categories || ['Magazin']).slice(0, 2).map((cat) => (
                      <span
                        key={cat}
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/75 backdrop-blur-md text-amber-300 border border-amber-400/30"
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
