"""
KoUp Universal Fix for Wrong Countries ('US' flag on Asian media) and Dummy Overviews ('...üzerinden eklendi')
Matches titles against TMDB with Year, Country, Language, and Type scoring.
Translates English synopses to Turkish if TMDB tr-TR is missing.
Outputs batch SQL updates.
"""

import sys
import os
import re
import time
import json
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.translator import resolve_tmdb_metadata, translate_to_turkish, COUNTRY_CODE_TO_NAME

SUPABASE_URL = 'https://aocvcotmikzlwbaezdpl.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk'

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Accept': 'application/json'
}

def escape_sql(val):
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    val_str = str(val).replace("'", "''")
    return f"'{val_str}'"

def main():
    print("Fetching titles with dummy overviews ('üzerinden eklendi')...")
    url = f"{SUPABASE_URL}/rest/v1/media?select=id,title,slug,release_year,country_code,content_type,overview,imdb_id,cover_image&overview=like.*üzerinden eklendi*&order=id.asc&limit=400"
    r = requests.get(url, headers=HEADERS, timeout=15)
    if r.status_code != 200:
        print(f"Failed to fetch: {r.status_code}")
        return
    rows = r.json()
    print(f"Found {len(rows)} candidate rows with dummy overviews.")

    patches = []

    def worker(item):
        m_id = item['id']
        title = item['title']
        year = item.get('release_year')
        c_type = item.get('content_type') or 'dizi'
        cur_country = item.get('country_code')

        meta = resolve_tmdb_metadata(
            title,
            year=year,
            country_hint=cur_country if cur_country != 'US' else None,
            content_type=c_type
        )
        if not meta:
            return None

        # Build update record
        update_data = {'id': m_id}
        if meta.get('overview') and len(meta['overview']) > 20:
            update_data['overview'] = meta['overview']
        if meta.get('country_code'):
            update_data['country_code'] = meta['country_code']
            update_data['country_name'] = meta.get('country_name', COUNTRY_CODE_TO_NAME.get(meta['country_code'], 'Asya'))
        if meta.get('release_year'):
            update_data['release_year'] = meta['release_year']
        if meta.get('tmdb_id'):
            update_data['tmdb_id'] = meta['tmdb_id']
        if meta.get('imdb_id'):
            update_data['imdb_id'] = meta['imdb_id']
        if meta.get('imdb_rating'):
            update_data['imdb_rating'] = meta['imdb_rating']
        if meta.get('title_tr'):
            update_data['title_tr'] = meta['title_tr']
        if meta.get('native_title'):
            update_data['native_title'] = meta['native_title']
        if meta.get('cover_image'):
            update_data['cover_image'] = meta['cover_image']
        if meta.get('backdrop_image'):
            update_data['backdrop_image'] = meta['backdrop_image']

        return (m_id, update_data, title, meta.get('country_code'))

    print("Resolving TMDB metadata + auto-translations in parallel (12 workers)...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(worker, r) for r in rows]
        for f in as_completed(futures):
            res = f.result()
            if res:
                m_id, u_data, title, c_code = res
                patches.append(u_data)
                print(f"  [Eşleşti #{len(patches)}] {title[:30]} -> Ülke: {c_code}")

    print(f"Done in {time.time() - t0:.1f}s. Total resolved: {len(patches)}")

    # Write SQL batch statements
    sql_statements = []
    for p in patches:
        set_clauses = []
        for k, v in p.items():
            if k == 'id':
                continue
            set_clauses.append(f"{k} = {escape_sql(v)}")
        set_clauses.append("updated_at = NOW()")
        sql = f"UPDATE public.media SET {', '.join(set_clauses)} WHERE id = {p['id']};"
        sql_statements.append(sql)

    # Save into chunks of 100
    chunk_n = 100
    queries = []
    for i in range(0, len(sql_statements), chunk_n):
        queries.append("\n".join(sql_statements[i:i+chunk_n]))

    with open('scripts/batch_overview_and_country_updates.json', 'w', encoding='utf-8') as f:
        json.dump(queries, f, ensure_ascii=False, indent=2)

    print(f"Generated {len(queries)} SQL batches in scripts/batch_overview_and_country_updates.json")

if __name__ == '__main__':
    main()
