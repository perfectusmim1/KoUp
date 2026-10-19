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

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

dramas = cur.execute("""
    SELECT d.id, d.title, d.slug, d.content_type, d.release_year, d.cover_image,
           (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count,
           (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) as src_count
    FROM dramas d
""").fetchall()

title_map = defaultdict(list)
for r in dramas:
    norm = normalize_title(r[1])
    if norm and len(norm) > 3:
        title_map[(norm, r[3], r[4] or 0)].append(r)

norm_dups = {k: v for k, v in title_map.items() if len(v) > 1}
print(f"Total duplicate groups found: {len(norm_dups)}")

for k, v in sorted(norm_dups.items()):
    print(f"\nGroup: {k[0]} ({k[1]}, {k[2]})")
    for d in v:
        print(f"  ID {d[0]}: '{d[1]}' | slug: '{d[2]}' | eps: {d[6]} | srcs: {d[7]}")
