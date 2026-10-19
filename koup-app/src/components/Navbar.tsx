'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  Bell,
  User,
  Compass,
  Users,
  Newspaper,
  Calendar,
  ShieldCheck,
  X,
  SlidersHorizontal,
  Home,
  Menu,
  LogIn,
  Tv,
  UserCheck,
  MessageSquare,
  Sparkles,
  CheckCheck,
  ArrowRight,
  Bookmark,
  Clock,
  Settings,
  LogOut,
  Library,
  ListOrdered,
  FolderHeart,
  AlertTriangle,
  Megaphone,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
  formatContentTypeTR,
  cleanMediaTitle,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AuthModal from '@/components/AuthModal';
import { cachedQuery, registerMediaItems } from '@/lib/cache';
import { normalizeSearchQuery } from '@/lib/search';
import { rankSearchResults } from '@/lib/searchRanking';

const NAV_LINKS = [
  { href: '/', label: 'Ana Sayfa', icon: Home },
  { href: '/kesfet', label: 'Keşfet', icon: Compass },
  { href: '/listeler', label: 'Listeler', icon: ListOrdered },
  { href: '/oyuncular', label: 'Oyuncular', icon: Users },
  { href: '/magazin', label: 'Magazin', icon: Newspaper },
  { href: '/takvim', label: 'Takvim', icon: Calendar },
];

