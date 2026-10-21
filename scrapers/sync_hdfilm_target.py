"""
HDFilmcehennemi Target Synchronizer
Migrates series and movies from hdfilmcehennemi.nl with DIRECT inner media streams:
- Close: Dual Audio (Turkish Dubbing + English Original) 1080p HLS (master.txt)
- Rapidrame: Multi-sub (Turkish / English) 1080p HLS (master.m3u8)
Never saves hdfilmcehennemi bridge embed URLs (/video/embed/ or /rplayer/).
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

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

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
    unique_slug,
    clean_scraped_slug,
)
from scrapers.pending_sources import (
    ensure_pending_columns,
    page_is_placeholder,
    reconcile_episode,
)
from scrapers.translator import resolve_tmdb_metadata, COUNTRY_CODE_TO_NAME

TURKISH_COUNTRY_NAME_TO_CODE = {
    "türkiye": "TR", "turkiye": "TR",
    "abd": "US", "amerika": "US", "amerika birleşik devletleri": "US", "united states": "US",
    "güney kore": "KR", "guney kore": "KR", "kore": "KR",
    "japonya": "JP",
    "çin": "CN", "cin": "CN",
    "birleşik krallık": "GB", "ingiltere": "GB",
    "fransa": "FR",
    "almanya": "DE",
    "ispanya": "ES",
    "italya": "IT",
    "polonya": "PL",
    "hindistan": "IN",
    "kanada": "CA",
    "avustralya": "AU",
    "rusya": "RU",
    "brezilya": "BR",
    "meksika": "MX",
    "hollanda": "NL",
    "isveç": "SE", "isvec": "SE",
    "norveç": "NO", "norvec": "NO",
    "danimarka": "DK",
    "finlandiya": "FI",
    "belçika": "BE", "belcika": "BE",
    "isviçre": "CH", "isvicre": "CH",
    "avusturya": "AT",
    "irlanda": "IE",
    "yeni zelanda": "NZ",
    "tayland": "TH",
    "tayvan": "TW",
    "endonezya": "ID",
    "malezya": "MY",
    "filipinler": "PH",
    "iran": "IR", "israil": "IL", "mısır": "EG", "misir": "EG",
    "arjantin": "AR",
    "kolombiya": "CO",
    "güney afrika": "ZA",
}

def extract_country_from_html(html: str) -> tuple:
    if not html:
        return None, None
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        if '/ulke/' in a['href']:
            c_text = a.get_text(strip=True).lower()
            if c_text in TURKISH_COUNTRY_NAME_TO_CODE:
                code = TURKISH_COUNTRY_NAME_TO_CODE[c_text]
                return code, COUNTRY_CODE_TO_NAME.get(code, "ABD")
    m = re.search(r'ülke(?:si)?\s*[:：]\s*([^\r\n<]+)', html, re.I)
    if m:
        c_text = m.group(1).strip().lower()
        for k, code in TURKISH_COUNTRY_NAME_TO_CODE.items():
            if k in c_text:
                return code, COUNTRY_CODE_TO_NAME.get(code, "ABD")
    return None, None

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': 'https://www.hdfilmcehennemi.nl/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}


def fetch_html(url, referer=None, timeout=12, extra_headers=None):
    h = dict(HEADERS)
    if referer:
        h['Referer'] = referer
    if extra_headers:
        h.update(extra_headers)
    if cffi_requests is not None:
        try:
            resp = cffi_requests.get(url, headers=h, impersonate="chrome", timeout=timeout)
            if resp.status_code == 200 and 'Just a moment...' not in resp.text:
                return resp.text
        except Exception:
            pass
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='ignore')


def unpack_jwplayer_hls(embed_url, embed_html):
    """Unpacks obfuscated jwplayer.setup JS or extracts direct .m3u8 / master.txt URL."""
    if not embed_html:
        return None

    # 1. Try Proxy-based Node JS unpacker on jwplayer script block
    soup = BeautifulSoup(embed_html, 'html.parser')
    for s in soup.find_all('script'):
        txt = s.get_text() or ''
        if 'jwplayer' in txt and ('eval(function' in txt or 'sources' in txt or '.split(' in txt or 'master' in txt):
            js_stub = f"""
            const createProxy = () => new Proxy(() => createProxy(), {{
              get: (t, p) => p === 'then' ? undefined : createProxy(),
              apply: () => createProxy()
            }});
            var atob = (str) => Buffer.from(str, 'base64').toString('binary');
            var btoa = (str) => Buffer.from(str, 'binary').toString('base64');
            var window = new Proxy({{
              lastCheckPoint: 0,
              location: {{ href: {json.dumps(embed_url)} }},
              addEventListener: () => {{}},
              removeEventListener: () => {{}},
              navigator: {{ userAgent: 'Mozilla/5.0' }},
              screen: {{ width: 1920, height: 1080 }}
            }}, {{
              get: (target, prop) => prop in target ? target[prop] : createProxy()
            }});
            var document = createProxy();
            var localStorage = {{}};
            var setInterval = () => 0;
            var setTimeout = () => 0;
            var jwplayer = () => ({{
              setup: (cfg) => {{
                if (cfg && cfg.sources && cfg.sources[0] && cfg.sources[0].file) {{
                  console.log('DIRECT_HLS:' + cfg.sources[0].file);
                }}
                return createProxy();
              }},
              on: () => createProxy(),
              addButton: () => createProxy(),
              getContainer: () => createProxy()
            }});
            jwplayer.key = "test";
            var $ = createProxy();
            try {{
              {txt}
            }} catch (e) {{}}
            """
            try:
                res = subprocess.run(['node', '-e', js_stub], capture_output=True, text=True, timeout=6)
                m = re.search(r'DIRECT_HLS:(https?://[^\s"\']+)', res.stdout or '')
                if m:
                    return m.group(1).strip()
            except Exception:
                pass

    # 2. Try variable assignment unpacker (Close Player var_name in sources: [{file: var_name}])
    m_var = re.search(r'sources:\s*\[\{file:\s*(\w+)', embed_html)
    if m_var:
        var_name = m_var.group(1)
        for s in soup.find_all('script'):
            txt = s.get_text() or ''
            if var_name in txt and ('eval(' in txt or 'function' in txt):
                js = f"""
                var atob = (str) => Buffer.from(str, 'base64').toString('binary');
                var btoa = (str) => Buffer.from(str, 'binary').toString('base64');
                var document = {{ querySelector: () => null, addEventListener: () => {{}} }};
                var window = {{ location: {{ href: '' }} }};
                try {{ {txt}; console.log('DIRECT_HLS:' + {var_name}); }} catch (e) {{}}
                """
                try:
                    res = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=6)
                    m = re.search(r'DIRECT_HLS:(https?://[^\s"\']+)', res.stdout or '')
                    if m:
                        return m.group(1).strip()
                except Exception:
                    pass

    # 3. Direct regex fallback for master.txt or .m3u8
    for pat in (
        r'https?://[^"\'\s]*\.mp4/master\.txt[^"\'\s]*',
        r'https?://[^"\'\s]*/hls/[^"\'\s]*/master\.txt[^"\'\s]*',
        r'file:\s*["\'](https?://[^"\'\s]*\.m3u8[^"\'\s]*)["\']',
        r'https?://[^"\'\s]*\.m3u8[^"\'\s]*',
    ):
        m_dir = re.search(pat, embed_html)
        if m_dir:
            return (m_dir.group(1) if m_dir.lastindex else m_dir.group(0)).strip()

    return None


def resolve_hdfilm_streams(page_url, page_html):
    """
    Extracts ONLY direct inner HLS media streams for Close (Dual Audio) and Rapidrame (Subtitled).
    Never returns hdfilmcehennemi bridge embed URLs (/video/embed/ or /rplayer/).
    """
    soup = BeautifulSoup(page_html, 'html.parser')
    iframe_urls = []

    def add_iframe(u):
        if not u:
            return
        u = u.strip()
        if u.startswith('//'):
            u = 'https:' + u
        elif u.startswith('/'):
            u = 'https://www.hdfilmcehennemi.nl' + u
        if u not in iframe_urls:
            iframe_urls.append(u)

    # 1. Default iframes in HTML
    for ifr_tag in soup.find_all('iframe'):
        src = ifr_tag.get('src') or ifr_tag.get('data-src') or ''
        if src and ('video/embed' in src or '/rplayer/' in src or 'playmix' in src or 'rapidrame' in src):
            add_iframe(src)

    # 2. Also scan raw HTML for /video/embed/ or /rplayer/
    for m in re.finditer(r'https?://(?:www\.)?hdfilmcehennemi\.(?:mobi|nl|com|de|net)/(?:video/embed|rplayer)/[^\s"\'<>]+', page_html):
        add_iframe(m.group(0))

    # 3. Check alternative-link buttons with data-video IDs
    for btn in soup.find_all(['button', 'a', 'div'], attrs={'data-video': True}):
        vid = btn.get('data-video')
        if vid and str(vid).isdigit():
            try:
                v_api = f"https://www.hdfilmcehennemi.nl/video/{vid}/"
                raw_json = fetch_html(
                    v_api,
                    referer=page_url,
                    timeout=8,
                    extra_headers={
                        'X-Requested-With': 'fetch',
                        'Content-Type': 'application/json',
                    },
                )
                d = json.loads(raw_json)
                v_html = d.get('data', {}).get('html', '') or ''
                v_soup = BeautifulSoup(v_html, 'html.parser')
                v_ifr = v_soup.find('iframe')
                if v_ifr:
                    v_src = v_ifr.get('src') or v_ifr.get('data-src')
                    if v_src:
                        add_iframe(v_src)
            except Exception:
                pass

    # Expand any rapidrame_id query parameter found inside Close embed URLs
    for ifr in list(iframe_urls):
        m_rapid = re.search(r'rapidrame_id=([a-zA-Z0-9]+)', ifr)
        if m_rapid:
            add_iframe(f"https://www.hdfilmcehennemi.nl/rplayer/{m_rapid.group(1)}/")

    streams = []
    seen_urls = set()

    for ifr in iframe_urls:
        # 1. Close Player (Dual Audio 1080p HLS -> master.txt)
        if 'video/embed/' in ifr:
            try:
                embed_html = fetch_html(ifr, referer=page_url, timeout=10)
                direct_hls = unpack_jwplayer_hls(ifr, embed_html)
                if direct_hls and direct_hls.startswith('http') and direct_hls not in seen_urls:
                    seen_urls.add(direct_hls)
                    streams.append(('Orijinal (Dual Dublaj)', direct_hls, 'hdfilm-hls', 'hdfilm'))
            except Exception:
                pass

        # 2. Rapidrame Player (Subtitled or Dubbed HLS -> .m3u8)
        elif '/rplayer/' in ifr:
            try:
                r_html = fetch_html(ifr, referer=page_url, timeout=10)
                direct_hls = unpack_jwplayer_hls(ifr, r_html)
                if direct_hls and direct_hls.startswith('http') and direct_hls not in seen_urls:
                    seen_urls.add(direct_hls)
                    streams.append(('Orijinal (Altyazılı)', direct_hls, 'rapidrame', 'hdfilm'))
            except Exception:
                pass

        # 3. Already a direct HLS URL
        elif '.m3u8' in ifr or 'master.txt' in ifr:
            if ifr not in seen_urls:
                seen_urls.add(ifr)
                prov = 'rapidrame' if 'rapidrame' in ifr else 'hdfilm-hls'
                label = 'Orijinal (Altyazılı)' if prov == 'rapidrame' else 'Orijinal (Dual Dublaj)'
                streams.append((label, ifr, prov, 'hdfilm'))

    return streams


def sync_hdfilm_movie(url, conn, cur, idx):
    print(f"\n[FİLM] Senkronize ediliyor: {url}", flush=True)
    html = fetch_html(url)
    soup = BeautifulSoup(html, 'html.parser')

    raw_title = soup.title.get_text(strip=True) if soup.title else ""
    t = re.sub(r'\s*(izle|hdfilmcehennemi|film izle|hd film izle|türkçe dublaj|türkçe altyazılı).*$', '', raw_title, flags=re.I)
    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    if not t:
        t = url.rstrip('/').split('/')[-1].replace('-', ' ').title()

    slug_cand = clean_scraped_slug(url.rstrip('/').split('/')[-1])

    did = find_in_index(idx, t, slug=slug_cand)
    if not did:
        cur.execute("SELECT id, title, slug FROM dramas WHERE slug LIKE ? OR title LIKE ?", (f"%{slug_cand}%", f"%{t}%"))
        row = cur.fetchone()
        if row:
            did = row[0]
            t = row[1]
        else:
            c_code, c_name = extract_country_from_html(html)
            yr_m = re.search(r'\b(19\d\d|20\d\d)\b', t + " " + raw_title)
            yr_val = int(yr_m.group(1)) if yr_m else datetime.now().year
            if not c_code:
                try:
                    tmdb_meta = resolve_tmdb_metadata(t, year=yr_val, content_type='film')
                    if tmdb_meta:
                        c_code = tmdb_meta.get("country_code")
                        c_name = tmdb_meta.get("country_name")
                except Exception:
                    pass
            if not c_code or c_code not in COUNTRY_CODE_TO_NAME:
                c_code, c_name = 'US', 'ABD'

            cur.execute("""
                INSERT INTO dramas (title, slug, content_type, country, country_name, release_year, status_broadcast, cover_image, overview, source_url)
                VALUES (?, ?, 'film', ?, ?, ?, 'completed', '/logo-dark.png', ?, ?)
            """, (t, unique_slug(cur, slug_cand), c_code, c_name, yr_val, f"{t} filmi Türkçe dublaj ve altyazılı seçenekleriyle KoUp arşivinde.", url))
            did = cur.lastrowid
            tag_site(cur, did, 'hdfilm')
            print(f"  ✓ Yeni film arşive eklendi: {t} [{c_code} - {c_name}] (ID: #{did})", flush=True)
    else:
        print(f"  ✓ Mevcut film bulundu: {t} (ID: #{did})", flush=True)

    streams = resolve_hdfilm_streams(url, html)
    print(f"  Çözümlenen doğrudan HLS kaynaklar: {len(streams)}", flush=True)

    ep_id, _ = match_or_create_episode(cur, did, 1, 1, "Film", url)
    added = 0
    for sname, surl, sprov, ssite in streams:
        if add_source(cur, ep_id, sname, surl, sprov, ssite):
            added += 1
            print(f"    + {sname} -> {sprov} ({surl[:60]}...)", flush=True)

    reconcile_episode(cur, ep_id, is_placeholder=page_is_placeholder(html))
    safe_commit(conn)
    print(f"  Tamamlandı! +{added} yeni doğrudan medya kaynağı eklendi.", flush=True)


def sync_hdfilm_series(series_url, conn, cur, idx, episodes_limit=None):
    print(f"\n[DİZİ] Senkronize ediliyor: {series_url}", flush=True)
    html = fetch_html(series_url)
    soup = BeautifulSoup(html, 'html.parser')

    raw_title = soup.title.get_text(strip=True) if soup.title else ""
    t = re.sub(r'\s*(izle|hdfilmcehennemi|türkçe dublaj|dizi izle).*$', '', raw_title, flags=re.I)
    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    if not t:
        t = series_url.rstrip('/').split('/')[-1].replace('-', ' ').title()

    slug_cand = clean_scraped_slug(series_url.rstrip('/').split('/')[-1])

    did = find_in_index(idx, t, slug=slug_cand)
    if not did:
        cur.execute("SELECT id, title, slug FROM dramas WHERE slug LIKE ? OR title LIKE ?", (f"%{slug_cand}%", f"%{t}%"))
        row = cur.fetchone()
        if row:
            did = row[0]
            t = row[1]
        else:
            c_code, c_name = extract_country_from_html(html)
            yr_m = re.search(r'\b(19\d\d|20\d\d)\b', t + " " + raw_title)
            yr_val = int(yr_m.group(1)) if yr_m else datetime.now().year
            if not c_code:
                try:
                    tmdb_meta = resolve_tmdb_metadata(t, year=yr_val, content_type='dizi')
                    if tmdb_meta:
                        c_code = tmdb_meta.get("country_code")
                        c_name = tmdb_meta.get("country_name")
                except Exception:
                    pass
            if not c_code or c_code not in COUNTRY_CODE_TO_NAME:
                c_code, c_name = 'US', 'ABD'

            cur.execute("""
                INSERT INTO dramas (title, slug, content_type, country, country_name, release_year, status_broadcast, cover_image, overview, source_url)
                VALUES (?, ?, 'dizi', ?, ?, ?, 'Devam Ediyor', '/logo-dark.png', ?, ?)
            """, (t, unique_slug(cur, slug_cand), c_code, c_name, yr_val, f"{t} dizisi Türkçe dublaj ve altyazılı seçenekleriyle KoUp arşivinde.", series_url))
            did = cur.lastrowid
            tag_site(cur, did, 'hdfilm')
            print(f"  ✓ Yeni dizi arşive eklendi: {t} [{c_code} - {c_name}] (ID: #{did})", flush=True)
    else:
        print(f"  ✓ Mevcut dizi bulundu: {t} (ID: #{did})", flush=True)

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
    print(f"  Toplam {len(ep_links)} bölüm bağlantısı bulundu.", flush=True)

    if episodes_limit:
        ep_links = ep_links[:episodes_limit]
        print(f"  Limit uygulandı: {episodes_limit} bölüm işlenecek.", flush=True)

    total_added = 0
    for s_num, e_num, ep_url in ep_links:
        is_ph = False
        try:
            ep_html = fetch_html(ep_url, referer=series_url)
            is_ph = page_is_placeholder(ep_html)
            streams = resolve_hdfilm_streams(ep_url, ep_html)
            ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)

            ep_added = 0
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    ep_added += 1

            total_added += ep_added
            reconcile_episode(cur, ep_id, is_placeholder=is_ph)
            if ep_added > 0:
                safe_commit(conn)
                print(f"    [{t}] S{s_num}B{e_num}: +{ep_added} doğrudan HLS kaynak bağlandı.", flush=True)
            else:
                safe_commit(conn)
        except Exception as err:
            print(f"    [{t}] S{s_num}B{e_num} hata: {err}", flush=True)

    print(f"  Dizi senkronizasyonu tamamlandı! Toplam +{total_added} doğrudan HLS kaynak eklendi.", flush=True)


def main():
    conn = get_connection()
    ensure_pending_columns(conn)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")

    idx = build_drama_index(cur)
    sync_hdfilm_movie('https://www.hdfilmcehennemi.nl/spider-man-brand-new-day-1/', conn, cur, idx)


if __name__ == '__main__':
    main()
