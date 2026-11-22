'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getCookieConsent } from '@/lib/tasteProfile';
import { runWhenIdle } from '@/lib/yieldToMain';

const CookieConsentBanner = dynamic(() => import('@/components/CookieConsentBanner'), {
  ssr: false,
});

export default function DeferredCookieBanner() {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const consent = getCookieConsent();
    if (!consent.decided) {
      return runWhenIdle(() => setShouldLoad(true), 1200);
    }

    const onOpenModal = () => setShouldLoad(true);
    window.addEventListener('koup:open-cookie-modal', onOpenModal);
    return () => {
      window.removeEventListener('koup:open-cookie-modal', onOpenModal);
    };
  }, []);

  if (!shouldLoad) return null;
  return <CookieConsentBanner />;
}
