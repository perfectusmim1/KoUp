"""
HDFilmcehennemi Target Synchronizer
Migrates series and movies from hdfilmcehennemi.nl with:
- Close: Dual Audio (Turkish Dubbing + English Original) 1080p HLS
- Rapidrame: Multi-sub (Turkish / English) 1080p HLS
"""

import sys
import os
import re
import json
import time
from datetime import datetime
import urllib.request
import urllib.parse
import subprocess
from bs4 import BeautifulSoup
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

from database import get_connection
from scrapers.multisite import (
    norm_title,
    build_drama_index,
    find_in_index,
    match_or_create_episode,
    add_source,
    tag_site,
    safe_commit,
    unique_slug
)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': 'https://www.hdfilmcehennemi.nl/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

def fetch_html(url, referer=None, timeout=12):
    h = dict(HEADERS)
    if referer:
        h['Referer'] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def resolve_hdfilm_streams(page_url, page_html):
    """Extracts direct HLS streams for Close (Dual) and Rapidrame (Sub)."""
    soup = BeautifulSoup(page_html, 'html.parser')
    
    iframe_urls = set()
    
    # 1. Default iframe in HTML
    default_iframe = soup.find('iframe')
    if default_iframe:
        src = default_iframe.get('src') or default_iframe.get('data-src') or ''
        if src:
            iframe_urls.add(src)
    
    # 2. Check alternative-link buttons with data-video IDs
    for btn in soup.find_all('button', class_=lambda c: c and 'alternative-link' in c):
        vid = btn.get('data-video')
        if vid and str(vid).isdigit():
            try:
                v_api = f"https://www.hdfilmcehennemi.nl/video/{vid}/"
                req = urllib.request.Request(v_api, headers={
                    **HEADERS,
                    'Referer': page_url,
                    'X-Requested-With': 'fetch',
                    'Content-Type': 'application/json'
                })
                with urllib.request.urlopen(req, timeout=5) as resp:
                    d = json.loads(resp.read().decode('utf-8'))
                    v_soup = BeautifulSoup(d.get('data', {}).get('html', ''), 'html.parser')
                    v_ifr = v_soup.find('iframe')
                    if v_ifr:
                        v_src = v_ifr.get('src') or v_ifr.get('data-src')
                        if v_src:
                            iframe_urls.add(v_src)
            except Exception:
                pass

    streams = []
    seen_urls = set()

    for ifr in list(iframe_urls):
        # 1. Close Player (Dual Audio 1080p HLS)
        if 'video/embed/' in ifr:
            m_rapid = re.search(r'rapidrame_id=([a-zA-Z0-9]+)', ifr)
            if m_rapid:
                iframe_urls.add(f"https://www.hdfilmcehennemi.nl/rplayer/{m_rapid.group(1)}/")

            try:
                embed_html = fetch_html(ifr, referer=page_url)
                m_var = re.search(r'sources:\s*\[\{file:\s*(\w+)', embed_html)
                var_name = m_var.group(1) if m_var else None

                emb_soup = BeautifulSoup(embed_html, 'html.parser')
                for s in emb_soup.find_all('script'):
                    txt = s.get_text()
                    if var_name and var_name in txt and ('eval(' in txt or 'function' in txt):
                        js = f"""
                        var atob = (str) => Buffer.from(str, 'base64').toString('binary');
                        var btoa = (str) => Buffer.from(str, 'binary').toString('base64');
                        var document = {{ querySelector: () => null, addEventListener: () => {{}} }};
                        var window = {{ location: {{ href: '' }} }};
                        {txt}
                        console.log('STREAM:' + {var_name});
                        """
                        res = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=5)
                        m_out = re.search(r'STREAM:(https?://[^\s]+)', res.stdout)
                        if m_out:
                            direct_hls = m_out.group(1).strip()
                            if direct_hls not in seen_urls:
                                seen_urls.add(direct_hls)
                                streams.append(('Orijinal (Dual Dublaj)', direct_hls, 'hdfilm-hls', 'hdfilm'))
                            break
            except Exception:
                pass

            if not any(s[2] == 'hdfilm-hls' for s in streams) and ifr not in seen_urls:
                seen_urls.add(ifr)
                streams.append(('Close Player (Dual)', ifr, 'hdfilm-close', 'hdfilm'))

        # 2. Rapidrame Player (Subtitled or Dubbed HLS)
        elif '/rplayer/' in ifr:
            try:
                r_html = fetch_html(ifr, referer=page_url)
                r_soup = BeautifulSoup(r_html, 'html.parser')
                for s in r_soup.find_all('script'):
                    txt = s.get_text()
                    if 'sources:' in txt:
                        js = f"""
                        var atob = (str) => Buffer.from(str, 'base64').toString('binary');
                        var btoa = (str) => Buffer.from(str, 'binary').toString('base64');
                        var document = {{ querySelector: () => null, addEventListener: () => {{}}, getElementById: () => null }};
                        var window = {{ location: {{ href: '' }} }};
                        var jwplayer = () => ({{ setup: (cfg) => {{ console.log('FILE:' + (cfg.sources ? cfg.sources[0].file : 'none')); }}, on: () => {{}} }});
                        var $ = () => ({{ on: () => {{}}, ready: () => {{}} }});
                        {txt}
                        """
                        res = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=5)
                        m_file = re.search(r'FILE:(https?://[^\s]+)', res.stdout)
                        if m_file:
                            f_url = m_file.group(1).strip()
                            if f_url.startswith('http') and f_url not in seen_urls:
                                seen_urls.add(f_url)
                                streams.append(('Orijinal (Altyazılı)', f_url, 'rapidrame', 'hdfilm'))
                                break
            except Exception:
                pass

            if not any(s[1] == ifr for s in streams) and ifr not in seen_urls:
                seen_urls.add(ifr)
                streams.append(('Rapidrame Player', ifr, 'rapidrame', 'hdfilm'))

    return streams

