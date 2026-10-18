import sqlite3
from collections import defaultdict

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

# 1. Known Western & Turkish fixes with authoritative metadata
KNOWN_FIXES = {
    'the mentalist': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2008, 'slug': 'the-mentalist', 'tmdb_id': 5920, 'imdb_id': 'tt1196946', 'rating': 8.2},
    'lost': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2004, 'slug': 'lost', 'tmdb_id': 4607, 'imdb_id': 'tt0411008', 'rating': 8.3},
    'friends': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 1994, 'slug': 'friends', 'tmdb_id': 1668, 'imdb_id': 'tt0108778', 'rating': 8.9},
    'supernatural': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2005, 'slug': 'supernatural', 'tmdb_id': 1622, 'imdb_id': 'tt0460681', 'rating': 8.4},
    'criminal minds': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2005, 'slug': 'criminal-minds', 'tmdb_id': 4057, 'imdb_id': 'tt0452046', 'rating': 8.1},
    'arrow': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2012, 'slug': 'arrow', 'tmdb_id': 1412, 'imdb_id': 'tt2193021', 'rating': 7.5},
    'you': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2018, 'slug': 'you', 'tmdb_id': 78191, 'imdb_id': 'tt6461736', 'rating': 7.7},
    'oz': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 1997, 'slug': 'oz', 'tmdb_id': 4158, 'imdb_id': 'tt0118421', 'rating': 8.7},
    'black mirror': {'country': 'GB', 'country_name': 'Birleşik Krallık', 'year': 2011, 'slug': 'black-mirror', 'tmdb_id': 42009, 'imdb_id': 'tt2085059', 'rating': 8.7},
    'breaking bad': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2008, 'slug': 'breaking-bad', 'tmdb_id': 1396, 'imdb_id': 'tt0903747', 'rating': 9.5},
    'better call saul': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2015, 'slug': 'better-call-saul', 'tmdb_id': 60059, 'imdb_id': 'tt3032476', 'rating': 9.0},
    'prison break': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2005, 'slug': 'prison-break', 'tmdb_id': 2288, 'imdb_id': 'tt0455275', 'rating': 8.3},
    'dexter': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2006, 'slug': 'dexter', 'tmdb_id': 1405, 'imdb_id': 'tt0773262', 'rating': 8.6},
    'sherlock': {'country': 'GB', 'country_name': 'Birleşik Krallık', 'year': 2010, 'slug': 'sherlock', 'tmdb_id': 19885, 'imdb_id': 'tt1475582', 'rating': 9.1},
    'peaky blinders': {'country': 'GB', 'country_name': 'Birleşik Krallık', 'year': 2013, 'slug': 'peaky-blinders', 'tmdb_id': 60574, 'imdb_id': 'tt2442560', 'rating': 8.8},
    'stranger things': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2016, 'slug': 'stranger-things', 'tmdb_id': 66732, 'imdb_id': 'tt4574334', 'rating': 8.7},
    'how i met your mother': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2005, 'slug': 'how-i-met-your-mother', 'tmdb_id': 1100, 'imdb_id': 'tt0460649', 'rating': 8.3},
    'the office': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2005, 'slug': 'the-office', 'tmdb_id': 2316, 'imdb_id': 'tt0386676', 'rating': 9.0},
    'brooklyn nine-nine': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2013, 'slug': 'brooklyn-nine-nine', 'tmdb_id': 48891, 'imdb_id': 'tt2467372', 'rating': 8.4},
    'suits': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2011, 'slug': 'suits', 'tmdb_id': 37680, 'imdb_id': 'tt8084058', 'rating': 8.5},
    'bojack horseman': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2014, 'slug': 'bojack-horseman', 'tmdb_id': 61222, 'imdb_id': 'tt3398228', 'rating': 8.8},
    'gotham': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2014, 'slug': 'gotham', 'tmdb_id': 60708, 'imdb_id': 'tt3749900', 'rating': 7.8},
    'lucifer': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2016, 'slug': 'lucifer', 'tmdb_id': 63174, 'imdb_id': 'tt4052886', 'rating': 8.1},
    'the flash': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2014, 'slug': 'the-flash', 'tmdb_id': 60735, 'imdb_id': 'tt3107288', 'rating': 7.5},
    'the wire': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2002, 'slug': 'the-wire', 'tmdb_id': 32973, 'imdb_id': 'tt0306414', 'rating': 9.3},
    'rick and morty': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2013, 'slug': 'rick-and-morty', 'tmdb_id': 60625, 'imdb_id': 'tt2861424', 'rating': 9.1},
    'la casa de papel': {'country': 'ES', 'country_name': 'İspanya', 'year': 2017, 'slug': 'la-casa-de-papel', 'tmdb_id': 71446, 'imdb_id': 'tt6468322', 'rating': 8.2},
    'narcos': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2015, 'slug': 'narcos', 'tmdb_id': 63351, 'imdb_id': 'tt2707408', 'rating': 8.8},
    'ozark': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2017, 'slug': 'ozark', 'tmdb_id': 69740, 'imdb_id': 'tt5071412', 'rating': 8.5},
    'house m.d.': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2004, 'slug': 'house-md', 'tmdb_id': 1408, 'imdb_id': 'tt0412142', 'rating': 8.7},
    'daredevil': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2015, 'slug': 'daredevil', 'tmdb_id': 61889, 'imdb_id': 'tt3322312', 'rating': 8.6},
    'vikings': {'country': 'CA', 'country_name': 'Kanada', 'year': 2013, 'slug': 'vikings', 'tmdb_id': 44217, 'imdb_id': 'tt2306299', 'rating': 8.5},
    'modern family': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2009, 'slug': 'modern-family', 'tmdb_id': 1421, 'imdb_id': 'tt1442437', 'rating': 8.5},
    'aşk 101': {'country': 'TR', 'country_name': 'Türkiye', 'year': 2020, 'slug': 'ask-101', 'tmdb_id': 100757, 'imdb_id': 'tt10516352', 'rating': 7.5},
    'biz kimden kaçıyorduk anne?': {'country': 'TR', 'country_name': 'Türkiye', 'year': 2023, 'slug': 'biz-kimden-kaciyorduk-anne', 'tmdb_id': 157080, 'imdb_id': 'tt15494462', 'rating': 6.0},
    'ayrılık da sevdaya dahil': {'country': 'TR', 'country_name': 'Türkiye', 'year': 2024, 'slug': 'ayrilik-da-sevdaya-dahil', 'tmdb_id': 255555, 'imdb_id': 'tt31034455', 'rating': 7.0},
    'kulüp': {'country': 'TR', 'country_name': 'Türkiye', 'year': 2021, 'slug': 'kulup', 'tmdb_id': 137347, 'imdb_id': 'tt13317582', 'rating': 7.8},
    'lie to me': {'country': 'US', 'country_name': 'Amerika Birleşik Devletleri', 'year': 2009, 'slug': 'lie-to-me', 'tmdb_id': 4376, 'imdb_id': 'tt1235099', 'rating': 8.0},
}

