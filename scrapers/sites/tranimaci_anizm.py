"""
TrAnimaci (https://tranimaci.com/) & Anizm (https://anizm.net/) Anime Scraper
- TrAnimaci: Sitemap.xml (1.375+ anime) & TVSeries schema + Next.js episode streams
- Anizm: /bolum/{ep}/cevirmen/{id} -> /bolum/{ep}/video/{id} -> /player/{id} open sources
- Supports optional TRANIMACI_COOKIE / ANIZM_COOKIE from .env
- Excludes dead hosts (Sibnet, Sendvid, Drive stubs)
"""

import sys
import os
import re
import json
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import sqlite3

try:
    from curl_cffi import requests as cfr
except ImportError:
    import requests as cfr

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection
from scrapers.multisite import (
    norm_title,
    build_drama_index,
    find_in_index,
    match_or_create_episode,
    add_source,
    tag_site,
    safe_commit,
    clean_scraped_slug,
    parse_season_and_episode,
)
from scrapers.supabase_sync_helper import match_or_create_enriched_drama, sync_drama_bundle_and_counts

TRANIMACI_BASE = "https://tranimaci.com"
ANIZM_BASE = "https://anizm.net"


def _get_session(site="tranimaci"):
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie_env = f"{site.upper()}_COOKIE"
    clearance_env = f"{site.upper()}_CF_CLEARANCE"
    cookie = os.environ.get(cookie_env) or os.environ.get(clearance_env)
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    base = TRANIMACI_BASE if site == "tranimaci" else ANIZM_BASE
    s.headers.setdefault("Referer", f"{base}/")
    return s


# =========================================================================
# 1. TRANIMACI SCRAPER
# =========================================================================

def get_tranimaci_sitemap_urls(session=None):
    session = session or _get_session("tranimaci")
    try:
        r = session.get(f"{TRANIMACI_BASE}/sitemap.xml", timeout=15)
        if r.status_code == 200:
            return re.findall(r"<loc>(https?://tranimaci\.com/anime/[^<]+)</loc>", r.text)
    except Exception:
        pass
    return []


def _fetch_single_tranimaci_ep(session, ep_url, ep_text):
    """Fetches a single episode page and its stream alternatives completely in memory."""
    streams = []
    has_video = False
    try:
        r_ep = session.get(ep_url, timeout=10)
        if r_ep.status_code == 200:
            # Look for iframes
            iframes = re.findall(r'<iframe[^\>]+src=["\']([^"\']+)["\']', r_ep.text)
            for ifr in iframes:
                if not ifr.startswith("http"):
                    ifr = "https:" + ifr if ifr.startswith("//") else f"{TRANIMACI_BASE}{ifr}"
                u_low = ifr.lower()
                if not any(dh in u_low for dh in ("sibnet", "sendvid", "drive.google")):
                    streams.append(("TRAnimeci Player", ifr, "tranimaci"))

            # Check if episode-data API can be called
            m_aid = re.search(r'"data":\s*\{\s*"id":\s*"([^"]+)"', r_ep.text)
            m_nonce = re.search(r'"sourcesNonce":\s*"([^"]+)"', r_ep.text)
            if m_aid and m_nonce:
                api_url = f"{TRANIMACI_BASE}/api/video/episode-data/{m_aid.group(1)}?n={m_nonce.group(1)}"
                try:
                    r_api = session.get(api_url, headers={"Referer": ep_url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
                    if r_api.status_code == 200:
                        src_data = r_api.json()
                        for vs in src_data.get("videoSources", []):
                            v_url = vs.get("url") or vs.get("src")
                            if v_url and not any(dh in v_url.lower() for dh in ("sibnet", "sendvid")):
                                s_label = vs.get("name") or "Stream"
                                streams.append((f"TRAnimeci {s_label}", v_url, "tranimaci"))
                except Exception:
                    pass

            if "hasVideo" in r_ep.text or "/video/" in ep_url:
                has_video = True
    except Exception:
        pass

    if not streams and (has_video or "/video/" in ep_url):
        streams.append(("TRAnimeci Web Player", ep_url, "tranimaci"))

    return (ep_url, ep_text, streams)


def scrape_tranimaci_anime(conn, cur, idx, session, anime_url):
    try:
        r = session.get(anime_url, timeout=12)
        if r.status_code != 200:
            return 0
    except Exception:
        return 0

    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    raw_title = ""
    for s in re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL):
        if '"TVSeries"' in s:
            try:
                data = json.loads(s)
                raw_title = data.get("name", "")
                break
            except Exception:
                pass

    if not raw_title:
        title_elem = soup.find("h1") or soup.find("title")
        if title_elem:
            raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").strip()

    if not raw_title:
        return 0

    slug = clean_scraped_slug(anime_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

    # Extract episodes
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/video/" in href:
            if not href.startswith("http"):
                href = f"{TRANIMACI_BASE}{href}"
            if href not in [x[0] for x in ep_links]:
                ep_links.append((href, a.get_text(strip=True)))

    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html)
    if chunks:
        full_f = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\')
        for m in re.finditer(r'\{"id":"[^"]+","number":(\d+)[^}]+"slug":"([^"]+)"', full_f):
            num = int(m.group(1))
            ep_slug = m.group(2)
            ep_href = f"{TRANIMACI_BASE}/video/{ep_slug}"
            if ep_href not in [x[0] for x in ep_links]:
                ep_links.append((ep_href, f"{num}. Bölüm"))

    if not ep_links:
        return 0

    # Parallel in-memory HTTP fetching
    resolved_eps = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(_fetch_single_tranimaci_ep, session, ep_u, ep_t): (ep_u, ep_t) for ep_u, ep_t in ep_links}
        for fut in as_completed(futures):
            try:
                resolved_eps.append(fut.result())
            except Exception:
                pass

    # Batch write to SQLite
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=raw_title,
        slug_cand=slug,
        content_type="anime",
        country_hint="JP",
        site_tag="tranimaci",
        source_url=anime_url,
        year_hint=year,
    )
    if not drama_id:
        return 0

    added_sources_count = 0
    for ep_url, ep_text, streams in resolved_eps:
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
        ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
        for sname, surl, sprovider in streams:
            if add_source(cur, ep_id, sname, surl, sprovider, "tranimaci"):
                added_sources_count += 1

    tag_site(cur, drama_id, "tranimaci")
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count


