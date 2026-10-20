'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, LogIn, Sparkles, Compass } from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';

export default function ProfileRootPage() {
  const user = useKoUpSelector((s) => s.user);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const router = useRouter();

  useEffect(() => {
    if (user?.username) {
      router.replace(`/profil/${encodeURIComponent(user.username)}`);
    }
  }, [user, router]);

  if (user?.username) {
    return (
      <div className="min-h-[75vh] flex items-center justify-center pt-28">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(56,189,248,0.4)]" />
          <p className="text-xs text-white/50 font-mono tracking-wider">Profilinize yönlendiriliyorsunuz...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
      <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-sm">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
          <User className="w-10 h-10 text-sky-400" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            KoUp Profiline Hoş Geldin
          </h1>
          <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
            İzleme geçmişinizi senkronize etmek, kütüphanenizi yönetmek ve özel koleksiyonlar oluşturmak için giriş yapın.
          </p>
        </div>

        <div className="pt-2 flex flex-col gap-3">
          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>

          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="w-full py-3 px-6 rounded-full glass-pill text-xs font-semibold text-white/80 hover:text-white transition-colors flex items-center justify-center gap-2"
          >
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Katalogda Dizi & Anime Keşfet</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
