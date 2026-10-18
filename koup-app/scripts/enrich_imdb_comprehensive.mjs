import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk';
const TMDB_API_KEY = '4c092d2cfd6d9c0e3aa3dab12c7d4756';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/\(\d{4}\)/g, '')
    .replace(/\s+(?:izle\s*(?:hd\d*|full\s*hd)?|film\s+izle|dizi\s+izle|türkçe\s+dublajlı?|türkçe\s+altyazılı?|tek\s+parça|1080p|full\s*hd)\s*$/i, '')
    .replace(/\s+izle$/i, '')
    .replace(/\s+(?:cin|kore|tayland|japon)\s+(?:dizisi|filmi|di|ad|ak|as)$/i, '')
    .trim();
}

async function fetchTmdbDetails(tmdbId, contentType) {
  const ep = contentType === 'film' ? 'movie' : 'tv';
  try {
    const url = `https://api.themoviedb.org/3/${ep}/${tmdbId}?append_to_response=external_ids&api_key=${TMDB_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return null;
    const d = await res.json();
    const extImdb = d.external_ids?.imdb_id;
    const vote = d.vote_average ? Number(Number(d.vote_average).toFixed(1)) : null;
    return {
      imdbId: extImdb && /^tt\d+$/.test(extImdb) ? extImdb : null,
      voteAverage: vote && vote > 0 ? vote : null,
    };
  } catch {
    return null;
  }
}

async function searchTmdbByTitle(title, contentType, countryCode) {
  const ep = contentType === 'film' ? 'movie' : 'tv';
  const cleaned = cleanTitle(title);
  if (!cleaned || cleaned.length < 2) return null;

  try {
    const url = `https://api.themoviedb.org/3/search/${ep}?query=${encodeURIComponent(cleaned)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return null;
    const d = await res.json();
    const results = d.results || [];
    if (results.length === 0) return null;

    const cc = (countryCode || '').toUpperCase();
    const hit =
      (cc
        ? results.find(
            (item) =>
              Array.isArray(item.origin_country) && item.origin_country.includes(cc)
          )
        : null) || results[0];

    if (!hit) return null;
    const extUrl = `https://api.themoviedb.org/3/${ep}/${hit.id}/external_ids?api_key=${TMDB_API_KEY}`;
    const extRes = await fetch(extUrl, { signal: AbortSignal.timeout(4000) });
    const extData = extRes.ok ? await extRes.json() : {};
    const extImdb = extData.imdb_id;
    const vote = hit.vote_average ? Number(Number(hit.vote_average).toFixed(1)) : null;

    return {
      tmdbId: hit.id,
      imdbId: extImdb && /^tt\d+$/.test(extImdb) ? extImdb : null,
      voteAverage: vote && vote > 0 ? vote : null,
    };
  } catch {
    return null;
  }
}

async function applyBatchPatches(patches) {
  if (patches.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < patches.length; i += 50) {
    const chunk = patches.slice(i, i + 50);
    const { data: count, error } = await supabase.rpc('patch_media_metadata_batch', {
      p_items: chunk,
    });
    if (error) {
      console.error('Batch patch error:', error);
    } else {
      total += count || chunk.length;
    }
  }
  return total;
}

