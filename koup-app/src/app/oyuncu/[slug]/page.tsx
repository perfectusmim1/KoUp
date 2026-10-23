'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  Heart,
  Bell,
  Film,
  Users,
  Sparkles,
  Award,
  Newspaper,
  ChevronLeft,
  ChevronRight,
  Calendar,
  MapPin,
  User,
  Globe,
  Activity,
} from 'lucide-react';
import {
  supabase,
  PersonItem,
  CastMember,
  MagazinePost,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { cachedQuery, setCache, invalidateCache } from '@/lib/cache';
import { useKoUpSelector } from '@/context/KoUpContext';
import AccordionMediaCard, { requestAccordionHover, preloadMediaImages } from '@/components/AccordionMediaCard';
import { useDragScroll } from '@/hooks/useDragScroll';
import RichCommentSection from '@/components/RichCommentSection';

interface PersonBundle {
  person: PersonItem | null;
  credits: CastMember[];
  coStars: PersonItem[];
}

function formatBirthDate(birthDateStr?: string | null, deathDateStr?: string | null): { formatted: string; ageText: string } | null {
  if (!birthDateStr) return null;
  const d = new Date(birthDateStr);
  if (isNaN(d.getTime())) return null;

  const formatted = d.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const endDate = deathDateStr ? new Date(deathDateStr) : new Date();
  let age = endDate.getFullYear() - d.getFullYear();
  const m = endDate.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && endDate.getDate() < d.getDate())) {
    age--;
  }

  const ageText = deathDateStr ? `${age} yaşında vefat etti` : `${age} yaşında`;
  return { formatted, ageText };
}

function getCountryFlag(code?: string | null): string {
  if (!code) return '🌐';
  const c = code.toUpperCase();
  if (c === 'KR') return '🇰🇷';
  if (c === 'JP') return '🇯🇵';
  if (c === 'CN') return '🇨🇳';
  if (c === 'TW') return '🇹🇼';
  if (c === 'TH') return '🇹🇭';
  if (c === 'TR') return '🇹🇷';
  if (c === 'US') return '🇺🇸';
  if (c === 'GB') return '🇬🇧';
  if (c === 'FR') return '🇫🇷';
  if (c === 'DE') return '🇩🇪';
  if (c === 'ES') return '🇪🇸';
  if (c === 'IT') return '🇮🇹';
  if (c === 'PH') return '🇵🇭';
  if (c === 'IN') return '🇮🇳';
  if (c === 'HK') return '🇭🇰';
  return '🌐';
}

interface ResolvedActorCountry {
  countryCode: string;
  countryName: string;
  flag: string;
  displayPlace: string;
}

