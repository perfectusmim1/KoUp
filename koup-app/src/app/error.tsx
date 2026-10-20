'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Error Boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#070709] text-white flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6">
        <span className="text-4xl font-bold text-amber-500">500</span>
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
        Bir Hata Oluştu
      </h1>
      <p className="text-white/60 max-w-md mb-8 text-sm sm:text-base">
        İçerik yüklenirken beklenmedik bir sorun oluştu. Sayfayı yenileyebilir veya ana sayfaya dönebilirsiniz.
      </p>
      <div className="flex gap-4 items-center">
        <button
          onClick={() => reset()}
          className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-colors border border-white/15"
        >
          Tekrar Dene
        </button>
        <Link
          href="/"
          className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 text-black font-semibold text-sm transition-colors shadow-lg shadow-sky-500/20"
        >
          Ana Sayfa
        </Link>
      </div>
    </div>
  );
}
