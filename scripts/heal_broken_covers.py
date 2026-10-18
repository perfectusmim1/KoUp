import sys
import sqlite3
import urllib.request
import urllib.parse
import json
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

TMDB_KEY = "4c092d2cfd6d9c0e3aa3dab12c7d4756"

def transliterate_tr(s):
    return s.replace('ı', 'i').replace('İ', 'I').replace('ş', 's').replace('Ş', 'S')\
            .replace('ğ', 'g').replace('Ğ', 'G').replace('ü', 'u').replace('Ü', 'U')\
            .replace('ö', 'o').replace('Ö', 'O').replace('ç', 'c').replace('Ç', 'C')

def clean_title_variations(raw_title):
    if not raw_title:
        return []
    
    # Strip year
    t = re.sub(r'\(\d{4}\)', '', raw_title)
    # Strip HTML entities
    t = t.replace('&quot;', '"').replace('&amp;', '&').replace('&#039;', "'")
    # Strip common web suffixes
    t = re.sub(r'\b(izle|turkce|altyazili|dizi|film|hd|full)\b', '', t, flags=re.IGNORECASE)
    
    variations = [t.strip()]

    # Strip season/recap/special descriptors for anime/series
    simplified = re.sub(r'\b(\d+(?:st|nd|rd|th)?\s*season|part\s*\d+|ova|ona|movie|recap|specials?|gaiden)\b.*$', '', t, flags=re.IGNORECASE).strip()
    if simplified and simplified not in variations:
        variations.append(simplified)

    # Base title before colon or dash
    if ':' in t:
        base = t.split(':')[0].strip()
        if len(base) >= 2 and base not in variations:
            variations.append(base)
    if '-' in t:
        base = t.split('-')[0].strip()
        if len(base) >= 2 and base not in variations:
            variations.append(base)

    final_vars = []
    for v in variations:
        clean_v = re.sub(r'[^\w\s]', ' ', v)
        clean_v = re.sub(r'\s+', ' ', clean_v).strip()
        if clean_v and clean_v not in final_vars and len(clean_v) >= 2:
            final_vars.append(clean_v)
            ascii_v = transliterate_tr(clean_v)
            if ascii_v not in final_vars:
                final_vars.append(ascii_v)

    return final_vars

def get_tmdb_poster_by_id(tmdb_id):
    if not tmdb_id:
        return None
    for ep in ['movie', 'tv']:
        url = f"https://api.themoviedb.org/3/{ep}/{tmdb_id}?api_key={TMDB_KEY}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as r:
                d = json.loads(r.read().decode())
                p = d.get('poster_path')
                if p:
                    return f"https://image.tmdb.org/t/p/w500{p}"
        except:
            pass
    return None

def search_tmdb_poster(variations):
    for q in variations[:3]:
        for lang in ['&language=tr-TR', '']:
            url = f"https://api.themoviedb.org/3/search/multi?query={urllib.parse.quote(q)}&api_key={TMDB_KEY}{lang}"
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=3) as r:
                    d = json.loads(r.read().decode())
                    results = d.get('results', [])
                    hit = next((x for x in results if x.get('poster_path')), None)
                    if hit and hit.get('poster_path'):
                        return f"https://image.tmdb.org/t/p/w500{hit.get('poster_path')}", hit.get('id')
            except:
                pass
    return None, None

def search_anilist_poster(variations):
    gql = '''query ($search: String) { Media(search: $search, type: ANIME) { id coverImage { large extraLarge } } }'''
    for q in variations[:3]:
        data = json.dumps({'query': gql, 'variables': {'search': q}}).encode()
        req = urllib.request.Request('https://graphql.anilist.co', data=data, headers={'Content-Type': 'application/json', 'User-Agent': 'KoUp/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                d = json.loads(r.read().decode())
                m = d.get('data', {}).get('Media')
                if m:
                    cov = m.get('coverImage', {})
                    img = cov.get('extraLarge') or cov.get('large')
                    if img:
                        return img, m.get('id')
        except:
            pass
    return None, None

def resolve_single_item(item):
    item_id, title, ctype, year, tmdb_id, old_cover = item
    poster = None
    new_tmdb_id = tmdb_id

    # 1. Direct TMDB ID if present
    if tmdb_id:
        poster = get_tmdb_poster_by_id(tmdb_id)

    variations = clean_title_variations(title)

    # 2. Anime -> AniList first
    if not poster and ctype == 'anime':
        poster, al_id = search_anilist_poster(variations)
        if not poster:
            poster, new_tmdb_id = search_tmdb_poster(variations)

    # 3. Otherwise TMDB
    if not poster:
        poster, new_tmdb_id = search_tmdb_poster(variations)

    return item_id, title, poster, new_tmdb_id

def main():
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()

    cur.execute('''
        SELECT id, title, content_type, release_year, tmdb_id, cover_image
        FROM dramas
        WHERE cover_image LIKE '%file.macellan.online%'
           OR cover_image LIKE '%turkanime.co%'
           OR cover_image IS NULL
           OR trim(cover_image) = ''
           OR cover_image = '/logo-dark.png'
    ''')
    rows = cur.fetchall()
    print(f"Loaded {len(rows)} rows needing cover restoration...")

    resolved_updates = []
    resolved_count = 0

    print("Running parallel lookup with 16 threads...")
    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = {executor.submit(resolve_single_item, row): row for row in rows}
        for i, fut in enumerate(as_completed(futures), 1):
            item_id, title, poster, new_tmdb_id = fut.result()
            if poster:
                resolved_updates.append((poster, new_tmdb_id, item_id))
                resolved_count += 1
            if i % 100 == 0 or i == len(rows):
                print(f"Checked: {i}/{len(rows)} | Resolved: {resolved_count} ({resolved_count*100.0/i:.1f}%)")

    print(f"\nFinal Result: {len(resolved_updates)} / {len(rows)} restored!")

    # Update SQLite
    for poster, new_tmdb_id, item_id in resolved_updates:
        if new_tmdb_id:
            cur.execute("UPDATE dramas SET cover_image = ?, tmdb_id = ? WHERE id = ?", (poster, new_tmdb_id, item_id))
        else:
            cur.execute("UPDATE dramas SET cover_image = ? WHERE id = ?", (poster, item_id))
    conn.commit()
    conn.close()
    print("Updated local SQLite webdrama_archive.db successfully!")

    # Generate SQL file for Supabase
    sql_file = "scripts/supabase_cover_updates.sql"
    with open(sql_file, "w", encoding="utf-8") as f:
        f.write("-- Automated Cover Image Restoration\n")
        for poster, new_tmdb_id, item_id in resolved_updates:
            clean_p = poster.replace("'", "''")
            if new_tmdb_id:
                f.write(f"UPDATE media SET cover_image = '{clean_p}', tmdb_id = {new_tmdb_id} WHERE id = {item_id};\n")
            else:
                f.write(f"UPDATE media SET cover_image = '{clean_p}' WHERE id = {item_id};\n")
    print(f"Saved {len(resolved_updates)} update statements to {sql_file}")

if __name__ == '__main__':
    main()
