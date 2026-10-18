import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os, json, sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
db_path = os.path.join(_ROOT, "webdrama_archive.db")
json_path = os.path.join(_ROOT, "scrapers", "ddizi_catalog.json")

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get all ddizi dramas recorded so far
cur.execute("SELECT source_url, title FROM dramas WHERE source_url LIKE '%ddizi%' OR alt_sites LIKE '%ddizi%'")
rows = cur.fetchall()

catalog = {}
for url, title in rows:
    if url:
        catalog[url] = title

print(f"Loaded {len(catalog)} DDizi dramas from SQLite.")

# If we have less than 1000, let's load from count_ddizi_catalog logic if needed
# or check if we already have the 1029 dramas
if os.path.exists(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        existing = json.load(f)
        catalog.update(existing)
        print(f"Merged with existing catalog JSON: total {len(catalog)}")

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)

print(f"Saved catalog to {json_path} ({len(catalog)} items).")
