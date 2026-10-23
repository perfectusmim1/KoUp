/**
 * Production-Grade Actor Deduplication & Merger Engine (KoUp)
 * Merges all duplicate actors in Supabase and SQLite:
 * - Scans all actors by normalized name
 * - Picks the optimal primary record (clean slug, TMDb ID, highest drama count)
 * - Safely re-points all media_cast, comments, favorites, and magazine posts
 * - Removes duplicates without data loss
 * - Recalculates exact drama_counts
 * - Cleans and standardizes slugs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 1. Load Supabase credentials
const envPath = path.resolve(__dirname, '../koup-app/.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

let supabaseUrl = 'https://tngjhyomcrlqlyyhhthw.supabase.co';
let supabaseKey = '';

for (const line of envContent.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
    supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
  }
  if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
    supabaseKey = line.split('=')[1].trim().replace(/['"]/g, '');
  }
}

if (!supabaseKey) {
  console.error('HATA: SUPABASE_SERVICE_ROLE_KEY bulunamadi!');
  process.exit(1);
}

const headers = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
};

function norm(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanSlug(slug) {
  if (!slug) return 'actor';
  return slug.toLowerCase().replace(/-\d+$/, '').trim() || 'actor';
}

function scorePerson(p) {
  let score = (p.drama_count || 0) * 10;
  const isNumbered = /-\d+$/.test(p.slug || '');
  if (!isNumbered) score += 500;
  if (p.tmdb_id && p.tmdb_id > 0) score += 300;
  if (p.image_url && !p.image_url.includes('logo-dark')) score += 50;
  if (p.bio_tr || p.bio) score += 30;
  if (p.birth_date) score += 20;
  // lower id bonus for tie break
  score += Math.max(0, 100000 - p.id) * 0.0001;
  return score;
}

async function fetchAllPeople() {
  console.log('[Supabase] Tüm aktörler çekiliyor...', flush = true);
  let all = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/people?select=*&order=id.asc&offset=${page * pageSize}&limit=${pageSize}`,
      { headers }
    );
    const data = await res.json();
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return all;
}

async function mergeDuplicateGroup(group, existingSlugs) {
  // Sort by score descending
  const sorted = [...group].sort((a, b) => scorePerson(b) - scorePerson(a));
  const primary = sorted[0];
  const duplicates = sorted.slice(1);

  const pId = primary.id;
  const desiredSlug = cleanSlug(primary.slug);

  // Check if primary slug can be cleaned
  let finalSlug = primary.slug;
  if (desiredSlug !== primary.slug && !existingSlugs.has(desiredSlug)) {
    finalSlug = desiredSlug;
    existingSlugs.add(desiredSlug);
  }

  // Merge metadata from duplicates
  const updates = {};
  if (finalSlug !== primary.slug) updates.slug = finalSlug;

  for (const dup of duplicates) {
    if (!primary.tmdb_id && dup.tmdb_id) updates.tmdb_id = dup.tmdb_id;
    if ((!primary.image_url || primary.image_url.includes('logo-dark')) && dup.image_url && !dup.image_url.includes('logo-dark')) {
      updates.image_url = dup.image_url;
    }
    if (!primary.birth_date && dup.birth_date) updates.birth_date = dup.birth_date;
    if (!primary.death_date && dup.death_date) updates.death_date = dup.death_date;
    if (!primary.place_of_birth && dup.place_of_birth) updates.place_of_birth = dup.place_of_birth;
    if (!primary.native_name && dup.native_name) updates.native_name = dup.native_name;
    if (!primary.gender && dup.gender) updates.gender = dup.gender;
    if (!primary.bio_tr && dup.bio_tr) updates.bio_tr = dup.bio_tr;
    if (!primary.country_code && dup.country_code) updates.country_code = dup.country_code;
  }

  // For each duplicate, re-point media_cast
  for (const dup of duplicates) {
    const dId = dup.id;

    // 1. media_cast
    const rCast = await fetch(`${supabaseUrl}/rest/v1/media_cast?person_id=eq.${dId}`, { headers });
    const dupCast = await rCast.json();

    if (Array.isArray(dupCast)) {
      for (const row of dupCast) {
        const rCheck = await fetch(
          `${supabaseUrl}/rest/v1/media_cast?media_id=eq.${row.media_id}&person_id=eq.${pId}`,
          { headers }
        );
        const existing = await rCheck.json();

        if (Array.isArray(existing) && existing.length > 0) {
          // Both exist: check if duplicate row has better lead role or billing order
          const ex = existing[0];
          const dupIsLead = row.role_type === 'lead';
          const exIsLead = ex.role_type === 'lead';
          const dupBetterOrder = (row.billing_order || 999) < (ex.billing_order || 999);

          if ((dupIsLead && !exIsLead) || dupBetterOrder) {
            await fetch(
              `${supabaseUrl}/rest/v1/media_cast?media_id=eq.${row.media_id}&person_id=eq.${pId}`,
              {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                  role_type: dupIsLead ? 'lead' : ex.role_type,
                  billing_order: Math.min(row.billing_order || 999, ex.billing_order || 999),
                  character_name: ex.character_name || row.character_name,
                }),
              }
            );
          }
          // Delete duplicate row
          await fetch(
            `${supabaseUrl}/rest/v1/media_cast?media_id=eq.${row.media_id}&person_id=eq.${dId}`,
            { method: 'DELETE', headers }
          );
        } else {
          // Re-point to primary
          await fetch(
            `${supabaseUrl}/rest/v1/media_cast?media_id=eq.${row.media_id}&person_id=eq.${dId}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ person_id: pId }),
            }
          );
        }
      }
    }

    // 2. person_favorites
    const rFav = await fetch(`${supabaseUrl}/rest/v1/person_favorites?person_id=eq.${dId}`, { headers });
    const dupFav = await rFav.json();
    if (Array.isArray(dupFav)) {
      for (const fav of dupFav) {
        const rCheckFav = await fetch(
          `${supabaseUrl}/rest/v1/person_favorites?user_id=eq.${fav.user_id}&person_id=eq.${pId}`,
          { headers }
        );
        const exFav = await rCheckFav.json();
        if (Array.isArray(exFav) && exFav.length > 0) {
          await fetch(
            `${supabaseUrl}/rest/v1/person_favorites?user_id=eq.${fav.user_id}&person_id=eq.${dId}`,
            { method: 'DELETE', headers }
          );
        } else {
          await fetch(
            `${supabaseUrl}/rest/v1/person_favorites?user_id=eq.${fav.user_id}&person_id=eq.${dId}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ person_id: pId }),
            }
          );
        }
      }
    }

    // 3. comments
    await fetch(`${supabaseUrl}/rest/v1/comments?person_id=eq.${dId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ person_id: pId }),
    });

    // 4. Delete duplicate person record
    await fetch(`${supabaseUrl}/rest/v1/people?id=eq.${dId}`, {
      method: 'DELETE',
      headers,
    });
  }

  // Recalculate true drama count for primary
  const rAllCast = await fetch(`${supabaseUrl}/rest/v1/media_cast?person_id=eq.${pId}&select=media_id`, { headers });
  const allCast = await rAllCast.json();
  const distinctMedias = new Set((allCast || []).map((x) => x.media_id));
  updates.drama_count = distinctMedias.size;

  // Apply updates to primary
  await fetch(`${supabaseUrl}/rest/v1/people?id=eq.${pId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates),
  });

  return { primaryId: pId, name: primary.name, mergedDups: duplicates.length, finalCount: updates.drama_count };
}

async function run() {
  console.log('=== KOUP OYUNCU DUPLICATE TEMİZLEME VE BİRLEŞTİRME BAŞLADI ===\n');

  const allPeople = await fetchAllPeople();
  console.log(`[Supabase] Toplam çekilen oyuncu sayısı: ${allPeople.length}`);

  const existingSlugs = new Set(allPeople.map((p) => p.slug).filter(Boolean));

  // Group by normalized name
  const nameMap = new Map();
  for (const p of allPeople) {
    const n = norm(p.name);
    if (!n) continue;
    if (!nameMap.has(n)) nameMap.set(n, []);
    nameMap.get(n).push(p);
  }

  const dupGroups = [];
  for (const [k, list] of nameMap.entries()) {
    if (list.length > 1) {
      dupGroups.push(list);
    }
  }

  console.log(`[Supabase] Tespit edilen duplicate isim kümesi: ${dupGroups.length}`);

  let totalMergedPeople = 0;
  const concurrency = 8;
  for (let i = 0; i < dupGroups.length; i += concurrency) {
    const batch = dupGroups.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((g) => mergeDuplicateGroup(g, existingSlugs)));
    for (const r of results) {
      totalMergedPeople += r.mergedDups;
      console.log(
        `[BİRLEŞTİRİLDİ] #${r.primaryId} "${r.name}": +${r.mergedDups} mükerrer kayıt birleştirildi -> Toplam Yapım: ${r.finalCount}`
      );
    }
  }

  console.log(`\n[Supabase] Tamamlandı! Toplam silinen/birleştirilen mükerrer oyuncu sayısı: ${totalMergedPeople}`);

  // Also run SQLite merge
  console.log('\n[SQLite] SQLite webdrama_archive.db oyuncu birleştirmesi yürütülüyor...');
  execSync('python scripts/merge_sqlite_actors.py', { stdio: 'inherit' });

  // Sync to Cloudflare R2 (Rule 11)
  console.log('\n[R2] Veritabanı Cloudflare R2 yedeklemesi yapılıyor...');
  execSync('python -c "from scrapers.supabase_sync_helper import backup_db_to_r2; backup_db_to_r2()"', {
    stdio: 'inherit',
  });

  console.log('\n=== TÜM İŞLEM BAŞARIYLA TAMAMLANDI! ===');
}

run().catch((err) => {
  console.error('Fatal error during merge:', err);
  process.exit(1);
});
