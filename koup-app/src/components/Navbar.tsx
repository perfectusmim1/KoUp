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
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
  formatContentTypeTR,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AuthModal from '@/components/AuthModal';
import { cachedQuery } from '@/lib/cache';

const NAV_LINKS = [
  { href: '/', label: 'Ana Sayfa', icon: Home },
  { href: '/kesfet', label: 'Keşfet', icon: Compass },
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
  } = useKoUp();

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mediaResults, setMediaResults] = useState<MediaItem[]>([]);
  const [personResults, setPersonResults] = useState<PersonItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);

  // Instant Omnibox Search (Debounced 160ms)
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setMediaResults([]);
      setPersonResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const cacheKey = `omnibox_${trimmed.toLowerCase()}`;
        const [mList, pList] = await cachedQuery(cacheKey, 60_000, async () => {
          const [mRes, pRes] = await Promise.all([
            supabase.rpc('search_catalog', {
              p_query: trimmed,
              p_limit: 8,
            }),
            supabase
              .from('people')
              .select('id, slug, name, native_name, person_type, image_url, favorites_count')
              .ilike('name', `%${trimmed}%`)
              .order('favorites_count', { ascending: false })
              .limit(4),
          ]);
          return [
            (mRes.data as MediaItem[]) || [],
            (pRes.data as PersonItem[]) || [],
          ] as const;
        });

        setMediaResults(mList as MediaItem[]);
        setPersonResults(pList as PersonItem[]);
      } finally {
        setIsSearching(false);
      }
    }, 160);

    return () => clearTimeout(timer);
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
        setNotifOpen(false);
        setMobileMenuOpen(false);
        setProfileDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isNavActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className="fixed top-5 left-0 right-0 z-50 pointer-events-none px-5 lg:px-14 flex items-center justify-between">
      {/* LEFT: Brand Mark (Original KU Logo — No Circle or Box Wrapper) */}
      <div className="pointer-events-auto flex items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="lg:hidden w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white cursor-pointer"
          aria-label="Menü"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link
          href="/"
          onClick={() => triggerSound('click')}
          className="flex items-center gap-3 group"
        >
          <img
            src="/logo-dark.png"
            alt="KoUp"
            className="h-9 w-auto object-contain transition-transform duration-300 group-hover:scale-105 drop-shadow-[0_4px_16px_rgba(255,255,255,0.2)]"
          />
          <div className="flex flex-col">
            <span className="text-[16px] font-bold tracking-wider text-white leading-none">
              KoUp
              <span className="text-white/55 font-light ml-1 text-[13px]">
                TV+
              </span>
            </span>
            <span className="text-[9px] tracking-[0.22em] font-medium uppercase text-white/40 mt-1">
              Cinema Studio
            </span>
          </div>
        </Link>
      </div>

      {/* CENTER: Floating Glassy Pill Menu (Exact ui/code.html style + Fluid Spring Pill Slider) */}
      <nav className="pointer-events-auto hidden lg:flex items-center p-1.5 rounded-full glass-pill-dark shadow-[0_16px_40px_rgba(0,0,0,0.75)]">
        {NAV_LINKS.map((item) => {
          const active = isNavActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => triggerSound('click')}
              onMouseEnter={() => triggerSound('hover')}
              className={`relative px-5 py-2 rounded-full text-[13px] font-semibold transition-colors duration-200 select-none ${
                active ? 'text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="koup-navbar-active-pill"
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                    mass: 0.8,
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
      <div className="pointer-events-auto flex items-center gap-2.5">
        {/* Instant Search Bar / Trigger */}
        <div ref={searchContainerRef} className="relative">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/50 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 w-44 sm:w-60 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.25)]">
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
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-white group-hover:text-white truncate">
                                  {m.title}
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
                                src={getProxiedImageUrl(p.image_url, p.name)}
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
            onClick={() => setNotifOpen((v) => !v)}
            className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/80 hover:text-white relative cursor-pointer transition-all hover:border-[var(--accent-blue)]/40 hover:shadow-[0_0_15px_rgba(41,151,255,0.2)]"
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
                className="absolute right-0 mt-3 w-[calc(100vw-2.5rem)] sm:w-[410px] max-w-[410px] rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-4 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.12)] border border-white/15 z-50 flex flex-col gap-3"
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
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllNotificationsRead()}
                        className="text-[11px] font-semibold text-amber-300 hover:text-amber-200 transition-colors cursor-pointer flex items-center gap-1"
                        title="Tümünü Okundu İşaretle"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Tümünü Oku</span>
                      </button>
                    )}
                    <button
                      onClick={() => setNotifOpen(false)}
                      className="text-[11px] text-white/50 hover:text-white cursor-pointer px-1.5 py-0.5 rounded-lg hover:bg-white/10"
                    >
                      Kapat
                    </button>
                  </div>
                </div>

                {/* Notifications List */}
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-white/50 space-y-1">
                      <Bell className="w-5 h-5 text-white/30 mx-auto mb-1" />
                      <p>Yeni bildiriminiz yok.</p>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const href = n.linkUrl || (n as any).link_url;
                      const isUnread = !n.isRead;

                      // Category Icon Picker
                      let CatIcon = Sparkles;
                      let catColor = 'bg-purple-500/20 text-purple-300 border-purple-400/30';
                      if (n.type === 'episode') {
                        CatIcon = Tv;
                        catColor = 'bg-sky-500/20 text-sky-300 border-sky-400/30';
                      } else if (n.type === 'actor') {
                        CatIcon = UserCheck;
                        catColor = 'bg-amber-500/20 text-amber-300 border-amber-400/30';
                      } else if (n.type === 'reply') {
                        CatIcon = MessageSquare;
                        catColor = 'bg-sky-500/20 text-sky-300 border-sky-400/30';
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
            title="Admin Kontrol Merkezi"
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
              className="flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full glass-pill hover:border-white/30 transition-all cursor-pointer relative"
              aria-label="Kullanıcı Menüsü"
              aria-expanded={profileDropdownOpen}
            >
              <div className="w-7 h-7 rounded-full bg-white/15 border border-white/20 flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden shadow-xs">
                {user.avatar_url ? (
                  <img
                    src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <span className="hidden md:inline text-xs font-semibold text-white max-w-[110px] truncate">
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
                  className="absolute right-0 mt-3 w-64 rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-3 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] border border-white/15 z-50 flex flex-col gap-1"
                >
                  {/* User Header */}
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 rounded-full bg-[#1c1c22] border border-white/20 flex items-center justify-center shrink-0 overflow-hidden shadow-inner">
                      {user.avatar_url ? (
                        <img
                          src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username)}
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
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <User className="w-4 h-4 text-sky-400" />
                    <span>Profilim</span>
                  </Link>

                  <Link
                    href={`/profil/${encodeURIComponent(user.username)}?tab=library`}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Bookmark className="w-4 h-4 text-sky-400" />
                    <span>Kütüphanem</span>
                  </Link>

                  <Link
                    href={`/profil/${encodeURIComponent(user.username)}?tab=history`}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Clock className="w-4 h-4 text-sky-400" />
                    <span>İzleme Geçmişim</span>
                  </Link>

                  <Link
                    href={`/profil/${encodeURIComponent(user.username)}?tab=settings`}
                    onClick={() => {
                      triggerSound('click');
                      setProfileDropdownOpen(false);
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Settings className="w-4 h-4 text-sky-400" />
                    <span>Ayarlar</span>
                  </Link>

                  {user.role === 'admin' && (
                    <Link
                      href="/admin"
                      onClick={() => {
                        triggerSound('click');
                        setProfileDropdownOpen(false);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-amber-300 hover:text-amber-200 hover:bg-amber-400/10 transition-colors"
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
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 transition-colors cursor-pointer text-left"
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
            onClick={() => setIsAuthModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full glass-pill text-xs font-semibold text-white hover:bg-white/15 cursor-pointer transition-all"
          >
            <LogIn className="w-3.5 h-3.5 text-white/70" />
            <span>Giriş Yap</span>
          </button>
        )}
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
              className="pointer-events-auto fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto lg:hidden fixed top-20 left-4 right-4 rounded-3xl bg-[#0f0f12]/95 backdrop-blur-2xl p-4 border border-white/15 shadow-2xl z-50 grid grid-cols-2 gap-2"
            >
              {NAV_LINKS.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-semibold transition-all ${
                      active
                        ? 'bg-white text-black'
                        : 'bg-white/[0.05] text-white/80 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Global Glass Auth Modal */}
      <div className="pointer-events-auto">
        <AuthModal />
      </div>
    </header>
  );
}
