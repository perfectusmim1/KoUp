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
  Film,
  Trophy,
  Volume2,
  VolumeX,
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
  Heart,
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
import { dedupeAndSortNotifications } from '@/lib/notifications';
import { useKoUpSelector } from '@/context/KoUpContext';
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

function NavbarNotificationThumbnail({
  notification,
  CatIcon,
  catColor,
}: {
  notification: any;
  CatIcon: any;
  catColor: string;
}) {
  const [imageError, setImageError] = useState(false);
  const link = notification.linkUrl || notification.link_url;

  let rawImg: string | null = notification.imageUrl || notification.image_url || null;

  if (!rawImg) {
    if (notification.type === 'episode' || (link && link.startsWith('/seri/'))) {
      const title = notification.title?.includes('•')
        ? notification.title.split('•')[0].trim()
        : (notification.title || '').trim();
      if (title) {
        rawImg = getProxiedImageUrl(null, title, null, 'w185', 'media');
      }
    } else if (notification.type === 'actor' || (link && link.startsWith('/oyuncu/'))) {
      const name = notification.title?.includes('•')
        ? notification.title.split('•')[0].trim()
        : (notification.title || '').trim();
      if (name) {
        rawImg = getProxiedImageUrl(null, name, null, 'w185', 'person');
      }
    }
  } else {
    rawImg = getProxiedImageUrl(
      rawImg,
      notification.title,
      null,
      'w185',
      notification.type === 'actor' ? 'person' : 'media'
    );
  }

  if (imageError || !rawImg) {
    return (
      <div
        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${catColor}`}
      >
        <CatIcon className="w-4 h-4" />
      </div>
    );
  }

  if (notification.type === 'episode' || (link && link.startsWith('/seri/'))) {
    return (
      <div className="relative w-9 aspect-[2/3] rounded-lg overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-sm mt-0.5">
        <img
          src={rawImg}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  if (notification.type === 'actor' || notification.type === 'reply') {
    return (
      <div className="relative w-9 h-9 rounded-full overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-sm mt-0.5">
        <img
          src={rawImg}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="relative w-9 h-9 rounded-xl overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-sm mt-0.5">
      <img
        src={rawImg}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setImageError(true)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useKoUpSelector((s) => s.user);
  const profile = useKoUpSelector((s) => s.profile);
  const notifications = useKoUpSelector((s) => s.notifications);
  const unreadCount = useKoUpSelector((s) => s.unreadCount);
  const markNotificationsRead = useKoUpSelector((s) => s.markNotificationsRead);
  const markAllNotificationsRead = useKoUpSelector((s) => s.markAllNotificationsRead);
  const markNotificationRead = useKoUpSelector((s) => s.markNotificationRead);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const soundEnabled = useKoUpSelector((s) => s.soundEnabled);
  const toggleSound = useKoUpSelector((s) => s.toggleSound);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const logout = useKoUpSelector((s) => s.logout);
  const navbarBehavior = useKoUpSelector((s) => s.navbarBehavior);
  const floatingNavbarEnabled = useKoUpSelector((s) => s.floatingNavbarEnabled);

  const dedupedNotifications = React.useMemo(() => {
    return dedupeAndSortNotifications(notifications);
  }, [notifications]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mediaResults, setMediaResults] = useState<MediaItem[]>([]);
  const [personResults, setPersonResults] = useState<PersonItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [osShortcut, setOsShortcut] = useState<'⌘K' | 'Ctrl K'>('Ctrl K');

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const isMac = /Mac|iPod|iPhone|iPad/i.test(navigator.userAgent || navigator.platform || '');
      setOsShortcut(isMac ? '⌘K' : 'Ctrl K');
    }
  }, []);

  const [isScrolled, setIsScrolled] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);

  const isScrolledRef = useRef(false);

  // Scroll listener for dynamic floating glass island navbar (throttled to avoid layout thrashing)
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 20;
      if (scrolled !== isScrolledRef.current) {
        isScrolledRef.current = scrolled;
        setIsScrolled(scrolled);
      }
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
              p_limit: 24,
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
              let queryBuilder = supabase
                .from('media')
                .select('id, slug, title, native_title, content_type, country_code, release_year, cover_image, backdrop_image, mdl_rating, anilist_rating, imdb_rating, categories, episode_count, views_total');

              const tokens = raw.trim().split(/\s+/).filter(Boolean);
              if (tokens.length > 1) {
                for (const t of tokens) {
                  queryBuilder = queryBuilder.or(`title.ilike.%${t}%,slug.ilike.%${t}%,search_text.ilike.%${t}%`);
                }
              } else {
                queryBuilder = queryBuilder.or(`title.ilike.%${raw}%,slug.ilike.%${normalized || raw}%,search_text.ilike.%${normalized || raw}%`);
              }

              const { data: directMedia } = await queryBuilder
                .order('views_total', { ascending: false, nullsFirst: false })
                .limit(24);

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
        const mediaItems = rankSearchResults((mList as MediaItem[]) || [], raw).slice(0, 8);
        registerMediaItems(mediaItems);
        setMediaResults(mediaItems);
        setPersonResults((pList as PersonItem[]) || []);
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    }, 120);

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

  // Lock body scroll and dynamic viewport rubber-banding with rAF to prevent animation hitching on mobile
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    // Microtask/rAF prevents synchronous forced layout reflow during drawer slide-in transition
    const timer = setTimeout(() => {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    }, 16);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [mobileMenuOpen]);

  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [navPillStyle, setNavPillStyle] = useState<{
    x: number;
    w: number;
    visible: boolean;
    ready: boolean;
  }>({
    x: 0,
    w: 0,
    visible: false,
    ready: false,
  });

  // Sync optimistic navigation path with router pathname
  useEffect(() => {
    setOptimisticPath(pathname);
  }, [pathname]);

  const activePath = optimisticPath ?? pathname;
  const isNavActive = (href: string) => {
    if (href === '/') return activePath === '/';
    return activePath === href || activePath.startsWith(`${href}/`);
  };

  useEffect(() => {
    const updatePill = () => {
      const activeItem = NAV_LINKS.find((item) => {
        if (item.href === '/') return activePath === '/';
        return activePath === item.href || activePath.startsWith(`${item.href}/`);
      });
      if (!activeItem) {
        setNavPillStyle((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }
      const el = navLinkRefs.current[activeItem.href];
      if (el && el.offsetWidth > 0) {
        setNavPillStyle((prev) => ({
          x: el.offsetLeft,
          w: el.offsetWidth,
          visible: true,
          ready: prev.visible,
        }));
      }
    };
    updatePill();
    window.addEventListener('resize', updatePill);
    return () => window.removeEventListener('resize', updatePill);
  }, [activePath]);

  return (
    <>
      <div
        suppressHydrationWarning
        className={`top-0 left-0 right-0 z-50 flex justify-center pointer-events-none transition-all duration-300 ${
          navbarBehavior === 'static' ? 'absolute' : 'fixed'
        }`}
      >
        <header
          className={`pointer-events-auto flex items-center justify-between outline-none transition-[width,max-width,margin-top,padding,border-radius,background-color,box-shadow,border-color] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            navbarBehavior === 'floating'
              ? isScrolled
                ? 'mt-2 sm:mt-3 max-w-[1620px] w-[95%] sm:w-[92%] xl:w-[90%] rounded-2xl sm:rounded-[28px] bg-[#0a0b10]/95 backdrop-blur-xl border-0 shadow-[0_20px_50px_rgba(0,0,0,0.85)] py-2 sm:py-2.5 px-4 sm:px-6'
                : 'mt-0 w-full max-w-[2560px] rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent border-0 shadow-none py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
              : navbarBehavior === 'sticky'
              ? isScrolled
                ? 'mt-0 w-full max-w-[2560px] rounded-none bg-[#0a0b10]/95 backdrop-blur-xl border-0 shadow-[0_12px_32px_rgba(0,0,0,0.85)] py-3 sm:py-4 px-4 sm:px-8 lg:px-14'
                : 'mt-0 w-full max-w-[2560px] rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent border-0 shadow-none py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
              : /* static: sitenin üstünde kalır, sayfa kayınca bizle gelmez */
                'mt-0 w-full max-w-[2560px] rounded-none bg-gradient-to-b from-black/60 via-black/25 to-transparent border-0 shadow-none py-3.5 sm:py-5 px-4 sm:px-8 lg:px-14'
          }`}
        >
      {/* LEFT: Brand Mark (Original KU Logo — No Circle or Box Wrapper) */}
      <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="lg:hidden w-10 h-10 rounded-full bg-black/40 hover:bg-white/12 border border-white/[0.10] hover:border-white/[0.18] backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white cursor-pointer select-none focus:outline-none focus-visible:outline-none transition-all duration-200"
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

      {/* CENTER: Liquid Glass Pill Menu + Fluid Sliding Translucent Pill */}
      <nav className="relative pointer-events-auto hidden lg:flex items-center shrink-0 p-1.5 rounded-full liquid-glass-bar">
        <span
          aria-hidden="true"
          style={{
            transform: `translate3d(${navPillStyle.x}px, 0, 0)`,
            width: `${navPillStyle.w}px`,
            opacity: navPillStyle.visible ? 1 : 0,
          }}
          className={`pointer-events-none absolute top-1.5 bottom-1.5 left-0 rounded-full liquid-glass-active-pill ${
            navPillStyle.ready
              ? 'transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
              : 'transition-opacity duration-150'
          }`}
        />
        {NAV_LINKS.map((item) => {
          const active = isNavActive(item.href);
          return (
            <Link
              key={item.href}
              ref={(node) => {
                navLinkRefs.current[item.href] = node;
              }}
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
              onMouseEnter={() => {
                triggerSound('hover');
                router.prefetch(item.href);
              }}
              className={`relative px-5 py-2 rounded-full text-[13px] font-semibold transition-colors duration-200 select-none ${
                active
                  ? 'text-white'
                  : 'text-white/65 hover:text-white'
              }`}
            >
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
          className="md:hidden w-10 h-10 rounded-full bg-black/40 hover:bg-white/12 border border-white/[0.10] hover:border-white/[0.18] backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white cursor-pointer transition-all duration-200"
          aria-label="Arama Yap"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Desktop Instant Search Bar / Trigger (>= md) */}
        <div ref={searchContainerRef} className="relative hidden md:block">
          <div
            className={`navbar-search-bar flex items-center gap-2 px-3.5 py-2 rounded-full backdrop-blur-md transition-all duration-150 ease-out ${
              isSearchFocused
                ? 'w-60 lg:w-72 bg-[#121318] border border-white/30 shadow-[0_0_16px_rgba(255,255,255,0.12)]'
                : 'w-44 lg:w-64 bg-black/40 hover:bg-black/60 border border-white/[0.10] hover:border-white/[0.18]'
            }`}
          >
            <Search className={`w-4 h-4 shrink-0 transition-colors duration-150 ${isSearchFocused ? 'text-white' : 'text-white/75'}`} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onFocus={() => {
                setIsSearchFocused(true);
                setSearchOpen(true);
              }}
              onBlur={() => {
                setIsSearchFocused(false);
              }}
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
              className="bg-transparent text-xs text-white placeholder-white/55 focus:outline-none w-full"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                className="text-white/60 hover:text-white cursor-pointer"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd
                suppressHydrationWarning
                className="hidden xl:inline-block text-[10px] font-mono text-white/50 px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08]"
              >
                {osShortcut}
              </kbd>
            )}
          </div>

          {/* Search Omnibox Dropdown */}
          <AnimatePresence>
            {searchOpen && query.trim().length >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 mt-3 w-[calc(100vw-2.5rem)] sm:w-[440px] max-w-[440px] rounded-3xl bg-[#0e0f14]/96 backdrop-blur-xl p-4 shadow-[0_28px_64px_rgba(0,0,0,0.95)] border border-white/[0.10] z-50"
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
                              aria-label={cleanMediaTitle(m.title)}
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
                              aria-label={p.name}
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
            className={`w-10 h-10 rounded-full flex items-center justify-center relative cursor-pointer backdrop-blur-md transition-all duration-200 focus:outline-none ${
              notifOpen
                ? 'bg-white/20 border border-white/30 text-white'
                : 'bg-black/40 hover:bg-white/12 border border-white/[0.10] hover:border-white/[0.18] text-white/80 hover:text-white'
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
                className="fixed left-3 right-3 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[410px] sm:max-w-[410px] rounded-3xl bg-[#0e0f14]/96 backdrop-blur-xl p-4 shadow-[0_28px_64px_rgba(0,0,0,0.95)] border border-white/[0.10] z-50 flex flex-col gap-3"
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
                          {/* Poster / Avatar / Category Thumbnail */}
                          <NavbarNotificationThumbnail
                            notification={n}
                            CatIcon={CatIcon}
                            catColor={catColor}
                          />

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
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/25 hover:border-amber-400/40 text-xs font-medium text-amber-300 backdrop-blur-md transition-all duration-200 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
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
              className={`group flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full backdrop-blur-md transition-all duration-200 cursor-pointer select-none relative focus:outline-none ${
                profileDropdownOpen
                  ? 'bg-white/20 border border-white/30 text-white'
                  : 'bg-black/40 hover:bg-white/12 border border-white/[0.10] hover:border-white/[0.18] text-white/90 hover:text-white'
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
                  className="fixed right-3 top-20 sm:absolute sm:right-0 sm:top-full sm:mt-3 w-64 rounded-3xl bg-[#0e0f14]/96 backdrop-blur-xl p-3 shadow-[0_28px_64px_rgba(0,0,0,0.95)] border border-white/[0.10] z-50 flex flex-col gap-1"
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
                    <User className="w-4 h-4 text-indigo-400" />
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
                    <Library className="w-4 h-4 text-purple-400" />
                    <span>Kütüphanem</span>
                  </Link>

                  <Link
                    href="/favoriler"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <Heart className="w-4 h-4 text-rose-500 fill-rose-500/20" />
                    <span>Favorilerim</span>
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
                    <Clock className="w-4 h-4 text-cyan-400" />
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
                    <FolderHeart className="w-4 h-4 text-emerald-400" />
                    <span>Özel Listelerim</span>
                  </Link>

                  <Link
                    href="/takip-edilenler"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <UserCheck className="w-4 h-4 text-fuchsia-400" />
                    <span>Takip Edilenler</span>
                  </Link>

                  <Link
                    href="/seri-istek"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.10] transition-colors duration-100 ease-out"
                  >
                    <Sparkles className="w-4 h-4 text-sky-400" />
                    <span>Seri İstek</span>
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
                    <Settings className="w-4 h-4 text-blue-400" />
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
            className="group flex items-center gap-2 px-4 py-2 rounded-full bg-black/40 hover:bg-white/12 border border-white/[0.10] hover:border-white/[0.18] backdrop-blur-md text-xs font-semibold text-white/90 hover:text-white transition-all duration-200 cursor-pointer select-none"
            aria-label="Giriş Yap"
          >
            <LogIn className="w-3.5 h-3.5 text-white/70 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300" />
            <span>Giriş Yap</span>
          </button>
        )}
      </div>
      </header>
      </div>

      {/* Mobile Navigation Drawer with Smoked Frosted Glass & Quick Discovery */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileMenuOpen(false)}
              className="pointer-events-auto fixed inset-0 z-40 bg-black/75 backdrop-blur-sm touch-none overscroll-none lg:hidden transform-gpu will-change-[opacity]"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto lg:hidden fixed inset-y-0 left-0 w-[310px] sm:w-[350px] max-w-[86vw] h-full h-dvh bg-[#0a0b10]/95 backdrop-blur-2xl p-4 sm:p-5 border-r border-white/[0.08] shadow-[24px_0_60px_rgba(0,0,0,0.95)] z-50 flex flex-col justify-between overflow-y-auto overscroll-contain touch-pan-y transform-gpu will-change-transform no-scrollbar"
            >
              {/* Subtle Ambient Specular Sheen */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -left-16 w-80 h-80 rounded-full bg-gradient-to-br from-white/[0.08] via-indigo-500/[0.03] to-transparent blur-3xl"
              />

              {/* Drawer Top Header + Search + Quick Categories */}
              <div className="relative z-10 flex flex-col min-h-0 flex-1">
                {/* Brand Header */}
                <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.08]">
                  <Link
                    href="/"
                    prefetch={true}
                    onClick={() => {
                      triggerSound('click');
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-2.5 group"
                  >
                    <img
                      src="/logo-dark.png"
                      alt="KoUp"
                      className="h-8 w-auto object-contain drop-shadow-[0_4px_14px_rgba(255,255,255,0.22)]"
                    />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px] font-bold text-white tracking-wider leading-none">
                          KoUp
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-white/10 border border-white/15 text-white/90">
                          TV+
                        </span>
                      </div>
                      <span className="text-[8.5px] tracking-[0.22em] font-medium uppercase text-white/40 mt-1">
                        Cinema Studio
                      </span>
                    </div>
                  </Link>
                  <button
                    onClick={() => {
                      triggerSound('click');
                      setMobileMenuOpen(false);
                    }}
                    className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 border border-white/[0.10] flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                    aria-label="Kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Primary Navigation Links */}
                <div className="pt-3 space-y-1.5 overflow-y-auto flex-1 no-scrollbar pr-0.5">
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
                        className={`group flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-150 ${
                          active
                            ? 'bg-white/[0.12] text-white border border-white/[0.16] shadow-xs'
                            : 'text-white/70 hover:text-white hover:bg-white/[0.05] border border-transparent hover:border-white/[0.07]'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                              active
                                ? 'bg-white/20 border border-white/25 text-white'
                                : 'bg-white/[0.04] border border-white/[0.07] text-white/60 group-hover:text-white group-hover:bg-white/[0.08]'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                          </span>
                          <span>{item.label}</span>
                        </span>
                        {active ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 transition-colors" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>

              {/* Drawer Bottom Profile Dock */}
              <div className="relative z-10 pt-3 border-t border-white/[0.08]">

                {user ? (
                  <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] space-y-2">
                    <Link
                      href={`/profil/${encodeURIComponent(user.username)}`}
                      prefetch={true}
                      onClick={() => {
                        triggerSound('click');
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center justify-between gap-2.5 p-1 rounded-xl hover:bg-white/[0.06] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-white/12 border border-white/20 shrink-0 flex items-center justify-center shadow-xs">
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
                            <User className="w-4 h-4 text-white/85" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {user.display_name || user.username}
                          </div>
                          <div className="text-[10px] font-mono text-white/50 truncate">
                            @{user.username}
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-white/[0.10] border border-white/[0.16] text-white/80 shrink-0">
                        {user.role === 'admin' ? 'Yönetici' : 'Profil'}
                      </span>
                    </Link>

                    {/* Quick Profile Navigation for Mobile */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <Link
                        href="/kutuphane"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <Library className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        <span className="truncate">Kütüphanem</span>
                      </Link>
                      <Link
                        href="/gecmis"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="truncate">Geçmişim</span>
                      </Link>
                      <Link
                        href="/listelerim"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <FolderHeart className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">Listelerim</span>
                      </Link>
                      <Link
                        href="/takip-edilenler"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                        <span className="truncate">Takip Edilenler</span>
                      </Link>
                      <Link
                        href="/favoriler"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500/20 shrink-0" />
                        <span className="truncate">Favorilerim</span>
                      </Link>
                      <Link
                        href="/seri-istek"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="truncate">Seri İstek</span>
                      </Link>
                      <Link
                        href="/ayarlar"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.07] text-[11px] font-medium text-white/85 hover:text-white transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="truncate">Ayarlar</span>
                      </Link>
                    </div>

                    {user.role === 'admin' && (
                      <Link
                        href="/admin"
                        prefetch={true}
                        onClick={() => {
                          triggerSound('click');
                          setMobileMenuOpen(false);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-1.5 rounded-xl bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/20 text-[11px] font-medium text-amber-300 hover:text-amber-200 transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>Admin Paneli</span>
                      </Link>
                    )}

                    <button
                      onClick={() => {
                        triggerSound('click');
                        setMobileMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] font-medium text-rose-300 hover:text-rose-200 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-400" />
                      <span>Çıkış Yap</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-2xl bg-gradient-to-b from-white/[0.07] to-white/[0.02] border border-white/[0.08] space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-amber-400/20 flex items-center justify-center">
                        <Sparkles className="w-3 h-3 text-amber-300" />
                      </span>
                      <span className="text-xs font-bold text-white tracking-wide">
                        KoUp Dünyasına Katıl
                      </span>
                    </div>
                    <p className="text-[11px] text-white/55 leading-relaxed">
                      Kişisel listenizi oluşturun, kaldığınız yeri senkronize edin ve yeni bölümlerden haberdar olun.
                    </p>
                    <button
                      onClick={() => {
                        triggerSound('click');
                        setMobileMenuOpen(false);
                        setIsAuthModalOpen(true);
                      }}
                      className="w-full min-h-[42px] rounded-xl bg-white text-black font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-[0_4px_16px_rgba(255,255,255,0.18)] hover:bg-white/90 active:scale-[0.98] transition-all"
                    >
                      <LogIn className="w-4 h-4" />
                      <span>Giriş Yap / Kayıt Ol</span>
                    </button>
                  </div>
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
            className="pointer-events-auto md:hidden fixed inset-0 z-50 bg-[#0b0c12]/96 backdrop-blur-2xl p-4 flex flex-col"
          >
            {/* Top Search Input Bar */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-white/10">
              <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/50 border border-white/[0.12] focus-within:border-white/30 focus-within:bg-[#121318] focus-within:shadow-[0_0_16px_rgba(255,255,255,0.12)] transition-all">
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
                aria-label="Aramayı Kapat"
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
                                aria-label={m.title}
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
                                aria-label={p.name}
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
