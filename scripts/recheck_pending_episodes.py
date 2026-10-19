#!/usr/bin/env python3
"""
Pending Episodes Rechecker & Cross-Site Source Resolver for KoUp.

Scans episodes tagged as 'pending' (episodes that exist on a site but didn't have
playable sources yet, or whose original domain is dead like webdramaturkey2.com, asyadizi.com),
re-fetches direct sources where available, and performs cross-site search across live
supported streaming sites (DiziKorea, DiziFon, AsyaWatch, Dizilla, DiziBox, DDizi).
Inserts standalone direct playable video sources (Vidmoly, PlayerDKorea, OK.ru, Pichive, etc. -
NEVER using the source site as a streaming proxy/bridge so our custom player plays directly),
clears the pending tag, updates Cloudflare R2 bundles, syncs to Supabase, checkpoints SQLite,
and performs R2 database backups.

CLI Flags:
  --limit INT         Maximum pending episodes to re-check directly (default: 50)
  --drama-id INT      Re-check only episodes of a specific drama
  --dry-run           Preview check without writing changes to DB, R2, or Supabase
  --max-attempts INT  Skip episodes that have reached max re-check attempts (default: 60)
  --force             Bypass time backoff and check immediately
  --site STR          Filter direct checks by site/domain (e.g. dizikorea, dizifon, asyawatch)
  --cross-site        Enable cross-site search for pending dramas (default: True)
  --batch-dramas INT  Maximum pending dramas to resolve via cross-site search (default: 20)
  --workers INT       Number of concurrent worker threads (default: 8)
"""

import sys
import os
import re
import json
import base64
import time
import argparse
import urllib.parse
import concurrent.futures
from datetime import datetime
import sqlite3
from bs4 import BeautifulSoup

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection, DB_PATH
from scrapers.multisite import add_source, safe_commit, norm_title, clean_scraped_slug
from scrapers.pending_sources import (
    ensure_pending_columns,
    page_is_placeholder,
    reconcile_episode,
    list_pending,
    clear_pending,
)
from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)
from scrapers.sync_hdfilm_target import resolve_hdfilm_streams
from scrapers.sync_target_drama import fetch_html

try:
    from curl_cffi import requests as cfr
    _HTTP_CLIENT = cfr.Session(impersonate="chrome")
except Exception:
    import requests as _req
    _HTTP_CLIENT = _req.Session()


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)


_ASYAWATCH_BUILD_ID = None

def get_asyawatch_build_id() -> str:
    """Dynamically fetches AsyaWatch buildId with cached fallback."""
    global _ASYAWATCH_BUILD_ID
    if _ASYAWATCH_BUILD_ID:
        return _ASYAWATCH_BUILD_ID
    try:
        r = _HTTP_CLIENT.get("https://asyawatch.com/", headers={"User-Agent": "Mozilla/5.0"}, timeout=6)
        m = re.search(r'"buildId":"([^"]+)"', r.text)
        if m:
            _ASYAWATCH_BUILD_ID = m.group(1)
            return _ASYAWATCH_BUILD_ID
    except Exception:
        pass
    return "roDxiuBEE4QePAtjVppYK"


def ensure_database_ready():
    """Ensures webdrama_archive.db exists and has content, downloading from R2 if needed."""
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path) or os.path.getsize(db_path) < 10_000_000:
        log("BAŞLATMA", "webdrama_archive.db yerelde bulunamadı veya geçersiz. Cloudflare R2'den indiriliyor...")
        try:
            from scrapers.supabase_sync_helper import download_db_from_r2
            ok = download_db_from_r2(db_path)
            if ok:
                log("BAŞLATMA", f"webdrama_archive.db Cloudflare R2'den başarıyla çekildi ({os.path.getsize(db_path):,} bayt).")
            else:
                log("UYARI", "webdrama_archive.db Cloudflare R2'den çekilemedi.")
        except Exception as e:
            log("UYARI", f"R2 veritabanı indirme hatası: {e}")


def fetch_page_html(url: str, referer: str = None, timeout: int = 12) -> str:
    """Fetches HTML with Chrome TLS impersonation and verify=False fallback."""
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"}
    if referer:
        h["Referer"] = referer
    try:
        r = _HTTP_CLIENT.get(url, headers=h, timeout=timeout, verify=False)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return fetch_html(url, referer=referer, timeout=timeout)


