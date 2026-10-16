'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Lock, Mail, User, ShieldCheck, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';

function translateAuthError(err: string): string {
  const lower = err.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'E-posta adresi veya şifre hatalı. Lütfen kontrol edip tekrar deneyin.';
  }
  if (lower.includes('user already registered') || lower.includes('already exists')) {
    return 'Bu e-posta adresi ile zaten kayıtlı bir hesap bulunmaktadır.';
  }
  if (lower.includes('profiles_username_key') || lower.includes('username already taken')) {
    return 'Bu kullanıcı adı zaten kullanımda. Lütfen farklı bir kullanıcı adı seçin.';
  }
  if (lower.includes('rate limit')) {
    return 'Çok fazla deneme yapıldı. Lütfen güvenlik nedeniyle birkaç dakika bekleyin.';
  }
  if (lower.includes('password should be at least') || lower.includes('password is too short')) {
    return 'Şifre en az 6 karakter olmalıdır.';
  }
  if (lower.includes('email not confirmed')) {
    return 'E-posta adresiniz henüz onaylanmamış. Lütfen gelen kutunuzu kontrol edin.';
  }
  if (lower.includes('invalid email') || lower.includes('unable to validate email')) {
    return 'Lütfen geçerli bir e-posta adresi giriniz.';
  }
  if (lower.includes('signup is disabled')) {
    return 'Yeni kullanıcı kaydı şu an sistem tarafından devre dışı bırakılmıştır.';
  }
  return err;
}

export default function AuthModal() {
  const {
    isAuthModalOpen,
    setIsAuthModalOpen,
    authModalMessage,
    setAuthModalMessage,
    loginWithEmail,
    registerWithEmail,
  } = useKoUp();

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClose = () => {
    setIsAuthModalOpen(false);
    setAuthModalMessage(null);
    setErrorMessage(null);
    setEmail('');
    setPassword('');
    setUsername('');
    setShowPassword(false);
  };

  // Close on Escape key press and lock background scroll
  useEffect(() => {
    if (!isAuthModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isAuthModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;
    const cleanUsername = username.trim();

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMessage('Lütfen geçerli bir e-posta adresi giriniz.');
      return;
    }

    if (mode === 'register') {
      // Username validation
      if (cleanUsername.length < 3) {
        setErrorMessage('Kullanıcı adı en az 3 karakter olmalıdır.');
        return;
      }
      if (cleanUsername.length > 28) {
        setErrorMessage('Kullanıcı adı en fazla 28 karakter olabilir.');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
        setErrorMessage('Kullanıcı adı yalnızca harf, rakam ve alt çizgi (_) içerebilir.');
        return;
      }
      if (cleanPassword.length < 6) {
        setErrorMessage('Şifre en az 6 karakter olmalıdır.');
        return;
      }
    } else {
      if (!cleanPassword) {
        setErrorMessage('Lütfen şifrenizi giriniz.');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const err = await loginWithEmail(cleanEmail, cleanPassword);
        if (err) {
          setErrorMessage(translateAuthError(err));
        } else {
          handleClose();
        }
      } else {
        const err = await registerWithEmail(cleanEmail, cleanPassword, cleanUsername);
        if (err) {
          setErrorMessage(translateAuthError(err));
        } else {
          handleClose();
        }
      }
    } catch (error: any) {
      setErrorMessage(
        translateAuthError(error?.message || 'Bir hata oluştu. Lütfen tekrar deneyin.')
      );
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-[999999] flex items-center justify-center p-4 pointer-events-auto"
          onClick={handleClose}
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop with pointer-events-none so it CANNOT steal clicks from dialog */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-md pointer-events-none -z-10"
          />

          {/* Modal Window with e.stopPropagation() and pointer-events-auto */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 14 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-20 w-full max-w-md rounded-3xl bg-[#121216] border border-white/20 p-6 sm:p-8 shadow-[0_32px_90px_rgba(0,0,0,0.95)] overflow-hidden pointer-events-auto"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-white/70 hover:text-white hover:bg-white/20 transition-all cursor-pointer pointer-events-auto z-30"
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Header */}
            <div className="text-center space-y-2 mb-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/10 border border-white/15 text-white mb-1 shadow-inner">
                <ShieldCheck className="w-6 h-6 text-sky-400" />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {mode === 'login' ? 'KoUp Hesabına Giriş Yap' : 'Yeni KoUp Hesabı Oluştur'}
              </h2>
              <p className="text-xs text-white/60">
                {mode === 'login'
                  ? 'İzleme geçmişin, favori listelerin ve profilin için giriş yapın.'
                  : 'K-Drama, Anime ve sinema dünyasına katılın, topluluğun bir parçası olun.'}
              </p>
            </div>

            {/* Prompt Notice (e.g. "İşlem yapabilmek için lütfen giriş yapın.") */}
            {authModalMessage && (
              <div className="mb-5 p-3 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-200 text-xs flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="leading-relaxed font-semibold">{authModalMessage}</span>
              </div>
            )}

            {/* Mode Switch Tabs */}
            <div className="grid grid-cols-2 p-1 rounded-2xl bg-black/50 border border-white/10 mb-6 relative z-10">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                }}
                className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer pointer-events-auto ${
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
                className={`py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer pointer-events-auto ${
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
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4 relative z-10 pointer-events-auto">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white/70">Kullanıcı Adı</label>
                  <div className="relative flex items-center">
                    <User className="absolute left-3.5 w-4 h-4 text-white/40 pointer-events-none" />
                    <input
                      type="text"
                      required
                      maxLength={28}
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="ornek_kullanici"
                      className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-sky-400/60 transition-all cursor-text pointer-events-auto"
                    />
                  </div>
                  <p className="text-[10px] text-white/40 pl-1">En az 3, en fazla 28 karakter (harf, rakam ve _)</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/70">E-posta Adresi</label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3.5 w-4 h-4 text-white/40 pointer-events-none" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="eposta@koup.com"
                    className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-sky-400/60 transition-all cursor-text pointer-events-auto"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-white/70">Şifre</label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 w-4 h-4 text-white/40 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-sky-400/60 transition-all cursor-text pointer-events-auto"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 text-white/40 hover:text-white cursor-pointer pointer-events-auto p-1"
                    aria-label="Şifreyi Göster/Gizle"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 rounded-2xl bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer pointer-events-auto disabled:opacity-50 shadow-lg"
              >
                <span>{loading ? 'İşleniyor...' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol ve Katıl'}</span>
                {!loading && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </form>

            {/* Subtext info */}
            <div className="mt-5 text-center text-[11px] text-white/45 relative z-10">
              {mode === 'login' ? (
                <p>
                  Hesabın yok mu?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setErrorMessage(null);
                    }}
                    className="text-white underline underline-offset-2 hover:text-white/80 cursor-pointer pointer-events-auto font-medium"
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
                    className="text-white underline underline-offset-2 hover:text-white/80 cursor-pointer pointer-events-auto font-medium"
                  >
                    Giriş Yap
                  </button>
                </p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
