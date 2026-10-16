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
import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup
from curl_cffi import requests

# Force UTF-8 and unbuffered output so Windows console never crashes
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
DB_PATH = os.path.join(ROOT_DIR, 'webdrama_archive.db')

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
    if 'sibnet.ru' in url_low or 'sibnet' in name_low:
        return 'sibnet'
    if 'ok.ru' in url_low or 'ok' in name_low:
        return 'ok.ru'
    if 'drive.google.com' in url_low or 'gdrive' in name_low:
        return 'googledrive'
    if 'youtube.com' in url_low or 'youtu.be' in url_low:
        return 'youtube'
    if 'vidmoly' in url_low or 'vidmoly' in name_low or 'moly' in name_low:
        return 'vidmoly'
    if 'dood' in url_low or 'dood' in name_low:
        return 'doodstream'
    if 'uqload' in url_low or 'uqload' in name_low:
        return 'uqload'
    if 'mp4upload' in url_low:
        return 'mp4upload'
    if 'mail.ru' in url_low:
        return 'mail.ru'
    if 'mega.nz' in url_low or 'mega' in name_low:
        return 'mega'
    if 'voe.sx' in url_low or 'voe' in name_low:
        return 'voe'
    if 'rumble.com' in url_low or 'rumble' in name_low:
        return 'rumble'
    if 'dailymotion' in url_low:
        return 'dailymotion'
    if 'streamtape' in url_low:
        return 'streamtape'
    if 'mixdrop' in url_low:
        return 'mixdrop'
    if name_low:
        return name_low.replace(' ', '')
    return 'embed'

def decode_iframe_src(b64_val: str) -> str:
    if not b64_val:
        return ""
    try:
        decoded = base64.b64decode(b64_val).decode('utf-8', errors='ignore')
        m = re.search(r'src=["\']([^"\']+)["\']', decoded)
        if m:
            url = m.group(1)
        elif decoded.startswith('http') or decoded.startswith('//'):
            url = decoded
        else:
            return ""
        if url.startswith('//'):
            url = 'https:' + url
        return url.strip()
    except:
        pass
    return ""

def fetch_sitemap_series():
    series_urls = []
    for sm in ['series-sitemap.xml', 'series-sitemap2.xml']:
        try:
            url = f'https://asyaanimeleri.top/{sm}'
            r = requests.get(url, impersonate='chrome120', timeout=15)
            locs = re.findall(r'<loc>(https://asyaanimeleri\.top/series/[^<]+)</loc>', r.text)
            for l in locs:
                if l != 'https://asyaanimeleri.top/series/':
                    series_urls.append(l)
        except Exception as e:
            print(f"[UYARI] Sitemap alinamadi {sm}: {e}", flush=True)
    return list(dict.fromkeys(series_urls))

def fetch_episode_sources(ep_url: str):
    sources = []
    try:
        r = requests.get(ep_url, impersonate='chrome120', timeout=12)
        if r.status_code != 200:
            return sources
        soup = BeautifulSoup(r.text, 'html.parser')
        
        # 1. Select options with base64 encoded iframes
        select = soup.find('select', class_='mirror')
        if select:
            for opt in select.find_all('option'):
                src_name = opt.get_text(strip=True)
                val = opt.get('value')
                if not val or 'seç' in src_name.lower() or 'sec' in src_name.lower():
                    continue
                direct_url = decode_iframe_src(val)
                if direct_url:
                    sources.append({
                        'name': src_name,
                        'url': direct_url,
                        'provider': clean_provider(src_name, direct_url)
                    })
                    
        # 2. Direct iframes in player
        pembed = soup.find(id='pembed') or soup.find(class_='player-embed')
        if pembed:
            for ifr in pembed.find_all('iframe'):
                src = ifr.get('src')
                if src:
                    if src.startswith('//'):
                        src = 'https:' + src
                    if not any(s['url'] == src for s in sources):
                        sources.append({
                            'name': 'Player',
                            'url': src,
                            'provider': clean_provider('Player', src)
                        })
    except:
        pass
    return sources

def get_title_variants(raw_title: str):
    variants = set()
    t = raw_title.strip()
    variants.add(t)
    
    def repl_nd(m):
        n = m.group(1)
        suffix = 'th'
        if n == '1': suffix = 'st'
        elif n == '2': suffix = 'nd'
        elif n == '3': suffix = 'rd'
        return f'{n}{suffix} season'

    v_nd = re.sub(r'(\d+)\s*\.?\s*sezon[a-z]*', repl_nd, t, flags=re.I)
    variants.add(v_nd)
    
    v_s = re.sub(r'(\d+)\s*\.?\s*sezon[a-z]*', r'season \1', t, flags=re.I)
    variants.add(v_s)
    
    v_clean = re.sub(r'\s*\(\s*tv\s*\)', '', t, flags=re.I)
    variants.add(v_clean)

    res = set()
    for v in variants:
        norm = normalize_title(v)
        if norm:
            res.add(norm)
    return res

