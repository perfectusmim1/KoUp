import asyncio
import aiohttp
import sqlite3
import json
import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import argparse
import time
from collections import defaultdict

DEAD_DOMAINS = [
    'sibnet.ru', 'sendvid.com', 'pixeldrain.com', 'drive.google.com',
    'openload.co', 'streammango.com', 'rapidvideo.com', 'estream.to',
    'vid.me', 'cloudvideo.tv', 'wolfstream.tv', 'mystream.to',
    'vidmoly.me', 'fembed.com', 'feurl.com', 'suzihaza.com',
    'gounlimited.to', 'jetload.net', 'supervideo.tv', 'upstream.to',
    'mixdrop', '4meplayer', 'p2pplay', 'rpmplay', 'uns.bio',
    'playerdkorea.xyz', 'video.diziasya.com', 'parklogic', 'vtube.to',
    'highload.to', 'vadshar.com', 'viidshar.com', 'segavid.com',
    'upload.do', 'lylxan.com', 'embedrise.com', 'embedgram.com'
]

domain_cache = {}

def get_smart_headers(url, provider=''):
    u = url.lower()
    p = (provider or '').lower()
    ref = 'https://koup.app/'
    if 'hdfilmcehennemi' in u or 'rapidrame' in p or 'close' in p or 'rplayer' in u:
        ref = 'https://www.hdfilmcehennemi.nl/'
    elif 'pichive' in u or 'asyawatch' in p or 'dplayer' in u or 'hotlinger' in u:
        ref = 'https://asyawatch.com/'
    elif 'diziyou' in u or 'diziyou' in p:
        ref = 'https://www.diziyou.co/'
    elif 'dizibox' in u or 'dizibox' in p or 'dbx' in p:
        ref = 'https://www.dizibox.tv/'
    elif 'turkanime' in u or 'turkanime' in p:
        ref = 'https://www.turkanime.co/'
    elif 'animecix' in u or 'animecix' in p or 'tau-video' in p:
        ref = 'https://animecix.net/'
    elif 'webdrama' in u or 'upns' in u or 'playerp2p' in u or 'byse' in u:
        ref = 'https://webdramaturkey2.com/'
    elif 'mail.ru' in u or 'mail' in p:
        ref = 'https://my.mail.ru/'
    elif 'ok.ru' in u:
        ref = 'https://ok.ru/'

    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': ref
    }

async def test_source_url(session, url, sem, provider=''):
    if not url or url.startswith('javascript') or 'void(0)' in url:
        return 'invalid_url'
    
    u_lower = url.lower()
    for d in DEAD_DOMAINS:
        if d in u_lower:
            return f'known_dead_host:{d}'
    
    # Check domain cache
    domain = ''
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain in domain_cache:
            status, ts = domain_cache[domain]
            if status in ('connection_refused', 'dns_error') and time.time() - ts < 300:
                return status
    except Exception:
        pass

    headers = get_smart_headers(url, provider)

    async with sem:
        # Step 1: HEAD request
        try:
            async with session.head(url, headers=headers, timeout=aiohttp.ClientTimeout(total=4), allow_redirects=True) as resp:
                x_frame = resp.headers.get('x-frame-options', '').upper()
                if 'DENY' in x_frame:
                    return 'iframe_blocked_x_frame_deny'
                if resp.status in (200, 206, 301, 302, 307, 308):
                    return 'ok'
                elif resp.status == 404:
                    return 'http_404_not_found'
                elif resp.status == 403:
                    return 'http_403_forbidden'
                elif resp.status == 429:
                    await asyncio.sleep(1.0)
                    pass
                elif resp.status == 405: # Method Not Allowed, fallback to GET
                    pass
                elif resp.status >= 500:
                    return f'server_error_{resp.status}'
                else:
                    return f'http_{resp.status}'
        except asyncio.TimeoutError:
            return 'timeout'
        except aiohttp.ClientConnectorError:
            if domain:
                domain_cache[domain] = ('connection_refused', time.time())
            return 'connection_refused'
        except Exception:
            pass

        # Step 2: GET fallback
        try:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=5), allow_redirects=True) as resp:
                x_frame = resp.headers.get('x-frame-options', '').upper()
                if 'DENY' in x_frame:
                    return 'iframe_blocked_x_frame_deny'
                if resp.status in (200, 206, 301, 302, 307, 308):
                    return 'ok'
                elif resp.status == 404:
                    return 'http_404_not_found'
                elif resp.status == 403:
                    return 'http_403_forbidden'
                elif resp.status >= 500:
                    return f'server_error_{resp.status}'
                else:
                    return f'http_{resp.status}'
        except asyncio.TimeoutError:
            return 'timeout'
        except aiohttp.ClientConnectorError:
            if domain:
                domain_cache[domain] = ('connection_refused', time.time())
            return 'connection_refused'
        except Exception as e:
            return f'error_{type(e).__name__}'

