import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600; // Cache 1 hour

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const name = searchParams.get('name');
    const personType = searchParams.get('type') || 'actor';

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'İsim gerekli' }, { status: 400 });
    }

    const cleanName = name.trim();
    const cleanId = id ? Number(id) : null;

    // 1. Check if DB already has a customized bio that is NOT the generic template
    if (cleanId) {
      const { data: dbPerson } = await supabase
        .from('people')
        .select('bio_tr')
        .eq('id', cleanId)
        .single();

      if (
        dbPerson?.bio_tr &&
        dbPerson.bio_tr.trim().length > 40 &&
        !dbPerson.bio_tr.includes('KoUp arşivinde') &&
        !dbPerson.bio_tr.includes('önde gelen oyuncularından biridir')
      ) {
        return NextResponse.json({
          success: true,
          source: 'cache_db',
          bio_tr: dbPerson.bio_tr,
        });
      }
    }

    let englishBio: string | null = null;
    let turkishBio: string | null = null;

    // 2. If Character or Seiyuu, search AniList first!
    if (personType === 'character') {
      try {
        const anilistQuery = `
          query ($search: String) {
            Character(search: $search) {
              id
              name { full native }
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
          const rawDesc = aData?.data?.Character?.description;
          if (rawDesc) {
            englishBio = cleanAniListBio(rawDesc);
          }
        }
      } catch (err) {
        console.warn('AniList character bio error:', err);
      }
    }

    // 3. If not found or if Actor/Director/Seiyuu, search TMDB Person API
    if (!englishBio && TMDB_API_KEY) {
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
          const firstPerson = sData?.results?.[0];
          if (firstPerson?.id) {
            const tmdbPersonId = firstPerson.id;

            // Fetch Turkish bio
            const trUrl = `https://api.themoviedb.org/3/person/${tmdbPersonId}?api_key=${TMDB_API_KEY}&language=tr-TR`;
            const trRes = await fetch(trUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(4000),
            });
            if (trRes.ok) {
              const trData = await trRes.json();
              if (trData?.biography && trData.biography.trim().length > 30) {
                turkishBio = trData.biography.trim();
              }
            }

            // If no Turkish bio, fetch English bio
            if (!turkishBio) {
              const enUrl = `https://api.themoviedb.org/3/person/${tmdbPersonId}?api_key=${TMDB_API_KEY}&language=en-US`;
              const enRes = await fetch(enUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(4000),
              });
              if (enRes.ok) {
                const enData = await enRes.json();
                if (enData?.biography && enData.biography.trim().length > 20) {
                  englishBio = enData.biography.trim();
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('TMDB bio fetch error:', err);
      }
    }

    // 4. If we have English bio, translate it to Turkish via Google Translate API
    if (!turkishBio && englishBio) {
      turkishBio = await translateToTurkish(englishBio);
    }

    // 5. If successful, persist to Supabase `people` table in background for instant caching!
    if (turkishBio && cleanId) {
      Promise.resolve(
        supabase
          .from('people')
          .update({ bio_tr: turkishBio })
          .eq('id', cleanId)
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      bio_tr: turkishBio || null,
      source: turkishBio ? 'live_enriched' : 'not_found',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