def parse_season_episode(title_or_url: str, num_str: str = ''):
    t = title_or_url.lower()
    s_num = 1
    e_num = 1
    
    m_season = re.search(r'(\d+)\s*[\.\-]?\s*sezon', t)
    if not m_season:
        m_season = re.search(r'season[\s\-]*(\d+)', t)
    if m_season:
        try:
            s_num = int(m_season.group(1))
        except:
            pass

    if num_str:
        num_clean = re.sub(r'[^\d\.]', '', num_str)
        if num_clean:
            try:
                e_num = int(float(num_clean))
                return s_num, e_num
            except:
                pass
            
    m_ep = re.search(r'(\d+)\s*[\.\-]?\s*b[oö]l[uü]m', t)
    if not m_ep:
        m_ep = re.search(r'episode[\s\-]*(\d+)', t)
    if m_ep:
        try:
            e_num = int(m_ep.group(1))
        except:
            pass
    return s_num, e_num

def fetch_single_series(s_url: str):
    """Fetches series page and all its episodes in parallel, returning cleanly structured data."""
    try:
        r = requests.get(s_url, impersonate='chrome120', timeout=15)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, 'html.parser')
        
        h1 = soup.find('h1')
        raw_title = h1.get_text(strip=True) if h1 else s_url.strip('/').split('/')[-1].replace('-', ' ').title()
        
        poster_el = soup.select_one('.thumb img, .poster img')
        poster = poster_el.get('src') if poster_el else None
        
        desc_el = soup.select_one('.entry-content, .synopsis, .desc')
        overview = desc_el.get_text(strip=True) if desc_el else None
        
        genres = [a.get_text(strip=True) for a in soup.select('a[href*="/genres/"]')]
        categories = json.dumps(genres, ensure_ascii=False) if genres else None
        
        year_el = soup.select_one('a[href*="/year/"]')
        year = year_el.get_text(strip=True) if year_el else None
        if not year:
            m_yr = re.search(r'\b(19\d\d|20\d\d)\b', r.text[:2000])
            if m_yr:
                year = m_yr.group(1)
        
        country_el = soup.select_one('a[href*="/country/"]')
        country_name = country_el.get_text(strip=True) if country_el else 'Japonya'
        country_code = 'JP' if 'japon' in country_name.lower() else ('KR' if 'kore' in country_name.lower() else 'CN')
        
        alt_el = soup.select_one('.alter, .alternative')
        alt_text = alt_el.get_text(strip=True) if alt_el else ''
        
        # Episode items
        ep_items = []
        eplister = soup.select_one('.eplister')
        if eplister:
            for li in eplister.select('li'):
                a = li.find('a')
                if not a or not a.get('href'):
                    continue
                href = a.get('href')
                num_el = li.select_one('.epl-num')
                raw_num = num_el.get_text(strip=True) if num_el else ''
                if '-' in raw_num and not raw_num.startswith('-'):
                    continue
                title_el = li.select_one('.epl-title')
                raw_ep_title = title_el.get_text(strip=True) if title_el else ''
                ep_items.append({
                    'url': href,
                    'num_str': raw_num,
                    'title_str': raw_ep_title
                })
                
        if not ep_items:
            for a in soup.find_all('a'):
                href = a.get('href')
                if href and '-bolum' in href and 'asyaanimeleri.top' in href:
                    if not any(e['url'] == href for e in ep_items):
                        ep_items.append({'url': href, 'num_str': '', 'title_str': ''})
                        
        def ep_sort_key(item):
            s, e = parse_season_episode(item['url'], item['num_str'])
            return (s, e)
        ep_items.sort(key=ep_sort_key)
        
        # Fetch episode sources in parallel
        def get_sources_worker(item):
            s_num, e_num = parse_season_episode(item['url'], item['num_str'])
            srcs = fetch_episode_sources(item['url'])
            return item, s_num, e_num, srcs

        ep_results = []
        if ep_items:
            with ThreadPoolExecutor(max_workers=min(12, len(ep_items))) as ex:
                ep_results = list(ex.map(get_sources_worker, ep_items))
                
        return {
            'url': s_url,
            'title': raw_title,
            'poster': poster,
            'overview': overview,
            'categories': categories,
            'year': year,
            'country_name': country_name,
            'country_code': country_code,
            'alt_text': alt_text,
            'ep_results': ep_results
        }
    except Exception as e:
        return {'url': s_url, 'error': str(e)}