def get_category_query(category):
    if category == 'korea':
        where = "(content_type = 'dizi' AND country = 'KR') OR (content_type = 'film' AND country = 'KR')"
    elif category == 'anime_jp':
        where = "content_type = 'anime' AND (country = 'JP' OR country IS NULL OR country = '')"
    elif category == 'anime_donghua':
        where = "content_type = 'anime' AND country != 'JP' AND country IS NOT NULL AND country != ''"
    elif category == 'asia_other':
        where = "content_type = 'dizi' AND country IN ('CN', 'TH', 'JP', 'TW', 'HK', 'PH')"
    elif category == 'western':
        where = "content_type = 'dizi' AND country NOT IN ('KR', 'CN', 'TH', 'JP', 'TW', 'HK', 'PH', 'TR') AND country IS NOT NULL AND country != ''"
    elif category == 'movies_tr':
        where = "(content_type = 'film' AND (country != 'KR' OR country IS NULL)) OR (content_type = 'dizi' AND country = 'TR') OR content_type = 'program'"
    else:
        raise ValueError(f"Unknown category: {category}")
    return where

async def audit_category(category, limit=None, concurrency=60):
    print(f"\n=======================================================")
    print(f"[*] STARTING AUDIT FOR CATEGORY: {category.upper()}")
    print(f"=======================================================")
    
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()
    
    where_clause = get_category_query(category)
    query = f"""
        SELECT id, slug, title, content_type, country, release_year, episode_count,
               tmdb_id, anilist_id, mydramalist_url, imdb_id
        FROM dramas
        WHERE {where_clause}
        ORDER BY id ASC
    """
    if limit:
        query += f" LIMIT {limit}"
        
    cur.execute(query)
    dramas = cur.fetchall()
    total_dramas = len(dramas)
    print(f"[+] Loaded {total_dramas} dramas in category '{category}'")

    if total_dramas == 0:
        print("[-] No dramas found.")
        conn.close()
        return

    drama_ids = [d[0] for d in dramas]
    id_placeholders = ",".join(str(i) for i in drama_ids)

    # Load episodes
    print(f"[+] Loading episodes for {total_dramas} dramas...")
    ep_query = f"""
        SELECT id, drama_id, season_number, episode_number, episode_name
        FROM episodes
        WHERE drama_id IN ({id_placeholders})
        ORDER BY drama_id, season_number, episode_number
    """
    cur.execute(ep_query)
    episodes = cur.fetchall()
    total_episodes = len(episodes)
    print(f"[+] Loaded {total_episodes} episodes")

    ep_by_drama = defaultdict(list)
    ep_ids = []
    for ep in episodes:
        ep_by_drama[ep[1]].append(ep)
        ep_ids.append(ep[0])

    # Load sources
    total_sources = 0
    sources_by_ep = defaultdict(list)
    if ep_ids:
        print(f"[+] Loading sources for {total_episodes} episodes...")
        # Chunk ep_ids in batches to avoid SQLite variable limit
        for i in range(0, len(ep_ids), 5000):
            chunk = ep_ids[i:i+5000]
            chunk_placeholders = ",".join(str(eid) for eid in chunk)
            src_query = f"""
                SELECT id, episode_id, provider, direct_url, source_name, site
                FROM episode_sources
                WHERE episode_id IN ({chunk_placeholders})
            """
            cur.execute(src_query)
            for src in cur.fetchall():
                sources_by_ep[src[1]].append(src)
                total_sources += 1
    print(f"[+] Loaded {total_sources} sources")
    conn.close()

    # Step A: Perform sequence gaps & ID verification
    print("[+] Analyzing sequence gaps and metadata IDs...")
    gapped_dramas = []
    zero_source_dramas = []
    zero_source_episodes_list = []
    missing_id_dramas = []
    
    # Collect all unique sources to test via network
    sources_to_test = [] # (src_id, ep_id, drama_id, provider, direct_url)

    for d in dramas:
        d_id, slug, title, c_type, country, year, ep_count_declared, tmdb_id, anilist_id, mdl_url, imdb_id = d
        d_eps = ep_by_drama.get(d_id, [])

        # ID checks
        missing_ids = []
        if not tmdb_id or str(tmdb_id) in ('0', ''):
            missing_ids.append('tmdb_id')
        if c_type == 'anime' and not anilist_id:
            missing_ids.append('anilist_id')
        if country in ('KR', 'CN', 'TH', 'JP') and c_type != 'anime' and not mdl_url:
            missing_ids.append('mydramalist_url')
        if missing_ids:
            missing_id_dramas.append({
                'id': d_id,
                'slug': slug,
                'title': title,
                'missing': missing_ids
            })

        # Episode sequence checks
        if not d_eps:
            zero_source_dramas.append({
                'id': d_id,
                'slug': slug,
                'title': title,
                'reason': 'no_episodes_found'
            })
            continue

        seasons = defaultdict(list)
        drama_has_any_source = False
        for ep in d_eps:
            eid, _, s_num, e_num, ep_name = ep
            seasons[s_num].append(e_num)
            ep_sources = sources_by_ep.get(eid, [])
            if ep_sources:
                drama_has_any_source = True
                for s in ep_sources:
                    sources_to_test.append((s[0], eid, d_id, s[2], s[3]))
            else:
                zero_source_episodes_list.append({
                    'drama_id': d_id,
                    'title': title,
                    'slug': slug,
                    'season': s_num,
                    'episode': e_num
                })

        if not drama_has_any_source:
            zero_source_dramas.append({
                'id': d_id,
                'slug': slug,
                'title': title,
                'reason': 'zero_sources_across_all_episodes'
            })

        # Gap detection
        if c_type not in ('film', 'movie'):
            for s_num, ep_list in seasons.items():
                if not ep_list:
                    continue
                unique_eps = sorted(set(ep_list))
                min_ep = min(unique_eps)
                max_ep = max(unique_eps)
                expected = set(range(min_ep, max_ep + 1))
                actual = set(unique_eps)
                missing = expected - actual
                if missing and len(missing) < 100: # filter anomalies
                    gapped_dramas.append({
                        'id': d_id,
                        'slug': slug,
                        'title': title,
                        'season': s_num,
                        'actual_count': len(unique_eps),
                        'expected_range': f"{min_ep}-{max_ep}",
                        'missing_episodes': sorted(list(missing))
                    })

    print(f"[+] Static analysis done: {len(gapped_dramas)} series with sequence gaps, {len(zero_source_dramas)} zero-source series, {len(missing_id_dramas)} missing-ID series.")
    print(f"[+] Unique sources to test over network: {len(sources_to_test)}")

    # Step B: Live Network Source Audit
    # Group by unique URLs to avoid duplicate network calls
    url_to_source_ids = defaultdict(list)
    for src in sources_to_test:
        url_to_source_ids[src[4]].append(src)

    unique_urls = list(url_to_source_ids.keys())
    print(f"[+] Unique URLs to verify: {len(unique_urls)} (Concurrency: {concurrency})")

    sem = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=concurrency + 20, ssl=False, ttl_dns_cache=300)
    
    url_status_map = {}
    completed = 0
    start_time = time.time()

    async with aiohttp.ClientSession(connector=connector) as session:
        async def worker(u):
            nonlocal completed
            provider = url_to_source_ids[u][0][3] if url_to_source_ids[u] else ''
            status = await test_source_url(session, u, sem, provider)
            url_status_map[u] = status
            completed += 1
            if completed % 1000 == 0 or completed == len(unique_urls):
                elapsed = time.time() - start_time
                rate = completed / max(1, elapsed)
                sys.stdout.write(f"\r[~] Tested {completed}/{len(unique_urls)} URLs ({completed/len(unique_urls)*100:.1f}%) - {rate:.1f} req/s")
                sys.stdout.flush()

        # Batch runner
        batch_size = 500
        for i in range(0, len(unique_urls), batch_size):
            batch = unique_urls[i:i+batch_size]
            await asyncio.gather(*(worker(u) for u in batch))

    print(f"\n[+] Live network testing completed in {time.time() - start_time:.1f} seconds!")

    # Step C: Aggregate source results per drama & episode
    print("[+] Aggregating incident metrics...")
    status_counts = defaultdict(int)
    broken_sources_list = []
    drama_health = defaultdict(lambda: {'total_sources': 0, 'dead_sources': 0, 'ok_sources': 0, 'fallback_triggers': 0})
    ep_health = defaultdict(lambda: {'total': 0, 'dead': 0, 'ok': 0})

    for u, status in url_status_map.items():
        status_counts[status] += len(url_to_source_ids[u])
        for src in url_to_source_ids[u]:
            src_id, ep_id, d_id, provider, _ = src
            drama_health[d_id]['total_sources'] += 1
            ep_health[ep_id]['total'] += 1
            if status == 'ok':
                drama_health[d_id]['ok_sources'] += 1
                ep_health[ep_id]['ok'] += 1
            else:
                drama_health[d_id]['dead_sources'] += 1
                ep_health[ep_id]['dead'] += 1
                if len(broken_sources_list) < 200: # sample up to 200 for report
                    broken_sources_list.append({
                        'source_id': src_id,
                        'drama_id': d_id,
                        'episode_id': ep_id,
                        'provider': provider,
                        'status': status,
                        'url': u
                    })

    # Episodes where all sources died (100% unplayable)
    completely_unplayable_episodes = [eid for eid, h in ep_health.items() if h['total'] > 0 and h['ok'] == 0]
    # Dramas where all sources died
    completely_unplayable_dramas = []
    for d in dramas:
        d_id = d[0]
        h = drama_health[d_id]
        if h['total_sources'] > 0 and h['ok_sources'] == 0:
            completely_unplayable_dramas.append({
                'id': d_id,
                'slug': d[1],
                'title': d[2],
                'total_sources': h['total_sources'],
                'dead_sources': h['dead_sources']
            })

    # Prepare export JSON
    output_data = {
        'category': category,
        'timestamp': time.strftime("%Y-%m-%d %H:%M:%S"),
        'summary': {
            'total_dramas': total_dramas,
            'total_episodes': total_episodes,
            'total_sources': total_sources,
            'tested_unique_urls': len(unique_urls),
            'sequence_gapped_dramas_count': len(gapped_dramas),
            'zero_source_dramas_count': len(zero_source_dramas),
            'missing_id_dramas_count': len(missing_id_dramas),
            'completely_unplayable_dramas_count': len(completely_unplayable_dramas),
            'completely_unplayable_episodes_count': len(completely_unplayable_episodes),
            'zero_source_episodes_count': len(zero_source_episodes_list)
        },
        'status_breakdown': dict(status_counts),
        'sequence_gaps': gapped_dramas[:100], # top 100 for subagent review
        'zero_source_dramas': zero_source_dramas[:100],
        'missing_id_dramas': missing_id_dramas[:100],
        'completely_unplayable_dramas': completely_unplayable_dramas[:100],
        'sample_broken_sources': broken_sources_list[:100]
    }

    os.makedirs('audit_reports', exist_ok=True)
    out_path = os.path.join('audit_reports', f'data_{category}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"\n[OK] Audit for '{category}' successfully written to: {out_path}")
    print(f"    - Dramas: {total_dramas} | Episodes: {total_episodes} | Sources: {total_sources}")
    print(f"    - Gapped Series: {len(gapped_dramas)} | Zero Source Series: {len(zero_source_dramas)}")
    print(f"    - Completely Unplayable Series: {len(completely_unplayable_dramas)}")
    print(f"    - Source Statuses: {dict(status_counts)}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Catalog Audit Engine")
    parser.add_argument("--category", required=True, choices=['korea', 'anime_jp', 'anime_donghua', 'asia_other', 'western', 'movies_tr'])
    parser.add_argument("--limit", type=int, default=None, help="Limit number of dramas for test")
    parser.add_argument("--concurrency", type=int, default=60, help="Async concurrency limit")
    args = parser.parse_args()

    asyncio.run(audit_category(args.category, limit=args.limit, concurrency=args.concurrency))
