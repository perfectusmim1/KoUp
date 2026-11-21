import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase, checkAdminRateLimit } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const ALLOWED_PERSON_TYPES = new Set(['actor', 'character', 'seiyuu', 'director']);
const MAX_BIO_CACHE_ENTRIES = 500;
const BIO_CACHE_TTL_MS = 6 * 60 * 60_000;
const PERSON_WRITE_COOLDOWN_MS = 15 * 60_000;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown-ip'
  );
}

// Country normalization map for places of birth
const COUNTRY_NORM: Record<string, { code: string; name: string }> = {
  korea: { code: 'KR', name: 'Güney Kore' },
  'south korea': { code: 'KR', name: 'Güney Kore' },
  seoul: { code: 'KR', name: 'Güney Kore' },
  busan: { code: 'KR', name: 'Güney Kore' },
  incheon: { code: 'KR', name: 'Güney Kore' },
  japan: { code: 'JP', name: 'Japonya' },
  tokyo: { code: 'JP', name: 'Japonya' },
  osaka: { code: 'JP', name: 'Japonya' },
  kyoto: { code: 'JP', name: 'Japonya' },
  china: { code: 'CN', name: 'Çin' },
  sichuan: { code: 'CN', name: 'Çin' },
  chongqing: { code: 'CN', name: 'Çin' },
  beijing: { code: 'CN', name: 'Çin' },
  shanghai: { code: 'CN', name: 'Çin' },
  guangdong: { code: 'CN', name: 'Çin' },
  zhejiang: { code: 'CN', name: 'Çin' },
  hunan: { code: 'CN', name: 'Çin' },
  hubei: { code: 'CN', name: 'Çin' },
  shandong: { code: 'CN', name: 'Çin' },
  henan: { code: 'CN', name: 'Çin' },
  hebei: { code: 'CN', name: 'Çin' },
  wuhan: { code: 'CN', name: 'Çin' },
  chengdu: { code: 'CN', name: 'Çin' },
  guangzhou: { code: 'CN', name: 'Çin' },
  shenzhen: { code: 'CN', name: 'Çin' },
  dongguan: { code: 'CN', name: 'Çin' },
  harbin: { code: 'CN', name: 'Çin' },
  taiwan: { code: 'TW', name: 'Tayvan' },
  taipei: { code: 'TW', name: 'Tayvan' },
  thailand: { code: 'TH', name: 'Tayland' },
  bangkok: { code: 'TH', name: 'Tayland' },
  turkey: { code: 'TR', name: 'Türkiye' },
  türkiye: { code: 'TR', name: 'Türkiye' },
  istanbul: { code: 'TR', name: 'Türkiye' },
  'united states': { code: 'US', name: 'Amerika Birleşik Devletleri' },
  usa: { code: 'US', name: 'Amerika Birleşik Devletleri' },
  uk: { code: 'GB', name: 'Birleşik Krallık' },
  'united kingdom': { code: 'GB', name: 'Birleşik Krallık' },
  england: { code: 'GB', name: 'Birleşik Krallık' },
  london: { code: 'GB', name: 'Birleşik Krallık' },
  germany: { code: 'DE', name: 'Almanya' },
  france: { code: 'FR', name: 'Fransa' },
  spain: { code: 'ES', name: 'İspanya' },
  italy: { code: 'IT', name: 'İtalya' },
  philippines: { code: 'PH', name: 'Filipinler' },
  india: { code: 'IN', name: 'Hindistan' },
  hongkong: { code: 'HK', name: 'Hong Kong' },
  'hong kong': { code: 'HK', name: 'Hong Kong' },
};

function normalizePlaceOfBirth(rawPlace?: string | null): { place: string; countryCode: string | null } {
  if (!rawPlace) return { place: '', countryCode: null };
  const trimmed = rawPlace.trim();
  const lower = trimmed.toLowerCase();
  for (const [key, val] of Object.entries(COUNTRY_NORM)) {
    if (lower.includes(key)) {
      const parts = trimmed.split(',').map((p) => p.trim());
      // replace English country name with Turkish
      const translatedParts = parts.map((part) =>
        part.toLowerCase() === key || part.toLowerCase().includes(key) ? val.name : part
      );
      return { place: translatedParts.join(', '), countryCode: val.code };
    }
  }
  return { place: trimmed, countryCode: null };
}

