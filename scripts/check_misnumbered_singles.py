import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Check single episode items where episode_number > 1
cur.execute('''
    SELECT d.id, d.title, d.slug, d.content_type, e.id, e.episode_number, e.episode_name
    FROM dramas d
    JOIN episodes e ON e.drama_id = d.id
    WHERE (SELECT COUNT(*) FROM episodes e2 WHERE e2.drama_id = d.id) = 1
      AND e.episode_number > 1
''')
single_eps_misnumbered = cur.fetchall()
print(f"Single episode entries misnumbered (>1): {len(single_eps_misnumbered)}")
for r in single_eps_misnumbered[:20]:
    print(r)
