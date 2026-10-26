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


def scrape_tranimaci_anime(conn, cur, idx, session, anime_url):
    try:
        r = session.get(anime_url, timeout=12)
        if r.status_code != 200:
            return 0
    except Exception:
        return 0

    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    # Extract metadata
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

    # Extract episodes from Next.js payload or links
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/video/" in href:
            if not href.startswith("http"):
                href = f"{TRANIMACI_BASE}{href}"
            if href not in ep_links:
                ep_links.append((href, a.get_text(strip=True)))

    # Also parse episodes from Next.js full_f payload
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html)
    if chunks:
        full_f = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\')
        for m in re.finditer(r'\{"id":"[^"]+","number":(\d+)[^}]+"slug":"([^"]+)"', full_f):
            num = int(m.group(1))
            ep_slug = m.group(2)
            ep_href = f"{TRANIMACI_BASE}/video/{ep_slug}"
            if ep_href not in [x[0] for x in ep_links]:
                ep_links.append((ep_href, f"{num}. Bölüm"))

    added_sources_count = 0
    for ep_url, ep_text in ep_links:
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

        # Check episode page
        try:
            r_ep = session.get(ep_url, timeout=10)
            if r_ep.status_code == 200:
                has_added = False
                # Look for iframes
                iframes = re.findall(r'<iframe[^\>]+src=["\']([^"\']+)["\']', r_ep.text)
                for ifr in iframes:
                    if not ifr.startswith("http"):
                        ifr = "https:" + ifr if ifr.startswith("//") else f"{TRANIMACI_BASE}{ifr}"
                    u_low = ifr.lower()
                    if not any(dh in u_low for dh in ("sibnet", "sendvid", "drive.google")):
                        ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
                        if add_source(cur, ep_id, "TRAnimeci Player", ifr, "tranimaci", "tranimaci"):
                            added_sources_count += 1
                            has_added = True

                # Check if episode-data API can be called
                m_aid = re.search(r'"data":\s*\{\s*"id":\s*"([^"]+)"', r_ep.text)
                m_nonce = re.search(r'"sourcesNonce":\s*"([^"]+)"', r_ep.text)
                if m_aid and m_nonce:
                    api_url = f"{TRANIMACI_BASE}/api/video/episode-data/{m_aid.group(1)}?episode={number}&n={m_nonce.group(1)}"
                    r_api = session.get(api_url, headers={"Referer": ep_url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
                    if r_api.status_code == 200:
                        try:
                            src_data = r_api.json()
                            for vs in src_data.get("videoSources", []):
                                v_url = vs.get("url") or vs.get("src")
                                if v_url and not any(dh in v_url.lower() for dh in ("sibnet", "sendvid")):
                                    ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
                                    s_label = vs.get("name") or "TRAnimeci Stream"
                                    if add_source(cur, ep_id, f"TRAnimeci {s_label}", v_url, "tranimaci", "tranimaci"):
                                        added_sources_count += 1
                                        has_added = True
                        except Exception:
                            pass

                # Fallback: If page indicates hasVideo or contentUrl, save episode watch URL as working player
                if not has_added and ("hasVideo" in r_ep.text or "/video/" in ep_url):
                    ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
                    if add_source(cur, ep_id, "TRAnimeci Web Player", ep_url, "tranimaci", "tranimaci"):
                        added_sources_count += 1
        except Exception:
            continue

    tag_site(cur, drama_id, "tranimaci")
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count


# =========================================================================
# 2. ANIZM SCRAPER
# =========================================================================

def get_anizm_catalog_urls(session=None, max_pages=3):
    session = session or _get_session("anizm")
    urls = []
    try:
        r = session.get(f"{ANIZM_BASE}/", timeout=12)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "-bolum-izle" in href or "/anime/" in href:
                    if not href.startswith("http"):
                        href = f"{ANIZM_BASE}{href}"
                    if href not in urls:
                        urls.append(href)
    except Exception:
        pass
    return urls


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

    # Episode page title e.g. "Cyberpunk Edgerunners 2 1. Bölüm İzle"
    clean_series_title = re.sub(r"\s*\d+\.\s*Bölüm.*$", "", raw_title, flags=re.I).strip()
    slug = clean_scraped_slug(clean_series_title)

    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

    season, number = parse_season_and_episode(ep_url, raw_title)
    ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

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

    # Find episode ID and translator endpoints
    # e.g. /bolum/84591/cevirmen/113119
    trans_endpoints = re.findall(r"/bolum/(\d+)/cevirmen/(\d+)", html)
    added_count = 0
    headers = {
        "Referer": ep_url,
        "X-Requested-With": "XMLHttpRequest",
    }

    seen_videos = set()
    for anizm_ep_id, trans_id in trans_endpoints:
        trans_url = f"{ANIZM_BASE}/bolum/{anizm_ep_id}/cevirmen/{trans_id}"
        try:
            r_t = session.get(trans_url, headers=headers, timeout=8)
            if r_t.status_code != 200:
                continue
            t_data = r_t.json()
            videos = t_data.get("videos") or []
            for v in videos:
                vid = v.get("id")
                if not vid or vid in seen_videos:
                    continue
                seen_videos.add(vid)

                vid_url = f"{ANIZM_BASE}/bolum/{anizm_ep_id}/video/{vid}"
                r_v = session.get(vid_url, headers=headers, timeout=8)
                if r_v.status_code == 200:
                    v_info = r_v.json()
                    source_url = v_info.get("url")
                    source_name = v_info.get("source") or v.get("name") or "Player"
                    fansub = v_info.get("translator")

                    if source_url:
                        # Direct player page: https://anizm.net/player/{vid}
                        # Fetch player page to check for open OK.ru / Odnoklassniki or embed
                        try:
                            r_p = session.get(source_url, headers={"Referer": ep_url}, timeout=8)
                            if r_p.status_code == 200:
                                # Check for Odnoklassniki / OK.ru or iframe
                                m_ifr = re.search(r'<iframe[^\>]+src=["\']([^"\']+)["\']', r_p.text)
                                final_stream_url = m_ifr.group(1) if m_ifr else source_url
                                if not final_stream_url.startswith("http"):
                                    final_stream_url = f"{ANIZM_BASE}{final_stream_url}"

                                provider = "anizm"
                                if "ok.ru" in final_stream_url.lower() or "odnoklassniki" in source_name.lower():
                                    provider = "okru"
                                elif "vk.com" in final_stream_url.lower():
                                    provider = "vk"

                                if add_source(cur, ep_id, f"Anizm {source_name}", final_stream_url, provider, "anizm", fansub=fansub):
                                    added_count += 1
                        except Exception:
                            if add_source(cur, ep_id, f"Anizm {source_name}", source_url, "anizm", "anizm", fansub=fansub):
                                added_count += 1
        except Exception:
            continue

    tag_site(cur, drama_id, "anizm")
    safe_commit(conn)
    if added_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_count