def sync_hdfilm_movie(url, conn, cur, idx):
    print(f"\n[FİLM] Senkronize ediliyor: {url}")
    html = fetch_html(url)
    soup = BeautifulSoup(html, 'html.parser')
    
    raw_title = soup.title.get_text(strip=True) if soup.title else ""
    # Clean title
    t = re.sub(r'\s*(izle|hdfilmcehennemi|film izle|hd film izle|türkçe dublaj|türkçe altyazılı).*$', '', raw_title, flags=re.I)
    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    if not t:
        t = url.rstrip('/').split('/')[-1].replace('-', ' ').title()

    slug_cand = url.rstrip('/').split('/')[-1]

    did = find_in_index(idx, t, slug=slug_cand)
    if not did:
        cur.execute("SELECT id, title, slug FROM dramas WHERE slug LIKE ? OR title LIKE ?", (f"%{slug_cand}%", f"%{t}%"))
        row = cur.fetchone()
        if row:
            did = row[0]
            t = row[1]
        else:
            cur.execute("""
                INSERT INTO dramas (title, slug, content_type, country, release_year, status_broadcast, cover_image, overview, source_url)
                VALUES (?, ?, 'film', 'US', ?, 'completed', '/logo-dark.png', ?, ?)
            """, (t, unique_slug(cur, slug_cand), str(datetime.now().year), f"{t} HDFilmcehennemi üzerinden eklendi.", url))
            did = cur.lastrowid
            tag_site(cur, did, 'hdfilm')
            print(f"  ✓ Yeni film arşive eklendi: {t} (ID: #{did})")
    else:
        print(f"  ✓ Mevcut film bulundu: {t} (ID: #{did})")

    streams = resolve_hdfilm_streams(url, html)
    print(f"  Çözümlenen kaynaklar: {len(streams)}")
    
    ep_id, _ = match_or_create_episode(cur, did, 1, 1, "Film", url)
    added = 0
    for sname, surl, sprov, ssite in streams:
        if add_source(cur, ep_id, sname, surl, sprov, ssite):
            added += 1
            print(f"    + {sname} -> {sprov}")

    safe_commit(conn)
    print(f"  Tamamlandı! +{added} yeni kaynak eklendi.")