function resolveActorNationality(
  person: PersonItem | null,
  credits: CastMember[] = []
): ResolvedActorCountry {
  const rawPlace = (person?.place_of_birth || '').trim();
  const lowPlace = rawPlace.toLowerCase();
  const rawCode = (person?.country_code || '').trim().toUpperCase();

  // 1. Textual detection from place_of_birth
  const isChina =
    lowPlace.includes('çin') ||
    lowPlace.includes('china') ||
    lowPlace.includes('sichuan') ||
    lowPlace.includes('chongqing') ||
    lowPlace.includes('beijing') ||
    lowPlace.includes('shanghai') ||
    lowPlace.includes('guangdong') ||
    lowPlace.includes('zhejiang') ||
    lowPlace.includes('hunan') ||
    lowPlace.includes('hubei') ||
    lowPlace.includes('liaoning') ||
    lowPlace.includes('shandong') ||
    lowPlace.includes('henan') ||
    lowPlace.includes('hebei') ||
    lowPlace.includes('tianjin') ||
    lowPlace.includes('fujian') ||
    lowPlace.includes('guangxi') ||
    lowPlace.includes('yunnan') ||
    lowPlace.includes('harbin') ||
    lowPlace.includes('wuhan') ||
    lowPlace.includes('chengdu') ||
    lowPlace.includes('guangzhou') ||
    lowPlace.includes('shenzhen') ||
    lowPlace.includes('dongguan') ||
    lowPlace.includes('jiangsu') ||
    lowPlace.includes('anhui') ||
    lowPlace.includes('jiangxi') ||
    lowPlace.includes('shanxi') ||
    lowPlace.includes('shaanxi');

  const isTaiwan = lowPlace.includes('taiwan') || lowPlace.includes('tayvan') || lowPlace.includes('taipei');
  const isHongKong = lowPlace.includes('hong kong') || lowPlace.includes('hongkong');
  const isJapan =
    lowPlace.includes('japon') ||
    lowPlace.includes('japan') ||
    lowPlace.includes('tokyo') ||
    lowPlace.includes('osaka') ||
    lowPlace.includes('kyoto') ||
    lowPlace.includes('hokkaido') ||
    lowPlace.includes('fukuoka') ||
    lowPlace.includes('kanagawa') ||
    lowPlace.includes('nagoya') ||
    lowPlace.includes('saitama') ||
    lowPlace.includes('chiba') ||
    lowPlace.includes('hyogo');

  const isThailand = lowPlace.includes('tayland') || lowPlace.includes('thailand') || lowPlace.includes('bangkok') || lowPlace.includes('chiang mai') || lowPlace.includes('phuket');
  const isKorea = lowPlace.includes('kore') || lowPlace.includes('korea') || lowPlace.includes('seoul') || lowPlace.includes('busan') || lowPlace.includes('incheon') || lowPlace.includes('daegu') || lowPlace.includes('daejeon') || lowPlace.includes('gwangju') || lowPlace.includes('ulsan') || lowPlace.includes('gyeonggi') || lowPlace.includes('gangwon');
  const isTurkey = lowPlace.includes('türkiye') || lowPlace.includes('turkey') || lowPlace.includes('istanbul') || lowPlace.includes('ankara') || lowPlace.includes('izmir');
  const isUSA = lowPlace.includes('amerika') || lowPlace.includes('united states') || lowPlace.includes('usa') || lowPlace.includes('california') || lowPlace.includes('new york') || lowPlace.includes('los angeles');
  const isUK = lowPlace.includes('ingiltere') || lowPlace.includes('united kingdom') || lowPlace.includes('uk') || lowPlace.includes('england') || lowPlace.includes('london');

  if (isChina) return { countryCode: 'CN', countryName: 'Çin', flag: '🇨🇳', displayPlace: rawPlace || 'Çin' };
  if (isTaiwan) return { countryCode: 'TW', countryName: 'Tayvan', flag: '🇹🇼', displayPlace: rawPlace || 'Tayvan' };
  if (isHongKong) return { countryCode: 'HK', countryName: 'Hong Kong', flag: '🇭🇰', displayPlace: rawPlace || 'Hong Kong' };
  if (isJapan) return { countryCode: 'JP', countryName: 'Japonya', flag: '🇯🇵', displayPlace: rawPlace || 'Japonya' };
  if (isThailand) return { countryCode: 'TH', countryName: 'Tayland', flag: '🇹🇭', displayPlace: rawPlace || 'Tayland' };
  if (isTurkey) return { countryCode: 'TR', countryName: 'Türkiye', flag: '🇹🇷', displayPlace: rawPlace || 'Türkiye' };
  if (isUSA) return { countryCode: 'US', countryName: 'Amerika Birleşik Devletleri', flag: '🇺🇸', displayPlace: rawPlace || 'ABD' };
  if (isUK) return { countryCode: 'GB', countryName: 'Birleşik Krallık', flag: '🇬🇧', displayPlace: rawPlace || 'Birleşik Krallık' };
  if (isKorea) return { countryCode: 'KR', countryName: 'Güney Kore', flag: '🇰🇷', displayPlace: rawPlace || 'Güney Kore' };

  // 2. Filmography credits tally
  if (credits && credits.length > 0) {
    const tally: Record<string, number> = {};
    for (const c of credits) {
      const cc = c.media?.country_code?.toUpperCase();
      if (cc) tally[cc] = (tally[cc] || 0) + 1;
    }
    const totalCredits = credits.length;
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [topCountry, topCount] = sorted[0];
      if (topCount / totalCredits >= 0.45 || sorted.length === 1) {
        if (topCountry === 'CN') return { countryCode: 'CN', countryName: 'Çin', flag: '🇨🇳', displayPlace: rawPlace || 'Çin' };
        if (topCountry === 'JP') return { countryCode: 'JP', countryName: 'Japonya', flag: '🇯🇵', displayPlace: rawPlace || 'Japonya' };
        if (topCountry === 'TW') return { countryCode: 'TW', countryName: 'Tayvan', flag: '🇹🇼', displayPlace: rawPlace || 'Tayvan' };
        if (topCountry === 'TH') return { countryCode: 'TH', countryName: 'Tayland', flag: '🇹🇭', displayPlace: rawPlace || 'Tayland' };
        if (topCountry === 'TR') return { countryCode: 'TR', countryName: 'Türkiye', flag: '🇹🇷', displayPlace: rawPlace || 'Türkiye' };
        if (topCountry === 'US') return { countryCode: 'US', countryName: 'ABD', flag: '🇺🇸', displayPlace: rawPlace || 'ABD' };
        if (topCountry === 'KR') return { countryCode: 'KR', countryName: 'Güney Kore', flag: '🇰🇷', displayPlace: rawPlace || 'Güney Kore' };
      }
    }
  }

  // 3. Fallback
  if (rawCode === 'CN') return { countryCode: 'CN', countryName: 'Çin', flag: '🇨🇳', displayPlace: rawPlace || 'Çin' };
  if (rawCode === 'JP') return { countryCode: 'JP', countryName: 'Japonya', flag: '🇯🇵', displayPlace: rawPlace || 'Japonya' };
  if (rawCode === 'TW') return { countryCode: 'TW', countryName: 'Tayvan', flag: '🇹🇼', displayPlace: rawPlace || 'Tayvan' };
  if (rawCode === 'TH') return { countryCode: 'TH', countryName: 'Tayland', flag: '🇹🇭', displayPlace: rawPlace || 'Tayland' };
  if (rawCode === 'TR') return { countryCode: 'TR', countryName: 'Türkiye', flag: '🇹🇷', displayPlace: rawPlace || 'Türkiye' };
  if (rawCode === 'US') return { countryCode: 'US', countryName: 'ABD', flag: '🇺🇸', displayPlace: rawPlace || 'ABD' };
  if (rawCode === 'GB') return { countryCode: 'GB', countryName: 'Birleşik Krallık', flag: '🇬🇧', displayPlace: rawPlace || 'Birleşik Krallık' };
  if (rawCode === 'KR') return { countryCode: 'KR', countryName: 'Güney Kore', flag: '🇰🇷', displayPlace: rawPlace || 'Güney Kore' };

  return {
    countryCode: rawCode || 'KR',
    countryName: rawCode === 'KR' ? 'Güney Kore' : rawCode || 'Bilinmiyor',
    flag: getCountryFlag(rawCode || 'KR'),
    displayPlace: rawPlace || (rawCode === 'KR' ? 'Güney Kore' : rawCode || 'Bilinmiyor'),
  };
}

