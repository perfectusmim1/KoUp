import os
import sys
import sqlite3
import requests
import json
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://aocvcotmikzlwbaezdpl.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0."
    "JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk"
)
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def sync_metadata():
    conn = sqlite3.connect("webdrama_archive.db")
    cur = conn.cursor()
    
    # Get all active dramas with TMDB or IMDb
    cur.execute("""
        SELECT id, imdb_id, tmdb_id, country, release_year
        FROM dramas
        WHERE sources_count > 0 AND (imdb_id IS NOT NULL OR tmdb_id IS NOT NULL)
    """)
    sqlite_rows = cur.fetchall()
    print(f"Loaded {len(sqlite_rows)} rows with metadata from SQLite.")

    # Fetch existing Supabase media with their current imdb_id, tmdb_id, country_code
    print("Fetching existing media from Supabase...")
    supabase_media = {}
    limit = 1000
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/media?select=id,imdb_id,tmdb_id,country_code,release_year&limit={limit}&offset={offset}",
            headers=HEADERS,
            timeout=25
        )
        if r.status_code != 200:
            print(f"Error fetching Supabase media: {r.status_code}")
            break
        data = r.json()
        if not data:
            break
        for item in data:
            supabase_media[item["id"]] = item
        offset += limit
        if len(data) < limit:
            break

    print(f"Loaded {len(supabase_media)} existing media from Supabase.")

    # Find updates
    updates = []
    for row in sqlite_rows:
        m_id, s_imdb, s_tmdb, s_country, s_year = row
        if m_id not in supabase_media:
            continue
        sb = supabase_media[m_id]
        
        needs_update = False
        update_data = {}

        # Fill missing tmdb_id
        if not sb.get("tmdb_id") and s_tmdb:
            update_data["tmdb_id"] = int(s_tmdb)
            needs_update = True

        # Fill missing imdb_id
        if not sb.get("imdb_id") and s_imdb:
            update_data["imdb_id"] = str(s_imdb)
            needs_update = True

        # Fix missing country_code
        if (not sb.get("country_code") or sb.get("country_code") == "") and s_country:
            update_data["country_code"] = s_country
            needs_update = True

        # Fix 0 or null release_year
        if (not sb.get("release_year") or sb.get("release_year") == 0) and s_year:
            try:
                yr = int(s_year)
                if yr > 1900:
                    update_data["release_year"] = yr
                    needs_update = True
            except:
                pass

        if needs_update:
            updates.append((m_id, update_data))

    print(f"Found {len(updates)} records that need metadata updates in Supabase.")

    # Execute updates in parallel or chunked
    success_count = 0
    for i, (m_id, u_data) in enumerate(updates):
        try:
            res = requests.patch(
                f"{SUPABASE_URL}/rest/v1/media?id=eq.{m_id}",
                headers=HEADERS,
                json=u_data,
                timeout=10
            )
            if res.status_code in [200, 204]:
                success_count += 1
            if (i + 1) % 100 == 0 or (i + 1) == len(updates):
                print(f"Progress: {i + 1}/{len(updates)} updated ({success_count} success)...")
        except Exception as e:
            pass

    print(f"Metadata sync complete. Total updated: {success_count}")

if __name__ == "__main__":
    sync_metadata()
