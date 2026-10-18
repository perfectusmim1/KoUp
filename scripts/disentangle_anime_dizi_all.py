"""
Disentangle All Cross-Medium Collisions between Dizi and Anime in webdrama_archive.db
1. Fix misclassified series whose entire content is Anime (e.g. Demon Slayer, Suicide Squad Isekai, Lookism)
2. Move anime streams mistakenly attached to Live-Action dramas (Trillion Game, Three-Body, One Piece Live Action) to their proper Anime entries.
"""

import os
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

conn = sqlite3.connect(DB_PATH, timeout=60.0)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("="*70)
print("  FIXING CROSS-MEDIUM ANIME VS LIVE-ACTION COLLISIONS")
print("="*70)

# A. Convert pure animes misclassified as 'dizi' to 'anime'
PURE_ANIMES = [
    (19223, "Şeytan Avcısı / Kimetsu no Yaiba"),
    (2357, "The Immortal Ascension"),
    (27250, "The Chosen One"),
    (27565, "The Furious Yama"),
    (1942, "Blood River"),
    (21004, "My Heroic Husband"),
    (26813, "Suicide Squad Isekai"),
    (17875, "Sparks of Tomorrow"),
    (17065, "Ameku M.D.: Doctor Detective"),
    (27492, "Lookism"),
    (16112, "Hero Return"),
    (15494, "The Vermilion Mask"),
    (19613, "My Tiny Senpai"),
    (16065, "Monster But Wild"),
]

for d_id, title in PURE_ANIMES:
    cur.execute("UPDATE dramas SET content_type = 'anime' WHERE id = ?", (d_id,))
    print(f"  [Converted to Anime] #{d_id} {title}")

# B. Disentangle dual-medium titles (Live-Action has Anime streams attached)

# 1. One Piece Live Action (#579) vs Anime (#9679)
# Move any asyaanimeleri sources in #579 back to #9679
cur.execute("""
    SELECT e.id, e.season_number, e.episode_number, s.id as src_id
    FROM episodes e
    JOIN episode_sources s ON e.id = s.episode_id
    WHERE e.drama_id = 579 AND s.site = 'asyaanimeleri'
""")
op_rows = cur.fetchall()
if op_rows:
    print(f"  Found {len(op_rows)} asyaanimeleri streams in One Piece Live Action (#579). Relocating to Anime #9679...")
    for r in op_rows:
        # Find matching anime episode
        cur.execute("SELECT id FROM episodes WHERE drama_id = 9679 AND episode_number = ?", (r['episode_number'],))
        target_ep = cur.fetchone()
        if target_ep:
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (target_ep['id'], r['src_id']))
        else:
            # Delete junk stream
            cur.execute("DELETE FROM episode_sources WHERE id = ?", (r['src_id'],))
    print(f"  One Piece Live Action (#579) cleaned!")

# 2. Trillion Game (#659 Live Action): Find Anime entry or move
cur.execute("SELECT id FROM dramas WHERE title LIKE '%Trillion Game%' AND content_type = 'anime'")
tg_anime = cur.fetchone()
if tg_anime:
    tg_anime_id = tg_anime['id']
    cur.execute("""
        SELECT s.id as src_id, e.episode_number
        FROM episodes e
        JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = 659 AND s.site = 'asyaanimeleri'
    """)
    for r in cur.fetchall():
        cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ?", (tg_anime_id, r['episode_number']))
        t_ep = cur.fetchone()
        if t_ep:
            cur.execute("UPDATE episode_sources SET episode_id = ? WHERE id = ?", (t_ep['id'], r['src_id']))
    print(f"  Trillion Game (#659) anime streams relocated to Anime #{tg_anime_id}!")
else:
    # If no separate anime entry, remove asyaanimeleri streams from live-action drama
    cur.execute("""
        DELETE FROM episode_sources 
        WHERE id IN (
            SELECT s.id FROM episodes e JOIN episode_sources s ON e.id = s.episode_id
            WHERE e.drama_id = 659 AND s.site = 'asyaanimeleri'
        )
    """)
    print(f"  Trillion Game (#659) anime streams removed from Live Action!")

# 3. Three-Body (#17077 Live Action): Remove Donghua streams
cur.execute("""
    DELETE FROM episode_sources 
    WHERE id IN (
        SELECT s.id FROM episodes e JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = 17077 AND s.site = 'asyaanimeleri'
    )
""")
print(f"  Three-Body (#17077) anime streams removed from Live Action!")

# 4. Handsome Siblings (#16653 Live Action): Remove anime streams
cur.execute("""
    DELETE FROM episode_sources 
    WHERE id IN (
        SELECT s.id FROM episodes e JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = 16653 AND s.site = 'asyaanimeleri'
    )
""")
print(f"  Handsome Siblings (#16653) anime streams removed from Live Action!")

# 5. Dashing Youth (#1206 Live Action): Remove anime streams
cur.execute("""
    DELETE FROM episode_sources 
    WHERE id IN (
        SELECT s.id FROM episodes e JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = 1206 AND s.site = 'asyaanimeleri'
    )
""")
print(f"  Dashing Youth (#1206) anime streams removed from Live Action!")

# Recalculate sources_count & episode_count on affected series
cur.execute("""
    UPDATE dramas
    SET sources_count = (
        SELECT count(s.id)
        FROM episodes e
        JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = dramas.id
          AND s.direct_url IS NOT NULL AND s.direct_url != 'dead' AND s.direct_url != ''
    ),
    episode_count = (
        SELECT count(distinct e.id)
        FROM episodes e
        JOIN episode_sources s ON e.id = s.episode_id
        WHERE e.drama_id = dramas.id
          AND s.direct_url IS NOT NULL AND s.direct_url != 'dead' AND s.direct_url != ''
    )
    WHERE id IN (579, 9679, 659, 17077, 16653, 1206, 19223, 2357, 27250, 27565, 1942, 21004, 26813, 17875, 17065, 27492, 16112, 15494, 19613, 16065)
""")

conn.commit()
conn.close()

print("\n" + "="*70)
print("All cross-medium collisions successfully disentangled and cleaned!")
print("="*70)