def extract_streams_from_html(html: str, site_label: str = "general") -> list:
    """
    Extracts standalone playable direct sources from raw HTML without any site proxies.
    Returns list of (source_name, direct_url, provider, site, fansub).
    """
    if not html:
        return []
    sources = []
    seen = set()

    # 1. OK.ru / Odnoklassniki
    for ok_id in set(re.findall(r'(?:https?:)?//(?:www\.)?(?:ok\.ru|odnoklassniki\.ru)/videoembed/(\d+)', html)):
        u = f"https://www.ok.ru/videoembed/{ok_id}"
        if u not in seen:
            seen.add(u)
            sources.append(("OK.ru HD", u, "ok.ru", site_label, None))

    # 2. Vidmoly
    for vm_id in set(re.findall(r'https?://(?:www\.)?vidmoly\.[a-z]+/(?:embed-|w/)([a-zA-Z0-9]+)(?:\.html)?', html)):
        u = f"https://vidmoly.biz/embed-{vm_id}.html"
        if u not in seen:
            seen.add(u)
            sources.append(("Vidmoly 1080p", u, "vidmoly", site_label, None))

    # 3. PlayerDKorea
    for dk_id in set(re.findall(r'https?://(?:www\.)?playerdkorea\.xyz/video/([a-zA-Z0-9]+)', html)):
        u = f"https://playerdkorea.xyz/video/{dk_id}"
        if u not in seen:
            seen.add(u)
            sources.append(("DiziKorea 1080p HLS", u, "dizikorea", site_label, None))

    # 4. Pichive (AsyaWatch 1080p standalone player)
    for p_id in set(re.findall(r'https?://[a-zA-Z0-9_\-\.]*pichive\.[a-z]+/iframe\.php\?v=([a-zA-Z0-9]+)', html)):
        u = f"https://four.pichive.online/iframe.php?v={p_id}"
        if u not in seen:
            seen.add(u)
            sources.append(("AsyaWatch (1080p)", u, "asyawatch", site_label, None))

    # 5. YouTube
    for yt_id in set(re.findall(r'https?://(?:www\.)?youtube\.com/embed/([a-zA-Z0-9_\-]+)', html)):
        u = f"https://www.youtube.com/embed/{yt_id}?autoplay=1&enablejsapi=1"
        if u not in seen:
            seen.add(u)
            sources.append(("YouTube HD", u, "youtube", site_label, None))

    # 6. DBX Sheila / MolyStream
    for sh_id in set(re.findall(r'https?://(?:dbx\.)?molystream\.org/embed/sheila/([a-zA-Z0-9_-]+)', html)):
        u = f"https://dbx.molystream.org/embed/sheila/{sh_id}"
        if u not in seen:
            seen.add(u)
            sources.append(("DBX Pro 1080p", u, "dbx", site_label, None))

    # 7. Parse iframe tags for vdo-src, src, data-src
    try:
        soup = BeautifulSoup(html, "html.parser")
        for f in soup.find_all("iframe"):
            for attr in ["vdo-src", "src", "data-src"]:
                val = f.get(attr)
                if not val or not isinstance(val, str):
                    continue
                if val.startswith("//"):
                    val = "https:" + val
                val_clean = val.split("?")[0] if "?" in val and "youtube" not in val and "list=" not in val else val

                if ("ok.ru/videoembed" in val or "odnoklassniki.ru/videoembed" in val) and val not in seen:
                    m_ok = re.search(r'/videoembed/(\d+)', val)
                    u = f"https://www.ok.ru/videoembed/{m_ok.group(1)}" if m_ok else val
                    if u not in seen:
                        seen.add(u)
                        sources.append(("OK.ru HD", u, "ok.ru", site_label, None))
                elif "vidmoly" in val and val not in seen:
                    m_vm = re.search(r'/(?:embed-|w/)([a-zA-Z0-9]+)', val)
                    u = f"https://vidmoly.biz/embed-{m_vm.group(1)}.html" if m_vm else val
                    if u not in seen:
                        seen.add(u)
                        sources.append(("Vidmoly 1080p", u, "vidmoly", site_label, None))
                elif "pichive" in val and val not in seen:
                    m_p = re.search(r'iframe\.php\?v=([a-zA-Z0-9]+)', val)
                    u = f"https://four.pichive.online/iframe.php?v={m_p.group(1)}" if m_p else val
                    if u not in seen:
                        seen.add(u)
                        sources.append(("AsyaWatch (1080p)", u, "asyawatch", site_label, None))
                elif "dailymotion.com/embed" in val and val not in seen:
                    seen.add(val)
                    sources.append(("Dailymotion", val, "dailymotion", site_label, None))
                elif "vk.com/video_ext.php" in val and val not in seen:
                    seen.add(val)
                    sources.append(("VK Video", val, "vk", site_label, None))
                elif "bulgu.net/ok/e/" in val and val not in seen:
                    seen.add(val)
                    sources.append(("OK.ru HD", val, "ok.ru", site_label, None))
                elif "abstream.to/" in val and val not in seen:
                    seen.add(val)
                    sources.append(("ABStream HD", val, "abstream", site_label, None))
                elif ("playerp2p.online" in val or "upns.online" in val) and val not in seen:
                    seen.add(val)
                    sources.append(("P2P Stream", val, "p2p", site_label, None))
    except Exception:
        pass

    return sources



