import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

cur.execute("SELECT id, slug, title, episode_count, sources_count FROM dramas WHERE slug LIKE '%samdalri%' OR title LIKE '%Samdal%'")
dramas = cur.fetchall()
print('Dramas:', dramas)

for d in dramas:
    d_id = d[0]
    cur.execute("""
        SELECT e.id, e.season_number, e.episode_number, e.episode_name, e.episode_url, s.source_name, s.embed_id, s.ajax_embed_url, s.direct_url
        FROM episodes e
        LEFT JOIN episode_sources s ON s.episode_id = e.id
        WHERE e.drama_id = ?
        ORDER BY e.season_number, e.episode_number
    """, (d_id,))
    rows = cur.fetchall()
    print(f'Drama {d_id} has {len(rows)} episode source rows:')
    for r in rows[:10]:
        print(r)
