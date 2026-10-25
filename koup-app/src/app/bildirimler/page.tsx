'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Bell,
  Tv,
  UserCheck,
  MessageSquare,
  CheckCheck,
  Trash2,
  Check,
  RotateCcw,
  ChevronRight,
  ArrowRight,
  Megaphone,
} from 'lucide-react';
import { useKoUpSelector, ToastNotification } from '@/context/KoUpContext';
import { dedupeAndSortNotifications } from '@/lib/notifications';
import { getProxiedImageUrl } from '@/lib/supabase';
import { usePillDragTracking } from '@/hooks/usePillDragTracking';

type CategoryFilter = 'all' | 'episode' | 'actor' | 'reply' | 'system';

interface NotificationThumbnailProps {
  notification: ToastNotification;
  meta: {
    label: string;
    badgeColor: string;
    iconBg: string;
    glow: string;
    Icon: any;
  };
}

function NotificationThumbnail({ notification, meta }: NotificationThumbnailProps) {
  const [imageError, setImageError] = useState(false);
  const IconComp = meta.Icon;
  const link = notification.linkUrl || (notification as any).link_url;

  // Determine thumbnail source:
  let rawImg: string | null = notification.imageUrl || (notification as any).image_url || null;

  if (!rawImg) {
    if (notification.type === 'episode' || (link && link.startsWith('/seri/'))) {
      const title = notification.title.includes('•')
        ? notification.title.split('•')[0].trim()
        : notification.title.trim();
      if (title) {
        rawImg = getProxiedImageUrl(null, title, null, 'w185', 'media');
      }
    } else if (notification.type === 'actor' || (link && link.startsWith('/oyuncu/'))) {
      const name = notification.title.includes('•')
        ? notification.title.split('•')[0].trim()
        : notification.title.trim();
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

  // Visual Fallback without image
  if (imageError || !rawImg) {
    return (
      <div
        className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border flex items-center justify-center shrink-0 mt-0.5 ${meta.iconBg} ${meta.glow}`}
      >
        <IconComp className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
    );
  }

  // Episode Notification: Vertical 2:3 Cinema Poster Thumbnail (Fixed size, Strictly no zoom, No TV badge)
  if (notification.type === 'episode') {
    return (
      <div className="relative w-12 sm:w-14 aspect-[2/3] rounded-xl overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-md">
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

  // Actor & Reply Notifications: Circular Avatar (Fixed size, Strictly no zoom, No badge)
  if (notification.type === 'actor' || notification.type === 'reply') {
    return (
      <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-md">
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

  // Generic Media Thumbnail (Fixed square, No zoom, No badge)
  return (
    <div className="relative w-12 sm:w-14 aspect-square rounded-2xl overflow-hidden border border-white/15 bg-[#121216] shrink-0 shadow-md">
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

function formatNotificationDate(dateStr?: string): string {
  if (!dateStr) return 'Şimdi';
  if (dateStr.includes('önce') || dateStr === 'Şimdi' || dateStr === 'Bugün') {
    return dateStr;
  }
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'Az önce';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} dk önce`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} saat önce`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)} gün önce`;
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const router = useRouter();
  const user = useKoUpSelector((s) => s.user);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const notifications = useKoUpSelector((s) => s.notifications);
  const markNotificationRead = useKoUpSelector((s) => s.markNotificationRead);
  const markNotificationUnread = useKoUpSelector((s) => s.markNotificationUnread);
  const markAllNotificationsRead = useKoUpSelector((s) => s.markAllNotificationsRead);
  const deleteNotification = useKoUpSelector((s) => s.deleteNotification);
  const clearAllNotifications = useKoUpSelector((s) => s.clearAllNotifications);
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const [selectedFilter, setSelectedFilter] = useState<CategoryFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);

  const { containerRef: notifTabsRef, dragProps: notifTabsDragProps } = usePillDragTracking<CategoryFilter>({
    activeTab: selectedFilter,
    onTabChange: (newFilter) => {
      setSelectedFilter(newFilter);
    },
    triggerSound,
  });

  // Fully deduplicated & deterministically sorted notifications list (prioritizing DB record over temporary optimistic ID)
  const uniqueNotifications = useMemo(() => {
    return dedupeAndSortNotifications(notifications);
  }, [notifications]);

  // Effective unread count derived from deduplicated list
  const unreadCount = useMemo(() => {
    return uniqueNotifications.filter((n) => !n.isRead).length;
  }, [uniqueNotifications]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return uniqueNotifications.filter((n) => {
      // Category filter
      if (selectedFilter !== 'all') {
        if (selectedFilter === 'system') {
          if (n.type !== 'system' && n.type !== 'info' && n.type !== 'success') return false;
        } else if (n.type !== selectedFilter) {
          return false;
        }
      }
      // Unread only toggle
      if (unreadOnly && n.isRead) {
        return false;
      }
      return true;
    });
  }, [uniqueNotifications, selectedFilter, unreadOnly]);

  // Counts per category
  const counts = useMemo(() => {
    return {
      all: uniqueNotifications.length,
      episode: uniqueNotifications.filter((n) => n.type === 'episode').length,
      actor: uniqueNotifications.filter((n) => n.type === 'actor').length,
      reply: uniqueNotifications.filter((n) => n.type === 'reply').length,
      system: uniqueNotifications.filter(
        (n) => n.type === 'system' || n.type === 'info' || n.type === 'success'
      ).length,
    };
  }, [uniqueNotifications]);

  const getCategoryMeta = (type: ToastNotification['type']) => {
    switch (type) {
      case 'episode':
        return {
          label: 'Bölüm Bildirimi',
          badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
          Icon: Tv,
        };
      case 'actor':
        return {
          label: 'Takip & Oyuncu',
          badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          iconBg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
          glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]',
          Icon: UserCheck,
        };
      case 'reply':
        return {
          label: 'Yorum Yanıtı',
          badgeColor: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
          iconBg: 'bg-sky-500/15 border-sky-500/30 text-sky-400',
          glow: 'shadow-[0_0_20px_rgba(14,165,233,0.15)]',
          Icon: MessageSquare,
        };
      case 'system':
      case 'info':
      case 'success':
      default:
        return {
          label: 'Sistem Duyurusu',
          badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/25',
          iconBg: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400',
          glow: 'shadow-[0_0_20px_rgba(99,102,241,0.18)]',
          Icon: Megaphone,
        };
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#080808] text-white pt-28 pb-32 px-4 sm:px-6 md:px-12 lg:px-20">
        <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
          <div className="absolute top-1/4 left-1/3 w-[600px] h-[600px] bg-red-600/5 rounded-full blur-[140px]" />
          <div className="absolute top-1/2 right-1/4 w-[500px] h-[500px] bg-sky-600/5 rounded-full blur-[140px]" />
        </div>

        <div className="max-w-5xl mx-auto">
          <nav className="flex items-center gap-2 text-xs text-white/50 mb-6 font-medium">
            <Link href="/" className="hover:text-white transition-colors">
              Ana Sayfa
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-white/30" />
            <span className="text-white">Bildirimler</span>
          </nav>

          <div className="py-24 rounded-3xl bg-[#0f0f12]/50 border border-white/10 text-center px-6 flex flex-col items-center justify-center max-w-xl mx-auto shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center mb-5">
              <Bell className="w-8 h-8 text-rose-400" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Bildirim Merkezi
            </h1>
            <p className="text-sm sm:text-base text-white/60 font-light leading-relaxed mt-2.5 mb-8 max-w-md">
              Bildirimlerinizi görmek ve takip ettiğiniz serilerden haberdar olmak için lütfen giriş yapın.
            </p>
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="px-6 py-3 rounded-2xl bg-white text-black text-sm font-bold hover:bg-white/90 active:scale-95 transition-colors shadow-xl shadow-white/10 cursor-pointer"
            >
              Giriş Yap
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white pt-28 pb-32 px-4 sm:px-6 md:px-12 lg:px-20">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-1/4 left-1/3 w-[600px] h-[600px] bg-red-600/5 rounded-full blur-[140px]" />
        <div className="absolute top-1/2 right-1/4 w-[500px] h-[500px] bg-sky-600/5 rounded-full blur-[140px]" />
      </div>

      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-white/50 mb-6 font-medium">
          <Link href="/" className="hover:text-white transition-colors">
            Ana Sayfa
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-white/30" />
          <span className="text-white">Bildirimler</span>
        </nav>

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-white/10">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">
                Bildirimler
              </h1>
              {unreadCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 font-mono text-xs font-bold">
                  {unreadCount} yeni
                </span>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllNotificationsRead()}
                className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border border-white/10 shadow-lg active:scale-95"
              >
                <CheckCheck className="w-4 h-4 text-emerald-400" />
                <span>Tümünü Okundu Say</span>
              </button>
            )}

            {notifications.length > 0 && (
              <button
                onClick={async () => {
                  const confirmed = await confirmDialog({
                    title: 'Tüm Bildirimleri Temizle',
                    message: 'Tüm bildirim geçmişinizi kalıcı olarak silmek istediğinize emin misiniz?',
                    confirmText: 'Tümünü Temizle',
                    cancelText: 'Vazgeç',
                    isDestructive: true,
                    icon: 'trash',
                  });
                  if (confirmed) {
                    clearAllNotifications();
                  }
                }}
                className="px-3.5 py-2.5 rounded-2xl bg-white/[0.04] hover:bg-red-500/20 hover:text-red-300 text-white/60 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-white/[0.06] hover:border-red-500/30 active:scale-95"
                aria-label="Tüm Bildirimleri Temizle"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Temizle</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="py-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Category Tabs */}
          <div className="overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]">
            <div
              ref={notifTabsRef}
              {...notifTabsDragProps}
              className="inline-flex w-max items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 select-none touch-pan-x cursor-pointer sm:cursor-grab sm:active:cursor-grabbing overflow-hidden"
            >
              {[
                {
                  id: 'all' as const,
                  label: 'Tümü',
                  countKey: 'all' as const,
                  activePillClass:
                    'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
                },
                {
                  id: 'episode' as const,
                  label: 'Bölümler',
                  icon: Tv,
                  countKey: 'episode' as const,
                  activePillClass:
                    'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(245,158,11,0.45)] border border-amber-400/40',
                },
                {
                  id: 'actor' as const,
                  label: 'Takip & Oyuncular',
                  icon: UserCheck,
                  countKey: 'actor' as const,
                  activePillClass:
                    'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_0_18px_rgba(16,185,129,0.45)] border border-emerald-400/40',
                },
                {
                  id: 'reply' as const,
                  label: 'Yorum Yanıtları',
                  icon: MessageSquare,
                  countKey: 'reply' as const,
                  activePillClass:
                    'bg-gradient-to-r from-blue-500 to-indigo-600 shadow-[0_0_18px_rgba(99,102,241,0.45)] border border-indigo-400/40',
                },
                {
                  id: 'system' as const,
                  label: 'Duyurular',
                  icon: Megaphone,
                  countKey: 'system' as const,
                  activePillClass:
                    'bg-gradient-to-r from-purple-500 to-pink-600 shadow-[0_0_18px_rgba(168,85,247,0.45)] border border-purple-400/40',
                },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = selectedFilter === tab.id;
                const count = counts[tab.countKey];

                return (
                  <button
                    key={tab.id}
                    data-tab-id={tab.id}
                    type="button"
                    onClick={() => {
                      triggerSound?.('click');
                      setSelectedFilter(tab.id);
                    }}
                    className={`relative shrink-0 flex items-center gap-2 px-3.5 sm:px-4 h-9 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer select-none touch-manipulation ${
                      active ? 'text-white font-extrabold' : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="notifications-category-pill"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                        className={`absolute inset-0 rounded-xl ${tab.activePillClass} z-0 select-none pointer-events-none`}
                      />
                    )}
                    {Icon && <Icon className="relative z-10 w-3.5 h-3.5 pointer-events-none" />}
                    <span className="relative z-10 pointer-events-none">{tab.label}</span>
                    {(tab.id === 'all' || count > 0) && (
                      <span
                        className={`relative z-10 pointer-events-none text-[10px] font-mono px-1.5 py-0.2 rounded-full transition-colors ${
                          active ? 'bg-white/25 text-white' : 'bg-white/10 text-white/75'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Unread Only Toggle */}
          <button
            onClick={() => {
              triggerSound?.('click');
              setUnreadOnly((prev) => !prev);
            }}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 self-start md:self-auto shrink-0 border select-none active:scale-95 ${
              unreadOnly
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                : 'bg-white/[0.04] text-white/70 hover:text-white border-white/10'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                unreadOnly
                  ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse'
                  : 'bg-white/30'
              }`}
            />
            <span>Sadece Okunmamışlar</span>
          </button>
        </div>

        {/* Notifications List */}
        <div className="space-y-3 mt-2">
          {filteredNotifications.length === 0 ? (
            <div className="py-20 rounded-3xl bg-[#0f0f12]/50 border border-white/10 text-center px-6 flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center mb-4">
                <Bell className="w-8 h-8 text-white/30" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {unreadOnly ? 'Okunmamış Bildirim Yok' : 'Bu Kategoride Bildirim Yok'}
              </h3>
              <p className="text-sm text-white/50 max-w-sm mt-1.5 font-light leading-relaxed">
                {unreadOnly
                  ? 'Tüm bildirimleri okudunuz! Harika bir takipçisiniz.'
                  : 'Seçili filtrenize uygun herhangi bir bildirim bulunamadı.'}
              </p>
              <div className="flex items-center gap-3 mt-6">
                {unreadOnly && (
                  <button
                    onClick={() => setUnreadOnly(false)}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all cursor-pointer"
                  >
                    Tüm Bildirimleri Göster
                  </button>
                )}
              </div>
            </div>
          ) : (
            filteredNotifications.map((n) => {
              const meta = getCategoryMeta(n.type);
              const isUnread = !n.isRead;
              const link = n.linkUrl || (n as any).link_url;

              return (
                <div
                  key={n.id}
                  className={`group relative rounded-3xl border transition-colors duration-150 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer ${
                    isUnread
                      ? 'bg-[#14141a] hover:bg-[#181822] border-white/20 shadow-[0_12px_32px_rgba(0,0,0,0.6)]'
                      : 'bg-[#0e0e12] hover:bg-[#131318] border-white/[0.08] hover:border-white/15 opacity-85 hover:opacity-100'
                  }`}
                  onClick={() => {
                    if (isUnread) markNotificationRead(n.id);
                    if (link) router.push(link);
                  }}
                >
                  {/* Left: Category Icon & Content */}
                  <div className="flex items-start gap-4 sm:gap-5 flex-1 min-w-0">
                    {/* Visual Thumbnail or Category Badge */}
                    <NotificationThumbnail notification={n} meta={meta} />

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Category Label */}
                        <span
                          className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full border ${meta.badgeColor}`}
                        >
                          {meta.label}
                        </span>

                        {/* Unread Accent Pill */}
                        {isUnread && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-[10px] font-bold text-rose-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,1)] motion-safe:animate-ping" />
                            YENİ
                          </span>
                        )}

                        <span className="text-[11px] font-mono text-white/40 ml-auto sm:ml-0">
                          {formatNotificationDate(n.createdAt)}
                        </span>
                      </div>

                      {/* Notification Title */}
                      <h3
                        className={`text-base sm:text-lg leading-snug line-clamp-1 transition-colors ${
                          isUnread
                            ? 'font-bold text-white group-hover:text-amber-200'
                            : 'font-semibold text-white/80 group-hover:text-white'
                        }`}
                      >
                        {n.title}
                      </h3>

                      {/* Notification Body */}
                      <p className="text-xs sm:text-sm text-white/60 font-light leading-relaxed line-clamp-2">
                        {n.body}
                      </p>
                    </div>
                  </div>

                  {/* Right Action Tools */}
                  <div
                    className="flex items-center justify-end gap-2 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-white/10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Mark Read/Unread Toggle */}
                    <button
                      onClick={() =>
                        isUnread ? markNotificationRead(n.id) : markNotificationUnread(n.id)
                      }
                      className={`p-2.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
                        isUnread
                          ? 'bg-white/10 hover:bg-emerald-500/20 text-white/70 hover:text-emerald-300 border-white/10 hover:border-emerald-500/30'
                          : 'bg-white/[0.04] hover:bg-white/10 text-white/40 hover:text-white border-white/[0.05]'
                      }`}
                      aria-label={isUnread ? 'Okundu İşaretle' : 'Okunmadı Olarak İşaretle'}
                    >
                      {isUnread ? <Check className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                    </button>

                    {/* Delete Item */}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-white/40 hover:text-red-300 border border-white/[0.05] hover:border-red-500/30 text-xs font-medium transition-colors cursor-pointer"
                      aria-label="Bildirimi Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Navigation Link Arrow */}
                    {link && (
                      <Link
                        href={link}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isUnread) markNotificationRead(n.id);
                        }}
                        className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-white/90 text-black text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg group/link"
                      >
                        <span className="hidden sm:inline">İncele</span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover/link:translate-x-0.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
