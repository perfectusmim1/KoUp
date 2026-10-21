import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, CastMember, PersonItem } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'actor';
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mediaIdParam = searchParams.get('mediaId');
    const tmdbIdParam = searchParams.get('tmdbId');
    const typeParam = searchParams.get('type') || 'dizi';
    const titleParam = searchParams.get('title') || '';
    const force = searchParams.get('force') === 'true';

    if (!mediaIdParam) {
      return NextResponse.json({ error: 'mediaId is required' }, { status: 400 });
    }

    const mediaId = Number(mediaIdParam);
    if (Number.isNaN(mediaId)) {
      return NextResponse.json({ error: 'invalid mediaId' }, { status: 400 });
    }

    // 1. Check existing cast in Supabase if not forced
    if (!force) {
      const { data: existingCast, error: castErr } = await supabaseAdmin
        .from('media_cast')
        .select('*, people(*)')
        .eq('media_id', mediaId)
        .order('billing_order', { ascending: true })
        .limit(30);

      if (!castErr && existingCast && existingCast.length > 0) {
        const hasLeads = existingCast.some((c: any) => c.role_type === 'lead');
        if (hasLeads) {
          const sorted = [...existingCast].sort((a: any, b: any) => {
            const aLead = a.role_type === 'lead' ? 0 : 1;
            const bLead = b.role_type === 'lead' ? 0 : 1;
            if (aLead !== bLead) return aLead - bLead;
            return (a.billing_order || 999) - (b.billing_order || 999);
          });
          return NextResponse.json({ ok: true, cast: sorted, source: 'cache' });
        }
      }
    }

    // 2. Fetch from TMDb
    let tmdbId = tmdbIdParam ? Number(tmdbIdParam) : null;
    if ((!tmdbId || Number.isNaN(tmdbId)) && titleParam) {
      // Search TMDb
      try {
        const isMovie = typeParam === 'film';
        const searchEndpoint = isMovie
          ? `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(titleParam)}`
          : `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(titleParam)}`;
        const sRes = await fetch(searchEndpoint, { signal: AbortSignal.timeout(6000) });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (sData.results && sData.results.length > 0) {
            tmdbId = sData.results[0].id;
          }
        }
      } catch (err) {
        console.error('TMDb search error:', err);
      }
    }

    let parsedCast: Array<{
      name: string;
      character: string;
      order: number;
      role_type: 'lead' | 'support';
      profile_url: string | null;
      tmdb_id?: number | null;
    }> = [];

    if (tmdbId) {
      const isMovie = typeParam === 'film';
      const endpointsToTry = isMovie
        ? [`https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${TMDB_API_KEY}`]
        : [
            `https://api.themoviedb.org/3/tv/${tmdbId}/credits?api_key=${TMDB_API_KEY}`,
            `https://api.themoviedb.org/3/tv/${tmdbId}/aggregate_credits?api_key=${TMDB_API_KEY}`,
          ];

      for (const ep of endpointsToTry) {
        try {
          const cRes = await fetch(ep, { signal: AbortSignal.timeout(6000) });
          if (!cRes.ok) continue;
          const cData = await cRes.json();
          const rawList = Array.isArray(cData.cast) ? cData.cast : [];
          if (rawList.length === 0) continue;

          // Sort by TMDb billing order ascending
          rawList.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));

          parsedCast = rawList.slice(0, 30).map((c: any, idx: number) => {
            const role = (c.order ?? idx) < 4 ? ('lead' as const) : ('support' as const);
            let charName = c.character || '';
            if (!charName && Array.isArray(c.roles) && c.roles[0]) {
              charName = c.roles[0].character || '';
            }
            return {
              name: c.name || c.original_name || 'Bilinmeyen Oyuncu',
              character: charName,
              order: idx + 1,
              role_type: role,
              profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w500${c.profile_path}` : null,
              tmdb_id: c.id || null,
            };
          });

          if (parsedCast.length > 0) break;
        } catch (err) {
          console.error('TMDb credits fetch error:', err);
        }
      }
    }

    if (parsedCast.length === 0) {
      return NextResponse.json({ ok: false, cast: [], message: 'No cast found' }, { status: 404 });
    }

    // 3. Upsert people and populate media_cast in Supabase
    const finalCast: CastMember[] = [];

    // Delete old scrambled cast for this media_id
    await supabaseAdmin.from('media_cast').delete().eq('media_id', mediaId);

    for (const actor of parsedCast) {
      const personSlug = slugify(actor.name);

      // Check if person exists
      let personId: number | null = null;
      let existingPerson: any = null;

      if (actor.tmdb_id) {
        const { data: pByTmdb } = await supabaseAdmin
          .from('people')
          .select('*')
          .eq('tmdb_id', actor.tmdb_id)
          .limit(1)
          .maybeSingle();
        if (pByTmdb) existingPerson = pByTmdb;
      }

      if (!existingPerson) {
        const { data: pByName } = await supabaseAdmin
          .from('people')
          .select('*')
          .ilike('name', actor.name)
          .limit(1)
          .maybeSingle();
        if (pByName) existingPerson = pByName;
      }

      if (existingPerson) {
        personId = existingPerson.id;
        // Update photo if missing
        if (!existingPerson.image_url && actor.profile_url) {
          await supabaseAdmin
            .from('people')
            .update({ image_url: actor.profile_url, tmdb_id: actor.tmdb_id || existingPerson.tmdb_id })
            .eq('id', personId);
          existingPerson.image_url = actor.profile_url;
        }
      } else {
        // Insert new person
        const { data: newPerson, error: pInsertErr } = await supabaseAdmin
          .from('people')
          .insert({
            name: actor.name,
            slug: personSlug,
            image_url: actor.profile_url,
            tmdb_id: actor.tmdb_id || null,
            person_type: 'actor',
          })
          .select()
          .single();

        if (newPerson && !pInsertErr) {
          personId = newPerson.id;
          existingPerson = newPerson;
        }
      }

      if (personId) {
        const castEntry: CastMember = {
          media_id: mediaId,
          person_id: personId,
          role_type: actor.role_type,
          character_name: actor.character,
          billing_order: actor.order,
          people: existingPerson as PersonItem,
        };

        await supabaseAdmin.from('media_cast').insert({
          media_id: mediaId,
          person_id: personId,
          role_type: actor.role_type,
          character_name: actor.character,
          billing_order: actor.order,
        });

        finalCast.push(castEntry);
      }
    }

    // Sort leads first, then billing order
    const sortedFinal = [...finalCast].sort((a, b) => {
      const aLead = a.role_type === 'lead' ? 0 : 1;
      const bLead = b.role_type === 'lead' ? 0 : 1;
      if (aLead !== bLead) return aLead - bLead;
      return (a.billing_order || 999) - (b.billing_order || 999);
    });

    return NextResponse.json({ ok: true, cast: sortedFinal, source: 'tmdb' });
  } catch (err: any) {
    console.error('Fatal cast route error:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
