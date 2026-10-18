import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import sqlite3
from curl_cffi import requests as cfr
from scrapers.sync_hdfilm_full_archive import resolve_streams_fast, save_sources, match_or_create_episode, match_or_create_drama

conn = sqlite3.connect('webdrama_archive.db')
conn.execute("PRAGMA busy_timeout=60000;")
conn.execute("PRAGMA journal_mode=WAL;")
c = conn.cursor()

c.execute("SELECT id, title, slug, sources_count FROM dramas WHERE slug LIKE '%aska-dair%' OR slug LIKE '%toscana%'")
rows = c.fetchall()
print("Dramas found:", rows)

session = cfr.Session(impersonate="chrome")

to_sync = [
    ("Aşka Dair", "https://www.hdfilmcehennemi.nl/aska-dair/", "aska-dair"),
    ("Toscana", "https://www.hdfilmcehennemi.nl/toscana-4/", "toscana-4"),
    ("Carpe Diem", "https://www.hdfilmcehennemi.nl/carp-e-diem-1/", "carp-e-diem-1"),
]

for title, url, slug in to_sync:
    meta = {'title': title, 'cover': '/logo-dark.png', 'year': '2022', 'overview': f"{title} HDFilm"}
    streams = resolve_streams_fast(session, url)
    did = match_or_create_drama(conn, title, slug, 'film', meta['cover'], meta['year'], meta['overview'], url)
    ep_id = match_or_create_episode(conn, did, 1, 1, "Film", url)
    added = save_sources(conn, ep_id, streams)
    c.execute("UPDATE dramas SET sources_count = (SELECT COUNT(*) FROM episode_sources WHERE episode_id = ?) WHERE id = ?", (ep_id, did))
    print(f"  {title} (ID: {did}) -> +{added} kaynak kaydedildi! Streams: {[s[0] for s in streams]}")

conn.commit()
conn.close()
