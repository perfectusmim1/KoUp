import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

// In-memory cache for resolved stream URLs (prevents upstream rate limits & 429 errors)
interface ResolvedCacheEntry {
  data: any;
  expiresAt: number;
}
const streamResolutionCache = new Map<string, ResolvedCacheEntry>();

function getCachedStream(key: string): any | null {
  const item = streamResolutionCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    streamResolutionCache.delete(key);
    return null;
  }
  return item.data;
}

function setCachedStream(key: string, data: any, ttlMs: number = 2 * 60 * 60 * 1000): void {
  if (streamResolutionCache.size > 2500) {
    const now = Date.now();
    for (const [k, v] of streamResolutionCache.entries()) {
      if (now > v.expiresAt) streamResolutionCache.delete(k);
    }
  }
  streamResolutionCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    const h = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !h ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h === '0.0.0.0' ||
      h.startsWith('127.') ||
      h.startsWith('10.') ||
      h.startsWith('192.168.') ||
      h.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
      h.startsWith('fe80:') ||
      h.includes('::ffff:127.') ||
      /^(0x[0-9a-f]+|\d+)$/i.test(h) ||
      h.endsWith('.internal') ||
      h.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unpackDeanEdwards(packedJs: string): string {
  const match = packedJs.match(/\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/s);
  if (!match) return packedJs;
  let [, p, aStr, cStr, kStr] = match;
  const a = parseInt(aStr, 10);
  let c = parseInt(cStr, 10);
  const k = kStr.split('|');
  const baseN = (num: number, b: number) => {
    const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let res = '';
    while (num > 0) {
      res = digits[num % b] + res;
      num = Math.floor(num / b);
    }
    return res || '0';
  };
  while (c--) {
    if (k[c]) {
      const regex = new RegExp('\\b' + baseN(c, a) + '\\b', 'g');
      p = p.replace(regex, () => k[c]);
    }
  }
  return p;
}

function decodeRapidvid(encStr: string): string | null {
  try {
    const rev = encStr.split('').reverse().join('');
    const t = Buffer.from(rev, 'base64').toString('latin1');
    const k = 'K9L';
    let o = '';
    for (let i = 0; i < t.length; i++) {
      const r = k[i % 3];
      const n = t.charCodeAt(i) - ((r.charCodeAt(0) % 5) + 1);
      o += String.fromCharCode(n);
    }
    return Buffer.from(o, 'base64').toString('latin1');
  } catch {
    return null;
  }
}

function decryptDizipal(k: string, ciphertextB64: string, ivHex: string, saltHex: string): string | null {
  try {
    const crypto = require('crypto');
    const saltBytes = Buffer.from(saltHex, 'hex');
    const ivBytes = Buffer.from(ivHex, 'hex');
    const cipherBytes = Buffer.from(ciphertextB64.replace(/\\\//g, '/'), 'base64');
    const derivedKey = crypto.pbkdf2Sync(k, saltBytes, 999, 32, 'sha512');
    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, ivBytes);
    let dec = decipher.update(cipherBytes);
    dec = Buffer.concat([dec, decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

function resolveGDrivePlayer(html: string): string | null {
  const match = html.match(/var\s+k\s*=\s*["']([^"']+)["']\s*,\s*b\s*=\s*atob\s*\(\s*["']([^"']+)["']\s*\)/);
  if (!match) return null;
  const [, k, bB64] = match;
  try {
    const b = Buffer.from(bB64, 'base64').toString('binary');
    let o = '';
    for (let i = 0; i < b.length; i++) {
      o += String.fromCharCode(b.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    const hlsMatch = o.match(/HLS\s*=\s*["']([^"']+)["']/);
    if (!hlsMatch) return null;
    return hlsMatch[1].startsWith('http') ? hlsMatch[1] : `https://gdriveplayer.to/${hlsMatch[1]}`;
  } catch {
    return null;
  }
}

async function resolveFilemoonByse(fileCode: string, domain: string = 'filemoon.sx'): Promise<string | null> {
  try {
    const apiUrl = `https://${domain}/api/videos/${encodeURIComponent(fileCode)}/`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': `https://${domain}/e/${fileCode}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const playback = data.playback;
    if (!playback?.key_parts || !playback?.iv || !playback?.payload) return null;

    const base64UrlDecode = (str: string) => {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      return Buffer.from(b64, 'base64');
    };

    const v = parseInt(playback.version, 10);
    const part1 = playback.key_parts[v - 1];
    const part2 = playback.key_parts[31 - v - 1];
    if (!part1 || !part2) return null;

    const key = Buffer.concat([base64UrlDecode(part1), base64UrlDecode(part2)]);
    const iv = base64UrlDecode(playback.iv);
    const payloadBuf = base64UrlDecode(playback.payload);
    const ciphertext = payloadBuf.subarray(0, payloadBuf.length - 16);
    const authTag = payloadBuf.subarray(payloadBuf.length - 16);

    const crypto = await import('crypto');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let dec = decipher.update(ciphertext, undefined, 'utf8');
    dec += decipher.final('utf8');
    const parsed = JSON.parse(dec);
    return parsed.sources?.[0]?.url || parsed.sources?.[0]?.file || null;
  } catch {
    return null;
  }
}

async function resolveUPNS(hashId: string, domain: string = 'webdrama.upns.online'): Promise<string | null> {
  try {
    const resp = await fetch(`https://${domain}/api/v1/video?id=${encodeURIComponent(hashId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': `https://${domain}/#${hashId}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const hex = (await resp.text()).trim();
    const ct = Buffer.from(hex, 'hex');
    const crypto = await import('crypto');
    const key = Buffer.from('kiemtienmua911ca', 'utf8');
    const iv = Buffer.from('1234567890oiuytr', 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let dec = decipher.update(ct, undefined, 'utf8');
    dec += decipher.final('utf8');
    const parsed = JSON.parse(dec);
    return parsed.source || null;
  } catch {
    return null;
  }
}

async function resolveYandexDisk(yandexUrl: string): Promise<string | null> {
  try {
    const apiUrl = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(yandexUrl)}`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.href || null;
  } catch {
    return null;
  }
}

function extractHdfilmSubtitles(
  html: string,
  embedOrigin = 'https://hdfilmcehennemi.mobi',
  subRef = 'https://hdfilmcehennemi.mobi/'
): Array<{ label: string; lang: string; url: string; default?: boolean }> {
  const tracksMatch = html.match(/tracks:\s*(\[[^\]]+\])/);
  if (!tracksMatch?.[1]) return [];
  try {
    const unescaped = tracksMatch[1].replaceAll('\\/', '/');
    const rawTracks = JSON.parse(unescaped);
    const validTracks = rawTracks.filter(
      (t: any) => t?.file && (t.kind === 'captions' || t.kind === 'subtitles' || !t.kind)
    );

    // Check if a full non-forced Turkish track exists so we can skip redundant "Forced" track
    const hasFullTurkish = validTracks.some((t: any) => {
      const lbl = String(t.label || '').toLocaleLowerCase('tr-TR');
      const lng = String(t.language || t.lang || '').toLowerCase();
      const fn = String(t.file || '').toLowerCase();
      const isForced = lbl.includes('forced') || lng.includes('forced') || fn.includes('forced');
      const isTr =
        lng === 'tr' ||
        lbl.includes('türk') ||
        lbl.includes('turk') ||
        fn.includes('_turkish') ||
        fn.includes('subtitles02tur');
      return isTr && !isForced;
    });

    const byLabel = new Map<string, { label: string; lang: string; url: string; default?: boolean }>();

    for (const t of validTracks) {
      const rawLabel = String(t.label || 'Altyazı').trim();
      const lower = rawLabel.toLocaleLowerCase('tr-TR').replace(/i\u0307/g, 'i');
      const rawLang = String(t.language || t.lang || '').toLowerCase();
      const rawFile = String(t.file || '');
      const isForced =
        lower.includes('forced') ||
        rawLang.includes('forced') ||
        rawFile.toLowerCase().includes('forced');

      if (isForced && hasFullTurkish) {
        continue;
      }

      let cleanLabel = rawLabel.replace(/\s*altyaz[ıi]$/i, '').trim() || 'Altyazı';
      let lang = rawLang || 'tr';

      if (
        rawLang === 'tr' ||
        lower.includes('tur') ||
        lower.includes('türk') ||
        lower.includes('forced')
      ) {
        cleanLabel = 'Türkçe';
        lang = 'tr';
      } else if (rawLang === 'en' || lower.includes('eng') || lower.includes('ing')) {
        cleanLabel = 'İngilizce';
        lang = 'en';
      } else if (rawLang === 'fr' || lower.includes('fre') || lower.includes('frans')) {
        cleanLabel = 'Fransızca';
        lang = 'fr';
      } else if (rawLang === 'es' || lower.includes('spa') || lower.includes('ispan')) {
        cleanLabel = 'İspanyolca';
        lang = 'es';
      } else if (rawLang === 'pt' || lower.includes('por') || lower.includes('portek')) {
        cleanLabel = 'Portekizce';
        lang = 'pt';
      } else if (rawLang === 'de' || lower.includes('ger') || lower.includes('alman')) {
        cleanLabel = 'Almanca';
        lang = 'de';
      }

      const fullFileUrl = rawFile.startsWith('http')
        ? rawFile
        : `${embedOrigin}${rawFile.startsWith('/') ? '' : '/'}${rawFile}`;
      const proxiedSub = `/api/stream-proxy?url=${encodeURIComponent(fullFileUrl)}&ref=${encodeURIComponent(subRef)}`;

      // Keep the non-forced / latest full track per language label
      if (!byLabel.has(cleanLabel) || !isForced) {
        byLabel.set(cleanLabel, {
          label: cleanLabel,
          lang,
          url: proxiedSub,
          default: lang === 'tr' ? true : !!t.default,
        });
      }
    }

    return Array.from(byLabel.values());
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url') || '';
  let url = rawUrl;
  if (url.includes('dbx.molystream.org/embed/') && !url.includes('/embed/sheila/')) {
    url = url.replace(/dbx\.molystream\.org\/embed\/(?!sheila\/)/i, 'dbx.molystream.org/embed/sheila/');
  }
  const provider = (searchParams.get('provider') || '').toLowerCase();
  const commonUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  // Check in-memory cache first to avoid hammering hosts (especially VOE / OK.RU rate limits)
  const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('fresh') === '1';
  if (!forceRefresh) {
    const cachedStream = getCachedStream(url) || (rawUrl && rawUrl !== url ? getCachedStream(rawUrl) : null);
    if (cachedStream) {
      return NextResponse.json(cachedStream, { headers: CACHE_HEADERS });
    }
  } else {
    streamResolutionCache.delete(url);
    if (rawUrl) streamResolutionCache.delete(rawUrl);
  }

  // Validate URL protocol & allow supported pseudo-schemes
  const isCustomScheme =
    url.startsWith('dramavadisi:') ||
    url.startsWith('dramabox:') ||
    url.startsWith('wdt:') ||
    url.startsWith('pilavyer:');

  if (!isCustomScheme) {
    if (!isSafeExternalUrl(url)) {
      return NextResponse.json({ error: 'Geçersiz hedef adresi (SSRF koruması)' }, { status: 403 });
    }
  }

  const lowerUrl = url.toLowerCase();
  const deadDomains = [
    'sibnet.ru',
    'video.sibnet.ru',
    'diziasya',
    'video.diziasya.com',
    'short.icu',
    'short.ink',
    'vudeo.io',
    'vudeo.co',
    'vudeo.net',
    'dood.watch',
    'dood.ws',
    'dood.so',
    'doodstream.com',
    'mvidoo.com',
    'savefileway.com',
    'tubeload.co',
    'embedo.co',
    'streamlare.com',
    'optraco.top',
    'abyssplayer.com',
    'uqload.to',
    'sendvid',
    'sendvid.com',
    'drive.google.com',
    'docs.google.com',
    'pixeldrain.com',
    'pixeldrain',
    '4meplayer',
    'uns.bio',
    'p2pplay',
    'rpmplay',
    'parklogic',
    'vtube.to',
    'highload.to',
    'vadshar.com',
    'viidshar.com',
    'segavid.com',
    'upload.do',
    'lylxan.com',
    'embedrise.com',
    'embedgram.com',
    'openload.co',
    'streamango.com',
    'rapidvideo.com',
    'estream.to',
    'vid.me',
    'cloudvideo.tv',
    'wolfstream.tv',
    'mystream.to',
    'fembed.com',
    'feurl.com',
    'suzihaza.com',
    'gounlimited.to',
    'jetload.net',
    'supervideo.tv',
    'upstream.to',
    'mixdrop',
  ];
  if (
    provider === 'sibnet' ||
    deadDomains.some((d) => lowerUrl.includes(d)) ||
    lowerUrl.endsWith('/e/') ||
    lowerUrl.endsWith('/embed/video/')
  ) {
    return NextResponse.json(
      { error: 'Kaynak artık kullanılabilir değil veya engellendi', isDead: true },
      { status: 410 }
    );
  }

  // =========================================================================
  // 0-A. DramaVadisi Direct MP4 Stream Resolver
  // =========================================================================
  if (
    provider === 'dramavadisi' ||
    url.startsWith('dramavadisi:') ||
    lowerUrl.includes('dramavadisi.com')
  ) {
    try {
      let seriesId: string | null = null;
      let epNo: string | null = null;

      if (url.startsWith('dramavadisi:')) {
        const parts = url.slice('dramavadisi:'.length).split(':');
        seriesId = parts[0] || null;
        epNo = parts[1] || '1';
      } else if (lowerUrl.includes('/api/series/')) {
        const m = url.match(/\/api\/series\/(\d+)\/watch/i);
        if (m) seriesId = m[1];
        try {
          const u = new URL(url);
          epNo = u.searchParams.get('ep') || '1';
        } catch {}
      } else if (lowerUrl.includes('dramavadisi.com')) {
        const epMatch = url.match(/(\d+)-bolum/i);
        if (epMatch) epNo = epMatch[1];

        const pageResp = await fetch(url, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://dramavadisi.com/',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(6000),
        });
        if (pageResp.ok) {
          const html = await pageResp.text();
          const playerMatch =
            html.match(/"player"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/i) ||
            html.match(/"id"\s*:\s*(\d+)[^}]*"season"\s*:\s*(\d+)[^}]*"no"\s*:\s*(\d+)/i) ||
            html.match(/"series(?:_id)?"\s*:\s*(\d+)/i) ||
            html.match(/\/api\/series\/(\d+)\/watch/i);
          if (playerMatch) seriesId = playerMatch[1];
          if (!epNo) {
            const noMatch =
              html.match(/"player"\s*:\s*\{[^}]*"no"\s*:\s*(\d+)/i) ||
              html.match(/"no"\s*:\s*(\d+)/i);
            if (noMatch) epNo = noMatch[1];
          }
        }
      }

      if (seriesId) {
        const watchUrl = `https://dramavadisi.com/api/series/${encodeURIComponent(seriesId)}/watch`;
        const apiResp = await fetch(watchUrl, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://dramavadisi.com/',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (apiResp.ok) {
          const data = await apiResp.json();
          const episodes: any[] = Array.isArray(data?.episodes)
            ? data.episodes
            : Array.isArray(data)
            ? data
            : [];
          const targetEp =
            episodes.find(
              (e: any) =>
                String(e?.no) === String(epNo) ||
                String(e?.episode_no) === String(epNo) ||
                String(e?.id) === String(epNo)
            ) || (epNo === '1' || !epNo ? episodes[0] : null);

          if (targetEp?.src) {
            const streamUrl = targetEp.src;
            const result = {
              mode: 'native_mp4' as const,
              streamType: 'mp4' as const,
              streamUrl,
              qualities: [{ label: '720p HD', url: streamUrl }],
              fallbackIframe: url.startsWith('http')
                ? url
                : `https://dramavadisi.com/api/series/${seriesId}/watch`,
            };
            setCachedStream(url, result, 45 * 60 * 1000);
            return NextResponse.json(result, { headers: CACHE_HEADERS });
          }
        }
      }

      return NextResponse.json(
        { error: 'DramaVadisi bölüm videosu bulunamadı veya henüz yayınlanmamış', isDead: true },
        { status: 404, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'DramaVadisi servisine bağlanılamadı', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-B. DramaBox Direct MP4 Stream Resolver
  // =========================================================================
  if (
    provider === 'dramabox' ||
    url.startsWith('dramabox:') ||
    lowerUrl.includes('dramabox.com')
  ) {
    try {
      let targetPageUrl = url;
      let targetChapterIndex: string | null = null;
      let targetChapterId: string | null = null;

      if (url.startsWith('dramabox:')) {
        const parts = url.slice('dramabox:'.length).split(':');
        const bookId = parts[0];
        targetChapterIndex = parts[1] || '1';
        targetPageUrl = `https://www.dramabox.com/tr/video/${encodeURIComponent(bookId)}_play/${encodeURIComponent(targetChapterIndex)}_Episode-${encodeURIComponent(targetChapterIndex)}`;
      } else {
        const m =
          url.match(/\/(\d+)_Episode-(\d+)/i) ||
          url.match(/\/([a-zA-Z0-9]+)_Episode-(\d+)/i);
        if (m) {
          targetChapterId = m[1];
          targetChapterIndex = m[2];
        }
      }

      const resp = await fetch(targetPageUrl, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://www.dramabox.com/tr',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!resp.ok && resp.status === 404) {
        return NextResponse.json(
          { error: 'DramaBox sayfası bulunamadı (404)', isDead: true },
          { status: 404, headers: CACHE_HEADERS }
        );
      }

      if (resp.ok) {
        const html = await resp.text();
        const nextDataMatch = html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
        );
        let chapterList: any[] = [];
        let currentChapter: any = null;

        if (nextDataMatch) {
          try {
            const nextJson = JSON.parse(nextDataMatch[1]);
            const pp = nextJson?.props?.pageProps;
            chapterList =
              pp?.chapterList ||
              pp?.videoInfo?.chapterList ||
              pp?.bookInfo?.chapterList ||
              [];
            currentChapter = pp?.currentChapter || pp?.chapterInfo || null;
          } catch {}
        }

        let target = chapterList.find(
          (c: any) =>
            (targetChapterId &&
              String(c?.chapterId ?? c?.id) === String(targetChapterId)) ||
            (targetChapterIndex &&
              String(c?.chapterIndex ?? c?.index ?? c?.chapterNo) ===
                String(targetChapterIndex))
        );

        if (!target && currentChapter) {
          if (
            !targetChapterIndex ||
            String(
              currentChapter?.chapterIndex ??
                currentChapter?.index ??
                currentChapter?.chapterNo
            ) === String(targetChapterIndex)
          ) {
            target = currentChapter;
          }
        }

        if (!target && targetChapterIndex && chapterList.length > 0) {
          const idx = parseInt(targetChapterIndex, 10) - 1;
          if (idx >= 0 && idx < chapterList.length) target = chapterList[idx];
        }

        let mp4Url = target?.mp4 || target?.videoUrl || target?.url || null;
        const isUnlocked = target
          ? target.unlock !== false && !target.isLocked
          : true;

        if (!mp4Url && (!target || isUnlocked)) {
          const directMp4Match =
            html.match(/"mp4"\s*:\s*"([^"]+\.mp4[^"]*)"/i) ||
            html.match(/https?:\/\/[^"'\s]+\.dramaboxdb\.com\/[^"'\s]+\.mp4/i) ||
            html.match(/https?:\/\/[^"'\s]+\.akamaized\.net\/[^"'\s]+\.mp4/i);
          if (directMp4Match) {
            mp4Url = (directMp4Match[1] || directMp4Match[0])
              .replace(/\\u002F/g, '/')
              .replace(/\\\//g, '/');
          }
        }

        if (mp4Url && isUnlocked) {
          const result = {
            mode: 'native_mp4' as const,
            streamType: 'mp4' as const,
            streamUrl: mp4Url,
            qualities: [{ label: '720p HD', url: mp4Url }],
            fallbackIframe: targetPageUrl,
          };
          setCachedStream(url, result, 45 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
      }

      return NextResponse.json(
        { error: 'Bu bölüm DramaBox üzerinde kilitli.', isDead: true },
        { status: 404, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'DramaBox sunucusuna erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-C. WDT / WebDramaTurkey2 & KoreDizi / DTPASN HLS Resolver
  // =========================================================================
  const isWdtOrDtpasn =
    provider === 'wdt' ||
    provider === 'webdramaturkey' ||
    provider === 'koredizi' ||
    url.startsWith('wdt:') ||
    lowerUrl.includes('webdramaturkey') ||
    (lowerUrl.includes('dtpasn.asia') && !lowerUrl.includes('.m3u8'));

  if (isWdtOrDtpasn) {
    try {
      let hash: string | null = null;
      const refererSite =
        provider === 'koredizi' || lowerUrl.includes('koredizi')
          ? 'https://koredizi.com/'
          : provider === 'wdt' ||
            provider === 'webdramaturkey' ||
            lowerUrl.includes('webdramaturkey')
          ? 'https://webdramaturkey2.com/'
          : 'https://dizikorea.pw/';

      // Case A: wdt:{embedId} or /ajax/embed?id={embedId}
      if (url.startsWith('wdt:') || lowerUrl.includes('/ajax/embed')) {
        let embedId = '';
        if (url.startsWith('wdt:')) {
          embedId = url.slice('wdt:'.length);
        } else {
          try {
            embedId = new URL(url).searchParams.get('id') || '';
          } catch {}
        }

        if (embedId) {
          const postResp = await fetch('https://webdramaturkey2.com/ajax/embed', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: 'https://webdramaturkey2.com/',
              'User-Agent': commonUA,
            },
            body: new URLSearchParams({ id: embedId }).toString(),
            signal: AbortSignal.timeout(6000),
          });

          if (postResp.ok) {
            const embedHtml = await postResp.text();
            const vMatch =
              embedHtml.match(
                /(?:https?:\/\/webdramaturkey2\.com)?\/video\.php\?hash=([a-zA-Z0-9]+)/i
              ) || embedHtml.match(/video\.php\?hash=([a-zA-Z0-9]+)/i);

            if (vMatch?.[1]) {
              const videoUrl = `https://webdramaturkey2.com/video.php?hash=${vMatch[1]}`;
              const vpResp = await fetch(videoUrl, {
                headers: {
                  Referer: 'https://webdramaturkey2.com/',
                  'User-Agent': commonUA,
                },
                signal: AbortSignal.timeout(6000),
              });
              if (vpResp.ok) {
                const vpHtml = await vpResp.text();
                const dtMatch = vpHtml.match(/dtpasn\.asia\/video\/([a-zA-Z0-9]+)/i);
                if (dtMatch?.[1]) hash = dtMatch[1];
              }
            }
          }
        }
      } else if (lowerUrl.includes('video.php?hash=')) {
        // Case B: webdramaturkey video.php?hash=...
        const vpResp = await fetch(url, {
          headers: {
            Referer: 'https://webdramaturkey2.com/',
            'User-Agent': commonUA,
          },
          signal: AbortSignal.timeout(6000),
        });
        if (vpResp.ok) {
          const vpHtml = await vpResp.text();
          const dtMatch = vpHtml.match(/dtpasn\.asia\/video\/([a-zA-Z0-9]+)/i);
          if (dtMatch?.[1]) hash = dtMatch[1];
        }
      }

      // Case C: direct dtpasn.asia URL or hash extracted above
      if (!hash && lowerUrl.includes('dtpasn.asia')) {
        const m =
          url.match(/\/video\/([a-zA-Z0-9]+)/i) ||
          url.match(/[?&]data=([a-zA-Z0-9]+)/i);
        if (m?.[1]) hash = m[1];
      }

      if (hash) {
        const dtResp = await fetch(
          `https://dtpasn.asia/player/index.php?data=${encodeURIComponent(hash)}&do=getVideo`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Origin: 'https://dtpasn.asia',
              Referer: `https://dtpasn.asia/video/${hash}`,
              'User-Agent': commonUA,
            },
            body: new URLSearchParams({ hash, r: refererSite }).toString(),
            signal: AbortSignal.timeout(6000),
          }
        );

        if (dtResp.ok) {
          const dtJson = await dtResp.json();
          const securedLink = dtJson?.securedLink || dtJson?.videoSource;
          if (securedLink) {
            const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(securedLink)}&ref=${encodeURIComponent(refererSite)}`;
            const result = {
              mode: 'native_hls' as const,
              streamType: 'hls' as const,
              streamUrl: proxiedStream,
              directUrl: securedLink,
              qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
              fallbackIframe: null,
            };
            setCachedStream(url, result, 30 * 60 * 1000);
            return NextResponse.json(result, { headers: CACHE_HEADERS });
          }
        }
      }

      return NextResponse.json(
        { error: 'WDT / DTPASN video kaynağı bulunamadı veya silinmiş', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'WDT / DTPASN servisine erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-D. Pilavyer / Diziİzle HLS Resolver
  // =========================================================================
  if (
    provider === 'pilavyer' ||
    provider === 'diziizle' ||
    url.startsWith('pilavyer:') ||
    lowerUrl.includes('pilavyerplay.') ||
    lowerUrl.includes('diziizle.wiki')
  ) {
    try {
      // Direct stream.php URL from DB
      if (lowerUrl.includes('pilavyerplay.top/api/stream.php')) {
        const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://diziizle.wiki/')}`;
        const result = {
          mode: 'native_hls' as const,
          streamType: 'hls' as const,
          streamUrl: proxiedStream,
          directUrl: url,
          qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
          fallbackIframe: null,
        };
        setCachedStream(url, result, 30 * 60 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      let pvSlug: string | null = null;
      if (url.startsWith('pilavyer:')) {
        pvSlug = url.slice('pilavyer:'.length);
      } else if (lowerUrl.includes('pilavyerplay.') && lowerUrl.includes('s=')) {
        try {
          pvSlug = new URL(url).searchParams.get('s');
        } catch {}
      } else if (lowerUrl.includes('diziizle.wiki')) {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://diziizle.wiki/',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(6000),
        });
        if (resp.ok) {
          const pageHtml = await resp.text();
          const pvMatch =
            pageHtml.match(/data-pv=["']([^"']+)["']/i) ||
            pageHtml.match(/pv=["']([^"']+)["']/i) ||
            pageHtml.match(/s\.php\?s=([^"'\s&]+)/i);
          if (pvMatch?.[1]) pvSlug = pvMatch[1];
        }
      }

      if (pvSlug) {
        const sUrl = `https://play2.pilavyerplay.top/assets/js/s.php?s=${encodeURIComponent(pvSlug)}`;
        const sResp = await fetch(sUrl, {
          headers: {
            Referer: 'https://diziizle.wiki/',
            Origin: 'https://diziizle.wiki',
            'User-Agent': commonUA,
          },
          signal: AbortSignal.timeout(6000),
        });

        if (sResp.ok) {
          const sText = await sResp.text();
          let streamUrl: string | null = null;
          let subtitles: Array<{
            label: string;
            lang: string;
            url: string;
            default?: boolean;
          }> = [];
          let audioTracks: any[] | undefined = undefined;

          // Try window.__PLAYER__ JSON parsing
          const playerMatch = sText.match(
            /window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});/
          );
          if (playerMatch?.[1]) {
            try {
              const pObj = JSON.parse(playerMatch[1]);
              streamUrl =
                pObj.file || pObj.stream || pObj.sources?.[0]?.file || null;
              const rawTracks = pObj.subtitles || pObj.tracks || [];
              if (Array.isArray(rawTracks)) {
                subtitles = rawTracks
                  .filter((t: any) => t?.file)
                  .map((t: any) => ({
                    label: t.label || t.title || 'Türkçe',
                    lang: t.language || t.lang || 'tr',
                    url: t.file.startsWith('http')
                      ? t.file
                      : `https://play2.pilavyerplay.top${t.file.startsWith('/') ? '' : '/'}${t.file}`,
                    default: !!t.default,
                  }));
              }
              if (Array.isArray(pObj.audios) && pObj.audios.length > 0) {
                audioTracks = pObj.audios;
              }
            } catch {}
          }

          // Fallback regex extraction if window.__PLAYER__ is not valid JSON
          if (!streamUrl) {
            const fileMatch =
              sText.match(/"file"\s*:\s*"([^"]+)"/i) ||
              sText.match(/(https?:\/\/[^"'\s]+\/api\/stream\.php\?[^"'\s]+)/i) ||
              sText.match(/(\/api\/stream\.php\?[^"'\s]+)/i);
            if (fileMatch?.[1]) {
              streamUrl = fileMatch[1].replace(/\\/g, '');
            }
          }

          if (streamUrl) {
            if (streamUrl.startsWith('/')) {
              streamUrl = `https://play2.pilavyerplay.top${streamUrl}`;
            }

            const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent('https://diziizle.wiki/')}`;
            const proxiedSubs = subtitles.map((s) => ({
              ...s,
              url: `/api/stream-proxy?url=${encodeURIComponent(s.url)}&ref=${encodeURIComponent('https://diziizle.wiki/')}`,
            }));

            const result = {
              mode: 'native_hls' as const,
              streamType: 'hls' as const,
              streamUrl: proxiedStream,
              directUrl: streamUrl,
              qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
              subtitles: proxiedSubs.length > 0 ? proxiedSubs : undefined,
              audioTracks:
                audioTracks && audioTracks.length > 0 ? audioTracks : undefined,
              fallbackIframe: null,
            };
            setCachedStream(url, result, 30 * 60 * 1000);
            return NextResponse.json(result, { headers: CACHE_HEADERS });
          }
        }
      }

      return NextResponse.json(
        { error: 'Pilavyer / Diziİzle videosu bulunamadı veya silinmiş', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'Pilavyer sunucusuna erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-D3. Dizipal (dizipal1592.com / sn.dplayer82.site / DPlayer) HLS Resolver
  // =========================================================================
  if (
    provider === 'dizipal' ||
    lowerUrl.includes('dizipal') ||
    lowerUrl.includes('dplayer82.site/master.m3u8')
  ) {
    try {
      if (lowerUrl.includes('.m3u8')) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://sn.dplayer82.site/')}`;
        const result = {
          mode: 'native_hls' as const,
          streamType: 'hls' as const,
          streamUrl: proxiedUrl,
          directUrl: url,
          qualities: [{ label: '1080p (Dizipal HD)', url: proxiedUrl }],
          fallbackIframe: null,
        };
        setCachedStream(url, result, 30 * 60 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      if (lowerUrl.includes('dizipal')) {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://dizipal1592.com/',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(7000),
        });
        if (resp.ok) {
          const html = await resp.text();
          const rscMatches = html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/g);
          const blob = rscMatches
            ? rscMatches.map((m) => m.replace(/self\.__next_f\.push\(\[1,"|"\]\)/g, '')).join('').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
            : html;

          const mk = blob.match(/"k":"([^"]+)"/);
          const mcipher = blob.match(/"ciphertext":"([^"]+)"/);
          const miv = blob.match(/"iv":"([^"]+)"/);
          const msalt = blob.match(/"salt":"([^"]+)"/);

          if (mk && mcipher && miv && msalt) {
            const decPlayer = decryptDizipal(mk[1], mcipher[1], miv[1], msalt[1]);
            if (decPlayer) {
              let dplayerUrl = decPlayer.startsWith('//') ? `https:${decPlayer}` : decPlayer;
              if (!dplayerUrl.startsWith('http')) dplayerUrl = `https://${dplayerUrl.replace(/^\//, '')}`;

              const dpResp = await fetch(dplayerUrl, {
                headers: {
                  'User-Agent': commonUA,
                  Referer: url,
                },
                signal: AbortSignal.timeout(6000),
              });
              if (dpResp.ok) {
                const dpHtml = await dpResp.text();
                const mOpen = dpHtml.match(/openPlayer\(['"]([^'"]+)['"]/);
                if (mOpen?.[1]) {
                  const token = mOpen[1];
                  const dplayerOrigin = new URL(dplayerUrl).origin;
                  const s2Url = `${dplayerOrigin}/source2.php?v=${encodeURIComponent(token)}`;
                  const s2Resp = await fetch(s2Url, {
                    headers: {
                      'User-Agent': commonUA,
                      Referer: dplayerUrl,
                      'X-Requested-With': 'XMLHttpRequest',
                      Accept: 'application/json, text/javascript, */*; q=0.01',
                    },
                    signal: AbortSignal.timeout(6000),
                  });
                  if (s2Resp.ok) {
                    const s2Data = await s2Resp.json();
                    const rawFile = s2Data?.playlist?.[0]?.sources?.[0]?.file;
                    if (rawFile) {
                      const masterUrl = rawFile.replace('m.php', 'master.m3u8');
                      const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(masterUrl)}&ref=${encodeURIComponent('https://sn.dplayer82.site/')}`;
                      const result = {
                        mode: 'native_hls' as const,
                        streamType: 'hls' as const,
                        streamUrl: proxiedStream,
                        directUrl: masterUrl,
                        qualities: [{ label: '1080p (Dizipal HD)', url: proxiedStream }],
                        fallbackIframe: null,
                      };
                      setCachedStream(url, result, 30 * 60 * 1000);
                      return NextResponse.json(result, { headers: CACHE_HEADERS });
                    }
                  }
                }
              }
            }
          }
        }
      }

      return NextResponse.json(
        { error: 'Dizipal video yayını çözümlenemedi veya yayından kaldırılmış', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'Dizipal servisine erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-D4. SezonlukDizi (sezonlukdizi.cc) HLS / MP4 Stream Resolver
  // =========================================================================
  if (
    provider === 'sezonlukdizi' ||
    lowerUrl.includes('sezonlukdizi.cc')
  ) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://sezonlukdizi.cc/',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (resp.ok) {
        const html = await resp.text();
        const bidMatch =
          html.match(/var\s+bid\s*=\s*["']?(\d+)/i) ||
          html.match(/bid\s*[:=]\s*["']?(\d+)/i) ||
          html.match(/data-id=["'](\d+)/i) ||
          html.match(/asp\?bid=(\d+)/i);

        if (bidMatch?.[1]) {
          const bid = bidMatch[1];
          const altResp = await fetch('https://sezonlukdizi.cc/ajax/dataAlternatif22.asp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: url,
              'User-Agent': commonUA,
            },
            body: new URLSearchParams({ bid, dil: '1' }).toString(),
            signal: AbortSignal.timeout(6000),
          });

          if (altResp.ok) {
            const altJson = await altResp.json();
            const items = altJson?.data || [];
            // Prioritize reliable embed players
            items.sort((a: any, b: any) => {
              const ka = (a?.baslik || '').toLowerCase();
              const kb = (b?.baslik || '').toLowerCase();
              const pa = ka.includes('filemoon') || ka.includes('rapid') || ka.includes('vidmoly') || ka.includes('ok') ? 0 : 1;
              const pb = kb.includes('filemoon') || kb.includes('rapid') || kb.includes('vidmoly') || kb.includes('ok') ? 0 : 1;
              return pa - pb;
            });

            for (const item of items) {
              const altId = item?.id;
              if (!altId) continue;
              const embResp = await fetch('https://sezonlukdizi.cc/ajax/dataEmbed22.asp', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                  'X-Requested-With': 'XMLHttpRequest',
                  Referer: url,
                  'User-Agent': commonUA,
                },
                body: new URLSearchParams({ id: String(altId) }).toString(),
                signal: AbortSignal.timeout(6000),
              });
              if (embResp.ok) {
                const embHtml = await embResp.text();
                const mIfr = embHtml.match(/<iframe[^\>]+src=["']([^"']+)["']/i);
                if (mIfr?.[1]) {
                  let embSrc = mIfr[1].trim();
                  if (!embSrc.startsWith('http')) {
                    embSrc = embSrc.startsWith('//') ? `https:${embSrc}` : `https://sezonlukdizi.cc${embSrc}`;
                  }
                  // Recursively forward to resolve-stream internal fetch
                  const resolveTarget = new URL(req.url);
                  resolveTarget.searchParams.set('url', embSrc);
                  resolveTarget.searchParams.delete('provider');
                  const innerResp = await fetch(resolveTarget.toString(), { cache: 'no-store' });
                  if (innerResp.ok) {
                    const innerData = await innerResp.json();
                    if (innerData.mode === 'native_hls' || innerData.mode === 'native_mp4') {
                      innerData.fallbackIframe = null;
                      setCachedStream(url, innerData, 30 * 60 * 1000);
                      return NextResponse.json(innerData, { headers: CACHE_HEADERS });
                    }
                  }
                }
              }
            }
          }
        }
      }

      return NextResponse.json(
        { error: 'SezonlukDizi oynatıcı kaynağı çözümlenemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'SezonlukDizi servisine erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-D2. Shortİzle (shortizle.com) HLS Stream Resolver
  // =========================================================================
  if (
    provider === 'shortizle' ||
    lowerUrl.includes('shortizle.com/media/') ||
    lowerUrl.includes('shortizle.com/watch/') ||
    lowerUrl.includes('shortizle.com/embed/')
  ) {
    try {
      const parsed = new URL(url);
      const watchParam = parsed.searchParams.get('watch') || '';
      const kindParam = (parsed.searchParams.get('kind') || '').toLowerCase();
      const mediaIdMatch = parsed.pathname.match(/\/media\/[^/]+\/(\d+)/i);
      const targetSourceId = mediaIdMatch?.[1] ? Number(mediaIdMatch[1]) : null;

      let watchUrl = '';
      if (watchParam) {
        watchUrl = watchParam.startsWith('http')
          ? watchParam
          : `https://shortizle.com${watchParam.startsWith('/') ? '' : '/'}${watchParam}`;
      } else if (parsed.pathname.startsWith('/watch/')) {
        watchUrl = `https://shortizle.com${parsed.pathname}`;
      } else if (parsed.pathname.startsWith('/embed/')) {
        watchUrl = `https://shortizle.com${parsed.pathname.replace(/^\/embed\//i, '/watch/')}`;
      }

      if (watchUrl) {
        const watchResp = await fetch(watchUrl, {
          headers: {
            'User-Agent': commonUA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://shortizle.com/',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (watchResp.ok) {
          const rawCookies =
            typeof (watchResp.headers as any).getSetCookie === 'function'
              ? ((watchResp.headers as any).getSetCookie() as string[])
              : (watchResp.headers.get('set-cookie') || '').split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
          const cookiePairs = rawCookies
            .map((c) => c.split(';')[0]?.trim())
            .filter(Boolean)
            .join('; ');

          const watchHtml = await watchResp.text();
          let inertiaProps: any = null;

          // 1. Check inline script containing externalSources
          const scriptMatches = watchHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi);
          for (const sm of scriptMatches) {
            const body = (sm[1] || '').trim();
            if (body.startsWith('{') && body.includes('"externalSources"')) {
              try {
                inertiaProps = JSON.parse(body)?.props;
                if (inertiaProps) break;
              } catch {}
            }
          }

          // 2. Fallback to data-page attribute
          if (!inertiaProps) {
            const dpMatch = watchHtml.match(/data-page="([^"]+)"/i);
            if (dpMatch?.[1]) {
              try {
                const unescaped = dpMatch[1]
                  .replace(/&quot;/g, '"')
                  .replace(/&amp;/g, '&')
                  .replace(/&#039;/g, "'")
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>');
                inertiaProps = JSON.parse(unescaped)?.props;
              } catch {}
            }
          }

          const extSources = inertiaProps?.externalSources || {};
          const candidates: any[] = [];
          const order = kindParam === 'dublaj' ? ['dublaj', 'altyazi'] : ['altyazi', 'dublaj'];
          for (const k of order) {
            if (Array.isArray(extSources[k])) {
              candidates.push(...extSources[k]);
            }
          }

          const chosen =
            (targetSourceId && candidates.find((c) => Number(c?.id) === targetSourceId)) ||
            candidates[0] ||
            null;

          if (chosen?.resolve_url) {
            const resolveFullUrl = chosen.resolve_url.startsWith('http')
              ? chosen.resolve_url
              : `https://shortizle.com${chosen.resolve_url}`;

            const resResp = await fetch(resolveFullUrl, {
              headers: {
                'User-Agent': commonUA,
                Accept: 'application/json',
                Referer: watchUrl,
                Cookie: cookiePairs,
                'X-Storage-Pilot': '1',
                'X-Protected-Storage': '1',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
              },
              signal: AbortSignal.timeout(6000),
            });

            if (resResp.ok) {
              const resJson = await resResp.json();
              let finalM3u8: string | null = null;
              let shzMediaCookie = '';

              if (resJson?.gateway_bootstrap?.url && resJson?.gateway_bootstrap?.token) {
                const authResp = await fetch(resJson.gateway_bootstrap.url, {
                  method: 'POST',
                  headers: {
                    'User-Agent': commonUA,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Origin: 'https://shortizle.com',
                    Referer: 'https://shortizle.com/',
                    'Sec-Fetch-Site': 'same-site',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Dest': 'empty',
                  },
                  body: JSON.stringify({ token: resJson.gateway_bootstrap.token }),
                  signal: AbortSignal.timeout(6000),
                });

                if (authResp.ok) {
                  const authCookies =
                    typeof (authResp.headers as any).getSetCookie === 'function'
                      ? ((authResp.headers as any).getSetCookie() as string[])
                      : [authResp.headers.get('set-cookie') || ''];
                  for (const ac of authCookies) {
                    const m = ac.match(/__Host-shortizle_media=([a-f0-9]+)/i);
                    if (m?.[1]) {
                      shzMediaCookie = m[1];
                      break;
                    }
                  }
                  const authJson = await authResp.json();
                  if (authJson?.url) {
                    finalM3u8 = authJson.url;
                  }
                }
              } else if (resJson?.url) {
                finalM3u8 = resJson.url.startsWith('/')
                  ? `https://shortizle.com${resJson.url}`
                  : resJson.url;
              }

              if (finalM3u8) {
                const cookieParam = shzMediaCookie
                  ? `&shz_cookie=${encodeURIComponent(shzMediaCookie)}`
                  : '';
                const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(finalM3u8)}&ref=${encodeURIComponent('https://shortizle.com/')}${cookieParam}`;
                const result = {
                  mode: 'native_hls' as const,
                  streamType: 'hls' as const,
                  streamUrl: proxiedStream,
                  directUrl: finalM3u8,
                  qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
                  fallbackIframe: watchUrl,
                };
                setCachedStream(url, result, 30 * 60 * 1000);
                return NextResponse.json(result, { headers: CACHE_HEADERS });
              }
            }
          }
        }
      }

      return NextResponse.json(
        { error: 'Shortİzle video kaynağı çözümlenemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'Shortİzle sunucusuna erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // =========================================================================
  // 0-E. AnimeLVL Direct MP4 Stream Resolver
  // =========================================================================
  if (provider === 'animelvl' || lowerUrl.includes('animelvl.com')) {
    try {
      if (lowerUrl.includes('/api/stream.mp4')) {
        const result = {
          mode: 'native_mp4' as const,
          streamType: 'mp4' as const,
          streamUrl: url,
          qualities: [{ label: '1080p HD', url }],
          fallbackIframe: url,
        };
        setCachedStream(url, result, 45 * 60 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      // Episode page e.g. https://animelvl.com/izle/...
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://animelvl.com/',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const html = await resp.text();
        const m =
          html.match(/https?:\/\/animelvl\.com\/api\/stream\.mp4\?[^"'\s]+/i) ||
          html.match(/api\/stream\.mp4\?[^"'\s]+/i) ||
          html.match(/\/api\/stream\.mp4\?[^"'\s]+/i);

        if (m?.[0]) {
          let streamUrl = m[0];
          if (!streamUrl.startsWith('http')) {
            streamUrl = `https://animelvl.com/${streamUrl.replace(/^\//, '')}`;
          }
          const result = {
            mode: 'native_mp4' as const,
            streamType: 'mp4' as const,
            streamUrl,
            qualities: [{ label: '1080p HD', url: streamUrl }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 45 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
      }

      return NextResponse.json(
        { error: 'AnimeLVL stream bağlantısı bulunamadı veya silinmiş', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    } catch {
      return NextResponse.json(
        { error: 'AnimeLVL sunucusuna erişilemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }
  }

  // 00. AsyaWatch & Dizilla / Pichive / DPlayer / Hotlinger Native Stream Resolver
  if (
    lowerUrl.includes('pichive.online') ||
    lowerUrl.includes('dplayer82.site') ||
    lowerUrl.includes('dplayer') ||
    lowerUrl.includes('hotlinger.com') ||
    lowerUrl.includes('asyawatch.com') ||
    lowerUrl.includes('dizilla.now') ||
    provider.includes('asyawatch') ||
    provider.includes('dizilla')
  ) {
    try {
      if (lowerUrl.includes('.m3u8')) {
        const ref = lowerUrl.includes('dplayer') ? 'https://sn.dplayer82.site/' : 'https://four.pichive.online/';
        const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(ref)}`;
        const result = {
          mode: 'native_hls' as const,
          streamType: 'hls' as const,
          streamUrl: proxiedMaster,
          directUrl: url,
          qualities: [{ label: '1080p (Orijinal)', url: proxiedMaster }],
          fallbackIframe: null,
        };
        setCachedStream(url, result, 30 * 60 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      let iframeUrl = url;
      if (iframeUrl.startsWith('//')) {
        iframeUrl = `https:${iframeUrl}`;
      }

      // If user passed episode page instead of iframe, extract iframe first
      if (iframeUrl.includes('asyawatch.com/dizi/')) {
        const { execFile } = await import('child_process');
        const pageHtml = await new Promise<string>((resolve, reject) => {
          execFile(
            CURL_BIN,
            [
              '-s',
              '-L',
              '-H', 'Referer: https://asyawatch.com/',
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              iframeUrl,
            ],
            { maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });
        const mIframe = pageHtml.match(/src=["'](\/\/[^"']*(?:pichive|hotlinger|dplayer)[^"']*)["']/i) ||
                        pageHtml.match(/src=["'](https?:\/\/[^"']*(?:pichive|hotlinger|dplayer)[^"']*)["']/i);
        if (mIframe?.[1]) {
          iframeUrl = mIframe[1].startsWith('//') ? `https:${mIframe[1]}` : mIframe[1];
        }
      } else if (iframeUrl.includes('dizilla.now/')) {
        const { execFile } = await import('child_process');
        const pageHtml = await new Promise<string>((resolve, reject) => {
          execFile(
            CURL_BIN,
            [
              '-s',
              '-L',
              '-H', 'Referer: https://dizilla.now/',
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              iframeUrl,
            ],
            { maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });
        const mIframe = pageHtml.match(/src=["'](\/\/[^"']*(?:hotlinger|dplayer|pichive)[^"']*)["']/i) ||
                        pageHtml.match(/src=["'](https?:\/\/[^"']*(?:hotlinger|dplayer|pichive)[^"']*)["']/i);
        if (mIframe?.[1]) {
          iframeUrl = mIframe[1].startsWith('//') ? `https:${mIframe[1]}` : mIframe[1];
        }
      }

      const refSite = iframeUrl.includes('pichive') || provider.includes('asyawatch')
        ? 'https://asyawatch.com/'
        : 'https://dizilla.now/';

      // 1. Primary: Global Cloudflare Edge Worker stream resolver (instant, edge-cached, works on Vercel AWS Lambda)
      try {
        const edgeResp = await fetch(
          `https://koup-edge-worker.caganhuseyinerdil.workers.dev/pichive?url=${encodeURIComponent(iframeUrl)}`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (edgeResp.ok) {
          const edgeData = await edgeResp.json();
          if (edgeData?.status === 'success' && edgeData.streamUrl) {
            const masterStreamUrl = edgeData.streamUrl;
            let origin = 'https://four.pichive.online';
            try {
              origin = new URL(iframeUrl).origin;
            } catch {}
            const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterStreamUrl)}&ref=${encodeURIComponent(iframeUrl)}`;
            const subtitles = (edgeData.subtitles || []).map((s: any) => {
              const rawFile = String(s.file || '');
              const fullSubUrl = rawFile.startsWith('http')
                ? rawFile
                : rawFile.startsWith('//')
                ? `https:${rawFile}`
                : `${origin}${rawFile.startsWith('/') ? '' : '/'}${rawFile}`;
              return {
                label: s.label || 'Türkçe',
                lang: s.lang || 'tr',
                url: `/api/stream-proxy?url=${encodeURIComponent(fullSubUrl)}&ref=${encodeURIComponent(iframeUrl)}`,
                default: !!s.default,
              };
            });

            return NextResponse.json(
              {
                mode: 'native_hls',
                streamUrl: proxiedMaster,
                streamType: 'hls',
                directUrl: masterStreamUrl,
                posterImage: edgeData.poster || null,
                subtitles,
                qualities: [{ label: '1080p (Orijinal)', url: proxiedMaster }],
                fallbackIframe: iframeUrl.includes('pichive') || iframeUrl.includes('dplayer') ? null : iframeUrl,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      } catch (edgeErr) {
        console.warn('Edge Worker pichive extraction failed, falling back:', edgeErr);
      }

      const { execFile } = await import('child_process');
      const iframeHtml = await new Promise<string>((resolve, reject) => {
        execFile(
          CURL_BIN,
          [
            '-s',
            '-L',
            '-H', `Referer: ${refSite}`,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--connect-timeout', '6',
            '--max-time', '10',
            iframeUrl,
          ],
          { maxBuffer: 10 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        );
      });

      const tokenMatch = iframeHtml.match(/openPlayer\(\s*['"]([^'"]+)['"]/);
      if (tokenMatch?.[1]) {
        const token = tokenMatch[1];
        const parsedIframe = new URL(iframeUrl);
        const origin = parsedIframe.origin;
        const source2Url = `${origin}/source2.php?v=${encodeURIComponent(token)}`;

        const s2JsonStr = await new Promise<string>((resolve, reject) => {
          execFile(
            CURL_BIN,
            [
              '-s',
              '-L',
              '-H', `Referer: ${iframeUrl}`,
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              '-H', 'X-Requested-With: XMLHttpRequest',
              '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
              '--connect-timeout', '6',
              '--max-time', '10',
              source2Url,
            ],
            { maxBuffer: 5 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });

        const s2Data = JSON.parse(s2JsonStr);
        const playlistItem = s2Data?.playlist?.[0];
        const masterStreamUrl = playlistItem?.sources?.[0]?.file;

        if (masterStreamUrl) {
          const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterStreamUrl)}&ref=${encodeURIComponent(iframeUrl)}`;
          
          let subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
          const subMatch = iframeHtml.match(/\[\s*\{\s*["']file["']\s*:\s*["'][^"']+\.vtt[^"']*["'][\s\S]*?\]/);
          if (subMatch?.[0]) {
            try {
              const rawSubs = JSON.parse(subMatch[0]);
              subtitles = rawSubs
                .filter((s: any) => s.file)
                .map((s: any) => {
                  const rawFile = String(s.file);
                  const fullSubUrl = rawFile.startsWith('http')
                    ? rawFile
                    : rawFile.startsWith('//')
                    ? `https:${rawFile}`
                    : `${origin}${rawFile.startsWith('/') ? '' : '/'}${rawFile}`;
                  return {
                    label: s.label || 'Türkçe',
                    lang: s.lang || 'tr',
                    url: `/api/stream-proxy?url=${encodeURIComponent(fullSubUrl)}&ref=${encodeURIComponent(iframeUrl)}`,
                    default: !!s.default,
                  };
                });
            } catch {}
          }

          return NextResponse.json(
            {
              mode: 'native_hls',
              streamUrl: proxiedMaster,
              streamType: 'hls',
              directUrl: masterStreamUrl,
              posterImage: playlistItem?.image || null,
              subtitles,
              qualities: [
                { label: '1080p (Orijinal)', url: proxiedMaster },
              ],
              fallbackIframe: iframeUrl.includes('pichive') || iframeUrl.includes('dplayer') ? null : iframeUrl,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch (err: any) {
      console.warn('AsyaWatch / Dizilla native stream extraction error:', err?.message || err);
    }

    // Fallback if extraction failed - never return dead pichive/asyawatch iframe that refuses connection
    if (lowerUrl.includes('pichive') || lowerUrl.includes('dplayer')) {
      return NextResponse.json(
        { error: 'Pichive / DPlayer akışı doğrudan çözülemedi', isDead: true },
        { status: 410, headers: CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        mode: 'iframe',
        iframeUrl: url,
        qualities: [{ label: '1080p', url: url }],
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 0. Dizikorea / playerdkorea.xyz Direct 1080p HLS Resolver
  if (url.includes('playerdkorea.xyz') || url.includes('playerkorea') || provider === 'dizikorea') {
    try {
      const m = url.match(/(?:\/video\/|[?&]data=|\/embed\/)([a-zA-Z0-9]+)/);
      const videoId = m?.[1];
      if (videoId) {
        const body = new URLSearchParams({ hash: videoId, r: 'https://dizikorea3.com/' });
        const postResp = await fetch(`https://playerdkorea.xyz/player/index.php?data=${videoId}&do=getVideo`, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': `https://playerdkorea.xyz/video/${videoId}`,
            'Origin': 'https://playerdkorea.xyz',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(6000),
        });

        if (postResp.ok) {
          const data = await postResp.json();
          const streamUrl = data.securedLink || data.videoSource;
          if (streamUrl) {
            let workingRef: string | null = null;
            // Quick probe with dizikorea3.com
            try {
              const r1 = await fetch(streamUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  Referer: 'https://dizikorea3.com/',
                  Origin: 'https://dizikorea3.com',
                },
                signal: AbortSignal.timeout(4000),
              });
              if (r1.ok) {
                workingRef = 'https://dizikorea3.com/';
              } else if (r1.status !== 404) {
                workingRef = 'https://dizikorea3.com/';
              }
            } catch {}

            if (!workingRef) {
              // Probe with playerdkorea.xyz
              try {
                const r2 = await fetch(streamUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://playerdkorea.xyz/',
                    Origin: 'https://playerdkorea.xyz',
                  },
                  signal: AbortSignal.timeout(4000),
                });
                if (r2.ok) {
                  workingRef = 'https://playerdkorea.xyz/';
                }
              } catch {}
            }

            if (!workingRef) {
              return NextResponse.json(
                { error: 'Dizikorea video dosyası sunucudan silinmiş (404)', isDead: true },
                { status: 410 }
              );
            }

            const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent(workingRef)}`;
            return NextResponse.json({
              mode: 'native_hls',
              streamUrl: proxiedStream,
              streamType: 'hls',
              directUrl: streamUrl,
              posterImage: data.videoImage || null,
              qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
            });
          }
        }
      }
      return NextResponse.json(
        { error: 'Dizikorea kaynağı artık mevcut değil veya yanıt vermiyor', isDead: true },
        { status: 410 }
      );
    } catch {
      return NextResponse.json(
        { error: 'Dizikorea kaynağına erişilemedi', isDead: true },
        { status: 410 }
      );
    }
  }

  // 0a. Dizibox / DBX Pro / Molystream Direct 1080p HLS Resolver
  if (url.includes('molystream') || url.includes('/player/king/') || provider === 'dizibox' || provider === 'dbx') {
    try {
      let embedUrl = url;
      if (url.includes('/player/king/')) {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.dizibox.live/',
          },
          signal: AbortSignal.timeout(5000),
        });
        const html = await resp.text();
        const m = html.match(/src=["'](https:\/\/dbx\.molystream\.org\/embed\/[^"']+)["']/);
        if (m) embedUrl = m[1];
      }

      if (embedUrl.includes('dbx.molystream.org/embed/') && !embedUrl.includes('/embed/sheila/')) {
        embedUrl = embedUrl.replace(/dbx\.molystream\.org\/embed\/(?!sheila\/)/i, 'dbx.molystream.org/embed/sheila/');
      }

      const mId = embedUrl.match(/embed\/(?:sheila\/)?([a-zA-Z0-9-]+)/);
      const videoId = mId?.[1];
      if (videoId) {
        const hlsUrl = `https://dbx.molystream.org/embed/sheila/${videoId}`;
        const fullEmbed = hlsUrl;
        // Health check: probe embed to ensure video is not 404 / deleted / "No Video Found"
        try {
          const probe = await fetch(hlsUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://www.dizibox.live/',
            },
            signal: AbortSignal.timeout(4000),
          });
          if (!probe.ok && (probe.status === 404 || probe.status === 410 || probe.status === 500)) {
            return NextResponse.json(
              { error: 'Molystream videosu sunucudan silinmiş veya bulunamadı (404)', isDead: true },
              { status: 410 }
            );
          }
          const probeText = await probe.text();
          const lowText = probeText.toLowerCase();
          if (
            lowText.includes('no video found') ||
            lowText.includes('this video not found') ||
            lowText.includes('file was deleted') ||
            lowText.includes('video not found') ||
            lowText.includes('file not found') ||
            lowText.includes('404 not found') ||
            probeText.includes('{"status":"error"}')
          ) {
            return NextResponse.json(
              { error: 'Molystream videosu silinmiş (404 No Video Found)', isDead: true },
              { status: 410 }
            );
          }
        } catch {}

        const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(hlsUrl)}&ref=${encodeURIComponent('https://dbx.molystream.org/')}`;
        const result = {
          mode: 'native_hls' as const,
          streamUrl: proxiedStream,
          streamType: 'hls' as const,
          directUrl: hlsUrl,
          qualities: [{ label: '1080p (Molystream DBX)', url: proxiedStream }],
          fallbackIframe: fullEmbed,
        };
        setCachedStream(url, result);
        if (rawUrl && rawUrl !== url) {
          setCachedStream(rawUrl, result);
        }
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch {}
  }

  // 0b. HDFilmcehennemi Close Player & Rapidrame Direct HLS / Dual Audio / Subtitles Resolver
  if (
    url.includes('hdfilmcehennemi.mobi/video/embed') ||
    url.includes('playmix.uno') ||
    url.includes('rapidrame') ||
    provider.includes('close') ||
    provider.includes('rapid') ||
    provider === 'hdfilm-close' ||
    provider === 'hdfilm-hls'
  ) {
    try {
      // Direct playmix.uno, rapidrame m3u8, or master.txt
      if (
        url.includes('.m3u8') ||
        (url.includes('master.txt') && !url.includes('/video/embed/')) ||
        (url.includes('rapidrame.com') && (url.includes('/hls') || url.includes('.m3u8'))) ||
        (url.includes('playmix.uno') && url.includes('master.txt'))
      ) {
        const streamReferer = url.includes('rapidrame')
          ? 'https://www.hdfilmcehennemi.nl/'
          : 'https://hdfilmcehennemi.mobi/';
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(streamReferer)}`;

        let subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
        const embedMatch = url.match(/-([a-zA-Z0-9]{8,15})\.mp4/);
        if (embedMatch?.[1]) {
          try {
            const embedUrl = `https://hdfilmcehennemi.mobi/video/embed/${embedMatch[1]}`;
            const embedResp = await fetch(embedUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Referer: 'https://hdfilmcehennemi.mobi/',
              },
              signal: AbortSignal.timeout(3500),
            });
            if (embedResp.ok) {
              const embedHtml = await embedResp.text();
              subtitles = extractHdfilmSubtitles(embedHtml, 'https://hdfilmcehennemi.mobi', 'https://hdfilmcehennemi.mobi/');
            }
          } catch {}
        }

        const payload = {
          mode: 'native_hls',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          subtitles: subtitles.length > 0 ? subtitles : undefined,
          fallbackIframe: undefined,
        };
        setCachedStream(url, payload);
        return NextResponse.json(payload, { headers: CACHE_HEADERS });
      }

      // Embed page (e.g. Close Player https://hdfilmcehennemi.mobi/video/embed/... or Rapidrame https://www.hdfilmcehennemi.nl/rplayer/...)
      if (url.includes('hdfilmcehennemi.mobi/video/embed/') || url.includes('/video/embed/') || url.includes('/rplayer/')) {
        let embedFetchUrl = url;
        let fetchReferer = 'https://hdfilmcehennemi.mobi/';
        if (url.includes('/video/embed/')) {
          embedFetchUrl = url.split('?')[0];
          fetchReferer = 'https://hdfilmcehennemi.mobi/';
        } else if (url.includes('/rplayer/')) {
          fetchReferer = 'https://www.hdfilmcehennemi.nl/';
        }

        let html = '';
        try {
          const embedResp = await fetch(embedFetchUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Referer: fetchReferer,
            },
            signal: AbortSignal.timeout(6000),
          });
          if (embedResp.ok) {
            html = await embedResp.text();
          }
        } catch {}

        if (!html || html.includes('Just a moment...') || html.includes('Turnstile')) {
          try {
            const { execFile } = await import('child_process');
            html = await new Promise<string>((resolve, reject) => {
              execFile(
                'python',
                [
                  '-c',
                  `import sys; from curl_cffi import requests; sys.stdout.reconfigure(encoding='utf-8'); r = requests.get(${JSON.stringify(embedFetchUrl)}, headers={'Referer': ${JSON.stringify(fetchReferer)}}, impersonate='chrome', timeout=8); print(r.text if r.status_code == 200 else '')`,
                ],
                { maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
                (err, stdout) => (err ? reject(err) : resolve(stdout))
              );
            });
          } catch {}
        }

        if (!html || html.includes('Just a moment...') || html.includes('Turnstile')) {
          try {
            const { execFile } = await import('child_process');
            html = await new Promise<string>((resolve, reject) => {
              execFile(
                CURL_BIN,
                [
                  '-s',
                  '-L',
                  '-H', `Referer: ${fetchReferer}`,
                  '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                  '--connect-timeout', '6',
                  '--max-time', '10',
                  embedFetchUrl,
                ],
                { maxBuffer: 10 * 1024 * 1024 },
                (err, stdout) => (err ? reject(err) : resolve(stdout))
              );
            });
          } catch {}
        }

        if (html) {
          // 1. Extract WebVTT subtitles (deduplicated & normalized)
          const embedOrigin = embedFetchUrl.includes('/rplayer/')
            ? 'https://www.hdfilmcehennemi.nl'
            : new URL(embedFetchUrl).origin;
          const subRef = embedFetchUrl.includes('/rplayer/')
            ? 'https://www.hdfilmcehennemi.nl/'
            : 'https://hdfilmcehennemi.mobi/';
          const subtitles = extractHdfilmSubtitles(html, embedOrigin, subRef);

          // 2. Resolve Master HLS URL from obfuscated jwplayer setup or unpack
          let masterHlsUrl: string | null = null;
          const scriptMatches = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || [];

          // 2a. Primary: Variable unpacker (sources: [{file: varName}])
          const mVar = html.match(/sources:\s*\[\{file:\s*(\w+)/);
          if (mVar?.[1]) {
            const varName = mVar[1];
            const candScript = scriptMatches.find((s) => s.includes(varName) && (s.includes('eval(') || s.includes('function')));
            if (candScript) {
              const cleanCode = candScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
              const host = new URL(embedFetchUrl).hostname;
              const orig = new URL(embedFetchUrl).origin;
              const stub = `
                var atob = (str) => Buffer.from(str, 'base64').toString('binary');
                var btoa = (str) => Buffer.from(str, 'binary').toString('base64');
                var location = { href: '${embedFetchUrl}', hostname: '${host}', origin: '${orig}', protocol: 'https:' };
                var document = { querySelector: () => null, addEventListener: () => {}, location };
                var window = { location, document, navigator: { userAgent: 'Mozilla/5.0' } };
                var self = window;
              `;
              try {
                const fn = new Function(stub + '\n' + cleanCode + `\nreturn ${varName};`);
                const resolved = fn();
                if (resolved && typeof resolved === 'string' && resolved.startsWith('http')) {
                  masterHlsUrl = resolved;
                }
              } catch (err: any) {
                console.error('HDFILM VAR UNPACK ERROR:', err?.message);
              }
            }
          }

          // 2b. Secondary: Full JWPlayer setup proxy evaluator
          if (!masterHlsUrl) {
            const cand = scriptMatches.find((s) => s.includes('jwplayer') && (s.includes('eval(function') || s.includes('sources') || s.includes('.split(') || s.includes('master')));
            if (cand) {
              const cleanCode = cand.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
              const host = new URL(embedFetchUrl).hostname;
              const orig = new URL(embedFetchUrl).origin;
              const stub = `
                const createProxy = () => new Proxy(() => createProxy(), { get: (t, p) => p === 'then' ? undefined : createProxy(), apply: () => createProxy() });
                var window = new Proxy({
                  lastCheckPoint: 0,
                  location: { href: '${embedFetchUrl}', hostname: '${host}', origin: '${orig}', protocol: 'https:' },
                  addEventListener: () => {},
                  removeEventListener: () => {},
                  navigator: { userAgent: 'Mozilla/5.0' },
                  screen: { width: 1920, height: 1080 }
                }, {
                  get: (target, prop) => prop in target ? target[prop] : createProxy()
                });
                var document = createProxy();
                var localStorage = {};
                var setInterval = () => 0;
                var setTimeout = () => 0;
                var extractedUrl = null;
                var jwplayer = () => ({
                  setup: (cfg) => {
                    if (cfg && cfg.sources && cfg.sources[0]) {
                      extractedUrl = cfg.sources[0].file;
                    }
                    return createProxy();
                  },
                  on: () => createProxy(),
                  addButton: () => createProxy(),
                  getContainer: () => createProxy()
                });
                jwplayer.key = "test";
                var $ = createProxy();
              `;
              try {
                const fn = new Function(stub + cleanCode + `\nreturn extractedUrl;`);
                const resolved = fn();
                if (resolved && typeof resolved === 'string' && resolved.startsWith('http')) {
                  masterHlsUrl = resolved;
                }
              } catch (err: any) {
                console.error('RPLAYER UNPACK ERROR:', err?.message);
              }
            }
          }

          if (!masterHlsUrl) {
            const mDirect =
              html.match(/https?:\/\/[^"'\s]*\.mp4\/master\.txt[^"'\s]*/) ||
              html.match(/file:\s*["'](https?:\/\/[^"'\s]*\.m3u8[^"'\s]*)["']/) ||
              html.match(/https?:\/\/[^"'\s]*\.m3u8[^"'\s]*/);
            if (mDirect) masterHlsUrl = mDirect[1] || mDirect[0];
          }

          if (masterHlsUrl) {
            const streamReferer =
              embedFetchUrl.includes('/rplayer/') || masterHlsUrl.includes('rapidrame')
                ? 'https://www.hdfilmcehennemi.nl/'
                : 'https://hdfilmcehennemi.mobi/';
            const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterHlsUrl)}&ref=${encodeURIComponent(streamReferer)}`;
            return NextResponse.json(
              {
                mode: 'native_hls',
                streamUrl: proxiedMaster,
                qualities: [{ label: '1080p', url: proxiedMaster }],
                subtitles,
                fallbackIframe: undefined,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      }
    } catch {}
  }

  // 1. Tau-Video Direct MP4/HLS Quality Resolver (for AnimeciX / Tau-Video sources)
  if (
    provider === 'tau-video' ||
    provider.includes('tau') ||
    url.includes('tau-video.xyz') ||
    url.includes('tau-video')
  ) {
    try {
      const code =
        url.match(/\/embed\/([a-zA-Z0-9_-]+)/)?.[1] ||
        url.match(/\/video\/([a-zA-Z0-9_-]+)/)?.[1] ||
        url.match(/([a-f0-9]{24,64})/i)?.[1] ||
        url.split('/').pop()?.split('?')[0];

      if (code) {
        let tauData: any = null;

        // Primary: Cloudflare Edge Worker (runs directly in Cloudflare network, bypassing WAF blocks on Vercel IPs)
        try {
          const edgeRes = await fetch(
            `https://koup-edge-worker.caganhuseyinerdil.workers.dev/tau?key=${encodeURIComponent(code)}`,
            {
              signal: AbortSignal.timeout(3000),
              headers: { Accept: 'application/json' },
            }
          );
          if (edgeRes.ok) {
            const edgeJson = await edgeRes.json();
            if (edgeJson?.urls && edgeJson.urls.length > 0) {
              tauData = edgeJson;
            }
          }
        } catch {}

        // Secondary fallback: Direct tau-video API if edge worker did not respond
        if (!tauData) {
          try {
            const apiResp = await fetch(`https://tau-video.xyz/api/video/${code}`, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Referer: 'https://tau-video.xyz/',
                Accept: 'application/json',
              },
              signal: AbortSignal.timeout(3500),
            });
            if (apiResp.ok) {
              const apiJson = await apiResp.json();
              if (apiJson?.urls && apiJson.urls.length > 0) {
                tauData = apiJson;
              }
            }
          } catch {}
        }

        if (tauData?.urls && tauData.urls.length > 0) {
          const urls: Array<{ label: string; url: string; size?: number }> = tauData.urls;
          const sorted = [...urls].sort((a, b) => {
            const qa = parseInt(a.label || '0', 10);
            const qb = parseInt(b.label || '0', 10);
            return qb - qa;
          });

          // Use direct Backblaze/Cloudflare CDN MP4 URLs (CORS-enabled & 206 byte-range ready); NetflixPlayer falls back to stream-proxy on error if needed
          const directQualities = sorted.map((q) => ({
            label: q.label || '1080p',
            url: q.url,
          }));

          const payload = {
            mode: 'native_mp4' as const,
            qualities: directQualities,
            streamUrl: directQualities[0].url,
            thumbnails: tauData.thumbnails || undefined,
            fallbackIframe: url,
          };
          setCachedStream(url, payload, 4 * 60 * 60 * 1000);
          return NextResponse.json(payload, { headers: CACHE_HEADERS });
        }
      }
    } catch {
      // proceed to iframe fallback
    }
  }

  // Diziyou direct HLS (storage.diziyou.one has access-control-allow-origin: * open CORS)
  if (url.includes('storage.diziyou') || url.includes('diziyou.one') || provider === 'diziyou-hls') {
    const epMatch = url.match(/\/episodes\/(\d+)\//);
    const subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
    if (epMatch?.[1]) {
      const epId = epMatch[1];
      subtitles.push({
        label: 'Türkçe',
        lang: 'tr',
        url: `https://storage.diziyou.one/subtitles/${epId}/tr.vtt`,
        default: true,
      });
      subtitles.push({
        label: 'English',
        lang: 'en',
        url: `https://storage.diziyou.one/subtitles/${epId}/en.vtt`,
        default: false,
      });
    }

    const payload = {
      mode: 'native_hls' as const,
      streamUrl: url,
      qualities: [{ label: '1080p', url: url }],
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      fallbackIframe: url,
    };
    setCachedStream(url, payload);
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  }

  // 2. Direct HLS / MP4 pass-through (with stream-proxy for CDNs and CORS protection)
  if (
    url.includes('.m3u8') ||
    url.includes('master.txt') ||
    (url.includes('dtpasn.asia') && (url.includes('.m3u8') || url.includes('/cdn/hls/')))
  ) {
    let customRef = '';
    if (url.includes('rapidrame') || url.includes('hdfilm')) {
      customRef = 'https://www.hdfilmcehennemi.nl/';
    } else if (url.includes('dtpasn') || url.includes('dizikorea')) {
      customRef = 'https://dizikorea3.com/';
    } else if (url.includes('molystream') || url.includes('dizibox')) {
      customRef = 'https://dbx.molystream.org/';
    } else if (url.includes('animecix') || url.includes('tau-video')) {
      customRef = 'https://animecix.net/';
    }

    const finalStreamUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}${customRef ? `&ref=${encodeURIComponent(customRef)}` : ''}`;

    return NextResponse.json(
      {
        mode: 'native_hls',
        streamUrl: finalStreamUrl,
        qualities: [{ label: '1080p', url: finalStreamUrl }],
        fallbackIframe: url,
      },
      { headers: CACHE_HEADERS }
    );
  }
  if (
    url.endsWith('.mp4') ||
    url.includes('.mp4?') ||
    url.includes('.mp4&') ||
    url.includes('videoplayback') ||
    url.includes('downloader.disk.yandex') ||
    url.includes('content_type=video')
  ) {
    const needsProxy =
      url.includes('vmcdn.ciner.com.tr') ||
      url.includes('downloader.disk.yandex') ||
      url.includes('yadi.sk');

    let streamUrl = url;
    if (needsProxy) {
      const ref = url.includes('ciner')
        ? 'https://www.showtv.com.tr/'
        : url.includes('yandex')
        ? 'https://disk.yandex.com.tr/'
        : '';
      streamUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
    }

    // Multi-quality resolution generator (Tau-Video & CDN streams)
    const qualities: Array<{ label: string; url: string }> = [];
    if (streamUrl.includes('1080p')) {
      qualities.push({ label: '1080p (Full HD)', url: streamUrl });
      qualities.push({ label: '720p (HD)', url: streamUrl.replaceAll('1080p', '720p') });
      qualities.push({ label: '480p (SD)', url: streamUrl.replaceAll('1080p', '480p') });
    } else if (streamUrl.includes('720p')) {
      qualities.push({ label: '1080p (Full HD)', url: streamUrl.replaceAll('720p', '1080p') });
      qualities.push({ label: '720p (HD)', url: streamUrl });
      qualities.push({ label: '480p (SD)', url: streamUrl.replaceAll('720p', '480p') });
    } else {
      qualities.push({ label: '1080p', url: streamUrl });
    }

    return NextResponse.json(
      {
        mode: 'native_mp4',
        streamUrl,
        qualities,
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 3. YouTube Streams normalization (with enablejsapi=1 for postMessage telemetry)
  if (
    lowerUrl.includes('youtube.com') ||
    lowerUrl.includes('youtu.be') ||
    lowerUrl.includes('youtube-nocookie.com') ||
    provider === 'youtube'
  ) {
    let videoId = '';
    const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_\-]+)/);
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_\-]+)/);
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_\-]+)/);

    if (embedMatch) videoId = embedMatch[1];
    else if (watchMatch) videoId = watchMatch[1];
    else if (shortMatch) videoId = shortMatch[1];

    if (videoId) {
      const cleanUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&controls=0&disablekb=1&fs=0&modestbranding=1&iv_load_policy=3`;
      return NextResponse.json(
        {
          mode: 'iframe',
          isYouTube: true,
          streamUrl: cleanUrl,
          iframeUrl: cleanUrl,
        },
        { headers: CACHE_HEADERS }
      );
    }
  }

  // 3b. DDizi Bridge & Media Duhnet Direct MP4 Resolver
  if (lowerUrl.includes('ddizi.tel/player/mp4/')) {
    try {
      const b64 = url.split('/player/mp4/')[1]?.replace('.mp4', '');
      if (b64) {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        if (decoded && decoded.startsWith('http')) {
          const proxied = `/api/stream-proxy?url=${encodeURIComponent(decoded)}&ref=${encodeURIComponent('https://media.duhnet.tv/')}`;
          const result = {
            mode: 'native_mp4' as const,
            streamUrl: proxied,
            qualities: [{ label: '1080p (Duhnet)', url: proxied }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
      }
    } catch {}
  }

  // 3c. Yandex Disk Direct Stream Resolver
  if (lowerUrl.includes('yadi.sk') || lowerUrl.includes('disk.yandex')) {
    try {
      const href = await resolveYandexDisk(url);
      if (href) {
        const proxied = `/api/stream-proxy?url=${encodeURIComponent(href)}&ref=${encodeURIComponent('https://disk.yandex.com.tr/')}`;
        const result = {
          mode: 'native_mp4' as const,
          streamUrl: proxied,
          qualities: [{ label: '1080p (Yandex Disk)', url: proxied }],
          fallbackIframe: url,
        };
        setCachedStream(url, result);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch {}
  }

  // 3d. EV Player (morencius.com / vidhide) Direct 1080p HLS Resolver
  if (
    lowerUrl.includes('morencius.com') ||
    lowerUrl.includes('vidhide') ||
    provider === 'morencius' ||
    provider === 'ev'
  ) {
    try {
      let targetEvUrl = url;
      if (lowerUrl.includes('vidhide')) {
        const vhMatch = url.match(/(?:embed-|e\/|v\/)([a-zA-Z0-9]+)/);
        if (vhMatch) {
          targetEvUrl = `https://morencius.com/embed/${vhMatch[1]}`;
        }
      }
      const resp = await fetch(targetEvUrl, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://morencius.com/',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json({ error: 'EV videosu bulunamadı (404)', isDead: true }, { status: 410 });
      }
      const html = await resp.text();
      if (html.includes('File Not Found') || html.includes('Video not found')) {
        return NextResponse.json({ error: 'EV videosu silinmiş', isDead: true }, { status: 410 });
      }
      const unpacked = unpackDeanEdwards(html);
      const m3u8Match =
        unpacked.match(/["']hls2["']\s*:\s*["']([^"']+)["']/) ||
        unpacked.match(/["']hls3["']\s*:\s*["']([^"']+)["']/) ||
        unpacked.match(/["']hls4["']\s*:\s*["']([^"']+)["']/) ||
        unpacked.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/) ||
        unpacked.match(/https?:\/\/[^\s"'<>]+\/master\.txt[^\s"'<>]*/);
      if (m3u8Match) {
        const m3u8Url = m3u8Match[1] || m3u8Match[0];
        const proxied = `/api/stream-proxy?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://morencius.com/')}`;
        const result = {
          mode: 'native_hls' as const,
          streamUrl: proxied,
          qualities: [{ label: '1080p (EV)', url: proxied }],
          fallbackIframe: url,
        };
        setCachedStream(url, result, 12 * 60 * 60 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch {}
  }

  // 3e. GDrivePlayer XOR Direct HLS Resolver
  if (lowerUrl.includes('gdriveplayer') || lowerUrl.includes('gdplayer') || provider.includes('gdriveplayer')) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://gdriveplayer.to/',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const directHls = resolveGDrivePlayer(html);
        if (directHls) {
          const proxied = `/api/stream-proxy?url=${encodeURIComponent(directHls)}&ref=${encodeURIComponent('https://gdriveplayer.to/')}`;
          const result = {
            mode: 'native_hls' as const,
            streamUrl: proxied,
            qualities: [{ label: '1080p (GDrivePlayer)', url: proxied }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
      }
    } catch {}
  }

  // 3f. Filemoon & Byse Direct 1080p HLS Resolver
  if (
    lowerUrl.includes('filemoon.sx') ||
    lowerUrl.includes('bysesukior') ||
    lowerUrl.includes('bysedikamoum') ||
    lowerUrl.includes('byse.') ||
    provider === 'filemoon' ||
    provider === 'byse'
  ) {
    try {
      const parsedU = new URL(url);
      const host = parsedU.host;
      const codeMatch = url.match(/(?:\/e\/|\/v\/|\/d\/|\/download\/|videos\/)([a-zA-Z0-9]+)/);
      const code = codeMatch?.[1];
      if (code) {
        const directHls = await resolveFilemoonByse(code, host);
        if (directHls) {
          const proxied = `/api/stream-proxy?url=${encodeURIComponent(directHls)}&ref=${encodeURIComponent(`https://${host}/`)}`;
          const result = {
            mode: 'native_hls' as const,
            streamUrl: proxied,
            qualities: [{ label: '1080p (Filemoon)', url: proxied }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
      }
    } catch {}
  }

  // 3g. UPNS Direct 1080p HLS Resolver
  if (lowerUrl.includes('upns.one') || lowerUrl.includes('upns.online') || lowerUrl.includes('upn.one') || provider === 'upns') {
    try {
      const parsedU = new URL(url);
      const host = parsedU.host;
      if (host.includes('asyaanim')) {
        return NextResponse.json(
          { error: 'AsyaAnim videosu silinmiş veya bulunamadı', isDead: true },
          { status: 200 }
        );
      }
      const hashMatch = url.match(/[#\/]([a-zA-Z0-9_-]{5,12})$/);
      const hashId = hashMatch?.[1];
      if (hashId) {
        const directHls = await resolveUPNS(hashId, host);
        if (directHls) {
          const proxied = `/api/stream-proxy?url=${encodeURIComponent(directHls)}&ref=${encodeURIComponent(`https://${host}/`)}`;
          const result = {
            mode: 'native_hls' as const,
            streamUrl: proxied,
            qualities: [{ label: '1080p (UPNS)', url: proxied }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        } else {
          return NextResponse.json(
            { error: 'UPNS videosu silinmiş veya bulunamadı', isDead: true },
            { status: 200 }
          );
        }
      }
    } catch {}
  }

  // 3h. LULU Player Direct HLS Resolver
  if (lowerUrl.includes('luluvdo') || lowerUrl.includes('lulustream') || lowerUrl.includes('lulu.st') || provider.includes('lulu')) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': commonUA, Referer: 'https://luluvdo.com/' },
        signal: AbortSignal.timeout(6000),
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json({ error: 'Lulu videosu silinmiş (404)', isDead: true }, { status: 410 });
      }
      const html = await resp.text();
      if (html.includes('File was deleted') || html.includes('File Not Found')) {
        return NextResponse.json({ error: 'Lulu videosu silinmiş', isDead: true }, { status: 410 });
      }
      const unpacked = unpackDeanEdwards(html);
      const m3u8Match =
        unpacked.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
        unpacked.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
      if (m3u8Match) {
        const m3u8Url = m3u8Match[1] || m3u8Match[0];
        const proxied = `/api/stream-proxy?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://luluvdo.com/')}`;
        const result = {
          mode: 'native_hls' as const,
          streamUrl: proxied,
          qualities: [{ label: '1080p (LULU)', url: proxied }],
          fallbackIframe: url,
        };
        setCachedStream(url, result);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch {}
  }

  // 4. Universal External Provider Direct Stream Extractor -> KoUp Native NetflixPlayer

  // 4a. Uqload (uqload.com / uqload.io / uqload.co / uqload.vc) -> Direct HLS (.m3u8) or 410 Dead Detection
  if (provider === 'uqload' || lowerUrl.includes('uqload.')) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://uqload.vc/',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json(
          { error: 'Uqload videosu bulunamadı (404)', isDead: true },
          { status: 410 }
        );
      }
      const html = await resp.text();
      if (
        html.length < 1500 ||
        html.includes('File is no longer available') ||
        html.includes('File was deleted') ||
        html.includes('File was locked') ||
        html.includes('Video not found')
      ) {
        return NextResponse.json(
          { error: 'Uqload videosu silinmiş veya süresi dolmuş', isDead: true },
          { status: 410 }
        );
      }

      // Unpack Dean Edwards packed JS if present
      let searchTarget = html;
      const packMatch = html.match(
        /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/
      );
      if (packMatch) {
        let p = packMatch[1];
        const a = parseInt(packMatch[2], 10);
        let c = parseInt(packMatch[3], 10);
        const k = packMatch[4].split('|');
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const toBase = (num: number, base: number) => {
          if (num === 0) return '0';
          let res = '';
          let n = num;
          while (n > 0) {
            res = chars[n % base] + res;
            n = Math.floor(n / base);
          }
          return res;
        };
        while (c--) {
          if (k[c]) {
            const token = toBase(c, a);
            p = p.replace(new RegExp(`\\b${token}\\b`, 'g'), k[c]);
          }
        }
        searchTarget += '\n' + p;
      }

      const finalOrigin = (() => {
        try {
          const u = new URL(resp.url || url);
          return `${u.protocol}//${u.host}/`;
        } catch {
          return 'https://uqload.vc/';
        }
      })();

      const m3u8Match = searchTarget.match(/https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*/i);
      if (m3u8Match?.[0]) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(m3u8Match[0])}&ref=${encodeURIComponent(finalOrigin)}`;
        const result = {
          mode: 'native_hls',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: resp.url || url,
        };
        setCachedStream(url, result);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      const mp4Match = searchTarget.match(/https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]*/i);
      if (mp4Match?.[0]) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(mp4Match[0])}&ref=${encodeURIComponent(finalOrigin)}`;
        const result = {
          mode: 'native_mp4',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: resp.url || url,
        };
        setCachedStream(url, result);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch {
      return NextResponse.json(
        { error: 'Uqload sunucusuna erişilemedi', isDead: true },
        { status: 410 }
      );
    }
  }

  // 4b. Vidmoly & MolyStream (vidmoly.biz / vidmoly.to / dbx.molystream.org) -> Direct HLS (.m3u8)
  if (
    provider.includes('vidmoly') ||
    provider.includes('moly') ||
    lowerUrl.includes('vidmoly') ||
    lowerUrl.includes('molystream')
  ) {
    try {
      const normalizedVidmoly = url
        .replace(/\/\/(?:www\.)?vidmoly\.(?:to|net|me)\//i, '//vidmoly.biz/')
        .replace(/\/\/(?:www\.)?vidmolynet\//i, '//vidmoly.biz/');
      const parsedVm = new URL(normalizedVidmoly);
      const vmRef = `${parsedVm.protocol}//${parsedVm.host}/`;

      const resp = await fetch(normalizedVidmoly, {
        headers: {
          'User-Agent': commonUA,
          Referer: vmRef,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json(
          { error: 'Vidmoly videosu bulunamadı (404)', isDead: true },
          { status: 410 }
        );
      }

      const html = await resp.text();
      const lowHtml = html.toLowerCase();
      if (
        lowHtml.includes('no video found') ||
        lowHtml.includes('this video not found') ||
        lowHtml.includes('file was deleted') ||
        lowHtml.includes('video not found') ||
        lowHtml.includes('deleted by owner') ||
        lowHtml.includes('file not found') ||
        lowHtml.includes('404 not found') ||
        html.includes('{"status":"error"}')
      ) {
        return NextResponse.json(
          { error: 'Vidmoly / Molystream videosu silinmiş veya bulunamadı (404 No Video Found)', isDead: true },
          { status: 410 }
        );
      }
        const m3u8Match =
          html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
          html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(m3u8Match[1])}&ref=${encodeURIComponent(vmRef)}`;
          const label = lowerUrl.includes('moly') ? '1080p HLS (MolyStream)' : '1080p HLS (Vidmoly)';

          // Extract WebVTT / SRT subtitles (Shortizle & DiziFon support)
          const subMatch =
            html.match(/https?:\/\/srt\.vidmoly\.[a-z]+\/srt\/[^"'\s]+\.vtt/i) ||
            html.match(/https?:\/\/[^"'\s]+\/(?:srt|subtitles?)\/[^"'\s]+\.(?:vtt|srt)/i);
          let vttUrl = subMatch?.[0] || null;
          if (!vttUrl) {
            const tracksBlock = html.match(/tracks\s*:\s*\[([\s\S]*?)\]/i);
            if (tracksBlock?.[1]) {
              const trackFileMatch = tracksBlock[1].match(
                /file\s*:\s*["'](https?:\/\/[^"']+\.(?:vtt|srt)[^"']*)["']/i
              );
              if (trackFileMatch?.[1]) vttUrl = trackFileMatch[1];
            }
          }

          let subtitles:
            | Array<{ label: string; lang: string; url: string; default?: boolean }>
            | undefined;
          if (vttUrl) {
            const proxiedSub = `/api/stream-proxy?url=${encodeURIComponent(vttUrl)}&ref=${encodeURIComponent(vmRef)}`;
            subtitles = [
              { label: 'Türkçe', lang: 'tr', url: proxiedSub, default: true },
            ];
          }

          const result = {
            mode: 'native_hls' as const,
            streamType: 'hls' as const,
            streamUrl: proxiedUrl,
            qualities: [{ label, url: proxiedUrl }],
            subtitles,
            fallbackIframe: normalizedVidmoly,
          };
          setCachedStream(url, result, 30 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }
    } catch {
      // fall through to iframe
    }
  }

  // 4c. OK.RU (ok.ru/videoembed/... or odnoklassniki) -> Direct Official Iframe
  // OKCDN binds media chunks to client IP (srcIp=...). Proxying via Vercel Lambdas causes IP mismatch (HTTP 400),
  // self-healing loops, OK.ru rate limits and long video freezes. Direct iframe connects the client's own IP
  // directly to OK.ru high-speed CDN without proxy latency or bandwidth bottlenecks.
  const lowerProv = (provider || '').toLowerCase();
  const isOkRu =
    lowerProv.includes('ok.ru') ||
    lowerProv.includes('odnoklassniki') ||
    lowerProv === 'ok' ||
    lowerUrl.includes('ok.ru') ||
    lowerUrl.includes('odnoklassniki');

  if (isOkRu) {
    try {
      const okIdMatch =
        url.match(/(?:videoembed|video)\/(\d+)/i) ||
        url.match(/\/(\d+)(?:\?|$)/);
      const okId = okIdMatch ? okIdMatch[1] : null;
      const targetEmbedUrl = okId
        ? `https://www.ok.ru/videoembed/${okId}`
        : url.startsWith('//')
        ? `https:${url}`
        : url;

      // Quick check if video still exists on OK.ru
      const checkResp = await fetch(targetEmbedUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://ok.ru/',
        },
        signal: AbortSignal.timeout(4500),
      });

      if (checkResp.status === 404 || checkResp.status === 410) {
        return NextResponse.json(
          { error: 'OK.ru videosu silinmiş veya bulunamadı (404)', isDead: true },
          { status: 410 }
        );
      }

      const result = {
        mode: 'iframe',
        streamUrl: targetEmbedUrl,
        iframeUrl: targetEmbedUrl,
        qualities: [{ label: '1080p', url: targetEmbedUrl }],
        fallbackIframe: targetEmbedUrl,
      };
      setCachedStream(url, result, 60 * 60 * 1000);
      return NextResponse.json(result, { headers: CACHE_HEADERS });
    } catch (okErr) {
      console.warn('OK.ru resolution error:', okErr);
      // Fallback: return direct iframe URL
      const okIdMatch =
        url.match(/(?:videoembed|video)\/(\d+)/i) ||
        url.match(/\/(\d+)(?:\?|$)/);
      const okId = okIdMatch ? okIdMatch[1] : null;
      const fallbackUrl = okId ? `https://www.ok.ru/videoembed/${okId}` : url;
      return NextResponse.json(
        {
          mode: 'iframe',
          streamUrl: fallbackUrl,
          iframeUrl: fallbackUrl,
          qualities: [{ label: '1080p', url: fallbackUrl }],
          fallbackIframe: fallbackUrl,
        },
        { headers: CACHE_HEADERS }
      );
    }
  }

  // 4d. Mail.ru (my.mail.ru/video/embed/... & videoapi.my.mail.ru/videos/embed/...) -> Direct MP4 qualities
  if (provider.includes('mail') || lowerUrl.includes('mail.ru')) {
    try {
      const normalizedMailUrl = url.startsWith('//') ? `https:${url}` : url;
      let metaApiUrl: string | null = null;

      // Case 1: Numeric ID e.g. https://my.mail.ru/video/embed/7395625562758185666
      const numMatch = normalizedMailUrl.match(/\/video\/embed\/(\d{10,})/);
      if (numMatch?.[1]) {
        metaApiUrl = `https://my.mail.ru/+/video/meta/${numMatch[1]}`;
      } else {
        // Case 2: Path-based e.g. /videos/embed/gmail.com/user/_myvideo/123.html or /user/video/embed/_myvideo/123
        const embedResp = await fetch(normalizedMailUrl, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://my.mail.ru/',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!embedResp.ok && (embedResp.status === 404 || embedResp.status === 410)) {
          return NextResponse.json(
            { error: 'Mail.ru videosu silinmiş (404)', isDead: true },
            { status: 410 }
          );
        }
        if (embedResp.ok) {
          const embedHtml = await embedResp.text();
          const metaMatch = embedHtml.match(/metadataUrl"\s*:\s*"([^"]+)"/);
          if (metaMatch?.[1]) {
            const rawMeta = metaMatch[1];
            metaApiUrl = rawMeta.startsWith('//')
              ? `https:${rawMeta}`
              : rawMeta.startsWith('/')
              ? `https://my.mail.ru${rawMeta}`
              : rawMeta;
          }
        }
      }

      if (metaApiUrl) {
        const metaResp = await fetch(metaApiUrl, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://my.mail.ru/',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!metaResp.ok && (metaResp.status === 404 || metaResp.status === 410)) {
          return NextResponse.json(
            { error: 'Mail.ru video metadatası bulunamadı (404)', isDead: true },
            { status: 410 }
          );
        }
        if (metaResp.ok) {
          const metaJson = await metaResp.json();
          const videos = metaJson?.videos;
          if (Array.isArray(videos) && videos.length > 0) {
            const sorted = [...videos]
              .filter((v: any) => v?.url)
              .sort((a: any, b: any) => {
                const qa = parseInt(String(a.key || '0').replace(/\D/g, ''), 10) || 0;
                const qb = parseInt(String(b.key || '0').replace(/\D/g, ''), 10) || 0;
                return qb - qa;
              });
            if (sorted.length > 0) {
              const qualities = sorted.map((v: any) => {
                const fullMp4Url = v.url.startsWith('//') ? `https:${v.url}` : v.url;
                const cleanKey = String(v.key || 'HD').replace(/p$/i, '') + 'p';
                return {
                  label: cleanKey,
                  url: fullMp4Url,
                  directUrl: fullMp4Url,
                };
              });
              const result = {
                mode: 'native_mp4',
                streamUrl: qualities[0].url,
                qualities,
                fallbackIframe: normalizedMailUrl,
              };
              setCachedStream(url, result, 8 * 60 * 1000);
              return NextResponse.json(result, { headers: CACHE_HEADERS });
            }
          }
          return NextResponse.json(
            { error: 'Mail.ru videosu yayından kaldırılmış', isDead: true },
            { status: 410 }
          );
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4d2. Mp4Upload (mp4upload.com/embed-...html) -> Direct 1080p MP4 Stream
  if (provider === 'mp4upload' || lowerUrl.includes('mp4upload.com')) {
    try {
      let embedUrl = url;
      if (!embedUrl.includes('/embed-') && embedUrl.includes('mp4upload.com/')) {
        const idMatch = embedUrl.match(/mp4upload\.com\/([a-zA-Z0-9]+)/);
        if (idMatch?.[1]) {
          embedUrl = `https://www.mp4upload.com/embed-${idMatch[1]}.html`;
        }
      }

      const resp = await fetch(embedUrl, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://www.mp4upload.com/',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json(
          { error: 'Mp4Upload videosu bulunamadı (404)', isDead: true },
          { status: 200 }
        );
      }

      const html = await resp.text();
      const lowHtml = html.toLowerCase();
      if (
        html.includes('document.FL.login') ||
        lowHtml.includes('file was deleted') ||
        lowHtml.includes('file not found') ||
        lowHtml.includes('video not found') ||
        lowHtml.includes('no video found') ||
        lowHtml.includes('file is no longer available') ||
        html.trim() === 'File was deleted'
      ) {
        return NextResponse.json(
          { error: 'Mp4Upload videosu silinmiş veya kaldırılmış', isDead: true },
          { status: 200 }
        );
      }

      const srcMatch =
        html.match(/player\.src\(\s*\{\s*type:\s*["'][^"']+["'],\s*src:\s*["']([^"']+\.mp4[^"']*)["']/i) ||
        html.match(/src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
        html.match(/["'](https?:\/\/[a-zA-Z0-9\.\-]+(?::\d+)?\/d\/[a-zA-Z0-9\/\-_]+\.mp4)["']/i);

      if (srcMatch?.[1]) {
        const directMp4 = srcMatch[1];
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(directMp4)}&ref=${encodeURIComponent('https://www.mp4upload.com/')}`;
        const result = {
          mode: 'native_mp4' as const,
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p MP4', url: proxiedUrl }],
          fallbackIframe: embedUrl,
        };
        setCachedStream(url, result);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }
    } catch (err: any) {
      console.warn('Mp4Upload extraction error:', err?.message || err);
    }
  }

  // 4e. DailyMotion (dailymotion.com/embed/video/... or dai.ly/...) -> Direct HLS
  if (provider.includes('dailymotion') || lowerUrl.includes('dailymotion.com') || lowerUrl.includes('dai.ly')) {
    try {
      const dmMatch = url.match(/\/video\/([a-zA-Z0-9]+)/) || url.match(/dai\.ly\/([a-zA-Z0-9]+)/);
      const dmId = dmMatch?.[1];
      if (dmId) {
        const dmResp = await fetch(`https://www.dailymotion.com/player/metadata/video/${dmId}`, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://www.dailymotion.com/',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (dmResp.ok) {
          const dmData = await dmResp.json();
          if (dmData?.error) {
            return NextResponse.json(
              { error: 'Dailymotion videosu silinmiş veya bulunamadı (404)', isDead: true },
              { status: 410 }
            );
          }
          const m3u8Url = dmData?.qualities?.auto?.[0]?.url;
          if (m3u8Url && typeof m3u8Url === 'string') {
            const proxiedHls = `/api/stream-proxy?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://www.dailymotion.com/')}`;
            const payload = {
              mode: 'native_hls' as const,
              streamUrl: proxiedHls,
              qualities: [{ label: '1080p HLS', url: proxiedHls }],
              fallbackIframe: url,
            };
            setCachedStream(url, payload, 2 * 60 * 60 * 1000);
            return NextResponse.json(payload, { headers: CACHE_HEADERS });
          }
        } else if (dmResp.status === 404 || dmResp.status === 410) {
          return NextResponse.json(
            { error: 'Dailymotion videosu bulunamadı (404)', isDead: true },
            { status: 410 }
          );
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4f. PixelDrain (pixeldrain.com/u/... or /api/file/...) -> Direct MP4
  if (provider.includes('pixeldrain') || lowerUrl.includes('pixeldrain.com')) {
    try {
      const pdMatch = url.match(/(?:u|file)\/([a-zA-Z0-9]+)/);
      const pdId = pdMatch?.[1];
      if (pdId) {
        const directMp4 = `https://pixeldrain.com/api/file/${pdId}`;
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(directMp4)}&ref=${encodeURIComponent('https://pixeldrain.com/')}`;
        return NextResponse.json(
          {
            mode: 'native_mp4',
            streamUrl: proxiedUrl,
            qualities: [{ label: '1080p', url: proxiedUrl }],
            fallbackIframe: url,
          },
          { headers: CACHE_HEADERS }
        );
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4g. VOE (voe.sx / derricknationtop.com etc.) -> Direct HLS / MP4 with mirror fallbacks & anti-rate-limit
  if (
    provider === 'voe' ||
    lowerUrl.includes('voe.sx') ||
    lowerUrl.includes('voe.') ||
    lowerUrl.includes('derricknationtop') ||
    lowerUrl.includes('tomeventtheymost') ||
    lowerUrl.includes('audaciousdefendercountryman')
  ) {
    try {
      const voeCodeMatch = url.match(/(?:\/e\/|\/)([a-zA-Z0-9]{8,})/);
      const voeCode = voeCodeMatch?.[1];

      // Prepare candidate URLs (original URL first, then mirrors to bypass Cloudflare/429 rate limits)
      const candidateUrls: string[] = [url];
      if (voeCode) {
        const mirrors = [
          `https://derricknationtop.com/e/${voeCode}`,
          `https://tomeventtheymost.com/e/${voeCode}`,
          `https://audaciousdefendercountryman.com/e/${voeCode}`,
        ];
        for (const m of mirrors) {
          if (!candidateUrls.includes(m)) candidateUrls.push(m);
        }
      }

      const voeHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      };

      let resolvedHls: string | null = null;
      let resolvedMp4: string | null = null;
      let targetOrigin = 'https://voe.sx/';
      let isExplicitlyDeleted = false;

      for (const candUrl of candidateUrls) {
        try {
          const resp = await fetch(candUrl, {
            headers: voeHeaders,
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
          });

          if (resp.status === 404 || resp.status === 410) {
            isExplicitlyDeleted = true;
            continue; // try next mirror or confirm dead
          }

          // If rate-limited (429) on this domain, immediately switch to next mirror
          if (resp.status === 429) {
            continue;
          }

          let pageHtml = await resp.text();

          // Handle VOE landing redirect script (e.g. window.location.href = 'https://derricknationtop.com/e/...')
          const redirMatch = pageHtml.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
          if (redirMatch?.[1]) {
            const nextUrl = redirMatch[1];
            try {
              const uObj = new URL(nextUrl);
              targetOrigin = `${uObj.protocol}//${uObj.host}/`;
            } catch {}

            const redirResp = await fetch(nextUrl, {
              headers: { ...voeHeaders, Referer: resp.url || candUrl },
              signal: AbortSignal.timeout(5000),
            });
            if (redirResp.status === 404 || redirResp.status === 410) {
              isExplicitlyDeleted = true;
              continue;
            }
            if (redirResp.status === 429) continue;
            pageHtml = await redirResp.text();
          }

          if (
            pageHtml.includes('File Not Found') ||
            pageHtml.includes('File was deleted') ||
            pageHtml.includes('Copyright Infringement') ||
            pageHtml.includes('Video not found')
          ) {
            isExplicitlyDeleted = true;
            continue;
          }

          // Look for obfuscated JSON string array e.g. <script type="application/json">["DROH#&nJjm..."]</script>
          const jsonScriptMatch =
            pageHtml.match(/<script[^>]*type=["']application\/json["'][^>]*>\s*(\["[^"]+"\])\s*<\/script>/i) ||
            pageHtml.match(/\[\s*["'][A-Za-z0-9#&~@%?*!^$+/=_-]{100,}["']\s*\]/);

          if (jsonScriptMatch) {
            const rawArrStr = jsonScriptMatch[1] || jsonScriptMatch[0];
            const arr = JSON.parse(rawArrStr);
            const raw = arr[0];

            // Step 1: ROT13
            let rot13 = '';
            for (let i = 0; i < raw.length; i++) {
              let c = raw.charCodeAt(i);
              if (c >= 65 && c <= 90) c = ((c - 65 + 13) % 26) + 65;
              else if (c >= 97 && c <= 122) c = ((c - 97 + 13) % 26) + 97;
              rot13 += String.fromCharCode(c);
            }

            // Step 2: Remove known delimiters
            const delims = ['@$', '^^', '~@', '%?', '*~', '!!', '#&', '@|'];
            let cleaned = rot13;
            for (const d of delims) {
              cleaned = cleaned.split(d).join('');
            }

            // Step 3: Base64 decode to binary string (using standard global atob)
            const b1 = atob(cleaned);

            // Step 4: Shift character codes by -3
            let shifted = '';
            for (let i = 0; i < b1.length; i++) {
              shifted += String.fromCharCode(b1.charCodeAt(i) - 3);
            }

            // Step 5: Reverse & Base64 decode
            const reversed = shifted.split('').reverse().join('');
            const finalJsonStr = atob(reversed);
            const data = JSON.parse(finalJsonStr);

            if (data?.source && typeof data.source === 'string') {
              resolvedHls = data.source;
            }
            if (data?.direct_access_url && typeof data.direct_access_url === 'string') {
              resolvedMp4 = data.direct_access_url;
            }

            if (resolvedHls || resolvedMp4) {
              break; // Success!
            }
          }
        } catch {
          // Try next mirror
          continue;
        }
      }

      if (resolvedHls) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(resolvedHls)}&ref=${encodeURIComponent(targetOrigin)}`;
        const result = {
          mode: 'native_hls',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: url,
        };
        // Cache result for 3 hours (HLS token is valid for 4 hours)
        setCachedStream(url, result, 3 * 3600 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      if (resolvedMp4) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(resolvedMp4)}&ref=${encodeURIComponent(targetOrigin)}`;
        const result = {
          mode: 'native_mp4',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: url,
        };
        setCachedStream(url, result, 3 * 3600 * 1000);
        return NextResponse.json(result, { headers: CACHE_HEADERS });
      }

      if (isExplicitlyDeleted) {
        return NextResponse.json(
          { error: 'VOE videosu telif sebebiyle silinmiş veya bulunamadı (404)', isDead: true },
          { status: 410 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'VOE sunucusuna erişilemedi veya video silinmiş', isDead: true },
        { status: 410 }
      );
    }
  }

  // 4h. VK (vk.com/video_ext.php?... or vk.com/video...) -> Direct HLS / MP4
  if (provider === 'vk' || lowerUrl.includes('vk.com/video')) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://vk.com/',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json(
          { error: 'VK videosu silinmiş (404)', isDead: true },
          { status: 410 }
        );
      }

      if (resp.ok) {
        const html = await resp.text();
        const unescaped = html.replace(/\\\//g, '/');

        // Check for deletion or private video
        if (
          html.includes('This video has been removed') ||
          html.includes('Video not found') ||
          html.includes('Видеозапись удалена') ||
          html.includes('Видео недоступно')
        ) {
          return NextResponse.json(
            { error: 'VK videosu kaldırılmış veya gizli', isDead: true },
            { status: 410 }
          );
        }

        // Direct HLS (.m3u8 via hls_ondemand, hls_live, hls, or generic m3u8 url)
        const hlsMatch =
          unescaped.match(/"(?:hls_ondemand|hls_live|hls)"\s*:\s*"([^"]+)"/) ||
          unescaped.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
        if (hlsMatch?.[1]) {
          const rawM3u8 = hlsMatch[1].replace(/\\\//g, '/');
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(rawM3u8)}&ref=${encodeURIComponent('https://vk.com/')}`;
          const result = {
            mode: 'native_hls',
            streamUrl: proxiedUrl,
            qualities: [{ label: '1080p', url: proxiedUrl }],
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }

        // Direct MP4 qualities
        const qualities: Array<{ label: string; url: string }> = [];
        for (const q of [1080, 720, 480, 360, 240]) {
          const m = unescaped.match(new RegExp(`"url${q}"\\s*:\\s*"([^"]+)"`));
          if (m?.[1]) {
            qualities.push({
              label: `${q}p`,
              url: `/api/stream-proxy?url=${encodeURIComponent(m[1].replace(/\\\//g, '/'))}&ref=${encodeURIComponent('https://vk.com/')}`,
            });
          }
        }

        if (qualities.length > 0) {
          const result = {
            mode: 'native_mp4',
            streamUrl: qualities[0].url,
            qualities,
            fallbackIframe: url,
          };
          setCachedStream(url, result, 8 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }

        // If neither HLS nor MP4 could be extracted, return clean iframe shell with VK embed
        const iframeResult = {
          mode: 'iframe',
          iframeUrl: url,
        };
        setCachedStream(url, iframeResult, 30 * 60 * 1000);
        return NextResponse.json(iframeResult, { headers: CACHE_HEADERS });
      }
    } catch {
      return NextResponse.json(
        { error: 'VK sunucusuna erişilemedi', isDead: true },
        { status: 410 }
      );
    }
  }

  // 4i. Streamwish / Vidhide / Streamruby / Yourupload / Mp4upload / Dzen / Vidguard generic stream extraction
  if (
    [
      'sendvid',
      'yourupload',
      'mp4upload',
      'filemoon',
      'streamwish',
      'strw',
      'awish',
      'ghbrisk',
      'vidhide',
      'dhtpre',
      'streamruby',
      'vidguard',
      'vidspeed',
      'streamtape',
      'dzen',
    ].some((p) => provider.includes(p) || lowerUrl.includes(p))
  ) {
    try {
      const parsedU = new URL(url);
      const refOrigin = `${parsedU.protocol}//${parsedU.host}/`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: refOrigin,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const rawHtml = await resp.text();
        const html = rawHtml.includes('eval(function') ? unpackDeanEdwards(rawHtml) : rawHtml;
        const m3u8Match =
          html.match(/(?:file|source|hls|video_source)\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
          html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
          html.match(/https?:\/\/[^\s"'<>]+\.okcdn\.ru\/video\.m3u8[^\s"'<>]*/);
        if (m3u8Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(m3u8Match[1])}&ref=${encodeURIComponent(refOrigin)}`;
          return NextResponse.json(
            {
              mode: 'native_hls',
              streamUrl: proxiedUrl,
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: url,
            },
            { headers: CACHE_HEADERS }
          );
        }

        const mp4Match =
          html.match(/(?:file|source|src|video_source)\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
          html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
        if (mp4Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(mp4Match[1])}&ref=${encodeURIComponent(refOrigin)}`;
          return NextResponse.json(
            {
              mode: 'native_mp4',
              streamUrl: proxiedUrl,
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: url,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4j. Dizipal / DPlayer Resolver (sn.dplayer82.site, etc.)
  if (provider === 'dizipal' || lowerUrl.includes('dplayer') || lowerUrl.includes('source2.php')) {
    try {
      if (lowerUrl.includes('.m3u8')) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://sn.dplayer82.site/')}`;
        return NextResponse.json(
          {
            mode: 'native_hls',
            streamUrl: proxiedUrl,
            qualities: [{ label: '1080p', url: proxiedUrl }],
            fallbackIframe: url,
          },
          { headers: CACHE_HEADERS }
        );
      }

      const dplayerResp = await fetch(url, {
        headers: { 'User-Agent': commonUA, Referer: 'https://dizipal1592.com/' },
        signal: AbortSignal.timeout(6000),
      });
      if (dplayerResp.ok) {
        const dplayerHtml = await dplayerResp.text();
        const openMatch = dplayerHtml.match(/openPlayer\(['"]([^'"]+)['"]/);
        if (openMatch?.[1]) {
          const playlistArg = openMatch[1];
          const baseMatch = url.match(/^(https?:\/\/[^/]+)/);
          const dplayerHost = baseMatch ? baseMatch[1] : 'https://sn.dplayer82.site';
          const s2Resp = await fetch(`${dplayerHost}/source2.php?v=${playlistArg}`, {
            headers: {
              'User-Agent': commonUA,
              Referer: url,
              'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (s2Resp.ok) {
            const s2Data = await s2Resp.json();
            const playlist = s2Data?.playlist || [];
            if (playlist[0]?.sources?.[0]?.file) {
              const rawFile = playlist[0].sources[0].file;
              const masterHls = rawFile.replace('m.php', 'master.m3u8');
              const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(masterHls)}&ref=${encodeURIComponent(`${dplayerHost}/`)}`;
              return NextResponse.json(
                {
                  mode: 'native_hls',
                  streamUrl: proxiedUrl,
                  qualities: [{ label: '1080p', url: proxiedUrl }],
                  fallbackIframe: url,
                },
                { headers: CACHE_HEADERS }
              );
            }
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  // 4k. AnimeLVL Stream Proxy (/api/stream.mp4 or /api/stream.m3u8)
  if (provider === 'animelvl' || lowerUrl.includes('animelvl.com/api/stream')) {
    const isHls = lowerUrl.includes('.m3u8');
    const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://animelvl.com/')}`;
    return NextResponse.json(
      {
        mode: isHls ? 'native_hls' : 'native_mp4',
        streamUrl: proxiedUrl,
        qualities: [{ label: '1080p', url: proxiedUrl }],
        fallbackIframe: url,
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 4l. Anizm Player Resolver (anizm.net/player/{id})
  if (provider === 'anizm' || lowerUrl.includes('anizm.net/player/')) {
    try {
      const anizmResp = await fetch(url, {
        headers: { 'User-Agent': commonUA, Referer: 'https://anizm.net/' },
        signal: AbortSignal.timeout(6000),
      });
      if (anizmResp.ok) {
        const aHtml = await anizmResp.text();
        const mIfr = aHtml.match(/<iframe[^\>]+src=["']([^"']+)["']/i);
        if (mIfr?.[1]) {
          let nestedUrl = mIfr[1];
          if (nestedUrl.startsWith('//')) nestedUrl = 'https:' + nestedUrl;
          else if (!nestedUrl.startsWith('http')) nestedUrl = `https://anizm.net${nestedUrl}`;

          // If nested is OK.ru / Odnoklassniki or VK, delegate to iframe shell
          return NextResponse.json(
            {
              mode: 'iframe',
              iframeUrl: nestedUrl,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch {
      // Fall through
    }
    return NextResponse.json(
      {
        mode: 'iframe',
        iframeUrl: url,
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 4m. FullHDFilmizlesene / Turbo.imgz.me / Rapidvid HLS Resolver
  if (
    provider === 'fullhdfilmizlesene' ||
    provider === 'rapidvid' ||
    lowerUrl.includes('turbo.imgz.me') ||
    lowerUrl.includes('rapidvid') ||
    lowerUrl.includes('cdnimage')
  ) {
    try {
      if (lowerUrl.includes('cdnimage') && (lowerUrl.includes('/m0/') || lowerUrl.includes('/m1/') || lowerUrl.includes('.m3u8'))) {
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://rapidvid.net/')}`;
        return NextResponse.json(
          {
            mode: 'native_hls',
            streamUrl: proxiedUrl,
            directUrl: url,
            qualities: [{ label: '1080p (RapidVid HD)', url: proxiedUrl }],
            fallbackIframe: null,
          },
          { headers: CACHE_HEADERS }
        );
      }

      const parsedU = new URL(url);
      const refOrigin = `${parsedU.protocol}//${parsedU.host}/`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': commonUA, Referer: 'https://rapidvid.net/' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const rawHtml = await resp.text();
        const html = rawHtml.includes('eval(function') ? unpackDeanEdwards(rawHtml) : rawHtml;

        // 1. Check for av('...') or _('...') obfuscated stream URL (Reverse + Shift decode)
        const avMatch =
          html.match(/jwSetup\.sources\s*=\s*\[\s*\{\s*["']file["']\s*:\s*(?:av|_)\s*\(\s*['"]([A-Za-z0-9+/=]{20,})['"]\s*\)/) ||
          html.match(/(?:av|_)\s*\(\s*['"]([A-Za-z0-9+/=]{20,})['"]\s*\)/);

        let hlsUrl: string | null = null;
        if (avMatch?.[1]) {
          hlsUrl = decodeRapidvid(avMatch[1]);
        }

        // 2. Fallback to atomCodecTelemetry
        if (!hlsUrl) {
          const mTele = html.match(/"h264"\s*:\s*"([^"]+)"/);
          if (mTele?.[1]) {
            hlsUrl = mTele[1].replace(/\\\//g, '/');
          }
        }

        // 3. Fallback to direct m3u8 in html
        if (!hlsUrl) {
          const m3u8Match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
          if (m3u8Match?.[1]) hlsUrl = m3u8Match[1];
        }

        // Parse subtitles from jwSetup.tracks
        let subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
        const tracksMatch = html.match(/jwSetup\.tracks\s*=\s*(\[[^\]]+\])/);
        if (tracksMatch?.[1]) {
          try {
            const rawTracks = JSON.parse(tracksMatch[1].replace(/\\\//g, '/'));
            subtitles = rawTracks
              .filter((t: any) => t?.file)
              .map((t: any) => {
                const subUrl = t.file.startsWith('http') ? t.file : `https://rapidvid.net${t.file.startsWith('/') ? '' : '/'}${t.file}`;
                return {
                  label: t.label || 'Altyazı',
                  lang: (t.label || '').toLowerCase().includes('türk') ? 'tr' : 'en',
                  url: `/api/stream-proxy?url=${encodeURIComponent(subUrl)}&ref=${encodeURIComponent('https://rapidvid.net/')}`,
                  default: (t.label || '').toLowerCase().includes('türk'),
                };
              });
          } catch {}
        }

        if (hlsUrl) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(hlsUrl)}&ref=${encodeURIComponent('https://rapidvid.net/')}`;
          const result = {
            mode: 'native_hls' as const,
            streamType: 'hls' as const,
            streamUrl: proxiedUrl,
            directUrl: hlsUrl,
            qualities: [{ label: '1080p (RapidVid HD)', url: proxiedUrl }],
            subtitles: subtitles.length > 0 ? subtitles : undefined,
            fallbackIframe: null,
          };
          setCachedStream(url, result, 30 * 60 * 1000);
          return NextResponse.json(result, { headers: CACHE_HEADERS });
        }

        const mp4Match = html.match(/(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/i);
        if (mp4Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(mp4Match[1])}&ref=${encodeURIComponent(refOrigin)}`;
          return NextResponse.json(
            {
              mode: 'native_mp4',
              streamUrl: proxiedUrl,
              directUrl: mp4Match[1],
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: null,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch {
      // Fall through
    }
    return NextResponse.json(
      { error: 'RapidVid video akışı çözümlenemedi veya silinmiş', isDead: true },
      { status: 410, headers: CACHE_HEADERS }
    );
  }

  // 4n. Direct Media URL Fallback (.m3u8 or .mp4)
  if (lowerUrl.includes('.m3u8')) {
    try {
      const parsedU = new URL(url);
      const refOrigin = `${parsedU.protocol}//${parsedU.host}/`;
      const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(refOrigin)}`;
      return NextResponse.json(
        {
          mode: 'native_hls',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: url,
        },
        { headers: CACHE_HEADERS }
      );
    } catch {
      // Fall through
    }
  }

  if (lowerUrl.includes('.mp4')) {
    try {
      const parsedU = new URL(url);
      const refOrigin = `${parsedU.protocol}//${parsedU.host}/`;
      const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(refOrigin)}`;
      return NextResponse.json(
        {
          mode: 'native_mp4',
          streamUrl: proxiedUrl,
          qualities: [{ label: '1080p', url: proxiedUrl }],
          fallbackIframe: url,
        },
        { headers: CACHE_HEADERS }
      );
    } catch {
      // Fall through
    }
  }

  // 5. If the host is known to forbid framing (e.g. X-Frame-Options SAMEORIGIN / DENY), mark as dead rather than returning a blocked iframe
  const lowUrlCheck = url.toLowerCase();
  if (
    lowUrlCheck.includes('hdfilmcehennemi') ||
    lowUrlCheck.includes('/rplayer/') ||
    lowUrlCheck.includes('rapidrame') ||
    lowUrlCheck.includes('pichive') ||
    lowUrlCheck.includes('hotlinger') ||
    lowUrlCheck.includes('asyawatch') ||
    lowUrlCheck.includes('dizilla') ||
    lowUrlCheck.includes('azelvid') ||
    lowUrlCheck.includes('playerdkorea') ||
    lowUrlCheck.includes('ddizi.tel') ||
    lowUrlCheck.includes('storage.diziyou.one') ||
    lowUrlCheck.includes('dystream') ||
    lowUrlCheck.includes('vmpx.online') ||
    lowUrlCheck.includes('acek-cdn') ||
    lowUrlCheck.includes('owphbf24') ||
    lowUrlCheck.includes('sprintcdn') ||
    lowUrlCheck.includes('fastsupplyhub') ||
    lowUrlCheck.includes('smartcheckout') ||
    lowUrlCheck.includes('videopixelvanto') ||
    lowUrlCheck.includes('pilavyer') ||
    lowUrlCheck.includes('pilavyerplay') ||
    lowUrlCheck.includes('dtpasn') ||
    lowUrlCheck.includes('wdt') ||
    lowUrlCheck.includes('dizipal') ||
    lowUrlCheck.includes('sezonlukdizi') ||
    lowUrlCheck.includes('rapidvid') ||
    lowUrlCheck.includes('cdnimage') ||
    lowUrlCheck.includes('shortizle') ||
    lowUrlCheck.includes('dramavadisi') ||
    lowUrlCheck.includes('dramabox') ||
    lowUrlCheck.includes('diziizle')
  ) {
    return NextResponse.json(
      {
        isDead: true,
        error: 'Kaynak doğrudan çözülemedi ve yayıncı harici iframe bağlantısını reddediyor.',
      },
      { status: 410, headers: CACHE_HEADERS }
    );
  }

  // 6. Default to clean iframe shell
  return NextResponse.json(
    {
      mode: 'iframe',
      iframeUrl: url,
    },
    { headers: CACHE_HEADERS }
  );
}
