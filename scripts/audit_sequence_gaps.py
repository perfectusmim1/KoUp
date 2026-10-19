import sqlite3
from collections import defaultdict

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Get all series and their episode numbers grouped by drama and season
cur.execute('''
    SELECT e.drama_id, d.title, d.slug, e.season_number, e.episode_number, COUNT(s.id) as src_count
    FROM episodes e
    JOIN dramas d ON d.id = e.drama_id
    LEFT JOIN episode_sources s ON s.episode_id = e.id
    GROUP BY e.id
    ORDER BY e.drama_id, e.season_number, e.episode_number
''')

drama_seasons = defaultdict(lambda: defaultdict(list))
drama_info = {}

for d_id, title, slug, s_num, e_num, src_count in cur.fetchall():
    drama_info[d_id] = (title, slug)
    drama_seasons[d_id][s_num].append((e_num, src_count))

gapped_dramas = []

for d_id, seasons in drama_seasons.items():
    has_gap = False
    gap_details = []
    for s_num, eps in seasons.items():
        ep_nums = [e[0] for e in eps]
        if not ep_nums:
            continue
        min_ep = min(ep_nums)
        max_ep = max(ep_nums)
        # Check if missing numbers between min and max
        expected = set(range(min_ep, max_ep + 1))
        actual = set(ep_nums)
        missing = expected - actual
        if missing:
            has_gap = True
            gap_details.append((s_num, ep_nums, sorted(list(missing))))
    if has_gap:
        gapped_dramas.append((d_id, drama_info[d_id], gap_details))

print(f"Total dramas with sequence gaps: {len(gapped_dramas)}")
print("\nSample 15 gapped dramas:")
for d_id, (title, slug), gaps in gapped_dramas[:15]:
    print(f"Drama {d_id}: '{title}' ({slug})")
    for s_num, actual, missing in gaps:
        print(f"  S{s_num}: actual={actual[:10]}... missing={missing[:10]}")
