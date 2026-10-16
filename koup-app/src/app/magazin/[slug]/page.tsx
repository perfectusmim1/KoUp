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

export default function MagazineArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [post, setPost] = useState<MagazinePost | null>(null);
  const [linkedMedia, setLinkedMedia] = useState<MediaItem[]>([]);
  const [linkedPeople, setLinkedPeople] = useState<PersonItem[]>([]);
  const [morePosts, setMorePosts] = useState<MagazinePost[]>([]);
  const [liked, setLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadArticle() {
      setIsLoading(true);
      const decoded = decodeURIComponent(slug);

      let article: MagazinePost | null = null;
      const { data } = await supabase
        .from('magazine_posts')
        .select('*')
        .eq('slug', decoded)
        .single();

      if (data) {
        article = data as MagazinePost;
      } else {
        try {
          const liveRes = await fetch(`/api/magazin/${encodeURIComponent(decoded)}`);
          if (liveRes.ok) {
            const liveJson = await liveRes.json();
            article = liveJson?.post || null;
          }
        } catch {
          // ignore
        }
      }

      if (!article) {
        setIsLoading(false);
        return;
      }

      setPost(article);

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

      // Load more articles
      const { data: more } = await supabase
        .from('magazine_posts')
        .select('*')
        .neq('id', article.id)
        .order('published_at', { ascending: false })
        .limit(4);
      setMorePosts((more as MagazinePost[]) || []);

      setIsLoading(false);
    }

    loadArticle();
  }, [slug]);

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
        <Link
          href="/magazin"
          className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs mt-4"
        >
          Magazin Merkezine Dön
        </Link>
      </div>
    );
  }

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
          {(post.categories || ['Magazin']).map((cat) => (
            <span
              key={cat}
              className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/35"
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

        {post.featured_image && (
          <div className="rounded-2xl overflow-hidden border border-white/10 max-h-[480px]">
            <img
              src={getProxiedImageUrl(post.featured_image)}
              alt={post.title}
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
            onClick={() => setLiked((v) => !v)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
              liked
                ? 'bg-pink-500 border-pink-300 text-white'
                : 'apple-glass-pill text-white hover:bg-white/15'
            }`}
          >
            <Heart className={`w-4 h-4 ${liked ? 'fill-white' : ''}`} />
            <span>Haberi Beğen ({(post.likes_count || 18) + (liked ? 1 : 0)})</span>
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
            Diğer Dedikodu & Haberler
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {morePosts.map((mp) => (
              <Link
                key={mp.id}
                href={`/magazin/${mp.slug}`}
                className="p-4 rounded-2xl bg-[#121216] border border-white/10 hover:border-amber-400/40 transition-all flex items-center gap-3.5"
              >
                <img
                  src={getProxiedImageUrl(mp.featured_image)}
                  alt={mp.title}
                  className="w-20 h-20 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-amber-300">
                    {(mp.categories || ['Magazin'])[0]}
                  </span>
                  <h4 className="text-xs font-bold text-white line-clamp-2 mt-0.5">
                    {mp.title}
                  </h4>
                </div>
              </Link>
            ))}
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
