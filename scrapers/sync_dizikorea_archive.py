"""
DiziKorea Full Archive Migration Pipeline
Synchronizes all series episodes (22,310) and movies (392) from Dizikorea directly into webdrama_archive.db
Extracts native playerdkorea.xyz (1080p HLS), Vidmoly, and Filemoon.
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
import hashlib
from bs4 import BeautifulSoup

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')
PROGRESS_FILE = os.path.join(_ROOT, 'dk_sync_progress.json')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://dizikorea3.com/'
}

def identify_provider(url):
    u = url.lower()
    if 'playerdkorea' in u or 'playerkorea' in u:
        return 'dizikorea'
    if 'vidmoly' in u:
        return 'vidmoly'
    if 'filemoon' in u or 'bysedikamoum' in u:
        return 'filemoon'
    if 'sibnet' in u:
        return 'sibnet'
    return 'other'

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

async def fetch_html(session, url, sem):
    async with sem:
        for _ in range(2):
            try:
                async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status == 200:
                        return await r.text(errors='ignore')
                    elif r.status == 404:
                        return None
            except Exception:
                await asyncio.sleep(0.3)
        return None

def extract_sources_from_html(html):
    if not html:
        return []
    soup = BeautifulSoup(html, 'html.parser')
    found = []
    tabs = [t.get_text(strip=True) for t in soup.select('button.player-tab')]
    
    # Check player-source divs
    for i, div in enumerate(soup.select('div.player-source')):
        fr = div.find('iframe')
        if fr:
            src = fr.get('data-src') or fr.get('src')
            if src:
                src = src if src.startswith('http') else f"https:{src}"
                prov = identify_provider(src)
                name = tabs[i] if i < len(tabs) else prov.capitalize()
                found.append((prov, name, src))

    # Check all iframes if needed
    if not found:
        for fr in soup.find_all('iframe'):
            src = fr.get('data-src') or fr.get('src')
            if src:
                src = src if src.startswith('http') else f"https:{src}"
                prov = identify_provider(src)
                found.append((prov, prov.capitalize(), src))

    # Regex search for playerdkorea
    if not any(f[0] == 'dizikorea' for f in found):
        m = re.findall(r'(https?://(?:www\.)?playerdkorea\.xyz/video/[a-zA-Z0-9]+)', html)
        for u in set(m):
            found.append(('dizikorea', 'Dizikorea (1080p Full HD)', u))

    # Filter out dead cloakers and ok.ru
    valid = []
    seen = set()
    for prov, name, u in found:
        if u in seen:
            continue
        seen.add(u)
        lu = u.lower()
        if any(bad in lu for bad in ['4meplayer', 'p2pplay', 'rpmplay', 'uns.bio', 'ok.ru', 'odnoklassniki']):
            continue
        if prov == 'dizikorea':
            name = 'Dizikorea (1080p Full HD)'
        valid.append({
            'provider': prov,
            'source_name': name,
            'direct_url': u
        })
    return valid

def save_episode_sources(conn, drama_id, season, episode, ep_url, sources):
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

    for s in sources:
        h = hashlib.md5(s['direct_url'].encode()).hexdigest()[:10]
        embed_id = f"dk_{s['provider']}_{h}"
        c.execute("""
            INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
            VALUES (?, ?, ?, ?, ?, 'dizikorea')
            ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                direct_url = excluded.direct_url,
                source_name = excluded.source_name,
                provider = excluded.provider
        """, (ep_id, s['source_name'], embed_id, s['direct_url'], s['provider']))

def save_movie_sources(conn, drama_id, url, sources):
    c = conn.cursor()
    c.execute("SELECT id FROM episodes WHERE drama_id = ? AND episode_type = 'film' LIMIT 1", (drama_id,))
    row = c.fetchone()
    if row:
        ep_id = row[0]
    else:
        c.execute("SELECT id FROM episodes WHERE episode_url = ?", (url,))
        url_row = c.fetchone()
        if url_row:
            ep_id = url_row[0]
        else:
            try:
                c.execute("""
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type, sources_scraped)
                    VALUES (?, 1, 1, 'Film', ?, 'film', 1)
                """, (drama_id, url))
                ep_id = c.lastrowid
            except sqlite3.IntegrityError:
                c.execute("SELECT id FROM episodes WHERE episode_url = ?", (url,))
                ep_id = c.fetchone()[0]

    for s in sources:
        h = hashlib.md5(s['direct_url'].encode()).hexdigest()[:10]
        embed_id = f"dk_{s['provider']}_{h}"
        c.execute("""
            INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
            VALUES (?, ?, ?, ?, ?, 'dizikorea')
            ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                direct_url = excluded.direct_url,
                source_name = excluded.source_name,
                provider = excluded.provider
        """, (ep_id, s['source_name'], embed_id, s['direct_url'], s['provider']))

async def main(limit=None, concurrency=15, batch_size=40):
    print("="*60)
    print("Starting Dizikorea Full Archive Migration...")
    print("="*60)

    # 1. Load mappings
    with open('dk_slug_to_drama_id.json', 'r', encoding='utf-8') as f:
        slug_to_id = json.load(f)

    with open('dk_episodes_by_slug.json', 'r', encoding='utf-8') as f:
        by_slug = json.load(f)

    with open('dk_movies_mapped.json', 'r', encoding='utf-8') as f:
        movies_mapped = json.load(f)

    done_urls = load_progress()
    print(f"Loaded {len(done_urls)} already-processed URLs from checkpoint.")

    # Flatten all episodes
    all_episodes = []
    for slug, eps in by_slug.items():
        drama_id = slug_to_id.get(slug)
        if not drama_id:
            continue
        for ep in eps:
            if ep['url'] not in done_urls:
                all_episodes.append({
                    'type': 'episode',
                    'drama_id': drama_id,
                    'season': ep['season'],
                    'episode': ep['episode'],
                    'url': ep['url']
                })

    all_movies = []
    for m in movies_mapped:
        if m['url'] not in done_urls:
            all_movies.append({
                'type': 'movie',
                'drama_id': m['drama_id'],
                'url': m['url']
            })

    total_tasks = len(all_episodes) + len(all_movies)
    print(f"Remaining tasks: {len(all_episodes)} episodes, {len(all_movies)} movies (Total: {total_tasks})")

    tasks_to_run = all_episodes + all_movies
    if limit:
        tasks_to_run = tasks_to_run[:limit]
        print(f"Running with limit = {limit}")

    if not tasks_to_run:
        print("All items are already migrated! Nothing to do.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA journal_mode=WAL;")

    sem = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency + 5, ssl=False)
    
    start_time = time.time()
    total_sources_added = 0
    processed_count = 0

    async with aiohttp.ClientSession(connector=connector) as session:
        for i in range(0, len(tasks_to_run), batch_size):
            batch = tasks_to_run[i:i + batch_size]
            
            async def process_task(item):
                html = await fetch_html(session, item['url'], sem)
                srcs = extract_sources_from_html(html)
                return item, srcs

            results = await asyncio.gather(*[process_task(item) for item in batch])
            
            batch_sources = 0
            for item, srcs in results:
                if item['type'] == 'episode':
                    if srcs:
                        save_episode_sources(conn, item['drama_id'], item['season'], item['episode'], item['url'], srcs)
                        batch_sources += len(srcs)
                elif item['type'] == 'movie':
                    if srcs:
                        save_movie_sources(conn, item['drama_id'], item['url'], srcs)
                        batch_sources += len(srcs)
                done_urls.add(item['url'])

            conn.commit()
            total_sources_added += batch_sources
            processed_count += len(batch)

            if processed_count % (batch_size * 2) == 0 or processed_count == len(tasks_to_run):
                save_progress(done_urls)
                elapsed = time.time() - start_time
                rate = processed_count / elapsed if elapsed > 0 else 0
                remaining = (len(tasks_to_run) - processed_count) / rate if rate > 0 else 0
                pct = (processed_count / len(tasks_to_run)) * 100
                print(f"[DK Sync] {processed_count}/{len(tasks_to_run)} ({pct:.1f}%) | +{total_sources_added} sources | {rate:.1f} items/s | ETA: {remaining/60:.1f}m")

    save_progress(done_urls)
    conn.close()
    print("="*60)
    print(f"Dizikorea Sync finished! Added {total_sources_added} sources in {time.time()-start_time:.1f}s.")
    print("="*60)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--concurrency', type=int, default=15)
    args = parser.parse_args()

    asyncio.run(main(limit=args.limit, concurrency=args.concurrency))
