import sys
import os
import requests
import json
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
    print("Fetching dummy overview sample from Supabase...")
    # Get 30 items with dummy overviews
    url = f"{SUPABASE_URL}/rest/v1/media?select=id,title,slug,release_year,country_code,content_type,overview,imdb_id,cover_image&limit=30&order=id.desc"
    r = requests.get(url, headers=HEADERS, timeout=15)
    rows = [item for item in r.json() if 'üzerinden eklendi' in (item.get('overview') or '')]
    print(f"Found {len(rows)} dummy overview rows in sample.")

    statements = []
    for item in rows:
        m_id = item['id']
        title = item['title']
        year = item.get('release_year')
        c_type = item.get('content_type') or 'film'
        
        meta = resolve_tmdb_metadata(title, year=year, content_type=c_type)
        if not meta:
            continue

        clauses = []
        if meta.get('overview') and len(meta['overview']) > 20:
            clauses.append(f"overview = {escape_sql(meta['overview'])}")
        if meta.get('country_code'):
            clauses.append(f"country_code = {escape_sql(meta['country_code'])}")
            clauses.append(f"country_name = {escape_sql(meta.get('country_name', 'Asya'))}")
        if meta.get('release_year'):
            clauses.append(f"release_year = {meta['release_year']}")
        if meta.get('tmdb_id'):
            clauses.append(f"tmdb_id = {meta['tmdb_id']}")
        if meta.get('imdb_id'):
            clauses.append(f"imdb_id = {escape_sql(meta['imdb_id'])}")
        if meta.get('imdb_rating'):
            clauses.append(f"imdb_rating = {meta['imdb_rating']}")
        if meta.get('title_tr'):
            clauses.append(f"title_tr = {escape_sql(meta['title_tr'])}")
        if meta.get('cover_image'):
            clauses.append(f"cover_image = {escape_sql(meta['cover_image'])}")
        if meta.get('backdrop_image'):
            clauses.append(f"backdrop_image = {escape_sql(meta['backdrop_image'])}")

        if clauses:
            clauses.append("updated_at = NOW()")
            sql = f"UPDATE public.media SET {', '.join(clauses)} WHERE id = {m_id};"
            statements.append(sql)
            print(f"  [Eşleşti] {title[:28]} -> Ülke: {meta.get('country_code')}, Yıl: {meta.get('release_year')}")

    if statements:
        with open('scripts/dummy_sample_updates.sql', 'w', encoding='utf-8') as f:
            f.write("\n".join(statements))
        print(f"Wrote {len(statements)} updates to scripts/dummy_sample_updates.sql")

if __name__ == '__main__':
    main()
