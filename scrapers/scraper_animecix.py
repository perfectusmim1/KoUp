import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import os
import sys
import time
import json
import re
import base64
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from curl_cffi import requests

# Force UTF-8 and unbuffered output so Windows cp1254 terminal never crashes on Japanese / special characters
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
DB_PATH = os.path.join(ROOT_DIR, 'webdrama_archive.db')
KEY_RAW = b'i4C7R2fXGocdYgFLzCbDlsJjukf8G58b'
AES_GCM = AESGCM(KEY_RAW)

def make_header(query_str: str) -> str:
    """Generates the proprietary X-E-H AES-GCM 256 authentication header for AnimeciX API."""
    iv = os.urandom(12)
    plaintext = ('{version}' + query_str).encode('utf-8')
    ciphertext = AES_GCM.encrypt(iv, plaintext, None)
    ct_b64 = base64.b64encode(ciphertext).decode('ascii')
    iv_b64 = base64.b64encode(iv).decode('ascii')
    return f'{ct_b64}.{iv_b64}'

def normalize_title(title: str) -> str:
    if not title:
        return ""
    t = title.lower()
    t = re.sub(r'[\(\)\[\]\{\}\:\-\_\.\,\!\?\'\"\/\\\&]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def clean_provider(name: str, url: str) -> str:
    url_low = (url or '').lower()
    name_low = (name or '').lower()
    if 'tau-video' in url_low or 'tau-video' in name_low:
        return 'tau-video'
    if 'sibnet.ru' in url_low:
        return 'sibnet'
    if 'ok.ru' in url_low:
        return 'ok.ru'
    if 'drive.google.com' in url_low:
        return 'googledrive'
    if 'mega.nz' in url_low:
        return 'mega'
    if 'dailymotion.com' in url_low:
        return 'dailymotion'
    if 'dood' in url_low:
        return 'doodstream'
    if 'uqload' in url_low:
        return 'uqload'
    if 'mp4upload' in url_low:
        return 'mp4upload'
    if 'myvi' in url_low:
        return 'myvi'
    if 'sendvid' in url_low:
        return 'sendvid'
    if 'mail.ru' in url_low:
        return 'mail.ru'
    if name_low:
        return name_low.replace(' ', '')
    return 'embed'

def fetch_catalog_page(page: int, per_page: int = 100, retries: int = 3):
    qs = f'onlyStreamable=true&page={page}&perPage={per_page}'
    for attempt in range(retries):
        try:
            h = make_header(qs)
            r = requests.get(
                f'https://animecix.tv/secure/titles?{qs}',
                headers={'X-E-H': h, 'Accept': 'application/json'},
                impersonate='chrome120',
                timeout=15
            )
            if r.status_code == 200:
                data = r.json().get('pagination', {})
                return data.get('data', []), data.get('last_page', 1), data.get('total', 0)
        except Exception as e:
            if attempt == retries - 1:
                print(f"[UYARI] Katalog sayfa {page} alinamadi: {e}", flush=True)
            time.sleep(1)
    return [], 1, 0

def fetch_title_all_videos(title_id: int, retries: int = 3):
    all_videos = []
    page = 1
    while True:
        qs = f'titleId={title_id}&page={page}&perPage=200'
        success = False
        for attempt in range(retries):
            try:
                h = make_header(qs)
                r = requests.get(
                    f'https://animecix.tv/secure/videos?{qs}',
                    headers={'X-E-H': h, 'Accept': 'application/json'},
                    impersonate='chrome120',
                    timeout=15
                )
                if r.status_code == 200:
                    data = r.json().get('pagination', {})
                    videos = data.get('data', [])
                    all_videos.extend(videos)
                    last_page = data.get('last_page', 1)
                    if page >= last_page:
                        return all_videos
                    page += 1
                    success = True
                    break
            except Exception as e:
                time.sleep(0.5)
        if not success:
            break
    return all_videos

def build_db_indexes(conn: sqlite3.Connection):
    cur = conn.cursor()
    print("[1/3] Veritabani arama indeksleri hazirlaniyor...", flush=True)
    
    # anilist_id index
    cur.execute("SELECT id, anilist_id FROM dramas WHERE anilist_id IS NOT NULL AND anilist_id > 0")
    anilist_map = {row[1]: row[0] for row in cur.fetchall()}
    
    # imdb_id index
    cur.execute("SELECT id, imdb_id FROM dramas WHERE imdb_id IS NOT NULL AND imdb_id != ''")
    imdb_map = {row[1]: row[0] for row in cur.fetchall()}
    
    # Normalized title map for anime / existing dramas
    cur.execute("SELECT id, title, native_title, release_year, content_type FROM dramas")
    title_map = {}
    for drama_id, title, native_title, year, ctype in cur.fetchall():
        if title:
            norm = normalize_title(title)
            if norm:
                title_map[norm] = drama_id
                if year:
                    title_map[f"{norm}_{year}"] = drama_id
        if native_title:
            norm_nat = normalize_title(native_title)
            if norm_nat:
                title_map[norm_nat] = drama_id
                
    # Done titles
    cur.execute("SELECT url FROM site_done WHERE site = 'animecix'")
    done_set = set(row[0] for row in cur.fetchall())
    
    print(f"      Indeksler yuklendi: {len(anilist_map)} AniList, {len(imdb_map)} IMDb, {len(title_map)} Baslik referansi, {len(done_set)} daha once tamamlanmis.", flush=True)
    return anilist_map, imdb_map, title_map, done_set

def main():
    print("=" * 70, flush=True)
    print("           ANIMECIX ARSIV CEKICI & ENTEGRASYON SISTEMI", flush=True)
    print("=" * 70, flush=True)
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    
    anilist_map, imdb_map, title_map, done_set = build_db_indexes(conn)
    
    # Phase 1: Fetch Catalog
    print("\n[2/3] AnimeciX Katalogu taraniyor (sayfalar 1..N)...", flush=True)
    catalog = []
    first_page_data, last_page, total_count = fetch_catalog_page(1, per_page=100)
    catalog.extend(first_page_data)
    print(f"      Toplam stream edilebilir anime: {total_count} ({last_page} sayfa)", flush=True)
    
    # Fetch remaining pages concurrently
    if last_page > 1:
        with ThreadPoolExecutor(max_workers=8) as ex:
            futures = {ex.submit(fetch_catalog_page, p, 100): p for p in range(2, last_page + 1)}
            for f in as_completed(futures):
                p = futures[f]
                page_data, _, _ = f.result()
                catalog.extend(page_data)
                sys.stdout.write(f"\r      Katalog indiriliyor: {len(catalog)}/{total_count} anime (%{len(catalog)*100/total_count:.1f})")
                sys.stdout.flush()
    print(f"\r      Katalog tamamlandi! Toplam {len(catalog)} anime basligi hafizaya alindi.          \n", flush=True)
    
    # Phase 2: Ingest and merge anime videos into SQLite
    print("[3/3] AnimeciX bolumleri ve video kaynaklari arsive aktariliyor...\n", flush=True)
    
    total_processed = 0
    total_merged = 0
    total_new = 0
    total_episodes_added = 0
    total_sources_added = 0
    start_time = time.time()
    
    # Cache for episode IDs: (drama_id, season, episode) -> ep_id
    cur = conn.cursor()
    cur.execute("SELECT id, drama_id, season_number, episode_number FROM episodes")
    episode_cache = {(row[1], row[2], row[3]): row[0] for row in cur.fetchall()}
    
    # Cache for existing sources: (episode_id, direct_url)
    cur.execute("SELECT episode_id, direct_url FROM episode_sources WHERE direct_url IS NOT NULL")
    source_cache = set((row[0], row[1]) for row in cur.fetchall())
    
    # Filter out already done titles
    remaining_catalog = [item for item in catalog if f"title_{item.get('id')}" not in done_set]
    already_done_count = len(catalog) - len(remaining_catalog)
    if already_done_count > 0:
        print(f"      Daha once cekilmis {already_done_count} anime atlaniyor, kalan: {len(remaining_catalog)} anime.\n", flush=True)
        total_processed = already_done_count
    
    def process_anime(item):
        """Worker function to fetch videos and prepare DB actions for an anime."""
        title_id = item.get('id')
        videos = fetch_title_all_videos(title_id)
        return item, videos

    # Process in batches of 20 with concurrent video fetching
    batch_size = 20
    for i in range(0, len(remaining_catalog), batch_size):
        batch = remaining_catalog[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(process_anime, batch))
            
        for item, videos in results:
            total_processed += 1
            title_id = item.get('id')
            raw_name = item.get('name') or 'Bilinmeyen Anime'
            name_en = item.get('name_english') or ''
            name_rom = item.get('name_romanji') or ''
            orig_name = item.get('original_title') or ''
            year = item.get('year')
            anilist_id = item.get('anilist_id') or 0
            imdb_id = item.get('imdb_id') or None
            
            # Safe display name
            display_name = raw_name[:26].encode('ascii', 'replace').decode('ascii')
            
            # 1. Check for match
            matched_drama_id = None
            match_reason = ""
            
            if anilist_id and anilist_id > 0 and anilist_id in anilist_map:
                matched_drama_id = anilist_map[anilist_id]
                match_reason = f"AniList:{anilist_id}"
            elif imdb_id and imdb_id in imdb_map:
                matched_drama_id = imdb_map[imdb_id]
                match_reason = f"IMDb:{imdb_id}"
            else:
                # Title normalization check
                candidates = [raw_name, name_en, name_rom, orig_name]
                for c in candidates:
                    if not c:
                        continue
                    norm = normalize_title(c)
                    if year and f"{norm}_{year}" in title_map:
                        matched_drama_id = title_map[f"{norm}_{year}"]
                        match_reason = f"Title+Year"
                        break
                    if norm in title_map:
                        matched_drama_id = title_map[norm]
                        match_reason = f"Title"
                        break
            
            # Filter valid full episodes (skip trailers)
            full_videos = [
                v for v in videos 
                if v.get('category') == 'full' or (v.get('episode_num') is not None and v.get('category') != 'trailer')
            ]
            
            sources_this_anime = 0
            episodes_this_anime = 0
            
            if matched_drama_id:
                # Merge into existing drama
                drama_id = matched_drama_id
                total_merged += 1
                
                # Update alt_sites to include animecix
                cur.execute("SELECT alt_sites, anilist_id, imdb_id FROM dramas WHERE id = ?", (drama_id,))
                d_row = cur.fetchone()
                if d_row:
                    current_alt = []
                    try:
                        current_alt = json.loads(d_row[0]) if d_row[0] else []
                    except:
                        pass
                    if 'animecix' not in current_alt:
                        current_alt.append('animecix')
                        upd_anilist = d_row[1] or (anilist_id if anilist_id > 0 else None)
                        upd_imdb = d_row[2] or imdb_id
                        cur.execute(
                            "UPDATE dramas SET alt_sites = ?, anilist_id = ?, imdb_id = ? WHERE id = ?",
                            (json.dumps(current_alt), upd_anilist, upd_imdb, drama_id)
                        )
            else:
                # Insert as a new anime drama
                total_new += 1
                slug = slugify(raw_name) + f"-animecix-{title_id}"
                source_url = f"https://animecix.tv/titles/{title_id}"
                cover_image = item.get('poster') or None
                overview = item.get('description') or None
                genres_list = [g.get('name') for g in item.get('genres', []) if g.get('name')]
                categories = json.dumps(genres_list, ensure_ascii=False) if genres_list else None
                ep_count_str = str(item.get('episode_count') or len(set(v.get('episode_num') for v in full_videos)))
                
                cur.execute("""
                    INSERT INTO dramas (
                        slug, title, native_title, source_url, cover_image, country, country_name,
                        release_year, episode_count, overview, categories, content_type,
                        anilist_id, anilist_url, imdb_id, alt_sites
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    slug, raw_name, orig_name or name_rom or None, source_url, cover_image, 'JP', 'Japonya',
                    str(year) if year else None, ep_count_str, overview, categories, 'anime',
                    anilist_id if anilist_id > 0 else None,
                    f"https://anilist.co/anime/{anilist_id}" if anilist_id > 0 else None,
                    imdb_id,
                    json.dumps(['animecix'])
                ))
                drama_id = cur.lastrowid
                
                # Update maps so subsequent duplicate seasons match
                if anilist_id and anilist_id > 0:
                    anilist_map[anilist_id] = drama_id
                if imdb_id:
                    imdb_map[imdb_id] = drama_id
                norm_name = normalize_title(raw_name)
                if norm_name:
                    title_map[norm_name] = drama_id
            
            # Now insert / merge episodes and sources
            for v in full_videos:
                s_num = v.get('season_num') or 1
                try:
                    e_num = int(v.get('episode_num') or 1)
                except:
                    e_num = 1
                
                ep_key = (drama_id, s_num, e_num)
                s1_key = (drama_id, 1, e_num)
                if ep_key in episode_cache:
                    ep_id = episode_cache[ep_key]
                elif s1_key in episode_cache:
                    ep_id = episode_cache[s1_key]
                else:
                    # Check database for Season 1 episode with same episode_number
                    cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = 1 AND episode_number = ?", (drama_id, e_num))
                    s1_row = cur.fetchone()
                    if s1_row:
                        ep_id = s1_row[0]
                        episode_cache[s1_key] = ep_id
                    else:
                        target_s = 1 if s_num > 1 and not cur.execute("SELECT 1 FROM episodes WHERE drama_id = ? AND season_number = ?", (drama_id, s_num)).fetchone() else s_num
                        ep_name = f"{target_s}. Sezon {e_num}. Bolum"
                        ep_url = f"https://animecix.tv/titles/{title_id}/season/{s_num}/episode/{e_num}"
                        cur.execute("""
                            INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type, sources_scraped)
                            VALUES (?, ?, ?, ?, ?, ?, 1)
                        """, (drama_id, target_s, e_num, ep_name, ep_url, 'bolum'))
                        ep_id = cur.lastrowid
                        episode_cache[(drama_id, target_s, e_num)] = ep_id
                        episodes_this_anime += 1
                        total_episodes_added += 1
                
                # Check source
                direct_url = v.get('url') or ''
                if direct_url and (ep_id, direct_url) not in source_cache:
                    src_name = v.get('name') or 'Tau Video'
                    provider = clean_provider(src_name, direct_url)
                    fansub = v.get('extra') or None
                    cur.execute("""
                        INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site)
                        VALUES (?, ?, ?, ?, ?, ?, 'animecix')
                    """, (ep_id, src_name, str(v.get('id') or ''), direct_url, provider, fansub))
                    source_cache.add((ep_id, direct_url))
                    sources_this_anime += 1
                    total_sources_added += 1
                    
            # Record into site_done
            cur.execute("INSERT OR IGNORE INTO site_done (site, url) VALUES ('animecix', ?)", (f"title_{title_id}",))
            
            # Live Terminal Output for each anime
            pct = total_processed * 100.0 / len(catalog)
            elapsed = time.time() - start_time
            speed = (total_processed - already_done_count) / elapsed if elapsed > 0 else 0
            status_tag = f"MERGED [{match_reason}]" if matched_drama_id else "NEW ANIME"
            print(
                f"[{total_processed}/{len(catalog)} - %{pct:.1f}] "
                f"ID:{title_id} \"{display_name}\" -> {status_tag} | "
                f"+{sources_this_anime} kaynak (+{episodes_this_anime} blm) | "
                f"Yeni:{total_new} Birlesen:{total_merged} Toplam Kaynak:{total_sources_added} ({speed:.1f} anime/sn)",
                flush=True
            )
            
        # Commit every batch
        conn.commit()
        
    conn.commit()
    conn.close()
    
    total_time = time.time() - start_time
    print("\n" + "=" * 70, flush=True)
    print("           ANIMECIX CEKIMI BASARIYLA TAMAMLANDI!", flush=True)
    print("=" * 70, flush=True)
    print(f"Toplam Islenen Anime:      {total_processed}", flush=True)
    print(f"Mevcut Serilerle Birlesen: {total_merged}", flush=True)
    print(f"Yeni Eklenen Animeler:     {total_new}", flush=True)
    print(f"Eklenen Yeni Bolumler:     {total_episodes_added}", flush=True)
    print(f"Eklenen Video Kaynaklari:  {total_sources_added}", flush=True)
    print(f"Gecen Sure:                {total_time:.1f} saniye", flush=True)
    print("=" * 70 + "\n", flush=True)

if __name__ == '__main__':
    main()
