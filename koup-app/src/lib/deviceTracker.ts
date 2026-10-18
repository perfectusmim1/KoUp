import { supabase } from '@/lib/supabase';
import { getClientFingerprint } from '@/lib/fingerprint';

export interface UserDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  device_type: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
  ip: string | null;
  last_active_at: string;
  created_at: string;
  is_current?: boolean;
}

export function parseDeviceEnvironment(): {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  os: string;
  browser: string;
  deviceName: string;
} {
  if (typeof window === 'undefined') {
    return {
      deviceType: 'desktop',
      os: 'Sunucu',
      browser: 'Sunucu Ortamı',
      deviceName: 'Bilinmeyen Cihaz',
    };
  }

  const ua = navigator.userAgent || '';
  let os = 'Bilinmeyen İşletim Sistemi';
  let deviceType: 'desktop' | 'mobile' | 'tablet' = 'desktop';

  // Detect Mobile / Tablet
  const isTablet = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
  const isMobile = /mobile|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/i.test(ua);

  if (isTablet) {
    deviceType = 'tablet';
  } else if (isMobile) {
    deviceType = 'mobile';
  } else {
    deviceType = 'desktop';
  }

  // OS detection
  if (/windows phone/i.test(ua)) {
    os = 'Windows Phone';
  } else if (/windows nt 10\.0/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/windows nt 6\.3/i.test(ua)) {
    os = 'Windows 8.1';
  } else if (/windows nt 6\.1/i.test(ua)) {
    os = 'Windows 7';
  } else if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/iphone/i.test(ua)) {
    os = 'iOS (iPhone)';
  } else if (/ipad/i.test(ua)) {
    os = 'iPadOS';
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/android/i.test(ua)) {
    os = 'Android';
  } else if (/cros/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser detection
  let browser = 'Bilinmeyen Tarayıcı';
  if (/edg\//i.test(ua)) {
    browser = 'Microsoft Edge';
  } else if (/opr\//i.test(ua) || /opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome|crios/i.test(ua)) {
    browser = 'Google Chrome';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Mozilla Firefox';
  } else if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'Apple Safari';
  }

  const deviceName = `${os} • ${browser}`;

  return {
    deviceType,
    os,
    browser,
    deviceName,
  };
}

let cachedIp: string | null = null;
let ipFetchPromise: Promise<string | null> | null = null;

export async function fetchClientIp(): Promise<string | null> {
  if (cachedIp) return cachedIp;
  if (ipFetchPromise) return ipFetchPromise;

  ipFetchPromise = (async () => {
    try {
      const res = await fetch('/api/client-ip', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json?.ip) {
          cachedIp = json.ip;
          return json.ip;
        }
      }
    } catch {
      // ignore
    }
    return null;
  })().finally(() => {
    ipFetchPromise = null;
  });

  return ipFetchPromise;
}

/**
 * Register or update the current device session in Supabase with zero duplicate guarantee
 */
export async function registerOrHeartbeatDevice(userId: string): Promise<UserDevice | null> {
  if (!userId || typeof window === 'undefined') return null;

  try {
    const deviceId = await getClientFingerprint();
    const { deviceType, os, browser, deviceName } = parseDeviceEnvironment();
    const ip = await fetchClientIp();

    const payload = {
      user_id: userId,
      device_id: deviceId,
      device_name: deviceName,
      device_type: deviceType,
      browser,
      os,
      ip: ip || null,
      last_active_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('user_devices')
      .upsert(payload, { onConflict: 'user_id,device_id' })
      .select()
      .single();

    if (error) {
      console.warn('[DeviceTracker] Heartbeat upsert error:', error.message);
      return null;
    }

    return data as UserDevice;
  } catch (err) {
    console.warn('[DeviceTracker] Heartbeat error:', err);
    return null;
  }
}

/**
 * Fetch all registered active devices for the current user
 */
export async function fetchUserDevices(userId: string, currentDeviceId?: string): Promise<UserDevice[]> {
  if (!userId) return [];

  try {
    const { data, error } = await supabase
      .from('user_devices')
      .select('*')
      .eq('user_id', userId)
      .order('last_active_at', { ascending: false });

    if (error || !data) {
      console.warn('[DeviceTracker] Fetch devices error:', error?.message);
      return [];
    }

    const curId = currentDeviceId || (typeof window !== 'undefined' ? localStorage.getItem('koup_device_fingerprint_v1') : null);

    return data.map((d: any) => ({
      ...d,
      is_current: Boolean(curId && d.device_id === curId),
    })) as UserDevice[];
  } catch (err) {
    console.warn('[DeviceTracker] Error fetching devices:', err);
    return [];
  }
}

/**
 * Terminate/Revoke a specific device session
 */
export async function terminateDeviceSession(deviceId: string, userId: string): Promise<boolean> {
  if (!deviceId || !userId) return false;

  try {
    const { error } = await supabase
      .from('user_devices')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId);

    return !error;
  } catch (err) {
    console.warn('[DeviceTracker] Terminate session error:', err);
    return false;
  }
}

/**
 * Terminate all other sessions except the current one
 */
export async function terminateAllOtherDevices(userId: string, currentDeviceId: string): Promise<boolean> {
  if (!userId || !currentDeviceId) return false;

  try {
    const { error } = await supabase
      .from('user_devices')
      .delete()
      .eq('user_id', userId)
      .neq('device_id', currentDeviceId);

    return !error;
  } catch (err) {
    console.warn('[DeviceTracker] Terminate all error:', err);
    return false;
  }
}