function getNavTypeBadgeClass(contentType?: string, countryCode?: string): string {
  const ct = (contentType || '').toLowerCase();
  const cc = (countryCode || '').toUpperCase();
  if (ct === 'anime') return 'badge-type badge-anime';
  if (ct === 'movie' || ct === 'film') return 'badge-type badge-movie';
  if (ct === 'program' || ct === 'variety') return 'badge-type badge-variety';
  if (cc === 'KR') return 'badge-type badge-kdrama';
  if (cc === 'CN') return 'badge-type badge-cdrama';
  if (cc === 'JP') return 'badge-type badge-anime';
  return 'badge-type badge-global';
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    profile,
    notifications,
    unreadCount,
    markNotificationsRead,
    markAllNotificationsRead,
    markNotificationRead,
    triggerSound,
    setIsAuthModalOpen,
    logout,
    navbarBehavior,
    floatingNavbarEnabled,
  } = useKoUp();

  const dedupedNotifications = React.useMemo(() => {
    const seenIds = new Set<string>();
    const seenFps = new Set<string>();
    const deduped: typeof notifications = [];
    const sorted = [...notifications].sort((a, b) => {
      const aIsDb = !a.id.startsWith('notif-');
      const bIsDb = !b.id.startsWith('notif-');
      if (aIsDb && !bIsDb) return -1;
      if (!aIsDb && bIsDb) return 1;
      return 0;
    });
    for (const n of sorted) {
      if (!n || !n.id) continue;
      if (seenIds.has(n.id)) continue;
      const fp = `${(n.title || '').trim()}::${(n.body || '').trim()}`;
      if (fp.length > 2 && seenFps.has(fp)) continue;
      seenIds.add(n.id);
      if (fp.length > 2) seenFps.add(fp);
      deduped.push(n);
    }
    return deduped;
  }, [notifications]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mediaResults, setMediaResults] = useState<MediaItem[]>([]);
  const [personResults, setPersonResults] = useState<PersonItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const [isScrolled, setIsScrolled] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);

  // Scroll listener for dynamic floating glass island navbar
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Instant Omnibox Search (Debounced 160ms with direct catalog fallback & race-condition cancellation)
  useEffect(() => {
    const { normalized, raw } = normalizeSearchQuery(query);
    if (normalized.length < 2 && raw.length < 2) {
      setMediaResults([]);
      setPersonResults([]);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const cacheKey = `omnibox_${normalized || raw}`;
        const [mList, pList] = await cachedQuery(cacheKey, 30_000, async () => {
          let mediaData: MediaItem[] = [];

          // 1. Try high-performance fuzzy catalog RPC
          try {
            const mRes = await supabase.rpc('search_catalog', {
              p_query: raw,
              p_limit: 8,
            });
            if (mRes.data && Array.isArray(mRes.data) && mRes.data.length > 0) {
              mediaData = mRes.data as MediaItem[];
            }
          } catch {
            // Failsafe
          }

          // 2. Fallback: if search_catalog returned 0 results or had an error, search media directly
          if (mediaData.length === 0) {
            try {
              const { data: directMedia } = await supabase
                .from('media')
                .select('id, slug, title, native_title, content_type, country_code, release_year, cover_image, backdrop_image, mdl_rating, anilist_rating, imdb_rating, categories')
                .or(`title.ilike.%${raw}%,slug.ilike.%${normalized || raw}%,search_text.ilike.%${normalized || raw}%`)
                .order('views_total', { ascending: false })
                .limit(8);

              if (directMedia && directMedia.length > 0) {
                mediaData = directMedia as MediaItem[];
              }
            } catch {
              // Direct query failsafe
            }
          }

          // 3. Search people & actors
          let personData: PersonItem[] = [];
          try {
            const pRes = await supabase
              .from('people')
              .select('id, slug, name, native_name, person_type, image_url, favorites_count')
              .or(`name.ilike.%${normalized}%,native_name.ilike.%${raw}%`)
              .order('favorites_count', { ascending: false })
              .limit(4);
            if (pRes.data && Array.isArray(pRes.data)) {
              personData = pRes.data as PersonItem[];
            }
          } catch {
            // Person failsafe
          }

          return [mediaData, personData] as const;
        });

        if (!active) return;
        const mediaItems = rankSearchResults((mList as MediaItem[]) || [], raw);
        registerMediaItems(mediaItems);
        setMediaResults(mediaItems);
        setPersonResults((pList as PersonItem[]) || []);
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 160);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Close popovers on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(e.target as Node)
      ) {
        setNotifOpen(false);
      }
      if (
        profileContainerRef.current &&
        !profileContainerRef.current.contains(e.target as Node)
      ) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 40);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setMobileSearchOpen(false);
        setNotifOpen(false);
        setMobileMenuOpen(false);
        setProfileDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);

  // Sync optimistic navigation path with router pathname
  useEffect(() => {
    setOptimisticPath(pathname);
  }, [pathname]);

  const activePath = optimisticPath ?? pathname;
  const isNavActive = (href: string) => {
    if (href === '/') return activePath === '/';
    return activePath === href || activePath.startsWith(`${href}/`);
  };

  return (
    <>
      <div
        suppressHydrationWarning
        className={`top-0 left-0 right-0 z-50 flex justify-center pointer-events-none transition-all duration-300 ${
          navbarBehavior === 'static' ? 'absolute' : 'fixed'
        }`}
      >
        <header
          className={`pointer-events-auto flex items-center justify-between transition-all duration-300 ease-out will-change-[width,transform,background-color,border-radius] ${
            navbarBehavior === 'floating'
              ? isScrolled
                ? 'mt-2 sm:mt-3.5 max-w-[1620px] w-[95%] sm:w-[92%] xl:w-[90%] rounded-2xl sm:rounded-full bg-[#08080a]/92 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9),0_0_30px_-5px_rgba(41,151,255,0.08)] py-2 sm:py-2.5 px-4 sm:px-6'
                : 'mt-0 w-full max-w-full rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
              : navbarBehavior === 'sticky'
              ? isScrolled
                ? 'mt-0 w-full max-w-full rounded-none bg-[#08080a]/95 backdrop-blur-2xl border-b border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.8)] py-3 sm:py-4 px-4 sm:px-8 lg:px-14'
                : 'mt-0 w-full max-w-full rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
              : /* static: sitenin üstünde kalır, sayfa kayınca bizle gelmez */
                'mt-0 w-full max-w-full rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
          }`}
        >
      {/* LEFT: Brand Mark (Original KU Logo — No Circle or Box Wrapper) */}
      <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="lg:hidden w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white cursor-pointer select-none focus:outline-none focus-visible:outline-none active:bg-white/20"
          aria-label="Menü"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link
          href="/"
          prefetch={true}
          onClick={() => triggerSound('click')}
          className="hidden sm:flex items-center gap-2 sm:gap-3 group select-none"
        >
          <img
            src="/logo-dark.png"
            alt="KoUp"
            className="h-8 sm:h-9 w-auto object-contain transition-opacity duration-300 group-hover:opacity-90 drop-shadow-[0_4px_16px_rgba(255,255,255,0.2)]"
          />
          <div className="flex flex-col">
            <span className="text-[15px] sm:text-[16px] font-bold tracking-wider text-white leading-none">
              KoUp
              <span className="text-white/55 font-light ml-1 text-[13px] hidden sm:inline">
                TV+
              </span>
            </span>
            <span className="text-[9px] tracking-[0.22em] font-medium uppercase text-white/40 mt-1 hidden sm:block">
              Cinema Studio
            </span>
          </div>
        </Link>
      </div>

      {/* CENTER: Floating Glassy Pill Menu (Exact ui/code.html style + Fluid Spring Pill Slider) */}
      <nav className="pointer-events-auto hidden lg:flex items-center shrink-0 p-1.5 rounded-full glass-pill-dark shadow-[0_16px_40px_rgba(0,0,0,0.75)]">
        {NAV_LINKS.map((item) => {
          const active = isNavActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onMouseDown={(e) => {
                if (e.button === 0) {
                  setOptimisticPath(item.href);
                  triggerSound('click');
                }
              }}
              onClick={() => {
                setOptimisticPath(item.href);
                triggerSound('click');
              }}
              onMouseEnter={() => triggerSound('hover')}
              className={`relative px-5 py-2 rounded-full text-[13px] font-semibold transition-colors duration-200 select-none ${
                active ? 'text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="koup-navbar-active-pill"
                  initial={false}
                  transition={{
                    type: 'spring',
                    stiffness: 480,
                    damping: 34,
                    mass: 0.6,
                  }}
                  className="absolute inset-0 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.4)]"
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* RIGHT: Quick Actions (Search, Sound, Notifications, Admin, Profile) */}
      <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2.5">
        {/* Mobile Sleek Magnifying Glass Button (< md) */}
        <button
          onClick={() => {
            triggerSound('click');
            setMobileSearchOpen(true);
          }}
          className="md:hidden w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white cursor-pointer"
          aria-label="Arama Yap"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Desktop Instant Search Bar / Trigger (>= md) */}
        <div ref={searchContainerRef} className="relative hidden md:block">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/50 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 w-44 lg:w-60 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.25)]">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  setSearchOpen(false);
                  router.push(`/kesfet?q=${encodeURIComponent(query.trim())}`);
                }
              }}
              placeholder="İçerik veya oyuncu ara..."
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="text-white/50 hover:text-white cursor-pointer"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden xl:inline-block text-[10px] font-mono text-white/35 px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10">
                ⌘K
              </kbd>
            )}
          </div>

          {/* Search Omnibox Dropdown with Spring Animation & Responsive Clamp */}
          <AnimatePresence>
            {searchOpen && query.trim().length >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 mt-3 w-[calc(100vw-2.5rem)] sm:w-[440px] max-w-[440px] rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-4 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.12)] border border-white/15 z-50"
              >
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">
                    Anlık Katalog Sonuçları
                  </span>
                  <Link
                    href={`/kesfet?q=${encodeURIComponent(query)}`}
                    prefetch={true}
                    onClick={() => setSearchOpen(false)}
                    className="text-xs text-white/80 hover:text-white flex items-center gap-1 font-medium transition-colors"
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    <span>Gelişmiş Filtre</span>
                  </Link>
                </div>

                {isSearching ? (
                  <div className="py-8 text-center text-xs text-white/50 animate-pulse">
                    Arşiv taranıyor...
                  </div>
                ) : mediaResults.length === 0 && personResults.length === 0 ? (
                  <div className="py-8 text-center text-xs text-white/50">
                    &ldquo;{query}&rdquo; için eşleşen kayıt bulunamadı.
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1 no-scrollbar">
                    {mediaResults.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2 px-1">
                          Diziler, Animeler & Filmler
                        </div>
                        <div className="space-y-1.5">
                          {mediaResults.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(`/seri/${m.slug}`);
                              }}
                              className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-white/[0.08] transition-colors text-left group cursor-pointer"
                            >
                              <img
                                src={getProxiedImageUrl(m.cover_image, m.title)}
                                alt={m.title}
                                width={40}
                                height={56}
                                loading="lazy"
                                decoding="async"
                                className="w-10 h-14 object-cover rounded-lg border border-white/10 shrink-0"
                                onError={(e) => {
                                  const target = e.currentTarget;
                                  if (!target.dataset.fallbackTried) {
                                    target.dataset.fallbackTried = 'true';
                                    target.src = `/api/image-proxy?title=${encodeURIComponent(cleanMediaTitle(m.title))}`;
                                  }
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white group-hover:text-white truncate">
                                  {cleanMediaTitle(m.title)}
                                </div>
                                <div className="text-[11px] text-white/50 flex flex-wrap items-center gap-2 mt-1">
                                  <span className={getNavTypeBadgeClass(m.content_type, m.country_code || (m as any).country)}>
                                    {formatContentTypeTR(m.content_type, m.country_code || (m as any).country)}
                                  </span>
                                  {m.release_year && <span>• {m.release_year}</span>}
                                  {m.mdl_rating && (
                                    <span className="text-amber-300 font-mono">
                                      MDL {m.mdl_rating}
                                    </span>
                                  )}
                                  {(m.imdb_rating || (m as any).imdb_score || (m as any).vote_average) && (
                                    <span className="text-[#f5c518] font-mono">
                                      IMDb {Number(m.imdb_rating ?? (m as any).imdb_score ?? (m as any).vote_average).toFixed(1)}
                                    </span>
                                  )}
                                  {m.anilist_rating && (
                                    <span className="text-sky-300 font-mono">
                                      AL {m.anilist_rating}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {personResults.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2 px-1">
                          Oyuncular & Anime Karakterleri
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {personResults.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setSearchOpen(false);
                                router.push(`/oyuncu/${p.slug}`);
                              }}
                              className="flex items-center gap-2.5 p-2 rounded-2xl hover:bg-white/[0.08] transition-colors text-left cursor-pointer"
                            >
                              <img
                                src={getProxiedImageUrl(p.image_url, p.name, null, 'w185', 'person')}
                                alt={p.name}
                                width={36}
                                height={36}
                                loading="lazy"
                                decoding="async"
                                className="w-9 h-9 rounded-full object-cover border border-white/15 shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {p.name}
                                </div>
                                <div className="text-[10px] text-white/45">
                                  {p.favorites_count > 0
                                    ? `${p.favorites_count} Favori`
                                    : p.person_type === 'director'
                                    ? 'Yönetmen'
                                    : 'Oyuncu'}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notifications Bell */}
        <div ref={notifContainerRef} className="relative">
          <button
            onClick={() => {
              triggerSound('click');
              const nextOpen = !notifOpen;
              setNotifOpen(nextOpen);
              setProfileDropdownOpen(false);
              setSearchOpen(false);
            }}
            className={`w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white focus-visible:text-white relative cursor-pointer transition-all duration-200 focus:outline-none focus-visible:outline-none ${
              notifOpen
                ? 'bg-white/[0.22] border-white/45 shadow-[0_0_16px_rgba(255,255,255,0.18)] text-white'
                : 'hover:bg-white/[0.20] hover:border-white/40 hover:shadow-[0_0_16px_rgba(255,255,255,0.14)] focus-visible:bg-white/[0.20] focus-visible:border-white/40'
            }`}
            aria-label="Bildirimler"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center px-1 shadow-[0_0_12px_rgba(239,68,68,0.75)]">
                {unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-3 right-3 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[410px] sm:max-w-[410px] rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-4 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.12)] border border-white/15 z-50 flex flex-col gap-3"
              >
                {/* Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Bildirim Merkezi</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-red-600/30 text-red-300 border border-red-500/40 text-[10px] font-mono font-bold">
                        {unreadCount} yeni
                      </span>
                    )}
                  </div>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllNotificationsRead()}
                        className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 transition-colors cursor-pointer flex items-center gap-1"
                        aria-label="Tümünü Okundu İşaretle"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Tümünü Oku</span>
                      </button>
                    )}
                  </div>

                {/* Notifications List */}
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {!user ? (
                    <div className="py-8 px-4 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center mx-auto text-white/40">
                        <Bell className="w-6 h-6" />
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed max-w-[280px] mx-auto">
                        Bildirimlerinizi görmek ve takip ettiğiniz serilerden haberdar olmak için lütfen giriş yapın.
                      </p>
                      <button
                        onClick={() => {
                          setNotifOpen(false);
                          setIsAuthModalOpen(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-md"
                      >
                        Giriş Yap
                      </button>
                    </div>
                  ) : dedupedNotifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-white/50 space-y-1">
                      <Bell className="w-5 h-5 text-white/30 mx-auto mb-1" />
                      <p>Yeni bildiriminiz yok.</p>
                    </div>
                  ) : (
                    dedupedNotifications.map((n) => {
                      const href = n.linkUrl || (n as any).link_url;
                      const isUnread = !n.isRead;

                      // Category Icon & Distinct Colors Picker
                      let CatIcon = Sparkles;
                      let catColor = 'bg-purple-500/20 text-purple-300 border-purple-400/30';
                      if (n.type === 'episode') {
                        CatIcon = Tv;
                        catColor = 'bg-amber-500/20 text-amber-300 border-amber-400/30';
                      } else if (n.type === 'actor') {
                        CatIcon = UserCheck;
                        catColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30';
                      } else if (n.type === 'reply') {
                        CatIcon = MessageSquare;
                        catColor = 'bg-sky-500/20 text-sky-300 border-sky-400/30';
                      } else if (n.type === 'system' || n.type === 'info') {
                        CatIcon = Megaphone;
                        catColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30';
                      }

                      const cardContent = (
                        <div className="flex items-start gap-3">
                          {/* Category Icon Badge */}
                          <div
                            className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${catColor}`}
                          >
                            <CatIcon className="w-4 h-4" />
                          </div>

                          {/* Message Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h4
                                className={`text-xs truncate ${
                                  isUnread ? 'font-bold text-white' : 'font-medium text-white/80'
                                }`}
                              >
                                {n.title}
                              </h4>
                              {isUnread && (
                                <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)] shrink-0" />
                              )}
                            </div>
                            <p className="text-[11px] text-white/60 mt-0.5 line-clamp-2 leading-relaxed">
                              {n.body}
                            </p>
                            <span className="text-[10px] font-mono text-white/40 block mt-1">
                              {n.createdAt}
                            </span>
                          </div>
                        </div>
                      );

                      if (href) {
                        return (
                          <Link
                            key={n.id}
                            href={href}
                            prefetch={true}
                            onClick={() => {
                              markNotificationRead(n.id);
                              setNotifOpen(false);
                            }}
                            className={`block p-3 rounded-2xl border transition-all cursor-pointer ${
                              isUnread
                                ? 'bg-white/[0.08] hover:bg-white/[0.12] border-white/20 shadow-md'
                                : 'bg-white/[0.02] hover:bg-white/[0.06] border-white/[0.05] opacity-70 hover:opacity-100'
                            }`}
                          >
                            {cardContent}
                          </Link>
                        );
                      }

                      return (
                        <div
                          key={n.id}
                          onClick={() => markNotificationRead(n.id)}
                          className={`block p-3 rounded-2xl border transition-all cursor-pointer ${
                            isUnread
                              ? 'bg-white/[0.08] hover:bg-white/[0.12] border-white/20 shadow-md'
                              : 'bg-white/[0.02] hover:bg-white/[0.06] border-white/[0.05] opacity-70 hover:opacity-100'
                          }`}
                        >
                          {cardContent}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer Link to Dedicated Page */}
                <div className="pt-2 border-t border-white/10">
                  <Link
                    href="/bildirimler"
                    prefetch={true}
                    onClick={() => setNotifOpen(false)}
                    className="w-full py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <span>Tüm Bildirimler Sayfasına Git</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Admin Control Center Link - Only visible to admins */}
        {user?.role === 'admin' && (
          <Link
            href="/admin"
            prefetch={true}
            aria-label="Admin Kontrol Merkezi"
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-full glass-pill text-xs font-medium text-amber-300 border-amber-400/30 hover:border-amber-400/60 transition-all shadow-[0_0_12px_rgba(245,158,11,0.2)]"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Admin</span>
          </Link>
        )}

        {/* User Profile Pill with Apple/Netflix-style Popover Dropdown or Login Button */}
        {user ? (
          <div ref={profileContainerRef} className="relative">
            <button
              onClick={() => {
                triggerSound('click');
                setProfileDropdownOpen((v) => !v);
                setNotifOpen(false);
                setSearchOpen(false);
              }}
              className={`group flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full glass-pill transition-all duration-200 cursor-pointer select-none relative focus:outline-none focus-visible:outline-none ${
                profileDropdownOpen
                  ? 'bg-white/[0.22] border-white/45 shadow-[0_0_16px_rgba(255,255,255,0.18)]'
                  : 'hover:bg-white/[0.20] hover:border-white/40 hover:shadow-[0_0_16px_rgba(255,255,255,0.14)] focus-visible:bg-white/[0.20] focus-visible:border-white/40'
              }`}
              aria-label="Kullanıcı Menüsü"
              aria-expanded={profileDropdownOpen}
            >
              <div className="w-7 h-7 rounded-full bg-white/15 border border-white/20 flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden shadow-xs">
                {user.avatar_url ? (
                  <img
                    src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username, null, 'w185', 'person')}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <span className="hidden md:inline text-xs font-semibold text-white/90 group-hover:text-white max-w-[110px] truncate transition-colors">
                {user.display_name || user.username || 'Profilim'}
              </span>
            </button>

            {/* Apple/Netflix-Style Glass Popover Dropdown */}
            <AnimatePresence>
              {profileDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed right-3 top-20 sm:absolute sm:right-0 sm:top-full sm:mt-3 w-64 rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-3 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] border border-white/15 z-50 flex flex-col gap-1"
                >
                  {/* User Header */}
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 rounded-full bg-[#1c1c22] border border-white/20 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
                      {user.avatar_url ? (
                        <img
                          src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username, null, 'w185', 'person')}
                          alt={user.display_name || user.username}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-5 h-5 text-white/80" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">
                        {user.display_name || user.username}
                      </div>
                      <div className="text-[10px] font-mono text-white/50 truncate">
                        @{user.username}
                      </div>
                      {user.role === 'admin' ? (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                          Yönetici
                        </span>
                      ) : (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-mono bg-white/10 text-white/70 border border-white/10">
                          Üye
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Navigation Options */}
                  <Link
                    href={`/profil/${encodeURIComponent(user.username)}`}
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <User className="w-4 h-4 text-sky-400" />
                    <span>Profilim</span>
                  </Link>

                  <Link
                    href="/kutuphane"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <Library className="w-4 h-4 text-sky-400" />
                    <span>Kütüphanem</span>
                  </Link>

                  <Link
                    href="/gecmis"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span>İzleme Geçmişim</span>
                  </Link>

                  <Link
                    href="/listelerim"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <FolderHeart className="w-4 h-4 text-sky-400" />
                    <span>Özel Listelerim</span>
                  </Link>

                  <Link
                    href="/ayarlar"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <Settings className="w-4 h-4 text-sky-400" />
                    <span>Ayarlar</span>
                  </Link>

                  {user.role === 'admin' && (
                    <Link
                      href="/admin"
                      prefetch={true}
                      onClick={() => {
                        triggerSound('click');
                        setProfileDropdownOpen(false);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-amber-300 hover:text-amber-200 hover:bg-amber-400/15 transition-colors duration-100 ease-out"
                    >
                      <ShieldCheck className="w-4 h-4 text-amber-400" />
                      <span>Admin Paneli</span>
                    </Link>
                  )}

                  {/* Divider line */}
                  <div className="h-px bg-white/10 my-1" />

                  {/* Logout button */}
                  <button
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 transition-colors duration-100 ease-out cursor-pointer text-left"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    <span>Çıkış Yap</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="group flex items-center gap-2 px-4.5 py-2 rounded-full glass-pill text-xs font-semibold text-white/90 hover:text-white hover:bg-white/[0.22] hover:border-white/45 hover:shadow-[0_0_16px_rgba(255,255,255,0.16)] focus-visible:bg-white/[0.22] focus-visible:border-white/45 focus:outline-none transition-all duration-200 cursor-pointer select-none"
            aria-label="Giriş Yap"
          >
            <LogIn className="w-3.5 h-3.5 text-white/70 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300" />
            <span>Giriş Yap</span>
          </button>
        )}
      </div>
      </header>
      </div>

      {/* Mobile Navigation Drawer with Backdrop */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="pointer-events-auto fixed inset-0 z-40 bg-black/75 backdrop-blur-md lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="pointer-events-auto lg:hidden fixed top-0 left-0 bottom-0 w-[290px] max-w-[85vw] h-full bg-[#0a0a0c]/98 backdrop-blur-2xl p-6 border-r border-white/15 shadow-2xl z-50 flex flex-col justify-between"
            >
              {/* Drawer Top Header */}
              <div>
                <div className="flex items-center justify-between pb-6 border-b border-white/10">
                  <div className="flex items-center gap-2.5">
                    <img
                      src="/logo-dark.png"
                      alt="KoUp"
                      className="h-8 w-auto object-contain"
                    />
                    <span className="text-base font-bold text-white tracking-wider">
                      KoUp
                    </span>
                  </div>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
                    aria-label="Kapat"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Navigation Links with touch targets >= 44px */}
                <div className="py-6 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)] no-scrollbar">
                  {NAV_LINKS.map((item) => {
                    const Icon = item.icon;
                    const active = isNavActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className={`flex items-center gap-3.5 px-4 min-h-[48px] rounded-2xl text-sm font-semibold transition-all ${
                          active
                            ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.3)]'
                            : 'text-white/75 hover:text-white hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Drawer Bottom Auth/Profile Section */}
              <div className="pt-4 border-t border-white/10">
                {user ? (
                  <div className="space-y-3">
                    <Link
                      href={`/profil/${encodeURIComponent(user.username)}`}
                      prefetch={true}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 p-2 rounded-2xl hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 border border-white/15 shrink-0 flex items-center justify-center">
                        {user.avatar_url ? (
                          <img
                            src={getProxiedImageUrl(
                              user.avatar_url,
                              user.display_name || user.username,
                              null,
                              'w185',
                              'person'
                            )}
                            alt={user.display_name || user.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-5 h-5 text-white/80" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-white truncate">
                          {user.display_name || user.username}
                        </div>
                        <div className="text-xs text-white/50 truncate">
                          @{user.username}
                        </div>
                      </div>
                    </Link>

                    {/* Quick Profile Navigation for Mobile */}
                    <div className="grid grid-cols-2 gap-1.5 py-1">
                      <Link
                        href="/kutuphane"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08]"
                      >
                        <Library className="w-3.5 h-3.5 text-sky-400" />
                        <span>Kütüphanem</span>
                      </Link>
                      <Link
                        href="/gecmis"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08]"
                      >
                        <Clock className="w-3.5 h-3.5 text-sky-400" />
                        <span>İzleme Geçmişi</span>
                      </Link>
                      <Link
                        href="/listelerim"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08]"
                      >
                        <FolderHeart className="w-3.5 h-3.5 text-sky-400" />
                        <span>Özel Listelerim</span>
                      </Link>
                      <Link
                        href="/ayarlar"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08]"
                      >
                        <Settings className="w-3.5 h-3.5 text-sky-400" />
                        <span>Ayarlar</span>
                      </Link>
                    </div>

                    <button
                      onClick={() => {
                        triggerSound('click');
                        setMobileMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Çıkış Yap</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setIsAuthModalOpen(true);
                    }}
                    className="w-full min-h-[48px] rounded-2xl bg-white text-black font-bold text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-all"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Giriş Yap / Kayıt Ol</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Fullscreen Search Overlay Modal */}
      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto md:hidden fixed inset-0 z-50 bg-[#0a0a0c]/98 backdrop-blur-3xl p-4 flex flex-col"
          >
            {/* Top Search Input Bar */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/10">
              <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white/10 border border-white/15 focus-within:border-sky-400">
                <Search className="w-4 h-4 text-white/60 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim()) {
                      setMobileSearchOpen(false);
                      router.push(`/kesfet?q=${encodeURIComponent(query.trim())}`);
                    }
                  }}
                  placeholder="İçerik veya oyuncu ara..."
                  className="bg-transparent text-sm text-white placeholder-white/40 focus:outline-none w-full"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="text-white/50 hover:text-white p-1"
                    aria-label="Temizle"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  setMobileSearchOpen(false);
                  setQuery('');
                }}
                className="px-3 py-2 text-xs font-semibold text-white/80 hover:text-white cursor-pointer"
              >
                Kapat
              </button>
            </div>

            {/* Live Search Results in Mobile Modal */}
            <div className="flex-1 overflow-y-auto py-3 space-y-4 no-scrollbar">
              {query.trim().length >= 2 && (
                <>
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">
                      Sonuçlar
                    </span>
                    <Link
                      href={`/kesfet?q=${encodeURIComponent(query)}`}
                      prefetch={true}
                      onClick={() => setMobileSearchOpen(false)}
                      className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium"
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      <span>Gelişmiş Filtre</span>
                    </Link>
                  </div>

                  {isSearching ? (
                    <div className="py-12 text-center text-xs text-white/50 animate-pulse">
                      Arşiv taranıyor...
                    </div>
                  ) : mediaResults.length === 0 && personResults.length === 0 ? (
                    <div className="py-12 text-center text-xs text-white/50">
                      &ldquo;{query}&rdquo; için eşleşen kayıt bulunamadı.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {mediaResults.length > 0 && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">
                            Diziler, Animeler & Filmler
                          </div>
                          <div className="space-y-2">
                            {mediaResults.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => {
                                  setMobileSearchOpen(false);
                                  router.push(`/seri/${m.slug}`);
                                }}
                                className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-left group cursor-pointer border border-white/[0.06]"
                              >
                                <img
                                  src={getProxiedImageUrl(m.cover_image, m.title)}
                                  alt={m.title}
                                  width={44}
                                  height={62}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-11 h-16 object-cover rounded-xl border border-white/10 shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-white truncate">
                                    {m.title}
                                  </div>
                                  <div className="text-[11px] text-white/50 flex flex-wrap items-center gap-1.5 mt-1">
                                    <span
                                      className={getNavTypeBadgeClass(
                                        m.content_type,
                                        m.country_code || (m as any).country
                                      )}
                                    >
                                      {formatContentTypeTR(
                                        m.content_type,
                                        m.country_code || (m as any).country
                                      )}
                                    </span>
                                    {m.release_year && (
                                      <span>• {m.release_year}</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {personResults.length > 0 && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">
                            Oyuncular & Karakterler
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {personResults.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => {
                                  setMobileSearchOpen(false);
                                  router.push(`/oyuncu/${p.slug}`);
                                }}
                                className="flex items-center gap-2.5 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-left cursor-pointer border border-white/[0.06]"
                              >
                                <img
                                  src={getProxiedImageUrl(p.image_url, p.name, null, 'w185', 'person')}
                                  alt={p.name}
                                  width={36}
                                  height={36}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-9 h-9 object-cover rounded-full border border-white/10 shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-white truncate">
                                    {p.name}
                                  </div>
                                  <div className="text-[10px] text-white/40 capitalize truncate">
                                    {p.person_type}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Glass Auth Modal (Portaled to document.body) */}
      <AuthModal />
    </>
  );
}
