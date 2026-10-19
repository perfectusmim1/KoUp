import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

for did in [179, 486]:
    d_row = cur.execute("SELECT id, title, slug, source_url FROM dramas WHERE id = ?", (did,)).fetchone()
    print(f"\nDrama {d_row}")
    cur.execute("SELECT season_number, episode_number, episode_url FROM episodes WHERE drama_id = ? ORDER BY season_number, episode_number", (did,))
    eps = cur.fetchall()
    print(f"Total eps: {len(eps)}")
    for ep in eps:
        if ep[1] in [11, 12, 13, 14]:
            print(f"  S{ep[0]}E{ep[1]}: {ep[2]}")

conn.close()
