"""
DiziBOX Missing Archive Sync Pipeline
Synchronizes all missing series from DiziBOX (737 uncreated + 1461 needing DBX Pro streams)
Extracts 1080p Full HD DBX Pro HLS (dbx.molystream.org/embed/sheila/<id>)
Labels sources cleanly as 'Orijinal'
"""

import sys
import os
import re
import json
import time
import asyncio
import aiohttp
import sqlite3
from bs4 import BeautifulSoup
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')
PROGRESS_FILE = os.path.join(_ROOT, 'dizibox_missing_progress.json')
MISSING_FILE = os.path.join(_ROOT, 'dizibox_really_missing.json')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': 'https://www.dizibox.live/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()

def save_progress(done_set):
    try:
        with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
            json.dump(list(done_set), f)
    except Exception as e:
        print(f"Error saving progress: {e}")

async def fetch_html(session, url, sem, referer=None):
    async with sem:
        h = dict(HEADERS)
        if referer:
            h['Referer'] = referer
        for attempt in range(2):
            try:
                async with session.get(url, headers=h, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status == 200:
                        return await r.text(errors='ignore')
                    elif r.status in (404, 410):
                        return None
            except Exception:
                await asyncio.sleep(0.5)
        return None

def extract_series_metadata(html, slug, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else slug.replace('-', ' ').title()
    title = re.sub(r'\s*(izle|hd izle|dizi izle).*$', '', title, flags=re.I).strip()
    
    cover = None
    og = soup.find('meta', attrs={'property': 'og:image'})
    if og and og.get('content'):
        cover = og['content']
    elif soup.find('img', class_=lambda c: c and 'poster' in c):
        cover = soup.find('img', class_=lambda c: c and 'poster' in c).get('src')
        
    year = str(datetime.now().year)
    my = re.search(r'(19\d\d|20\d\d)', soup.get_text()[:2500])
    if my:
        year = my.group(0)
        
    overview = None
    desc_elem = soup.find(class_=lambda c: c and ('overview' in c or 'summary' in c or 'aciklama' in c or 'content' in c))
    if desc_elem:
        overview = desc_elem.get_text(strip=True)
    if not overview:
        overview = f"{title} DiziBOX üzerinden arşive eklendi."
        
    return {
        'title': title,
        'cover': cover or '/logo-dark.png',
        'year': year,
        'overview': overview
    }

def extract_episode_links(series_html, base_slug):
    if not series_html:
        return []
    soup = BeautifulSoup(series_html, 'html.parser')
    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        if '-sezon-' in href and '-bolum' in href:
            m = re.search(r'/([^/]+)-(\d+)-sezon-(\d+)-bolum', href)
            if m:
                s_slug = m.group(1)
                if s_slug in base_slug or base_slug in s_slug:
                    s_num = int(m.group(2))
                    e_num = int(m.group(3))
                    if (s_num, e_num) not in seen:
                        seen.add((s_num, e_num))
                        ep_links.append((s_num, e_num, href))
    ep_links.sort(key=lambda x: (x[0], x[1]))
    return ep_links

async def extract_dbx_stream(session, ep_url, sem):
    html = await fetch_html(session, ep_url, sem, referer='https://www.dizibox.live/')
    if not html:
        return None

    m_king = re.search(r'src=["\'](https://www\.dizibox\.live/player/king/king\.php\?v=[^"\']+)["\']', html)
    if not m_king:
        return None

    king_url = m_king.group(1)
    king_html = await fetch_html(session, king_url, sem, referer=ep_url)
    if not king_html:
        return None

    m_moly = re.search(r'src=["\'](https://dbx\.molystream\.org/embed/[^"\']+)["\']', king_html)
    if not m_moly:
        return None

    embed_url = m_moly.group(1)
    m_id = re.search(r'/embed/([a-zA-Z0-9-]+)', embed_url)
    if not m_id:
        return None

    video_id = m_id.group(1)
    return {
        'video_id': video_id,
        'hls_url': f"https://dbx.molystream.org/embed/sheila/{video_id}"
    }

def create_drama_if_not_exists(conn, slug, url, meta):
    c = conn.cursor()
    c.execute("SELECT id FROM dramas WHERE slug = ? OR source_url = ?", (slug, url))
    row = c.fetchone()
    if row:
        return row[0]
        
    c_slug = slug
    suffix = 1
    while True:
        c.execute("SELECT id FROM dramas WHERE slug = ?", (c_slug,))
        if not c.fetchone():
            break
        c_slug = f"{slug}-{suffix}"
        suffix += 1

    try:
        c.execute("""
            INSERT INTO dramas (title, slug, content_type, country, release_year, status_broadcast, cover_image, overview, source_url)
            VALUES (?, ?, 'dizi', 'US', ?, 'completed', ?, ?, ?)
        """, (meta['title'], c_slug, meta['year'], meta['cover'], meta['overview'], url))
        return c.lastrowid
    except sqlite3.IntegrityError:
        c.execute("SELECT id FROM dramas WHERE slug = ? OR source_url = ?", (c_slug, url))
        r = c.fetchone()
        return r[0] if r else None

def save_dbx_source(conn, drama_id, season, episode, ep_url, stream_info):
    c = conn.cursor()
    c.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
              (drama_id, season, episode))
    row = c.fetchone()
    if row:
        ep_id = row[0]
    else:
        c.execute("SELECT id FROM episodes WHERE episode_url = ?", (ep_url,))
        url_row = c.fetchone()
        if url_row:
            ep_id = url_row[0]
        else:
            try:
                c.execute("""
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                    VALUES (?, ?, ?, ?, ?, 1)
                """, (drama_id, season, episode, f"{episode}. Bölüm", ep_url))
                ep_id = c.lastrowid
            except sqlite3.IntegrityError:
                c.execute("SELECT id FROM episodes WHERE episode_url = ?", (ep_url,))
                ep_id = c.fetchone()[0]

    embed_id = f"dbx_{stream_info['video_id']}"
    c.execute("""
        INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
        VALUES (?, 'Orijinal', ?, ?, 'dbx', 'dizibox')
        ON CONFLICT(episode_id, embed_id) DO UPDATE SET
            direct_url = excluded.direct_url,
            source_name = 'Orijinal',
            provider = 'dbx'
    """, (ep_id, embed_id, stream_info['hls_url']))

async def main(concurrency=8, limit=None):
    print("="*65)
    print("Starting DiziBOX Missing Archive Migration...")
    print("="*65)

    if not os.path.exists(MISSING_FILE):
        print(f"Error: {MISSING_FILE} not found!")
        return

    with open(MISSING_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    uncreated = data.get('uncreated', [])
    needs_stream = data.get('needs_stream', [])

    done_slugs = load_progress()
    print(f"Found {len(uncreated)} uncreated series, {len(needs_stream)} series needing DBX Pro stream.")
    print(f"Loaded {len(done_slugs)} already processed series from progress file.")

    all_tasks = []
    for item in uncreated:
        slug, url = item[0], item[1]
        if slug not in done_slugs:
            all_tasks.append(('uncreated', slug, url, None))

    for item in needs_stream:
        slug, url, did = item[0], item[1], item[2]
        if slug not in done_slugs:
            all_tasks.append(('needs_stream', slug, url, did))

    if limit:
        all_tasks = all_tasks[:limit]
        print(f"Applying limit: {limit} series.")

    print(f"Remaining series to process: {len(all_tasks)}")
    if not all_tasks:
        print("All missing DiziBOX series have already been migrated!")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA journal_mode=WAL;")

    sem = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency + 5, ssl=False)

    start_time = time.time()
    total_sources_added = 0
    series_processed = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        for mode, slug, series_url, did in all_tasks:
            html = await fetch_html(session, series_url, sem)
            if not html:
                # Try fallback url format /dizi/<slug>/ or /diziler/<slug>/
                alt_url = series_url.replace('/diziler/', '/dizi/') if '/diziler/' in series_url else series_url.replace('/dizi/', '/diziler/')
                html = await fetch_html(session, alt_url, sem)

            if not html:
                done_slugs.add(slug)
                series_processed += 1
                continue

            ep_links = extract_episode_links(html, slug)
            if not ep_links:
                done_slugs.add(slug)
                series_processed += 1
                continue

            async def process_ep(item):
                s_num, e_num, u = item
                stream = await extract_dbx_stream(session, u, sem)
                return s_num, e_num, u, stream

            ep_results = await asyncio.gather(*[process_ep(ep) for ep in ep_links])

            # Atomic fast write with retries
            added_for_series = 0
            for retry in range(10):
                try:
                    with conn:
                        if mode == 'uncreated':
                            meta = extract_series_metadata(html, slug, series_url)
                            drama_id = create_drama_if_not_exists(conn, slug, series_url, meta)
                        else:
                            drama_id = did

                        for s_num, e_num, ep_url, stream in ep_results:
                            if stream:
                                save_dbx_source(conn, drama_id, s_num, e_num, ep_url, stream)
                                added_for_series += 1
                    break
                except sqlite3.OperationalError:
                    await asyncio.sleep(1)

            total_sources_added += added_for_series
            series_processed += 1
            done_slugs.add(slug)

            if series_processed % 5 == 0 or series_processed == len(all_tasks):
                save_progress(done_slugs)
                elapsed = time.time() - start_time
                rate = series_processed / elapsed if elapsed > 0 else 0
                rem_time = (len(all_tasks) - series_processed) / rate if rate > 0 else 0
                pct = (series_processed / len(all_tasks)) * 100
                print(f"[DBX Missing Sync] {series_processed}/{len(all_tasks)} ({pct:.1f}%) | +{total_sources_added} sources | {rate:.2f} s/s | ETA: {rem_time/60:.1f}m")

    try:
        conn.cursor().execute("PRAGMA wal_checkpoint(PASSIVE);")
    except Exception:
        pass
    conn.close()
    print("="*65)
    print(f"DiziBOX Missing Sync Finished! +{total_sources_added} sources across {series_processed} series in {time.time()-start_time:.1f}s.")
    print("="*65)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--concurrency', type=int, default=8)
    parser.add_argument('--limit', type=int, default=None)
    args = parser.parse_args()

    asyncio.run(main(concurrency=args.concurrency, limit=args.limit))
