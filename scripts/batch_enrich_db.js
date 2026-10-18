const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const TMDB_API_KEY = '4c092d2cfd6d9c0e3aa3dab12c7d4756';
const SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk';

const dbPath = path.resolve(__dirname, '..', 'webdrama_archive.db');
const db = new DatabaseSync(dbPath);

async function callSupabaseRpc(fnName, body) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function isBadOverview(text) {
  if (!text || text.trim().length < 40) return true;
  const low = text.toLowerCase();
  const garbage = [
    '1080p', 'full hd', 'altyazılı', 'altyazili', 'tek parça', 'tek parca',
    'kalitede', 'dizisini türkçe', 'dizisini turkce', 'filmini türkçe',
    'filmini turkce', 'dizibox', 'diziyou', 'webdramaturkey', 'dizikorea',
    'asyadizi', 'kesintisiz izle', 'yapımı dizi serisi', 'yapımı film serisi',
    'yapımı program serisi', 'bölümlerini türkçe', 'sayfasından izleyebilirsiniz'
  ];
  return garbage.some((g) => low.includes(g));
}

function cleanTitle(raw) {
  return (raw || '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full)\b/gi, '')
    .trim();
}

async function resolveTmdb(item) {
  // 1. Find by IMDb ID if available
  if (item.imdb_id && item.imdb_id.startsWith('tt')) {
    try {
      const url = `https://api.themoviedb.org/3/find/${item.imdb_id}?external_source=imdb_id&api_key=${TMDB_API_KEY}&language=tr-TR`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        const hit = (d.movie_results || [])[0] || (d.tv_results || [])[0];
        if (hit) return hit;
      }
    } catch {}
  }

  // 2. Search by title
  const cleaned = cleanTitle(item.title);
  const queries = [cleaned];
  if (cleaned.includes(':')) queries.push(cleaned.split(':')[0].trim());
  if (cleaned.includes('-')) queries.push(cleaned.replace(/-/g, ' ').trim());

  for (const q of queries) {
    if (!q || q.length < 2) continue;
    for (const ep of ['search/movie', 'search/tv', 'search/multi']) {
      try {
        const url = `https://api.themoviedb.org/3/${ep}?query=${encodeURIComponent(q)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          const hit = (d.results || []).find((r) => r.poster_path);
          if (hit) return hit;
        }
      } catch {}
    }
  }

  return null;
}

async function main() {
  console.log('Fetching targets with dead/blocked covers or needing enrichment...');

  const stmt = db.prepare(`
    SELECT id, title, slug, imdb_id, cover_image, overview, content_type
    FROM dramas
    WHERE cover_image LIKE '%hdfilmcehennemi%'
       OR title LIKE '%Spider%'
       OR title LIKE '%Örümcek%'
       OR cover_image IS NULL
       OR cover_image LIKE '%webdrama.io%'
    LIMIT 300
  `);
  const rows = stmt.all();
  console.log(`Found ${rows.length} candidate rows.`);

  const updateSqlite = db.prepare(`
    UPDATE dramas
    SET cover_image = COALESCE(?, cover_image),
        overview = COALESCE(?, overview),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let enrichedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const hit = await resolveTmdb(item);

    if (hit) {
      const poster = hit.poster_path ? `https://image.tmdb.org/t/p/w780${hit.poster_path}` : null;
      const backdrop = hit.backdrop_path ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}` : null;
      let overview = hit.overview && !isBadOverview(hit.overview) ? hit.overview : null;
      const rating = hit.vote_average && Number(hit.vote_average) > 0 ? Number(Number(hit.vote_average).toFixed(1)) : null;

      // Update SQLite
      updateSqlite.run(poster || null, overview || null, item.id);

      // Update Supabase
      const patch = {
        p_media_id: item.id,
        p_tmdb_id: hit.id,
      };
      if (poster) patch.p_cover_image = poster;
      if (backdrop) patch.p_backdrop_image = backdrop;
      if (overview) patch.p_overview = overview;
      if (rating) patch.p_imdb_rating = rating;

      await callSupabaseRpc('patch_media_metadata', patch);

      enrichedCount++;
      if (enrichedCount % 10 === 0 || i === rows.length - 1) {
        console.log(`Enriched ${enrichedCount}/${rows.length}: ${item.title}`);
      }
    }

    // Small throttle to be gentle on TMDB API
    await new Promise((r) => setTimeout(r, 60));
  }

  console.log(`Successfully batch-enriched ${enrichedCount} productions in SQLite & Supabase!`);
}

main().catch(console.error);
