'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldAlert, AlertTriangle, FileCheck, Mail, ArrowLeft, ExternalLink, Scale, CheckCircle2 } from 'lucide-react';

export default function TelifHakkiPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-[#F4F4F6] pt-24 pb-20 px-4 sm:px-6 lg:px-12 selection:bg-amber-500 selection:text-black">
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
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.15)]">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Telif Hakkı ve DMCA Bildirimi
              </h1>
              <p className="text-xs sm:text-sm text-white/50">
                5651 Sayılı Kanun ve 5846 Sayılı FSEK Kapsamında Yasal Uyar-Kaldır Bildirimi
              </p>
            </div>
          </div>
        </div>

        {/* Primary Legal Box: 5651 Sayılı Kanun Uyarısı */}
        <div className="bg-gradient-to-r from-amber-500/15 via-[#121216] to-transparent border border-amber-500/25 rounded-2xl p-6 sm:p-8 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400 font-bold text-base">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h2>5651 Sayılı Kanun Madde 8 Uyarınca Yer Sağlayıcı Bildirimi</h2>
          </div>
          <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
            <strong>KoUp Cinema (koup-app.vercel.app)</strong>, 5651 sayılı &quot;İnternet Ortamında Yapılan Yayınların 
            Düzenlenmesi ve Bu Yayınlar Yoluyla İşlenen Suçlarla Mücadele Edilmesi Hakkında Kanun&quot;un 8. ve 9. maddeleri ile 
            5846 sayılı &quot;Fikir ve Sanat Eserleri Kanunu&quot; hükümleri uyarınca <strong>&quot;Yer Sağlayıcı&quot; (Hosting / Indexing Provider)</strong> 
            sıfatıyla faaliyet göstermektedir.
          </p>
          <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
            Sitemizdeki video oynatıcılar harici kaynaklardan (YouTube, OK.ru, Vidmoly, VK vb.) iframe ve embed kodları vasıtasıyla 
            görüntülenmektedir. <strong>KoUp Cinema kendi sunucularında hiçbir video dosyası barındırmaz ve saklamaz.</strong>
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8 text-sm text-white/75 leading-relaxed font-normal">
          {/* 1. Sorumsuzluk Beyanı */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <h2>1. İçerik Barındırma Sorumsuzluk Beyanı (Disclaimer)</h2>
            </div>
            <p>
              KoUp Cinema, internet üzerinde halka açık video paylaşım platformlarına yüklenmiş olan video linklerini arayan, 
              kataloglayan ve kullanıcılarına arama/akış kolaylığı sunan bir metaveri indeks motorudur. 
            </p>
            <p>
              Platformumuzda yer alan hiçbir video kendi sunucumuza yüklenmemiştir. İlgili video içerikleri hakkında herhangi bir 
              kontrol veya sahiplik hakkımız bulunmamakta olup telif hakkı ihlali iddiası içeren videoların ana kaynağı harici video 
              sağlayıcılarıdır.
            </p>
          </section>

          {/* 2. Uyar - Kaldır Prensibi */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <FileCheck className="w-5 h-5 text-amber-400" />
              <h2>2. Uyar - Kaldır (Notice and Takedown) Prensibi</h2>
            </div>
            <p>
              KoUp Cinema yönetimi hukuka, yasalara, telif haklarına ve kişilik haklarına azami saygı göstermektedir. 
              Sitemizde telif haklarınızın ihlal edildiğini düşündüğünüz bir içerik bulunuyorsa, yasal hak sahibi veya 
              resmi yetkilisi olarak bize bildirimde bulunabilirsiniz.
            </p>
            <p>
              Tarafımıza ulaşan bildirimler titizlikle incelenir ve telif hakkı ihlali tespit edilen içerik bağlantıları 
              <strong> en geç 3 (üç) iş günü içerisinde</strong> sitemizden ve arama dizinimizden tamamen kaldırılır.
            </p>
          </section>

          {/* 3. Bildirimde Bulunurken Gereken Bilgiler */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <CheckCircle2 className="w-5 h-5 text-amber-400" />
              <h2>3. Telif Hakkı İhlal Bildiriminde İstenen Bilgiler</h2>
            </div>
            <p>
              Telif hakkı bildiriminizin ivedilikle sonuçlandırılabilmesi için lütfen e-postanızda aşağıdaki hususları eksiksiz iletiniz:
            </p>
            <ul className="space-y-2.5 text-xs sm:text-sm text-white/80">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">1</span>
                <span>Telif hakkı sahibi olduğunuzu veya eser sahibi adına hareket etmeye yetkili olduğunuzu gösteren resmi belge veya vekaletname.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">2</span>
                <span>İhlal edildiği iddia edilen telif hakkına konu eserin tam adı ve resmi kayıt bilgileri.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">3</span>
                <span>KoUp Cinema üzerinde yer alan ilgili içeriğin doğrudan ve açık URL adresi (Örn: <code>https://koup-app.vercel.app/seri/ornek-dizi/1</code>).</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">4</span>
                <span>Adınız, soyadınız, unvanınız, resmi e-posta adresiniz ve telefon numaranız.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-amber-400 shrink-0 mt-0.5">5</span>
                <span>&quot;İçeriğin hak sahibinin veya yasal temsilcisinin izni olmaksızın kullanıldığına iyi niyetle inanıldığına&quot; dair yazılı beyan.</span>
              </li>
            </ul>
          </section>

          {/* 4. İletişim */}
          <section className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/[0.08] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <Mail className="w-5 h-5 text-amber-400" />
              <h2>4. Yasal İletişim Kanalı (DMCA & Telif İletişimi)</h2>
            </div>
            <p>
              Telif hakkı ihlali bildirimlerinizi doğrudan aşağıdaki e-posta adresine iletebilirsiniz. 
              Bildiriminiz yetkili hukuk ekibimiz tarafından en geç 72 saat içinde yanıtlanacaktır:
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <a
                href="mailto:dmca@koup.app"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 font-mono text-xs font-semibold transition-colors border border-amber-500/30"
              >
                <Mail className="w-4 h-4" />
                <span>dmca@koup.app</span>
              </a>
              <a
                href="mailto:iletisim@koup.app"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white/80 hover:text-white font-mono text-xs font-semibold transition-colors border border-white/10"
              >
                <Mail className="w-4 h-4" />
                <span>iletisim@koup.app</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
