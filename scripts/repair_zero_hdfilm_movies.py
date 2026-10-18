import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import sqlite3
import json
from curl_cffi import requests as cfr
from scrapers.sync_hdfilm_full_archive import resolve_streams_fast, save_sources, match_or_create_episode

conn = sqlite3.connect('webdrama_archive.db')
conn.execute("PRAGMA busy_timeout=60000;")
conn.execute("PRAGMA journal_mode=WAL;")
cur = conn.cursor()

session = cfr.Session(impersonate="chrome")

cur.execute("""
    SELECT d.id, d.title, d.slug, d.source_url
    FROM dramas d
    LEFT JOIN episodes e ON e.drama_id = d.id
    LEFT JOIN episode_sources es ON es.episode_id = e.id
    WHERE (d.source_url LIKE '%hdfilmcehennemi%' OR d.alt_sites LIKE '%hdfilm%')
    GROUP BY d.id
    HAVING COUNT(es.id) = 0
""")
zero_movies = cur.fetchall()
print(f"Repairing {len(zero_movies)} movies with improved resolver...")

fixed_count = 0
sources_added_total = 0

for d_id, title, slug, source_url in zero_movies:
    if not source_url:
        continue
    streams = resolve_streams_fast(session, source_url)
    if streams:
        ep_id = match_or_create_episode(conn, d_id, 1, 1, "Film", source_url)
        added = save_sources(conn, ep_id, streams)
        sources_added_total += added
        fixed_count += 1
        print(f"  [FIXED] {title} -> +{added} kaynak ({[s[0] for s in streams]})")
    else:
        print(f"  [STILL 0] {title} (Site has no active players)")

conn.commit()
conn.close()
print(f"\nDone! Fixed {fixed_count}/{len(zero_movies)} movies, +{sources_added_total} sources added.")
