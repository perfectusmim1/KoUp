'use client';

import { supabase } from '@/lib/supabase';

export async function getAdminAuthHeaders(extraHeaders: HeadersInit = {}): Promise<HeadersInit> {
  let token: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch {
    // Session retrieval fallback
  }

  // Fallback to localStorage if getSession didn't resolve immediately
  if (!token && typeof window !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('-auth-token') || key.startsWith('sb-'))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            token = parsed?.access_token || parsed?.session?.access_token || parsed?.[0] || null;
            if (token) break;
          }
        }
      }
    } catch {
      // JSON parse fallback
    }
  }

  const base: Record<string, string> = {};
  if (token) {
    base['Authorization'] = `Bearer ${token}`;
  }

  return {
    ...base,
    ...extraHeaders,
  };
}

export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = await getAdminAuthHeaders(init.headers || {});
  return fetch(input, {
    ...init,
    headers,
  });
}