def sync_hdfilm_series(series_url, conn, cur, idx, episodes_limit=None):
    print(f"\n[DİZİ] Senkronize ediliyor: {series_url}")
    html = fetch_html(series_url)
    soup = BeautifulSoup(html, 'html.parser')

    raw_title = soup.title.get_text(strip=True) if soup.title else ""
    t = re.sub(r'\s*(izle|hdfilmcehennemi|türkçe dublaj|dizi izle).*$', '', raw_title, flags=re.I)
    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    if not t:
        t = series_url.rstrip('/').split('/')[-1].replace('-', ' ').title()

    slug_cand = series_url.rstrip('/').split('/')[-1].replace('-izle', '')

    did = find_in_index(idx, t, slug=slug_cand)
    if not did:
        cur.execute("SELECT id, title, slug FROM dramas WHERE slug LIKE ? OR title LIKE ?", (f"%{slug_cand}%", f"%{t}%"))
        row = cur.fetchone()
        if row:
            did = row[0]
            t = row[1]
        else:
            cur.execute("""
                INSERT INTO dramas (title, slug, content_type, country, release_year, status_broadcast, cover_image, overview, source_url)
                VALUES (?, ?, 'dizi', 'US', ?, 'ongoing', '/logo-dark.png', ?, ?)
            """, (t, unique_slug(cur, slug_cand), str(datetime.now().year), f"{t} HDFilmcehennemi üzerinden eklendi.", series_url))
            did = cur.lastrowid
            tag_site(cur, did, 'hdfilm')
            print(f"  ✓ Yeni dizi arşive eklendi: {t} (ID: #{did})")
    else:
        print(f"  ✓ Mevcut dizi bulundu: {t} (ID: #{did})")

    # Collect episode links
    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/dizi/' in h and ('/sezon-' in h and '/bolum-' in h):
            if h not in seen:
                seen.add(h)
                m = re.search(r'/sezon-(\d+)/bolum-(\d+)', h)
                if m:
                    s_num = int(m.group(1))
                    e_num = int(m.group(2))
                    ep_links.append((s_num, e_num, h))

    ep_links.sort(key=lambda x: (x[0], x[1]))
    print(f"  Toplam {len(ep_links)} bölüm bağlantısı bulundu.")

    if episodes_limit:
        ep_links = ep_links[:episodes_limit]
        print(f"  Limit uygulandı: {episodes_limit} bölüm işlenecek.")

    total_added = 0
    for s_num, e_num, ep_url in ep_links:
        try:
            ep_html = fetch_html(ep_url, referer=series_url)
            streams = resolve_hdfilm_streams(ep_url, ep_html)
            ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
            
            ep_added = 0
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    ep_added += 1
            
            total_added += ep_added
            if ep_added > 0:
                safe_commit(conn)
                print(f"    S{s_num}E{e_num}: +{ep_added} kaynak bağlandı.")
        except Exception as err:
            print(f"    S{s_num}E{e_num} hata: {err}")

    print(f"  Dizi senkronizasyonu tamamlandı! Toplam +{total_added} kaynak eklendi.")

def main():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")
    
    idx = build_drama_index(cur)

    # 1. Sync Spider-Man movie
    sync_hdfilm_movie('https://www.hdfilmcehennemi.nl/spider-man-brand-new-day-1/', conn, cur, idx)

    # 2. Sync The Mentalist (All 151 episodes across all 7 seasons)
    sync_hdfilm_series('https://www.hdfilmcehennemi.nl/dizi/the-mentalist-izle-7/', conn, cur, idx, episodes_limit=None)

if __name__ == '__main__':
    main()
