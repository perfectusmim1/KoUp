'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Tv,
  UserCheck,
  MessageSquare,
  Sparkles,
  CheckCheck,
  Trash2,
  Check,
  RotateCcw,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { useKoUp, ToastNotification } from '@/context/KoUpContext';

type CategoryFilter = 'all' | 'episode' | 'actor' | 'reply' | 'info';

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
  const {
    user,
    setIsAuthModalOpen,
    notifications,
    unreadCount,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    deleteNotification,
    clearAllNotifications,
  } = useKoUp();

  const [selectedFilter, setSelectedFilter] = useState<CategoryFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState<boolean>(false);

  // Filtered and deduplicated notifications
  const filteredNotifications = useMemo(() => {
    const seen = new Set<string>();
    return notifications.filter((n) => {
      if (!n || !n.id) return false;
      if (seen.has(n.id)) return false;
      seen.add(n.id);

      // Category filter
      if (selectedFilter !== 'all') {
        if (selectedFilter === 'info') {
          if (n.type !== 'info' && n.type !== 'success') return false;
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
  }, [notifications, selectedFilter, unreadOnly]);

  // Counts per category (deduplicated)
  const counts = useMemo(() => {
    const unique = Array.from(new Map(notifications.map((n) => [n.id, n])).values());
    return {
      all: unique.length,
      episode: unique.filter((n) => n.type === 'episode').length,
      actor: unique.filter((n) => n.type === 'actor').length,
      reply: unique.filter((n) => n.type === 'reply').length,
      info: unique.filter((n) => n.type === 'info' || n.type === 'success' || n.type === 'system').length,
    };
  }, [notifications]);

  const getCategoryMeta = (type: ToastNotification['type']) => {
    switch (type) {
      case 'episode':
        return {
          label: 'Bölüm Bildirimi',
          badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          iconBg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
          glow: 'shadow-[0_0_20px_rgba(16,185,129,0.15)]',
          Icon: Tv,
        };
      case 'actor':
        return {
          label: 'Takip & Oyuncu',
          badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
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
      case 'success':
      case 'info':
      default:
        return {
          label: 'Sistem & Duyuru',
          badgeColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
          iconBg: 'bg-purple-500/15 border-purple-500/30 text-purple-400',
          glow: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]',
          Icon: Sparkles,
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
            <Link href="/" prefetch={true} className="hover:text-white transition-colors">
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
              className="px-6 py-3 rounded-2xl bg-white text-black text-sm font-bold hover:bg-white/90 active:scale-95 transition-all shadow-xl shadow-white/10 cursor-pointer"
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
          <Link href="/" prefetch={true} className="hover:text-white transition-colors">
            Ana Sayfa
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-white/30" />
          <span className="text-white">Bildirimler</span>
        </nav>

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-white/10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-pill border border-white/15 text-[11px] font-semibold text-white/80 mb-3">
              <Bell className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>Bildirim Merkezi</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-mono text-[10px] font-bold">
                  {unreadCount} yeni
                </span>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">
              Bildirimler
            </h1>
            <p className="text-sm sm:text-base text-white/60 mt-2 font-light max-w-2xl leading-relaxed">
              Takip ettiğin Asya dizileri, favori oyuncuların yeni projeleri ve yorumlarına gelen
              etkileşimlerin tümü burada listelenir.
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllNotificationsRead()}
                className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer border border-white/10 shadow-lg active:scale-95"
              >
                <CheckCheck className="w-4 h-4 text-emerald-400" />
                <span>Tümünü Okundu Say</span>
              </button>
            )}

            {notifications.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Tüm bildirimleri silmek istediğinize emin misiniz?')) {
                    clearAllNotifications();
                  }
                }}
                className="px-3.5 py-2.5 rounded-2xl bg-white/[0.04] hover:bg-red-500/20 hover:text-red-300 text-white/60 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer border border-white/[0.06] hover:border-red-500/30 active:scale-95"
                title="Tüm Bildirimleri Temizle"
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
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 md:pb-0">
            <button
              onClick={() => setSelectedFilter('all')}
              className={`px-4 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                selectedFilter === 'all'
                  ? 'bg-white text-black shadow-lg shadow-white/10'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <span>Tümü</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  selectedFilter === 'all' ? 'bg-black/15 text-black' : 'bg-white/10 text-white/70'
                }`}
              >
                {counts.all}
              </span>
            </button>

            <button
              onClick={() => setSelectedFilter('episode')}
              className={`px-4 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                selectedFilter === 'episode'
                  ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Bölümler</span>
              {counts.episode > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    selectedFilter === 'episode'
                      ? 'bg-black/20 text-black'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {counts.episode}
                </span>
              )}
            </button>

            <button
              onClick={() => setSelectedFilter('actor')}
              className={`px-4 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                selectedFilter === 'actor'
                  ? 'bg-amber-400 text-black shadow-lg shadow-amber-400/20'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Takip & Oyuncular</span>
              {counts.actor > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    selectedFilter === 'actor'
                      ? 'bg-black/20 text-black'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {counts.actor}
                </span>
              )}
            </button>

            <button
              onClick={() => setSelectedFilter('reply')}
              className={`px-4 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                selectedFilter === 'reply'
                  ? 'bg-sky-400 text-black shadow-lg shadow-sky-400/20'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Yorumlar</span>
              {counts.reply > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    selectedFilter === 'reply'
                      ? 'bg-black/20 text-black'
                      : 'bg-sky-500/20 text-sky-300'
                  }`}
                >
                  {counts.reply}
                </span>
              )}
            </button>

            <button
              onClick={() => setSelectedFilter('info')}
              className={`px-4 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                selectedFilter === 'info'
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10 border border-white/10'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Duyurular</span>
              {counts.info > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                    selectedFilter === 'info'
                      ? 'bg-white/20 text-white'
                      : 'bg-purple-500/20 text-purple-300'
                  }`}
                >
                  {counts.info}
                </span>
              )}
            </button>
          </div>

          {/* Unread Only Toggle */}
          <button
            onClick={() => setUnreadOnly((prev) => !prev)}
            className={`px-3.5 py-2 rounded-2xl text-xs font-medium transition-all cursor-pointer flex items-center gap-2 self-start md:self-auto shrink-0 border ${
              unreadOnly
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                : 'bg-white/[0.04] text-white/60 hover:text-white border-white/10'
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
              const IconComp = meta.Icon;
              const isUnread = !n.isRead;
              const link = n.linkUrl || (n as any).link_url;

              return (
                <div
                  key={n.id}
                  className={`group relative rounded-3xl border transition-all duration-300 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer ${
                    isUnread
                      ? 'bg-white/[0.07] hover:bg-white/[0.10] border-white/20 shadow-[0_8px_30px_rgba(0,0,0,0.6)]'
                      : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] opacity-75 hover:opacity-100'
                  }`}
                  onClick={() => {
                    if (isUnread) markNotificationRead(n.id);
                    if (link) router.push(link);
                  }}
                >
                  {/* Left: Category Icon & Content */}
                  <div className="flex items-start gap-4 sm:gap-5 flex-1 min-w-0">
                    {/* Visual Category Badge */}
                    <div
                      className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105 ${meta.iconBg} ${meta.glow}`}
                    >
                      <IconComp className="w-6 h-6" />
                    </div>

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
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-[10px] font-bold text-rose-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,1)] animate-ping" />
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
                      className={`p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        isUnread
                          ? 'bg-white/10 hover:bg-emerald-500/20 text-white/70 hover:text-emerald-300 border-white/10 hover:border-emerald-500/30'
                          : 'bg-white/[0.04] hover:bg-white/10 text-white/40 hover:text-white border-white/[0.05]'
                      }`}
                      title={isUnread ? 'Okundu İşaretle' : 'Okunmadı Olarak İşaretle'}
                    >
                      {isUnread ? <Check className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                    </button>

                    {/* Delete Item */}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-white/40 hover:text-red-300 border border-white/[0.05] hover:border-red-500/30 text-xs font-medium transition-all cursor-pointer"
                      title="Bildirimi Sil"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Navigation Link Arrow */}
                    {link && (
                      <Link
                        href={link}
                        prefetch={true}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isUnread) markNotificationRead(n.id);
                        }}
                        className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-white/90 text-black text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-lg group/link"
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