def build_db_indexes(conn: sqlite3.Connection):
    cur = conn.cursor()
    print("[1/3] Veritabani arama indeksleri hazirlaniyor...", flush=True)
    
    cur.execute("SELECT id, anilist_id FROM dramas WHERE anilist_id IS NOT NULL AND anilist_id > 0")
    anilist_map = {row[1]: row[0] for row in cur.fetchall()}
    
    cur.execute("SELECT id, imdb_id FROM dramas WHERE imdb_id IS NOT NULL AND imdb_id != ''")
    imdb_map = {row[1]: row[0] for row in cur.fetchall()}
    
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
                
    cur.execute("SELECT url FROM site_done WHERE site = 'asyaanimeleri'")
    done_set = set(row[0] for row in cur.fetchall())
    
    print(f"      Indeksler yuklendi: {len(anilist_map)} AniList, {len(imdb_map)} IMDb, {len(title_map)} Baslik referansi, {len(done_set)} daha once tamamlanmis.", flush=True)
    return anilist_map, imdb_map, title_map, done_set

def main():
    print("=" * 70, flush=True)
    print("        ASYAANIMELERI.TOP ARSIV CEKICI & ENTEGRASYON SISTEMI", flush=True)
    print("=" * 70, flush=True)
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    
    anilist_map, imdb_map, title_map, done_set = build_db_indexes(conn)
    
    # Phase 1: Fetch series URLs
    print("\n[2/3] AsyaAnimeleri serileri sitemap'ten aliniyor...", flush=True)
    series_urls = fetch_sitemap_series()
    total_series = len(series_urls)
    print(f"      Toplam Seri Sayisi: {total_series}", flush=True)
    
    remaining_series = [u for u in series_urls if u not in done_set]
    already_done = total_series - len(remaining_series)
    if already_done > 0:
        print(f"      Daha once cekilmis {already_done} seri atlaniyor, kalan: {len(remaining_series)} seri.\n", flush=True)
    
    # Caches
    cur = conn.cursor()
    cur.execute("SELECT id, drama_id, season_number, episode_number FROM episodes")
    episode_cache = {}
    episodes_by_drama = {}
    for row in cur.fetchall():
        episode_cache[(row[1], row[2], row[3])] = row[0]
        if row[1] not in episodes_by_drama:
            episodes_by_drama[row[1]] = {}
        episodes_by_drama[row[1]][row[3]] = row[0]
    
    cur.execute("SELECT episode_id, direct_url FROM episode_sources WHERE direct_url IS NOT NULL")
    source_cache = set((row[0], row[1]) for row in cur.fetchall())
    
    print("[3/3] AsyaAnimeleri serileri ve bolumleri arsite aktariliyor (6 Eşzamanlı Seri Motoru)...\n", flush=True)
    
    total_processed = already_done
    total_merged = 0
    total_new = 0
    total_episodes_added = 0
    total_sources_added = 0
    start_time = time.time()
    
    # Parallel series fetcher with ordered queue
    with ThreadPoolExecutor(max_workers=6) as executor:
        # Submit tasks in batches of 24
        BATCH_SIZE = 24
        for batch_start in range(0, len(remaining_series), BATCH_SIZE):
            batch_urls = remaining_series[batch_start:batch_start + BATCH_SIZE]
            future_to_url = {executor.submit(fetch_single_series, u): u for u in batch_urls}
            
            for future in as_completed(future_to_url):
                u = future_to_url[future]
                total_processed += 1
                try:
                    data = future.result()
                    if not data or 'error' in data:
                        continue
                    
                    raw_title = data['title']
                    s_url = data['url']
                    poster = data['poster']
                    overview = data['overview']
                    categories = data['categories']
                    year = data['year']
                    country_name = data['country_name']
                    country_code = data['country_code']
                    alt_text = data['alt_text']
                    ep_results = data['ep_results']
                    
                    # Matching logic
                    matched_drama_id = None
                    match_reason = ""
                    
                    variants = get_title_variants(raw_title)
                    if alt_text:
                        for part in re.split(r'[,;|\n]', alt_text):
                            part_clean = part.strip()
                            if part_clean:
                                variants.update(get_title_variants(part_clean))
                    
                    # 1. Variant + Year
                    if year:
                        for v in variants:
                            if f"{v}_{year}" in title_map:
                                matched_drama_id = title_map[f"{v}_{year}"]
                                match_reason = f"Title+Year ({v[:12]})"
                                break
                    
                    # 2. Pure Variant
                    if not matched_drama_id:
                        for v in variants:
                            if v in title_map:
                                matched_drama_id = title_map[v]
                                match_reason = f"Title ({v[:12]})"
                                break
                        
                    if matched_drama_id:
                        drama_id = matched_drama_id
                        total_merged += 1
                        cur.execute("SELECT alt_sites FROM dramas WHERE id = ?", (drama_id,))
                        d_row = cur.fetchone()
                        if d_row:
                            current_alt = []
                            try:
                                current_alt = json.loads(d_row[0]) if d_row[0] else []
                            except:
                                pass
                            if 'asyaanimeleri' not in current_alt:
                                current_alt.append('asyaanimeleri')
                                cur.execute("UPDATE dramas SET alt_sites = ? WHERE id = ?", (json.dumps(current_alt), drama_id))
                    else:
                        total_new += 1
                        slug = slugify(raw_title) + f"-asyaanimeleri"
                        cur.execute("""
                            INSERT INTO dramas (
                                slug, title, source_url, cover_image, country, country_name,
                                release_year, episode_count, overview, categories, content_type, alt_sites
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'anime', ?)
                        """, (
                            slug, raw_title, s_url, poster, country_code, country_name,
                            year, str(len(ep_results)) if ep_results else None, overview, categories,
                            json.dumps(['asyaanimeleri'])
                        ))
                        drama_id = cur.lastrowid
                        norm_title = normalize_title(raw_title)
                        if norm_title:
                            title_map[norm_title] = drama_id
                            
                    sources_this_series = 0
                    episodes_this_series = 0
                    
                    for ep_item, s_num, e_num, ep_sources in ep_results:
                        ep_key = (drama_id, s_num, e_num)
                        
                        ep_id = None
                        if ep_key in episode_cache:
                            ep_id = episode_cache[ep_key]
                        elif drama_id in episodes_by_drama and e_num in episodes_by_drama[drama_id]:
                            ep_id = episodes_by_drama[drama_id][e_num]
                        else:
                            ep_name = ep_item['title_str'] or f"{s_num}. Sezon {e_num}. Bölüm"
                            cur.execute("""
                                INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type, sources_scraped)
                                VALUES (?, ?, ?, ?, ?, 'bolum', 1)
                            """, (drama_id, s_num, e_num, ep_name, ep_item['url']))
                            ep_id = cur.lastrowid
                            episode_cache[ep_key] = ep_id
                            if drama_id not in episodes_by_drama:
                                episodes_by_drama[drama_id] = {}
                            episodes_by_drama[drama_id][e_num] = ep_id
                            episodes_this_series += 1
                            total_episodes_added += 1
                            
                        for src in ep_sources:
                            d_url = src['url']
                            if d_url and (ep_id, d_url) not in source_cache:
                                embed_id = hashlib.md5(d_url.encode('utf-8')).hexdigest()[:16]
                                cur.execute("""
                                    INSERT OR IGNORE INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
                                    VALUES (?, ?, ?, ?, ?, 'asyaanimeleri')
                                """, (ep_id, src['name'], embed_id, d_url, src['provider']))
                                source_cache.add((ep_id, d_url))
                                sources_this_series += 1
                                total_sources_added += 1
                                
                    # Mark done
                    cur.execute("INSERT OR IGNORE INTO site_done (site, url) VALUES ('asyaanimeleri', ?)", (s_url,))
                    
                    pct = total_processed * 100.0 / total_series
                    elapsed = time.time() - start_time
                    speed = (total_processed - already_done) / elapsed if elapsed > 0 else 0
                    status_tag = f"MERGED [{match_reason}]" if matched_drama_id else "NEW ANIME"
                    safe_name = raw_title[:24].encode('ascii', 'replace').decode('ascii')
                    print(
                        f"[{total_processed}/{total_series} - %{pct:.1f}] "
                        f"\"{safe_name}\" -> {status_tag} | "
                        f"+{sources_this_series} kaynak (+{episodes_this_series} blm) | "
                        f"Yeni:{total_new} Birlesen:{total_merged} Toplam Kaynak:{total_sources_added} ({speed:.1f} seri/sn)",
                        flush=True
                    )
                except Exception as e:
                    print(f"[HATA] {u}: {e}", flush=True)
            
            # Commit after each batch of 24
            conn.commit()
            
    conn.commit()
    conn.close()
    
    total_time = time.time() - start_time
    print("\n" + "=" * 70, flush=True)
    print("        ASYAANIMELERI.TOP CEKIMI BASARIYLA TAMAMLANDI!", flush=True)
    print("=" * 70, flush=True)
    print(f"Toplam Islenen Seri:       {total_processed}", flush=True)
    print(f"Mevcut Serilerle Birlesen: {total_merged}", flush=True)
    print(f"Yeni Eklenen Seriler:      {total_new}", flush=True)
    print(f"Eklenen Yeni Bolumler:     {total_episodes_added}", flush=True)
    print(f"Eklenen Video Kaynaklari:  {total_sources_added}", flush=True)
    print(f"Gecen Sure:                {total_time:.1f} saniye", flush=True)
    print("=" * 70 + "\n", flush=True)

if __name__ == '__main__':
    main()
