import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import { getServiceSupabase } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_CUSTOM_SCHEMES = ['dramavadisi:', 'dramabox:', 'wdt:', 'pilavyer:'] as const;

const COMMON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface RateBucket {
  timestamps: number[];
}
const ipRateBuckets = new Map<string, RateBucket>();
const recentReportDedup = new Map<string, number>();

function cleanupRateState(now: number): void {
  if (ipRateBuckets.size > 2000) {
    for (const [k, b] of ipRateBuckets.entries()) {
      b.timestamps = b.timestamps.filter((t) => now - t < 60_000);
      if (b.timestamps.length === 0) ipRateBuckets.delete(k);
    }
  }
  if (recentReportDedup.size > 4000) {
    for (const [k, exp] of recentReportDedup.entries()) {
      if (now > exp) recentReportDedup.delete(k);
    }
  }
}

function hashClientIp(ip: string): string {
  const salt = process.env.SUPABASE_SECRET_KEY?.slice(0, 16) || 'koup_dead_report_salt';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function stripIpv6ZoneAndBrackets(raw: string): string {
  return raw.toLowerCase().trim().replace(/^\[|\]$/g, '').split('%')[0];
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpAddress(rawIp: string): boolean {
  const ip = stripIpv6ZoneAndBrackets(rawIp);
  if (!ip) return true;
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (!net.isIPv6(ip)) return true;
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:0' || ip === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const v4Dotted = ip.match(/(?:^::(?:ffff:)?|:)([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/);
  if (v4Dotted?.[1]) return isBlockedIpv4(v4Dotted[1]);
  const v4Hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1], 16);
    const lo = parseInt(v4Hex[2], 16);
    return isBlockedIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  const firstGroup = parseInt(ip.split(':')[0] || '0', 16);
  if (Number.isNaN(firstGroup)) return true;
  if ((firstGroup & 0xfe00) === 0xfc00) return true;
  if ((firstGroup & 0xffc0) === 0xfe80) return true;
  if ((firstGroup & 0xff00) === 0xff00) return true;
  if (ip.startsWith('64:ff9b::') || ip.startsWith('64:ff9b:1::')) return true;
  return false;
}

async function isSafeExternalUrlAsync(rawUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const h = stripIpv6ZoneAndBrackets(parsed.hostname);
    if (
      !h ||
      h === 'localhost' ||
      h === 'metadata' ||
      h === 'metadata.google.internal' ||
      h === 'instance-data' ||
      h.endsWith('.internal') ||
      h.endsWith('.local') ||
      h.endsWith('.lan') ||
      h.endsWith('.home') ||
      h.endsWith('.arpa') ||
      /^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(h) ||
      /^\d+\.\d+$/.test(h) ||
      /^\d+\.\d+\.\d+$/.test(h)
    ) {
      return false;
    }
    if (net.isIP(h) !== 0) return !isBlockedIpAddress(h);
    const records = await dns.promises.lookup(h, { all: true });
    if (!records || records.length === 0) return false;
    return !records.some((rec) => isBlockedIpAddress(rec.address));
  } catch {
    return false;
  }
}

