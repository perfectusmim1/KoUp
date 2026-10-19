import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Check pale-moon
cur.execute("SELECT id, title, slug, episode_count, sources_count FROM dramas WHERE slug LIKE '%pale-moon%' OR title LIKE '%Pale Moon%'")
print('Pale Moon drama:', cur.fetchall())

cur.execute("""
    SELECT e.id, e.season_number, e.episode_number, e.title, e.video_url, e.source_status,
           COUNT(s.id) as src_count
    FROM episodes e
    LEFT JOIN episode_sources s ON s.episode_id = e.id
    WHERE e.drama_id = 15278
    GROUP BY e.id
    ORDER BY e.season_number, e.episode_number
""")
eps = cur.fetchall()
print('Pale Moon episodes count:', len(eps))
for ep in eps:
    print(ep)

cur.execute("""
    SELECT s.id, s.episode_id, e.episode_number, s.source_name, s.embed_url, s.quality
    FROM episode_sources s
    JOIN episodes e ON e.id = s.episode_id
    WHERE e.drama_id = 15278
""")
print('Sources for Pale Moon:')
for row in cur.fetchall():
    print(row)
