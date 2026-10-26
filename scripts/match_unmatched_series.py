import sys
import os
import re
import json
import time
import sqlite3
import requests
from difflib import SequenceMatcher

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import _load_supabase_creds

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()

def _load_tmdb_key():
    env_path = os.path.join(_ROOT, 'koup-app', '.env.local')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as ef:
            for l in ef:
                if l.startswith('TMDB_API_KEY='):
                    return l.split('=', 1)[1].strip()
    return os.getenv('TMDB_API_KEY', '')

TMDB_API_KEY = _load_tmdb_key()


COUNTRY_LANG_MAP = {
    'KR': ['ko'],
    'JP': ['ja'],
    'CN': ['zh'],
    'TW': ['zh'],
    'TH': ['th'],
    'TR': ['tr'],
    'US': ['en'],
    'GB': ['en'],
    'FR': ['fr'],
    'ES': ['es'],
    'DE': ['de'],
    'IT': ['it'],
    'IN': ['hi', 'ta', 'te'],
}

def norm_title(s: str) -> str:
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r'[\(\)\[\]\{\}\-_:;,\.!\?\'"\+]', ' ', s)
    s = s.replace('ş', 's').replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ö', 'o').replace('ç', 'c')
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def title_sim(t1: str, t2: str) -> float:
    n1, n2 = norm_title(t1), norm_title(t2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0
    return SequenceMatcher(None, n1, n2).ratio()

def clean_search_title(t: str) -> str:
    # Strip common scraper suffixes
    t = re.sub(r'-(?:izle|dizi-izle|film-izle|hd|turkce-altyazili|turkce-dublaj)$', '', t, flags=re.I)
    t = re.sub(r'\s+(?:izle|dizi|film|hd|türkçe|altyazılı|dublaj)$', '', t, flags=re.I)
    return t.strip()

def search_anilist(query: str, year: int = None):
    query_graphql = '''
    query ($search: String) {
        Media(search: $search, type: ANIME) {
            id
            idMal
            title { romaji english native }
            startDate { year }
            coverImage { extraLarge large }
            bannerImage
            description(asHtml: false)
            genres
            status
            averageScore
        }
    }
    '''
    try:
        r = requests.post(
            'https://graphql.anilist.co',
            json={'query': query_graphql, 'variables': {'search': query}},
            timeout=8
        )
        if not r.ok:
            return None
        m = r.json().get('data', {}).get('Media')
        if not m:
            return None
        titles = [m['title'].get(k) for k in ('romaji', 'english', 'native') if m['title'].get(k)]
        best_sim = max((title_sim(query, t) for t in titles), default=0)
        al_year = m.get('startDate', {}).get('year')
        year_ok = True
        if year and al_year:
            year_ok = abs(year - al_year) <= 1
        if best_sim >= 0.80 and year_ok:
            return m
        if best_sim == 1.0:
            return m
    except Exception:
        pass
    return None

def search_tmdb(query: str, year: int = None, country: str = None, ctype: str = 'dizi'):
    if not TMDB_API_KEY:
        return None

    clean_q = clean_search_title(query)
    clean_q_no_art = re.sub(r'^(?:the|a|an)\s+', '', clean_q, flags=re.I)
    expected_langs = COUNTRY_LANG_MAP.get((country or '').upper(), [])

    # Search both tv and movie, prioritized by ctype
    types = ['tv', 'movie'] if ctype in ('dizi', 'show') else ['movie', 'tv']
    
    for mtype in types:
        for lang_param in ['en-US', 'tr-TR']:
            url = f'https://api.themoviedb.org/3/search/{mtype}?api_key={TMDB_API_KEY}&query={requests.utils.quote(clean_q)}&language={lang_param}'
            try:
                r = requests.get(url, timeout=8).json()
                for cand in r.get('results', [])[:10]:
                    cand_year_str = (cand.get('first_air_date') or cand.get('release_date') or '')[:4]
                    cand_year = int(cand_year_str) if cand_year_str.isdigit() else None
                    cand_lang = cand.get('original_language')
                    cand_countries = cand.get('origin_country', [])

                    cand_titles = [cand.get('name'), cand.get('title'), cand.get('original_name'), cand.get('original_title')]
                    cand_titles = [t for t in cand_titles if t]
                    sim1 = max((title_sim(clean_q, ct) for ct in cand_titles), default=0)
                    sim2 = max((title_sim(clean_q_no_art, re.sub(r'^(?:the|a|an)\s+', '', ct, flags=re.I)) for ct in cand_titles), default=0)
                    sim = max(sim1, sim2)

                    # Year check
                    year_ok = True
                    if year and cand_year:
                        year_ok = abs(year - cand_year) <= 1
                    elif year and not cand_year:
                        year_ok = False

                    # Country / language check if known
                    lang_ok = True
                    if expected_langs:
                        lang_ok = cand_lang in expected_langs or any(c in cand_countries for c in [country])

                    if sim >= 0.85 and year_ok and lang_ok:
                        return (cand['id'], mtype, cand)
                    elif sim == 1.0 and (not year or year_ok) and (not expected_langs or lang_ok):
                        return (cand['id'], mtype, cand)
            except Exception:
                pass
    return None

def fetch_tmdb_details(tmdb_id: int, mtype: str):
    url = f'https://api.themoviedb.org/3/{mtype}/{tmdb_id}?api_key={TMDB_API_KEY}&language=tr-TR&append_to_response=external_ids,credits'
    try:
        r = requests.get(url, timeout=8).json()
        return r
    except Exception:
        return None

def sync_match_to_supabase(drama_id: int, updates: dict):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    url = f"{SUPABASE_URL}/rest/v1/media?id=eq.{drama_id}"
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    }
    try:
        requests.patch(url, headers=headers, json=updates, timeout=6)
    except Exception as e:
        print(f"Supabase patch error for drama {drama_id}: {e}")

