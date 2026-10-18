import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk';
const TMDB_API_KEY = '4c092d2cfd6d9c0e3aa3dab12c7d4756';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function cleanTitle(raw) {
  return (raw || '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full)\b/gi, '')
    .trim();
}

async function searchTmdbByTitle(item) {
  const queries = [];
  const rawClean = cleanTitle(item.title);
  if (rawClean) queries.push(rawClean);
  if (item.title_en && !queries.includes(item.title_en)) queries.push(cleanTitle(item.title_en));
  if (item.slug) {
    const slugQuery = item.slug.replace(/-(hf|aw|as|ad|dq|box|hd\d*|dizi\d*|vip\d*|\d+)$/g, '').replace(/-/g, ' ');
    if (slugQuery && slugQuery.length > 2 && !queries.includes(slugQuery)) queries.push(slugQuery);
  }
  if (Array.isArray(item.aka_titles)) {
    for (const aka of item.aka_titles) {
      if (aka && !queries.includes(aka)) queries.push(cleanTitle(aka));
    }
  }

  const eps = item.content_type === 'film' ? ['search/movie', 'search/tv'] : ['search/tv', 'search/movie'];

  for (const q of queries) {
    if (!q || q.length < 2) continue;
    for (const ep of eps) {
      try {
        const url = `https://api.themoviedb.org/3/${ep}?query=${encodeURIComponent(q)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const d = await res.json();
          if (d.results && d.results.length > 0) {
            const hit = d.results.find((r) => r.poster_path || r.backdrop_path || r.overview) || d.results[0];
            if (hit && hit.vote_average && Number(hit.vote_average) > 0) {
              return {
                rating: Number(Number(hit.vote_average).toFixed(1)),
                tmdbId: hit.id,
              };
            }
          }
        }
      } catch {}
    }
  }

  return null;
}

async function main() {
  console.log('Fetching remaining items without rating...');
  const { data: items } = await supabase
    .from('media')
    .select('id, title, title_en, slug, aka_titles, content_type, imdb_id, tmdb_id')
    .not('imdb_id', 'is', null)
    .is('imdb_rating', null);

  console.log(`Found ${items?.length || 0} remaining items.`);
  const patches = [];

  for (const item of items || []) {
    const match = await searchTmdbByTitle(item);
    if (match && match.rating) {
      const patch = { id: item.id, imdb_rating: match.rating };
      if (match.tmdbId && !item.tmdb_id) {
        patch.tmdb_id = match.tmdbId;
      }
      patches.push(patch);
      console.log(`[+] ${item.id} - ${item.title}: Rating = ${match.rating}`);
    } else {
      console.log(`[-] ${item.id} - ${item.title}: No TMDB match`);
    }
  }

  if (patches.length > 0) {
    console.log(`Patching ${patches.length} items...`);
    const { data: count, error } = await supabase.rpc('patch_media_metadata_batch', {
      p_items: patches,
    });
    console.log('Patched count:', count, 'Error:', error);
  }
}

main().catch(console.error);
