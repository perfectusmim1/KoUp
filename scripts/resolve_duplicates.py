import json, re

with open('C:/Users/Cagan/.gemini/antigravity/brain/63851146-9642-4174-945a-7d5b224e0cb0/.system_generated/steps/13080/output.txt', 'r', encoding='utf-8') as f:
    raw = f.read()

# Locate json
jstart = raw.find('[{"id":')
jend = raw.rfind('}]') + 2
items = json.loads(raw[jstart:jend])

groups = {}
for it in items:
    key = it['title'].lower().strip()
    groups.setdefault(key, []).append(it)

print(f"Total groups: {len(groups)}")

duplicates_to_delete = []
masters_to_keep = []

for title, entries in groups.items():
    # If there are exactly 2 entries or more
    # Sort them: prefer entries that have tmdb_id, imdb_rating, valid release_year != 2026, sources_count higher, cleaner slug (not ending in -ad, -izle-ad, -6)
    def score(e):
        s = 0
        if e.get('tmdb_id'): s += 50
        if e.get('imdb_rating'): s += 30
        year = e.get('release_year')
        if year and year != 2026: s += 20
        # If slug is clean
        slug = e.get('slug', '')
        if not re.search(r'-(ad|hd-ad|izle-ad|\d+)$', slug): s += 10
        s += min(e.get('sources_count', 0), 100)
        return s

    entries.sort(key=score, reverse=True)
    master = entries[0]
    masters_to_keep.append(master)
    for dup in entries[1:]:
        duplicates_to_delete.append({
            'master_id': master['id'],
            'master_title': master['title'],
            'dup_id': dup['id'],
            'dup_title': dup['title'],
            'dup_slug': dup['slug'],
            'master_score': score(master),
            'dup_score': score(dup)
        })

print(f"Identified {len(duplicates_to_delete)} duplicate entries to remove.")
for d in duplicates_to_delete:
    print(f"Master: {d['master_id']} ({d['master_title']}) <-- DELETE Dup: {d['dup_id']} ({d['dup_slug']})")