# 2. Find duplicates in SQLite
c.execute("SELECT id, title, slug, country, release_year, episode_count, sources_count FROM dramas")
all_rows = c.fetchall()

groups = defaultdict(list)
for r in all_rows:
    t = (r[1] or '').strip().lower()
    if t:
        groups[t].append(r)

ghosts_to_delete = set()
actives_to_fix = [] # (id, meta)

for t, r_list in groups.items():
    if len(r_list) <= 1:
        # Check if single series is in KNOWN_FIXES
        if t in KNOWN_FIXES:
            actives_to_fix.append((r_list[0][0], KNOWN_FIXES[t]))
        continue
    
    # Multiple entries for title 't'
    def sort_key(x):
        src = int(x[6]) if x[6] and str(x[6]).isdigit() else 0
        eps = int(x[5]) if x[5] and str(x[5]).isdigit() else 0
        return (src, eps, -x[0])
    
    sorted_r = sorted(r_list, key=sort_key, reverse=True)
    best = sorted_r[0]
    
    if t in KNOWN_FIXES:
        actives_to_fix.append((best[0], KNOWN_FIXES[t]))
    
    best_src = int(best[6]) if best[6] and str(best[6]).isdigit() else 0
    if best_src > 0:
        for other in sorted_r[1:]:
            other_src = int(other[6]) if other[6] and str(other[6]).isdigit() else 0
            if other_src == 0 or (other_src <= 2 and best_src > 10) or (other_src < best_src):
                ghosts_to_delete.add(other[0])
    else:
        for other in sorted_r[1:]:
            ghosts_to_delete.add(other[0])

# Ensure The Mentalist ghost 32522 is in ghosts_to_delete
ghosts_to_delete.add(32522)

print(f"Total ghost duplicates to delete: {len(ghosts_to_delete)}")
print(f"Total active series with metadata fixes: {len(actives_to_fix)}")

# Apply updates to SQLite
print("\nApplying fixes to SQLite webdrama_archive.db...")
for m_id, meta in actives_to_fix:
    c.execute("""
    UPDATE dramas
    SET country = ?, country_name = ?, release_year = ?, slug = ?
    WHERE id = ?
    """, (meta['country'], meta['country_name'], meta['year'], meta['slug'], m_id))

# Delete ghosts from SQLite
print(f"Deleting {len(ghosts_to_delete)} ghost rows from SQLite...")
ghost_list = list(ghosts_to_delete)
c.executemany("DELETE FROM dramas WHERE id = ?", [(gid,) for gid in ghost_list])
c.executemany("DELETE FROM episodes WHERE drama_id = ?", [(gid,) for gid in ghost_list])
conn.commit()
print("SQLite updated successfully!")

# Write SQL batches for Supabase
# 1. Update statements for known fixes
# 2. DELETE FROM media WHERE id IN (...)
with open('scripts/supabase_dedup_and_fix.sql', 'w', encoding='utf-8') as f:
    f.write("-- 1. Update Western & Turkish metadata\n")
    for m_id, meta in actives_to_fix:
        f.write(f"UPDATE media SET country_code = '{meta['country']}', country_name = '{meta['country_name']}', release_year = {meta['year']}, slug = '{meta['slug']}'")
        if 'rating' in meta:
            f.write(f", imdb_rating = {meta['rating']}, site_rating = {meta['rating']}")
        if 'tmdb_id' in meta:
            f.write(f", tmdb_id = {meta['tmdb_id']}")
        f.write(f" WHERE id = {m_id};\n")
    
    f.write("\n-- 2. Delete ghost duplicates in chunks\n")
    chunk_size = 200
    for i in range(0, len(ghost_list), chunk_size):
        chunk = ghost_list[i:i+chunk_size]
        ids_str = ','.join(map(str, chunk))
        f.write(f"DELETE FROM media WHERE id IN ({ids_str});\n")

print(f"Wrote Supabase SQL to scripts/supabase_dedup_and_fix.sql ({len(ghost_list)} deletes in chunks of 200)")