# =========================================================================
# 2. ANIZM SCRAPER
# =========================================================================

def get_anizm_catalog_urls(session=None, max_pages=5):
    session = session or _get_session("anizm")
    urls = []
    seen = set()
    for page in range(1, max_pages + 1):
        page_url = f"{ANIZM_BASE}/" if page == 1 else f"{ANIZM_BASE}/?page={page}"
        try:
            r = session.get(page_url, timeout=12)
            if r.status_code == 200:
                for u in re.findall(r'href=["\'](https?://anizm\.net/[^"\']*-bolum-izle[^"\']*)["\']', r.text):
                    clean_u = u.split("#")[0]
                    if clean_u not in seen:
                        seen.add(clean_u)
                        urls.append(clean_u)
        except Exception:
            continue
    return urls


def _fetch_anizm_video_info(session, ep_url, anizm_ep_id, vid, v_name):
    headers = {"Referer": ep_url, "X-Requested-With": "XMLHttpRequest"}
    vid_url = f"{ANIZM_BASE}/bolum/{anizm_ep_id}/video/{vid}"
    try:
        r_v = session.get(vid_url, headers=headers, timeout=8)
        if r_v.status_code == 200:
            v_info = r_v.json()
            source_url = v_info.get("url")
            source_name = v_info.get("source") or v_name or "Player"
            fansub = v_info.get("translator")

            if source_url:
                try:
                    r_p = session.get(source_url, headers={"Referer": ep_url}, timeout=8)
                    if r_p.status_code == 200:
                        m_ifr = re.search(r'<iframe[^\>]+src=["\']([^"\']+)["\']', r_p.text)
                        final_stream_url = m_ifr.group(1) if m_ifr else source_url
                        if not final_stream_url.startswith("http"):
                            final_stream_url = f"{ANIZM_BASE}{final_stream_url}"

                        provider = "anizm"
                        if "ok.ru" in final_stream_url.lower() or "odnoklassniki" in source_name.lower():
                            provider = "okru"
                        elif "vk.com" in final_stream_url.lower():
                            provider = "vk"

                        return (f"Anizm {source_name}", final_stream_url, provider, fansub)
                except Exception:
                    return (f"Anizm {source_name}", source_url, "anizm", fansub)
    except Exception:
        pass
    return None


def scrape_anizm_episode(conn, cur, idx, session, ep_url):
    try:
        r = session.get(ep_url, timeout=12)
        if r.status_code != 200:
            return 0
    except Exception:
        return 0

    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    title_elem = soup.find("h1") or soup.find("title")
    if not title_elem:
        return 0
    raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").strip()

    clean_series_title = re.sub(r"\s*\d+\.\s*Bölüm.*$", "", raw_title, flags=re.I).strip()
    slug = clean_scraped_slug(clean_series_title)

    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

    season, number = parse_season_and_episode(ep_url, raw_title)
    ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

    # Parallel fetch of translator video endpoints
    trans_endpoints = re.findall(r"/bolum/(\d+)/cevirmen/(\d+)", html)
    headers = {"Referer": ep_url, "X-Requested-With": "XMLHttpRequest"}

    # 1. Fetch translators to collect videos
    videos_to_fetch = []
    seen_videos = set()

    def fetch_trans(anizm_ep_id, trans_id):
        trans_url = f"{ANIZM_BASE}/bolum/{anizm_ep_id}/cevirmen/{trans_id}"
        try:
            r_t = session.get(trans_url, headers=headers, timeout=8)
            if r_t.status_code == 200:
                t_data = r_t.json()
                return anizm_ep_id, t_data.get("videos") or []
        except Exception:
            pass
        return anizm_ep_id, []

    with ThreadPoolExecutor(max_workers=12) as executor:
        t_futs = [executor.submit(fetch_trans, ep_id_str, tr_id_str) for ep_id_str, tr_id_str in trans_endpoints]
        for fut in as_completed(t_futs):
            try:
                anizm_ep_id, vids = fut.result()
                for v in vids:
                    vid = v.get("id")
                    if vid and vid not in seen_videos:
                        seen_videos.add(vid)
                        videos_to_fetch.append((anizm_ep_id, vid, v.get("name") or "Player"))
            except Exception:
                pass

    # 2. Fetch all video stream sources concurrently
    sources_collected = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        v_futs = [executor.submit(_fetch_anizm_video_info, session, ep_url, a_id, vid, v_name) for a_id, vid, v_name in videos_to_fetch]
        for fut in as_completed(v_futs):
            try:
                res = fut.result()
                if res:
                    sources_collected.append(res)
            except Exception:
                pass

    # 3. Batch write to SQLite
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=clean_series_title,
        slug_cand=slug,
        content_type="anime",
        country_hint="JP",
        site_tag="anizm",
        source_url=ep_url,
        year_hint=year,
    )
    if not drama_id:
        return 0

    ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
    added_count = 0
    for sname, surl, sprovider, fansub in sources_collected:
        if add_source(cur, ep_id, sname, surl, sprovider, "anizm", fansub=fansub):
            added_count += 1

    tag_site(cur, drama_id, "anizm")
    safe_commit(conn)
    if added_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_count
