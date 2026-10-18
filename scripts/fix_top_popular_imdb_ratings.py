import sys
import os
import requests
import json
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
    print("Fetching top 100 popular titles with IMDb IDs...")
    url = f"{SUPABASE_URL}/rest/v1/media?select=id,title,imdb_id,imdb_rating,content_type&imdb_id=like.tt*&order=views_total.desc&limit=100"
    r = requests.get(url, headers=HEADERS, timeout=15)
    rows = r.json()
    print(f"Fetched {len(rows)} popular rows.")

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

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(worker, r) for r in rows]
        for f in as_completed(futures):
            res = f.result()
            if res:
                updates.append(res)
                print(f"  [Düzeltildi] {res[2][:28]} ({res[1]}) <- Eski: {res[3]}")

    print(f"\nTotal popular titles corrected: {len(updates)}")
    if updates:
        val_lines = [f"({uid}, {urating})" for uid, urating, _, _ in updates]
        sql = f"""
UPDATE public.media AS m
SET imdb_rating = v.rating,
    updated_at = NOW()
FROM (VALUES
  {',\n  '.join(val_lines)}
) AS v(id, rating)
WHERE m.id = v.id;
"""
        with open('scripts/popular_updates.sql', 'w', encoding='utf-8') as f:
            f.write(sql)
        print("SQL generated in scripts/popular_updates.sql")

if __name__ == '__main__':
    main()
