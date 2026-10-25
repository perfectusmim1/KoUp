'use client';

import React from 'react';
import Link from 'next/link';
import { Sparkles, Tv, Film, Compass, Users, Heart, ArrowLeft, ShieldCheck, Database, Zap } from 'lucide-react';

export default function HakkimizdaPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-[#F4F4F6] pt-24 pb-20 px-4 sm:px-6 lg:px-12 selection:bg-rose-500 selection:text-white">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Back Link & Header */}
        <div className="space-y-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Ana Sayfaya Dön</span>
          </Link>
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shadow-[0_0_30px_rgba(56,189,248,0.15)]">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Hakkımızda
              </h1>
              <p className="text-xs sm:text-sm text-white/50">
                KoUp Cinema Studio · Asya Sineması, K-Drama, Anime & Global Arşiv
              </p>
            </div>
          </div>
        </div>

        {/* Hero Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-3xl p-8 sm:p-10">
          <div className="space-y-4 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-semibold text-white/80">
              <Compass className="w-3.5 h-3.5 text-sky-400" />
              <span>Bağımsız Sinema ve Dizi İndeksi</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug">
              Sinema Tutkunları İçin Tasarlanmış Kusursuz Akış & Keşif Deneyimi
            </h2>
            <p className="text-sm text-white/70 leading-relaxed">
              KoUp Cinema, Asya dramaları (K-Drama, C-Drama, Tayland BL/GL, J-Drama), animeler ve dünya sinemasını seven 
              izleyiciler için geliştirilmiş yeni nesil bir sinema dizinleme ve topluluk platformudur. Apple TV+ ve Netflix 
              akıcılığında modern bir kullanıcı deneyimi sunar.
            </p>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base">Zengin Metaveri Arşivi</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              24.700&apos;den fazla Master Yapım; MyDramaList, AniList, TMDb ve IMDb entegrasyonuyla oyuncu kadrosu, puanlar, fragmanlar ve türlerle detaylandırılmıştır.
            </p>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base">Kesintisiz Oynatıcı</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              Sinematik ambient aydınlatma, kaldığın yerden devam etme, otomatik sonraki bölüm ve çoklu kaynak desteğiyle modern video izleme standardı.
            </p>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base">Canlı Topluluk & Magazin</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              Zengin yorum sistemi, spoiler gizleme, Asya sineması haberleri (AsyaMag, KoreZin) ve anlık yayın takvimiyle yaşayan bir sinema kulübü.
            </p>
          </div>
        </div>

        {/* Legal Mission Note */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-4 text-sm text-white/70 leading-relaxed">
          <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
            <h2>Yasal Statü ve Misyonumuz</h2>
          </div>
          <p>
            KoUp Cinema, 5651 Sayılı Kanun&apos;un 8. maddesi ve 5846 Sayılı Fikir ve Sanat Eserleri Kanunu kapsamında 
            <strong> &quot;Yer Sağlayıcı&quot; (Hosting & Indexing Provider)</strong> olarak hizmet vermektedir.
          </p>
          <p>
            Sunucularımızda hiçbir video, dizi, film veya ses dosyası barındırılmamaktadır. Sitemiz, internet üzerinde 
            halka açık ve ücretsiz olarak yayınlanan video kaynaklarını (YouTube, OK.ru, Vidmoly, VK vb.) iframe ve 
            embed teknolojileriyle bir araya getiren, düzenleyen ve kullanıcıların kolayca aramasını sağlayan bir indeks motorudur.
          </p>
          <p>
            Hak sahiplerinin telif haklarına saygı duyarız ve uyar-kaldır (Notice and Takedown) prensibiyle gelen yasal bildirimleri 
            en geç 3 iş günü içinde titizlikle işleme alırız.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs font-semibold">
            <Link href="/telif-hakki" className="text-sky-400 hover:text-sky-300 underline underline-offset-4">
              Telif Hakkı & DMCA Bildirimi →
            </Link>
            <Link href="/gizlilik-politikasi" className="text-sky-400 hover:text-sky-300 underline underline-offset-4">
              Gizlilik Politikası →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
