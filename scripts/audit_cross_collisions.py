"""
Find all cross-medium collisions in webdrama_archive.db:
1. Animes (content_type = 'anime') that have non-anime sources (dizibox, diziyou, dizikorea, ddizi, hdfilm)
2. Live Action Dizis (content_type = 'dizi') that have anime sources (turkanime, asyaanimeleri, tranimeizle)
"""

import os
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("="*70)
print("  CROSS-MEDIUM COLLISION AUDIT")
print("="*70)

# Check 1: Anime with Live-Action Sources
cur.execute("""
    SELECT d.id, d.title, d.release_year, d.content_type, s.site, count(s.id) as src_count
    FROM dramas d
    JOIN episodes e ON d.id = e.drama_id
    JOIN episode_sources s ON e.id = s.episode_id
    WHERE d.content_type = 'anime'
      AND s.site IN ('dizibox', 'diziyou', 'dizikorea', 'ddizi', 'hdfilm')
    GROUP BY d.id, s.site
    ORDER BY src_count DESC
""")
anime_collisions = cur.fetchall()

print(f"\n1. Anime İçinde Canlı Dizi Kaynağı Olanlar: {len(anime_collisions)} adet")
for r in anime_collisions:
    print(f"   • Anime #{r['id']} | {r['title']} ({r['release_year']}) | Kaynak: {r['site']} ({r['src_count']} stream)")

# Check 2: Live-Action Dizi with Anime Sources (excluding anime live action adaptions)
cur.execute("""
    SELECT d.id, d.title, d.release_year, d.content_type, s.site, count(s.id) as src_count
    FROM dramas d
    JOIN episodes e ON d.id = e.drama_id
    JOIN episode_sources s ON e.id = s.episode_id
    WHERE d.content_type = 'dizi'
      AND s.site IN ('turkanime', 'asyaanimeleri', 'tranimeizle')
    GROUP BY d.id, s.site
    ORDER BY src_count DESC
""")
dizi_collisions = cur.fetchall()

print(f"\n2. Canlı Dizi İçinde Anime Kaynağı Olanlar: {len(dizi_collisions)} adet")
for r in dizi_collisions:
    print(f"   • Dizi #{r['id']} | {r['title']} ({r['release_year']}) | Kaynak: {r['site']} ({r['src_count']} stream)")

conn.close()
