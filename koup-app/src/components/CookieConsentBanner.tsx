'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, ShieldCheck, SlidersHorizontal, Zap, Check, X } from 'lucide-react';
import {
  getCookieConsent,
  saveCookieConsent,
  getTasteSummary,
} from '@/lib/tasteProfile';

export default function CookieConsentBanner() {
  const [mounted, setMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [personalization, setPersonalization] = useState(true);
  const [performance, setPerformance] = useState(true);
  const [tasteBadge, setTasteBadge] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const consent = getCookieConsent();
    setPersonalization(consent.personalization);
    setPerformance(consent.performance);

    const summary = getTasteSummary();
    if (summary.hasTaste) {
      setTasteBadge(summary.subtitleText);
    }

    if (!consent.decided) {
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 900);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const handleOpenModal = () => {
      const consent = getCookieConsent();
      setPersonalization(consent.personalization);
      setPerformance(consent.performance);
      const summary = getTasteSummary();
      setTasteBadge(summary.hasTaste ? summary.subtitleText : null);
      setShowCustomize(true);
      setIsVisible(true);
    };

    window.addEventListener('koup:open-cookie-modal', handleOpenModal);
    return () => {
      window.removeEventListener('koup:open-cookie-modal', handleOpenModal);
    };
  }, []);

  if (!mounted || !isVisible) return null;

  const handleAcceptAll = () => {
    saveCookieConsent({ personalization: true, performance: true });
    setIsVisible(false);
    setShowCustomize(false);
  };

  const handleEssentialOnly = () => {
    saveCookieConsent({ personalization: false, performance: false });
    setIsVisible(false);
    setShowCustomize(false);
  };

  const handleSaveCustom = () => {
    saveCookieConsent({ personalization, performance });
    setIsVisible(false);
    setShowCustomize(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Çerez ve Kişiselleştirme Tercihleri"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 z-[90] md:max-w-[490px] animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="relative rounded-3xl bg-[#0c0c10]/95 backdrop-blur-xl border border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.95)] p-5 sm:p-6 overflow-hidden">
        {/* Subtle ambient accent */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-44 h-44 rounded-full bg-sky-500/10 blur-2xl" />

        {/* Header */}
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Akıllı Vitrin & Çerez Tercihleri
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-[10px] font-bold text-sky-300">
                  Zevk DNA&apos;sı
                </span>
              </div>
              <p className="text-[11px] text-white/50">
                Kişiselleştirilmiş Ana Sayfa ve Öneri Motoru
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsVisible(false)}
            aria-label="Kapat"
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Description */}
        <p className="mt-3 text-xs text-white/75 leading-relaxed">
          KoUp, izlediğiniz ve incelediğiniz yapımların <strong className="text-white font-semibold">tür, ülke ve tema</strong> verilerini tanımlama bilgileri (çerezler) ile analiz ederek Ana Sayfa vitrinini ve <strong className="text-white font-semibold">Benzer Yapımlar</strong> önerilerini tamamen sizin zevkinize göre şekillendirir.
        </p>

        {tasteBadge && (
          <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center gap-2 text-[11px] text-sky-300">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Aktif Profil: {tasteBadge}</span>
          </div>
        )}

        {/* Expandable Granular Controls */}
        {showCustomize && (
          <div className="mt-4 pt-3.5 border-t border-white/10 space-y-2.5">
            {/* 1. Necessary */}
            <div className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Zorunlu Sistem Çerezleri</div>
                  <div className="text-[11px] text-white/50 truncate">
                    Oturum güvenliği, oynatıcı ses ve altyazı tercihleri
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                Her Zaman Aktif
              </span>
            </div>

            {/* 2. Personalization & Taste DNA */}
            <label className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">
                    Kişiselleştirilmiş Öneri & Zevk Motoru
                  </div>
                  <div className="text-[11px] text-white/50">
                    İzlediğiniz dizi/anime türlerine ve ülkelere göre özel vitrin oluşturur
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={personalization}
                onChange={(e) => setPersonalization(e.target.checked)}
                className="w-4 h-4 accent-sky-400 rounded cursor-pointer shrink-0"
              />
            </label>

            {/* 3. High-Speed Cache */}
            <label className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.07] cursor-pointer transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">
                    Anında Sayfa Geçiş Önbelleği
                  </div>
                  <div className="text-[11px] text-white/50">
                    Sayfalar arası geçişlerin 0ms hızında açılması için yerel önbellekleme
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={performance}
                onChange={(e) => setPerformance(e.target.checked)}
                className="w-4 h-4 accent-sky-400 rounded cursor-pointer shrink-0"
              />
            </label>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!showCustomize ? (
            <>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="flex-1 min-w-[180px] flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer shadow-md"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Kabul Et ve Kişiselleştir</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCustomize(true)}
                className="px-3.5 py-2.5 rounded-full bg-white/[0.07] hover:bg-white/15 border border-white/10 text-white/85 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Özelleştir</span>
              </button>

              <button
                type="button"
                onClick={handleEssentialOnly}
                className="px-3 py-2.5 rounded-full text-white/50 hover:text-white/85 text-xs font-medium transition-colors cursor-pointer"
              >
                Sadece Zorunlu
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSaveCustom}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs transition-all cursor-pointer shadow-md"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Seçimlerimi Kaydet</span>
              </button>

              <button
                type="button"
                onClick={handleAcceptAll}
                className="px-4 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer"
              >
                Tümünü Aç
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
