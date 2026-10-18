"""
Sync HDFilmcehennemi Media Titles (Metadata only, ~9MB) from SQLite to Supabase public.media
Ensures all 9,770+ movies and series are searchable and viewable on the website.
"""

import sys
import os
import json
import sqlite3
import time
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
)
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def sync_hdfilm_media():
    db_path = "webdrama_archive.db"
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, slug, title, native_title, cover_image, backdrop_image, release_year, overview, categories, tags, alt_sites, content_type
        FROM dramas
        WHERE alt_sites LIKE '%hdfilm%' OR source_url LIKE '%hdfilm%' OR id >= 31496
    """)
    dramas = cur.fetchall()
    print(f"Loaded {len(dramas)} HDFilm titles from SQLite webdrama_archive.db")

    # Fetch existing IDs from Supabase to skip already synced ones
    r = requests.get(f"{SUPABASE_URL}/rest/v1/media?select=id&id=gte.31000&limit=10000", headers=HEADERS)
    existing_ids = set()
    if r.status_code == 200:
        for row in r.json():
            existing_ids.add(row["id"])
    print(f"Supabase already has {len(existing_ids)} titles with ID >= 31000")

    to_sync = [d for d in dramas if d[0] not in existing_ids]
    print(f"Need to sync {len(to_sync)} new titles into Supabase public.media...")

    if not to_sync:
        print("All titles already in Supabase!")
        conn.close()
        return

    payload = []
    for d in to_sync:
        did, slug, title, native_title, cover, backdrop, rel_year, overview, cats_raw, tags_raw, alts_raw, ctype = d
        try:
            cats = json.loads(cats_raw or '[]')
        except:
            cats = ["Sinema"]
        try:
            tags = json.loads(tags_raw or '[]')
        except:
            tags = ["HDFilmcehennemi"]
        try:
            alts = json.loads(alts_raw or '[]')
        except:
            alts = ["hdfilm"]

        year_val = None
        if rel_year:
            try:
                year_val = int(str(rel_year)[:4])
            except:
                year_val = 2022
        else:
            year_val = 2022

        content_t = "film" if ctype in ("film", "movie") else "dizi"
        clean_s = slug or f"film-{did}"
        search_txt = f"{title} {clean_s} {content_t} hdfilmcehennemi turkce dublaj altyazili izle 1080p"

        payload.append({
            "id": did,
            "slug": clean_s,
            "content_type": content_t,
            "country_code": "US",
            "country_name": "Yabancı",
            "title": title,
            "title_tr": title,
            "title_en": native_title or title,
            "overview": overview or f"{title} ({year_val}) Türkçe dublaj ve altyazı seçenekleriyle KoUp Sinema'da.",
            "release_year": year_val,
            "episode_count": 1 if content_t == "film" else 10,
            "duration_minutes": 110,
            "status_broadcast": "Tamamlandı",
            "status_translation": "Türkçe Altyazılı / Dublaj",
            "cover_image": cover or "/logo-dark.png",
            "backdrop_image": backdrop or cover or "/logo-dark.png",
            "categories": cats,
            "tags": tags,
            "alt_sites": alts,
            "views_total": 850,
            "search_text": search_txt,
            "is_featured": False
        })

    # Chunked upsert to Supabase
    chunk_size = 100
    synced_count = 0
    for i in range(0, len(payload), chunk_size):
        chunk = payload[i:i + chunk_size]
        for attempt in range(3):
            try:
                r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/sync_media_items", headers=HEADERS, json={"items": chunk}, timeout=30)
                if r.status_code in (200, 201, 204):
                    synced_count += len(chunk)
                    print(f"  [Batch {i // chunk_size + 1}] Synced {synced_count}/{len(payload)} titles...")
                    break
                else:
                    print(f"  [Batch {i // chunk_size + 1} Error]: {r.status_code} {r.text[:120]}")
            except Exception as e:
                print(f"  [Batch {i // chunk_size + 1} Exception]: {e}")
                time.sleep(1)

    print(f"\nSUCCESS: Synced {synced_count} HDFilmcehennemi media titles to Supabase!")
    conn.close()

if __name__ == "__main__":
    sync_hdfilm_media()
