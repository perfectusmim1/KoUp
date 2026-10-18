"""
KoUp Fast Batch IMDb Rating Sync
Fetches real IMDb ratings from Cinemeta for all records with imdb_id
and outputs batch SQL statements to update Supabase directly.
"""

import sys
import os
import time
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk'

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Accept': 'application/json'
}

def get_cinemeta_rating(imdb_id: str, content_type: str) -> float | None:
    types = ['movie', 'series'] if content_type == 'film' else ['series', 'movie']
    headers = {'User-Agent': 'Mozilla/5.0'}
    for t in types:
        try:
            r = requests.get(f'https://v3-cinemeta.strem.io/meta/{t}/{imdb_id}.json', headers=headers, timeout=4)
            if r.status_code == 200:
                d = r.json()
                rating_str = d.get('meta', {}).get('imdbRating')
                if rating_str:
                    val = float(rating_str)
                    if val > 0:
                        return round(val, 1)
        except Exception:
            pass
    return None

def main():
    print("Fetching media with imdb_id from Supabase...")
    all_rows = []
    chunk_size = 1000
    start = 0

    while True:
        end = start + chunk_size - 1
        h = dict(HEADERS)
        h['Range'] = f"{start}-{end}"
        url = f"{SUPABASE_URL}/rest/v1/media?select=id,title,imdb_id,imdb_rating,content_type&imdb_id=like.tt*&order=id.asc"
        r = requests.get(url, headers=h, timeout=15)
        if r.status_code not in (200, 206):
            print(f"Fetch failed at {start}: {r.status_code}")
            break
        data = r.json()
        if not data:
            break
        all_rows.extend(data)
        print(f"  Fetched {len(all_rows)} rows...")
        if len(data) < chunk_size:
            break
        start += chunk_size

    print(f"Total rows with imdb_id: {len(all_rows)}")

    updates = []
    
    def worker(item):
        m_id = item['id']
        imdb_id = item['imdb_id']
        c_type = item.get('content_type') or 'dizi'
        old_rating = float(item['imdb_rating']) if item.get('imdb_rating') else None

        real_rating = get_cinemeta_rating(imdb_id, c_type)
        if real_rating and real_rating > 0:
            if old_rating is None or abs(old_rating - real_rating) >= 0.1:
                return (m_id, real_rating, item['title'], old_rating)
        return None

    print("Fetching Cinemeta real ratings in parallel (35 workers)...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=35) as executor:
        futures = [executor.submit(worker, r) for r in all_rows]
        for f in as_completed(futures):
            res = f.result()
            if res:
                updates.append(res)
                if len(updates) % 100 == 0:
                    print(f"  Discovered {len(updates)} rating corrections...")

    print(f"Done in {time.time() - t0:.1f}s. Total corrections: {len(updates)}")

    # Write SQL updates in chunks of 400
    sql_chunks = []
    chunk_n = 400
    for i in range(0, len(updates), chunk_n):
        batch = updates[i:i+chunk_n]
        val_lines = [f"({uid}, {urating})" for uid, urating, _, _ in batch]
        sql = f"""
UPDATE public.media AS m
SET imdb_rating = v.rating,
    updated_at = NOW()
FROM (VALUES
  {',\n  '.join(val_lines)}
) AS v(id, rating)
WHERE m.id = v.id;
"""
        sql_chunks.append(sql.strip())

    with open('scripts/batch_imdb_updates.json', 'w', encoding='utf-8') as f:
        json.dump([s for s in sql_chunks], f, ensure_ascii=False, indent=2)

    print(f"Generated {len(sql_chunks)} SQL batch update queries in scripts/batch_imdb_updates.json")

if __name__ == '__main__':
    main()
