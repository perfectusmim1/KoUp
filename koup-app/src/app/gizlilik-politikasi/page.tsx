'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Shield, Lock, Eye, Cookie, FileText, ArrowLeft, Mail, ExternalLink, HelpCircle } from 'lucide-react';

export default function GizlilikPolitikasiPage() {
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
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.15)]">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Gizlilik ve Çerez Politikası
              </h1>
              <p className="text-xs sm:text-sm text-white/50">
                Son Güncelleme: 20 Ekim 2026 · KoUp Cinema Studio
              </p>
            </div>
          </div>
        </div>

        {/* Highlight Card */}
        <div className="bg-gradient-to-r from-rose-500/10 via-white/[0.03] to-transparent border border-rose-500/20 rounded-2xl p-6 backdrop-blur-xl">
          <div className="flex items-start gap-3.5">
            <Lock className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs sm:text-sm text-white/80 leading-relaxed">
              <p className="font-semibold text-white">Veri Güvenliğiniz Bizim İçin Esastır</p>
              <p>
                KoUp Cinema, kullanıcı gizliliğine ve kişisel verilerin korunmasına en üst düzeyde hassasiyet gösterir. 
                6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) ve uluslararası veri koruma standartları (GDPR) 
                kapsamında kişisel verileriniz asla izinsiz işlenmez, satılmaz veya üçüncü kişilerle paylaşılmaz.
              </p>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-8 text-sm text-white/75 leading-relaxed font-normal">
          {/* 1. Kapsam ve Tanımlar */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <FileText className="w-5 h-5 text-rose-400" />
              <h2>1. Kapsam ve Tanımlar</h2>
            </div>
            <p>
              Bu Gizlilik Politikası, KoUp Cinema (&quot;Site&quot;, &quot;Platform&quot;, &quot;koup-app.vercel.app&quot;) web sitesi, 
              mobil arayüzü ve bağlı servislerini kullanan tüm ziyaretçilerin ve kayıtlı kullanıcıların kişisel verilerinin 
              nasıl toplandığını, işlendiğini, saklandığını ve korunduğunu açıklar. Sitemizi kullanarak bu politikada 
              belirtilen şartları kabul etmiş sayılırsınız.
            </p>
          </section>

          {/* 2. Toplanan Bilgiler */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <Eye className="w-5 h-5 text-rose-400" />
              <h2>2. Hangi Bilgileri Topluyoruz?</h2>
            </div>
            <p>KoUp Cinema üzerinde toplanan veriler iki ana kategoride değerlendirilir:</p>
            <ul className="list-disc list-inside space-y-2 text-white/70 pl-2">
              <li>
                <strong className="text-white">Kullanıcı Tarafından Sağlanan Bilgiler:</strong> Üyelik kaydı sırasında belirtilen kullanıcı adı, e-posta adresi, profil resmi, biyografi, site içinde eklediğiniz yorumlar, puanlamalar, favori listeleri ve izleme tercihleri.
              </li>
              <li>
                <strong className="text-white">Otomatik Toplanan Teknik Bilgiler:</strong> Hizmet kalitesini artırmak, kötüye kullanımı engellemek ve oturum güvenliğini sağlamak amacıyla anonimleştirilmiş IP adresiniz, tarayıcı türünüz, işletim sisteminiz, ziyaret edilen sayfalar ve etkileşim süreleri.
              </li>
            </ul>
          </section>

          {/* 3. Çerezler ve Yerel Depolama */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <Cookie className="w-5 h-5 text-rose-400" />
              <h2>3. Çerezler (Cookies) ve Yerel Depolama (LocalStorage)</h2>
            </div>
            <p>
              Platformumuzda kullanıcı deneyiminizi kusursuz kılmak için çerezler ve tarayıcı yerel depolama teknolojileri kullanılmaktadır:
            </p>
            <ul className="list-disc list-inside space-y-2 text-white/70 pl-2">
              <li>
                <strong className="text-white">Oturum ve Tercih Çerezleri:</strong> Giriş yapmış oturumunuzu açık tutmak, karanlık tema ayarlarınızı, tercih ettiğiniz ses seviyesini ve video çözünürlüğünü hatırlamak.
              </li>
              <li>
                <strong className="text-white">Kaldığın Yerden Devam Et (Resume Tracking):</strong> İzlediğiniz bölümlerde hangi dakikada kaldığınızı kaydetmek amacıyla cihazınızın yerel depolama alanı kullanılır.
              </li>
              <li>
                <strong className="text-white">Çerez Tercihlerini Yönetme:</strong> Çerezleri dilediğiniz zaman tarayıcınızın ayarlarından silebilir veya engelleyebilirsiniz. Ancak bu durumda bazı kişiselleştirilmiş özellikler çalışmayabilir.
              </li>
            </ul>
          </section>

          {/* 4. Harici Kaynaklar ve Gömülü Video Oynatıcılar */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <ExternalLink className="w-5 h-5 text-rose-400" />
              <h2>4. Harici İçerikler ve Üçüncü Taraf Gömülü Oynatıcılar (Embeds)</h2>
            </div>
            <p>
              KoUp Cinema, 5651 sayılı Kanun uyarınca bir &quot;Yer Sağlayıcı&quot; ve arama dizinidir. Platformda bulunan video 
              içerikleri harici video paylaşım platformlarından (YouTube, OK.ru, Vidmoly, VK vb.) iframe ve embed yöntemiyle 
              çağrılmaktadır.
            </p>
            <p>
              Gömülü bir harici oynatıcıyı çalıştırdığınızda, söz konusu üçüncü taraf sağlayıcı kendi çerezlerini yerleştirebilir ve 
              kendi gizlilik politikalarına tabi veri toplayabilir. KoUp Cinema, üçüncü taraf sağlayıcıların veri işleme 
              politikalarından sorumlu değildir.
            </p>
          </section>

          {/* 5. Bilgi Paylaşımı ve Güvenlik */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <Lock className="w-5 h-5 text-rose-400" />
              <h2>5. Bilgilerin Korunması ve Paylaşımı</h2>
            </div>
            <p>
              Verileriniz endüstri standardı şifreleme protokolleri (SSL/TLS) ve Supabase bulut güvenliği altyapısıyla korunmaktadır. 
              Kişisel bilgileriniz şu durumlar dışında asla üçüncü taraflara aktarılmaz:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-white/70 pl-2">
              <li>Yetkili adli veya idari makamlar tarafından yürütülen yasal soruşturmalar ve resmi bildirimler,</li>
              <li>Platformun ve diğer kullanıcıların güvenliğini tehdit eden kötü niyetli saldırıların engellenmesi,</li>
              <li>Açık rızanızın bulunduğu durumlar.</li>
            </ul>
          </section>

          {/* 6. Haklarınız (KVKK Madde 11) */}
          <section className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 sm:p-8 space-y-3.5">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <HelpCircle className="w-5 h-5 text-rose-400" />
              <h2>6. Kullanıcı Olarak Haklarınız</h2>
            </div>
            <p>
              6698 sayılı Kanun&apos;un 11. maddesi uyarınca; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, 
              verilerin amacına uygun kullanılıp kullanılmadığını öğrenme, eksik veya yanlış işlenmişse düzeltilmesini isteme ve 
              kayıtlı hesabınızın ve verilerinizin silinmesini (&quot;unutulma hakkı&quot;) talep etme hakkına sahipsiniz.
            </p>
          </section>

          {/* 7. İletişim */}
          <section className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.08] rounded-2xl p-6 sm:p-8 space-y-3">
            <div className="flex items-center gap-2.5 text-white font-bold text-base sm:text-lg">
              <Mail className="w-5 h-5 text-rose-400" />
              <h2>7. İletişim ve Veri Silme Talepleri</h2>
            </div>
            <p>
              Gizlilik politikamızla ilgili soru, görüş ve kişisel verilerinizin silinmesi talepleriniz için aşağıdaki 
              iletişim kanalı üzerinden bize ulaşabilirsiniz:
            </p>
            <div className="pt-2">
              <a
                href="mailto:gizlilik@koup.app"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-rose-400 hover:text-rose-300 font-mono text-xs transition-colors border border-white/10"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>gizlilik@koup.app</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
