'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Heart,
  Share2,
  Newspaper,
  Users,
  Tv,
  ExternalLink,
} from 'lucide-react';
import {
  supabase,
  MagazinePost,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import RichCommentSection from '@/components/RichCommentSection';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import { cachedQuery, invalidateCache } from '@/lib/cache';
import { useKoUp } from '@/context/KoUpContext';

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

export default function MagazineArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const {
    user,
    authLoading,
    likedMagazinePostIds,
    toggleMagazineLike,
    openAuthModal,
    triggerSound,
  } = useKoUp();

  const [post, setPost] = useState<MagazinePost | null>(null);
  const [linkedMedia, setLinkedMedia] = useState<MediaItem[]>([]);
  const [linkedPeople, setLinkedPeople] = useState<PersonItem[]>([]);
  const [morePosts, setMorePosts] = useState<MagazinePost[]>([]);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLiking, setIsLiking] = useState(false);

  // Derived like state with 0ms local hydration
  const isCurrentlyLiked = Boolean(
    post?.id && (likedMagazinePostIds.includes(post.id) || liked)
  );

  // Derived like count: mathematically guaranteed NEVER to show 0 when liked
  const displayLikesCount = Math.max(isCurrentlyLiked ? 1 : 0, likesCount);

  useEffect(() => {
    async function loadArticle() {
      setIsLoading(true);
      const decoded = decodeURIComponent(slug);

      try {
        const article = await cachedQuery(`magazin_post_${decoded}`, 300_000, async () => {
          let art: MagazinePost | null = null;

          // KoreZin yazıları doğrudan canlı API'den veya slug route'tan çözülür
          if (decoded.startsWith('kz-')) {
            try {
              const liveRes = await fetch(`/api/magazin/${encodeURIComponent(decoded)}`);
              if (liveRes.ok) {
                const liveJson = await liveRes.json();
                art = liveJson?.post || null;
              }
            } catch {
              // ignore
            }
          }

          // Supabase veritabanında ara
          if (!art) {
            const { data } = await supabase
              .from('magazine_posts')
              .select('*')
              .eq('slug', decoded)
              .single();

            if (data) {
              art = data as MagazinePost;
            }
          }

          // Hâlâ bulunamadıysa canlı route'a sor (AsyaMag veya genel)
          if (!art) {
            try {
              const liveRes = await fetch(`/api/magazin/${encodeURIComponent(decoded)}`);
              if (liveRes.ok) {
                const liveJson = await liveRes.json();
                art = liveJson?.post || null;
              }
            } catch {
              // ignore
            }
          }

          return art;
        });

        if (!article) {
          setIsLoading(false);
          return;
        }

        setPost(article);
        setLikesCount(article.likes_count || 0);

        // Pre-fill like state if stored in context
        if (likedMagazinePostIds.includes(article.id)) {
          setLiked(true);
        }

        // Load linked media & people
        if (article.related_media_ids?.length > 0) {
          const { data: mRows } = await supabase
            .from('media')
            .select('*')
            .in('id', article.related_media_ids);
          setLinkedMedia((mRows as MediaItem[]) || []);
        }

        if (article.related_person_ids?.length > 0) {
          const { data: pRows } = await supabase
            .from('people')
            .select('*')
            .in('id', article.related_person_ids);
          setLinkedPeople((pRows as PersonItem[]) || []);
        }

        // Canlı akıştan diğer son haberleri çek (KoreZin + AsyaMag hibrit)
        try {
          const moreRes = await fetch('/api/magazin/live?limit=6');
          if (moreRes.ok) {
            const moreJson = await moreRes.json();
            const fetchedList: MagazinePost[] = moreJson?.posts || [];
            const filteredMore = fetchedList.filter((mp) => mp.slug !== decoded).slice(0, 4);
            if (filteredMore.length > 0) {
              setMorePosts(filteredMore);
              return;
            }
          }
        } catch {
          // ignore
        }

        // Yedek: Supabase'den diğer haberleri çek
        const { data: more } = await supabase
          .from('magazine_posts')
          .select('*')
          .neq('slug', decoded)
          .order('published_at', { ascending: false })
          .limit(4);
        setMorePosts((more as MagazinePost[]) || []);
      } finally {
        setIsLoading(false);
      }
    }

    loadArticle();
  }, [slug]);

  // Synchronize initial like state and total like count reactively from DB on mount / auth change
  useEffect(() => {
    if (!post?.id) return;

    if (likedMagazinePostIds.includes(post.id)) {
      setLiked(true);
    }

    let isMounted = true;

    async function syncMagazineLikes() {
      try {
        // Fast path: Check atomic cached counter on magazine_posts row
        const { data: dbPost } = await supabase
          .from('magazine_posts')
          .select('likes_count')
          .eq('id', post!.id)
          .maybeSingle();

        let dbCount = typeof dbPost?.likes_count === 'number' ? dbPost.likes_count : 0;

        if (dbCount === 0) {
          // B-tree indexed count from magazine_likes (0.1ms via idx_magazine_likes_post_id)
          const { count, error: countErr } = await supabase
            .from('magazine_likes')
            .select('*', { count: 'exact', head: true })
            .eq('post_id', post!.id);

          if (!countErr && typeof count === 'number') {
            dbCount = count;
          }
        }

        if (isMounted) {
          setLikesCount((prev) => Math.max(dbCount, prev));
        }

        // Query if current authenticated user has liked this post
        if (user?.id) {
          const { data: likeRow } = await supabase
            .from('magazine_likes')
            .select('post_id')
            .eq('user_id', user.id)
            .eq('post_id', post!.id)
            .maybeSingle();

          if (isMounted && likeRow) {
            setLiked(true);
          }
        } else if (!authLoading) {
          if (isMounted) {
            setLiked(false);
          }
        }
      } catch (err) {
        console.error('Failed to sync magazine likes:', err);
      }
    }

    syncMagazineLikes();

    return () => {
      isMounted = false;
    };
  }, [post?.id, user?.id, authLoading]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <div className="text-sm font-mono text-amber-300 animate-pulse">
          Haber İçeriği Yükleniyor...
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 text-center px-4">
        <h1 className="text-2xl font-bold text-white mb-2">Haber Bulunamadı</h1>
        <p className="text-sm text-white/60 mb-4">Aradığınız haber yayından kaldırılmış veya taşınmış olabilir.</p>
        <Link
          href="/magazin"
          className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs"
        >
          Magazin Merkezine Dön
        </Link>
      </div>
    );
  }

  const isKoreZin =
    post.source_site === 'KoreZin' ||
    post.slug.startsWith('kz-') ||
    post.source_url?.includes('korezin.com');

  return (
    <div className="pt-28 pb-24 max-w-5xl mx-auto px-4 sm:px-8 space-y-10">
      {/* Back Button */}
      <Link
        href="/magazin"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full apple-glass-pill text-xs font-semibold text-white/80 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Magazin & Dedikodu Merkezine Dön</span>
      </Link>

      {/* ARTICLE EDITORIAL HEADER */}
      <article className="rounded-3xl apple-glass p-6 sm:p-10 border border-white/15 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {/* Source Badge */}
          <span
            className={`px-3 py-1 rounded-full text-xs font-mono font-bold border backdrop-blur-md shadow-sm shadow-black/30 ${
              isKoreZin
                ? 'bg-rose-600/85 text-white border-rose-400/50'
                : 'bg-sky-600/85 text-white border-sky-400/50'
            }`}
          >
            {isKoreZin ? 'KoreZin' : 'AsyaMag'}
          </span>

          {(post.categories || ['Magazin']).map((cat) => (
            <span
              key={cat}
              className={`px-3 py-1 rounded-full text-xs font-mono font-bold border backdrop-blur-md ${getMagCategoryColor(cat)}`}
            >
              {cat}
            </span>
          ))}

          <span className="text-xs font-mono text-white/45 flex items-center gap-1.5 ml-auto">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(post.published_at).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </div>

        <h1 className="text-2xl sm:text-4xl font-extrabold text-white leading-tight">
          {post.title}
        </h1>

        {/* Source metadata & original link bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/55 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <span>Editör / Yazar:</span>
            <strong className="text-white/85">
              {post.author_name || (isKoreZin ? 'KoreZin Editör' : 'AsyaMag Editör')}
            </strong>
          </div>
          {post.source_url && (
            <a
              href={post.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-amber-300/80 hover:text-amber-300 transition-colors"
            >
              <span>Orijinal Haberi Görüntüle</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {post.featured_image && (
          <div className="rounded-2xl overflow-hidden border border-white/10 max-h-[480px]">
            <img
              src={getProxiedImageUrl(post.featured_image)}
              alt={post.title}
              loading="eager"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Full In-Site Article Content */}
        <div
          className="koup-article-content pt-2"
          dangerouslySetInnerHTML={{ __html: post.content_html }}
        />

        {/* Tags & Like Bar */}
        <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-1.5">
            {(post.tags || []).slice(0, 8).map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-full text-[11px] bg-white/[0.06] text-white/70 border border-white/10"
              >
                #{tag}
              </span>
            ))}
          </div>

          <button
            type="button"
            disabled={isLiking}
            onClick={async () => {
              if (!user) {
                openAuthModal('Haberi beğenebilmek için lütfen giriş yapın.');
                return;
              }
              if (!post || isLiking) return;
              setIsLiking(true);
              triggerSound('click');

              const willLike = !isCurrentlyLiked;
              setLiked(willLike);
              setLikesCount((prev) => (willLike ? Math.max(1, prev + 1) : Math.max(0, prev - 1)));

              try {
                const success = await toggleMagazineLike(post.id);
                if (success !== willLike) {
                  // Rollback if operation failed
                  setLiked(!willLike);
                  setLikesCount((prev) => (willLike ? Math.max(0, prev - 1) : prev + 1));
                } else {
                  invalidateCache(`magazin_post_${post.slug}`);
                }
              } finally {
                setIsLiking(false);
              }
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold border transition-all cursor-pointer active:scale-95 ${
              isCurrentlyLiked
                ? 'bg-pink-500 border-pink-300 text-white shadow-[0_0_15px_rgba(236,72,153,0.35)]'
                : 'apple-glass-pill text-white hover:bg-white/15'
            } ${isLiking ? 'opacity-85 pointer-events-none' : ''}`}
          >
            <Heart className={`w-4 h-4 ${isCurrentlyLiked ? 'fill-white' : ''}`} />
            <span>Haberi Beğen ({displayLikesCount})</span>
          </button>
        </div>
      </article>

      {/* LINKED ACTORS & DRAMAS IN THIS ARTICLE */}
      {(linkedPeople.length > 0 || linkedMedia.length > 0) && (
        <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/10 space-y-6">
          <h3 className="text-lg font-bold text-white">
            Haberde Geçen Oyuncular & Yapımlar
          </h3>

          {linkedPeople.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {linkedPeople.map((p) => (
                <Link
                  key={p.id}
                  href={`/oyuncu/${p.slug}`}
                  className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/10 border border-white/10"
                >
                  <img
                    src={getProxiedImageUrl(p.image_url)}
                    alt={p.name}
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  <div>
                    <div className="text-xs font-bold text-white">{p.name}</div>
                    <div className="text-[10px] font-mono text-pink-300 flex items-center gap-1 mt-0.5">
                      <Heart className="w-2.5 h-2.5 fill-pink-400 text-pink-400" />
                      <span>{p.favorites_count} Favori</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {linkedMedia.length > 0 && (
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
              {linkedMedia.map((m) => (
                <AccordionMediaCard key={m.id} item={m} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* MORE ARTICLES */}
      {morePosts.length > 0 && (
        <section>
          <h3 className="text-lg font-bold text-white mb-4">
            Diğer Dedikodu & Güncel Haberler
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {morePosts.map((mp) => {
              const mpIsKoreZin =
                mp.source_site === 'KoreZin' ||
                mp.slug.startsWith('kz-') ||
                mp.source_url?.includes('korezin.com');

              return (
                <Link
                  key={mp.slug}
                  href={`/magazin/${mp.slug}`}
                  className="p-4 rounded-2xl bg-[#121216] border border-white/10 hover:border-amber-400/40 transition-all flex items-center gap-3.5"
                >
                  <img
                    src={getProxiedImageUrl(mp.featured_image)}
                    alt={mp.title}
                    width={80}
                    height={80}
                    loading="lazy"
                    decoding="async"
                    className="w-20 h-20 rounded-xl object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                          mpIsKoreZin
                            ? 'text-rose-300 bg-rose-500/20 border-rose-400/30'
                            : 'text-sky-300 bg-sky-500/20 border-sky-400/30'
                        }`}
                      >
                        {mpIsKoreZin ? 'KoreZin' : 'AsyaMag'}
                      </span>
                      <span className="text-[10px] font-mono text-amber-300">
                        {(mp.categories || ['Magazin'])[0]}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-white line-clamp-2 mt-1">
                      {mp.title}
                    </h4>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* IN-SITE MAGAZINE COMMENTS */}
      <RichCommentSection
        targetType="magazine"
        magazineId={post.id}
        targetTitle={post.title}
      />
    </div>
  );
}