async function safeFetch(
  initialUrl: string,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(await isSafeExternalUrlAsync(currentUrl))) {
      throw new Error('Blocked SSRF target');
    }
    const res = await fetch(currentUrl, currentInit);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      res.body?.cancel?.().catch(() => {});
      if (!location || hop === maxRedirects) {
        return { response: res, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).toString();
      if ([301, 302, 303].includes(res.status) && currentInit.method && currentInit.method !== 'GET' && currentInit.method !== 'HEAD') {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

function isAllowedStreamInput(rawUrl: string): { valid: boolean; isCustomScheme: boolean } {
  const u = rawUrl.trim();
  const low = u.toLowerCase();
  if (!u || u.length > 4000) return { valid: false, isCustomScheme: false };
  if (
    low === 'dead' ||
    low.startsWith('javascript:') ||
    low.includes('void(0)') ||
    low.startsWith('data:') ||
    low.startsWith('vbscript:') ||
    low.startsWith('pending://')
  ) {
    return { valid: false, isCustomScheme: false };
  }
  if (low.startsWith('http://') || low.startsWith('https://')) {
    return { valid: true, isCustomScheme: false };
  }
  const custom = ALLOWED_CUSTOM_SCHEMES.some((s) => low.startsWith(s) && low.length > s.length);
  return { valid: custom, isCustomScheme: custom };
}

function inferReferer(targetUrl: string, provider: string): string {
  const low = targetUrl.toLowerCase();
  const p = provider.toLowerCase();
  if (low.includes('b-cdn.net') || low.includes('shortizle') || low.includes('mybigdramapool') || p === 'shortizle') {
    return 'https://shortizle.com/';
  }
  if (low.includes('dramavadisi') || p === 'dramavadisi') return 'https://dramavadisi.com/';
  if (low.includes('dramabox') || p === 'dramabox') return 'https://www.dramabox.com/';
  if (low.includes('dtpasn')) return 'https://dtpasn.asia/';
  if (low.includes('vidmoly') || p.includes('vidmoly')) return 'https://vidmoly.biz/';
  if (low.includes('ok.ru') || p.includes('ok')) return 'https://ok.ru/';
  if (low.includes('vk.com') || p === 'vk') return 'https://vk.com/';
  if (low.includes('mail.ru') || p.includes('mail')) return 'https://my.mail.ru/';
  if (low.includes('mp4upload') || p === 'mp4upload') return 'https://www.mp4upload.com/';
  if (low.includes('uqload') || p === 'uqload') return 'https://uqload.vc/';
  try {
    const parsed = new URL(targetUrl);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://koup.app/';
  }
}

async function probeSourceDeadStatus(
  streamUrl: string,
  provider: string
): Promise<{ verifiedDead: boolean; httpStatus: number; probeReason: string }> {
  const low = streamUrl.toLowerCase();

  // 1. Custom schemes verification
  if (low.startsWith('dramavadisi:')) {
    const parts = streamUrl.slice('dramavadisi:'.length).split(':');
    const seriesId = parts[0] || '';
    const epNo = parts[1] || '1';
    if (!/^\d+$/.test(seriesId)) {
      return { verifiedDead: true, httpStatus: 400, probeReason: 'invalid_dramavadisi_id' };
    }
    try {
      const { response: apiRes } = await safeFetch(
        `https://dramavadisi.com/api/series/${encodeURIComponent(seriesId)}/watch`,
        {
          headers: { 'User-Agent': COMMON_UA, Referer: 'https://dramavadisi.com/', Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (!apiRes.ok) {
        return { verifiedDead: true, httpStatus: apiRes.status, probeReason: `dramavadisi_api_${apiRes.status}` };
      }
      const data = await apiRes.json();
      const episodes: any[] = Array.isArray(data?.episodes) ? data.episodes : [];
      const epInt = parseInt(epNo, 10);
      const target =
        episodes.find((e: any) => String(e?.no ?? '') === String(epNo) || String(e?.id ?? '') === String(epNo)) ||
        (Number.isFinite(epInt) && epInt >= 1 && epInt <= episodes.length ? episodes[epInt - 1] : null);
      if (!target?.src) {
        return { verifiedDead: true, httpStatus: 404, probeReason: 'dramavadisi_episode_missing' };
      }
      const playUrl = String(target.src).startsWith('http')
        ? String(target.src)
        : new URL(String(target.src), 'https://dramavadisi.com').toString();
      const { response: mRes } = await safeFetch(playUrl, {
        headers: { 'User-Agent': COMMON_UA, Referer: 'https://dramavadisi.com/', Range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(6000),
      });
      mRes.body?.cancel?.().catch(() => {});
      if (mRes.ok || mRes.status === 206) {
        return { verifiedDead: false, httpStatus: mRes.status, probeReason: 'dramavadisi_alive' };
      }
      return { verifiedDead: true, httpStatus: mRes.status, probeReason: `dramavadisi_media_${mRes.status}` };
    } catch {
      return { verifiedDead: true, httpStatus: 504, probeReason: 'dramavadisi_unreachable' };
    }
  }

  if (low.startsWith('dramabox:')) {
    const parts = streamUrl.slice('dramabox:'.length).split(':');
    const bookId = parts[0] || '';
    const chapterToken = parts[1] || '1';
    if (!/^[a-zA-Z0-9_-]+$/.test(bookId) || !/^[a-zA-Z0-9_-]+$/.test(chapterToken)) {
      return { verifiedDead: true, httpStatus: 400, probeReason: 'invalid_dramabox_id' };
    }
    try {
      const pageUrl = `https://www.dramabox.com/tr/video/${encodeURIComponent(bookId)}_play/${encodeURIComponent(chapterToken)}_Episode-1`;
      const { response: res } = await safeFetch(pageUrl, {
        headers: { 'User-Agent': COMMON_UA, Referer: 'https://www.dramabox.com/tr' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) {
        return { verifiedDead: true, httpStatus: res.status, probeReason: `dramabox_http_${res.status}` };
      }
      const html = await res.text();
      const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (!nd?.[1]) {
        return { verifiedDead: true, httpStatus: 422, probeReason: 'dramabox_missing_next_data' };
      }
      const cl: any[] = JSON.parse(nd[1])?.props?.pageProps?.chapterList || [];
      const target = cl.find((c: any) => String(c?.id ?? c?.chapterId ?? '') === String(chapterToken));
      if (target && target.unlock !== false && !target.isLocked && (target.mp4 || target.videoUrl)) {
        return { verifiedDead: false, httpStatus: 200, probeReason: 'dramabox_alive' };
      }
      return { verifiedDead: true, httpStatus: 404, probeReason: 'dramabox_locked_or_missing' };
    } catch {
      return { verifiedDead: true, httpStatus: 504, probeReason: 'dramabox_unreachable' };
    }
  }

  if (low.startsWith('wdt:') || low.startsWith('pilavyer:')) {
    // Allow upstream verification fallback or treat timeout/error as dead pending check
    return { verifiedDead: true, httpStatus: 410, probeReason: 'custom_scheme_reported_dead' };
  }

  // 2. Shortİzle watch URL check (direct /media/ links require watch page)
  if (low.includes('shortizle.com/')) {
    try {
      const parsed = new URL(streamUrl);
      const watchParam = parsed.searchParams.get('watch') || '';
      const watchUrl = watchParam
        ? watchParam.startsWith('http')
          ? watchParam
          : `https://shortizle.com${watchParam.startsWith('/') ? '' : '/'}${watchParam}`
        : parsed.pathname.startsWith('/embed/')
        ? `https://shortizle.com${parsed.pathname.replace(/^\/embed\//i, '/watch/')}`
        : parsed.pathname.startsWith('/watch/')
        ? `https://shortizle.com${parsed.pathname}`
        : streamUrl;
      const { response: wRes } = await safeFetch(watchUrl, {
        headers: { 'User-Agent': COMMON_UA, Referer: 'https://shortizle.com/' },
        signal: AbortSignal.timeout(6000),
      });
      if (!wRes.ok) {
        return { verifiedDead: true, httpStatus: wRes.status, probeReason: `shortizle_http_${wRes.status}` };
      }
      const wHtml = await wRes.text();
      if (wHtml.includes('"externalSources"') || wHtml.includes('&quot;externalSources&quot;') || wHtml.includes('externalSources')) {
        return { verifiedDead: false, httpStatus: 200, probeReason: 'shortizle_alive' };
      }
      return { verifiedDead: true, httpStatus: 410, probeReason: 'shortizle_no_sources' };
    } catch {
      return { verifiedDead: true, httpStatus: 504, probeReason: 'shortizle_unreachable' };
    }
  }

  // 3. DTPASN verification
  if (low.includes('dtpasn.asia/video/')) {
    const hm = streamUrl.match(/\/video\/([a-zA-Z0-9]+)/i);
    if (!hm?.[1]) return { verifiedDead: true, httpStatus: 400, probeReason: 'dtpasn_invalid_hash' };
    try {
      const hash = hm[1];
      const { response: pageRes } = await safeFetch(`https://dtpasn.asia/video/${hash}`, {
        headers: { 'User-Agent': COMMON_UA, Referer: 'https://koredizi.com/' },
        signal: AbortSignal.timeout(5000),
      });
      const setCookies =
        typeof (pageRes.headers as any).getSetCookie === 'function'
          ? ((pageRes.headers as any).getSetCookie() as string[])
          : [pageRes.headers.get('set-cookie') || ''];
      let dtCookieHeader = '';
      for (const sc of setCookies) {
        const m = sc.match(/(fireplayer_player=[a-zA-Z0-9_-]+)/);
        if (m?.[1]) {
          dtCookieHeader = m[1];
          break;
        }
      }
      pageRes.body?.cancel?.().catch(() => {});
      const { response: postRes } = await safeFetch(
        `https://dtpasn.asia/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`,
        {
          method: 'POST',
          headers: {
            'User-Agent': COMMON_UA,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: 'https://dtpasn.asia',
            Referer: `https://dtpasn.asia/video/${hash}`,
            ...(dtCookieHeader ? { Cookie: dtCookieHeader } : {}),
          },
          body: new URLSearchParams({ hash, r: 'https://koredizi.com/' }).toString(),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!postRes.ok) {
        return { verifiedDead: true, httpStatus: postRes.status, probeReason: `dtpasn_api_${postRes.status}` };
      }
      const j = await postRes.json();
      const link = j?.securedLink || j?.videoSource;
      if (!link) return { verifiedDead: true, httpStatus: 410, probeReason: 'dtpasn_no_link' };
      const { response: mRes } = await safeFetch(link, {
        headers: {
          'User-Agent': COMMON_UA,
          Referer: `https://dtpasn.asia/video/${hash}`,
          ...(dtCookieHeader ? { Cookie: dtCookieHeader } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      const txt = await mRes.text();
      if (!mRes.ok || txt.toLowerCase().includes('security error') || !txt.includes('#EXTM3U')) {
        return { verifiedDead: true, httpStatus: mRes.status || 502, probeReason: 'dtpasn_security_error_or_invalid' };
      }
      return { verifiedDead: false, httpStatus: 200, probeReason: 'dtpasn_alive' };
    } catch {
      return { verifiedDead: true, httpStatus: 504, probeReason: 'dtpasn_unreachable' };
    }
  }

  // 4. Generic HTTP(S) probe with SSRF-safe redirects
  try {
    const referer = inferReferer(streamUrl, provider);
    const { response: res } = await safeFetch(streamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': COMMON_UA,
        Referer: referer,
        Range: 'bytes=0-2047',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (res.status === 404 || res.status === 410 || res.status === 451 || res.status >= 500 || res.status === 403) {
      res.body?.cancel?.().catch(() => {});
      return { verifiedDead: true, httpStatus: res.status, probeReason: `http_${res.status}` };
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('video/') || ct.includes('mpegurl') || ct.includes('application/octet-stream')) {
      const sample = ct.includes('mpegurl') ? await res.text() : '';
      if (sample) {
        const sLow = sample.trim().toLowerCase();
        if (sLow.includes('security error') || (!sample.includes('#EXTM3U') && !sample.includes('#EXTINF'))) {
          return { verifiedDead: true, httpStatus: 502, probeReason: 'invalid_hls_manifest' };
        }
      } else {
        res.body?.cancel?.().catch(() => {});
      }
      return { verifiedDead: false, httpStatus: res.status, probeReason: 'media_alive' };
    }

    const text = await res.text();
    const lowText = text.toLowerCase();
    if (
      lowText.includes('file was deleted') ||
      lowText.includes('file not found') ||
      lowText.includes('video not found') ||
      lowText.includes('no video found') ||
      lowText.includes('this video not found') ||
      lowText.includes('file is no longer available') ||
      lowText.includes('deleted by owner') ||
      lowText.includes('security error') ||
      (low.includes('.m3u8') && !text.includes('#EXTM3U') && !text.includes('#EXTINF'))
    ) {
      return { verifiedDead: true, httpStatus: res.status || 410, probeReason: 'deleted_marker_or_invalid_manifest' };
    }

    return { verifiedDead: false, httpStatus: res.status, probeReason: 'upstream_alive' };
  } catch {
    return { verifiedDead: true, httpStatus: 504, probeReason: 'upstream_timeout_or_unreachable' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const now = Date.now();
    cleanupRateState(now);

    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown-ip';
    const ipHash = hashClientIp(clientIp);

    // Rate limit: max 20 reports/minute per IP hash
    const bucket = ipRateBuckets.get(ipHash) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 60_000);
    if (bucket.timestamps.length >= 20) {
      return NextResponse.json(
        { ok: false, error: 'Çok fazla kırık kaynak bildirimi gönderildi. Lütfen kısa süre bekleyin.' },
        { status: 429 }
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz istek gövdesi.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: 'Geçersiz JSON biçimi.' }, { status: 400 });
    }

    const mediaId = Number(body.media_id);
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      return NextResponse.json({ ok: false, error: 'Geçerli bir media_id zorunludur.' }, { status: 400 });
    }

    const seasonNumber =
      body.season_number === undefined || body.season_number === null
        ? 1
        : Number(body.season_number);
    const episodeNumber =
      body.episode_number === undefined || body.episode_number === null
        ? 1
        : Number(body.episode_number);
    if (
      !Number.isInteger(seasonNumber) ||
      seasonNumber < 1 ||
      seasonNumber > 200 ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 0 ||
      episodeNumber > 10000
    ) {
      return NextResponse.json({ ok: false, error: 'Geçersiz sezon veya bölüm numarası.' }, { status: 400 });
    }

    const rawStreamUrl = typeof body.stream_url === 'string' ? body.stream_url.trim() : '';
    const urlCheck = isAllowedStreamInput(rawStreamUrl);
    if (!urlCheck.valid) {
      return NextResponse.json({ ok: false, error: 'Geçersiz stream_url.' }, { status: 400 });
    }

    if (!urlCheck.isCustomScheme) {
      const safe = await isSafeExternalUrlAsync(rawStreamUrl);
      if (!safe) {
        return NextResponse.json(
          { ok: false, error: 'Hedef adres güvenlik politikası nedeniyle reddedildi (SSRF).' },
          { status: 403 }
        );
      }
    }

    const provider =
      typeof body.provider === 'string'
        ? body.provider.replace(/[<>]/g, '').trim().slice(0, 64)
        : 'unknown';
    const userReason =
      typeof body.reason === 'string'
        ? body.reason.replace(/[<>]/g, '').trim().slice(0, 240)
        : 'player_failover';

    // Deduplicate identical (ipHash, mediaId, season, episode, stream_url) for 5 minutes
    const dedupKey = `${ipHash}:${mediaId}:${seasonNumber}:${episodeNumber}:${rawStreamUrl}`;
    const lastReportedAt = recentReportDedup.get(dedupKey);
    if (lastReportedAt && now < lastReportedAt) {
      return NextResponse.json({
        ok: true,
        deduplicated: true,
        message: 'Bu kaynak zaten kısa süre önce bildirildi.',
      });
    }

    bucket.timestamps.push(now);
    ipRateBuckets.set(ipHash, bucket);

    // Anti-spoof: server-side verification before logging to Supabase
    const probe = await probeSourceDeadStatus(rawStreamUrl, provider);
    if (!probe.verifiedDead) {
      recentReportDedup.set(dedupKey, now + 60_000);
      return NextResponse.json({
        ok: false,
        verifiedDead: false,
        httpStatus: probe.httpStatus,
        message: 'Kaynak sunucuda erişilebilir görünüyor.',
      });
    }

    const db = getServiceSupabase();
    const nowIso = new Date().toISOString();
    const finalReason = `${userReason} [${probe.probeReason}]`.slice(0, 240);

    const { data: existingRow, error: selectErr } = await db
      .from('dead_source_reports')
      .select('id, report_count, status')
      .eq('media_id', mediaId)
      .eq('season_number', seasonNumber)
      .eq('episode_number', episodeNumber)
      .eq('stream_url', rawStreamUrl)
      .maybeSingle();

    if (selectErr) {
      console.error('[report-dead-source] Lookup error:', selectErr.message);
      return NextResponse.json({ ok: false, error: 'Kayıt sorgulanamadı.' }, { status: 500 });
    }

    if (existingRow?.id) {
      const nextCount = Number(existingRow.report_count || 1) + 1;
      const { error: updateErr } = await db
        .from('dead_source_reports')
        .update({
          provider,
          http_status: probe.httpStatus,
          reason: finalReason,
          reporter_ip_hash: ipHash,
          report_count: nextCount,
          last_reported_at: nowIso,
        })
        .eq('id', existingRow.id);

      if (updateErr) {
        console.error('[report-dead-source] Update error:', updateErr.message);
        return NextResponse.json({ ok: false, error: 'Kayıt güncellenemedi.' }, { status: 500 });
      }
    } else {
      const { error: insertErr } = await db.from('dead_source_reports').insert({
        media_id: mediaId,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        provider,
        stream_url: rawStreamUrl,
        http_status: probe.httpStatus,
        reason: finalReason,
        reporter_ip_hash: ipHash,
        status: 'pending',
        report_count: 1,
        last_reported_at: nowIso,
      });

      if (insertErr) {
        if (insertErr.code === '23505') {
          const { data: racedRow } = await db
            .from('dead_source_reports')
            .select('id, report_count')
            .eq('media_id', mediaId)
            .eq('season_number', seasonNumber)
            .eq('episode_number', episodeNumber)
            .eq('stream_url', rawStreamUrl)
            .maybeSingle();
          if (racedRow?.id) {
            await db
              .from('dead_source_reports')
              .update({
                http_status: probe.httpStatus,
                reason: finalReason,
                reporter_ip_hash: ipHash,
                report_count: Number(racedRow.report_count || 1) + 1,
                last_reported_at: nowIso,
              })
              .eq('id', racedRow.id);
          }
        } else {
          console.error('[report-dead-source] Insert error:', insertErr.message);
          return NextResponse.json({ ok: false, error: 'Bildirim kaydedilemedi.' }, { status: 500 });
        }
      }
    }

    recentReportDedup.set(dedupKey, now + 5 * 60_000);
    return NextResponse.json({
      ok: true,
      verifiedDead: true,
      httpStatus: probe.httpStatus,
      probeReason: probe.probeReason,
    });
  } catch (err) {
    console.error('[report-dead-source] Unexpected error:', err);
    return NextResponse.json({ ok: false, error: 'Beklenmeyen bir hata oluştu.' }, { status: 500 });
  }
}