// Concurrency pool helper
async function poolMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function run() {
  console.log('=== PHASE 1: ENRICHING ITEMS WITH TMDB_ID MISSING IMDB_ID OR RATING ===');
  let offset = 0;
  const BATCH_SIZE = 100;
  let phase1Patched = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .from('media')
      .select('id, title, tmdb_id, content_type, imdb_id, imdb_rating')
      .not('tmdb_id', 'is', null)
      .or('imdb_id.is.null,imdb_rating.is.null')
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Query error in Phase 1:', error);
      break;
    }
    if (!batch || batch.length === 0) {
      console.log('Phase 1 scan finished.');
      break;
    }

    const patches = [];
    await poolMap(batch, 15, async (item) => {
      const d = await fetchTmdbDetails(item.tmdb_id, item.content_type);
      if (!d) return;
      const patch = { id: item.id };
      let needed = false;
      if ((!item.imdb_id || !/^tt\d+$/.test(item.imdb_id)) && d.imdbId) {
        patch.imdb_id = d.imdbId;
        needed = true;
      }
      if (!item.imdb_rating && d.voteAverage) {
        patch.imdb_rating = d.voteAverage;
        needed = true;
      }
      if (needed) {
        patches.push(patch);
      }
    });

    const patchedCount = await applyBatchPatches(patches);
    phase1Patched += patchedCount;
    offset += BATCH_SIZE;
    console.log(`Phase 1: Processed ${offset} | Patched so far: ${phase1Patched}`);

    if (batch.length < BATCH_SIZE) break;
  }

  console.log('=== PHASE 2: FIXING REMAINING CORRUPTED TTREZ/TTRES ITEMS ===');
  let phase2Patched = 0;
  const { data: corruptedList } = await supabase
    .from('media')
    .select('id, title, content_type, country_code, imdb_id, imdb_rating, tmdb_id')
    .not('imdb_id', 'is', null)
    .limit(1000);

  const corrupted = (corruptedList || []).filter(
    (item) => item.imdb_id && !/^tt\d+$/.test(item.imdb_id)
  );
  console.log(`Found ${corrupted.length} corrupted imdb_id items in sample.`);

  for (const item of corrupted) {
    let match = null;
    if (item.tmdb_id) {
      match = await fetchTmdbDetails(item.tmdb_id, item.content_type);
    }
    if (!match?.imdbId) {
      match = await searchTmdbByTitle(item.title, item.content_type, item.country_code);
    }

    if (match?.imdbId || match?.voteAverage) {
      const patch = { id: item.id };
      if (match.imdbId) patch.imdb_id = match.imdbId;
      if (match.voteAverage) patch.imdb_rating = match.voteAverage;
      if (match.tmdbId && !item.tmdb_id) patch.tmdb_id = match.tmdbId;

      const count = await applyBatchPatches([patch]);
      phase2Patched += count;
      console.log(`Phase 2: Patched corrupted ${item.title} -> IMDb: ${match.imdbId}, Rating: ${match.voteAverage}`);
    } else {
      // If no valid match, nullify the fake ttrez ID so it doesn't 404
      const patch = { id: item.id, imdb_id: null };
      await applyBatchPatches([patch]);
      console.log(`Phase 2: Cleared invalid placeholder for ${item.title}`);
    }
  }

  console.log('=== PHASE 3: ENRICHING POPULAR DIZI SERIES MISSING IMDB RATING ===');
  let phase3Patched = 0;
  const { data: topDizis } = await supabase
    .from('media')
    .select('id, title, content_type, country_code, imdb_id, imdb_rating, tmdb_id')
    .eq('content_type', 'dizi')
    .is('imdb_rating', null)
    .order('views_total', { ascending: false })
    .limit(200);

  if (topDizis && topDizis.length > 0) {
    console.log(`Found ${topDizis.length} popular unrated series.`);
    const diziPatches = [];
    await poolMap(topDizis, 15, async (item) => {
      const match = await searchTmdbByTitle(item.title, 'dizi', item.country_code);
      if (match && (match.imdbId || match.voteAverage)) {
        const patch = { id: item.id };
        if (match.tmdbId && !item.tmdb_id) patch.tmdb_id = match.tmdbId;
        if (match.imdbId) patch.imdb_id = match.imdbId;
        if (match.voteAverage) patch.imdb_rating = match.voteAverage;
        diziPatches.push(patch);
      }
    });

    const c = await applyBatchPatches(diziPatches);
    phase3Patched += c;
    console.log(`Phase 3: Patched ${phase3Patched} popular series.`);
  }

  // Final Summary
  const [totalRes, withIdRes, withRatingRes] = await Promise.all([
    supabase.from('media').select('*', { count: 'exact', head: true }),
    supabase.from('media').select('*', { count: 'exact', head: true }).not('imdb_id', 'is', null),
    supabase.from('media').select('*', { count: 'exact', head: true }).not('imdb_rating', 'is', null),
  ]);

  console.log('=== ENRICHMENT SUMMARY ===');
  console.log({
    totalMedia: totalRes.count,
    withImdbId: withIdRes.count,
    withImdbRating: withRatingRes.count,
    phase1Patched,
    phase2Patched,
    phase3Patched,
  });
}

run().catch(console.error);
