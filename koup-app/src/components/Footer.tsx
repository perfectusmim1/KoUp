'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, Mail, Sparkles, ExternalLink, Scale, Heart } from 'lucide-react';

function Footer() {
  return (
    <footer className="mt-28 border-t border-white/[0.06] bg-[#070708] py-14 px-4 sm:px-6 lg:px-14 w-full max-w-full overflow-x-hidden text-xs text-white/55 [content-visibility:auto] [contain-intrinsic-size:auto_450px]">
      <div className="max-w-[1680px] mx-auto space-y-12">
        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-8">
          {/* Brand Col */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="inline-flex items-center gap-3 group">
              <img
                src="/logo-dark.png"
                alt="KoUp Cinema"
                loading="lazy"
                decoding="async"
                className="h-9 w-auto object-contain transition-transform duration-300 group-hover:scale-105"
              />
              <div>
                <span className="text-sm font-bold text-white tracking-tight">KoUp Cinema Studio</span>
                <span className="block text-[11px] text-white/40">Asya Sineması, K-Drama & Anime Arşivi</span>
              </div>
            </Link>
            <p className="text-xs text-white/50 leading-relaxed max-w-sm">
              Asya dramaları, animeler ve dünya sinemasını keşfetmek için tasarlanmış bağımsız sinema kataloğu. 
              MyDramaList, AniList, TMDb ve AsyaMag entegrasyonuyla kişiselleştirilmiş izleme deneyimi.
            </p>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-white/40">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>24.700+ Master Yapım: Dizi, Anime ve Film İndeksi</span>
            </div>
          </div>

          {/* Col 1: Keşfet */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Keşfet & İzle</h4>
            <ul className="space-y-2 text-white/60">
              <li>
                <Link href="/kesfet?type=dizi" className="hover:text-white transition-colors">
                  K-Drama & Asya Dizileri
                </Link>
              </li>
              <li>
                <Link href="/kesfet?type=anime" className="hover:text-white transition-colors">
                  Animeler & Donghualar
                </Link>
              </li>
              <li>
                <Link href="/kesfet?type=film" className="hover:text-white transition-colors">
                  Filmler & Sinema
                </Link>
              </li>
              <li>
                <Link href="/oyuncular" className="hover:text-white transition-colors">
                  Oyuncular & Karakterler
                </Link>
              </li>
              <li>
                <Link href="/takvim" className="hover:text-white transition-colors">
                  Günlük Yayın Takvimi
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 2: Topluluk & Magazin */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Topluluk & Haber</h4>
            <ul className="space-y-2 text-white/60">
              <li>
                <Link href="/magazin" className="hover:text-white transition-colors">
                  Magazin & Gündem (KoreZin)
                </Link>
              </li>
              <li>
                <Link href="/listeler" className="hover:text-white transition-colors">
                  Kullanıcı Özel Listeleri
                </Link>
              </li>
              <li>
                <Link href="/kesfet?sort=rating" className="hover:text-white transition-colors">
                  Başyapıtlar & Ödüllüler
                </Link>
              </li>
              <li>
                <Link href="/kesfet?sort=trending" className="hover:text-white transition-colors">
                  Haftalık Trend Yapımlar
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Kurumsal & Yasal */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Kurumsal & Yasal</h4>
            <ul className="space-y-2 text-white/60">
              <li>
                <Link href="/hakkimizda" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <span>Hakkımızda</span>
                </Link>
              </li>
              <li>
                <Link href="/gizlilik-politikasi" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <span>Gizlilik ve Çerez Politikası</span>
                </Link>
              </li>
              <li>
                <Link href="/telif-hakki" className="hover:text-amber-400 transition-colors flex items-center gap-1.5 font-medium">
                  <Scale className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Telif Hakkı & DMCA Bildirimi</span>
                </Link>
              </li>
              <li>
                <a href="mailto:iletisim@koup.app" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  <span>iletisim@koup.app</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* 5651 Sayılı Kanun Uyarısı / Yer Sağlayıcı Koruma Bandı */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 sm:p-6 space-y-2 text-[11px] text-white/45 leading-relaxed">
          <div className="flex items-center gap-2 text-white/75 font-semibold text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>5651 Sayılı Kanun Madde 8 ve 5846 Sayılı FSEK Uyarısı (Yer Sağlayıcı Bildirimi)</span>
          </div>
          <p>
            KoUp Cinema (koup-app.vercel.app), 5651 sayılı &quot;İnternet Ortamında Yapılan Yayınların Düzenlenmesi ve Bu Yayınlar 
            Yoluyla İşlenen Suçlarla Mücadele Edilmesi Hakkında Kanun&quot; kapsamında <strong>&quot;Yer Sağlayıcı&quot;</strong> olarak hizmet 
            vermektedir. Sunucularımızda hiçbir video dosyası barındırılmamaktadır. Sitemizde yer alan tüm video içerikleri 
            internet ortamında herkese açık paylaşım sitelerinden (YouTube, OK.ru, Vidmoly, VK vb.) iframe ve embed kodları 
            aracılığıyla çağrılmaktadır.
          </p>
          <p>
            Hak sahipleri veya yasal temsilcileri tarafından iletilen telif hakkı ihlali bildirimleri (Uyar-Kaldır prensibi) 
            en geç 3 (üç) iş günü içerisinde incelenerek ilgili video bağlantısı sistemden kalıcı olarak kaldırılır. 
            Telif bildirimi için: <a href="mailto:dmca@koup.app" className="text-amber-400 hover:underline font-mono">dmca@koup.app</a>
          </p>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-white/40">
          <p>© {new Date().getFullYear()} KoUp Cinema Studio. Tüm hakları saklıdır.</p>
          <div className="flex items-center gap-6">
            <Link href="/hakkimizda" className="hover:text-white transition-colors">Hakkımızda</Link>
            <Link href="/gizlilik-politikasi" className="hover:text-white transition-colors">Gizlilik Sözleşmesi</Link>
            <Link href="/telif-hakki" className="hover:text-amber-400 transition-colors">Telif Hakkı & DMCA</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default React.memo(Footer);
