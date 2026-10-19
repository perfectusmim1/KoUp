import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const revalidate = 3600; // Cache 1 hour

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

let archiveDb: DatabaseSync | null = null;
function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath = path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (fs.existsSync(dbPath)) {
    try {
      archiveDb = new DatabaseSync(dbPath);
    } catch (_) {}
  }
  return archiveDb;
}

// Country normalization map for places of birth
const COUNTRY_NORM: Record<string, { code: string; name: string }> = {
  korea: { code: 'KR', name: 'Güney Kore' },
  'south korea': { code: 'KR', name: 'Güney Kore' },
  japan: { code: 'JP', name: 'Japonya' },
  china: { code: 'CN', name: 'Çin' },
  taiwan: { code: 'TW', name: 'Tayvan' },
  thailand: { code: 'TH', name: 'Tayland' },
  turkey: { code: 'TR', name: 'Türkiye' },
  türkiye: { code: 'TR', name: 'Türkiye' },
  'united states': { code: 'US', name: 'Amerika Birleşik Devletleri' },
  usa: { code: 'US', name: 'Amerika Birleşik Devletleri' },
  uk: { code: 'GB', name: 'Birleşik Krallık' },
  'united kingdom': { code: 'GB', name: 'Birleşik Krallık' },
  england: { code: 'GB', name: 'Birleşik Krallık' },
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

const inMemoryBioCache = new Map<string, any>();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') || searchParams.get('personId');
    const name = searchParams.get('name');
    const personType = searchParams.get('type') || 'actor';
    const paramTmdbId = searchParams.get('tmdbId') ? Number(searchParams.get('tmdbId')) : null;

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'İsim gerekli' }, { status: 400 });
    }

    const cleanName = name.replace(/\s+/g, ' ').trim();
    const cleanId = id ? Number(id) : null;
    const cacheKey = `${cleanId || ''}_${cleanName.toLowerCase()}`;

    // Fast in-memory hit
    if (inMemoryBioCache.has(cacheKey)) {
      return NextResponse.json(inMemoryBioCache.get(cacheKey), {
        headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
      });
    }

    // 1. Check if DB already has full customized info
    let dbPerson: any = null;
    if (cleanId) {
      const { data } = await supabaseAdmin
        .from('people')
        .select('*')
        .eq('id', cleanId)
        .single();
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
        inMemoryBioCache.set(cacheKey, payload);
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
    let tmdbId: number | null = paramTmdbId || dbPerson?.tmdb_id || null;
    let anilistId: number | null = dbPerson?.anilist_id || null;

    // 2. If Character or Anime, search AniList first
    if (personType === 'character') {
      try {
        const anilistQuery = `
          query ($search: String) {
            Character(search: $search) {
              id
              name { full native alternative }
              gender
              dateOfBirth { year month day }
              bloodType
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
            variables: { search: cleanName },
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (aRes.ok) {
          const aData = await aRes.json();
          const char = aData?.data?.Character;
          if (char) {
            anilistId = char.id;
            if (char.description) englishBio = cleanAniListBio(char.description);
            if (char.gender) {
              const g = char.gender.toLowerCase();
              genderStr = g.includes('female') ? 'Kadın' : g.includes('male') ? 'Erkek' : char.gender;
            }
            if (char.name?.native && !nativeName) nativeName = char.name.native;
            if (Array.isArray(char.name?.alternative)) {
              alsoKnownAs = Array.from(new Set([...alsoKnownAs, ...char.name.alternative])).slice(0, 8);
            }
            if (char.bloodType) bloodType = char.bloodType;
            if (char.dateOfBirth?.year && char.dateOfBirth?.month && char.dateOfBirth?.day) {
              const y = String(char.dateOfBirth.year);
              const m = String(char.dateOfBirth.month).padStart(2, '0');
              const d = String(char.dateOfBirth.day).padStart(2, '0');
              birthDate = `${y}-${m}-${d}`;
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
          if (firstPerson?.id) {
            tmdbId = firstPerson.id;

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
              turkishBio = trData.biography.trim();
            } else if (enData?.biography && enData.biography.trim().length > 20) {
              englishBio = enData.biography.trim();
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
              if (norm.countryCode && !countryCode) countryCode = norm.countryCode;
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

    // 4. Translate English bio to Turkish if needed
    if (!turkishBio && englishBio) {
      turkishBio = await translateToTurkish(englishBio);
    }

    if (!turkishBio && dbPerson?.bio_tr) {
      turkishBio = dbPerson.bio_tr;
    }

    // 5. Update Supabase and SQLite in background
    if (cleanId) {
      const updatePayload: Record<string, any> = {};
      if (turkishBio) updatePayload.bio_tr = turkishBio;
      if (genderStr) updatePayload.gender = genderStr;
      if (birthDate) updatePayload.birth_date = birthDate;
      if (deathDate) updatePayload.death_date = deathDate;
      if (placeOfBirth) updatePayload.place_of_birth = placeOfBirth;
      if (countryCode) updatePayload.country_code = countryCode;
      if (nativeName) updatePayload.native_name = nativeName;
      if (alsoKnownAs.length > 0) updatePayload.also_known_as = alsoKnownAs;
      if (bloodType) updatePayload.blood_type = bloodType;
      if (tmdbId) updatePayload.tmdb_id = tmdbId;
      if (anilistId) updatePayload.anilist_id = anilistId;

      if (Object.keys(updatePayload).length > 0) {
        try {
          const { error: upErr } = await supabaseAdmin
            .from('people')
            .update(updatePayload)
            .eq('id', cleanId);
          if (upErr) {
            console.warn('[api/person/bio] Supabase update warning:', upErr.message);
          } else {
            console.log(`[api/person/bio] Successfully saved enriched metadata for person ${cleanId} (${cleanName}) to Supabase!`);
          }
        } catch (e) {
          console.warn('[api/person/bio] Supabase update exception:', e);
        }

        // SQLite local actors sync
        try {
          const db = getArchiveDb();
          if (db) {
            const updates: string[] = [];
            const params: any[] = [];
            if (genderStr) { updates.push('gender = ?'); params.push(genderStr); }
            if (birthDate) { updates.push('birth_date = ?'); params.push(birthDate); }
            if (deathDate) { updates.push('death_date = ?'); params.push(deathDate); }
            if (placeOfBirth) { updates.push('place_of_birth = ?'); params.push(placeOfBirth); }
            if (nativeName) { updates.push('native_name = ?'); params.push(nativeName); }
            if (turkishBio) { updates.push('bio_tr = ?'); params.push(turkishBio); }
            if (tmdbId) { updates.push('tmdb_id = ?'); params.push(tmdbId); }
            if (anilistId) { updates.push('anilist_id = ?'); params.push(anilistId); }
            if (updates.length > 0) {
              params.push(cleanId);
              db.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE id = ?`).run(...params);
            }
          }
        } catch (_) {}
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
        bio_tr: turkishBio,
      },
      bio_tr: turkishBio || null,
      source: 'live_enriched',
    };

    inMemoryBioCache.set(cacheKey, finalPayload);
    return NextResponse.json(finalPayload, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
