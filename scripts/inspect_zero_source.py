import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

cur.execute("""
    SELECT d.id, d.title, d.slug, d.content_type, d.release_year, d.source_url,
           (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count
    FROM dramas d
    LEFT JOIN episodes e ON e.drama_id = d.id
    LEFT JOIN episode_sources es ON es.episode_id = e.id
    GROUP BY d.id
    HAVING COUNT(es.id) = 0
    LIMIT 25
""")
rows = cur.fetchall()
print(f"Sample zero-source dramas (total 976):")
for r in rows:
    print(f"  ID {r[0]}: '{r[1]}' (slug: '{r[2]}', type: '{r[3]}', year: {r[4]}, eps: {r[6]}) -> source_url: {r[5]}")

conn.close()
