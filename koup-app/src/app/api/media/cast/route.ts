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
    const anilistIdParam = searchParams.get('anilistId');
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

    let parsedCast: Array<{
      name: string;
      character: string;
      order: number;
      role_type: 'lead' | 'support';
      profile_url: string | null;
      tmdb_id?: number | null;
    }> = [];

    // 2A. For Anime: Fetch Characters and Voice Actors from AniList GraphQL
    let anilistId = anilistIdParam ? Number(anilistIdParam) : null;
    if ((!anilistId || Number.isNaN(anilistId)) && typeParam === 'anime') {
      try {
        const { data: mRow } = await supabaseAdmin
          .from('media')
          .select('anilist_id')
          .eq('id', mediaId)
          .maybeSingle();
        if (mRow?.anilist_id) {
          anilistId = Number(mRow.anilist_id);
        }
      } catch {}
    }

    if (typeParam === 'anime' && (anilistId || titleParam)) {
      try {
        const alQuery = `
          query ($id: Int, $search: String) {
            Media(id: $id, search: $search, type: ANIME) {
              id
              characters(sort: [ROLE, RELEVANCE, ID], perPage: 10) {
                edges {
                  role
                  node {
                    id
                    name { full userPreferred }
                    image { large medium }
                  }
                  voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                    id
                    name { full userPreferred }
                    image { large medium }
                  }
                }
              }
            }
          }
        `;
        const alVars: Record<string, any> = {};
        if (anilistId) alVars.id = anilistId;
        else if (titleParam) alVars.search = titleParam;

        const alRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: alQuery, variables: alVars }),
          signal: AbortSignal.timeout(6000),
        });

        if (alRes.ok) {
          const alData = await alRes.json();
          const charEdges = alData?.data?.Media?.characters?.edges || [];
          if (Array.isArray(charEdges) && charEdges.length > 0) {
            parsedCast = charEdges.map((edge: any, idx: number) => {
              const node = edge?.node || {};
              const va = Array.isArray(edge?.voiceActors) && edge.voiceActors[0] ? edge.voiceActors[0] : null;
              const charName = node?.name?.full || node?.name?.userPreferred || 'Bilinmeyen Karakter';
              const vaName = va?.name?.full || va?.name?.userPreferred || '';
              // Display name: If VA exists, show "Character (VA: Name)" or Character Name
              const displayName = charName;
              const actorProfile = node?.image?.large || node?.image?.medium || va?.image?.large || null;
              const role: 'lead' | 'support' = edge.role === 'MAIN' ? 'lead' : 'support';

              return {
                name: displayName,
                character: vaName ? `Seslendiren: ${vaName}` : charName,
                order: idx + 1,
                role_type: role,
                profile_url: actorProfile,
                tmdb_id: null,
              };
            });
          }
        }
      } catch (alErr) {
        console.error('AniList characters fetch error:', alErr);
      }
    }

    // 2B. If not anime or AniList had no characters, Fetch from TMDb
    let tmdbId = tmdbIdParam ? Number(tmdbIdParam) : null;
    if (parsedCast.length === 0 && (!tmdbId || Number.isNaN(tmdbId)) && titleParam) {
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

          parsedCast = rawList.slice(0, 10).map((c: any, idx: number) => {
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

    for (const actor of parsedCast) {
      const personSlug = slugify(actor.name);
      const spaceName = actor.name.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
      const hyphenName = spaceName.replace(/\s+/g, '-');

      // Check if person exists with comprehensive multi-layer matching
      let personId: number | null = null;
      let existingPerson: any = null;

      // 1. By TMDb ID
      if (actor.tmdb_id) {
        const { data: pByTmdb } = await supabaseAdmin
          .from('people')
          .select('*')
          .eq('tmdb_id', actor.tmdb_id)
          .limit(1)
          .maybeSingle();
        if (pByTmdb) existingPerson = pByTmdb;
      }

      // 2. By exact slug
      if (!existingPerson) {
        const { data: pBySlug } = await supabaseAdmin
          .from('people')
          .select('*')
          .eq('slug', personSlug)
          .limit(1)
          .maybeSingle();
        if (pBySlug) existingPerson = pBySlug;
      }

      // 3. By names (raw name, space name, hyphen name)
      if (!existingPerson) {
        const { data: pByName } = await supabaseAdmin
          .from('people')
          .select('*')
          .or(`name.ilike.%${actor.name}%,name.ilike.%${spaceName}%,name.ilike.%${hyphenName}%`)
          .limit(1)
          .maybeSingle();
        if (pByName) existingPerson = pByName;
      }

      // 4. By word pattern (handles spacing/hyphen variations)
      if (!existingPerson) {
        const words = actor.name.split(/[\s\-_]+/).filter((w: string) => w.length >= 2);
        if (words.length >= 2) {
          const pattern = words.join('%');
          const { data: pByPattern } = await supabaseAdmin
            .from('people')
            .select('*')
            .ilike('name', `%${pattern}%`)
            .order('drama_count', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (pByPattern) existingPerson = pByPattern;
        }
      }

      // 5. By slug prefix (e.g. legacy MDL slug "kim-ji-won-56" or character "char-gokuu-son-246")
      if (!existingPerson) {
        const { data: pBySlugPrefix } = await supabaseAdmin
          .from('people')
          .select('*')
          .or(`slug.ilike.${personSlug}-%,slug.ilike.char-${personSlug}-%,slug.ilike.char-${personSlug}`)
          .order('drama_count', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pBySlugPrefix) existingPerson = pBySlugPrefix;
      }

      if (existingPerson) {
        personId = existingPerson.id;
        const updates: any = {};
        if (!existingPerson.tmdb_id && actor.tmdb_id) {
          updates.tmdb_id = actor.tmdb_id;
        }
        if (!existingPerson.image_url && actor.profile_url) {
          updates.image_url = actor.profile_url;
        }
        // Upgrade legacy numbered slug or char- prefix to clean slug if available and not taken
        if ((/-\d+$/.test(existingPerson.slug) || existingPerson.slug.startsWith('char-')) && existingPerson.slug !== personSlug) {
          const { data: slugTaken } = await supabaseAdmin
            .from('people')
            .select('id')
            .eq('slug', personSlug)
            .maybeSingle();
          if (!slugTaken) {
            updates.slug = personSlug;
          }
        }
        if (Object.keys(updates).length > 0) {
          await supabaseAdmin.from('people').update(updates).eq('id', personId);
          existingPerson = { ...existingPerson, ...updates };
        }
      } else {
        // Insert new person only if no match anywhere
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

        finalCast.push(castEntry);
      }
    }

    if (finalCast.length > 0) {
      try {
        await supabaseAdmin.from('media_cast').delete().eq('media_id', mediaId);
        const rowsToInsert = finalCast.map((c) => ({
          media_id: c.media_id,
          person_id: c.person_id,
          role_type: c.role_type,
          character_name: c.character_name,
          billing_order: c.billing_order,
        }));
        await supabaseAdmin.from('media_cast').insert(rowsToInsert);
      } catch (insertErr) {
        console.error('Error batch inserting media_cast:', insertErr);
      }
    }

    // Fetch complete updated cast from database to return full list
    const { data: updatedCast } = await supabaseAdmin
      .from('media_cast')
      .select('*, people(*)')
      .eq('media_id', mediaId)
      .order('billing_order', { ascending: true })
      .limit(30);

    const fullList = (updatedCast && updatedCast.length > 0) ? updatedCast : finalCast;

    // Sort leads first, then billing order
    const sortedFinal = [...fullList].sort((a: any, b: any) => {
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
