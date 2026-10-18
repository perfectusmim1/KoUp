"""
DDizi Missing Dramas Fast Sync Engine
Scrapes all 269 Turkish series that currently have 0 episodes in webdrama_archive.db
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

import re
import json
import time
import sqlite3
import urllib.request
import urllib.parse
from bs4 import BeautifulSoup
from scrapers.multisite import (
    match_or_create_episode,
    add_source,
    safe_commit
)

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

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
        except Exception:
            time.sleep(0.5)
    return None

def sync_single_ddizi(conn, cur, drama_id, title, source_url):
    detail_url = source_url
    if not detail_url:
        return 0, 0

    detail_html = fetch_html(detail_url)
    if not detail_html:
        return 0, 0

    soup = BeautifulSoup(detail_html, 'html.parser')

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
    if not all_episodes:
        return 0, 0

    # Extract all episode streams in-memory first (0 DB locks held during HTTP requests)
    resolved_episodes = []
    for ep in all_episodes:
        s_num = ep['season']
        e_num = ep['number']
        ep_url = ep['url']
        ep_streams = []

        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            if ep_html:
                yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
                if yt_match:
                    raw_yt = yt_match.group(1)
                    v_id_m = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
                    if v_id_m:
                        embed_url = f"https://www.youtube.com/embed/{v_id_m.group(1)}?autoplay=1&enablejsapi=1"
                        ep_streams.append(('YouTube HD', embed_url, embed_url, 'youtube', 'ddizi'))

                player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
                if not player_paths:
                    player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)

                if player_paths and not ep_streams:
                    p_path = player_paths[0]
                    p_url = p_path if p_path.startswith('http') else 'https://www.ddizi.tel' + p_path
                    p_html = fetch_html(p_url, referer=ep_url)
                    if p_html:
                        yt_thumb = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
                        if yt_thumb:
                            embed_url = f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1"
                            ep_streams.append(('YouTube HD', embed_url, embed_url, 'youtube', 'ddizi'))

                        if not ep_streams:
                            m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                            if not m3u8_matches:
                                m3u8_matches = re.findall(r'["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                            for raw_m in m3u8_matches:
                                clean_m = raw_m.replace('\\/', '/')
                                if clean_m.startswith('http'):
                                    ep_streams.append(('DDizi HLS', clean_m, clean_m, 'ddizi', 'ddizi'))
                                    break

                        if not ep_streams:
                            raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                            for raw_f in raw_files:
                                clean_u = raw_f.replace('\\/', '/')
                                if clean_u.startswith('http') and 'videoplayback' not in clean_u and 'googlevideo' not in clean_u and '.mp4' in clean_u:
                                    ep_streams.append(('DDizi HD', clean_u, clean_u, 'ddizi', 'ddizi'))
                                    break
        except Exception:
            pass

        resolved_episodes.append((ep, ep_streams))

    # Fast atomic write in single short transaction (0.01s)
    episodes_added = 0
    sources_added = 0

    with conn:
        for ep, streams in resolved_episodes:
            ep_id, created = match_or_create_episode(cur, drama_id, ep['season'], ep['number'], f"Bölüm {ep['number']}", ep['url'])
            if created:
                episodes_added += 1
            for sname, eid, durl, prov, site in streams:
                if add_source(cur, ep_id, sname, durl, prov, site):
                    sources_added += 1

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

    return episodes_added, sources_added

def run():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    cur = conn.cursor()

    cur.execute("""
        SELECT id, title, slug, source_url FROM dramas 
        WHERE (alt_sites LIKE '%ddizi%' OR source_url LIKE '%ddizi%')
        AND id NOT IN (SELECT DISTINCT drama_id FROM episodes)
        ORDER BY id ASC
    """)
    dramas = cur.fetchall()
    print(f"=================================================================")
    print(f"Başlatılıyor: Eksik {len(dramas)} DDizi Yapımı Taranacak...")
    print(f"=================================================================")

    total_episodes = 0
    total_sources = 0

    for idx, d in enumerate(dramas, 1):
        did, title, slug, surl = d
        t0 = time.time()
        eps, srcs = sync_single_ddizi(conn, cur, did, title, surl)
        dt = time.time() - t0
        total_episodes += eps
        total_sources += srcs
        print(f"[{idx}/{len(dramas)}] {title} -> +{eps} bölüm, +{srcs} kaynak ({dt:.1f}sn) [Toplam: {total_sources}]", flush=True)

    conn.close()
    print(f"\n🎉 Tamamlandı! Toplam +{total_episodes} bölüm, +{total_sources} kaynak eklendi.")

if __name__ == '__main__':
    run()
