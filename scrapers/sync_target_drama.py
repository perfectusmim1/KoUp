"""
KoUp Single Series Live Target Synchronizer
- Uses core multisite match_or_create_episode and add_source
- Auto-detects target provider from existing DB sources or metadata
- Supports manual URL override for exact source matching
- Robust HTTP client (curl_cffi for HDFilm, custom session for DiziBox, etc.)
- Crawls missing seasons, episodes, and stream sources
- Commits atomically with WAL busy timeout
- Emits structured __RESULT__ JSON for Next.js API integration
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from bs4 import BeautifulSoup
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

try:
    from curl_cffi import requests as cfr
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

import requests

from scrapers.multisite import (
    match_or_create_episode,
    add_source,
    safe_commit,
    norm_title
)

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)

def fetch_html(url: str, referer: str = None, timeout: int = 15) -> str:
    h = dict(DEFAULT_HEADERS)
    if referer:
        h['Referer'] = referer

    # For HDFilmcehennemi, always prefer curl_cffi with chrome impersonation
    if 'hdfilmcehennemi' in url and HAS_CURL_CFFI:
        try:
            s = cfr.Session(impersonate="chrome")
            r = s.get(url, headers=h, timeout=timeout)
            if r.status_code == 200:
                return r.text
        except Exception:
            pass

    # Standard requests session
    try:
        s = requests.Session()
        r = s.get(url, headers=h, timeout=timeout)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass

    # Fallback to curl_cffi if not yet used
    if HAS_CURL_CFFI:
        try:
            s = cfr.Session(impersonate="chrome")
            r = s.get(url, headers=h, timeout=timeout)
            if r.status_code == 200:
                return r.text
        except Exception:
            pass

    # Last fallback to urllib
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='replace')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout=60000;")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn

def sync_dizibox_target(conn, cur, drama, target_url=None):
    title = drama['title']
    episodes_added = 0
    sources_added = 0

    log("DiziBOX", f'DiziBOX motoru devrede: "{title}"')

    detail_url = target_url
    if not detail_url:
        cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', title).strip('-').lower()
        test_url = f"https://www.dizibox.live/diziler/{cand_slug}/"
        try:
            h = fetch_html(test_url, referer="https://www.dizibox.live/")
            if 'sezon' in h.lower() or 'bolum' in h.lower() or 'dizi-ozet' in h:
                detail_url = test_url
                log("DiziBOX", f"Doğrudan dizi URL'si eşleşti: {detail_url}")
        except Exception:
            pass

    if not detail_url:
        # Search DiziBox
        log("DiziBOX", f'Arama yapılıyor: "{title}"')
        q = urllib.parse.quote(title)
        try:
            search_html = fetch_html(f"https://www.dizibox.live/?s={q}", referer="https://www.dizibox.live/")
            soup = BeautifulSoup(search_html, 'html.parser')
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/diziler/' in h:
                    detail_url = h
                    log("DiziBOX", f"Arama sonucu bulundu: {detail_url}")
                    break
        except Exception as e:
            log("DiziBOX", f"Arama hatası: {e}")

    if not detail_url:
        log("DiziBOX", "Uygun DiziBOX sayfası bulunamadı.")
        return 0, 0

    detail_html = fetch_html(detail_url, referer="https://www.dizibox.live/")
    soup = BeautifulSoup(detail_html, 'html.parser')

    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if ('-sezon-' in h and '-bolum' in h) or ('/sezon-' in h and '/bolum-' in h):
            if h not in seen:
                seen.add(h)
                m = re.search(r'(\d+)\s*[-.]\s*sezon\s*[-.]\s*(\d+)\s*[-.]\s*bolum', h)
                if m:
                    ep_links.append((int(m.group(1)), int(m.group(2)), h))

    ep_links.sort(key=lambda x: (x[0], x[1]))
    log("DiziBOX", f"{len(ep_links)} adet bölüm bağlantısı tespit edildi.")

    for s_num, e_num, ep_url in ep_links:
        ep_id, created = match_or_create_episode(cur, drama['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
        if created:
            episodes_added += 1

        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            m_sheila = re.search(r'sheila/([a-zA-Z0-9_-]+)', ep_html)
            m_molystream = re.search(r'https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+', ep_html)
            m_king = re.search(r'king\.php\?post_id=(\d+)', ep_html)

            v_url = None
            if m_sheila:
                v_url = f"https://dbx.molystream.org/embed/sheila/{m_sheila.group(1)}"
            elif m_molystream:
                v_url = m_molystream.group(0)
            elif m_king:
                v_url = f"https://www.dizibox.live/king.php?post_id={m_king.group(1)}"

            if v_url:
                if add_source(cur, ep_id, 'DBX Pro 1080p', v_url, 'dbx', 'dizibox'):
                    sources_added += 1
                    safe_commit(conn)
                    log("DiziBOX", f"S{s_num}E{e_num} -> DBX Pro 1080p eklendi.")
        except Exception as e:
            log("DiziBOX", f"S{s_num}E{e_num} hata: {e}")

    return episodes_added, sources_added

def sync_hdfilm_target(conn, cur, drama, target_url=None):
    title = drama['title']
    episodes_added = 0
    sources_added = 0

    log("HDFilm", f'HDFilmcehennemi motoru devrede: "{title}"')

    detail_url = target_url
    if not detail_url:
        cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', title).strip('-').lower()
        test_url = f"https://www.hdfilmcehennemi.nl/dizi/{cand_slug}-izle/"
        try:
            h = fetch_html(test_url)
            if 'dizi' in h:
                detail_url = test_url
                log("HDFilm", f"Doğrudan dizi URL'si eşleşti: {detail_url}")
        except Exception:
            pass

    if not detail_url:
        log("HDFilm", "Arama deneniyor...")
        try:
            q = urllib.parse.quote(title)
            s_html = fetch_html(f"https://www.hdfilmcehennemi.nl/arama/?q={q}")
            soup = BeautifulSoup(s_html, 'html.parser')
            for a in soup.find_all('a', href=True):
                if '/dizi/' in a['href']:
                    detail_url = a['href']
                    log("HDFilm", f"Arama sonucu bulundu: {detail_url}")
                    break
        except Exception:
            pass

    if not detail_url:
        log("HDFilm", "Uygun HDFilmcehennemi sayfası bulunamadı.")
        return 0, 0

    log("HDFilm", f"Hedef yapım sayfası: {detail_url}")
    detail_html = fetch_html(detail_url)
    soup = BeautifulSoup(detail_html, 'html.parser')

    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/dizi/' in h and ('/sezon-' in h and '/bolum-' in h):
            if h not in seen:
                seen.add(h)
                m = re.search(r'/sezon-(\d+)/bolum-(\d+)', h)
                if m:
                    ep_links.append((int(m.group(1)), int(m.group(2)), h))

    ep_links.sort(key=lambda x: (x[0], x[1]))
    log("HDFilm", f"{len(ep_links)} adet bölüm tespit edildi.")

    for s_num, e_num, ep_url in ep_links:
        ep_id, created = match_or_create_episode(cur, drama['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
        if created:
            episodes_added += 1

        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            m_close = re.search(r'https?://(?:[a-zA-Z0-9-]+\.)?hdfilmcehennemi\.(?:nl|mobi)/video/embed/([a-zA-Z0-9_-]+)', ep_html)
            m_rapid = re.search(r'rapidrame_id=([a-zA-Z0-9]+)', ep_html)
            m_rplayer = re.search(r'https?://(?:[a-zA-Z0-9-]+\.)?hdfilmcehennemi\.(?:nl|mobi)/rplayer/([a-zA-Z0-9]+)', ep_html)

            if m_close:
                v_url = m_close.group(0)
                if add_source(cur, ep_id, 'Close Player Dual 1080p', v_url, 'close', 'hdfilmcehennemi'):
                    sources_added += 1

            if m_rapid or m_rplayer:
                rid = m_rapid.group(1) if m_rapid else m_rplayer.group(1)
                r_url = f"https://www.hdfilmcehennemi.nl/rplayer/{rid}/"
                if add_source(cur, ep_id, 'Rapidrame Altyazılı 1080p', r_url, 'rapidrame', 'hdfilmcehennemi'):
                    sources_added += 1

            safe_commit(conn)
            log("HDFilm", f"S{s_num}E{e_num} -> Kaynaklar bağlandı.")
        except Exception as e:
            log("HDFilm", f"S{s_num}E{e_num} hata: {e}")

    return episodes_added, sources_added

def sync_dizikorea_target(conn, cur, drama, target_url=None):
    title = drama['title']
    episodes_added = 0
    sources_added = 0

    log("DiziKorea", f'DiziKorea motoru devrede: "{title}"')
    detail_url = target_url
    if not detail_url:
        cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', title).strip('-').lower()
        test_url = f"https://dizikorea3.com/dizi/{cand_slug}/"
        try:
            h = fetch_html(test_url, referer="https://dizikorea3.com/")
            if 'bolum' in h:
                detail_url = test_url
        except Exception:
            pass

    if not detail_url:
        q = urllib.parse.quote(title)
        try:
            s_html = fetch_html(f"https://dizikorea3.com/?s={q}", referer="https://dizikorea3.com/")
            soup = BeautifulSoup(s_html, 'html.parser')
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h:
                    detail_url = h
                    break
        except Exception:
            pass

    if not detail_url:
        log("DiziKorea", "Uygun DiziKorea sayfası bulunamadı.")
        return 0, 0

    detail_html = fetch_html(detail_url)
    soup = BeautifulSoup(detail_html, 'html.parser')

    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '-bolum' in h:
            if h not in seen:
                seen.add(h)
                m = re.search(r'(\d+)\s*[-.]\s*bolum', h)
                e_num = int(m.group(1)) if m else 1
                ep_links.append((1, e_num, h))

    ep_links.sort(key=lambda x: (x[0], x[1]))
    log("DiziKorea", f"{len(ep_links)} adet bölüm tespit edildi.")

    for s_num, e_num, ep_url in ep_links:
        ep_id, created = match_or_create_episode(cur, drama['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
        if created:
            episodes_added += 1

        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            m_iframe = re.search(r'src=["\'](https?://(?:playerdkorea\.xyz|vidmoly\.[a-z]+)/[^"\']+)["\']', ep_html)
            if m_iframe:
                v_url = m_iframe.group(1)
                if add_source(cur, ep_id, 'DiziKorea 1080p HLS', v_url, 'dizikorea', 'dizikorea'):
                    sources_added += 1
                    safe_commit(conn)
                    log("DiziKorea", f"S{s_num}E{e_num} -> Kaynak eklendi.")
        except Exception as e:
            log("DiziKorea", f"S{s_num}E{e_num} hata: {e}")

    return episodes_added, sources_added

def sync_animecix_target(conn, cur, drama, target_url=None):
    title = drama['title']
    episodes_added = 0
    sources_added = 0

    log("AnimeciX", f'AnimeciX motoru devrede: "{title}"')
    q = urllib.parse.quote(title)
    try:
        api_url = f"https://animecix.net/secure/search/videos?name={q}&limit=5"
        res_text = fetch_html(api_url, referer='https://animecix.net/')
        data = json.loads(res_text)
        results = data.get('results', [])
        if not results:
            log("AnimeciX", "AnimeciX üzerinde eşleşen anime bulunamadı.")
            return 0, 0

        target_anime = results[0]
        anime_id = target_anime.get('id')
        log("AnimeciX", f"Hedef anime bulundu: {target_anime.get('name')} (ID: {anime_id})")

        # Fetch episodes
        ep_api = f"https://animecix.net/secure/titles/{anime_id}/episodes"
        ep_data = json.loads(fetch_html(ep_api, referer='https://animecix.net/'))
        ep_list = ep_data.get('episodes', [])
        log("AnimeciX", f"{len(ep_list)} adet bölüm bulundu.")

        for ep in ep_list:
            s_num = int(ep.get('season_number', 1) or 1)
            e_num = int(ep.get('episode_number', 1) or 1)

            ep_url = f"https://animecix.net/titles/{anime_id}/season/{s_num}/episode/{e_num}"
            ep_id, created = match_or_create_episode(cur, drama['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
            if created:
                episodes_added += 1

            v_list = ep.get('videos', [])
            for v in v_list:
                v_url = v.get('url')
                p_name = v.get('name', 'Tau Video')
                if v_url:
                    if add_source(cur, ep_id, f"AnimeciX ({p_name})", v_url, 'animecix', 'animecix'):
                        sources_added += 1
                        safe_commit(conn)
                        log("AnimeciX", f"S{s_num}E{e_num} -> {p_name} eklendi.")
    except Exception as e:
        log("AnimeciX", f"Hata: {e}")

    return episodes_added, sources_added

def sync_ddizi_target(conn, cur, drama, target_url=None):
    title = drama['title']
    episodes_added = 0
    sources_added = 0

    log("DDizi", f'DDizi motoru devrede: "{title}"')
    detail_url = target_url

    # 1. Check existing source_url on drama
    if not detail_url and drama.get('source_url') and 'ddizi' in drama.get('source_url', ''):
        detail_url = drama['source_url']
        log("DDizi", f"Kayıtlı kaynak URL'si kullanılıyor: {detail_url}")

    # 2. Match from cached ddizi_catalog.json
    if not detail_url:
        cat_file = os.path.join(_ROOT, 'scrapers', 'ddizi_catalog.json')
        if os.path.exists(cat_file):
            try:
                with open(cat_file, 'r', encoding='utf-8') as f:
                    cat = json.load(f)
                d_slug = (drama.get('slug') or '').lower()
                norm_d_title = norm_title(title)
                for u, t in cat.items():
                    if (d_slug and d_slug in u.lower()) or norm_title(t) == norm_d_title:
                        detail_url = u
                        log("DDizi", f"Katalogdan eşleşti: {detail_url}")
                        break
            except Exception as e:
                log("DDizi", f"Katalog eşleme uyarısı: {e}")

    # 3. Fallback search
    if not detail_url:
        q = urllib.parse.quote(title)
        try:
            s_html = fetch_html(f"https://www.ddizi.tel/arama/?q={q}", referer="https://www.ddizi.tel/")
            if s_html:
                soup = BeautifulSoup(s_html, 'html.parser')
                for a in soup.find_all('a', href=True):
                    h = a['href']
                    if '/diziler/' in h:
                        detail_url = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                        log("DDizi", f"Arama sonucu bulundu: {detail_url}")
                        break
        except Exception:
            pass

    if not detail_url:
        log("DDizi", "Uygun DDizi sayfası bulunamadı.")
        return 0, 0

    detail_html = fetch_html(detail_url, referer="https://www.ddizi.tel/")
    if not detail_html:
        log("DDizi", f"Sayfa yüklenemedi: {detail_url}")
        return 0, 0

    soup = BeautifulSoup(detail_html, 'html.parser')

    # Sayfalandırma (Bazı diziler 5-30 sayfaya yayılmıştır)
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

    log("DDizi", f"{len(pages)} sayfa taranıyor...")

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
    log("DDizi", f"{len(all_episodes)} adet bölüm tespit edildi.")

    for ep in all_episodes:
        s_num = ep['season']
        e_num = ep['number']
        ep_url = ep['url']
        ep_id, created = match_or_create_episode(cur, drama['id'], s_num, e_num, f"Bölüm {e_num}", ep_url)
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

            # 1. Doğrudan YouTube embed / telif
            yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
            if yt_match:
                raw_yt = yt_match.group(1)
                v_id_m = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
                if v_id_m:
                    embed_url = f"https://www.youtube.com/embed/{v_id_m.group(1)}?autoplay=1&enablejsapi=1"
                    if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                        sources_added += 1
                        safe_commit(conn)
                        log("DDizi", f"S{s_num}E{e_num} -> YouTube HD eklendi.")
                        continue

            # 2. DDizi Native JWPlayer (/player/oynat/{hash})
            player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
            if not player_paths:
                player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)

            if player_paths:
                p_path = player_paths[0]
                p_url = p_path if p_path.startswith('http') else 'https://www.ddizi.tel' + p_path
                p_html = fetch_html(p_url, referer=ep_url)
                if p_html:
                    # YouTube poster kontrolü
                    yt_thumb = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
                    if yt_thumb:
                        embed_url = f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1"
                        if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                            sources_added += 1
                            safe_commit(conn)
                            log("DDizi", f"S{s_num}E{e_num} -> YouTube HD eklendi.")
                            continue

                    # HLS (.m3u8) akış kontrolü
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
                                log("DDizi", f"S{s_num}E{e_num} -> DDizi HLS eklendi.")
                                added_m3u8 = True
                                break
                    if added_m3u8:
                        continue

                    # Kalıcı MP4 akış kontrolü
                    raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                    for raw_f in raw_files:
                        clean_u = raw_f.replace('\\/', '/')
                        if clean_u.startswith('http') and 'videoplayback' not in clean_u and 'googlevideo' not in clean_u and '.mp4' in clean_u:
                            if add_source(cur, ep_id, 'DDizi HD', clean_u, 'ddizi', 'ddizi'):
                                sources_added += 1
                                safe_commit(conn)
                                log("DDizi", f"S{s_num}E{e_num} -> DDizi HD eklendi.")
                                break
        except Exception as e:
            log("DDizi", f"S{s_num}E{e_num} hata: {e}")

    return episodes_added, sources_added

def main():
    parser = argparse.ArgumentParser(description="KoUp Single Series Target Synchronizer")
    parser.add_argument('--drama-id', type=int, required=True, help="Database drama ID")
    parser.add_argument('--provider', default='auto', choices=['auto', 'dizibox', 'hdfilm', 'dizikorea', 'animecix', 'ddizi'])
    parser.add_argument('--manual-url', default=None, help="Explicit target series URL")
    args = parser.parse_args()

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id, title, slug, country, content_type, source_url FROM dramas WHERE id = ?", (args.drama_id,))
    drama = cur.fetchone()
    if not drama:
        print(f"HATA: Drama #{args.drama_id} veritabanında bulunamadı.")
        conn.close()
        sys.exit(1)

    drama = dict(drama)
    log("BAŞLATILDI", f'Yapım #{drama["id"]} ("{drama["title"]}") senkronizasyonu başlatıldı.')

    chosen_provider = args.provider
    manual_url = args.manual_url

    # Automatic provider detection if 'auto'
    if chosen_provider == 'auto':
        if manual_url:
            if 'dizibox' in manual_url:
                chosen_provider = 'dizibox'
            elif 'hdfilmcehennemi' in manual_url:
                chosen_provider = 'hdfilm'
            elif 'dizikorea' in manual_url:
                chosen_provider = 'dizikorea'
            elif 'animecix' in manual_url:
                chosen_provider = 'animecix'
            elif 'ddizi' in manual_url:
                chosen_provider = 'ddizi'
        
        if chosen_provider == 'auto':
            cur.execute("""
                SELECT DISTINCT es.site, es.provider 
                FROM episode_sources es
                JOIN episodes e ON e.id = es.episode_id
                WHERE e.drama_id = ? AND es.site IS NOT NULL AND es.site != ''
            """, (drama['id'],))
            existing_sites = [r[0].lower() for r in cur.fetchall()]
            
            if 'dizibox' in existing_sites or any('dbx' in s for s in existing_sites):
                chosen_provider = 'dizibox'
            elif 'hdfilmcehennemi' in existing_sites or 'hdfilm' in existing_sites:
                chosen_provider = 'hdfilm'
            elif 'dizikorea' in existing_sites:
                chosen_provider = 'dizikorea'
            elif 'animecix' in existing_sites:
                chosen_provider = 'animecix'
            elif 'ddizi' in existing_sites:
                chosen_provider = 'ddizi'
            else:
                c = (drama.get('country') or '').upper()
                ctype = (drama.get('content_type') or '').lower()
                if ctype == 'anime':
                    chosen_provider = 'animecix'
                elif c == 'TR':
                    chosen_provider = 'ddizi'
                elif c in ('KR', 'JP', 'CN', 'TH', 'TW'):
                    chosen_provider = 'dizikorea'
                else:
                    chosen_provider = 'dizibox'

    log("SEÇİM", f'Aktif senkronizasyon motoru: {chosen_provider.upper()}')

    total_eps_added = 0
    total_srcs_added = 0

    if chosen_provider == 'dizibox':
        total_eps_added, total_srcs_added = sync_dizibox_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'hdfilm':
        total_eps_added, total_srcs_added = sync_hdfilm_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'dizikorea':
        total_eps_added, total_srcs_added = sync_dizikorea_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'animecix':
        total_eps_added, total_srcs_added = sync_animecix_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'ddizi':
        total_eps_added, total_srcs_added = sync_ddizi_target(conn, cur, drama, manual_url)

    # Update sources_count and episode_count in dramas
    cur.execute("""
        UPDATE dramas 
        SET sources_count = (
            SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = ?
        ),
        episode_count = (
            SELECT COUNT(*) FROM episodes WHERE drama_id = ?
        )
        WHERE id = ?
    """, (drama['id'], drama['id'], drama['id']))

    conn.commit()
    conn.close()

    result = {
        "ok": True,
        "dramaId": drama['id'],
        "dramaTitle": drama['title'],
        "provider": chosen_provider,
        "episodesAdded": total_eps_added,
        "sourcesAdded": total_srcs_added,
        "timestamp": datetime.now().isoformat()
    }

    log("TAMAMLANDI", f"İşlem bitti: +{total_eps_added} yeni bölüm, +{total_srcs_added} yeni kaynak eklendi.")
    print(f"\n__RESULT__ {json.dumps(result, ensure_ascii=False)}")

if __name__ == '__main__':
    main()
