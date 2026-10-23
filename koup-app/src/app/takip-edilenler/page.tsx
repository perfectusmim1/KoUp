'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  UserCheck,
  Tv,
  Users,
  Search,
  X,
  Compass,
  LogIn,
  Bell,
  BellOff,
  Heart,
  Star,
  Film,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  ArrowUpDown,
  Clock,
  ArrowDownAZ,
} from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';
import {
  supabase,
  MediaItem,
  PersonItem,
  cleanMediaTitle,
  formatContentTypeTR,
  getProxiedImageUrl,
} from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import Pagination from '@/components/Pagination';

type ActiveTab = 'media' | 'people';
type MediaFilter = 'ALL' | 'dizi' | 'anime' | 'film';
type PersonFilter = 'ALL' | 'actor' | 'character' | 'seiyuu';
type SortOption = 'default' | 'newest' | 'oldest' | 'rating' | 'title_asc';

const FOLLOW_SORT_OPTIONS: SelectOption[] = [
  {
    value: 'default',
    label: 'Varsayılan Sıralama',
    icon: <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    value: 'newest',
    label: 'En Yeni Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    value: 'oldest',
    label: 'En Eski Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    value: 'rating',
    label: 'En Yüksek Puan / Popüler',
    icon: <Star className="w-3.5 h-3.5 text-yellow-400" />,
  },
  {
    value: 'title_asc',
    label: 'İsme Göre (A-Z)',
    icon: <ArrowDownAZ className="w-3.5 h-3.5 text-purple-400" />,
  },
];

