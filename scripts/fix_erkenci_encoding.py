import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()
c.execute("UPDATE dramas SET title = 'Erkenci Kuş' WHERE id = 31860")
c.execute("UPDATE episodes SET episode_name = 'Bölüm ' || episode_number WHERE drama_id = 31860")
conn.commit()
print("Fixed encoding for Erkenci Kus in SQLite!")

c.execute("SELECT id, title, episode_count, sources_count FROM dramas WHERE id=31860")
print("Updated drama:", c.fetchone())
c.execute("SELECT id, episode_name FROM episodes WHERE drama_id=31860 ORDER BY episode_number LIMIT 3")
print("Updated episodes sample:", c.fetchall())
conn.close()
