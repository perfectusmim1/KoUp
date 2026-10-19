import sqlite3

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Check sample dramas from audit: 486 (Destined), 1106 (SunsetxVibes), 1184 (Under the Skin)
for d_id in [486, 1106, 1184, 1209, 1233, 1350]:
    cur.execute("SELECT id, title, slug, episode_count, sources_count FROM dramas WHERE id = ?", (d_id,))
    d = cur.fetchone()
    cur.execute("SELECT season_number, episode_number, COUNT(s.id) FROM episodes e LEFT JOIN episode_sources s ON s.episode_id = e.id WHERE e.drama_id = ? GROUP BY e.id ORDER BY season_number, episode_number", (d_id,))
    eps = cur.fetchall()
    ep_nums = [e[1] for e in eps]
    expected = set(range(min(ep_nums), max(ep_nums) + 1))
    missing = sorted(list(expected - set(ep_nums)))
    print(f"Drama {d_id} '{d[1]}': total_eps={len(eps)}, missing in sequence={missing}")
