import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM episode_sources WHERE direct_url LIKE '%javascript%' OR direct_url LIKE '%void(0)%'")
print('Javascript dummy sources count:', cur.fetchone()[0])

cur.execute("SELECT id, episode_id, source_name, direct_url FROM episode_sources WHERE direct_url LIKE '%javascript%' LIMIT 10")
for r in cur.fetchall():
    print(r)
