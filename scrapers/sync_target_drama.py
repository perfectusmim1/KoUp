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
import html as html_lib
import json
import time
import base64
import hashlib
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from difflib import SequenceMatcher
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
    norm_title,
    parse_season_and_episode,
    clean_episode_title,
)
from scrapers.pending_sources import (
    ensure_pending_columns,
    page_is_placeholder,
    reconcile_episode,
)
from scrapers.live_scanner import (
    fetch_animecix_json,
    clean_animecix_provider,
)
from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)

def extract_anchor_text(a) -> str:
    """Extracts text from <a> after removing svg, icon, play and button elements."""
    if not a:
        return ""
    try:
        for tag in a.find_all(['svg', 'i', 'span', 'em', 'button'], class_=lambda c: c and any(k in str(c).lower() for k in ('icon', 'play', 'arrow', 'svg'))):
            tag.decompose()
        for tag in a.find_all(['svg', 'i']):
            tag.decompose()
    except Exception:
        pass
    return a.get_text(strip=True)

def _decode_response_content(content: bytes, text: str, url: str = "") -> str:
    if not content:
        return ""
    # DDizi specifically serves windows-1254 (CP1254) Turkish content
    if url and "ddizi" in url.lower():
        try:
            return content.decode("windows-1254")
        except Exception:
            pass
    # If text has replacement character (\ufffd), attempt Turkish / Western decodings
    if "\ufffd" in text:
        for enc in ("windows-1254", "iso-8859-9", "utf-8"):
            try:
                decoded = content.decode(enc)
                if "\ufffd" not in decoded:
                    return decoded
            except Exception:
                pass
    return text


def fetch_html(url: str, referer: str = None, timeout: int = 15) -> str:
    h = dict(DEFAULT_HEADERS)
    if referer:
        h['Referer'] = referer

    # Always prefer curl_cffi with chrome impersonation when available to bypass Cloudflare and bot checks
    if HAS_CURL_CFFI:
        try:
            s = cfr.Session(impersonate="chrome")
            r = s.get(url, headers=h, timeout=timeout)
            if r.status_code == 200:
                return _decode_response_content(r.content, r.text, url)
        except Exception:
            pass

    # Standard requests session fallback
    try:
        s = requests.Session()
        r = s.get(url, headers=h, timeout=timeout)
        if r.status_code == 200:
            return _decode_response_content(r.content, r.text, url)
    except Exception:
        pass

    # Last fallback to urllib
    try:
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_bytes = resp.read()
            return _decode_response_content(raw_bytes, raw_bytes.decode('utf-8', errors='replace'), url)
    except Exception:
        return ""

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=60.0)
    conn.execute("PRAGMA busy_timeout=60000;")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    ensure_pending_columns(conn)
    return conn


_GENRE_IGNORE = {
    'ilkask', 'arkadaslik', 'romantik', 'aksiyon', 'komedi', 'dram', 'fantastik',
    'gizem', 'koredizisi', 'asya', 'diziizle', 'dizi', 'film', 'anime', 'tarih',
    'gerilim', 'suc', 'aile', 'genclik', 'okul', 'bilimkurgu', 'korku', 'macera',
}

_ASYAWATCH_BUILD_ID = None
_DIZILLA_BUILD_ID = None


def get_asyawatch_build_id() -> str:
    global _ASYAWATCH_BUILD_ID
    if _ASYAWATCH_BUILD_ID:
        return _ASYAWATCH_BUILD_ID
    try:
        raw = fetch_html("https://asyawatch.com/", referer="https://asyawatch.com/", timeout=8)
        m = re.search(r'"buildId"\s*:\s*"([^"]+)"', raw)
        if m:
            _ASYAWATCH_BUILD_ID = m.group(1)
            return _ASYAWATCH_BUILD_ID
    except Exception:
        pass
    return "roDxiuBEE4QePAtjVppYK"


def get_dizilla_build_id() -> str:
    global _DIZILLA_BUILD_ID
    if _DIZILLA_BUILD_ID:
        return _DIZILLA_BUILD_ID
    try:
        raw = fetch_html("https://dizilla.now/", referer="https://dizilla.now/", timeout=8)
        m = re.search(r'"buildId"\s*:\s*"([^"]+)"', raw)
        if m:
            _DIZILLA_BUILD_ID = m.group(1)
            return _DIZILLA_BUILD_ID
    except Exception:
        pass
    return "SMdJuCNMmz-cwhEqAI8Eb"


