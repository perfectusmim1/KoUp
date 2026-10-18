import os
import sys
import sqlite3
import requests
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://aocvcotmikzlwbaezdpl.supabase.co"
SUPABASE_KEY = None

with open('koup-app/.env.local', 'r', encoding='utf-8') as f:
    for line in f:
        if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            SUPABASE_KEY = line.strip().split('=', 1)[1]

if not SUPABASE_KEY:
    print("Could not find SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def load_supabase_media():
    print("Loading current media state from Supabase...")
    media_dict = {}
    limit = 1000
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/media?select=id,imdb_id,tmdb_id,country_code,release_year&limit={limit}&offset={offset}",
            headers=HEADERS,
            timeout=25
        )
        if r.status_code != 200:
            print(f"Error reading Supabase: {r.status_code}")
            break
        items = r.json()
        if not items:
            break
        for it in items:
            media_dict[it["id"]] = it
        offset += limit
        if len(items) < limit:
            break
    print(f"Loaded {len(media_dict)} media from Supabase.")
    return media_dict

def run_sync():
    supabase_media = load_supabase_media()
    
    conn = sqlite3.connect("webdrama_archive.db")
    cur = conn.cursor()
    cur.execute("""
        SELECT id, imdb_id, tmdb_id, country, release_year
        FROM dramas
        WHERE sources_count > 0 AND (imdb_id IS NOT NULL OR tmdb_id IS NOT NULL)
    """)
    sqlite_rows = cur.fetchall()
    print(f"Loaded {len(sqlite_rows)} metadata rows from SQLite.")

    updates = []
    for r in sqlite_rows:
        m_id, s_imdb, s_tmdb, s_country, s_year = r
        if m_id not in supabase_media:
            continue
        sb = supabase_media[m_id]

        up = {}
        # missing tmdb_id
        if not sb.get("tmdb_id") and s_tmdb:
            up["tmdb_id"] = int(s_tmdb)
        
        # missing imdb_id
        if not sb.get("imdb_id") and s_imdb:
            up["imdb_id"] = str(s_imdb)

        # missing country_code
        if (not sb.get("country_code") or sb.get("country_code") == "") and s_country:
            up["country_code"] = str(s_country)

        # 0 or missing release_year
        if (not sb.get("release_year") or sb.get("release_year") == 0) and s_year:
            try:
                yr = int(s_year)
                if yr > 1900:
                    up["release_year"] = yr
            except:
                pass

        if up:
            updates.append((m_id, up))

    print(f"Found {len(updates)} media items needing updates in Supabase.")
    if not updates:
        print("Everything is already in sync!")
        return

    # Execute updates with a ThreadPool
    total = len(updates)
    success = 0
    errors = 0

    def send_patch(item):
        m_id, payload = item
        url = f"{SUPABASE_URL}/rest/v1/media?id=eq.{m_id}"
        try:
            res = requests.patch(url, headers=HEADERS, json=payload, timeout=10)
            return res.status_code in [200, 204]
        except Exception:
            return False

    start_time = time.time()
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(send_patch, item): item for item in updates}
        for idx, fut in enumerate(as_completed(futures), 1):
            if fut.result():
                success += 1
            else:
                errors += 1
            if idx % 200 == 0 or idx == total:
                elapsed = time.time() - start_time
                print(f"Progress: {idx}/{total} processed ({success} ok, {errors} err) in {elapsed:.1f}s")

    print(f"Completed: {success} successfully updated in Supabase.")

if __name__ == "__main__":
    run_sync()