export default function PersonDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const favPersonIds = useKoUpSelector((s) => s.favPersonIds);
  const followedPersonIds = useKoUpSelector((s) => s.followedPersonIds);
  const togglePersonFavorite = useKoUpSelector((s) => s.togglePersonFavorite);
  const togglePersonFollow = useKoUpSelector((s) => s.togglePersonFollow);

  const [person, setPerson] = useState<PersonItem | null>(null);
  const [credits, setCredits] = useState<CastMember[]>([]);
  const [coStars, setCoStars] = useState<PersonItem[]>([]);
  const [magazinePosts, setMagazinePosts] = useState<MagazinePost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const creditsScrollRef = useDragScroll<HTMLDivElement>();

  useEffect(() => {
    let isCancelled = false;

    async function loadPerson() {
      setIsLoading(true);
      const decoded = decodeURIComponent(slug);
      const cleanSlug = decoded.replace(/-\d+$/, '').trim().toLowerCase();

      try {
        const bundle = await cachedQuery<PersonBundle>(
          `person_v6_${cleanSlug}`,
          60_000, // 1 minute TTL for instant hydration + fresh actor sync
          async () => {
            let { data: pData } = await supabase
              .from('people')
              .select('*')
              .eq('slug', decoded)
              .maybeSingle();

            if (!pData && cleanSlug !== decoded) {
              const byClean = await supabase
                .from('people')
                .select('*')
                .eq('slug', cleanSlug)
                .maybeSingle();
              pData = byClean.data;
            }

            if (!pData && !Number.isNaN(Number(decoded))) {
              const byId = await supabase
                .from('people')
                .select('*')
                .eq('id', Number(decoded))
                .maybeSingle();
              pData = byId.data;
            }

            // Universal name fallback
            if (!pData) {
              const nameGuess = cleanSlug.replace(/-/g, ' ');
              const byName = await supabase
                .from('people')
                .select('*')
                .ilike('name', nameGuess)
                .limit(1)
                .maybeSingle();
              if (byName.data) {
                pData = byName.data;
              }
            }

            if (!pData) {
              return { person: null, credits: [], coStars: [] };
            }

            let item = pData as PersonItem;

            const isMissingDetails =
              !item.gender ||
              !item.birth_date ||
              !item.place_of_birth ||
              !item.bio_tr ||
              item.bio_tr.includes('KoUp arşivinde') ||
              item.bio_tr.includes('önde gelen oyuncularından biridir') ||
              item.bio_tr.length < 40;

            // Fetch cast appearances and enriched bio details in PARALLEL!
            const [castRowsRes, bioRes] = await Promise.all([
              supabase
                .from('media_cast')
                .select('*, media(*)')
                .eq('person_id', item.id)
                .limit(40),
              isMissingDetails
                ? fetch(
                    `/api/person/bio?id=${item.id}&name=${encodeURIComponent(item.name)}&type=${item.person_type || 'actor'}`
                  )
                    .then((r) => r.json())
                    .catch(() => null)
                    : Promise.resolve(null),
            ]);

            if (bioRes?.success && bioRes?.person) {
              item = { ...item, ...bioRes.person };
            } else if (bioRes?.success && bioRes?.bio_tr) {
              item = { ...item, bio_tr: bioRes.bio_tr };
            }

            const castRows = castRowsRes?.data;

            const validCredits = ((castRows as CastMember[]) || [])
              .filter((c) => c.media)
              .sort((a, b) => {
                const yearA = a.media?.release_year || 0;
                const yearB = b.media?.release_year || 0;
                return yearB - yearA;
              });

            // Fetch co-star peer connections
            const mediaIds = validCredits.map((c) => c.media_id).slice(0, 10);
            let peers: PersonItem[] = [];

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
              peers = Array.from(uniquePeers.values()).slice(0, 8);
            }

            return {
              person: item,
              credits: validCredits,
              coStars: peers,
            };
          },
          (fresh) => {
            if (!isCancelled && fresh?.person) {
              setPerson(fresh.person);
              setCredits(fresh.credits);
              setCoStars(fresh.coStars);
            }
          }
        );

        if (isCancelled) return;

        if (typeof window !== 'undefined' && bundle.person?.slug && bundle.person.slug !== decoded) {
          window.history.replaceState(null, '', `/oyuncu/${bundle.person.slug}${window.location.search}`);
        }

        setPerson(bundle.person);
        setCredits(bundle.credits);
        setCoStars(bundle.coStars);
      } catch (err) {
        console.error('Error loading person profile:', err);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadPerson();

    return () => {
      isCancelled = true;
    };
  }, [slug]);

  // Dynamic document title
  useEffect(() => {
    if (person?.name) {
      document.title = `${person.name} • Filmografi & Profil • KoUp`;
    }
  }, [person?.name]);

  // Fetch enriched / translated biography & complete metadata (gender, birth, country, etc.)
  useEffect(() => {
    if (!person?.name) return;
    const isMissingDetails =
      !person.gender ||
      !person.birth_date ||
      !person.place_of_birth ||
      !person.bio_tr ||
      person.bio_tr.includes('KoUp arşivinde') ||
      person.bio_tr.includes('önde gelen oyuncularından biridir') ||
      person.bio_tr.length < 40;

    if (isMissingDetails) {
      fetch(
        `/api/person/bio?id=${person.id}&name=${encodeURIComponent(person.name)}&type=${person.person_type || 'actor'}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data?.success && data?.person) {
            setPerson((prev) => {
              if (!prev) return prev;
              const merged = { ...prev, ...data.person };
              setCache(`person_${slug}`, { person: merged, credits, coStars }, 86_400_000);
              return merged;
            });
          } else if (data?.success && data?.bio_tr) {
            setPerson((prev) => {
              if (!prev) return prev;
              const merged = { ...prev, bio_tr: data.bio_tr };
              setCache(`person_${slug}`, { person: merged, credits, coStars }, 86_400_000);
              return merged;
            });
          }
        })
        .catch(() => {});
    }
  }, [person?.id, person?.name, person?.person_type, person?.birth_date, person?.gender]);

  // Fetch related AsyaMag magazine news & gossip for actor
  useEffect(() => {
    if (!person?.name) return;
    const actorSlug = person.slug ? encodeURIComponent(person.slug) : '';
    fetch(`/api/magazin/actor?name=${encodeURIComponent(person.name)}&id=${person.id}&slug=${actorSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.posts)) {
          setMagazinePosts(data.posts);
        }
      })
      .catch(() => {});
  }, [person?.id, person?.name, person?.slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 bg-[#080808]">
        <div className="text-sm font-mono text-sky-400 animate-pulse flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>Oyuncu / Karakter Profili ve İlişki Ağı Yükleniyor...</span>
        </div>
      </div>
    );
  }

  if (!person) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 text-center px-4 bg-[#080808]">
        <h1 className="text-2xl font-bold text-white mb-2">
          Oyuncu veya Karakter Bulunamadı
        </h1>
        <p className="text-sm text-white/60 mb-6">
          Aradığınız sanatçı arşive henüz eklenmemiş olabilir.
        </p>
        <Link
          href="/oyuncular"
          className="px-6 py-3 rounded-full bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 transition-colors shadow-lg"
        >
          Oyuncular Sıralamasına Dön
        </Link>
      </div>
    );
  }

  const isFav = favPersonIds.includes(person.id);
  const isFollowed = followedPersonIds.includes(person.id);
  const totalFavs = Math.max(person.favorites_count || 0, isFav ? 1 : 0);

  const handleToggleFavorite = async () => {
    if (!person) return;
    const willBeFav = !isFav;
    const nextCount = Math.max(0, (person.favorites_count || 0) + (willBeFav ? 1 : -1));
    setPerson((prev) =>
      prev
        ? {
            ...prev,
            favorites_count: nextCount,
          }
        : prev
    );
    try {
      invalidateCache(`person_${slug}`);
      invalidateCache(`person_${decodeURIComponent(slug)}`);
      invalidateCache(`person_${person.id}`);
      invalidateCache('top_people_');
      invalidateCache('people_');
    } catch {}
    await togglePersonFavorite(person.id, person.name);
  };

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-12 bg-[#080808] text-white">
      {/* 1. ACTOR / CHARACTER HERO PROFILE CARD */}
      <div className="rounded-3xl apple-glass p-6 sm:p-10 border border-white/15 flex flex-col md:flex-row gap-8 items-center md:items-start">
        <div className="w-44 h-44 sm:w-56 sm:h-56 rounded-3xl overflow-hidden border-2 border-white/15 shadow-2xl shrink-0">
          <img
            src={getProxiedImageUrl(person.image_url, person.name, null, 'original', 'person', person.tmdb_id)}
            alt={person.name}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="flex-1 text-center md:text-left space-y-4">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-white/[0.08] text-white border border-white/15">
              <Sparkles className="w-3.5 h-3.5 text-white/80" />
              <span>
                {person.person_type === 'character'
                  ? 'Anime Karakteri'
                  : person.person_type === 'seiyuu'
                    ? 'Japonca Seslendirmen (Seiyuu)'
                    : 'Dizi & Sinema Oyuncusu'}
              </span>
            </span>

            {totalFavs > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-400/30">
                <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                <span>{totalFavs} Favori</span>
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono bg-white/10 text-white/90 border border-white/15">
              <Film className="w-3.5 h-3.5 text-white/70" />
              <span>{credits.length} Yapımda Rol Aldı</span>
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
              `${person.name}, KoUp arşivindeki ${credits.length} yapımda yer almaktadır.`}
          </p>

          {/* DETAILED ACTOR / CHARACTER METADATA SPECS BAR */}
          {(person.gender || person.birth_date || person.place_of_birth || person.country_code || (person.also_known_as && person.also_known_as.length > 0) || person.blood_type) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 pt-1 max-w-3xl text-left">
              {person.gender && (
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                  <User className="w-4 h-4 text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Cinsiyet</div>
                    <div className="text-xs font-semibold text-white/90 truncate">{person.gender}</div>
                  </div>
                </div>
              )}

              {formatBirthDate(person.birth_date, person.death_date) && (
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Doğum & Yaş</div>
                    <div className="text-xs font-semibold text-white/90">
                      <div>{formatBirthDate(person.birth_date, person.death_date)?.formatted}</div>
                      <span className="text-[10px] text-emerald-400 font-mono font-bold">
                        {formatBirthDate(person.birth_date, person.death_date)?.ageText}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {person.death_date && (
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-rose-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Vefat Tarihi</div>
                    <div className="text-xs font-semibold text-rose-300">
                      {new Date(person.death_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                  </div>
                </div>
              )}

              {(() => {
                const nat = resolveActorNationality(person, credits);
                return (
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                    <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Ülke / Doğum Yeri</div>
                      <div className="text-xs font-semibold text-white/90 flex items-center gap-1.5 truncate">
                        <span>{nat.flag}</span>
                        <span className="truncate">{nat.displayPlace}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {person.blood_type && (
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-red-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Kan Grubu</div>
                    <div className="text-xs font-semibold text-white/90">{person.blood_type}</div>
                  </div>
                </div>
              )}

              {person.also_known_as && person.also_known_as.length > 0 && (
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
                  <Globe className="w-4 h-4 text-purple-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Diğer İsimleri</div>
                    <div className="text-xs font-semibold text-white/80 truncate">
                      {person.also_known_as.slice(0, 2).join(', ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons: Favorite (Heart), Follow (Bell) */}
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
            <button
              onClick={handleToggleFavorite}
              className={`flex items-center gap-2 px-6 py-3 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                isFav
                  ? 'bg-pink-500 hover:bg-pink-400 text-white shadow-[0_0_20px_rgba(236,72,153,0.45)] hover:shadow-[0_0_30px_rgba(236,72,153,0.7)] active:scale-[0.98]'
                  : 'bg-white text-black hover:bg-white/90 active:scale-[0.98]'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFav ? 'fill-white' : 'fill-black'}`} />
              <span>{isFav ? 'Favorilerimde' : 'Favorilere Ekle'}</span>
            </button>

            <button
              onClick={() => togglePersonFollow(person.id, person.name)}
              className={`flex items-center gap-2 px-5 py-3 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                isFollowed
                  ? 'bg-sky-400/20 hover:bg-sky-400/35 border-sky-400 hover:border-sky-300 text-sky-300 hover:text-sky-200 shadow-[0_0_15px_rgba(56,189,248,0.3)] hover:shadow-[0_0_25px_rgba(56,189,248,0.5)]'
                  : 'apple-glass-pill text-white hover:bg-white/15'
              }`}
            >
              <Bell className="w-4 h-4" />
              <span>
                {isFollowed ? 'Takip Ediliyor (Bildirim Açık)' : 'Takip Et'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. FILMOGRAPHY / ANIME APPEARANCES */}
      {credits.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <Film className="w-5 h-5 text-sky-400" />
                <span>Yer Aldığı Yapımlar ({credits.length})</span>
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  creditsScrollRef.current?.scrollBy({ left: -560, behavior: 'smooth' })
                }
                aria-label="Sola Kaydır"
                className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  creditsScrollRef.current?.scrollBy({ left: 560, behavior: 'smooth' })
                }
                aria-label="Sağa Kaydır"
                className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={creditsScrollRef}
            onMouseEnter={() => {
              preloadMediaImages(credits.map((c) => c.media).filter(Boolean));
            }}
            onMouseLeave={() => requestAccordionHover(null)}
            className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 [-webkit-overflow-scrolling:touch]"
          >
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
            <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-300" />
              <span>Birlikte Rol Aldığı Oyuncular</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3.5">
            {coStars.map((peer) => (
              <Link
                key={peer.id}
                href={`/oyuncu/${peer.slug}`}
                className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/20 transition-colors flex flex-col items-center text-center group relative cursor-pointer"
              >
                <div className="w-16 h-16 rounded-full overflow-hidden border border-white/15 group-hover:border-white/30 transition-colors mb-2 shadow-md shrink-0">
                  <img
                    src={getProxiedImageUrl(peer.image_url, peer.name, null, 'w500', 'person')}
                    alt={peer.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-sky-300 transition-colors">
                  {peer.name}
                </div>
                <div className="text-[10px] font-mono text-white/65 mt-0.5 flex items-center justify-center gap-1">
                  <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                  <span>{peer.favorites_count}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 4. ASYAMAG MAGAZİN & DEDİKODU HABERLERİ */}
      {magazinePosts.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-rose-400" />
                <span>Oyuncuyla İlgili ({magazinePosts.length})</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-rose-500/15 text-rose-300 border border-rose-400/30">
                  {person.name} Gündemi
                </span>
              </h2>
            </div>
            <Link
              href="/magazin"
              className="text-xs text-white/60 hover:text-white flex items-center gap-1 font-semibold transition-colors"
            >
              <span>Tüm Magazin Haberlerini Gör</span>
              <span>→</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {magazinePosts.map((post) => (
              <Link
                key={post.slug || post.id}
                href={`/magazin/${post.slug}`}
                className="group rounded-2xl overflow-hidden bg-[#121216] border border-white/10 hover:border-white/30 transition-colors flex flex-col justify-between shadow-xl cursor-pointer"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/40">
                  {post.featured_image ? (
                    <img
                      src={getProxiedImageUrl(post.featured_image)}
                      alt={post.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-white/[0.04]">
                      <Newspaper className="w-8 h-8 text-white/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-transparent opacity-80" />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-600/90 text-white shadow-md">
                      {post.categories?.[0] || 'Magazin'}
                    </span>
                    {post.is_gossip && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/90 text-black shadow-md">
                        Dedikodu
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
                  <div>
                    <h3 className="text-sm font-bold text-white line-clamp-2 group-hover:text-rose-300 transition-colors leading-snug">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="text-xs text-white/55 line-clamp-2 mt-1.5 leading-relaxed font-light">
                        {post.excerpt}
                      </p>
                    )}
                  </div>
                  <div className="pt-2 flex items-center justify-between border-t border-white/10 text-[10px] text-white/45 font-mono">
                    {(() => {
                      const isKz =
                        (post.source_site || '').toLowerCase().includes('korezin') ||
                        post.source_url?.includes('korezin.com') ||
                        post.slug?.startsWith('kz-');
                      return (
                        <span className={`font-semibold ${isKz ? 'text-amber-400' : 'text-rose-400'}`}>
                          {isKz ? 'KoreZin' : (post.source_site || 'AsyaMag')}
                        </span>
                      );
                    })()}
                    <span>
                      {post.published_at ? new Date(post.published_at).toLocaleDateString('tr-TR') : 'Güncel'}
                    </span>
                  </div>
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
