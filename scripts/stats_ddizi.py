import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM dramas WHERE alt_sites LIKE "%ddizi%"')
d_cnt = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM episodes WHERE drama_id IN (SELECT id FROM dramas WHERE alt_sites LIKE "%ddizi%")')
e_cnt = cur.fetchone()[0]
cur.execute('SELECT COUNT(*) FROM episode_sources WHERE site = "ddizi"')
s_cnt = cur.fetchone()[0]
print(f'DDizi Scraped so far -> Dramas: {d_cnt}, Episodes: {e_cnt}, Sources: {s_cnt}')

cur.execute('SELECT id, title, slug FROM dramas WHERE alt_sites LIKE "%ddizi%" ORDER BY id DESC LIMIT 10')
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]} ({row[2]})")
