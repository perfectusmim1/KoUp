import sqlite3
import re
from collections import defaultdict

def normalize_title(t):
    if not t:
        return ""
    t = t.lower()
    t = t.replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's').replace('ö', 'o').replace('ç', 'c')
    t = re.sub(r'[^a-z0-9]', '', t)
    return t

def audit():
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()

    print("=== 1. TOTAL CATALOG STATS ===")
    total_dramas = cur.execute("SELECT COUNT(*) FROM dramas").fetchone()[0]
    total_episodes = cur.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
    total_sources = cur.execute("SELECT COUNT(*) FROM episode_sources").fetchone()[0]
    print(f"Total Dramas: {total_dramas}")
    print(f"Total Episodes: {total_episodes}")
    print(f"Total Sources: {total_sources}")

    print("\n=== 2. DUPLICATE CHECK ===")
    # By slug
    slug_dups = cur.execute("""
        SELECT slug, COUNT(*) as c FROM dramas GROUP BY slug HAVING c > 1
    """).fetchall()
    print(f"Duplicate Slugs: {len(slug_dups)}")
    for s, c in slug_dups[:5]:
        print(f"  Slug '{s}': {c} occurrences")

    # By TMDB ID (excluding null/0)
    tmdb_dups = cur.execute("""
        SELECT tmdb_id, COUNT(*) as c FROM dramas WHERE tmdb_id IS NOT NULL AND tmdb_id > 0 GROUP BY tmdb_id HAVING c > 1
    """).fetchall()
    print(f"Duplicate TMDB IDs: {len(tmdb_dups)}")
    for tid, c in tmdb_dups[:5]:
        print(f"  TMDB {tid}: {c} occurrences")

    # By normalized title
    dramas = cur.execute("SELECT id, title, slug, content_type, release_year FROM dramas").fetchall()
    title_map = defaultdict(list)
    for did, title, slug, c_type, year in dramas:
        norm = normalize_title(title)
        if norm:
            title_map[(norm, c_type, year or 0)].append((did, title, slug))
    
    norm_dups = {k: v for k, v in title_map.items() if len(v) > 1}
    print(f"Duplicate Titles (same name + type + year): {len(norm_dups)}")
    for k, v in list(norm_dups.items())[:5]:
        print(f"  Group {k}: {[x[0] for x in v]} ({[x[2] for x in v]})")

    print("\n=== 3. ZERO PLAYABLE SOURCE DRAMAS / MOVIES ===")
    # Dramas where NO episode has ANY source in episode_sources
    cur.execute("""
        SELECT d.id, d.title, d.slug, d.content_type, d.episode_count,
               COUNT(e.id) as ep_count,
               COUNT(es.id) as src_count
        FROM dramas d
        LEFT JOIN episodes e ON e.drama_id = d.id
        LEFT JOIN episode_sources es ON es.episode_id = e.id
        GROUP BY d.id
        HAVING src_count = 0
    """)
    zero_source_dramas = cur.fetchall()
    print(f"Dramas with ZERO sources across all episodes: {len(zero_source_dramas)}")
    movies_zero = [d for d in zero_source_dramas if d[3] in ('film', 'movie')]
    series_zero = [d for d in zero_source_dramas if d[3] not in ('film', 'movie')]
    print(f"  - Movies with 0 sources: {len(movies_zero)}")
    print(f"  - Series with 0 sources: {len(series_zero)}")
    for d in zero_source_dramas[:5]:
        print(f"    ID {d[0]}: {d[1]} ({d[2]}) [{d[3]}] - {d[5]} eps, 0 sources")

    print("\n=== 4. EPISODE GAPS IN SERIES ===")
    # For series, check if episode numbers have missing numbers in sequence (e.g. 1, 2, 5)
    cur.execute("""
        SELECT e.drama_id, e.season_number, e.episode_number
        FROM episodes e
        JOIN dramas d ON d.id = e.drama_id
        WHERE d.content_type NOT IN ('film', 'movie')
        ORDER BY e.drama_id, e.season_number, e.episode_number
    """)
    drama_seasons = defaultdict(lambda: defaultdict(list))
    for did, s_num, e_num in cur.fetchall():
        drama_seasons[did][s_num].append(e_num)

    gaps_found = []
    total_missing_eps = 0
    for did, seasons in drama_seasons.items():
        for s_num, eps in seasons.items():
            if not eps:
                continue
            unique_eps = sorted(set(eps))
            min_e = min(unique_eps)
            max_e = max(unique_eps)
            # Only consider gaps if min is 1 and max > 1, or max > len
            expected_set = set(range(1, max_e + 1))
            actual_set = set(unique_eps)
            missing = expected_set - actual_set
            if missing and len(missing) < 50:  # ignore crazy jumps like ep 9999
                gaps_found.append((did, s_num, sorted(missing), min_e, max_e, len(unique_eps)))
                total_missing_eps += len(missing)

    print(f"Series with Sequence Gaps: {len(gaps_found)} series/seasons")
    print(f"Total Missing Gap Episodes: {total_missing_eps}")
    for g in gaps_found[:10]:
        d_info = cur.execute("SELECT title, slug FROM dramas WHERE id = ?", (g[0],)).fetchone()
        print(f"  Drama {g[0]} ({d_info[0]} - {d_info[1]}): S{g[1]} has {g[5]} eps (range 1-{g[4]}), MISSING eps: {g[2]}")

    print("\n=== 5. SOURCE PROVIDERS & BREAKDOWN ===")
    cur.execute("""
        SELECT provider, COUNT(*) as c
        FROM episode_sources
        GROUP BY provider
        ORDER BY c DESC
    """)
    providers = cur.fetchall()
    print("Top Providers in episode_sources:")
    for p, c in providers[:15]:
        print(f"  {p}: {c}")

    # YouTube sources breakdown
    yt_sources = cur.execute("""
        SELECT site, COUNT(*) as c
        FROM episode_sources
        WHERE provider = 'youtube' OR source_name LIKE '%YouTube%' OR embed_id LIKE '%youtube%'
        GROUP BY site
    """).fetchall()
    print("\nYouTube Sources by site:")
    for s, c in yt_sources:
        print(f"  Site '{s}': {c} YouTube sources")

    conn.close()

if __name__ == '__main__':
    audit()
