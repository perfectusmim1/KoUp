'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  Bell,
  Menu,
  X,
  Compass,
  Tv,
  Film,
  Sparkles,
  Users,
  Calendar,
  Newspaper,
  ShieldCheck,
  User,
  Volume2,
  Dices,
  Play,
  Heart,
  LogOut,
  CheckCheck,
  Flame,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import {
  supabase,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
  COUNTRY_FLAGS,
} from '@/lib/supabase';
import { playNotificationChime } from '@/lib/sound';

const NAV_LINKS = [
  { href: '/', label: 'Ana Sayfa' },
  { href: '/kesfet?type=dizi', label: 'Diziler' },
  { href: '/kesfet?type=anime', label: 'Animeler' },
  { href: '/kesfet?type=film', label: 'Filmler' },
  { href: '/oyuncular', label: 'Oyuncular' },
  { href: '/magazin', label: 'Magazin' },
  { href: '/takvim', label: 'Takvim' },
  { href: '/kesfet', label: 'Keşfet' },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    notifications,
    activeToast,
    isSearchOpen,
    setIsSearchOpen,
    isAuthModalOpen,
    setIsAuthModalOpen,
    isRouletteOpen,
    setIsRouletteOpen,
    markAllNotificationsRead,
    dismissToast,
    loginWithEmail,
    registerWithEmail,
    logout,
  } = useKoUp();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Instant Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMedia, setSearchMedia] = useState<MediaItem[]>([]);
  const [searchPeople, setSearchPeople] = useState<PersonItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Smart Roulette state
  const [rouletteFilter, setRouletteFilter] = useState<'all' | 'dizi' | 'anime' | 'film'>('all');
  const [roulettePick, setRoulettePick] = useState<MediaItem | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  // Auth modal state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Multilingual instant search (Dramas, Anime, Movies + Actors/Characters)
  useEffect(() => {
    if (!isSearchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchMedia([]);
      setSearchPeople([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const [mRes, pRes] = await Promise.all([
        supabase
          .from('media')
          .select('*')
          .ilike('search_text', `%${q.toLowerCase()}%`)
          .order('sources_count', { ascending: false })
          .limit(8),
        supabase
          .from('people')
          .select('*')
          .ilike('name', `%${q}%`)
          .order('favorites_count', { ascending: false })
          .limit(6),
      ]);
      setSearchMedia((mRes.data as MediaItem[]) || []);
      setSearchPeople((pRes.data as PersonItem[]) || []);
      setIsSearching(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, isSearchOpen]);

  const spinRoulette = async () => {
    setIsSpinning(true);
    let query = supabase
      .from('media')
      .select('*')
      .gt('sources_count', 5)
      .order('views_total', { ascending: false })
      .limit(60);
    if (rouletteFilter !== 'all') {
      query = query.eq('content_type', rouletteFilter);
    }
    const { data } = await query;
    setTimeout(() => {
      if (data && data.length > 0) {
        const pick = data[Math.floor(Math.random() * data.length)] as MediaItem;
        setRoulettePick(pick);
        playNotificationChime('apple_glass', 0.6, true);
      }
      setIsSpinning(false);
    }, 650);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <>
      {/* TOP FLOATING APPLE TV+ NAVIGATION BAR */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 px-4 sm:px-8 lg:px-14 ${
          scrolled
            ? 'py-3 bg-[#08080A]/85 backdrop-blur-2xl border-b border-white/[0.07] shadow-[0_16px_40px_rgba(0,0,0,0.75)]'
            : 'py-5 bg-gradient-to-b from-black/80 via-black/35 to-transparent'
        }`}
      >
        <div className="max-w-[1680px] mx-auto flex items-center justify-between gap-4">
          {/* Left: Sidebar Trigger + KoUp Brand Mark */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Menüyü Aç"
              className="w-10 h-10 rounded-full apple-glass-pill flex items-center justify-center text-white/80 hover:text-white hover:border-sky-400/40 transition-all cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative w-10 h-10 rounded-2xl apple-glass-pill flex items-center justify-center overflow-hidden border border-white/15 group-hover:border-sky-400/50 transition-all shadow-lg">
                <img
                  src="/logo-dark.png"
                  alt="KoUp Logo"
                  className="w-8 h-8 object-contain transition-transform duration-500 group-hover:scale-110"
                />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-[17px] font-bold tracking-tight text-white">
                    Ko<span className="text-sky-400">Up</span>
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-white/10 text-amber-300 border border-amber-400/25">
                    PLUS
                  </span>
                </div>
                <span className="text-[9px] tracking-[0.22em] uppercase text-white/45 -mt-0.5">
                  Lumina Cinema
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Floating Glass Pill Menu */}
          <nav className="hidden xl:flex items-center p-1.5 rounded-full apple-glass shadow-2xl">
            {NAV_LINKS.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href.split('?')[0]) &&
                    item.href !== '/kesfet';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-all duration-300 ${
                    isActive
                      ? 'bg-white text-black font-semibold shadow-[0_0_24px_rgba(255,255,255,0.4)]'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.07]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: ⌘K Search + Roulette + Audio Notifications + Profile + Admin */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsSearchOpen(true)}
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-full apple-glass-pill text-white/75 hover:text-white hover:border-sky-400/40 transition-all cursor-pointer"
            >
              <Search className="w-4 h-4 text-sky-400" />
              <span className="hidden md:inline text-xs text-white/65">
                Dizi, anime, oyuncu ara...
              </span>
              <kbd className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/60 border border-white/10">
                ⌘K
              </kbd>
            </button>

            <button
              onClick={() => {
                setIsRouletteOpen(true);
                if (!roulettePick) spinRoulette();
              }}
              title="Ne İzlesem? Akıllı Kütüphane Ruleti"
              className="w-10 h-10 rounded-full apple-glass-pill flex items-center justify-center text-amber-300 hover:text-amber-200 hover:border-amber-400/40 transition-all cursor-pointer"
            >
              <Dices className="w-4 h-4" />
            </button>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => {
                  setIsNotifOpen((v) => !v);
                  if (!isNotifOpen) markAllNotificationsRead();
                }}
                aria-label="Bildirimler"
                className="relative w-10 h-10 rounded-full apple-glass-pill flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-sky-400 text-black text-[10px] font-bold flex items-center justify-center shadow-[0_0_12px_#38bdf8]">
                    {unreadCount}
                  </span>
                )}
              </button>

              {isNotifOpen && (
                <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-3xl apple-glass p-4 z-50 border border-white/15 shadow-2xl">
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">Bildirim Merkezi</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-400/15 text-sky-300">
                        Canlı Sesli
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        playNotificationChime(
                          user?.notification_settings?.sound_tone || 'apple_glass',
                          user?.notification_settings?.sound_volume ?? 0.7,
                          false
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200 cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      Sesi Dene
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto space-y-2.5 pr-1">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          setIsNotifOpen(false);
                          if (n.linkUrl) router.push(n.linkUrl);
                        }}
                        className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-white mb-0.5">
                          <span>{n.title}</span>
                          <span className="text-[10px] font-mono text-white/45">{n.createdAt}</span>
                        </div>
                        <p className="text-xs text-white/65 leading-relaxed">{n.body}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-xs">
                    <Link
                      href="/profil?tab=settings"
                      onClick={() => setIsNotifOpen(false)}
                      className="text-sky-400 hover:underline"
                    >
                      Bildirim & Ses Ayarları
                    </Link>
                    <button
                      onClick={() => setIsNotifOpen(false)}
                      className="text-white/50 hover:text-white cursor-pointer"
                    >
                      Kapat
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Admin Quick Link */}
            <Link
              href="/admin"
              title="Güvenli Admin & Scraper Kontrol Merkezi"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-full apple-glass-pill text-xs font-medium text-amber-300 hover:bg-amber-400/15 hover:border-amber-400/40 transition-all"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Admin</span>
            </Link>

            {/* Profile Button */}
            <Link
              href="/profil"
              className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full apple-glass-pill hover:border-white/30 transition-all"
            >
              <img
                src={getProxiedImageUrl(user?.avatar_url)}
                alt={user?.display_name || 'Profil'}
                className="w-7 h-7 rounded-full object-cover border border-white/20"
              />
              <span className="hidden md:inline text-xs font-medium text-white/90 max-w-[100px] truncate">
                {user?.display_name || 'Profilim'}
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* APPLE GLASS SLIDE-OVER SIDEBAR DRAWER */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            onClick={() => setIsDrawerOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />
          <aside className="relative w-80 max-w-[85vw] h-full apple-glass border-r border-white/15 p-6 flex flex-col justify-between z-10 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-6 border-b border-white/10">
                <Link
                  href="/"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3"
                >
                  <img src="/logo-dark.png" alt="KoUp" className="w-9 h-9 object-contain" />
                  <div>
                    <div className="text-base font-bold text-white">KoUp Cinema</div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-sky-400">
                      17.509 Yapım · Aktif
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-6 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 px-3 mb-2">
                  Katalog & Keşif
                </div>
                {[
                  { href: '/', label: 'Ana Sayfa', icon: Sparkles },
                  { href: '/kesfet?type=dizi', label: 'Asya & Global Diziler', icon: Tv },
                  { href: '/kesfet?type=anime', label: 'Animeler (AniList)', icon: Flame },
                  { href: '/kesfet?type=film', label: 'Sinema Filmleri (IMDb)', icon: Film },
                  { href: '/kesfet?type=program', label: 'TV & Varyete Programları', icon: Compass },
                  { href: '/oyuncular', label: 'Oyuncular & Anime Karakterleri', icon: Users },
                  { href: '/magazin', label: 'AsyaMag Haber & Dedikodu', icon: Newspaper },
                  { href: '/takvim', label: 'Yayın Takvimi & Geri Sayım', icon: Calendar },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsDrawerOpen(false)}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm text-white/80 hover:text-white hover:bg-white/10 transition-all"
                    >
                      <Icon className="w-4 h-4 text-sky-400" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 px-3 mb-2">
                  Kişisel Alan & Yönetim
                </div>
                <Link
                  href="/profil"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm text-white/80 hover:text-white hover:bg-white/10 transition-all"
                >
                  <User className="w-4 h-4 text-amber-300" />
                  <span>Profilim, Listeler & DNA</span>
                </Link>
                <Link
                  href="/admin"
                  onClick={() => setIsDrawerOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm text-amber-300 hover:bg-amber-400/15 transition-all"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Admin & Bot Kontrol Merkezi</span>
                </Link>
                <button
                  onClick={() => {
                    setIsDrawerOpen(false);
                    setIsAuthModalOpen(true);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm text-sky-300 hover:bg-sky-400/15 transition-all cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>Hesap Değiştir / Supabase Auth</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 text-[11px] text-white/45 flex items-center justify-between">
              <span>Frankfurt Edge · RLS Aktif</span>
              <button
                onClick={logout}
                className="flex items-center gap-1 text-red-300 hover:text-red-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Çıkış
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ⌘K MULTILINGUAL INSTANT SEARCH MODAL */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
          <div
            onClick={() => setIsSearchOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-md"
          />
          <div className="relative w-full max-w-3xl rounded-3xl apple-glass border border-white/15 p-5 z-10 shadow-2xl">
            <div className="flex items-center gap-3 pb-4 border-b border-white/10">
              <Search className="w-5 h-5 text-sky-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Türkçe, İngilizce, Korece, Çince, Japonca dizi/anime veya oyuncu/karakter ara..."
                className="w-full bg-transparent text-white placeholder-white/40 text-base focus:outline-none"
              />
              <button
                onClick={() => setIsSearchOpen(false)}
                className="px-2.5 py-1 rounded-lg bg-white/10 text-xs text-white/70 hover:text-white cursor-pointer"
              >
                ESC
              </button>
            </div>

            {searchQuery.trim().length < 2 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-white/60 mb-4">
                  17.509 dizi, film, anime ve 21.814 oyuncu & anime karakteri arasında anında ara
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    'Queen of Tears',
                    'One Piece',
                    'The Glory',
                    'Attack on Titan',
                    'Lovely Runner',
                    'Gojo Satoru',
                    'Son Sang Yeon',
                  ].map((sample) => (
                    <button
                      key={sample}
                      onClick={() => setSearchQuery(sample)}
                      className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/15 text-xs text-white/80 border border-white/10 transition-all cursor-pointer"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 max-h-[68vh] overflow-y-auto space-y-6 pr-1">
                {isSearching && (
                  <div className="text-xs text-sky-400 font-mono animate-pulse">
                    Frankfurt Edge indeksinde aranıyor...
                  </div>
                )}

                {searchMedia.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-white/45 mb-2.5">
                      Yapımlar (Dizi · Anime · Film)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {searchMedia.map((m) => (
                        <Link
                          key={m.id}
                          href={`/seri/${m.slug}`}
                          onClick={() => setIsSearchOpen(false)}
                          className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all"
                        >
                          <img
                            src={getProxiedImageUrl(m.cover_image, m.poster_fallback_url)}
                            alt={m.title}
                            className="w-12 h-16 rounded-xl object-cover shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-white truncate">
                              {m.title}
                            </div>
                            {m.native_title && (
                              <div className="text-[11px] text-white/45 truncate">
                                {m.native_title}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1 text-[11px] font-mono">
                              <span>
                                {COUNTRY_FLAGS[m.country_code] || '🎬'} {m.release_year}
                              </span>
                              <span className="text-amber-300">★ {m.site_rating}</span>
                              <span className="uppercase px-1.5 py-0.2 rounded bg-white/10 text-white/70">
                                {m.content_type}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {searchPeople.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-white/45 mb-2.5">
                      Oyuncular, Anime Karakterleri & Seiyuu
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {searchPeople.map((p) => (
                        <Link
                          key={p.id}
                          href={`/oyuncu/${p.slug}`}
                          onClick={() => setIsSearchOpen(false)}
                          className="flex items-center gap-2.5 p-2 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all"
                        >
                          <img
                            src={getProxiedImageUrl(p.image_url)}
                            alt={p.name}
                            className="w-10 h-10 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {p.name}
                            </div>
                            <div className="text-[10px] text-pink-300 font-mono">
                              ❤️ {p.favorites_count} Favori
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {!isSearching && searchMedia.length === 0 && searchPeople.length === 0 && (
                  <div className="py-8 text-center text-sm text-white/50">
                    Sonuç bulunamadı. Farklı bir anahtar kelime deneyin.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SMART "NE İZLESEM?" LIBRARY ROULETTE MODAL */}
      {isRouletteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => setIsRouletteOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />
          <div className="relative w-full max-w-xl rounded-3xl apple-glass border border-white/15 p-6 z-10 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <Dices className="w-5 h-5 text-amber-300" />
                <h3 className="text-lg font-bold text-white">
                  Ne İzlesem? · Akıllı Sinema Ruleti
                </h3>
              </div>
              <button
                onClick={() => setIsRouletteOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 my-4">
              {(
                [
                  { id: 'all', label: 'Tümü' },
                  { id: 'dizi', label: 'K-Drama & Dizi' },
                  { id: 'anime', label: 'Anime' },
                  { id: 'film', label: 'Sinema Filmi' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRouletteFilter(t.id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    rouletteFilter === t.id
                      ? 'bg-white text-black font-semibold'
                      : 'bg-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {roulettePick && (
              <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col sm:flex-row gap-4 items-center">
                <img
                  src={getProxiedImageUrl(
                    roulettePick.cover_image,
                    roulettePick.poster_fallback_url
                  )}
                  alt={roulettePick.title}
                  className={`w-28 h-40 rounded-2xl object-cover shrink-0 transition-transform duration-500 ${
                    isSpinning ? 'scale-90 blur-sm' : 'scale-100'
                  }`}
                />
                <div className="flex-1 text-center sm:text-left">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-400/20 text-sky-300">
                      {COUNTRY_FLAGS[roulettePick.country_code] || '🎬'}{' '}
                      {roulettePick.country_name}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-400/20 text-amber-300">
                      ★ {roulettePick.site_rating}
                    </span>
                    <span className="text-xs font-mono text-white/50">
                      {roulettePick.release_year} · {roulettePick.episode_count} Bölüm
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-white mb-1">{roulettePick.title}</h4>
                  <p className="text-xs text-white/65 line-clamp-3 mb-4">
                    {roulettePick.overview}
                  </p>
                  <div className="flex items-center justify-center sm:justify-start gap-2.5">
                    <Link
                      href={`/seri/${roulettePick.slug}`}
                      onClick={() => setIsRouletteOpen(false)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-xs font-semibold hover:scale-105 transition-all"
                    >
                      <Play className="w-3.5 h-3.5 fill-black" />
                      Hemen İzle
                    </Link>
                    <button
                      onClick={spinRoulette}
                      disabled={isSpinning}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-all cursor-pointer"
                    >
                      <Dices className="w-3.5 h-3.5 text-amber-300" />
                      {isSpinning ? 'Seçiliyor...' : 'Tekrar Çevir'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUPABASE AUTH MODAL */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => setIsAuthModalOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />
          <div className="relative w-full max-w-md rounded-3xl apple-glass border border-white/15 p-6 z-10 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">
                {authMode === 'login' ? 'KoUp Hesabına Giriş Yap' : 'Yeni KoUp Hesabı Oluştur'}
              </h3>
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-2xl bg-red-500/15 border border-red-400/30 text-xs text-red-200">
                {authError}
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAuthError(null);
                const err =
                  authMode === 'login'
                    ? await loginWithEmail(authEmail, authPassword)
                    : await registerWithEmail(authEmail, authPassword, authUsername);
                if (err) {
                  setAuthError(err);
                } else {
                  setIsAuthModalOpen(false);
                }
              }}
              className="space-y-3.5"
            >
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs text-white/60 mb-1">Kullanıcı Adı</label>
                  <input
                    type="text"
                    required
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    placeholder="koup_sever"
                    className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-white/60 mb-1">E-posta Adresi</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="ornek@koup.tv"
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Şifre</label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-sky-400"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 rounded-full bg-white text-black font-semibold text-sm hover:scale-[1.01] transition-all cursor-pointer"
              >
                {authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
              </button>
            </form>

            <div className="mt-4 text-center text-xs text-white/60">
              {authMode === 'login' ? (
                <>
                  Hesabın yok mu?{' '}
                  <button
                    onClick={() => setAuthMode('register')}
                    className="text-sky-400 hover:underline cursor-pointer"
                  >
                    Hemen Kayıt Ol
                  </button>
                </>
              ) : (
                <>
                  Zaten üye misin?{' '}
                  <button
                    onClick={() => setAuthMode('login')}
                    className="text-sky-400 hover:underline cursor-pointer"
                  >
                    Giriş Yap
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MACOS SEQUOIA FLOATING GLASS TOAST NOTIFICATION */}
      {activeToast && (
        <div
          onClick={dismissToast}
          className="fixed top-20 right-6 z-50 w-80 sm:w-96 rounded-2xl apple-glass p-4 border border-sky-400/35 shadow-[0_20px_50px_rgba(0,0,0,0.85)] cursor-pointer animate-in fade-in slide-in-from-top-3 duration-300"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-sky-400/15 border border-sky-400/30 flex items-center justify-center shrink-0 mt-0.5">
              <Heart className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">{activeToast.title}</div>
              <p className="text-xs text-white/70 mt-0.5 leading-relaxed">{activeToast.body}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
