import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import re
import json
import sqlite3
import urllib.request
import urllib.parse
from bs4 import BeautifulSoup

from scrapers.multisite import (
    norm_title,
    match_or_create_episode,
    add_source,
    safe_commit
)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
}

def fetch_html(url, referer=None, timeout=12):
    h = dict(HEADERS)
    if referer:
        h['Referer'] = referer
    req = urllib.request.Request(url, headers=h)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            if attempt == 2:
                print(f"Error fetching {url}: {e}")
            import time; time.sleep(1)
    return None

def test_sync_erkenci():
    conn = sqlite3.connect('webdrama_archive.db')
    conn.execute("PRAGMA busy_timeout=60000;")
    cur = conn.cursor()

    cur.execute("SELECT id, title, slug, country, content_type, source_url FROM dramas WHERE slug = 'erkenci-kus' OR id = 31860")
    drama = cur.fetchone()
    print("Target drama:", drama)
    drama_id = drama[0]
    detail_url = drama[5] # https://www.ddizi.tel/diziler/1694/erkenci-kus-hd05
    print("Detail URL:", detail_url)

    detail_html = fetch_html(detail_url)
    if not detail_html:
        print("Failed to fetch detail_url")
        return

    soup = BeautifulSoup(detail_html, 'html.parser')
    
    # 1. Discover all pagination pages
    pages = set([detail_url])
    m_base = re.search(r'/diziler/(\d+)/', detail_url)
    dizi_pattern = m_base.group(0) if m_base else None

    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/sayfa-' in h or '/sayfa/' in h:
            if not dizi_pattern or dizi_pattern in h:
                full_p = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                pages.add(full_p)

    found_nums = [int(n) for n in re.findall(r'/sayfa-(\d+)', detail_html)]
    if found_nums:
        max_p = min(max(found_nums), 40)
        clean_u = detail_url.rstrip('/')
        for p_i in range(1, max_p + 1):
            pages.add(f"{clean_u}/sayfa-{p_i}")

    print(f"Total pagination pages to scan: {len(pages)}")

    # 2. Collect all episodes across pages
    all_episodes = []
    seen_urls = set()

    for p_url in sorted(list(pages)):
        p_html = detail_html if p_url == detail_url else fetch_html(p_url, referer=detail_url)
        if not p_html:
            continue
        p_soup = BeautifulSoup(p_html, 'html.parser')
        p_content = p_soup.find('div', class_='content_') or p_soup
        cards = p_content.find_all('div', class_='dizi-boxpost-cat')
        link_elements = [c.find('a', href=True) for c in cards] if cards else p_content.find_all('a', href=True)

        for a in link_elements:
            if not a:
                continue
            h = a.get('href', '')
            txt = a.get_text(strip=True)
            if '/izle/' in h and ('bölüm' in txt.lower() or 'bolum' in txt.lower() or 'bolum' in h.lower() or 'bölüm' in h.lower()):
                full_ep = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                if full_ep in seen_urls:
                    continue
                seen_urls.add(full_ep)

                m_s = re.search(r'(\d+)\s*\.\s*sezon', txt, re.I) or re.search(r'sezon-(\d+)', h, re.I)
                season = int(m_s.group(1)) if m_s else 1

                m_e = re.search(r'(\d+)\s*\.\s*b[öo]l[üu]m', txt, re.I) or re.search(r'-(\d+)-bolum', h, re.I)
                ep_num = int(m_e.group(1)) if m_e else 1

                all_episodes.append({
                    'season': season,
                    'number': ep_num,
                    'name': f"Bölüm {ep_num}",
                    'url': full_ep
                })

    all_episodes.sort(key=lambda x: (x['season'], x['number']))
    print(f"Total unique episodes found: {len(all_episodes)}")
    if all_episodes:
        print(f"First episode: {all_episodes[0]}")
        print(f"Last episode: {all_episodes[-1]}")

    # 3. Insert episodes and resolve sources
    episodes_added = 0
    sources_added = 0

    for ep in all_episodes:
        s_num = ep['season']
        e_num = ep['number']
        ep_url = ep['url']
        ep_id, created = match_or_create_episode(cur, drama_id, s_num, e_num, f"Bölüm {e_num}", ep_url)
        if created:
            episodes_added += 1

        # Check existing source
        cur.execute("SELECT id FROM episode_sources WHERE episode_id=? AND provider IN ('ddizi', 'youtube')", (ep_id,))
        if cur.fetchone():
            continue

        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            if not ep_html:
                continue

            # Check direct youtube
            yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
            if yt_match:
                raw_yt = yt_match.group(1)
                v_id_m = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
                if v_id_m:
                    embed_url = f"https://www.youtube.com/embed/{v_id_m.group(1)}?autoplay=1&enablejsapi=1"
                    if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                        sources_added += 1
                        safe_commit(conn)
                        print(f"  [+] S{s_num}E{e_num} -> YouTube HD")
                        continue

            # Check player iframe /player/oynat/{hash}
            player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
            if not player_paths:
                player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)

            if player_paths:
                p_path = player_paths[0]
                p_url = p_path if p_path.startswith('http') else 'https://www.ddizi.tel' + p_path
                p_html = fetch_html(p_url, referer=ep_url)
                if p_html:
                    yt_thumb = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
                    if yt_thumb:
                        embed_url = f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1"
                        if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                            sources_added += 1
                            safe_commit(conn)
                            print(f"  [+] S{s_num}E{e_num} -> YouTube HD (from iframe)")
                            continue

                    m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                    if not m3u8_matches:
                        m3u8_matches = re.findall(r'["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                    added_m3u8 = False
                    for raw_m in m3u8_matches:
                        clean_m = raw_m.replace('\\/', '/')
                        if clean_m.startswith('http'):
                            if add_source(cur, ep_id, 'DDizi HLS', clean_m, 'ddizi', 'ddizi'):
                                sources_added += 1
                                safe_commit(conn)
                                print(f"  [+] S{s_num}E{e_num} -> DDizi HLS")
                                added_m3u8 = True
                                break
                    if added_m3u8:
                        continue

                    raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                    for raw_f in raw_files:
                        clean_u = raw_f.replace('\\/', '/')
                        if clean_u.startswith('http') and 'videoplayback' not in clean_u and 'googlevideo' not in clean_u and '.mp4' in clean_u:
                            if add_source(cur, ep_id, 'DDizi HD', clean_u, 'ddizi', 'ddizi'):
                                sources_added += 1
                                safe_commit(conn)
                                print(f"  [+] S{s_num}E{e_num} -> DDizi HD")
                                break
        except Exception as e:
            print(f"  [-] S{s_num}E{e_num} error: {e}")

    # Update drama counts
    cur.execute("""
        UPDATE dramas 
        SET sources_count = (
            SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = ?
        ),
        episode_count = (
            SELECT COUNT(*) FROM episodes WHERE drama_id = ?
        )
        WHERE id = ?
    """, (drama_id, drama_id, drama_id))
    safe_commit(conn)

    print(f"\nFINISH: +{episodes_added} episodes, +{sources_added} sources.")
    conn.close()

if __name__ == '__main__':
    test_sync_erkenci()