def _strip_seo_noise(text: str) -> str:
    if not text:
        return ""
    s = str(text)
    s = re.sub(r'★\s*[\d.]+\s*', '', s)
    s = re.sub(r'\b(?:izle|hdfilmcehennemi|film\s*izle|dizi\s*izle|türkçe\s*dublaj|türkçe\s*altyazılı|kore\s*dizisi|kore|japon|tayland|çin|cin|asya|altyazı|dublaj)\b', ' ', s, flags=re.I)
    s = re.sub(r'-(?:izle|dq\d*|hd\d*|hdfc\d*|hdf\d*)\b', ' ', s, flags=re.I)
    s = re.sub(r'\b(?:hd\d+|dq\d+)\b', ' ', s, flags=re.I)
    s = re.sub(r'\b(19\d\d|20\d\d)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def get_drama_search_queries(drama: dict) -> list:
    d = dict(drama) if hasattr(drama, 'keys') else drama
    queries = []
    seen = set()

    def _add(q):
        if not q:
            return
        q_clean = re.sub(r'\s+', ' ', str(q)).strip()
        if len(q_clean) >= 2 and q_clean.lower() not in seen:
            seen.add(q_clean.lower())
            queries.append(q_clean)

    title = d.get('title') or ''
    _add(title)
    # Without parenthetical/season suffixes
    base_t = re.sub(r'\(.*?\)|\[.*?\]', ' ', title)
    base_t = re.sub(r'(\d+)\.\s*sezon|season\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s*season\b|\bfinal\s*season\b', '', base_t, flags=re.I)
    base_t = re.sub(r'\s+(?:II|III|IV|V|VI)$', '', base_t.strip())
    _add(base_t)
    # Without punctuation like Mr. -> Mr
    _add(re.sub(r'[.:!?,]+', ' ', base_t))

    if d.get('native_title'):
        _add(d['native_title'])

    tags_raw = d.get('tags')
    if tags_raw:
        try:
            parsed = json.loads(tags_raw) if isinstance(tags_raw, str) else tags_raw
            if isinstance(parsed, list):
                for alt in parsed:
                    if norm_title(str(alt)) not in _GENRE_IGNORE:
                        _add(str(alt))
        except Exception:
            pass

    return queries[:6]


def score_drama_match(drama: dict, cand_title: str, cand_slug: str = "", cand_year=None, cand_type: str = None) -> float:
    """
    Strict title/original_title + year + type scorer.
    Returns 0.0 if incompatible (wrong year, movie vs series, live action vs anime, or substring false positive).
    """
    d = dict(drama) if hasattr(drama, 'keys') else drama
    d_title = (d.get('title') or '').strip()
    d_ctype = (d.get('content_type') or '').lower()
    d_year_raw = str(d.get('release_year') or '').strip()
    d_year = int(d_year_raw[:4]) if len(d_year_raw) >= 4 and d_year_raw[:4].isdigit() else None

    c_title_low = (cand_title or '').lower()
    c_slug_low = (cand_slug or '').lower()

    # Check movie vs series mismatch
    d_is_movie = (d_ctype == 'film' or 'movie' in d_title.lower() or 'film' in d_title.lower())
    c_is_movie = (
        (cand_type and str(cand_type).lower() in ('movie', 'movies', 'film'))
        or 'movie' in c_title_low
        or 'film:' in c_title_low
        or '/film/' in c_slug_low
    )
    if d_is_movie != c_is_movie:
        return 0.0

    # Check live action vs anime mismatch
    if d_ctype == 'anime' and 'live action' not in d_title.lower() and 'live action' in c_title_low:
        return 0.0

    # Extract year from candidate if not explicitly provided
    c_year = None
    if cand_year and str(cand_year)[:4].isdigit():
        c_year = int(str(cand_year)[:4])
    else:
        m_yr = re.search(r'\b(19\d\d|20\d\d)\b', f"{cand_title} {cand_slug}")
        if m_yr:
            c_year = int(m_yr.group(1))

    has_season_tag = bool(re.search(r'(\d+)\.\s*sezon|season\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s*season\b|\bfinal\s*season\b|\s(?:II|III|IV|V|VI)$', d_title, re.I))
    if d_year and c_year and not has_season_tag:
        if abs(d_year - c_year) > 1:
            return 0.0

    # Build normalized target variants
    target_norms = set()
    for q in get_drama_search_queries(d):
        nt = norm_title(_strip_seo_noise(q))
        if len(nt) >= 2:
            target_norms.add(nt)
    if d.get('slug'):
        sc = norm_title(_strip_seo_noise(d['slug'].replace('-', ' ')))
        if len(sc) >= 2:
            target_norms.add(sc)

    if not target_norms:
        return 0.0

    cand_norms = set()
    if cand_title:
        ct_clean = norm_title(_strip_seo_noise(cand_title))
        if ct_clean:
            cand_norms.add(ct_clean)
    if cand_slug:
        slug_part = cand_slug.rstrip('/').split('/')[-1]
        cs_clean = norm_title(_strip_seo_noise(slug_part.replace('-', ' ')))
        if cs_clean:
            cand_norms.add(cs_clean)

    if not cand_norms:
        return 0.0

    best = 0.0
    for tn in target_norms:
        for cn in cand_norms:
            if tn == cn:
                score = 1.0
            else:
                # Guard against short title matching a longer unrelated title (e.g. 'goblin' vs 'kissgoblin' or 'goblinslayer')
                len_ratio = min(len(tn), len(cn)) / max(len(tn), len(cn))
                if len(tn) <= 8 and len_ratio < 0.85:
                    continue
                score = SequenceMatcher(None, tn, cn).ratio()
            if score > best:
                best = score

    if best >= 0.80 and d_year and c_year and abs(d_year - c_year) <= 1:
        best = min(1.0, best + 0.05)

    try:
        from scrapers.matching import score_series_match, enqueue_match_review
        remote_cand = {
            "title": cand_title,
            "slug": cand_slug,
            "year": c_year,
            "content_type": cand_type,
        }
        match_score, match_reasons = score_series_match(d, remote_cand)
        if match_score == 0.0 and any("mismatch" in r for r in match_reasons):
            return 0.0
        if 0.55 <= best < 0.80:
            enqueue_match_review("sync_target", remote_cand, d, best, match_reasons or [f"fuzzy_title:{best:.2f}"])
    except Exception:
        pass

    return best


def parse_episode_range(url: str = "", text: str = "") -> tuple:
    """
    Returns (season, start_ep, end_ep). If single episode, start_ep == end_ep.
    """
    season, ep = parse_season_and_episode(url, text)
    u = (url or '').lower().strip()
    t = (text or '').lower().strip()
    combined = f"{u} {t}"
    range_m = (
        re.search(r'[-_/](\d{1,3})[-_](\d{1,3})[-_]bolum', u)
        or re.search(r'(?:^|[^\d])(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:\.|\s*[-_])?\s*b[öo]l[üu]m', combined)
    )
    if range_m:
        s_ep = int(range_m.group(1))
        e_ep = int(range_m.group(2))
        if 1 <= s_ep < e_ep and (e_ep - s_ep) <= 100:
            return season, s_ep, e_ep
    return season, ep, ep


def extract_streams_from_html(raw_html: str, site_label: str = "general") -> list:
    """
    Universal standalone stream extractor from episode HTML.
    Automatically decodes base64 <option value="..."> mirrors and unescapes HTML entities.
    Returns list of (source_name, direct_url, provider, site).
    """
    if not raw_html:
        return []

    expanded_parts = [html_lib.unescape(raw_html)]
    # Decode base64 <option value="..."> tags (used on asyaanimeleri.top, tranimeizle, etc.)
    for b64_val in re.findall(r'<option[^>]+value=["\']([A-Za-z0-9+/=]{24,})["\']', raw_html):
        try:
            dec = base64.b64decode(b64_val).decode('utf-8', errors='ignore')
            if 'iframe' in dec.lower() or 'http' in dec.lower() or '//' in dec:
                expanded_parts.append(html_lib.unescape(dec))
        except Exception:
            pass

    full_html = "\n".join(expanded_parts)
    sources = []
    seen = set()

    def _add(sname, surl, sprov):
        if not surl:
            return
        u = surl.strip()
        if u.startswith('//'):
            u = 'https:' + u
        u_low = u.lower()
        if any(dead in u_low for dead in (
            'sibnet.ru', 'sendvid', 'drive.google.com', 'docs.google.com',
            'short.icu', 'short.ink', 'vudeo.', 'dood', 'voe.sx',
            'pixeldrain', '4meplayer', 'uns.bio', 'p2pplay', 'playerp2p',
            'rpmplay', 'video.diziasya.com', 'asyaanim.upns.one', 'upns.one', 'upns.live', 'upns.online',
            'facebook.com', 'twitter.com'
        )):
            return
        if u not in seen:
            seen.add(u)
            sources.append((sname, u, sprov, site_label))

    # 0. PlayerDKorea 1080p
    for pdk_u in re.findall(r'https?://(?:www\.)?playerdkorea\.xyz/video/[a-zA-Z0-9]+', full_html):
        _add('PlayerDKorea 1080p', pdk_u, 'dizikorea')

    # 0.1. EV Player / Morencius 1080p HLS (KoUp Native Player)
    for ev_id in re.findall(r'https?://(?:www\.)?morencius\.com/embed/([a-zA-Z0-9]+)', full_html):
        _add('EV', f'https://morencius.com/embed/{ev_id}', 'morencius')
    for vh_id in re.findall(r'https?://(?:www\.)?(?:vidhide\.[a-z]+|vidhideplus\.com|vidhidevip\.com|vidhidepro\.com|ahvsh\.com)/(?:embed-|e/|v/)([a-zA-Z0-9]+)', full_html):
        _add('EV', f'https://morencius.com/embed/{vh_id}', 'morencius')

    # 1. Pichive 1080p HLS (AsyaWatch / Dizilla)
    for m in re.findall(r'(?:https?:)?//([a-zA-Z0-9_\-\.]*pichive\.[a-z]+/iframe\.php\?v=[a-zA-Z0-9]+)', full_html):
        _add('Pichive 1080p HLS', f'https://{m}', 'asyawatch')

    # 2. Tau Video
    for tid in re.findall(r'https?://tau-video\.xyz/embed/([a-zA-Z0-9]+)', full_html):
        _add('Tau Video', f'https://tau-video.xyz/embed/{tid}', 'tau-video')

    # 3. DBX Pro / MolyStream
    for sh_id in re.findall(r'sheila/([a-zA-Z0-9_-]+)', full_html):
        _add('DBX Pro 1080p', f'https://dbx.molystream.org/embed/sheila/{sh_id}', 'dbx')
    for m_u in re.findall(r'https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+', full_html):
        _add('DBX Pro 1080p', m_u, 'dbx')

    # 4. OK.ru / Odnoklassniki & bulgu.net OK proxy
    for ok_id in re.findall(r'(?:https?:)?//(?:www\.)?(?:ok\.ru|odnoklassniki\.ru)/videoembed/(\d+)', full_html):
        _add('OK.ru HD', f'https://www.ok.ru/videoembed/{ok_id}', 'ok.ru')
    for b_ok in re.findall(r'https?://bulgu\.net/ok/e/[a-zA-Z0-9_-]+', full_html):
        _add('OK.ru HD', b_ok, 'ok.ru')

    # 5. Vidmoly
    for vm_id in re.findall(r'(?:https?:)?//(?:www\.)?vidmoly\.[a-z]+/(?:embed-|w/)([a-zA-Z0-9]+)(?:\.html)?', full_html):
        _add('Vidmoly 1080p', f'https://vidmoly.biz/embed-{vm_id}.html', 'vidmoly')

    # 6. VK Video (vk.com & vkvideo.ru)
    for vk_u in re.findall(r'(?:https?:)?//(?:www\.)?(?:vk\.com|vkvideo\.ru)/video_ext\.php\?[^"\'\s<>]+', full_html):
        _add('VK HD', vk_u, 'vk')

    # 7. Uqload
    for uq_u in re.findall(r'https?://(?:www\.)?uqload\.[a-z]+/embed-[a-zA-Z0-9]+\.html', full_html):
        _add('Uqload', uq_u, 'uqload')

    # 8. Mail.ru
    for mr_id in re.findall(r'(?:https?:)?//my\.mail\.ru/video/embed/(\d+)', full_html):
        _add('Mail.ru HD', f'https://my.mail.ru/video/embed/{mr_id}', 'mail.ru')

    # 9. Dailymotion
    for dm_id in re.findall(r'(?:https?:)?//(?:www\.)?dailymotion\.com/embed/video/([a-zA-Z0-9]+)', full_html):
        _add('Dailymotion HD', f'https://www.dailymotion.com/embed/video/{dm_id}', 'dailymotion')

    # 10. Rumble
    for rm_u in re.findall(r'https?://rumble\.com/embed/[a-zA-Z0-9]+/?(?:\?[^"\'\s<>]*)?', full_html):
        _add('Rumble HD', rm_u, 'rumble')

    # 11. Videa
    for vd_id in re.findall(r'(?:https?:)?//videa\.hu/player\?v=([a-zA-Z0-9]+)', full_html):
        _add('Videa HD', f'https://videa.hu/player?v={vd_id}', 'videa')

    # 12. Abstream & Moon
    for ab_u in re.findall(r'https?://abstream\.to/embed-[a-zA-Z0-9]+\.html', full_html):
        _add('Abstream HD', ab_u, 'abstream')
    for mn_u in re.findall(r'https?://bysetayico\.com/e/[a-zA-Z0-9]+', full_html):
        _add('Moon HD', mn_u, 'moon')

    return sources

def _ep_needs_sources(cur, ep_id: int, site_name: str, total_ep_count: int = 100) -> bool:
    """
    Returns True if we should fetch & extract sources for this episode from site_name.
    - Always True if the episode has 0 active sources.
    - Always True if the episode is marked as pending.
    - True if total sources < 3 and no source from site_name yet.
    """
    # 1. Check if episode is marked pending in DB
    cur.execute("SELECT source_status FROM episodes WHERE id = ?", (ep_id,))
    ep_row = cur.fetchone()
    if ep_row and ep_row[0] == 'pending':
        return True

    # 2. Check active sources
    cur.execute("""
        SELECT site FROM episode_sources 
        WHERE episode_id = ?
          AND direct_url IS NOT NULL 
          AND direct_url != '' 
          AND direct_url != 'dead'
          AND (provider IS NULL OR provider != 'dead')
    """, (ep_id,))
    rows = cur.fetchall()
    if not rows:
        return True

    # 3. Allow fetching if fewer than 3 sources and this site is not represented yet
    existing_sites = set()
    for r in rows:
        for s in (r[0] or '').split(','):
            if s.strip():
                existing_sites.add(s.strip().lower())
    if site_name.lower() not in existing_sites and len(rows) < 3:
        return True

    return False


def sync_dizibox_target(conn, cur, drama, target_url=None):
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("DiziBOX", f'DiziBOX motoru devrede: "{title}"')

    detail_url = target_url
    if not detail_url and 'dizibox' in (d.get('source_url') or '').lower():
        detail_url = d['source_url']

    if detail_url and ('-sezon-' in detail_url or '-bolum' in detail_url):
        m_slug = re.match(r'https?://(?:www\.)?dizibox\.[^/]+/([^/]+?)-\d+-(?:sezon|bolum)', detail_url)
        if m_slug:
            detail_url = f"https://www.dizibox.live/diziler/{m_slug.group(1)}/"
            log("DiziBOX", f"Bölüm URL'si ana dizi sayfasına çevrildi: {detail_url}")
        else:
            ep_h = fetch_html(detail_url, referer="https://www.dizibox.live/")
            if ep_h:
                soup_ep = BeautifulSoup(ep_h, 'html.parser')
                for a in soup_ep.find_all('a', href=True):
                    if '/diziler/' in a['href']:
                        detail_url = a['href']
                        log("DiziBOX", f"Bölüm sayfasından ana dizi sayfası çözümlendi: {detail_url}")
                        break

    if not detail_url:
        for q in get_drama_search_queries(d)[:3]:
            cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', q).strip('-').lower()
            test_url = f"https://www.dizibox.live/diziler/{cand_slug}/"
            try:
                h = fetch_html(test_url, referer="https://www.dizibox.live/")
                if h and ('sezon' in h.lower() or 'bolum' in h.lower() or 'dizi-ozet' in h):
                    soup_t = BeautifulSoup(h, 'html.parser')
                    h1 = soup_t.find('h1')
                    page_title = h1.get_text(strip=True) if h1 else q
                    if score_drama_match(d, page_title, cand_slug) >= 0.80:
                        detail_url = test_url
                        log("DiziBOX", f"Doğrudan dizi URL'si eşleşti: {detail_url}")
                        break
            except Exception:
                pass

    if not detail_url:
        for q in get_drama_search_queries(d)[:3]:
            log("DiziBOX", f'Arama yapılıyor: "{q}"')
            q_enc = urllib.parse.quote(q)
            try:
                search_html = fetch_html(f"https://www.dizibox.live/?s={q_enc}", referer="https://www.dizibox.live/")
                soup = BeautifulSoup(search_html, 'html.parser')
                best_url = None
                best_score = 0.0
                for a in soup.find_all('a', href=True):
                    h = a['href']
                    if '/diziler/' in h:
                        txt = a.get_text(strip=True)
                        sc = score_drama_match(d, txt, h)
                        if sc > best_score and sc >= 0.82:
                            best_score = sc
                            best_url = h
                if best_url:
                    detail_url = best_url
                    log("DiziBOX", f"Arama sonucu bulundu: {detail_url} (skor={best_score:.2f})")
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
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
        if created:
            episodes_added += 1
        safe_commit(conn)

        if not created and not target_url and not _ep_needs_sources(cur, ep_id, 'dizibox', len(ep_links)):
            reconcile_episode(cur, ep_id, is_placeholder=False)
            safe_commit(conn)
            continue

        is_ph = False
        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            is_ph = page_is_placeholder(ep_html)
            m_sheila = re.search(r'sheila/([a-zA-Z0-9_-]+)', ep_html)
            m_molystream = re.search(r'https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+', ep_html)
            m_king = re.search(r'src=["\'](https://www\.dizibox\.live/player/king/king\.php\?v=[^"\']+)["\']', ep_html)
            if not m_king:
                m_king = re.search(r'king\.php\?post_id=(\d+)', ep_html)

            v_url = None
            if m_sheila:
                v_url = f"https://dbx.molystream.org/embed/sheila/{m_sheila.group(1)}"
            elif m_molystream:
                v_url = m_molystream.group(0)
            elif m_king:
                king_u = m_king.group(1) if m_king.group(1).startswith('http') else f"https://www.dizibox.live/king.php?post_id={m_king.group(1)}"
                try:
                    king_html = fetch_html(king_u, referer=ep_url, timeout=10)
                    m_moly = re.search(r'src=["\'](https://dbx\.molystream\.org/embed/[^"\']+)["\']', king_html or '')
                    if m_moly:
                        m_id = re.search(r'/embed/([a-zA-Z0-9-]+)', m_moly.group(1))
                        if m_id:
                            v_url = f"https://dbx.molystream.org/embed/sheila/{m_id.group(1)}"
                except Exception:
                    pass

            if v_url:
                if add_source(cur, ep_id, 'DBX Pro 1080p', v_url, 'dbx', 'dizibox'):
                    sources_added += 1
                    safe_commit(conn)
                    log("DiziBOX", f"S{s_num}E{e_num} -> DBX Pro 1080p eklendi.")

            for sname, surl, sprov, ssite in extract_streams_from_html(ep_html, 'dizibox'):
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    sources_added += 1
                    safe_commit(conn)
        except Exception as e:
            log("DiziBOX", f"S{s_num}E{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=is_ph)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_hdfilm_target(conn, cur, drama, target_url=None):
    from scrapers.sync_hdfilm_target import resolve_hdfilm_streams

    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("HDFilm", f'HDFilmcehennemi motoru devrede: "{title}"')

    detail_url = target_url
    if not detail_url and 'hdfilmcehennemi' in (d.get('source_url') or '').lower():
        src_u = d['source_url']
        detail_url = re.sub(r'/sezon-\d+/bolum-\d+/?$', '/', src_u)

    if not detail_url:
        for q in get_drama_search_queries(d)[:3]:
            cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', q).strip('-').lower()
            for test_url in (
                f"https://www.hdfilmcehennemi.nl/dizi/{cand_slug}-izle/",
                f"https://www.hdfilmcehennemi.nl/dizi/{cand_slug}/",
                f"https://www.hdfilmcehennemi.nl/{cand_slug}-izle/",
                f"https://www.hdfilmcehennemi.nl/{cand_slug}/",
            ):
                try:
                    h = fetch_html(test_url)
                    if h and ('hdfilmcehennemi' in h.lower()) and ('Bulunamadı' not in h):
                        soup_t = BeautifulSoup(h, 'html.parser')
                        h1 = soup_t.find('h1')
                        p_title = h1.get_text(strip=True) if h1 else q
                        if score_drama_match(d, p_title, cand_slug) >= 0.80:
                            detail_url = test_url
                            log("HDFilm", f"Doğrudan yapım URL'si eşleşti: {detail_url}")
                            break
                except Exception:
                    pass
            if detail_url:
                break

    if not detail_url:
        for q in get_drama_search_queries(d)[:3]:
            log("HDFilm", f'Arama deneniyor: "{q}"...')
            try:
                q_enc = urllib.parse.quote(q)
                s_raw = fetch_html(f"https://www.hdfilmcehennemi.nl/search?q={q_enc}")
                best_url = None
                best_score = 0.0
                try:
                    s_data = json.loads(s_raw)
                    for r_html in s_data.get('results', []):
                        bs = BeautifulSoup(r_html, 'html.parser')
                        a = bs.find('a', href=True)
                        if a and a['href']:
                            t_node = bs.find('h4', class_='title') or bs.find(class_='title')
                            t_txt = t_node.get_text(strip=True) if t_node else a.get_text(strip=True)
                            y_node = bs.find('span', class_='year')
                            y_val = y_node.get_text(strip=True) if y_node else None
                            sc = score_drama_match(d, t_txt, a['href'], cand_year=y_val)
                            if sc > best_score and sc >= 0.82:
                                best_score = sc
                                best_url = a['href']
                except Exception:
                    soup = BeautifulSoup(s_raw, 'html.parser')
                    for a in soup.find_all('a', href=True):
                        if '/dizi/' in a['href'] or '-izle' in a['href']:
                            sc = score_drama_match(d, a.get_text(strip=True), a['href'])
                            if sc > best_score and sc >= 0.82:
                                best_score = sc
                                best_url = a['href']
                if best_url:
                    detail_url = best_url
                    log("HDFilm", f"Arama sonucu bulundu: {detail_url} (skor={best_score:.2f})")
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

    if not ep_links:
        if d.get('content_type') == 'film' or 'movie' in title.lower() or 'film' in title.lower():
            ep_id, created = match_or_create_episode(cur, d['id'], 1, 1, "Film", detail_url)
            if created:
                episodes_added += 1
            is_ph = page_is_placeholder(detail_html)
            streams = resolve_hdfilm_streams(detail_url, detail_html)
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    sources_added += 1
                    safe_commit(conn)
                    log("HDFilm", f'"{title}" Film -> {sname} (Doğrudan HLS) bağlandı.')
            reconcile_episode(cur, ep_id, is_placeholder=is_ph)
            safe_commit(conn)
        return episodes_added, sources_added

    ep_links.sort(key=lambda x: (x[0], x[1]))
    log("HDFilm", f"{len(ep_links)} adet bölüm tespit edildi.")

    for s_num, e_num, ep_url in ep_links:
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
        if created:
            episodes_added += 1

        if not created and not target_url and not _ep_needs_sources(cur, ep_id, 'hdfilm', len(ep_links)):
            reconcile_episode(cur, ep_id, is_placeholder=False)
            safe_commit(conn)
            continue

        is_ph = False
        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            is_ph = page_is_placeholder(ep_html)
            streams = resolve_hdfilm_streams(ep_url, ep_html)
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    sources_added += 1
                    safe_commit(conn)
                    log("HDFilm", f'"{title}" S{s_num}B{e_num} -> {sname} (Doğrudan HLS) bağlandı.')
        except Exception as e:
            log("HDFilm", f"S{s_num}B{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=is_ph)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_dizikorea_target(conn, cur, drama, target_url=None):
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("DiziKorea", f'DiziKorea motoru devrede: "{title}"')
    detail_url = target_url
    if not detail_url and 'dizikorea' in (d.get('source_url') or '').lower():
        detail_url = d['source_url']

    if detail_url and ('/sezon-' in detail_url or '/bolum-' in detail_url):
        detail_url = re.sub(r'/(?:sezon|bolum)[^/]*.*$', '', detail_url.rstrip('/'))
        log("DiziKorea", f"Bölüm URL'si ana dizi sayfasına çevrildi: {detail_url}")

    if not detail_url:
        for q in get_drama_search_queries(d)[:3]:
            cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', q).strip('-').lower()
            for suffix in ("-izle-dq", "-izle-dq1", "-izle", ""):
                test_url = f"https://dizikorea3.com/dizi/{cand_slug}{suffix}/"
                try:
                    h = fetch_html(test_url, referer="https://dizikorea3.com/")
                    if h and 'bolum' in h and 'Sayfa Bulunamadı' not in h:
                        soup_t = BeautifulSoup(h, 'html.parser')
                        h1 = soup_t.find('h1')
                        p_title = h1.get_text(strip=True) if h1 else q
                        if score_drama_match(d, p_title, cand_slug) >= 0.80:
                            detail_url = test_url
                            break
                except Exception:
                    pass
            if detail_url:
                break

    if not detail_url:
        for q in get_drama_search_queries(d)[:4]:
            q_enc = urllib.parse.quote(q)
            try:
                s_html = fetch_html(f"https://dizikorea3.com/?s={q_enc}", referer="https://dizikorea3.com/")
                soup = BeautifulSoup(s_html, 'html.parser')
                best_match = None
                best_sim = 0.0
                for a in soup.find_all('a', href=True):
                    h = a['href']
                    txt = a.get_text(strip=True)
                    if '/dizi/' in h and not any(skip in h for skip in ['/kategori/', '/tur/', '/yil/']):
                        sc = score_drama_match(d, txt, h)
                        if sc > best_sim and sc >= 0.82:
                            best_sim = sc
                            best_match = h
                if best_match:
                    detail_url = best_match
                    break
            except Exception:
                pass

    if not detail_url:
        log("DiziKorea", "Uygun DiziKorea sayfası bulunamadı.")
        return 0, 0

    detail_html = fetch_html(detail_url, referer="https://dizikorea3.com/")
    soup = BeautifulSoup(detail_html, 'html.parser')

    ep_links = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '-bolum' in h or '/bolum-' in h:
            if h not in seen:
                seen.add(h)
                raw_ep_txt = extract_anchor_text(a)
                s_num, e_num = parse_season_and_episode(h, raw_ep_txt)
                ep_links.append((s_num, e_num, h, raw_ep_txt))

    ep_links.sort(key=lambda x: (x[0], x[1]))
    log("DiziKorea", f"{len(ep_links)} adet bölüm tespit edildi ({detail_url}).")

    for s_num, e_num, ep_url, raw_ep_txt in ep_links:
        clean_name = clean_episode_title(raw_ep_txt or f"{s_num}. Sezon {e_num}. Bölüm", s_num, e_num, drama_title=d.get('title'))
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, clean_name, ep_url)
        if created:
            episodes_added += 1

        if not created and not target_url and not _ep_needs_sources(cur, ep_id, 'dizikorea', len(ep_links)):
            reconcile_episode(cur, ep_id, is_placeholder=False)
            safe_commit(conn)
            continue

        is_ph = False
        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            is_ph = page_is_placeholder(ep_html)
            for sname, surl, sprov, ssite in extract_streams_from_html(ep_html, 'dizikorea'):
                if add_source(cur, ep_id, sname, surl, sprov, ssite):
                    sources_added += 1
                    safe_commit(conn)
                    log("DiziKorea", f"S{s_num}E{e_num} -> {sname} eklendi.")
        except Exception as e:
            log("DiziKorea", f"S{s_num}E{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=is_ph)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_asyawatch_target(conn, cur, drama, target_url=None):
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("AsyaWatch", f'AsyaWatch motoru devrede: "{title}"')
    build_id = get_asyawatch_build_id()
    headers = {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Referer': 'https://asyawatch.com/',
        'Origin': 'https://asyawatch.com',
        'Accept': 'application/json, text/plain, */*',
    }

    parsed_data = None
    matched_slug = None

    # 1. Try direct slug or target_url
    cand_slugs = []
    if target_url and 'asyawatch.com' in target_url:
        s_part = target_url.split('/dizi/')[-1].strip('/').split('/')[0]
        if s_part:
            cand_slugs.append(s_part)
    if d.get('source_url') and 'asyawatch.com' in d.get('source_url', ''):
        s_part = d['source_url'].split('/dizi/')[-1].strip('/').split('/')[0]
        if s_part and s_part not in cand_slugs:
            cand_slugs.append(s_part)
    for q in get_drama_search_queries(d)[:3]:
        cs = re.sub(r'[^a-z0-9]+', '-', q.lower()).strip('-').replace('-izle', '')
        if cs and cs not in cand_slugs:
            cand_slugs.append(cs)

    for cs in cand_slugs:
        try:
            u = f"https://asyawatch.com/_next/data/{build_id}/dizi/{cs}.json"
            raw = fetch_html(u, referer="https://asyawatch.com/", timeout=8)
            if not raw:
                continue
            j = json.loads(raw)
            sec = j.get('pageProps', {}).get('secureData')
            if sec:
                dec = json.loads(base64.b64decode(sec).decode('utf-8'))
                ci = dec.get('contentItem', {})
                c_title = ci.get('original_title') or ci.get('turkish_title') or cs
                c_year = ci.get('release_year')
                if score_drama_match(d, c_title, cs, cand_year=c_year) >= 0.80:
                    parsed_data = dec
                    matched_slug = cs
                    break
        except Exception:
            pass

    # 2. Try AsyaWatch search API (/api/bg/searchContent)
    if not parsed_data:
        for q in get_drama_search_queries(d)[:3]:
            try:
                q_enc = urllib.parse.quote(q)
                resp = requests.post(
                    f"https://asyawatch.com/api/bg/searchContent?searchterm={q_enc}",
                    headers=headers,
                    timeout=8,
                )
                if resp.status_code == 200:
                    s_raw = resp.json().get('response', '')
                    if s_raw:
                        s_dec = json.loads(base64.b64decode(s_raw).decode('utf-8'))
                        best_slug = None
                        best_sc = 0.0
                        for itm in s_dec.get('result', []):
                            u_slug = (itm.get('used_slug') or '').strip('/')
                            if not u_slug.startswith('dizi/'):
                                continue
                            obj_name = itm.get('object_name') or ''
                            sc = score_drama_match(d, obj_name, u_slug, cand_year=itm.get('release_year'), cand_type=itm.get('used_type'))
                            if sc > best_sc and sc >= 0.82:
                                best_sc = sc
                                best_slug = u_slug.split('dizi/')[-1].strip('/')
                        if best_slug:
                            u = f"https://asyawatch.com/_next/data/{build_id}/dizi/{best_slug}.json"
                            raw = fetch_html(u, referer="https://asyawatch.com/", timeout=8)
                            if raw:
                                j = json.loads(raw)
                                sec = j.get('pageProps', {}).get('secureData')
                                if sec:
                                    parsed_data = json.loads(base64.b64decode(sec).decode('utf-8'))
                                    matched_slug = best_slug
                                    break
            except Exception:
                pass

    if not parsed_data or not matched_slug:
        log("AsyaWatch", "Uygun AsyaWatch sayfası bulunamadı.")
        return 0, 0

    season_results = parsed_data.get('RelatedResults', {}).get('getSerieSeasonAndEpisodes', {}).get('result', [])
    flat_eps = []
    for s in season_results:
        if isinstance(s, dict) and 'episodes' in s:
            for ep in s['episodes']:
                s_no = ep.get('season_no') if ep.get('season_no') is not None else (s.get('season_no') or 1)
                e_no = ep.get('episode_no') if ep.get('episode_no') is not None else 1
                ep_text = ep.get('episode_text') or f"{s_no}. Sezon {e_no}. Bölüm"
                ep_slug = ep.get('used_slug') or f"dizi/{matched_slug}/sezon-{s_no}/bolum-{e_no}"
                flat_eps.append((int(s_no), int(e_no), ep_slug, ep_text))
        elif isinstance(s, dict):
            s_no = s.get('season_no') if s.get('season_no') is not None else 1
            e_no = s.get('episode_no') if s.get('episode_no') is not None else 1
            ep_text = s.get('episode_text') or f"{s_no}. Sezon {e_no}. Bölüm"
            ep_slug = s.get('used_slug') or f"dizi/{matched_slug}/sezon-{s_no}/bolum-{e_no}"
            flat_eps.append((int(s_no), int(e_no), ep_slug, ep_text))

    flat_eps.sort(key=lambda x: (x[0], x[1]))
    log("AsyaWatch", f"{len(flat_eps)} adet bölüm tespit edildi ({matched_slug}).")

    for s_num, e_num, ep_slug, ep_title in flat_eps:
        ep_slug_clean = ep_slug.lstrip('/')
        ep_page_url = f"https://asyawatch.com/{ep_slug_clean}"
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, ep_title, ep_page_url)
        if created:
            episodes_added += 1

        if not created and not target_url and not _ep_needs_sources(cur, ep_id, 'asyawatch', len(flat_eps)):
            reconcile_episode(cur, ep_id, is_placeholder=False)
            safe_commit(conn)
            continue

        try:
            ep_json_url = f"https://asyawatch.com/_next/data/{build_id}/{ep_slug_clean}.json"
            raw_ep = fetch_html(ep_json_url, referer="https://asyawatch.com/", timeout=8)
            if raw_ep:
                edata = json.loads(raw_ep)
                esec = json.loads(base64.b64decode(edata['pageProps']['secureData']).decode('utf-8'))
                esources = esec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                for s in esources:
                    s_content = s.get('source_content', '')
                    s_label = s.get('source_name') or 'AsyaWatch (1080p)'
                    for sname, surl, sprov, ssite in extract_streams_from_html(s_content, 'asyawatch'):
                        disp_name = f"{s_label} 1080p" if sprov == 'asyawatch' else sname
                        if add_source(cur, ep_id, disp_name, surl, sprov, 'asyawatch'):
                            sources_added += 1
                            safe_commit(conn)
                            log("AsyaWatch", f"S{s_num}E{e_num} -> {disp_name} eklendi.")
        except Exception as e:
            log("AsyaWatch", f"S{s_num}E{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=False)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_dizilla_target(conn, cur, drama, target_url=None):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend

    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("Dizilla", f'Dizilla motoru devrede: "{title}"')
    build_id = get_dizilla_build_id()
    headers = {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        'Referer': 'https://dizilla.now/',
        'Origin': 'https://dizilla.now',
        'Accept': 'application/json, text/plain, */*',
    }

    def _decrypt_dizilla(sec_b64: str) -> dict:
        h = hashlib.sha256(b'!!22xx!!90!!').digest()
        key = base64.b64encode(h).decode('ascii')[:32].encode('utf-8')
        iv = bytes(16)
        raw_data = base64.b64decode(sec_b64)
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec = cipher.decryptor()
        decrypted = dec.update(raw_data) + dec.finalize()
        pad_len = decrypted[-1]
        return json.loads(decrypted[:-pad_len].decode('utf-8'))

    parsed_data = None
    matched_slug = None

    cand_slugs = []
    if target_url and 'dizilla' in target_url:
        s_part = target_url.split('/dizi/')[-1].strip('/').split('/')[0]
        if s_part:
            cand_slugs.append(s_part)
    for q in get_drama_search_queries(d)[:3]:
        cs = re.sub(r'[^a-z0-9]+', '-', q.lower()).strip('-').replace('-izle', '')
        if cs and cs not in cand_slugs:
            cand_slugs.append(cs)

    for cs in cand_slugs:
        try:
            u = f"https://dizilla.now/_next/data/{build_id}/dizi/{cs}.json"
            raw = fetch_html(u, referer="https://dizilla.now/", timeout=8)
            if not raw:
                continue
            j = json.loads(raw)
            sec = j.get('pageProps', {}).get('secureData')
            if sec:
                dec = _decrypt_dizilla(sec)
                ci = dec.get('contentItem', {})
                c_title = ci.get('original_title') or ci.get('turkish_title') or cs
                c_year = ci.get('release_year')
                if score_drama_match(d, c_title, cs, cand_year=c_year) >= 0.80:
                    parsed_data = dec
                    matched_slug = cs
                    break
        except Exception:
            pass

    if not parsed_data:
        for q in get_drama_search_queries(d)[:3]:
            try:
                q_enc = urllib.parse.quote(q)
                resp = requests.post(
                    f"https://dizilla.now/api/bg/searchContent?searchterm={q_enc}",
                    headers=headers,
                    timeout=8,
                )
                if resp.status_code == 200:
                    s_raw = resp.json().get('response', '')
                    if s_raw:
                        s_dec = _decrypt_dizilla(s_raw)
                        best_slug = None
                        best_sc = 0.0
                        for itm in s_dec.get('result', []):
                            u_slug = (itm.get('used_slug') or '').strip('/')
                            if not u_slug.startswith('dizi/'):
                                continue
                            obj_name = itm.get('object_name') or ''
                            sc = score_drama_match(d, obj_name, u_slug, cand_year=itm.get('release_year'), cand_type=itm.get('used_type'))
                            if sc > best_sc and sc >= 0.82:
                                best_sc = sc
                                best_slug = u_slug.split('dizi/')[-1].strip('/')
                        if best_slug:
                            u = f"https://dizilla.now/_next/data/{build_id}/dizi/{best_slug}.json"
                            raw = fetch_html(u, referer="https://dizilla.now/", timeout=8)
                            if raw:
                                j = json.loads(raw)
                                sec = j.get('pageProps', {}).get('secureData')
                                if sec:
                                    parsed_data = _decrypt_dizilla(sec)
                                    matched_slug = best_slug
                                    break
            except Exception:
                pass

    if not parsed_data or not matched_slug:
        log("Dizilla", "Uygun Dizilla sayfası bulunamadı.")
        return 0, 0

    season_results = parsed_data.get('RelatedResults', {}).get('getSerieSeasonAndEpisodes', {}).get('result', [])
    flat_eps = []
    for s in season_results:
        if isinstance(s, dict) and 'episodes' in s:
            for ep in s['episodes']:
                s_no = ep.get('season_no') or s.get('season_no') or 1
                e_no = ep.get('episode_no') or 1
                ep_slug = ep.get('used_slug') or f"{matched_slug}-{s_no}-sezon-{e_no}-bolum"
                flat_eps.append((int(s_no), int(e_no), ep_slug))
        elif isinstance(s, dict):
            s_no = s.get('season_no') or 1
            e_no = s.get('episode_no') or 1
            ep_slug = s.get('used_slug') or f"{matched_slug}-{s_no}-sezon-{e_no}-bolum"
            flat_eps.append((int(s_no), int(e_no), ep_slug))

    flat_eps.sort(key=lambda x: (x[0], x[1]))
    log("Dizilla", f"{len(flat_eps)} adet bölüm tespit edildi ({matched_slug}).")

    for s_num, e_num, ep_slug in flat_eps:
        ep_slug_clean = ep_slug.lstrip('/')
        ep_page_url = f"https://dizilla.now/{ep_slug_clean}"
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_page_url)
        if created:
            episodes_added += 1

        if not created and not target_url and not _ep_needs_sources(cur, ep_id, 'dizilla', len(flat_eps)):
            reconcile_episode(cur, ep_id, is_placeholder=False)
            safe_commit(conn)
            continue

        try:
            ep_json_url = f"https://dizilla.now/_next/data/{build_id}/{ep_slug_clean}.json"
            raw_ep = fetch_html(ep_json_url, referer="https://dizilla.now/", timeout=8)
            if raw_ep:
                edata = json.loads(raw_ep)
                esec = _decrypt_dizilla(edata['pageProps']['secureData'])
                esources = esec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                for s in esources:
                    s_content = s.get('source_content', '')
                    for sname, surl, sprov, ssite in extract_streams_from_html(s_content, 'dizilla'):
                        disp_name = 'Dizilla (1080p)' if sprov == 'asyawatch' else sname
                        prov_code = 'dizilla' if sprov == 'asyawatch' else sprov
                        if add_source(cur, ep_id, disp_name, surl, prov_code, 'dizilla'):
                            sources_added += 1
                            safe_commit(conn)
                            log("Dizilla", f"S{s_num}E{e_num} -> {disp_name} eklendi.")
        except Exception as e:
            log("Dizilla", f"S{s_num}E{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=False)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_dizifon_target(conn, cur, drama, target_url=None):
    """
    Synchronizes Korean/Asian dramas from DiziFon (dizifon.cc) as well as its sister WP themes
    (asyadizi.com, asyaluna.com, asyaking.net) when present in source_url or via search.
    Supports both single-episode alternative tabs (/2/, /3/) and multi-episode batch posts (1-3-bolum).
    """
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("DiziFon", f'DiziFon / AsyaDizi motoru devrede: "{title}"')
    candidate_series_urls = []

    if target_url:
        candidate_series_urls.append(target_url)

    src_u = (d.get('source_url') or '').strip()
    if any(dom in src_u.lower() for dom in ('dizifon', 'asyadizi.com', 'asyaluna.com', 'asyaking.net')):
        if src_u not in candidate_series_urls:
            candidate_series_urls.append(src_u)

    # Resolve any episode URLs to the official series page
    resolved_candidates = []
    for cand_u in candidate_series_urls:
        if ('/bolum/' in cand_u or '-bolum' in cand_u) and '/dizi/' not in cand_u:
            try:
                ep_h = fetch_html(cand_u, referer=cand_u, timeout=10)
                if ep_h:
                    soup_ep = BeautifulSoup(ep_h, 'html.parser')
                    found_s_link = None
                    for a in soup_ep.find_all('a', href=True):
                        if '/dizi/' in a['href']:
                            found_s_link = a['href']
                            break
                    if found_s_link:
                        log("DiziFon", f"Bölüm URL'si ana dizi sayfasına çevrildi: {found_s_link}")
                        resolved_candidates.append(found_s_link)
                        continue
            except Exception:
                pass
        resolved_candidates.append(cand_u)
    candidate_series_urls = list(dict.fromkeys(resolved_candidates))

    # Search dizifon.cc for the drama
    for q in get_drama_search_queries(d)[:3]:
        q_enc = urllib.parse.quote(q)
        try:
            s_html = fetch_html(f"https://www.dizifon.cc/?s={q_enc}", referer="https://www.dizifon.cc/", timeout=10)
            if s_html:
                soup = BeautifulSoup(s_html, 'html.parser')
                best_u = None
                best_sc = 0.0
                for a in soup.find_all('a', href=True):
                    h = a['href']
                    if '/dizi/' in h and not any(skip in h for skip in ['/tur/', '/ulkeler/', '/yil/']):
                        txt = a.get_text(strip=True)
                        sc = score_drama_match(d, txt, h)
                        if sc > best_sc and sc >= 0.82:
                            best_sc = sc
                            best_u = h
                if best_u and best_u not in candidate_series_urls:
                    candidate_series_urls.append(best_u)
                    break
        except Exception:
            pass

    if not candidate_series_urls:
        log("DiziFon", "Uygun DiziFon / AsyaDizi sayfası bulunamadı.")
        return 0, 0

    for detail_url in candidate_series_urls:
        site_tag = 'dizifon'
        if 'asyadizi' in detail_url:
            site_tag = 'asyadizi'
        elif 'asyaluna' in detail_url:
            site_tag = 'asyaluna'
        elif 'asyaking' in detail_url:
            site_tag = 'asyaking'

        detail_html = fetch_html(detail_url, referer=detail_url, timeout=12)
        if not detail_html:
            continue
        soup = BeautifulSoup(detail_html, 'html.parser')

        ep_items = []
        seen_urls = set()
        for a in soup.find_all('a', href=True):
            h = a['href'].strip()
            txt = a.get_text(strip=True)
            if not h or h in seen_urls or '#comment' in h or 'facebook.com' in h or 'twitter.com' in h or '/tum-bolumler' in h:
                continue
            if ('/bolum/' in h or '-bolum' in h) and '/dizi/' not in h and '/diziler/' not in h:
                seen_urls.add(h)
                s_num, start_ep, end_ep = parse_episode_range(h, txt)
                ep_items.append((s_num, start_ep, end_ep, h, txt))

        ep_items.sort(key=lambda x: (x[0], x[1], x[2]))
        log("DiziFon", f"{detail_url} üzerinde {len(ep_items)} bölüm/paket bağlantısı bulundu.")

        for s_num, start_ep, end_ep, ep_url, raw_txt in ep_items:
            if start_ep == end_ep:
                e_num = start_ep
                ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                if created:
                    episodes_added += 1

                if not created and not target_url and not _ep_needs_sources(cur, ep_id, site_tag, len(ep_items)):
                    reconcile_episode(cur, ep_id, is_placeholder=False)
                    safe_commit(conn)
                    continue

                is_ph = False
                try:
                    ep_html = fetch_html(ep_url, referer=detail_url, timeout=10)
                    is_ph = page_is_placeholder(ep_html)
                    for sname, surl, sprov, ssite in extract_streams_from_html(ep_html, site_tag):
                        if add_source(cur, ep_id, sname, surl, sprov, site_tag):
                            sources_added += 1
                            safe_commit(conn)
                            log("DiziFon", f"S{s_num}E{e_num} -> {sname} eklendi.")

                    # Check alternative player tabs (/2/, /3/) on single episode page
                    esoup = BeautifulSoup(ep_html, 'html.parser')
                    base_clean = ep_url.rstrip('/')
                    alt_urls = []
                    for pa in esoup.find_all('a', href=True):
                        ph = pa['href'].strip()
                        if ph.startswith(base_clean + '/') and re.search(r'/\d+/?$', ph):
                            if ph not in alt_urls:
                                alt_urls.append(ph)
                    for alt_u in alt_urls[:3]:
                        alt_html = fetch_html(alt_u, referer=ep_url, timeout=8)
                        for sname, surl, sprov, ssite in extract_streams_from_html(alt_html, site_tag):
                            if add_source(cur, ep_id, sname, surl, sprov, site_tag):
                                sources_added += 1
                                safe_commit(conn)
                                log("DiziFon", f"S{s_num}E{e_num} (Alt) -> {sname} eklendi.")
                except Exception as e:
                    log("DiziFon", f"S{s_num}E{e_num} hata: {e}")

                reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                safe_commit(conn)
            else:
                # Multi-episode range post (e.g. 1-3-bolum on asyaluna / asyadizi / dizifon)
                ep_ids_in_range = {}
                any_needed = False
                for e_num in range(start_ep, end_ep + 1):
                    u_for_ep = ep_url if e_num == start_ep else f"{ep_url.rstrip('/')}/{e_num - start_ep + 1}/"
                    ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", u_for_ep)
                    if created:
                        episodes_added += 1
                    ep_ids_in_range[e_num] = (ep_id, u_for_ep)
                    if created or _ep_needs_sources(cur, ep_id, site_tag, end_ep):
                        any_needed = True

                if not any_needed:
                    continue

                try:
                    first_html = fetch_html(ep_url, referer=detail_url, timeout=10)
                    first_streams = extract_streams_from_html(first_html, site_tag)
                    esoup = BeautifulSoup(first_html, 'html.parser')
                    base_clean = ep_url.rstrip('/')
                    sub_pages = {1: first_streams}
                    for k in range(2, (end_ep - start_ep) + 2):
                        cand_sub = f"{base_clean}/{k}/"
                        if cand_sub in first_html or f"/{k}/" in first_html:
                            sub_html = fetch_html(cand_sub, referer=ep_url, timeout=8)
                            sub_streams = extract_streams_from_html(sub_html, site_tag)
                            if sub_streams:
                                sub_pages[k] = sub_streams

                    for idx_k, e_num in enumerate(range(start_ep, end_ep + 1), 1):
                        ep_id, _ = ep_ids_in_range[e_num]
                        streams_for_ep = sub_pages.get(idx_k) or first_streams
                        for sname, surl, sprov, ssite in streams_for_ep:
                            if add_source(cur, ep_id, sname, surl, sprov, site_tag):
                                sources_added += 1
                                safe_commit(conn)
                                log("DiziFon", f"S{s_num}E{e_num} (Paket) -> {sname} eklendi.")
                        reconcile_episode(cur, ep_id, is_placeholder=False)
                        safe_commit(conn)
                except Exception as e:
                    log("DiziFon", f"S{s_num}E{start_ep}-{end_ep} paket hatası: {e}")

    return episodes_added, sources_added


def sync_bldrama_target(conn, cur, drama, target_url=None):
    d_dict = dict(drama) if hasattr(drama, 'keys') else drama
    title = d_dict['title']
    episodes_added = 0
    sources_added = 0
    log("BLDrama", f'BLDrama motoru devrede: "{title}"')

    detail_url = target_url
    if not detail_url and d_dict.get('source_url'):
        src = d_dict['source_url']
        if 'webdramaturkey' in src or 'bldrama' in src:
            detail_url = re.sub(r'https?://(?:www\.)?webdramaturkey\d*\.com', 'https://bldramaturkey.co', src)

    if not detail_url:
        for q in get_drama_search_queries(d_dict)[:3]:
            cand_slug = re.sub(r'[^a-zA-Z0-9]+', '-', q).strip('-').lower()
            for test_url in (f"https://bldramaturkey.co/dizi/{cand_slug}-izle", f"https://bldramaturkey.co/dizi/{cand_slug}"):
                try:
                    h = fetch_html(test_url)
                    if h and ('bolum' in h or 'sezon' in h):
                        soup_t = BeautifulSoup(h, 'html.parser')
                        h1 = soup_t.find('h1')
                        p_title = h1.get_text(strip=True) if h1 else q
                        if score_drama_match(d_dict, p_title, cand_slug) >= 0.78:
                            detail_url = test_url
                            break
                except Exception:
                    pass
            if detail_url:
                break

    if not detail_url:
        log("BLDrama", "Uygun BLDrama sayfası bulunamadı.")
        return 0, 0

    if detail_url and ('-bolum' in detail_url or '/bolum-' in detail_url) and '/dizi/' not in detail_url:
        try:
            ep_h = fetch_html(detail_url)
            if ep_h:
                soup_ep = BeautifulSoup(ep_h, 'html.parser')
                for a in soup_ep.find_all('a', href=True):
                    if '/dizi/' in a['href']:
                        detail_url = a['href']
                        log("BLDrama", f"Bölüm URL'si ana dizi sayfasına çevrildi: {detail_url}")
                        break
        except Exception:
            pass

    try:
        detail_html = fetch_html(detail_url)
        soup = BeautifulSoup(detail_html, 'html.parser')

        ep_links = []
        seen = set()
        for a in soup.find_all('a', href=True):
            h = a['href']
            if '-bolum' in h or '/bolum-' in h:
                if h not in seen:
                    seen.add(h)
                    s_num, start_ep, end_ep = parse_episode_range(h, a.get_text())
                    ep_links.append((s_num, start_ep, end_ep, h))

        ep_links.sort(key=lambda x: (x[0], x[1], x[2]))
        log("BLDrama", f"{len(ep_links)} adet bölüm bağlantısı tespit edildi.")

        bldrama_session = cfr.Session(impersonate="chrome") if HAS_CURL_CFFI else requests.Session()

        for s_num, start_ep, end_ep, ep_url in ep_links:
            target_ep_ids = []
            for e_num in range(start_ep, end_ep + 1):
                clean_name = clean_episode_title(f"{s_num}. Sezon {e_num}. Bölüm", s_num, e_num)
                u_ep = ep_url if e_num == start_ep else f"{ep_url}#ep-{e_num}"
                ep_id, created = match_or_create_episode(cur, d_dict['id'], s_num, e_num, clean_name, u_ep)
                if created:
                    episodes_added += 1
                if created or _ep_needs_sources(cur, ep_id, 'bldrama', len(ep_links)):
                    target_ep_ids.append((e_num, ep_id))
                else:
                    reconcile_episode(cur, ep_id, is_placeholder=False)
                    safe_commit(conn)

            if not target_ep_ids:
                continue

            try:
                ep_url_live = re.sub(r'https?://(?:www\.)?webdramaturkey\d*\.com', 'https://bldramaturkey.co', ep_url)
                ep_html = fetch_html(ep_url_live, referer=detail_url) or fetch_html(ep_url, referer=detail_url)
                ep_soup = BeautifulSoup(ep_html, 'html.parser')

                # Collect unique data-embed IDs, preferring clean menu item names over 'Kaynak:... Alternatif'
                embed_map = {}
                for el in ep_soup.find_all(attrs={'data-embed': True}):
                    eid = el.get('data-embed')
                    sname = el.get_text(strip=True) or 'BLDrama'
                    if not eid:
                        continue
                    if eid not in embed_map or 'kaynak:' in embed_map[eid].lower() or 'alternatif' in embed_map[eid].lower():
                        embed_map[eid] = sname

                resolved_streams = []
                for embed_id, sname in embed_map.items():
                    if any(bad in sname.lower() for bad in ('upn', 'p2p')):
                        continue
                    try:
                        resp = bldrama_session.post('https://bldramaturkey.co/ajax/embed', data={'id': embed_id}, headers={
                            'User-Agent': DEFAULT_HEADERS['User-Agent'],
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': ep_url_live
                        }, timeout=10)
                        m = re.search(r'hash=([a-zA-Z0-9]+)', resp.text)
                        if m:
                            v_res = bldrama_session.get(f'https://bldramaturkey.co/video.php?hash={m.group(1)}', headers={
                                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                                'Referer': ep_url_live
                            }, timeout=10)
                            extracted = extract_streams_from_html(v_res.text, 'bldrama')
                            if extracted:
                                resolved_streams.extend(extracted)
                            else:
                                for ifr in re.findall(r'<iframe[^>]+src=["\']([^"\']+)["\']', v_res.text):
                                    if ifr.startswith('//'):
                                        ifr = 'https:' + ifr
                                    prov = 'vidmoly' if 'vidmoly' in ifr else ('vk' if 'vk' in ifr else ('ok.ru' if 'ok' in ifr else 'bldrama'))
                                    resolved_streams.append((sname, ifr, prov, 'bldrama'))
                    except Exception:
                        pass

                for e_num, ep_id in target_ep_ids:
                    for sname, surl, sprov, ssite in resolved_streams:
                        if add_source(cur, ep_id, sname, surl, sprov, 'bldrama'):
                            sources_added += 1
                            safe_commit(conn)
                            log("BLDrama", f"S{s_num}E{e_num} -> {sname} ({sprov}) eklendi.")
                    reconcile_episode(cur, ep_id, is_placeholder=False)
                    safe_commit(conn)
            except Exception as e:
                log("BLDrama", f"S{s_num}E{start_ep} hata: {e}")
    except Exception as e:
        log("BLDrama", f"Genel hata: {e}")

    return episodes_added, sources_added


def sync_animecix_target(conn, cur, drama, target_url=None):
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("AnimeciX", f'AnimeciX motoru devrede: "{title}"')

    # Detect target season from drama title if applicable (e.g. "3.Sezon", "3rd Season", "Season 3", Roman numerals II/III/IV/V)
    explicit_season = None
    season_match = re.search(r'(\d+)\.\s*sezon|season\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s*season\b', title, flags=re.I)
    if season_match:
        explicit_season = int(season_match.group(1) or season_match.group(2) or season_match.group(3))
    else:
        roman_m = re.search(r'\s+(II|III|IV|V|VI)$', re.sub(r'\(.*?\)', '', title).strip())
        if roman_m:
            roman_map = {'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6}
            explicit_season = roman_map.get(roman_m.group(1))

    # Also detect explicit_season from target_url or source_url if not in title (e.g. /season/1)
    if explicit_season is None:
        for u_cand in (target_url, d.get('source_url')):
            if u_cand and '/season/' in str(u_cand).lower():
                sm = re.search(r'/season/(\d+)', str(u_cand), flags=re.I)
                if sm:
                    explicit_season = int(sm.group(1))
                    break

    is_movie_drama = (d.get('content_type') == 'film' or 'movie' in title.lower() or 'film' in title.lower())

    try:
        anime_id = None
        target_name = None
        matched_is_movie = is_movie_drama

        # 1. If target_url, source_url, existing episodes, or series_automations has an AnimeciX ID, use it
        for u_cand in (target_url, d.get('source_url')):
            if u_cand and '/titles/' in str(u_cand):
                m = re.search(r'/titles/(\d+)', str(u_cand))
                if m:
                    anime_id = int(m.group(1))
                    target_name = f"AnimeciX #{anime_id}"
                    break
            elif u_cand and str(u_cand).strip().isdigit():
                anime_id = int(str(u_cand).strip())
                target_name = f"AnimeciX #{anime_id}"
                break

        if not anime_id:
            try:
                cur.execute(
                    "SELECT episode_url FROM episodes WHERE drama_id = ? AND episode_url LIKE '%/titles/%' LIMIT 1",
                    (d['id'],),
                )
                ep_u_row = cur.fetchone()
                if ep_u_row and ep_u_row[0]:
                    m_ep = re.search(r'/titles/(\d+)', str(ep_u_row[0]))
                    if m_ep:
                        anime_id = int(m_ep.group(1))
                        target_name = f"{title} (AnimeciX #{anime_id})"
                        log("AnimeciX", f"Mevcut bölümlerden AnimeciX ID tespit edildi: {anime_id}")
            except Exception:
                pass

        if not anime_id:
            try:
                cur.execute("SELECT site_slugs FROM series_automations WHERE media_id = ?", (d['id'],))
                sa_row = cur.fetchone()
                if sa_row and sa_row[0]:
                    sa_slugs = json.loads(sa_row[0]) if isinstance(sa_row[0], str) else sa_row[0]
                    ac_val = str(sa_slugs.get('animecix') or '')
                    m_sa = re.search(r'(\d+)', ac_val)
                    if m_sa:
                        anime_id = int(m_sa.group(1))
                        target_name = f"{title} (AnimeciX #{anime_id})"
            except Exception:
                pass

        # 1b. Reconcile any episodes/sources already synced to Cloudflare R2 bundle by Vercel Cloud Sync
        try:
            r2_pub = os.getenv("R2_PUBLIC_URL") or "https://pub-e62742f127324512937cc3ff34c976bd.r2.dev"
            r2_resp = requests.get(f"{r2_pub}/sources/{d['id']}.json?t={int(time.time())}", timeout=8)
            if r2_resp.ok:
                r2_bundle = r2_resp.json()
                for b_ep in (r2_bundle.get("episodes") or []):
                    b_s = int(b_ep.get("season_number") or 1)
                    b_e = int(b_ep.get("episode_number") or 1)
                    if (d.get('id') == 6997 or anime_id == 84 or str(d.get('slug') or '').lower() == 'dragon-ball'):
                        if b_e > 153:
                            continue
                        b_s = 1
                    b_ep_id, b_created = match_or_create_episode(
                        cur, d['id'], b_s, b_e,
                        b_ep.get("episode_name") or f"Bölüm {b_e}",
                        f"https://animecix.tv/titles/{anime_id or 0}/season/{b_s}/episode/{b_e}" if anime_id else None,
                    )
                    if b_created:
                        episodes_added += 1
                    for b_src in (b_ep.get("sources") or []):
                        b_url = (b_src.get("direct_url") or "").strip()
                        b_pname = b_src.get("source_name") or "Tau Video"
                        b_prov = b_src.get("provider") or "tau-video"
                        b_site = b_src.get("site") or "animecix"
                        if b_url and add_source(cur, b_ep_id, b_pname, b_url, b_prov, b_site):
                            sources_added += 1
                    reconcile_episode(cur, b_ep_id, is_placeholder=False)
                safe_commit(conn)
        except Exception:
            pass

        # 2. Search AnimeciX titles via AESGCM API across candidate queries
        if not anime_id:
            best_match = None
            best_sim = 0.0
            for q in get_drama_search_queries(d)[:4]:
                q_enc = urllib.parse.quote(q.strip())
                qs = f"query={q_enc}&onlyStreamable=true&page=1&perPage=12"
                data = fetch_animecix_json("titles", qs)
                if not data or 'pagination' not in data:
                    continue
                results = data['pagination'].get('data', [])
                for r in results:
                    r_type = r.get('title_type') or ('movie' if r.get('is_movie') else 'anime')
                    r_year = r.get('year')
                    for cand_field in (r.get('name'), r.get('name_english'), r.get('original_title')):
                        if not cand_field:
                            continue
                        sc = score_drama_match(d, cand_field, cand_year=r_year, cand_type=r_type)
                        if sc > best_sim:
                            best_sim = sc
                            best_match = r
                if best_sim >= 0.92:
                    break

            if not best_match or best_sim < 0.75:
                log("AnimeciX", f"AnimeciX üzerinde yeterli benzerlikte eşleşme bulunamadı (En iyi: {best_sim:.2f}).")
                return 0, 0

            anime_id = best_match.get('id')
            target_name = best_match.get('name') or best_match.get('name_english')
            matched_is_movie = (best_match.get('title_type') == 'movie' or is_movie_drama)
            log("AnimeciX", f"Hedef anime bulundu: {target_name} (ID: {anime_id}, Benzerlik: {best_sim:.2f})")

        # 3. Check existing episodes for this drama
        cur.execute("SELECT id, season_number, episode_number FROM episodes WHERE drama_id = ?", (d['id'],))
        ep_rows = cur.fetchall()
        ep_map = {}
        for r in ep_rows:
            ep_map[(r[1], r[2])] = r[0]

        db_seasons = set(r[1] for r in ep_rows if r[1] and r[1] > 0)
        single_season_in_db = (len(db_seasons) <= 1 and (not db_seasons or 1 in db_seasons))

        is_dragon_ball = (
            d.get('id') == 6997
            or anime_id == 84
            or str(d.get('slug') or '').lower() == 'dragon-ball'
            or 'dragon-ball' in str(target_url or '').lower()
        )

        # 4. Fetch all videos for this title from AnimeciX (up to 60 pages for long series like One Piece)
        all_videos = []
        page = 1
        while page <= 60:
            v_qs = f"titleId={anime_id}&page={page}&perPage=100"
            v_data = fetch_animecix_json("videos", v_qs)
            if not v_data or 'pagination' not in v_data:
                break
            videos = v_data['pagination'].get('data', [])
            if not videos:
                break
            all_videos.extend(videos)
            last_page = v_data['pagination'].get('last_page', 1) or 1
            if page >= last_page:
                break
            page += 1

        # Resolve missing episode_num by looking at episode_id sequence within each season
        eid_to_enum = {}
        by_season_eids = {}
        for v in all_videos:
            s_num = int(v.get('season_num') or 1)
            e_id = v.get('episode_id')
            raw_e = v.get('episode_num')
            if e_id:
                if s_num not in by_season_eids:
                    by_season_eids[s_num] = {}
                if e_id not in by_season_eids[s_num] or raw_e is not None:
                    by_season_eids[s_num][e_id] = int(raw_e) if raw_e is not None else None

        for s_num, eids_dict in by_season_eids.items():
            sorted_eids = sorted(eids_dict.keys())
            curr_enum = 0
            for eid in sorted_eids:
                known_e = eids_dict[eid]
                if known_e is not None:
                    curr_enum = known_e
                    eid_to_enum[eid] = known_e
                else:
                    curr_enum += 1
                    eid_to_enum[eid] = curr_enum

        for v in all_videos:
            v_url = (v.get('url') or '').strip()
            if not v_url:
                continue
            v_low = v_url.lower()
            v_name = (v.get('name') or '').strip()

            # Skip trailers, openings, and dead hosts
            if (
                v.get('type') == 'trailer'
                or 'youtube.com' in v_low
                or 'youtu.be' in v_low
                or 'trailer' in v_name.lower()
                or any(dead in v_low for dead in [
                    'sibnet.ru', 'sibnet', 'sendvid', 'drive.google.com', 'docs.google.com',
                    'dood', 'short.icu', 'pixeldrain', '4meplayer', 'asyaanim.upns.one', 'upns.one',
                    'vudeo.', 'streamsb.', 'streamtape.com/e/'
                ])
                or v_low.endswith('/e/')
            ):
                continue

            raw_snum = v.get('season_num')
            raw_enum = v.get('episode_num')
            if raw_enum is None and v.get('episode_id') in eid_to_enum:
                raw_enum = eid_to_enum[v.get('episode_id')]

            if raw_enum is None and not matched_is_movie:
                continue

            v_snum = int(raw_snum) if raw_snum else 1
            v_enum = int(raw_enum) if raw_enum else 1

            if is_dragon_ball:
                if v_enum > 153:
                    continue
                target_s = 1
                target_e = v_enum
            elif single_season_in_db and not explicit_season and d.get('content_type') == 'anime' and v_snum != 1:
                continue
            elif explicit_season and single_season_in_db:
                if v_snum != explicit_season:
                    continue
                target_s = 1
                target_e = v_enum
            elif explicit_season:
                if v_snum != explicit_season:
                    continue
                target_s = explicit_season
                target_e = v_enum
            else:
                target_s = v_snum
                target_e = v_enum

            prov = clean_animecix_provider(v_name, v_url)
            if prov == 'tau-video':
                clean_pname = 'Tau Video'
            elif prov == 'uqload':
                clean_pname = 'Uqload'
            elif prov == 'mp4upload':
                clean_pname = 'Mp4Upload'
            elif prov == 'ok.ru':
                clean_pname = 'OK.ru HD'
            elif prov == 'mail.ru':
                clean_pname = 'Mail.ru HD'
            else:
                clean_pname = prov.capitalize()

            if 'dublaj' in v_name.lower():
                clean_pname += ' (Türkçe Dublaj)'
            elif 'altyazı' in v_name.lower():
                clean_pname += ' (Türkçe Altyazılı)'

            ep_id = ep_map.get((target_s, target_e))
            if not ep_id:
                ep_url = f"https://animecix.tv/titles/{anime_id}/season/{v_snum}/episode/{v_enum}"
                ep_id, created = match_or_create_episode(
                    cur, d['id'], target_s, target_e,
                    f"{target_s}. Sezon {target_e}. Bölüm", ep_url
                )
                if created:
                    episodes_added += 1
                ep_map[(target_s, target_e)] = ep_id

            if add_source(cur, ep_id, clean_pname, v_url, prov, 'animecix'):
                sources_added += 1
                safe_commit(conn)

            reconcile_episode(cur, ep_id, is_placeholder=False)

        safe_commit(conn)

        log("AnimeciX", f"Tamamlandı: {episodes_added} yeni bölüm, {sources_added} yeni çalışan kaynak eklendi.")
    except Exception as e:
        log("AnimeciX", f"Hata: {e}")

    return episodes_added, sources_added


def sync_asyaanimeleri_target(conn, cur, drama, target_url=None):
    """
    Recovers anime & Chinese donghua streams from asyaanimeleri.top (decoding base64 <option> mirrors:
    OK.ru, VK, Vidmoly, Rumble, Mail.ru, Dailymotion) and maps batch range compilations (e.g. 1-15-bolum)
    across all corresponding episodes in the range.
    """
    d = dict(drama) if hasattr(drama, 'keys') else drama
    did = d['id']
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("AsyaAnimeleri", f'AsyaAnimeleri motoru devrede: "{title}"')

    # Phase 1: Directly heal existing empty episodes that already point to asyaanimeleri.top
    cur.execute("""
        SELECT e.id, e.season_number, e.episode_number, e.episode_url
        FROM episodes e
        WHERE e.drama_id = ?
          AND (e.episode_url LIKE '%asyaanimeleri.top%' OR e.episode_url LIKE '%asyaanimeleri.com%')
          AND NOT EXISTS (SELECT 1 FROM episode_sources s WHERE s.episode_id = e.id)
        ORDER BY e.season_number, e.episode_number
    """, (did,))
    direct_eps = cur.fetchall()

    html_cache = {}
    for ep_id, s_num, e_num, ep_url in direct_eps:
        base_u = (ep_url or '').split('#')[0].strip()
        if not base_u or '/series/' in base_u:
            continue
        if base_u not in html_cache:
            html_cache[base_u] = fetch_html(base_u, referer="https://asyaanimeleri.top/", timeout=10)
        ep_html = html_cache[base_u]
        if ep_html:
            streams = extract_streams_from_html(ep_html, 'asyaanimeleri')
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, 'asyaanimeleri'):
                    sources_added += 1
            if streams:
                reconcile_episode(cur, ep_id, is_placeholder=False)
    safe_commit(conn)

    # Check if any empty episodes still remain
    cur.execute("""
        SELECT e.id, COALESCE(e.season_number, 1), e.episode_number
        FROM episodes e
        WHERE e.drama_id = ?
          AND NOT EXISTS (SELECT 1 FROM episode_sources s WHERE s.episode_id = e.id)
    """, (did,))
    remaining_empty = {(r[1], r[2]): r[0] for r in cur.fetchall()}
    if not remaining_empty and sources_added > 0:
        return episodes_added, sources_added

    # Phase 2: Crawl the series page on asyaanimeleri.top
    series_url = target_url
    if not series_url and ('asyaanimeleri.top/series/' in (d.get('source_url') or '') or 'asyaanimeleri.com/series/' in (d.get('source_url') or '')):
        series_url = d['source_url']

    if series_url and '/series/' not in series_url:
        try:
            ep_h = fetch_html(series_url, referer="https://asyaanimeleri.top/", timeout=8)
            if ep_h:
                soup_ep = BeautifulSoup(ep_h, 'html.parser')
                for a in soup_ep.find_all('a', href=True):
                    if '/series/' in a['href']:
                        series_url = a['href']
                        log("AsyaAnimeleri", f"Bölüm URL'si ana seri sayfasına çevrildi: {series_url}")
                        break
        except Exception:
            pass

    if not series_url:
        for q in get_drama_search_queries(d)[:3]:
            cand_slug = re.sub(r'[^a-z0-9]+', '-', q.lower()).strip('-')
            test_u = f"https://asyaanimeleri.top/series/{cand_slug}/"
            h = fetch_html(test_u, referer="https://asyaanimeleri.top/", timeout=8)
            if h and 'bolum' in h.lower() and 'Sayfa bulunamadı' not in h:
                series_url = test_u
                break

    if not series_url:
        return episodes_added, sources_added

    s_html = fetch_html(series_url, referer="https://asyaanimeleri.top/", timeout=10)
    if not s_html:
        return episodes_added, sources_added

    soup = BeautifulSoup(s_html, 'html.parser')
    batch_links = []
    seen_b = set()
    for a in soup.find_all('a', href=True):
        h = a['href'].strip()
        txt = a.get_text(strip=True)
        if ('asyaanimeleri.top/' in h or 'asyaanimeleri.com/' in h) and '/series/' not in h and ('bolum' in h or 'izle' in h or 'movie' in h or 'full' in h):
            if h not in seen_b:
                seen_b.add(h)
                s_num, start_ep, end_ep = parse_episode_range(h, txt)
                # Also check if URL has range while text had larger range or vice versa
                m_txt_r = re.search(r'(\d{1,3})\s*[-–]\s*(\d{1,3})\s*\.?\s*b[öo]l[üu]m', txt, re.I)
                if m_txt_r:
                    t_s, t_e = int(m_txt_r.group(1)), int(m_txt_r.group(2))
                    if 1 <= t_s < t_e <= 1000:
                        start_ep, end_ep = t_s, t_e
                batch_links.append((s_num, start_ep, end_ep, h))

    for s_num, start_ep, end_ep, b_url in batch_links:
        # Check if any episode in start_ep..end_ep is in remaining_empty (or if drama has 0 eps)
        matching_eps = [ep_no for ep_no in range(start_ep, end_ep + 1) if (s_num, ep_no) in remaining_empty or (1, ep_no) in remaining_empty]
        if not matching_eps and remaining_empty:
            continue

        if b_url not in html_cache:
            html_cache[b_url] = fetch_html(b_url, referer=series_url, timeout=10)
        b_html = html_cache[b_url]
        if not b_html:
            continue
        streams = extract_streams_from_html(b_html, 'asyaanimeleri')
        if not streams:
            continue

        for ep_no in (matching_eps or range(start_ep, end_ep + 1)):
            ep_id = remaining_empty.get((s_num, ep_no)) or remaining_empty.get((1, ep_no))
            if not ep_id:
                u_ep = b_url if ep_no == start_ep else f"{b_url}#ep-{ep_no}"
                ep_id, created = match_or_create_episode(cur, did, 1, ep_no, f"Bölüm {ep_no}", u_ep)
                if created:
                    episodes_added += 1
            for sname, surl, sprov, ssite in streams:
                if add_source(cur, ep_id, sname, surl, sprov, 'asyaanimeleri'):
                    sources_added += 1
            reconcile_episode(cur, ep_id, is_placeholder=False)
            remaining_empty.pop((s_num, ep_no), None)
            remaining_empty.pop((1, ep_no), None)
        safe_commit(conn)

    return episodes_added, sources_added


def sync_ddizi_target(conn, cur, drama, target_url=None):
    d = dict(drama) if hasattr(drama, 'keys') else drama
    title = d['title']
    episodes_added = 0
    sources_added = 0

    log("DDizi", f'DDizi motoru devrede: "{title}"')
    detail_url = target_url

    # 1. Check existing source_url on drama
    if not detail_url and d.get('source_url') and 'ddizi' in d.get('source_url', ''):
        detail_url = d['source_url']
        log("DDizi", f"Kayıtlı kaynak URL'si kullanılıyor: {detail_url}")

    # 2. Match from cached ddizi_catalog.json
    if not detail_url:
        cat_file = os.path.join(_ROOT, 'scrapers', 'ddizi_catalog.json')
        if os.path.exists(cat_file):
            try:
                with open(cat_file, 'r', encoding='utf-8') as f:
                    cat = json.load(f)
                d_slug = (d.get('slug') or '').lower()
                norm_d_title = norm_title(title)
                for u, t in cat.items():
                    if (d_slug and d_slug in u.lower()) or norm_title(t) == norm_d_title:
                        detail_url = u
                        log("DDizi", f"Katalogdan eşleşti: {detail_url}")
                        break
            except Exception as e:
                log("DDizi", f"Katalog eşleme uyarısı: {e}")

    # 3. Fallback search with strict title verification
    if not detail_url:
        q = urllib.parse.quote(title)
        try:
            s_html = fetch_html(f"https://www.ddizi.tel/arama/?q={q}", referer="https://www.ddizi.tel/")
            if s_html:
                soup = BeautifulSoup(s_html, 'html.parser')
                for a in soup.find_all('a', href=True):
                    h = a['href']
                    txt = a.get_text(strip=True)
                    if '/diziler/' in h and score_drama_match(d, txt, h) >= 0.80:
                        detail_url = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                        log("DDizi", f"Arama sonucu bulundu: {detail_url}")
                        break
        except Exception:
            pass

    if not detail_url:
        log("DDizi", "Uygun DDizi sayfası bulunamadı.")
        return 0, 0

    # 4. If detail_url is an episode link (/izle/), resolve to the official series page (/diziler/)
    if '/izle/' in detail_url:
        log("DDizi", f"Bölüm URL'si tespit edildi, ana dizi sayfası çözümleniyor: {detail_url}")
        ep_raw = fetch_html(detail_url, referer="https://www.ddizi.tel/")
        if ep_raw:
            ep_soup = BeautifulSoup(ep_raw, 'html.parser')
            resolved_series_url = None
            for a in ep_soup.find_all('a', href=True):
                h = a['href']
                t = (a.get_text(strip=True) + ' ' + a.get('title', '')).lower()
                if '/diziler/' in h:
                    if 'dizi sayfasina git' in t or score_drama_match(d, a.get_text(strip=True), h) >= 0.70:
                        resolved_series_url = h if h.startswith('http') else f"https://www.ddizi.tel{h}"
                        break
            if resolved_series_url:
                detail_url = resolved_series_url
                log("DDizi", f"Ana dizi sayfası başarıyla çözümlendi: {detail_url}")
                try:
                    cur.execute("UPDATE dramas SET source_url = ?, updated_at = datetime('now') WHERE id = ?", (detail_url, d['id']))
                    safe_commit(conn)
                except Exception:
                    pass

    detail_html = fetch_html(detail_url, referer="https://www.ddizi.tel/")
    if not detail_html:
        log("DDizi", f"Sayfa yüklenemedi: {detail_url}")
        return 0, 0

    # Dinamik Çoklu Sayfa Taraması (DDizi /sayfa-0, /sayfa-1, /sayfa-2, ... tüm bölümleri keşfeder)
    clean_base = re.sub(r'/sayfa-\d+.*$', '', detail_url.rstrip('/'))
    visited_pages = set()
    to_visit = set([clean_base])

    # Sayfadaki mevcut sayfa numaralarını önceden topla
    found_nums = [int(n) for n in re.findall(r'/sayfa-(\d+)', detail_html)]
    if found_nums:
        max_p = min(max(found_nums), 50)
        for p_i in range(0, max_p + 1):
            to_visit.add(f"{clean_base}/sayfa-{p_i}")

    log("DDizi", f"DDizi çoklu sayfa ve eksik bölüm taraması başlatılıyor...")

    all_episodes = []
    seen_urls = set()

    while to_visit:
        p_url = to_visit.pop()
        if p_url in visited_pages:
            continue
        visited_pages.add(p_url)

        p_html = detail_html if p_url == detail_url else fetch_html(p_url, referer=clean_base)
        if not p_html:
            continue
        p_soup = BeautifulSoup(p_html, 'html.parser')

        # Yeni sayfa bağlantıları varsa kuyruğa ekle
        for a in p_soup.find_all('a', href=True):
            href = a['href']
            if '/diziler/' in href and ('/sayfa-' in href or '/sayfa/' in href):
                m_sub = re.search(r'/sayfa-(\d+)', href)
                if m_sub:
                    sub_p = f"{clean_base}/sayfa-{m_sub.group(1)}"
                    if sub_p not in visited_pages:
                        to_visit.add(sub_p)

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

                season, ep_num = parse_season_and_episode(full_ep, txt)

                clean_name = clean_episode_title(txt or f"Bölüm {ep_num}", season, ep_num)
                all_episodes.append({
                    'season': season,
                    'number': ep_num,
                    'name': clean_name,
                    'url': full_ep
                })

    all_episodes.sort(key=lambda x: (x['season'], x['number']))
    log("DDizi", f"{len(visited_pages)} sayfa tarandı, toplam {len(all_episodes)} adet bölüm tespit edildi.")

    for ep in all_episodes:
        s_num = ep['season']
        e_num = ep['number']
        ep_url = ep['url']
        ep_name = ep.get('name') or f"Bölüm {e_num}"
        ep_id, created = match_or_create_episode(cur, d['id'], s_num, e_num, ep_name, ep_url)
        if created:
            episodes_added += 1

        # Check existing source
        cur.execute("SELECT id FROM episode_sources WHERE episode_id=? LIMIT 1", (ep_id,))
        if cur.fetchone():
            reconcile_episode(cur, ep_id)
            safe_commit(conn)
            continue

        is_ph = False
        try:
            ep_html = fetch_html(ep_url, referer=detail_url)
            if ep_html:
                is_ph = page_is_placeholder(ep_html)
                # 1. Doğrudan YouTube embed / telif / player/youtube.php / og:video
                yt_id = None
                m_yt_php = re.search(r'youtube\.php\?id=([a-zA-Z0-9_\-]+)', ep_html)
                if m_yt_php:
                    yt_id = m_yt_php.group(1)
                if not yt_id:
                    m_og = re.search(r'og:video["\']\s*content=["\']https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_\-]+)', ep_html)
                    if m_og:
                        yt_id = m_og.group(1)
                if not yt_id:
                    yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
                    if yt_match:
                        raw_yt = yt_match.group(1)
                        v_id_m = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
                        if v_id_m:
                            yt_id = v_id_m.group(1)

                if yt_id:
                    embed_url = f"https://www.youtube.com/embed/{yt_id}?autoplay=1&enablejsapi=1"
                    if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                        sources_added += 1
                        safe_commit(conn)
                        log("DDizi", f"S{s_num}E{e_num} -> YouTube HD eklendi.")
                        reconcile_episode(cur, ep_id, is_placeholder=False)
                        safe_commit(conn)
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
                        m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                        if not m3u8_matches:
                            m3u8_matches = re.findall(r'["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                        added_native = False
                        for raw_m in m3u8_matches:
                            clean_m = raw_m.replace('\\/', '/')
                            if clean_m.startswith('http'):
                                if add_source(cur, ep_id, 'DDizi HLS', clean_m, 'hls', 'ddizi'):
                                    sources_added += 1
                                    safe_commit(conn)
                                    log("DDizi", f"S{s_num}E{e_num} -> DDizi HLS eklendi: {clean_m[:60]}")
                                    added_native = True
                                    break
                        if added_native:
                            reconcile_episode(cur, ep_id, is_placeholder=False)
                            safe_commit(conn)
                            continue

                        raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                        for raw_f in raw_files:
                            clean_u = raw_f.replace('\\/', '/')
                            if clean_u.startswith('http') and 'videoplayback' not in clean_u and 'googlevideo' not in clean_u and '.mp4' in clean_u:
                                if add_source(cur, ep_id, 'DDizi HD', clean_u, 'mp4', 'ddizi'):
                                    sources_added += 1
                                    safe_commit(conn)
                                    log("DDizi", f"S{s_num}E{e_num} -> DDizi HD eklendi: {clean_u[:60]}")
                                    added_native = True
                                    break
                        if added_native:
                            reconcile_episode(cur, ep_id, is_placeholder=False)
                            safe_commit(conn)
                            continue

                        yt_thumb = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
                        if yt_thumb:
                            embed_url = f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1"
                            if add_source(cur, ep_id, 'YouTube HD', embed_url, 'youtube', 'ddizi'):
                                sources_added += 1
                                safe_commit(conn)
                                log("DDizi", f"S{s_num}E{e_num} -> YouTube HD eklendi.")
                                reconcile_episode(cur, ep_id, is_placeholder=False)
                                safe_commit(conn)
                                continue
        except Exception as e:
            log("DDizi", f"S{s_num}E{e_num} hata: {e}")

        reconcile_episode(cur, ep_id, is_placeholder=is_ph)
        safe_commit(conn)

    return episodes_added, sources_added


def main():
    from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

    parser = argparse.ArgumentParser(description="KoUp Single Series Target Synchronizer")
    parser.add_argument('--drama-id', type=int, required=True, help="Database drama ID")
    parser.add_argument('--provider', default='auto', choices=['auto', 'dizibox', 'hdfilm', 'dizikorea', 'animecix', 'ddizi', 'asyawatch', 'dizilla', 'dizifon', 'bldrama', 'asyaanimeleri'])
    parser.add_argument('--manual-url', default=None, help="Explicit target series URL")
    args = parser.parse_args()

    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT * FROM dramas WHERE id = ?", (args.drama_id,))
    drama = cur.fetchone()
    if not drama:
        log("ONARIM", f"Drama #{args.drama_id} SQLite yerel veritabanında bulunamadı. Supabase üzerinden kurtarılıyor...")
        try:
            from scrapers.supabase_sync_helper import sb_request
            sb_res = sb_request("GET", f"/rest/v1/media?id=eq.{args.drama_id}&select=*")
            if isinstance(sb_res, list) and sb_res:
                sb_media = sb_res[0]
                cur.execute(
                    """
                    INSERT INTO dramas (
                        id, title, native_title, slug, content_type, country, country_name,
                        release_year, status_broadcast, status_translation, cover_image, backdrop_image,
                        overview, source_url, tmdb_id, imdb_id, anilist_id, anilist_url,
                        episode_count, sources_count, episodes_available, alt_sites, tags, categories,
                        created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                    """,
                    (
                        sb_media.get("id"),
                        sb_media.get("title"),
                        sb_media.get("native_title"),
                        sb_media.get("slug"),
                        sb_media.get("content_type", "dizi"),
                        sb_media.get("country_code", "TR"),
                        sb_media.get("country_name", "Türkiye"),
                        sb_media.get("release_year"),
                        sb_media.get("status_broadcast", "Devam Ediyor"),
                        sb_media.get("status_translation", "Tamamlandı"),
                        sb_media.get("cover_image"),
                        sb_media.get("backdrop_image"),
                        sb_media.get("overview"),
                        sb_media.get("source_url"),
                        sb_media.get("tmdb_id"),
                        sb_media.get("imdb_id"),
                        sb_media.get("anilist_id"),
                        sb_media.get("anilist_url"),
                        sb_media.get("episode_count", 0),
                        sb_media.get("sources_count", 0),
                        sb_media.get("episodes_available", 0),
                        json.dumps(sb_media.get("alt_sites", [])) if sb_media.get("alt_sites") else None,
                        json.dumps(sb_media.get("tags", [])) if sb_media.get("tags") else None,
                        json.dumps(sb_media.get("categories", [])) if sb_media.get("categories") else None,
                    ),
                )
                conn.commit()
                log("ONARIM", f"Drama #{args.drama_id} ('{sb_media.get('title')}') Supabase üzerinden SQLite arşivine başarıyla kaydedildi.")
                cur.execute("SELECT * FROM dramas WHERE id = ?", (args.drama_id,))
                drama = cur.fetchone()
        except Exception as e_sb:
            log("UYARI", f"Supabase fallback kurtarma hatası: {e_sb}")

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
            mu = manual_url.lower()
            if 'dizibox' in mu:
                chosen_provider = 'dizibox'
            elif 'hdfilmcehennemi' in mu or 'hdfilm' in mu:
                chosen_provider = 'hdfilm'
            elif 'dizikorea' in mu:
                chosen_provider = 'dizikorea'
            elif 'animecix' in mu:
                chosen_provider = 'animecix'
            elif 'asyaanimeleri' in mu or 'asyaanim' in mu:
                chosen_provider = 'asyaanimeleri'
            elif 'ddizi' in mu:
                chosen_provider = 'ddizi'
            elif 'asyawatch' in mu:
                chosen_provider = 'asyawatch'
            elif 'dizilla' in mu:
                chosen_provider = 'dizilla'
            elif any(x in mu for x in ('bldrama', 'webdramaturkey')):
                chosen_provider = 'bldrama'
            elif any(x in mu for x in ('dizifon', 'asyadizi', 'asyaluna', 'asyaking')):
                chosen_provider = 'dizifon'

        if chosen_provider == 'auto':
            cur.execute("""
                SELECT DISTINCT es.site, es.provider 
                FROM episode_sources es
                JOIN episodes e ON e.id = es.episode_id
                WHERE e.drama_id = ? AND es.site IS NOT NULL AND es.site != ''
            """, (drama['id'],))
            existing_sites = [r[0].lower() for r in cur.fetchall()]
            src_u = (drama.get('source_url') or '').lower()

            if 'dizibox' in existing_sites or any('dbx' in s for s in existing_sites):
                chosen_provider = 'dizibox'
            elif 'hdfilmcehennemi' in existing_sites or 'hdfilm' in existing_sites:
                chosen_provider = 'hdfilm'
            elif 'dizikorea' in existing_sites:
                chosen_provider = 'dizikorea'
            elif 'asyawatch' in existing_sites:
                chosen_provider = 'asyawatch'
            elif 'dizilla' in existing_sites:
                chosen_provider = 'dizilla'
            elif 'animecix' in existing_sites:
                chosen_provider = 'animecix'
            elif 'bldrama' in existing_sites or 'webdramaturkey' in existing_sites or 'bldrama' in src_u or 'webdramaturkey' in src_u:
                chosen_provider = 'bldrama'
            elif any(x in src_u for x in ('dizifon', 'asyadizi', 'asyaluna', 'asyaking')):
                chosen_provider = 'dizifon'
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
    elif chosen_provider == 'asyaanimeleri':
        total_eps_added, total_srcs_added = sync_asyaanimeleri_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'ddizi':
        total_eps_added, total_srcs_added = sync_ddizi_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'bldrama':
        total_eps_added, total_srcs_added = sync_bldrama_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'asyawatch':
        total_eps_added, total_srcs_added = sync_asyawatch_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'dizilla':
        total_eps_added, total_srcs_added = sync_dizilla_target(conn, cur, drama, manual_url)
    elif chosen_provider == 'dizifon':
        total_eps_added, total_srcs_added = sync_dizifon_target(conn, cur, drama, manual_url)

    # Update sources_count, episode_count, and R2 source bundle
    sync_drama_bundle_and_counts(conn, cur, drama['id'])
    conn.close()

    # Automatically backup updated SQLite database file to Cloudflare R2
    try:
        from scrapers.supabase_sync_helper import backup_db_to_r2
        backup_db_to_r2()
    except Exception as e:
        log("UYARI", f"R2 DB yedekleme uyarısı: {e}")

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