def extract_sources_for_episode(ep_url: str) -> tuple:
    """
    Reuses existing site-specific extraction logic across all scrapers.
    Returns (sources_list, is_placeholder) where each source is
    (source_name, direct_url, provider, site, fansub).
    """
    if not ep_url or not ep_url.startswith("http"):
        return [], False

    url_low = ep_url.lower()

    # 1. DiziBOX
    if "dizibox.live" in url_low or "/diziler/" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://www.dizibox.live/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            m_sheila = re.search(r"sheila/([a-zA-Z0-9_-]+)", ep_html)
            m_molystream = re.search(r"https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+", ep_html)
            m_king = re.search(r'src=["\'](https://www\.dizibox\.live/player/king/king\.php\?v=[^"\']+)["\']', ep_html)
            if not m_king:
                m_king = re.search(r"king\.php\?post_id=(\d+)", ep_html)

            v_url = None
            if m_sheila:
                v_url = f"https://dbx.molystream.org/embed/sheila/{m_sheila.group(1)}"
            elif m_molystream:
                v_url = m_molystream.group(0)
            elif m_king:
                king_u = (
                    m_king.group(1)
                    if m_king.group(1).startswith("http")
                    else f"https://www.dizibox.live/king.php?post_id={m_king.group(1)}"
                )
                try:
                    king_html = fetch_html(king_u, referer=ep_url, timeout=10)
                    m_moly = re.search(r'src=["\'](https://dbx\.molystream\.org/embed/[^"\']+)["\']', king_html or "")
                    if m_moly:
                        m_id = re.search(r"/embed/([a-zA-Z0-9-]+)", m_moly.group(1))
                        if m_id:
                            v_url = f"https://dbx.molystream.org/embed/sheila/{m_id.group(1)}"
                except Exception:
                    pass

            if v_url:
                return [("DBX Pro 1080p", v_url, "dbx", "dizibox", None)], False
            return [], is_ph
        except Exception:
            return [], False

    # 2. HDFilmcehennemi
    if "hdfilmcehennemi" in url_low:
        try:
            ep_html = fetch_html(ep_url, timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            streams = resolve_hdfilm_streams(ep_url, ep_html)
            out = []
            for sname, surl, sprov, ssite in streams:
                out.append((sname, surl, sprov, ssite, None))
            return out, is_ph
        except Exception:
            return [], False

    # 3. DiziKorea
    if "dizikorea" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://dizikorea3.com/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = extract_streams_from_html(ep_html, site_label="dizikorea")
            return out, is_ph
        except Exception:
            return [], False

    # 3B. AsyaWatch
    if "asyawatch" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://asyawatch.com/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', ep_html)
            out = []
            if m:
                data = json.loads(m.group(1))
                sec = data.get('props', {}).get('pageProps', {}).get('secureData')
                if sec:
                    parsed = json.loads(base64.b64decode(sec).decode('utf-8'))
                    esources = parsed.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                    for s in esources:
                        s_content = s.get('source_content', '')
                        m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                        if m_iframe:
                            embed_u = m_iframe.group(1)
                            if embed_u.startswith('//'):
                                embed_u = 'https:' + embed_u
                            out.append(("AsyaWatch (1080p)", embed_u, "asyawatch", "asyawatch", None))
            if not out:
                out = extract_streams_from_html(ep_html, site_label="asyawatch")
            return out, is_ph
        except Exception:
            return [], False

    # 3C. DiziFon
    if "dizifon" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://www.dizifon.cc/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = extract_streams_from_html(ep_html, site_label="dizifon")
            return out, is_ph
        except Exception:
            return [], False

    # 3D. AsyaAnimeleri
    if "asyaanimeleri" in url_low:
        try:
            ep_html = fetch_page_html(ep_url, referer="https://asyaanimeleri.top/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = extract_streams_from_html(ep_html, site_label="asyaanimeleri")
            return out, is_ph
        except Exception:
            return [], False

    # 3E. WebDramaTurkey
    if "webdramaturkey" in url_low:
        try:
            ep_html = fetch_page_html(ep_url, referer="https://webdramaturkey2.com/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = []
            seen_u = set()
            soup = BeautifulSoup(ep_html, "html.parser")
            embed_ids = [btn.get("data-embed") for btn in soup.find_all(attrs={"data-embed": True}) if btn.get("data-embed")]
            for eid in list(set(embed_ids))[:5]:
                try:
                    r = _HTTP_CLIENT.post(
                        "https://webdramaturkey2.com/ajax/embed",
                        data={"id": eid},
                        headers={"Referer": ep_url, "X-Requested-With": "XMLHttpRequest"},
                        timeout=8,
                        verify=False,
                    )
                    sub_soup = BeautifulSoup(r.text, "html.parser")
                    ifr = sub_soup.find("iframe")
                    if ifr and ifr.get("src"):
                        v_src = ifr["src"]
                        if v_src.startswith("//"):
                            v_src = "https:" + v_src
                        if "video.php" in v_src:
                            vr = _HTTP_CLIENT.get(v_src, headers={"Referer": "https://webdramaturkey2.com/"}, timeout=8, verify=False)
                            for s in extract_streams_from_html(vr.text, site_label="webdramaturkey"):
                                if s[1] not in seen_u:
                                    seen_u.add(s[1])
                                    out.append(s)
                        else:
                            for s in extract_streams_from_html(r.text, site_label="webdramaturkey"):
                                if s[1] not in seen_u:
                                    seen_u.add(s[1])
                                    out.append(s)
                except Exception:
                    pass
            if not out:
                out = extract_streams_from_html(ep_html, site_label="webdramaturkey")
            return out, is_ph
        except Exception:
            return [], False

    # 3F. AsyaDizi
    if "asyadizi" in url_low:
        try:
            ep_html = fetch_page_html(ep_url, referer="https://asyadizi.com/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = extract_streams_from_html(ep_html, site_label="asyadizi")
            return out, is_ph
        except Exception:
            return [], False

    # 3G. AsyaKing
    if "asyaking" in url_low:
        try:
            ep_html = fetch_page_html(ep_url, referer="https://www.asyaking.net/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = extract_streams_from_html(ep_html, site_label="asyaking")
            return out, is_ph
        except Exception:
            return [], False

    # 4. DDizi
    if "ddizi" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://www.ddizi.tel/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = []

            # 1. DDizi Native JWPlayer (En yüksek öncelik: Gerçek HLS veya MP4)
            player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
            if not player_paths:
                player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)

            if player_paths:
                p_path = player_paths[0]
                p_url = p_path if p_path.startswith("http") else f"https://www.ddizi.tel{p_path}"
                p_html = fetch_html(p_url, referer=ep_url, timeout=10)
                if p_html:
                    # HLS (.m3u8) akış kontrolü
                    m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                    for raw_m in m3u8_matches:
                        clean_m = raw_m.replace(r"\/", "/")
                        if clean_m.startswith("http"):
                            out.append(("DDizi HLS", clean_m, "hls", "ddizi", None))
                            return out, False

                    # Kalıcı MP4 akış kontrolü
                    raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                    for raw_f in raw_files:
                        clean_u = raw_f.replace(r"\/", "/")
                        if clean_u.startswith("http") and "videoplayback" not in clean_u and ".mp4" in clean_u:
                            out.append(("DDizi HD", clean_u, "mp4", "ddizi", None))
                            return out, False

                    # Sadece yerel video yoksa YouTube
                    yt_thumb = re.search(r"https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/", p_html)
                    if yt_thumb:
                        out.append(("YouTube HD", f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1", "youtube", "ddizi", None))
                        return out, False

            # 2. DDizi Telif / Harici YouTube kontrolü
            yt_match = re.search(
                r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']',
                ep_html,
            )
            if yt_match:
                v_id_m = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)", yt_match.group(1))
                if v_id_m:
                    out.append(("YouTube HD", f"https://www.youtube.com/embed/{v_id_m.group(1)}?autoplay=1&enablejsapi=1", "youtube", "ddizi", None))
                    return out, False

            return out, is_ph
        except Exception:
            return [], False

    # 5. Generic / fallback extractor
    try:
        ep_html = fetch_html(ep_url, timeout=10)
        if not ep_html:
            return [], False
        is_ph = page_is_placeholder(ep_html)
        out = extract_streams_from_html(ep_html, site_label="other")
        return out, is_ph
    except Exception:
        return [], False


# =========================================================================
# CROSS-SITE RESOLVER ENGINE
# =========================================================================
# =========================================================================
# CROSS-SITE RESOLVER ENGINE
# =========================================================================
def resolve_drama_cross_site(conn, cur, drama_id: int, dry_run: bool = False) -> int:
    """
    Searches for a pending drama across live streaming sites (DiziKorea, DiziFon, AsyaWatch, AnimeciX),
    fetches the matched series page, maps episode numbers, extracts direct playable sources,
    inserts them into SQLite, clears the pending tags, and syncs to R2 and Supabase.
    """
    cur.execute("SELECT id, title, slug, country, content_type FROM dramas WHERE id=?", (drama_id,))
    d_row = cur.fetchone()
    if not d_row:
        return 0
    did, title, slug, country, c_type = d_row

    cur.execute(
        "SELECT id, season_number, episode_number, episode_url FROM episodes WHERE drama_id=? AND source_status='pending'",
        (did,),
    )
    pending_eps = cur.fetchall()
    if not pending_eps:
        return 0

    clean_t = re.sub(r'\(.*?\)|\[.*?\]', '', title).strip()
    clean_t = re.sub(r'\s+', ' ', clean_t).strip()
    nt_target = norm_title(clean_t)
    dk_eps = {}
    df_eps = {}
    aw_eps = {}
    an_eps = {}

    # Check origin domains of pending episodes
    orig_urls = [row[3] or '' for row in pending_eps]
    is_anime = (country == 'JP' or c_type == 'anime' or any('anime' in u.lower() or 'asyaanimeleri' in u.lower() for u in orig_urls))

    # Site 1: AsyaWatch (Next.js secureData 1080p Pichive HLS) via Search API
    try:
        build_id = get_asyawatch_build_id()
        q_enc = urllib.parse.quote(clean_t)
        sr = _HTTP_CLIENT.post(
            f"https://asyawatch.com/api/bg/searchContent?searchterm={q_enc}",
            headers={'Referer': 'https://asyawatch.com/', 'User-Agent': 'Mozilla/5.0'},
            timeout=8,
        )
        if sr.status_code == 200:
            s_raw = sr.json().get('response', '')
            if s_raw:
                s_dec = json.loads(base64.b64decode(s_raw).decode('utf-8'))
                results = s_dec.get('result', [])
                best_slug = None
                for itm in results:
                    obj_name = itm.get('object_name') or ''
                    cand_slug = itm.get('used_slug') or ''
                    cand_nt = norm_title(obj_name)
                    if nt_target in cand_nt or cand_nt in nt_target:
                        best_slug = cand_slug
                        break
                if not best_slug and results:
                    # fallback to first Series match
                    for itm in results:
                        if itm.get('used_type') == 'Series':
                            best_slug = itm.get('used_slug')
                            break
                    if not best_slug:
                        best_slug = results[0].get('used_slug')

                if best_slug:
                    aw_url = f"https://asyawatch.com/_next/data/{build_id}/{best_slug}.json"
                    headers_aw = {'Referer': 'https://asyawatch.com/', 'User-Agent': 'Mozilla/5.0'}
                    r = _HTTP_CLIENT.get(aw_url, headers=headers_aw, timeout=8)
                    if r.status_code == 200:
                        data = r.json()
                        sec = json.loads(base64.b64decode(data['pageProps']['secureData']).decode('utf-8'))
                        season_results = sec.get('RelatedResults', {}).get('getSerieSeasonAndEpisodes', {}).get('result', [])
                        for s in season_results:
                            s_no = s.get('season_no', 1) or 1
                            for ep in s.get('episodes', []):
                                e_no = ep.get('episode_no', 1) or 1
                                ep_slug = ep.get('used_slug', f"{best_slug}/sezon-{s_no}/bolum-{e_no}")
                                aw_eps[(s_no, e_no)] = ep_slug
    except Exception:
        pass

    # Site 2: DiziKorea (Massive Asian drama library)
    try:
        q_url = f"https://dizikorea3.com/?s={urllib.parse.quote(clean_t)}"
        r = _HTTP_CLIENT.get(q_url, headers={'Referer': 'https://dizikorea3.com/'}, timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            grid = soup.find("div", class_="content-grid")
            target_dk = None
            if grid:
                for a in grid.find_all("a", href=True):
                    h = a["href"]
                    if "/dizi/" in h:
                        cand_nt = norm_title(a.get_text(strip=True))
                        if nt_target in cand_nt or cand_nt in nt_target:
                            target_dk = h
                            break
            if target_dk:
                dr = _HTTP_CLIENT.get(target_dk, headers={'Referer': 'https://dizikorea3.com/'}, timeout=8)
                if dr.status_code == 200:
                    dsoup = BeautifulSoup(dr.text, "html.parser")
                    for a in dsoup.find_all("a", href=True):
                        h = a["href"]
                        m = re.search(r'sezon-(\d+)/bolum-(\d+)', h)
                        if m:
                            dk_eps[(int(m.group(1)), int(m.group(2)))] = h
    except Exception:
        pass

    # Site 3: DiziFon (3500+ Asian, Korean, Chinese & Indian dramas)
    try:
        q_url = f"https://www.dizifon.cc/?s={urllib.parse.quote(clean_t)}"
        r = _HTTP_CLIENT.get(q_url, headers={'Referer': 'https://www.dizifon.cc/'}, timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            target_df = None
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if "/dizi/" in h:
                    cand_nt = norm_title(a.get_text(strip=True))
                    if cand_nt and (nt_target in cand_nt or cand_nt in nt_target):
                        target_df = h
                        break
            if not target_df:
                for a in soup.find_all("a", href=True):
                    if "/dizi/" in a["href"] and a.get_text(strip=True):
                        target_df = a["href"]
                        break
            if target_df:
                dr = _HTTP_CLIENT.get(target_df, headers={'Referer': 'https://www.dizifon.cc/'}, timeout=8)
                if dr.status_code == 200:
                    dsoup = BeautifulSoup(dr.text, "html.parser")
                    for a in dsoup.find_all("a", href=True):
                        h = a["href"]
                        if "/bolum/" in h:
                            ms = re.search(r'(\d+)-sezon', h)
                            me = re.search(r'(\d+)-bolum', h)
                            s_num = int(ms.group(1)) if ms else 1
                            e_num = int(me.group(1)) if me else 1
                            df_eps[(s_num, e_num)] = h
    except Exception:
        pass

    # Site 4: AnimeciX (for Anime titles)
    if is_anime:
        try:
            from scrapers.live_scanner import fetch_animecix_json, clean_animecix_provider
            qs = f"query={urllib.parse.quote(clean_t)}&onlyStreamable=true&page=1&perPage=5"
            a_data = fetch_animecix_json("titles", qs)
            if a_data and 'pagination' in a_data:
                for t_item in a_data['pagination'].get('data', []):
                    title_id = t_item.get('id')
                    cand_nt = norm_title(t_item.get('name') or '')
                    if nt_target in cand_nt or cand_nt in nt_target:
                        v_qs = f"titleId={title_id}&page=1&perPage=100"
                        v_data = fetch_animecix_json("videos", v_qs)
                        if v_data and 'pagination' in v_data:
                            for v in v_data['pagination'].get('data', []):
                                v_url = (v.get('url') or '').strip()
                                if not v_url or any(dead in v_url.lower() for dead in ['sibnet', 'short.icu']):
                                    continue
                                s_no = v.get('season_num') or 1
                                e_no = v.get('episode_num') or 1
                                prov = clean_animecix_provider(v.get('name'), v_url)
                                an_eps.setdefault((s_no, e_no), []).append((f"AnimeciX ({prov})", v_url, prov, "animecix", None))
                        break
        except Exception:
            pass

    # Resolve pending episodes
    resolved_count = 0
    for ep_id, s_num, e_num, orig_url in pending_eps:
        key = (s_num or 1, e_num)
        found_sources = []

        # 1. Check AsyaWatch (Pichive 1080p HLS)
        if key in aw_eps:
            try:
                ep_slug = aw_eps[key]
                build_id = get_asyawatch_build_id()
                ep_json_url = f"https://asyawatch.com/_next/data/{build_id}/{ep_slug}.json"
                headers_aw = {'Referer': 'https://asyawatch.com/', 'User-Agent': 'Mozilla/5.0'}
                edata = _HTTP_CLIENT.get(ep_json_url, headers=headers_aw, timeout=8).json()
                esec = json.loads(base64.b64decode(edata['pageProps']['secureData']).decode('utf-8'))
                esources = esec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                for s in esources:
                    s_content = s.get('source_content', '')
                    m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                    if m_iframe:
                        embed_u = m_iframe.group(1)
                        if embed_u.startswith('//'):
                            embed_u = 'https:' + embed_u
                        found_sources.append(("AsyaWatch (1080p)", embed_u, "asyawatch", "asyawatch", None))
            except Exception:
                pass

        # 2. Check DiziKorea (PlayerDKorea, Vidmoly)
        if not found_sources and key in dk_eps:
            try:
                dk_u = dk_eps[key]
                epr = _HTTP_CLIENT.get(dk_u, headers={'Referer': 'https://dizikorea3.com/'}, timeout=8)
                found_sources = extract_streams_from_html(epr.text, site_label="dizikorea")
            except Exception:
                pass

        # 3. Check DiziFon (OK.ru, Vidmoly, VK)
        if not found_sources and key in df_eps:
            try:
                df_u = df_eps[key]
                epr = _HTTP_CLIENT.get(df_u, headers={'Referer': 'https://www.dizifon.cc/'}, timeout=8)
                found_sources = extract_streams_from_html(epr.text, site_label="dizifon")
            except Exception:
                pass

        # 4. Check AnimeciX (Tau-Video, Vidmoly)
        if not found_sources and key in an_eps:
            found_sources = an_eps[key]

        if found_sources:
            resolved_count += 1
            log("ÇÖZÜLDÜ", f'"{title}" S{s_num}B{e_num}: +{len(found_sources)} yeni kaynak bulundu ({found_sources[0][0]})!')
            if not dry_run:
                for sname, surl, sprov, ssite, sfansub in found_sources:
                    add_source(cur, ep_id, sname, surl, sprov, ssite, fansub=sfansub)
                reconcile_episode(cur, ep_id, is_placeholder=False, increment_attempt=True)
                safe_commit(conn)

    if resolved_count > 0 and not dry_run:
        safe_commit(conn)
        sync_drama_bundle_and_counts(conn, cur, did)
        log("SENKRONİZASYON", f'"{title}" {resolved_count} bölümle tamamlandı, R2 ve Supabase güncellendi.')

    return resolved_count



def recheck_pending(
    conn=None,
    cur=None,
    limit: int = 50,
    dry_run: bool = False,
    max_attempts: int = 60,
    drama_id: int = None,
    force: bool = False,
    site: str = None,
    workers: int = 8,
    cross_site: bool = True,
    batch_dramas: int = 25,
) -> dict:
    """
    Main pending re-checker and cross-site resolver logic.
    1. Checks active episode URLs using ThreadPoolExecutor.
    2. Runs Cross-Site Resolver across live streaming sites for dead-domain or missing episodes.
    """
    ensure_database_ready()
    close_conn = False
    if conn is None:
        conn = get_connection()
        close_conn = True
    if cur is None:
        cur = conn.cursor()

    ensure_pending_columns(conn)

    episodes = list_pending(
        conn,
        limit=limit,
        drama_id=drama_id,
        max_attempts=max_attempts,
        apply_backoff=not force,
        domain=site,
    )

    cur.execute(
        "SELECT COUNT(*) FROM episodes WHERE source_status = 'pending' AND COALESCE(source_check_attempts, 0) >= ?",
        (max_attempts,),
    )
    skipped_max = cur.fetchone()[0]

    filter_str = f" [Site/Domain: {site}]" if site else ""
    log("BAŞLATILDI", f"Yeniden kontrol başlatıldı: {len(episodes)} bekleyen bölüm {workers} eşzamanlı iş parçacığıyla taranacak{filter_str} (Max deneme: {max_attempts}, Atlanan: {skipped_max}).")

    checked_count = 0
    resolved_count = 0
    still_pending_count = 0
    touched_dramas = set()
    unresolved_drama_ids = set()

    # Phase 1: Direct extraction for episodes that have URLs
    valid_episodes = []
    dead_domains = ("webdramaturkey", "asyadizi.com", "asyaking", "diziasya.com", "asyaluna.com")
    for ep in episodes:
        u = (ep.get("episode_url") or "").lower()
        if not u or any(d in u for d in dead_domains):
            # Dead or empty domain -> route directly to cross-site search
            unresolved_drama_ids.add(ep["drama_id"])
        else:
            valid_episodes.append(ep)

    if valid_episodes:
        actual_workers = min(workers, max(1, len(valid_episodes)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=actual_workers) as executor:
            future_to_ep = {
                executor.submit(extract_sources_for_episode, ep["episode_url"]): ep
                for ep in valid_episodes
            }

            for future in concurrent.futures.as_completed(future_to_ep):
                ep = future_to_ep[future]
                checked_count += 1
                ep_id = ep["id"]
                d_id = ep["drama_id"]
                d_title = ep.get("drama_title") or f"Yapım #{d_id}"
                s_num = ep.get("season_number") or 1
                e_num = ep.get("episode_number") or 1
                ep_url = ep.get("episode_url")
                attempts = ep.get("source_check_attempts") or 0

                try:
                    sources, is_ph = future.result()
                except Exception:
                    sources, is_ph = [], False

                if sources:
                    resolved_count += 1
                    touched_dramas.add(d_id)
                    log("ÇÖZÜLDÜ", f'"{d_title}" S{s_num}B{e_num} ({ep_url[:55]}...): +{len(sources)} yeni kaynak bulundu!')
                    if not dry_run:
                        for sname, surl, sprov, ssite, sfansub in sources:
                            add_source(cur, ep_id, sname, surl, sprov, ssite, fansub=sfansub)
                        reconcile_episode(cur, ep_id, is_placeholder=False, increment_attempt=True)
                        safe_commit(conn)
                else:
                    unresolved_drama_ids.add(d_id)
                    still_pending_count += 1
                    reason = "yer tutucu algılandı (yakında/hazırlanıyor)" if is_ph else "henüz oynatılabilir kaynak yok"
                    log("BEKLEMEDE", f'"{d_title}" S{s_num}B{e_num} (Deneme {attempts + 1}/{max_attempts}): {reason}.')
                    if not dry_run:
                        reconcile_episode(cur, ep_id, is_placeholder=is_ph, increment_attempt=True)
                        if checked_count % 10 == 0:
                            safe_commit(conn)

    if not dry_run:
        safe_commit(conn)

    # Phase 2: Cross-Site Drama Search & Resolution for unresolved dramas
    if cross_site and unresolved_drama_ids:
        dramas_to_search = list(unresolved_drama_ids)[:batch_dramas]
        log("ÇAPRAZ ARAMA", f"{len(dramas_to_search)} bekleyen dizi için DiziKorea, DiziFon ve AsyaWatch çapraz araması başlatılıyor...")
        cross_resolved = 0
        for did in dramas_to_search:
            try:
                res_cnt = resolve_drama_cross_site(conn, cur, did, dry_run=dry_run)
                if res_cnt > 0:
                    cross_resolved += res_cnt
                    touched_dramas.add(did)
                    resolved_count += res_cnt
                    still_pending_count = max(0, still_pending_count - res_cnt)
            except Exception as e:
                log("UYARI", f"Dizi #{did} çapraz tarama hatası: {e}")

        log("ÇAPRAZ ARAMA", f"Çapraz tarama tamamlandı: +{cross_resolved} yeni bölüm oynatılabilir kaynaklara kavuştu.")

    # Phase 3: Sync R2 & Supabase bundles for any modified dramas
    if touched_dramas and not dry_run:
        log("SENKRONİZASYON", f"{len(touched_dramas)} yapımın R2 ve Supabase bundle güncellemesi yapılıyor...")
        for did in touched_dramas:
            sync_drama_bundle_and_counts(conn, cur, did)

        try:
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            backup_db_to_r2()
            log("YEDEKLEME", "webdrama_archive.db R2 yedeği başarıyla tamamlandı.")
        except Exception as e:
            log("UYARI", f"R2 DB yedek uyarısı: {e}")

    summary = {
        "checked": checked_count,
        "resolved": resolved_count,
        "pending": still_pending_count,
        "skipped": skipped_max,
        "touched_dramas": len(touched_dramas),
        "dry_run": dry_run,
    }

    log(
        "ÖZET",
        f"Kontrol edilen: {checked_count} | Çözülen (Kaynak Eklenen): {resolved_count} | Halen Beklemede: {still_pending_count} | Atlanan (>max): {skipped_max}",
    )

    if close_conn:
        conn.close()

    return summary


def main():
    parser = argparse.ArgumentParser(description="KoUp Pending Episodes Rechecker & Cross-Site Resolver")
    parser.add_argument("--limit", type=int, default=50, help="Maximum pending episodes to check directly (default: 50)")
    parser.add_argument("--drama-id", type=int, default=None, help="Re-check only a specific drama ID")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without writing to DB or syncing to R2/Supabase")
    parser.add_argument("--max-attempts", type=int, default=60, help="Skip episodes exceeding max attempts (default: 60)")
    parser.add_argument("--force", action="store_true", help="Bypass backoff time intervals")
    parser.add_argument("--site", type=str, default=None, help="Filter by site/domain (e.g. dizikorea, dizifon, asyawatch)")
    parser.add_argument("--workers", type=int, default=8, help="Number of concurrent worker threads (default: 8)")
    parser.add_argument("--cross-site", action="store_true", default=True, help="Enable cross-site search on live streaming sites")
    parser.add_argument("--no-cross-site", dest="cross_site", action="store_false", help="Disable cross-site search")
    parser.add_argument("--batch-dramas", type=int, default=25, help="Number of pending dramas to resolve cross-site (default: 25)")
    args = parser.parse_args()

    recheck_pending(
        limit=args.limit,
        dry_run=args.dry_run,
        max_attempts=args.max_attempts,
        drama_id=args.drama_id,
        force=args.force,
        site=args.site,
        workers=args.workers,
        cross_site=args.cross_site,
        batch_dramas=args.batch_dramas,
    )


if __name__ == "__main__":
    main()
