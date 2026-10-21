/**
 * Sanitizes fansub and source names by stripping discord links, invite URLs,
 * website domains, social media handles, and advertisement noise.
 */
export function cleanFansubName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const sLow = s.toLowerCase();

  // Known community/fansub discord links mapping
  if (
    sLow.includes('discord.gg/somesub') ||
    sLow.includes('discord.com/invite/somesub') ||
    sLow.includes('somesub')
  ) {
    return 'SomeSub';
  }
  if (sLow.includes('discord.gg/culturesubs') || sLow.includes('culturesubs')) {
    return 'CultureSubs';
  }
  if (sLow.includes('discord.gg/leefansub') || sLow.includes('leefansub')) {
    return 'LeeFansub';
  }

  // 1. Remove URLs with http / https
  s = s.replace(/https?:\/\/[^\s|]+/gi, '');

  // 2. Remove discord links and invite URLs
  s = s.replace(
    /(?:https?:\/\/)?(?:www\.)?discord(?:app\.com\/invite|\.gg|\.com\/invite|\.com|\.me|\.io)\/[^\s|]+/gi,
    ''
  );
  s = s.replace(/\bdiscord\.gg\/[^\s|]+/gi, '');
  s = s.replace(/\bdiscord(?:\.gg)?\b/gi, '');

  // 3. Remove social media links
  s = s.replace(
    /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|facebook\.com|fb\.com|twitter\.com|t\.me|tiktok\.com|youtube\.com)\/[^\s|]+/gi,
    ''
  );
  s = s.replace(/\b(?:instagram|facebook|twitter|telegram|tiktok|youtube)\.com\/[^\s|]+/gi, '');

  // 4. Remove www.* links
  s = s.replace(/\bwww\.[^\s|]*/gi, '');

  // 5. Remove dangling http/https protocol tokens
  s = s.replace(/\bhttps?[:/]*/gi, '');

  // 6. Remove standalone website domains
  s = s.replace(
    /\b[a-zA-Z0-9\-_.]+\.(?:blogspot\.com(?:\.tr)?|com\.tr|net\.tr|org\.tr|com|org|net|tv|xyz|io|me|info|cc)\b[^\s|]*/gi,
    ''
  );

  // 7. Remove social handles like @codeanimee or codeanimee
  s = s.replace(/@\w+/g, '');
  s = s.replace(/\bcodeanimee\b/gi, '');

  // 8. Remove ad phrases
  s = s.replace(/(?:destek|bağış|katılmak|yardım|iletişim)\s+olmak\s+için\s*:\s*/gi, '');
  s = s.replace(/(?:destek|bağış|katılmak|yardım|iletişim)\s+için\s*:\s*/gi, '');
  s = s.replace(/(?:discord\s+sunucumuz|discord\s+adresimiz|discord\s+adresi|dc\s+adresi)\s*:\s*/gi, '');
  s = s.replace(/\b(?:discord|instagram|facebook|twitter|telegram)\b/gi, '');
  s = s.replace(/\bdc\s*:\s*[^\s|]+/gi, '');

  // 8. Clean role prefixes if they leave a name
  s = s.replace(
    /^(?:çeviri|çevirmen|encoder|kodlayıcı|redaksiyon|redaktör|redakte|uploader|upload)\s*:\s*/gi,
    ''
  );
  s = s.replace(
    /\s*[|\-/•]\s*(?:çeviri|çevirmen|encoder|kodlayıcı|redaksiyon|redaktör|redakte|uploader|upload)\s*:\s*/gi,
    ' - '
  );

  // 9. Clean delimiters
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[\s|\-/•:;,~_]+|[\s|\-/•:;,~_]+$/g, '');
  s = s.replace(/\s*[|\-/•]\s*([|\-/•]\s*)+/g, ' - ');
  s = s.replace(/^[\s|\-/•:;,~_]+|[\s|\-/•:;,~_]+$/g, '');
  s = s.trim();

  // 10. Exclude internal tags
  const low = s.toLowerCase();
  if (
    [
      'asyawatch',
      'dizilla',
      'webdrama',
      'koup',
      'varsayılan',
      'varsayilan',
      'orijinal',
      'default',
    ].includes(low)
  ) {
    return null;
  }

  // 11. Must contain at least one letter
  if (!s || !/[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(s)) {
    return null;
  }

  return s;
}

export function cleanSourceName(raw: string | null | undefined): string {
  if (!raw) return 'Kaynak';
  let s = String(raw).trim();
  if (!s) return 'Kaynak';

  s = s.replace(/https?:\/\/\S+/gi, '');
  s = s.replace(/(?:www\.)?discord(?:\.gg|app\.com|\.com|\.me)\/[^\s|]+/gi, '');
  s = s.replace(/\bwww\.[a-zA-Z0-9\-_.]+\.[a-zA-Z]{2,}[^\s|]*/gi, '');
  // Remove quality tags like (1080p), (720p), (HD), (FHD), 1080p, HD etc.
  s = s.replace(/\s*\(\s*\d+p\s*\)/gi, '');
  s = s.replace(/\s*\(\s*(?:HD|FHD|UHD|4K|HQ)\s*\)/gi, '');
  s = s.replace(/\b\d+p\b/gi, '');
  s = s.replace(/\b(?:FHD|UHD|4K|HQ)\b/gi, '');
  s = s.replace(/\bHD\b/gi, '');

  // Strip fansub/translator trailers while preserving Turkish translation types like (Altyazılı), (Dublaj), Dual, Türkçe
  s = s.replace(/\s*[·•|\-]\s*(?:çeviri|çevirmen|encoder|uploader)[\w\s]*$/gi, '');
  s = s.replace(/\s*\(?(?:çeviri|çevirmen|encoder|uploader):[^\)]+\)?/gi, '');
  s = s.replace(/\s*[·•|\-]\s*(?!(?:altyaz[ıi]|dublaj|türkçe|dual|orijinal)\b)[a-zA-Z0-9ğüşıöçĞÜŞİÖÇ_]+$/i, '');

  s = s.replace(/\s+/g, ' ').trim();

  return s || 'Kaynak';
}
