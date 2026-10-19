import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Find series where total episodes <= 5, but max episode number >= 10 (like 1, 2, 10)
cur.execute('''
    SELECT d.id, d.title, d.slug, COUNT(e.id) as ep_count, MAX(e.episode_number) as max_ep,
           COUNT(s.id) as src_count
    FROM dramas d
    JOIN episodes e ON e.drama_id = d.id
    LEFT JOIN episode_sources s ON s.episode_id = e.id
    GROUP BY d.id
    HAVING ep_count <= 4 AND max_ep >= 8
''')
stubs = cur.fetchall()
print(f"Total dead gap stubs: {len(stubs)}")
for s in stubs:
    print(s)
