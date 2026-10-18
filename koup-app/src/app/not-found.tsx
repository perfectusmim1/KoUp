import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#070709] text-white flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
        <span className="text-4xl font-bold text-red-500">404</span>
      </div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
        Sayfa Bulunamadı
      </h1>
      <p className="text-white/60 max-w-md mb-8 text-sm sm:text-base">
        Aradığınız dizi, bölüm veya sayfa kaldırılmış ya da adresi değişmiş olabilir.
      </p>
      <Link
        href="/"
        className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 text-black font-semibold text-sm transition-all shadow-lg shadow-sky-500/20"
      >
        Ana Sayfaya Dön
      </Link>
    </div>
  );
}
