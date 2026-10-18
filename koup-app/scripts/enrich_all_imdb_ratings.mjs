import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk';
const TMDB_API_KEY = '4c092d2cfd6d9c0e3aa3dab12c7d4756';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Open SQLite archive if available
let sqliteDb = null;
try {
  const dbPath = path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  sqliteDb = new DatabaseSync(dbPath);
} catch (e) {
  try {
    const dbPath = path.resolve(process.cwd(), 'webdrama_archive.db');
    sqliteDb = new DatabaseSync(dbPath);
  } catch {}
}

async function fetchRatingForImdb(imdbId, contentType) {
  let rating = null;
  let tmdbId = null;

  // 1. Primary: TMDB /find/{imdb_id}
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${TMDB_API_KEY}&language=tr-TR`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (res.ok) {
      const d = await res.json();
      const hit = (d.tv_results || [])[0] || (d.movie_results || [])[0];
      if (hit) {
        tmdbId = hit.id || null;
        if (hit.vote_average && Number(hit.vote_average) > 0) {
          rating = Number(Number(hit.vote_average).toFixed(1));
        }
      }
    }
  } catch {}

  // 2. Fallback: Cinemeta (Stremio public IMDb metadata API)
  if (!rating) {
    const types = contentType === 'film' ? ['movie', 'series'] : ['series', 'movie'];
    for (const t of types) {
      try {
        const cmUrl = `https://v3-cinemeta.strem.io/meta/${t}/${imdbId}.json`;
        const cmRes = await fetch(cmUrl, { signal: AbortSignal.timeout(3500) });
        if (cmRes.ok) {
          const cd = await cmRes.json();
          const cmRating = cd?.meta?.imdbRating;
          if (cmRating && Number(cmRating) > 0) {
            rating = Number(Number(cmRating).toFixed(1));
            break;
          }
        }
      } catch {}
    }
  }

  return { rating, tmdbId };
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

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('=== STARTING BULK IMDB RATING ENRICHMENT ===');
  const startTime = Date.now();

  const { count: initialCount } = await supabase
    .from('media')
    .select('*', { count: 'exact', head: true })
    .not('imdb_id', 'is', null)
    .is('imdb_rating', null);

  console.log(`Total media items missing imdb_rating: ${initialCount}`);

  let totalEnriched = 0;
  let totalProcessed = 0;
  let lastId = 0;
  const PAGE_SIZE = 250;
  const CONCURRENCY = 25;

  while (true) {
    // Paged query by id ascending
    const { data: batch, error } = await supabase
      .from('media')
      .select('id, title, imdb_id, content_type, tmdb_id')
      .not('imdb_id', 'is', null)
      .is('imdb_rating', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      console.error('Supabase query error:', error);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!batch || batch.length === 0) {
      console.log('No more items found in cursor scan.');
      break;
    }

    lastId = batch[batch.length - 1].id;

    // Process batch with concurrency limit
    const patches = [];
    const resolvedResults = await poolMap(batch, CONCURRENCY, async (item) => {
      const res = await fetchRatingForImdb(item.imdb_id, item.content_type);
      return { item, ...res };
    });

    for (const { item, rating, tmdbId } of resolvedResults) {
      totalProcessed++;
      if (rating && Number(rating) > 0) {
        const patch = {
          id: item.id,
          imdb_rating: rating,
        };
        if (tmdbId && !item.tmdb_id) {
          patch.tmdb_id = tmdbId;
        }
        patches.push(patch);
      }
    }

    // Apply batch updates to Supabase
    if (patches.length > 0) {
      // Chunk patches into groups of 50 for RPC
      for (let p = 0; p < patches.length; p += 50) {
        const chunk = patches.slice(p, p + 50);
        const { data: patchedCount, error: rpcErr } = await supabase.rpc(
          'patch_media_metadata_batch',
          { p_items: chunk }
        );
        if (rpcErr) {
          console.error('Batch patch error:', rpcErr);
        } else {
          totalEnriched += patchedCount || chunk.length;
        }
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const speed = (totalProcessed / (Number(elapsedSec) || 1)).toFixed(1);
    console.log(
      `[${elapsedSec}s] Processed: ${totalProcessed}/${initialCount} | Enriched: ${totalEnriched} (${patches.length}/${batch.length} this batch) | Speed: ${speed} items/sec | Last ID: ${lastId}`
    );

    // Subtle throttle to prevent API rate limit bans
    await new Promise((r) => setTimeout(r, 80));
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('=== ENRICHMENT COMPLETED ===');
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Enriched in Supabase: ${totalEnriched}`);
  console.log(`Total time: ${durationSec}s`);

  // Final verification
  const { count: finalMissing } = await supabase
    .from('media')
    .select('*', { count: 'exact', head: true })
    .not('imdb_id', 'is', null)
    .is('imdb_rating', null);

  const { count: totalWithRating } = await supabase
    .from('media')
    .select('*', { count: 'exact', head: true })
    .not('imdb_id', 'is', null)
    .not('imdb_rating', 'is', null);

  console.log(`Final media with imdb_id & imdb_rating: ${totalWithRating}`);
  console.log(`Remaining without rating: ${finalMissing}`);
}

main().catch(console.error);
