'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Mail, User, ShieldCheck, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';

export default function AuthModal() {
  const { isAuthModalOpen, setIsAuthModalOpen, loginWithEmail, registerWithEmail } = useKoUp();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const err = await loginWithEmail(email.trim(), password);
        if (err) {
          setErrorMessage(
            err.includes('Invalid login credentials')
              ? 'E-posta veya şifre hatalı. Lütfen kontrol ediniz.'
              : err
          );
        } else {
          setIsAuthModalOpen(false);
          setEmail('');
          setPassword('');
        }
      } else {
        if (!username.trim() || username.trim().length < 3) {
          setErrorMessage('Kullanıcı adı en az 3 karakter olmalıdır.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setErrorMessage('Şifre en az 6 karakter olmalıdır.');
          setLoading(false);
          return;
        }
        const err = await registerWithEmail(email.trim(), password, username.trim());
        if (err) {
          setErrorMessage(err);
        } else {
          setIsAuthModalOpen(false);
          setEmail('');
          setPassword('');
          setUsername('');
        }
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsAuthModalOpen(false)}
          className="fixed inset-0 bg-black/80 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md rounded-3xl bg-[#121216] border border-white/15 p-6 sm:p-8 shadow-[0_32px_80px_rgba(0,0,0,0.9)] overflow-hidden z-10"
        >
          {/* Close Button */}
          <button
            onClick={() => setIsAuthModalOpen(false)}
            className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header */}
          <div className="text-center space-y-2 mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/10 border border-white/15 text-white mb-1 shadow-inner">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {mode === 'login' ? 'KoUp Hesabına Giriş Yap' : 'Yeni KoUp Hesabı Oluştur'}
            </h2>
            <p className="text-xs text-white/60">
              {mode === 'login'
                ? 'İzleme geçmişin, favori listelerin ve yönetici paneline erişim için giriş yapın.'
                : 'K-Drama, Anime ve sinema dünyasına katılın, topluluğun bir parçası olun.'}
            </p>
          </div>

          {/* Mode Switch Tabs */}
          <div className="grid grid-cols-2 p-1 rounded-2xl bg-black/40 border border-white/10 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Giriş Yap
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Kayıt Ol
            </button>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/70">Kullanıcı Adı</label>
                <div className="relative flex items-center">
                  <User className="absolute left-3.5 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ornek_kullanici"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/40 transition-all"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/70">E-posta Adresi</label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3.5 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@koup.com veya e-postanız"
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/40 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white/70">Şifre</label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3.5 w-4 h-4 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/40 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 text-white/40 hover:text-white cursor-pointer"
                  aria-label="Şifreyi Göster/Gizle"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 rounded-2xl bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? 'İşleniyor...' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol ve Katıl'}</span>
              {!loading && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </form>

          {/* Subtext info */}
          <div className="mt-5 text-center text-[11px] text-white/45">
            {mode === 'login' ? (
              <p>
                Hesabın yok mu?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMessage(null);
                  }}
                  className="text-white underline underline-offset-2 hover:text-white/80 cursor-pointer"
                >
                  Hemen Kaydol
                </button>
              </p>
            ) : (
              <p>
                Zaten hesabın var mı?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage(null);
                  }}
                  className="text-white underline underline-offset-2 hover:text-white/80 cursor-pointer"
                >
                  Giriş Yap
                </button>
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
