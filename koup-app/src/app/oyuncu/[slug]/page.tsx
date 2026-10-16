'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  Heart,
  Bell,
  ExternalLink,
  Film,
  Users,
  Newspaper,
  Sparkles,
  Award,
} from 'lucide-react';
import {
  supabase,
  PersonItem,
  CastMember,
  MagazinePost,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import RichCommentSection from '@/components/RichCommentSection';

export default function PersonDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const {
    favPersonIds,
    followedPersonIds,
    togglePersonFavorite,
    togglePersonFollow,
  } = useKoUp();

  const [person, setPerson] = useState<PersonItem | null>(null);
  const [credits, setCredits] = useState<CastMember[]>([]);
  const [coStars, setCoStars] = useState<PersonItem[]>([]);
  const [relatedNews, setRelatedNews] = useState<MagazinePost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadPerson() {
      setIsLoading(true);
      const decoded = decodeURIComponent(slug);

      let { data: pData } = await supabase
        .from('people')
        .select('*')
        .eq('slug', decoded)
        .single();

      if (!pData && !Number.isNaN(Number(decoded))) {
        const byId = await supabase
          .from('people')
          .select('*')
          .eq('id', Number(decoded))
          .single();
        pData = byId.data;
      }

      if (!pData) {
        setIsLoading(false);
        return;
      }

      const item = pData as PersonItem;
      setPerson(item);

      // Fetch all dramas/anime/movies this person or character appears in
      const { data: castRows } = await supabase
        .from('media_cast')
        .select('*, media(*)')
        .eq('person_id', item.id)
        .limit(40);

      const validCredits = ((castRows as CastMember[]) || []).filter(
        (c) => c.media
      );
      setCredits(validCredits);

      // Build Actor Relationship Network (Co-Stars in same dramas)
      const mediaIds = validCredits.map((c) => c.media_id).slice(0, 10);
      if (mediaIds.length > 0) {
        const { data: coRows } = await supabase
          .from('media_cast')
          .select('people(*)')
          .in('media_id', mediaIds)
          .neq('person_id', item.id)
          .limit(12);

        const uniquePeers = new Map<number, PersonItem>();
        for (const r of (coRows as unknown as Array<{ people: PersonItem }>) || []) {
          if (r.people && !uniquePeers.has(r.people.id)) {
            uniquePeers.set(r.people.id, r.people);
          }
        }
        setCoStars(Array.from(uniquePeers.values()).slice(0, 8));
      }

      // Fetch related AsyaMag news/gossip
      const { data: magRows } = await supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(3);
      setRelatedNews((magRows as MagazinePost[]) || []);

      setIsLoading(false);
    }

    loadPerson();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <div className="text-sm font-mono text-sky-400 animate-pulse">
          Oyuncu / Karakter Profili ve İlişki Ağı Yükleniyor...
        </div>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 text-center px-4">
        <h1 className="text-2xl font-bold text-white mb-2">
          Oyuncu veya Karakter Bulunamadı
        </h1>
        <Link
          href="/oyuncular"
          className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs mt-4"
        >
          Oyuncular Sıralamasına Dön
        </Link>
      </div>
    );
  }

  const isFav = favPersonIds.includes(person.id);
  const isFollowed = followedPersonIds.includes(person.id);
  const totalFavs = person.favorites_count + (isFav ? 1 : 0);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-12">
      {/* 1. ACTOR / CHARACTER HERO PROFILE CARD */}
      <div className="rounded-3xl apple-glass p-6 sm:p-10 border border-white/15 flex flex-col md:flex-row gap-8 items-center md:items-start">
        <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-3xl overflow-hidden border-2 border-white/15 shadow-2xl shrink-0">
          <img
            src={getProxiedImageUrl(person.image_url)}
            alt={person.name}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-1 text-center md:text-left space-y-4">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-sky-400/20 text-sky-300 border border-sky-400/35">
              {person.person_type === 'character'
                ? '🎌 Anime Karakteri (AniList)'
                : person.person_type === 'seiyuu'
                ? '🎙️ Japonca Seslendirmen (Seiyuu)'
                : '🎬 Dizi & Sinema Oyuncusu (MDL)'}
            </span>

            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-pink-500/20 text-pink-300 border border-pink-400/35">
              ❤️ {totalFavs.toLocaleString('tr-TR')} Favori
            </span>

            <span className="px-3 py-1 rounded-full text-xs font-mono bg-amber-400/15 text-amber-300 border border-amber-400/30">
              ★ Ortalama Puan: {person.avg_rating || 8.6}
            </span>
          </div>

          <div>
            <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              {person.name}
            </h1>
            {person.native_name && (
              <div className="text-base text-white/55 mt-1">{person.native_name}</div>
            )}
          </div>

          <p className="text-sm sm:text-base text-white/80 leading-relaxed max-w-3xl">
            {person.bio_tr ||
              `${person.name}, KoUp arşivindeki yapımlarda öne çıkan ve izleyiciler tarafından en çok favorilenen isimlerden biridir.`}
          </p>

          {/* Action Buttons: Favorite (Heart), Follow (Bell), External MDL / AniList Link */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
            <button
              onClick={() => togglePersonFavorite(person.id, person.name)}
              className={`flex items-center gap-2 px-6 py-3 rounded-full text-xs font-bold transition-all cursor-pointer ${
                isFav
                  ? 'bg-pink-500 text-white shadow-[0_0_25px_rgba(236,72,153,0.5)]'
                  : 'bg-white text-black hover:scale-105'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFav ? 'fill-white' : 'fill-black'}`} />
              <span>
                {isFav
                  ? `Favorilendi (${totalFavs.toLocaleString('tr-TR')})`
                  : `Favorilere Ekle (${totalFavs.toLocaleString('tr-TR')})`}
              </span>
            </button>

            <button
              onClick={() => togglePersonFollow(person.id, person.name)}
              className={`flex items-center gap-2 px-5 py-3 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                isFollowed
                  ? 'bg-sky-400/20 border-sky-400 text-sky-300'
                  : 'apple-glass-pill text-white hover:bg-white/15'
              }`}
            >
              <Bell className="w-4 h-4" />
              <span>
                {isFollowed ? 'Takip Ediliyor (Bildirim Açık)' : '+ Takip Et'}
              </span>
            </button>

            {person.mydramalist_url && (
              <a
                href={person.mydramalist_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-3 rounded-full bg-[#E5A93C]/20 border border-[#E5A93C]/45 text-[#E5A93C] text-xs font-mono font-bold"
              >
                <span>MyDramaList Profili</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {person.profile_url && person.profile_url.includes('anilist.co') && (
              <a
                href={person.profile_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-4 py-3 rounded-full bg-[#38BDF8]/20 border border-[#38BDF8]/45 text-[#38BDF8] text-xs font-mono font-bold"
              >
                <span>AniList Sayfası</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* 2. FILMOGRAPHY / ANIME APPEARANCES */}
      {credits.length > 0 && (
        <section>
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-sky-400">
              Filmografi & Karakter Bağlantıları
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Film className="w-5 h-5 text-sky-400" />
              <span>Yer Aldığı Yapımlar ({credits.length})</span>
            </h2>
          </div>

          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {credits.map((c) =>
              c.media ? (
                <AccordionMediaCard key={c.media.id} item={c.media} />
              ) : null
            )}
          </div>
        </section>
      )}

      {/* 3. ACTOR RELATIONSHIP NETWORK (FREQUENT CO-STARS / PARTNERS) */}
      {coStars.length > 0 && (
        <section>
          <div className="mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-300">
              İlişkisel Ağ · Ortak Kadro Bağlantıları
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-300" />
              <span>Birlikte Rol Aldığı Oyuncular & Karakterler</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3.5">
            {coStars.map((peer) => (
              <Link
                key={peer.id}
                href={`/oyuncu/${peer.slug}`}
                className="koup-projection-card rounded-2xl p-3 bg-[#121216] border border-white/[0.08] text-center group"
              >
                <img
                  src={getProxiedImageUrl(peer.image_url)}
                  alt={peer.name}
                  loading="lazy"
                  className="w-16 h-16 rounded-full object-cover mx-auto mb-2 border border-white/15 group-hover:border-sky-400"
                />
                <div className="text-xs font-bold text-white truncate">
                  {peer.name}
                </div>
                <div className="text-[10px] font-mono text-pink-300 mt-0.5">
                  ❤️ {peer.favorites_count}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 4. RELATED ASYAMAG NEWS & GOSSIP */}
      {relatedNews.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-amber-300" />
            <span>AsyaMag Magazin & Dedikodu Gündemi</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {relatedNews.map((post) => (
              <Link
                key={post.id}
                href={`/magazin/${post.slug}`}
                className="p-4 rounded-2xl bg-[#121216] border border-white/10 hover:border-amber-400/40 transition-all flex gap-3.5 items-center"
              >
                <img
                  src={getProxiedImageUrl(post.featured_image)}
                  alt={post.title}
                  loading="lazy"
                  className="w-20 h-20 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <span className="text-[10px] font-mono text-amber-300">
                    {(post.categories || ['Dedikodu'])[0]}
                  </span>
                  <h4 className="text-xs font-bold text-white line-clamp-2 mt-0.5">
                    {post.title}
                  </h4>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 5. ACTOR & ANIME CHARACTER RICH COMMENTS */}
      <RichCommentSection
        targetType="person"
        personId={person.id}
        targetTitle={person.name}
      />
    </div>
  );
}
