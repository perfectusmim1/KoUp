import sqlite3
from collections import defaultdict

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

c.execute("SELECT id, title, slug, country, release_year, episode_count, sources_count, imdb_id, tmdb_id FROM dramas")
rows = c.fetchall()

groups = defaultdict(list)
for r in rows:
    t = (r[1] or '').strip().lower()
    if t:
        groups[t].append(r)

print(f"Total series: {len(rows)}")

# Let's see: for each duplicate title group:
ghost_to_delete = []
corrections_to_active = [] # (active_id, new_country, new_year)

for title, list_of_series in groups.items():
    if len(list_of_series) <= 1:
        continue
    
    with_src = [s for s in list_of_series if s[6] and int(s[6]) > 0]
    without_src = [s for s in list_of_series if not s[6] or int(s[6]) == 0]
    
    # Case 1: Exactly 1 active series, and 1+ ghost series with 0 sources
    if len(with_src) == 1 and len(without_src) >= 1:
        act = with_src[0]
        # Check if any ghost has a different country that looks more correct (e.g. US, TR, GB) while active has KR/TW/TH
        # Or if ghost has release_year while active has None
        active_country = act[3]
        active_year = act[4]
        
        target_country = active_country
        target_year = active_year
        
        for g in without_src:
            ghost_country = g[3]
            ghost_year = g[4]
            # If active is KR/TW/TH but ghost is US/TR/GB/ES/FR, check if it's a Western/Turkish show
            if active_country in ('KR', 'TW', 'TH', 'CN') and ghost_country in ('US', 'TR', 'GB', 'ES', 'FR', 'DE', 'IT'):
                target_country = ghost_country
            if (not target_year or target_year == 'None') and ghost_year and ghost_year != 'None':
                target_year = ghost_year
            
            ghost_to_delete.append(g[0])
            
        if target_country != active_country or target_year != active_year:
            corrections_to_active.append((act[0], act[1], active_country, target_country, active_year, target_year))

    # Case 2: All entries have 0 sources -> keep the first one or latest, delete the rest
    elif len(with_src) == 0 and len(without_src) > 1:
        # Keep the one with lowest id or most metadata, delete others
        keep = without_src[0]
        for g in without_src[1:]:
            ghost_to_delete.append(g[0])

print(f"Identified {len(ghost_to_delete)} ghost duplicate IDs to delete.")
print(f"Identified {len(corrections_to_active)} active series to correct country/year from ghost metadata.")

print("\nSample corrections to active:")
for c_item in corrections_to_active[:25]:
    print(" ", c_item)
