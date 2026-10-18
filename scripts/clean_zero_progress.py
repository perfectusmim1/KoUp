import sqlite3
import json

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

# Find movies with 0 sources from hdfilmcehennemi
c.execute("""
    SELECT d.id, d.title, d.slug, d.source_url
    FROM dramas d
    LEFT JOIN episodes e ON e.drama_id = d.id
    LEFT JOIN episode_sources es ON es.episode_id = e.id
    WHERE (d.source_url LIKE '%hdfilmcehennemi%' OR d.alt_sites LIKE '%hdfilm%')
    GROUP BY d.id
    HAVING COUNT(es.id) = 0
""")
zero_movies = c.fetchall()
print(f"Total HDFilm movies with 0 sources in DB: {len(zero_movies)}")

# Load progress
with open('hdfilm_sync_progress.json', 'r', encoding='utf-8') as f:
    done = set(json.load(f))
print(f"Done slugs before cleanup: {len(done)}")

# Slugs to remove from progress so they can be re-scraped with improved resolver
zero_slugs = set(m[2] for m in zero_movies)
for m in zero_movies:
    if m[3]:
        zero_slugs.add(m[3].rstrip('/').split('/')[-1])

done_cleaned = done - zero_slugs
print(f"Removed {len(done) - len(done_cleaned)} slugs from progress file.")

with open('hdfilm_sync_progress.json', 'w', encoding='utf-8') as f:
    json.dump(list(done_cleaned), f)
print("Updated hdfilm_sync_progress.json!")
