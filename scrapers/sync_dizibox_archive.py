"""
DiziBOX Full Archive Migration Pipeline
Synchronizes all series and episodes from DiziBOX into webdrama_archive.db
Extracts native DBX Pro (1080p Full HD HLS via dbx.molystream.org/embed/sheila/<id>)
Labels all sources as 'Orijinal'
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
import asyncio
import aiohttp
import sqlite3
import json
import re
import time
from bs4 import BeautifulSoup

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')
PROGRESS_FILE = os.path.join(_ROOT, 'dbx_sync_progress.json')

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
        for _ in range(2):
            try:
                async with session.get(url, headers=h, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status == 200:
                        return await r.text(errors='ignore')
                    elif r.status in (404, 410):
                        return None
            except Exception:
                await asyncio.sleep(0.4)
        return None

def extract_episode_links(series_html, base_slug):
    if not series_html:
        return []
    soup = BeautifulSoup(series_html, 'html.parser')
    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        href = a['href']
        if '-sezon-' in href and '-bolum' in href:
            # Avoid unrelated recent posts in sidebar: ensure slug or season matches
            m = re.search(r'/([^/]+)-(\d+)-sezon-(\d+)-bolum', href)
            if m:
                s_slug = m.group(1)
                # check if slug matches or closely relates
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

async def main(limit=None, concurrency=10):
    print("="*60)
    print("Starting DiziBOX DBX Pro Full Archive Migration...")
    print("="*60)

    with open('dizibox_strict_matches.json', 'r', encoding='utf-8') as f:
        matches = json.load(f)

    done_slugs = load_progress()
    print(f"Total matched DiziBOX series: {len(matches)}")
    print(f"Loaded {len(done_slugs)} already-processed series from checkpoint.")

    remaining_slugs = [(slug, info['drama_id'], info['matched_title']) for slug, info in matches.items() if slug not in done_slugs]
    if limit:
        remaining_slugs = remaining_slugs[:limit]
        print(f"Running with limit = {limit}")

    print(f"Remaining series to process: {len(remaining_slugs)}")
    if not remaining_slugs:
        print("All series already migrated!")
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
        for slug, drama_id, title in remaining_slugs:
            series_url = f"https://www.dizibox.live/dizi/{slug}/"
            html = await fetch_html(session, series_url, sem)
            if not html:
                # Try fallback url format /diziler/<slug>/
                series_url = f"https://www.dizibox.live/diziler/{slug}/"
                html = await fetch_html(session, series_url, sem)

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
            
            added_for_series = 0
            for s_num, e_num, ep_url, stream in ep_results:
                if stream:
                    save_dbx_source(conn, drama_id, s_num, e_num, ep_url, stream)
                    added_for_series += 1

            conn.commit()
            total_sources_added += added_for_series
            series_processed += 1
            done_slugs.add(slug)

            if series_processed % 10 == 0 or series_processed == len(remaining_slugs):
                save_progress(done_slugs)
                elapsed = time.time() - start_time
                rate = series_processed / elapsed if elapsed > 0 else 0
                rem_time = (len(remaining_slugs) - series_processed) / rate if rate > 0 else 0
                pct = (series_processed / len(remaining_slugs)) * 100
                print(f"[DBX Sync] {series_processed}/{len(remaining_slugs)} series ({pct:.1f}%) | +{total_sources_added} sources | {rate:.2f} series/s | ETA: {rem_time/60:.1f}m")

    save_progress(done_slugs)
    # Checkpoint WAL
    conn.cursor().execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()
    print("="*60)
    print(f"DiziBOX Sync completed! Added {total_sources_added} sources across {series_processed} series in {time.time()-start_time:.1f}s.")
    print("="*60)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--concurrency', type=int, default=10)
    args = parser.parse_args()

    asyncio.run(main(limit=args.limit, concurrency=args.concurrency))
