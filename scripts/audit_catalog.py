import argparse
import os
import re
import sqlite3
import sys
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)


def normalize_title(t):
    if not t:
        return ""
    t = t.lower()
    t = t.replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's').replace('ö', 'o').replace('ç', 'c')
    t = re.sub(r'[^a-z0-9]', '', t)
    return t


def audit(db_path: str = "webdrama_archive.db"):
    conn = sqlite3.connect(db_path, timeout=60.0)
    cur = conn.cursor()

    print(f"=== 1. TOTAL CATALOG STATS ({db_path}) ===")
    total_dramas = cur.execute("SELECT COUNT(*) FROM dramas").fetchone()[0]
    total_episodes = cur.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
    total_sources = cur.execute("SELECT COUNT(*) FROM episode_sources").fetchone()[0]
    print(f"Total Dramas: {total_dramas:,}")
    print(f"Total Episodes: {total_episodes:,}")
    print(f"Total Sources: {total_sources:,}")

    print("\n=== 2. DUPLICATE CHECK ===")
    slug_dups = cur.execute("SELECT slug, COUNT(*) as c FROM dramas GROUP BY slug HAVING c > 1").fetchall()
    tmdb_dups = cur.execute(
        "SELECT tmdb_id, content_type, COUNT(*) as c FROM dramas WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 GROUP BY tmdb_id, CASE WHEN content_type='film' THEN 'film' ELSE 'tv' END HAVING c > 1"
    ).fetchall()
    al_dups = cur.execute(
        "SELECT anilist_id, COUNT(*) as c FROM dramas WHERE anilist_id IS NOT NULL AND anilist_id > 0 GROUP BY anilist_id HAVING c > 1"
    ).fetchall()
    mdl_dups = cur.execute(
        "SELECT mydramalist_url, COUNT(*) as c FROM dramas WHERE mydramalist_url IS NOT NULL AND mydramalist_url != '' GROUP BY mydramalist_url HAVING c > 1"
    ).fetchall()
    ep_dups = cur.execute(
        "SELECT COUNT(*) FROM (SELECT drama_id, season_number, episode_number, COUNT(*) c FROM episodes GROUP BY drama_id, season_number, episode_number HAVING c > 1)"
    ).fetchone()[0]
    src_dups = cur.execute(
        "SELECT COUNT(*) - COUNT(DISTINCT episode_id || '|' || LOWER(TRIM(COALESCE(direct_url,'')))) FROM episode_sources WHERE direct_url IS NOT NULL AND direct_url != ''"
    ).fetchone()[0]
    print(f"Duplicate Slugs: {len(slug_dups)} | TMDB (same media kind): {len(tmdb_dups)} | AniList: {len(al_dups)} | MDL: {len(mdl_dups)}")
    print(f"Duplicate Episodes (drama,season,ep): {ep_dups} | Duplicate Normalized Sources: {src_dups:,}")

    print("\n=== 3. DATA ANOMALIES (kisa_drama / bogus episodes / pending://gap) ===")
    mis_kisa = cur.execute(
        """
        SELECT COUNT(*) FROM dramas
        WHERE content_type = 'kisa_drama'
          AND (
            source_url LIKE '%ddizi%' OR source_url LIKE '%webdramaturkey%' OR source_url LIKE '%hdfilmcehennemi%'
            OR source_url LIKE '%dizikorea%' OR source_url LIKE '%asyawatch%' OR source_url LIKE '%dizifon%'
            OR (source_url LIKE '%koredizi%' AND (mydramalist_url IS NOT NULL OR alt_sites LIKE '%dizipal%' OR alt_sites LIKE '%diziizle%'))
          )
        """
    ).fetchone()[0]
    pending_gap_zero = cur.execute(
        "SELECT COUNT(*) FROM episodes e WHERE e.episode_url LIKE 'pending://gap/%' AND NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)"
    ).fetchone()[0]
    zero_src_eps = cur.execute(
        "SELECT COUNT(*) FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)"
    ).fetchone()[0]
    print(f"Misclassified kisa_drama candidates: {mis_kisa} | 0-src pending://gap: {pending_gap_zero} | Total 0-source episodes: {zero_src_eps:,}")

    dramas = cur.execute("SELECT id, title, slug, content_type, release_year FROM dramas").fetchall()
    title_map = defaultdict(list)
    for did, title, slug, c_type, year in dramas:
        norm = normalize_title(title)
        if norm:
            title_map[(norm, c_type, year or 0)].append((did, title, slug))
    norm_dups = {k: v for k, v in title_map.items() if len(v) > 1}
    print(f"Duplicate Titles (same name + type + year): {len(norm_dups)}")

    print("\n=== 4. ZERO PLAYABLE SOURCE DRAMAS / MOVIES ===")
    zero_source_dramas = cur.execute(
        """
        SELECT d.id, d.title, d.slug, d.content_type
        FROM dramas d
        WHERE NOT EXISTS (
            SELECT 1 FROM episodes e JOIN episode_sources es ON es.episode_id = e.id WHERE e.drama_id = d.id
        )
        """
    ).fetchall()
    movies_zero = [d for d in zero_source_dramas if d[3] in ('film', 'movie')]
    series_zero = [d for d in zero_source_dramas if d[3] not in ('film', 'movie')]
    print(f"Dramas with ZERO sources: {len(zero_source_dramas)} (Movies: {len(movies_zero)}, Series: {len(series_zero)})")

    print("\n=== 5. EPISODE GAPS IN SERIES ===")
    cur.execute(
        """
        SELECT e.drama_id, e.season_number, e.episode_number
        FROM episodes e
        JOIN dramas d ON d.id = e.drama_id
        WHERE d.content_type NOT IN ('film', 'movie') AND COALESCE(e.season_number, 1) > 0
        ORDER BY e.drama_id, e.season_number, e.episode_number
        """
    )
    drama_seasons = defaultdict(lambda: defaultdict(list))
    for did, s_num, e_num in cur.fetchall():
        drama_seasons[did][s_num].append(e_num)

    gaps_found = 0
    total_missing_eps = 0
    for did, seasons in drama_seasons.items():
        for s_num, eps in seasons.items():
            if not eps:
                continue
            unique_eps = sorted(set(eps))
            min_e, max_e = min(unique_eps), max(unique_eps)
            if max_e > 2500:
                continue
            missing = set(range(min_e, max_e + 1)) - set(unique_eps)
            if missing:
                gaps_found += 1
                total_missing_eps += len(missing)

    print(f"Series/Seasons with Internal Sequence Gaps (min..max): {gaps_found:,} ({total_missing_eps:,} missing slots)")

    print("\n=== 6. TOP SOURCE PROVIDERS ===")
    for p, c in cur.execute("SELECT COALESCE(provider,''), COUNT(*) as c FROM episode_sources GROUP BY provider ORDER BY c DESC LIMIT 15").fetchall():
        print(f"  {p or 'NULL'}: {c:,}")

    conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="KoUp SQLite Catalog Auditor")
    parser.add_argument("--db", type=str, default=os.environ.get("ARCHIVE_DB_PATH") or "webdrama_archive.db")
    args = parser.parse_args()
    audit(args.db)
    sys.exit(0)