def main():
    db_path = os.path.join(_ROOT, 'webdrama_archive.db')
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    sql_unmatched = '''
        SELECT id, title, native_title, release_year, country, country_name, content_type
        FROM dramas
        WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 0)
          AND (imdb_id IS NULL OR imdb_id = '')
          AND (anilist_id IS NULL OR anilist_id = '' OR anilist_id = 0)
          AND (mydramalist_url IS NULL OR mydramalist_url = '')
        ORDER BY id ASC
    '''
    cur.execute(sql_unmatched)
    unmatched_rows = cur.fetchall()
    total_unmatched = len(unmatched_rows)
    print(f"Toplam eşleşmemiş seri sayısı: {total_unmatched}")

    matched_count = 0

    for idx, (did, title, ntitle, year_str, country, cname, ctype) in enumerate(unmatched_rows, 1):
        year = int(year_str) if year_str and str(year_str).isdigit() else None
        q = ntitle or title

        # Step 1: AniList for anime
        is_anime = ctype == 'anime' or country == 'JP'
        al_data = search_anilist(q, year) if is_anime else None

        if al_data:
            al_id = al_data.get('id')
            existing_al = cur.execute("SELECT id, title FROM dramas WHERE anilist_id = ? AND id != ?", (al_id, did)).fetchone()
            if existing_al:
                print(f"[{idx}/{total_unmatched}] ANILIST DUPLICATE GUARD -> ID {did} '{title}' matches existing #{existing_al[0]} '{existing_al[1]}' (AniList ID {al_id}). Skipping assignment.")
                continue
            al_img = al_data.get('coverImage', {}).get('extraLarge') or al_data.get('coverImage', {}).get('large')
            al_banner = al_data.get('bannerImage')
            al_desc = al_data.get('description')
            cur.execute('''
                UPDATE dramas
                SET anilist_id = ?,
                    cover_image = COALESCE(?, cover_image),
                    backdrop_image = COALESCE(?, backdrop_image),
                    overview = COALESCE(overview, ?)
                WHERE id = ?
            ''', (al_id, al_img, al_banner, al_desc, did))
            conn.commit()
            sync_match_to_supabase(did, {
                'anilist_id': al_id,
                'cover_image': al_img,
                'backdrop_image': al_banner,
                'overview': al_desc
            })
            matched_count += 1
            print(f"[{idx}/{total_unmatched}] ANILIST MATCH -> ID {did}: '{title}' -> AniList ID {al_id}")
            continue

        # Step 2: TMDb
        tmdb_res = search_tmdb(q, year, country, ctype)
        if tmdb_res:
            tmdb_id, mtype, cand = tmdb_res
            existing_tmdb = cur.execute("SELECT id, title FROM dramas WHERE tmdb_id = ? AND id != ?", (tmdb_id, did)).fetchone()
            if existing_tmdb:
                print(f"[{idx}/{total_unmatched}] TMDB DUPLICATE GUARD -> ID {did} '{title}' matches existing #{existing_tmdb[0]} '{existing_tmdb[1]}' (TMDb ID {tmdb_id}). Skipping assignment.")
                continue
            details = fetch_tmdb_details(tmdb_id, mtype) or cand
            imdb_id = details.get('external_ids', {}).get('imdb_id') or details.get('imdb_id')
            poster = f"https://image.tmdb.org/t/p/w500{details.get('poster_path')}" if details.get('poster_path') else None
            backdrop = f"https://image.tmdb.org/t/p/original{details.get('backdrop_path')}" if details.get('backdrop_path') else None
            overview = details.get('overview')
            vote_avg = details.get('vote_average')

            cur.execute('''
                UPDATE dramas
                SET tmdb_id = ?,
                    imdb_id = COALESCE(?, imdb_id),
                    cover_image = COALESCE(cover_image, ?),
                    backdrop_image = COALESCE(backdrop_image, ?),
                    overview = COALESCE(overview, ?)
                WHERE id = ?
            ''', (tmdb_id, imdb_id, poster, backdrop, overview, did))
            conn.commit()

            sb_payload = {'tmdb_id': tmdb_id}
            if imdb_id:
                sb_payload['imdb_id'] = imdb_id
            if poster:
                sb_payload['cover_image'] = poster
            if backdrop:
                sb_payload['backdrop_image'] = backdrop
            if overview:
                sb_payload['overview'] = overview
            if vote_avg:
                sb_payload['tmdb_vote'] = vote_avg

            sync_match_to_supabase(did, sb_payload)
            matched_count += 1
            print(f"[{idx}/{total_unmatched}] TMDB MATCH -> ID {did}: '{title}' -> TMDb {mtype.upper()} {tmdb_id} (IMDb: {imdb_id})")
        else:
            if idx % 50 == 0:
                print(f"[{idx}/{total_unmatched}] İlerleme... (Eşleşen: {matched_count})")

        # Rate-limiting cushion
        time.sleep(0.08)

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    print(f"\nİşlem tamamlandı! Toplam {matched_count}/{total_unmatched} seri başarıyla eşleştirildi ve veritabanı/Supabase güncellendi.")

if __name__ == '__main__':
    main()