export default function FollowedPage() {
  const user = useKoUpSelector((s) => s.user);
  const followedMediaIds = useKoUpSelector((s) => s.followedMediaIds);
  const followedPersonIds = useKoUpSelector((s) => s.followedPersonIds);
  const favPersonIds = useKoUpSelector((s) => s.favPersonIds);
  const toggleMediaFollow = useKoUpSelector((s) => s.toggleMediaFollow);
  const togglePersonFollow = useKoUpSelector((s) => s.togglePersonFollow);
  const togglePersonFavorite = useKoUpSelector((s) => s.togglePersonFavorite);
  const openAuthModal = useKoUpSelector((s) => s.openAuthModal);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  // Active Tab: 'media' (Series & Anime) or 'people' (Actors & Characters)
  const [activeTab, setActiveTab] = useState<ActiveTab>('media');

  // Sub-filters
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('ALL');
  const [personFilter, setPersonFilter] = useState<PersonFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('default');

  // Search Query
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  // Loaded Items State
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [peopleItems, setPeopleItems] = useState<PersonItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);

  // Reset page when switching tabs or filters
  const handleTabChange = (tab: ActiveTab) => {
    triggerSound?.('click');
    setActiveTab(tab);
    setCurrentPage(1);
    setSearchQuery('');
  };

  // 1. Fetch Followed Media Items
  useEffect(() => {
    let isCancelled = false;

    if (!followedMediaIds || followedMediaIds.length === 0) {
      setMediaItems([]);
      setLoadingMedia(false);
      return;
    }

    setLoadingMedia(true);
    const fetchMedia = async () => {
      try {
        const { data, error } = await supabase
          .from('media')
          .select('*')
          .in('id', followedMediaIds);

        if (!isCancelled && !error && data) {
          // Preserve follow order or order by title
          const sorted = (data as MediaItem[]).sort((a, b) => {
            const idxA = followedMediaIds.indexOf(a.id);
            const idxB = followedMediaIds.indexOf(b.id);
            return (idxB === -1 ? 0 : idxB) - (idxA === -1 ? 0 : idxA);
          });
          setMediaItems(sorted);
        }
      } catch (err) {
        console.error('[TakipEdilenler] media fetch error:', err);
      } finally {
        if (!isCancelled) setLoadingMedia(false);
      }
    };

    void fetchMedia();
    return () => {
      isCancelled = true;
    };
  }, [followedMediaIds]);

  // 2. Fetch Followed People Items
  useEffect(() => {
    let isCancelled = false;

    if (!followedPersonIds || followedPersonIds.length === 0) {
      setPeopleItems([]);
      setLoadingPeople(false);
      return;
    }

    setLoadingPeople(true);
    const fetchPeople = async () => {
      try {
        const { data, error } = await supabase
          .from('people')
          .select('*')
          .in('id', followedPersonIds);

        if (!isCancelled && !error && data) {
          const sorted = (data as PersonItem[]).sort((a, b) => {
            const idxA = followedPersonIds.indexOf(a.id);
            const idxB = followedPersonIds.indexOf(b.id);
            return (idxB === -1 ? 0 : idxB) - (idxA === -1 ? 0 : idxA);
          });
          setPeopleItems(sorted);
        }
      } catch (err) {
        console.error('[TakipEdilenler] people fetch error:', err);
      } finally {
        if (!isCancelled) setLoadingPeople(false);
      }
    };

    void fetchPeople();
    return () => {
      isCancelled = true;
    };
  }, [followedPersonIds]);

  // Handle Unfollow Media
  const handleUnfollowMedia = useCallback(
    (media: MediaItem) => {
      triggerSound?.('click');
      toggleMediaFollow(media);
      setMediaItems((prev) => prev.filter((m) => m.id !== media.id));
    },
    [toggleMediaFollow, triggerSound]
  );

  // Handle Unfollow Person
  const handleUnfollowPerson = useCallback(
    (personId: number, personName?: string) => {
      triggerSound?.('click');
      togglePersonFollow(personId, personName);
      setPeopleItems((prev) => prev.filter((p) => p.id !== personId));
    },
    [togglePersonFollow, triggerSound]
  );

  // Filtered Media List
  const filteredMedia = useMemo(() => {
    const filtered = mediaItems.filter((item) => {
      // Filter by type
      if (mediaFilter !== 'ALL') {
        if (item.content_type !== mediaFilter) return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const nativeMatch = (item.native_title || '').toLowerCase().includes(q);
        return titleMatch || nativeMatch;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'oldest') {
      sorted.reverse();
    } else if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const rA = Number(a.site_rating || a.mdl_rating || a.imdb_rating || 0);
        const rB = Number(b.site_rating || b.mdl_rating || b.imdb_rating || 0);
        return rB - rA;
      });
    } else if (sortBy === 'title_asc') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'tr'));
    }
    return sorted;
  }, [mediaItems, mediaFilter, searchQuery, sortBy]);

  // Paginated Media
  const paginatedMedia = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredMedia.slice(start, start + PAGE_SIZE);
  }, [filteredMedia, currentPage]);

  // Filtered People List
  const filteredPeople = useMemo(() => {
    const filtered = peopleItems.filter((person) => {
      // Filter by person_type
      if (personFilter !== 'ALL') {
        if (person.person_type !== personFilter) return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = (person.name || '').toLowerCase().includes(q);
        const nativeMatch = (person.native_name || '').toLowerCase().includes(q);
        return nameMatch || nativeMatch;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'oldest') {
      sorted.reverse();
    } else if (sortBy === 'rating') {
      sorted.sort((a, b) => Number(b.favorites_count || 0) - Number(a.favorites_count || 0));
    } else if (sortBy === 'title_asc') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
    }
    return sorted;
  }, [peopleItems, personFilter, searchQuery, sortBy]);

  // Paginated People
  const paginatedPeople = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPeople.slice(start, start + PAGE_SIZE);
  }, [filteredPeople, currentPage]);

  // Guest without any local follows
  const hasLocalFollows = (followedMediaIds?.length || 0) > 0 || (followedPersonIds?.length || 0) > 0;
  if (!user && !hasLocalFollows) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <UserCheck className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Takip Edilenler
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              Takip ettiğiniz dizi, anime ve oyuncuları bulutta saklamak ve yeni bölüm/proje bildirimleri almak için lütfen giriş yapın.
            </p>
          </div>

          <button
            onClick={() => {
              triggerSound?.('click');
              openAuthModal('Takip listenizi yönetmek için lütfen giriş yapın.');
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 active:scale-98 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Takip Edilenler
          </h1>
        </div>

        {/* Quick Discovery Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/kesfet"
            onClick={() => triggerSound?.('click')}
            prefetch={true}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white/90 hover:text-white transition-all cursor-pointer shadow-xs"
          >
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span>Dizileri Keşfet</span>
          </Link>
          <Link
            href="/oyuncular"
            onClick={() => triggerSound?.('click')}
            prefetch={true}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-bold text-white/90 hover:text-white transition-all cursor-pointer shadow-xs"
          >
            <Users className="w-3.5 h-3.5 text-amber-400" />
            <span>Oyuncuları Keşfet</span>
          </Link>
        </div>
      </div>

      {/* Guest Warning Banner if not logged in but viewing local storage */}
      {!user && hasLocalFollows && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-400/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-200 text-xs">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              <strong>Misafir Oturumu:</strong> Bu takip listesi yalnızca bu cihazınızda kayıtlıdır. Tüm cihazlarınızda eşitlemek için giriş yapabilirsiniz.
            </span>
          </div>
          <button
            onClick={() => {
              triggerSound?.('click');
              openAuthModal('Takip listenizi eşitlemek için lütfen giriş yapın.');
            }}
            className="px-4 py-1.5 rounded-full bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 transition-colors cursor-pointer self-start sm:self-auto shrink-0"
          >
            Giriş Yap
          </button>
        </div>
      )}

      {/* MAIN TWO-SECTION TABS SWITCHER (GEMINI Design Principles) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Main Tab Switcher */}
        <div className="inline-flex items-center p-1.5 rounded-2xl bg-[#0f0f12] border border-white/10 shadow-lg shrink-0">
          <button
            onClick={() => handleTabChange('media')}
            className={`relative flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer duration-200 ${
              activeTab === 'media' ? 'text-black font-extrabold' : 'text-white/60 hover:text-white'
            }`}
          >
            {activeTab === 'media' && (
              <motion.span
                layoutId="takip-main-tab-pill"
                transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.4)]"
              />
            )}
            <Tv className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Seriler</span>
            <span
              className={`relative z-10 ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold ${
                activeTab === 'media'
                  ? 'bg-black/20 text-black'
                  : 'bg-white/10 text-white/80'
              }`}
            >
              {mediaItems.length}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('people')}
            className={`relative flex items-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors cursor-pointer duration-200 ${
              activeTab === 'people' ? 'text-black font-extrabold' : 'text-white/60 hover:text-white'
            }`}
          >
            {activeTab === 'people' && (
              <motion.span
                layoutId="takip-main-tab-pill"
                transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.4)]"
              />
            )}
            <Users className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Oyuncular & Karakterler</span>
            <span
              className={`relative z-10 ml-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold ${
                activeTab === 'people'
                  ? 'bg-black/20 text-black'
                  : 'bg-white/10 text-white/80'
              }`}
            >
              {peopleItems.length}
            </span>
          </button>
        </div>

        {/* Sort & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <div className="w-full sm:w-52 shrink-0">
            <CustomSelect
              value={sortBy}
              onChange={(val) => {
                triggerSound?.('click');
                setSortBy((val as SortOption) || 'default');
                setCurrentPage(1);
              }}
              options={FOLLOW_SORT_OPTIONS}
              variant="glass"
              size="sm"
              searchable={false}
              aria-label="Sıralama seçin"
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] w-full sm:w-72">
            <Search className="w-4 h-4 text-white/50 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={
                activeTab === 'media'
                  ? 'Takip edilen serilerde ara...'
                  : 'Takip edilen oyuncularda ara...'
              }
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="text-white/40 hover:text-white transition-colors cursor-pointer p-0.5"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SUB-FILTER PILLS BAR */}
      <div className="flex items-center gap-2 overflow-x-auto py-2 no-scrollbar mb-4 sm:mb-6">
        {activeTab === 'media' ? (
          <>
            {[
              {
                id: 'ALL' as const,
                label: `Tümü (${mediaItems.length})`,
                activePillClass: 'bg-white shadow-[0_0_15px_rgba(255,255,255,0.35)]',
                activeTextClass: 'text-black font-extrabold',
              },
              {
                id: 'dizi' as const,
                label: 'Diziler',
                activePillClass: 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.45)]',
                activeTextClass: 'text-black font-extrabold',
              },
              {
                id: 'anime' as const,
                label: 'Animeler',
                activePillClass: 'bg-purple-500 shadow-[0_0_18px_rgba(168,85,247,0.45)]',
                activeTextClass: 'text-white font-extrabold',
              },
              {
                id: 'film' as const,
                label: 'Filmler',
                activePillClass: 'bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.45)]',
                activeTextClass: 'text-black font-extrabold',
              },
            ].map((flt) => {
              const active = mediaFilter === flt.id;
              return (
                <button
                  key={flt.id}
                  onClick={() => {
                    triggerSound?.('click');
                    setMediaFilter(flt.id);
                    setCurrentPage(1);
                  }}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors duration-200 cursor-pointer shrink-0 ${
                    active
                      ? flt.activeTextClass
                      : 'bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08] border border-white/[0.06]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="takip-subfilter-pill"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className={`absolute inset-0 rounded-full ${flt.activePillClass}`}
                    />
                  )}
                  <span className="relative z-10">{flt.label}</span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            {[
              {
                id: 'ALL' as const,
                label: `Tümü (${peopleItems.length})`,
                activePillClass: 'bg-white shadow-[0_0_15px_rgba(255,255,255,0.35)]',
                activeTextClass: 'text-black font-extrabold',
              },
              {
                id: 'actor' as const,
                label: 'Oyuncular',
                activePillClass: 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.45)]',
                activeTextClass: 'text-black font-extrabold',
              },
              {
                id: 'character' as const,
                label: 'Karakterler',
                activePillClass: 'bg-purple-500 shadow-[0_0_18px_rgba(168,85,247,0.45)]',
                activeTextClass: 'text-white font-extrabold',
              },
              {
                id: 'seiyuu' as const,
                label: 'Seslendirmenler',
                activePillClass: 'bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.45)]',
                activeTextClass: 'text-black font-extrabold',
              },
            ].map((flt) => {
              const active = personFilter === flt.id;
              return (
                <button
                  key={flt.id}
                  onClick={() => {
                    triggerSound?.('click');
                    setPersonFilter(flt.id);
                    setCurrentPage(1);
                  }}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors duration-200 cursor-pointer shrink-0 ${
                    active
                      ? flt.activeTextClass
                      : 'bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08] border border-white/[0.06]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="takip-subfilter-pill"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                      className={`absolute inset-0 rounded-full ${flt.activePillClass}`}
                    />
                  )}
                  <span className="relative z-10">{flt.label}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* CONTENT AREA: TAB 1 (MEDIA) OR TAB 2 (PEOPLE) */}
      {activeTab === 'media' ? (
        /* MEDIA TAB */
        loadingMedia ? (
          /* Loading Shimmer Skeletons */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5 pt-1 sm:pt-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl bg-[#0f0f12] border border-white/[0.06] overflow-hidden p-2 space-y-3 animate-pulse"
              >
                <div className="aspect-[2/3] bg-white/[0.05] rounded-xl" />
                <div className="h-3.5 bg-white/[0.05] rounded-md w-3/4" />
                <div className="h-3 bg-white/[0.05] rounded-md w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredMedia.length === 0 ? (
          /* Empty State for Media */
          <div className="rounded-3xl bg-[#0f0f11] p-12 sm:p-16 text-center border border-white/10 space-y-5 shadow-xl">
            <div className="w-16 h-16 rounded-3xl bg-sky-500/10 border border-sky-400/20 flex items-center justify-center mx-auto text-sky-400">
              <Tv className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">
                {searchQuery.trim()
                  ? 'Aramanıza uygun takip edilen yapım bulunamadı'
                  : 'Henüz takip ettiğiniz bir yapım bulunmuyor'}
              </h3>
              <p className="text-xs text-white/50 max-w-md mx-auto leading-relaxed">
                {searchQuery.trim()
                  ? 'Arama kriterlerinizi değiştirerek tekrar deneyebilirsiniz.'
                  : 'Dizi, film ve animelerin üzerindeki takip butonuna tıklayarak listenize ekleyebilirsiniz.'}
              </p>
            </div>
            <Link
              href="/kesfet"
              onClick={() => triggerSound?.('click')}
              prefetch={true}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 active:scale-98 transition-all cursor-pointer shadow-md"
            >
              <Compass className="w-4 h-4" />
              <span>Dizileri Keşfet</span>
            </Link>
          </div>
        ) : (
          /* Grid of Followed Media */
          <div className="space-y-8 pt-1 sm:pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
              {paginatedMedia.map((m, idx) => {
                return (
                  <div
                    key={m.id}
                    className="group relative flex flex-col rounded-2xl bg-[#0f0f12] border border-white/10 hover:border-white/25 overflow-hidden transition-[border-color,box-shadow] duration-200 shadow-lg hover:shadow-2xl [content-visibility:auto] [contain-intrinsic-size:auto_400px]"
                  >
                    {/* Poster with Accordion Hover Interaction */}
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-black/60">
                      <AccordionMediaCard item={m} fluidWidth={true} priority={idx < 6} />
                    </div>

                    {/* Follow Management Strip */}
                    <div className="p-2.5 bg-[#0a0a0d] border-t border-white/[0.08] flex items-center justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-mono font-medium text-white/40 block truncate">
                          {formatContentTypeTR(m.content_type)} • {m.release_year || 'Güncel'}
                        </span>
                      </div>

                      <button
                        onClick={() => handleUnfollowMedia(m)}
                        title="Takibi Bırak"
                        aria-label="Takibi Bırak"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-rose-500/20 border border-sky-400/30 hover:border-rose-400/40 text-[11px] font-bold text-sky-300 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                      >
                        <BellOff className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Takipte</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Media Pagination */}
            <Pagination
              currentPage={currentPage}
              totalCount={filteredMedia.length}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => setCurrentPage(page)}
              itemLabel="yapımdan"
            />
          </div>
        )
      ) : (
        /* PEOPLE TAB */
        loadingPeople ? (
          /* Loading Skeletons */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 pt-1 sm:pt-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-3xl p-4 bg-[#0f0f11] border border-white/[0.08] space-y-3 animate-pulse"
              >
                <div className="aspect-square bg-white/[0.05] rounded-2xl" />
                <div className="h-4 bg-white/[0.05] rounded-md w-3/4" />
                <div className="h-3 bg-white/[0.05] rounded-md w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredPeople.length === 0 ? (
          /* Empty State for People */
          <div className="rounded-3xl bg-[#0f0f11] p-12 sm:p-16 text-center border border-white/10 space-y-5 shadow-xl">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center mx-auto text-amber-400">
              <Users className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">
                {searchQuery.trim()
                  ? 'Aramanıza uygun takip edilen oyuncu bulunamadı'
                  : 'Henüz takip ettiğiniz bir oyuncu bulunmuyor'}
              </h3>
              <p className="text-xs text-white/50 max-w-md mx-auto leading-relaxed">
                {searchQuery.trim()
                  ? 'Arama kriterlerinizi değiştirerek tekrar deneyebilirsiniz.'
                  : 'Hayranı olduğunuz oyuncuları takip listenize ekleyerek yeni rol aldıkları yapımlardan anında bildirim alabilirsiniz.'}
              </p>
            </div>
            <Link
              href="/oyuncular"
              onClick={() => triggerSound?.('click')}
              prefetch={true}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 active:scale-98 transition-all cursor-pointer shadow-md"
            >
              <Users className="w-4 h-4" />
              <span>Oyuncuları Keşfet</span>
            </Link>
          </div>
        ) : (
          /* Grid of Followed People (Matches Oyuncular page design) */
          <div className="space-y-8 pt-1 sm:pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {paginatedPeople.map((person) => {
                const isFav = favPersonIds.includes(person.id);
                const isFol = followedPersonIds.includes(person.id);
                const displayFavs = person.favorites_count || 0;

                return (
                  <div
                    key={person.id}
                    className="cv-card rounded-3xl p-4 flex flex-col justify-between group bg-[#0f0f11] border border-white/[0.08] hover:border-white/30 hover:shadow-[0_0_24px_-4px_rgba(41,151,255,0.25),0_10px_24px_rgba(0,0,0,0.7)] transition-all duration-200 [content-visibility:auto] [contain-intrinsic-size:auto_280px]"
                  >
                    <div>
                      <div className="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-black/50 border border-white/10 group-hover:border-white/30 transition-colors">
                        <Link href={`/oyuncu/${person.slug}`} prefetch={true}>
                          <img
                            src={getProxiedImageUrl(
                              person.image_url,
                              person.name,
                              null,
                              'w500',
                              'person',
                              person.tmdb_id
                            )}
                            alt={person.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </Link>
                      </div>

                      <Link
                        href={`/oyuncu/${person.slug}`}
                        prefetch={true}
                        className="block text-sm font-bold text-white truncate group-hover:text-sky-300 transition-colors"
                      >
                        {person.name}
                      </Link>
                      {person.native_name && (
                        <div className="text-[11px] text-white/45 truncate">
                          {person.native_name}
                        </div>
                      )}
                    </div>

                    {/* Bottom Favorite & Follow Actions */}
                    <div className="mt-3 pt-2.5 border-t border-white/[0.07] flex items-center justify-between gap-2">
                      <button
                        onClick={async () => {
                          const wasFav = favPersonIds.includes(person.id);
                          setPeopleItems((prev) =>
                            prev.map((p) =>
                              p.id === person.id
                                ? {
                                    ...p,
                                    favorites_count: Math.max(
                                      0,
                                      (p.favorites_count || 0) + (wasFav ? -1 : 1)
                                    ),
                                  }
                                : p
                            )
                          );
                          await togglePersonFavorite(person.id, person.name);
                        }}
                        title={isFav ? 'Favorilerimde' : 'Favorilere Ekle'}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-full text-xs font-mono font-bold border transition-colors cursor-pointer ${
                          isFav
                            ? 'bg-rose-500 border-rose-400 text-white shadow-[0_0_12px_rgba(244,63,94,0.35)]'
                            : 'bg-white/[0.05] border-white/10 text-white/85 hover:bg-white/10'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : 'text-rose-400'}`} />
                        <span>{displayFavs > 0 ? displayFavs : 'Favorile'}</span>
                      </button>

                      <button
                        onClick={() => handleUnfollowPerson(person.id, person.name)}
                        aria-label="Takibi Bırak"
                        title="Takibi Bırak"
                        className="w-8 h-8 rounded-full flex items-center justify-center border transition-colors cursor-pointer bg-sky-400 text-slate-950 border-sky-300 hover:bg-rose-500 hover:text-white hover:border-rose-400 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                      >
                        <Bell className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* People Pagination */}
            <Pagination
              currentPage={currentPage}
              totalCount={filteredPeople.length}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => setCurrentPage(page)}
              itemLabel="oyuncudan"
            />
          </div>
        )
      )}
    </div>
  );
}