// Helper to translate English text to Turkish using Google GTX API
async function translateToTurkish(text: string): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;
  try {
    const chunk = text.slice(0, 1800);
    const transUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(
      chunk
    )}`;
    const res = await fetch(transUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const raw = await res.json();
      if (Array.isArray(raw) && Array.isArray(raw[0])) {
        const translated = raw[0].map((part: any) => part?.[0] || '').join('');
        if (translated && translated.trim().length > 10) {
          return translated.trim();
        }
      }
    }
  } catch (err) {
    console.warn('Translate error:', err);
  }
  return null;
}

// Strip markdown / HTML spoilertags often found in AniList bios
function cleanAniListBio(desc: string): string {
  if (!desc) return '';
  return desc
    .replace(/~!(.*?)!~/gs, '') // Remove spoiler blocks
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/__([^_]+)__/g, '$1') // Remove markdown bold
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert markdown links
    .replace(/\s+/g, ' ')
    .trim();
}

const inMemoryBioCache = new Map<string, { payload: any; ts: number }>();
const personWriteCooldownMap = new Map<number, number>();

function isPersonWriteOnCooldown(personId: number): boolean {
  const last = personWriteCooldownMap.get(personId);
  return Boolean(last && Date.now() - last < PERSON_WRITE_COOLDOWN_MS);
}

function recordPersonWriteCooldown(personId: number): void {
  if (personWriteCooldownMap.size >= MAX_BIO_CACHE_ENTRIES) {
    const oldest = personWriteCooldownMap.keys().next().value;
    if (oldest !== undefined) personWriteCooldownMap.delete(oldest);
  }
  personWriteCooldownMap.set(personId, Date.now());
}

function setBioCache(key: string, payload: any): void {
  if (inMemoryBioCache.size >= MAX_BIO_CACHE_ENTRIES) {
    const oldest = inMemoryBioCache.keys().next().value;
    if (oldest !== undefined) inMemoryBioCache.delete(oldest);
  }
  inMemoryBioCache.set(key, { payload, ts: Date.now() });
}

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = checkAdminRateLimit(`person-bio:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: `Çok fazla biyografi isteği. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get('id') || searchParams.get('personId');
    const name = searchParams.get('name');
    const rawType = searchParams.get('type');
    const personType = rawType ? rawType.trim() : 'actor';
    const rawTmdbId = searchParams.get('tmdbId');

    if (!ALLOWED_PERSON_TYPES.has(personType)) {
      return NextResponse.json({ success: false, error: 'Geçersiz kişi türü' }, { status: 400 });
    }

    if (!name || name.trim().length < 2 || name.trim().length > 120) {
      return NextResponse.json({ success: false, error: 'Geçerli isim gerekli (2-120 karakter)' }, { status: 400 });
    }

    let cleanId: number | null = null;
    if (idRaw !== null && idRaw !== '') {
      const parsedId = Number(idRaw);
      if (!Number.isInteger(parsedId) || parsedId <= 0 || parsedId > 10_000_000) {
        return NextResponse.json({ success: false, error: 'Geçersiz id parametresi' }, { status: 400 });
      }
      cleanId = parsedId;
    }

    let paramTmdbId: number | null = null;
    if (rawTmdbId !== null && rawTmdbId !== '') {
      const parsedTmdb = Number(rawTmdbId);
      if (!Number.isInteger(parsedTmdb) || parsedTmdb <= 0 || parsedTmdb > 99_999_999) {
        return NextResponse.json({ success: false, error: 'Geçersiz tmdbId parametresi' }, { status: 400 });
      }
      paramTmdbId = parsedTmdb;
    }

    const cleanName = name.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanName.length < 2) {
      return NextResponse.json({ success: false, error: 'İsim gerekli' }, { status: 400 });
    }

    const cacheKey = `${cleanId || ''}_${personType}_${cleanName.toLowerCase()}`;
    const db = getServiceSupabase();

    // Fast in-memory hit (bounded & TTL-checked)
    const cachedEntry = inMemoryBioCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.ts < BIO_CACHE_TTL_MS) {
      return NextResponse.json(cachedEntry.payload, {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
      });
    }

    // 1. Check if DB already has full customized info
    let dbPerson: any = null;
    if (cleanId) {
      const { data } = await db
        .from('people')
        .select('*')
        .eq('id', cleanId)
        .maybeSingle();
      dbPerson = data;

      if (
        dbPerson?.bio_tr &&
        dbPerson.bio_tr.trim().length > 40 &&
        !dbPerson.bio_tr.includes('KoUp arşivinde') &&
        !dbPerson.bio_tr.includes('önde gelen oyuncularından biridir') &&
        (dbPerson.birth_date || dbPerson.gender || dbPerson.place_of_birth)
      ) {
        const payload = {
          success: true,
          source: 'cache_db',
          person: {
            id: dbPerson.id,
            name: dbPerson.name,
            native_name: dbPerson.native_name,
            gender: dbPerson.gender,
            birth_date: dbPerson.birth_date,
            death_date: dbPerson.death_date,
            place_of_birth: dbPerson.place_of_birth,
            country_code: dbPerson.country_code,
            also_known_as: dbPerson.also_known_as,
            blood_type: dbPerson.blood_type,
            height: dbPerson.height,
            bio_tr: dbPerson.bio_tr,
          },
          bio_tr: dbPerson.bio_tr,
        };
        setBioCache(cacheKey, payload);
        return NextResponse.json(payload, {
          headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
        });
      }
    }

    let englishBio: string | null = null;
    let turkishBio: string | null = null;
    let genderStr: string | null = dbPerson?.gender || null;
    let birthDate: string | null = dbPerson?.birth_date || null;
    let deathDate: string | null = dbPerson?.death_date || null;
    let placeOfBirth: string | null = dbPerson?.place_of_birth || null;
    let nativeName: string | null = dbPerson?.native_name || null;
    let countryCode: string | null = dbPerson?.country_code || null;
    let alsoKnownAs: string[] = dbPerson?.also_known_as || [];
    let bloodType: string | null = dbPerson?.blood_type || null;
    let height: string | null = dbPerson?.height || null;
    let race: string | null = dbPerson?.race || null;
    let tmdbId: number | null = paramTmdbId || dbPerson?.tmdb_id || null;
    let anilistId: number | null = dbPerson?.anilist_id || null;

    // 2. If Character or Anime, search AniList first
    if (personType === 'character') {
      try {
        const anilistQuery = `
          query ($search: String, $id: Int) {
            Character(search: $search, id: $id) {
              id
              name { full native alternative alternativeSpoiler }
              gender
              dateOfBirth { year month day }
              bloodType
              age
              description
            }
          }
        `;
        const aRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
          body: JSON.stringify({
            query: anilistQuery,
            variables: anilistId ? { id: anilistId } : { search: cleanName },
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (aRes.ok) {
          const aData = await aRes.json();
          const char = aData?.data?.Character;
          if (char) {
            anilistId = char.id;
            const rawDesc = char.description || '';

            // Extract structured attributes before stripping
            const mRace = rawDesc.match(/(?:__|[*]{1,2})?Race:(?:__|[*]{1,2})?\s*(?:~!)?(.*?)(?:!~)?(?:\n|$)/i);
            if (mRace && mRace[1]) {
              const rVal = mRace[1].replace(/[~!_*]/g, '').trim();
              if (rVal) race = rVal;
            }

            const mHeight = rawDesc.match(/(?:__|[*]{1,2})?Height:(?:__|[*]{1,2})?\s*(.*?)(?:\n|$)/i);
            if (mHeight && mHeight[1]) {
              const hVal = mHeight[1].replace(/[~!_*]/g, '').trim();
              if (hVal) height = hVal;
            }

            const mBirth = rawDesc.match(/(?:__|[*]{1,2})?Birth Year:(?:__|[*]{1,2})?\s*(.*?)(?:\n|$)/i);
            if (mBirth && mBirth[1]) {
              const bVal = mBirth[1].replace(/[~!_*]/g, '').trim();
              if (bVal && !birthDate) birthDate = bVal;
            }

            // Strip top key-values from description so narrative text starts cleanly
            const cleanDesc = rawDesc.replace(/^(?:(?:__|[*]{1,2})?(?:Race|Height|Weight|Birth Year|Age|Gender|Blood Type|Affiliation):(.*?)(?:\n|$)\s*)+/gi, '').trim();

            if (cleanDesc) englishBio = cleanAniListBio(cleanDesc);

            if (char.gender) {
              const g = char.gender.toLowerCase();
              genderStr = g.includes('female') ? 'Kadın' : g.includes('male') ? 'Erkek' : char.gender;
            }
            if (char.name?.native && !nativeName) nativeName = char.name.native;

            const allAlt = [
              ...(Array.isArray(char.name?.alternative) ? char.name.alternative : []),
              ...(Array.isArray(char.name?.alternativeSpoiler) ? char.name.alternativeSpoiler : []),
            ].filter(Boolean);
            if (allAlt.length > 0) {
              alsoKnownAs = Array.from(new Set([...alsoKnownAs, ...allAlt])).slice(0, 12);
            }

            if (char.bloodType) bloodType = char.bloodType;
            if (char.dateOfBirth?.year && char.dateOfBirth?.month && char.dateOfBirth?.day) {
              const y = String(char.dateOfBirth.year);
              const m = String(char.dateOfBirth.month).padStart(2, '0');
              const d = String(char.dateOfBirth.day).padStart(2, '0');
              birthDate = `${y}-${m}-${d}`;
            } else if (char.age && !birthDate) {
              birthDate = `${char.age} Yaşında`;
            }
          }
        }
      } catch (err) {
        console.warn('AniList character bio error:', err);
      }
    }

    // 3. Search TMDB Person API
    if (TMDB_API_KEY && (!turkishBio || !genderStr || !birthDate || !placeOfBirth)) {
      try {
        const searchUrl = `https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
          cleanName
        )}&language=tr-TR`;
        const tmdbSearch = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000),
        });

        if (tmdbSearch.ok) {
          const sData = await tmdbSearch.json();
          const sorted = (sData?.results || []).sort((a: any, b: any) => (b.popularity || 0) - (a.popularity || 0));
          const firstPerson = sorted[0];
          const resolvedTmdbId = Number(firstPerson?.id);
          if (Number.isInteger(resolvedTmdbId) && resolvedTmdbId > 0) {
            tmdbId = resolvedTmdbId;

            // Fetch details in TR and EN
            const [trRes, enRes] = await Promise.all([
              fetch(
                `https://api.themoviedb.org/3/person/${tmdbId}?api_key=${TMDB_API_KEY}&language=tr-TR`,
                { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
              ).catch(() => null),
              fetch(
                `https://api.themoviedb.org/3/person/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`,
                { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
              ).catch(() => null),
            ]);

            const trData = trRes?.ok ? await trRes.json() : null;
            const enData = enRes?.ok ? await enRes.json() : null;
            const det = trData || enData || {};

            if (trData?.biography && trData.biography.trim().length > 30) {
              turkishBio = trData.biography.trim().slice(0, 4000);
            } else if (enData?.biography && enData.biography.trim().length > 20) {
              englishBio = enData.biography.trim().slice(0, 4000);
            }

            if (det.birthday && !birthDate) birthDate = det.birthday;
            if (det.deathday) deathDate = det.deathday;

            if (det.gender !== undefined && det.gender !== null) {
              if (det.gender === 1) genderStr = 'Kadın';
              else if (det.gender === 2) genderStr = 'Erkek';
              else if (det.gender === 3) genderStr = 'Non-binary';
            }

            if (det.place_of_birth) {
              const norm = normalizePlaceOfBirth(det.place_of_birth);
              placeOfBirth = norm.place;
              if (norm.countryCode) countryCode = norm.countryCode;
            }

            if (Array.isArray(det.also_known_as) && det.also_known_as.length > 0) {
              alsoKnownAs = Array.from(new Set([...alsoKnownAs, ...det.also_known_as])).slice(0, 10);
              // Pick native name if has non-ascii characters (Korean / Japanese / Chinese)
              if (!nativeName) {
                const asianCandidate = det.also_known_as.find((a: string) =>
                  /[\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff]/.test(a)
                );
                if (asianCandidate) nativeName = asianCandidate;
              }
            }
          }
        }
      } catch (err) {
        console.warn('TMDB details fetch error:', err);
      }
    }

    // 3b. If countryCode is still KR or null, verify against their drama credits
    if (cleanId && (!countryCode || countryCode === 'KR')) {
      try {
        const { data: castRows } = await db
          .from('media_cast')
          .select('media:media_id(country_code)')
          .eq('person_id', cleanId)
          .limit(15);
        if (castRows && castRows.length > 0) {
          const counts: Record<string, number> = {};
          for (const r of castRows as any[]) {
            const c = r?.media?.country_code;
            if (c) counts[c] = (counts[c] || 0) + 1;
          }
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          if (sorted[0] && (sorted[0][0] === 'CN' || sorted[0][0] === 'JP' || sorted[0][0] === 'TH' || sorted[0][0] === 'TW')) {
            countryCode = sorted[0][0];
          }
        }
      } catch {}
    }

    // 4. Translate English bio to Turkish if needed
    if (!turkishBio && englishBio) {
      const translated = await translateToTurkish(englishBio);
      turkishBio = translated ? translated.slice(0, 4000) : null;
    }

    if (!turkishBio && dbPerson?.bio_tr) {
      turkishBio = dbPerson.bio_tr;
    }

    // 5. Bounded Supabase update only for verified DB rows outside cooldown
    if (cleanId && dbPerson && !isPersonWriteOnCooldown(cleanId)) {
      const updatePayload: Record<string, any> = {};
      if (turkishBio) updatePayload.bio_tr = turkishBio.slice(0, 4000);
      if (genderStr) updatePayload.gender = String(genderStr).slice(0, 32);
      if (birthDate) updatePayload.birth_date = String(birthDate).slice(0, 64);
      if (deathDate) updatePayload.death_date = String(deathDate).slice(0, 64);
      if (placeOfBirth) updatePayload.place_of_birth = String(placeOfBirth).slice(0, 200);
      if (countryCode) updatePayload.country_code = String(countryCode).slice(0, 8);
      if (nativeName) updatePayload.native_name = String(nativeName).slice(0, 120);
      if (alsoKnownAs.length > 0) updatePayload.also_known_as = alsoKnownAs.slice(0, 12);
      if (bloodType) updatePayload.blood_type = String(bloodType).slice(0, 16);
      if (height) updatePayload.height = String(height).slice(0, 32);
      if (race) updatePayload.race = String(race).slice(0, 64);
      if (tmdbId && Number.isInteger(tmdbId) && tmdbId > 0) updatePayload.tmdb_id = tmdbId;
      if (anilistId && Number.isInteger(anilistId) && anilistId > 0) updatePayload.anilist_id = anilistId;

      if (Object.keys(updatePayload).length > 0) {
        recordPersonWriteCooldown(cleanId);
        try {
          const { error: upErr } = await db
            .from('people')
            .update(updatePayload)
            .eq('id', cleanId);
          if (upErr) {
            console.warn('[api/person/bio] Supabase update warning:', upErr.message);
          }
        } catch (e) {
          console.warn('[api/person/bio] Supabase update exception:', e);
        }
      }
    }

    const finalPayload = {
      success: true,
      person: {
        id: cleanId,
        name: cleanName,
        native_name: nativeName,
        gender: genderStr,
        birth_date: birthDate,
        death_date: deathDate,
        place_of_birth: placeOfBirth,
        country_code: countryCode,
        also_known_as: alsoKnownAs,
        blood_type: bloodType,
        height: height,
        race: race,
        bio_tr: turkishBio,
      },
      bio_tr: turkishBio || null,
      source: 'live_enriched',
    };

    setBioCache(cacheKey, finalPayload);
    return NextResponse.json(finalPayload, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Beklenmeyen hata' }, { status: 500 });
  }
}
