"""
AnimeLVL Scraper & Synchronizer (https://animelvl.com/)
- Catalog: sitemap.xml & homepage
- Enriches missing anime via TMDB/AniList into SQLite dramas + Supabase public.media
- Extracts direct MP4 streams and alternative video sources
- Syncs weekly anime calendar to calendar_schedules
"""

import sys
import os
import re
import json
import time
from datetime import datetime, timezone
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
from scrapers.supabase_sync_helper import match_or_create_enriched_drama, sb_request, sync_drama_bundle_and_counts

BASE_URL = "https://animelvl.com"
SITE_TAG = "animelvl"


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("ANIMELVL_COOKIE") or os.environ.get("ANIMELVL_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Referer", f"{BASE_URL}/")
    return s


def fetch_with_retry(session, url, retries=3, timeout=12):
    for i in range(retries):
        for candidate_url in [url, url.replace("https://", "http://")]:
            try:
                resp = session.get(candidate_url, timeout=timeout)
                if resp.status_code == 200:
                    return resp.text
                if resp.status_code in (502, 503):
                    time.sleep(1.5 * (i + 1))
            except Exception:
                time.sleep(1.0)
    return None


def get_sitemap_urls(session=None):
    session = session or _get_session()
    urls = []
    xml_text = fetch_with_retry(session, f"{BASE_URL}/sitemap.xml", timeout=15)
    if xml_text:
        try:
            root = ET.fromstring(xml_text)
            for elem in root.iter():
                if elem.tag.endswith("loc") and elem.text:
                    loc = elem.text.strip()
                    if "/anime/" in loc or "/izle/" in loc or "/seri/" in loc:
                        urls.append(loc)
        except Exception:
            urls = re.findall(r"<loc>(https?://[^\s<]+)</loc>", xml_text)
    return urls


def extract_stream_from_episode(session, ep_url):
    html = fetch_with_retry(session, ep_url, timeout=12)
    if not html:
        return []

    sources = []
    # 1. Direct stream API pattern
    stream_matches = re.findall(r'["\'](https?://animelvl\.com/api/stream\.mp4\?url=[^"\']+)["\']', html)
    for sm in stream_matches:
        sources.append(("AnimeLVL (Direct MP4)", sm, "animelvl"))

    # 2. Extract embedded video iframe sources
    for iframe in re.findall(r'<iframe[^\>]+src=["\']([^"\']+)["\']', html):
        if not iframe.startswith("http"):
            iframe = "https:" + iframe if iframe.startswith("//") else f"{BASE_URL}{iframe}"
        u_low = iframe.lower()
        if "sibnet" in u_low or "drive.google" in u_low:
            continue
        if "vidmoly" in u_low:
            sources.append(("Vidmoly", iframe, "vidmoly"))
        elif "filemoon" in u_low or "byse" in u_low:
            sources.append(("Filemoon", iframe, "filemoon"))
        elif "mail.ru" in u_low:
            sources.append(("Mail.ru", iframe, "mailru"))
        elif "ok.ru" in u_low:
            sources.append(("OK.ru", iframe, "okru"))
        elif "vk.com" in u_low:
            sources.append(("VK", iframe, "vk"))
        elif "animelvl" in u_low:
            sources.append(("AnimeLVL Player", iframe, "animelvl"))

    # 3. Direct MP4 / M3U8 links
    for m in re.findall(r'["\'](https?://[^\s"\'\\]+\.(?:m3u8|mp4)[^\s"\'\\]*)["\']', html):
        if "animelvl.com" in m or "stream" in m:
            sources.append(("AnimeLVL Direct", m, "animelvl"))

    return sources


def scrape_anime_page(conn, cur, idx, session, anime_url):
    html = fetch_with_retry(session, anime_url, timeout=12)
    if not html:
        return 0

    soup = BeautifulSoup(html, "html.parser")
    title_elem = soup.find("h1") or soup.find("title")
    if not title_elem:
        return 0
    raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").strip()

    slug = clean_scraped_slug(anime_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

    # Get or create anime in DB
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=raw_title,
        slug_cand=slug,
        content_type="anime",
        country_hint="JP",
        site_tag=SITE_TAG,
        source_url=anime_url,
        year_hint=year,
    )

    if not drama_id:
        return 0

    # Extract episode links
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/izle/" in href or "/bolum/" in href:
            if not href.startswith("http"):
                href = f"{BASE_URL}{href}" if href.startswith("/") else f"{BASE_URL}/{href}"
            if href not in ep_links and href != anime_url:
                ep_links.append((href, a.get_text(strip=True)))

    added_sources_count = 0
    for ep_url, ep_text in ep_links:
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

        ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
        streams = extract_stream_from_episode(session, ep_url)
        for sname, surl, sprovider in streams:
            if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                added_sources_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count


def sync_animelvl_calendar(session=None):
    """Scrapes weekly schedule from https://animelvl.com/takvim and syncs to calendar_schedules."""
    session = session or _get_session()
    html = fetch_with_retry(session, f"{BASE_URL}/takvim", timeout=15)
    if not html:
        return 0

    soup = BeautifulSoup(html, "html.parser")
    days_map = {
        "pazartesi": 1, "salı": 2, "sali": 2, "çarşamba": 3, "carsamba": 3,
        "perşembe": 4, "persembe": 4, "cuma": 5, "cumartesi": 6, "pazar": 7
    }

    synced = 0
    # Search for calendar containers / day columns
    day_blocks = soup.select(".day-block, .takvim-gun, .calendar-day, [data-day]")
    if not day_blocks:
        day_blocks = soup.find_all(["div", "section"], class_=re.compile(r"day|gun|calendar", re.I))

    for block in day_blocks:
        day_title = block.find(["h2", "h3", "h4", "span", "div"], class_=re.compile(r"title|header|gun", re.I))
        if not day_title:
            continue
        day_text = day_title.get_text(strip=True).lower()
        day_num = None
        for dk, dv in days_map.items():
            if dk in day_text:
                day_num = dv
                break
        if not day_num:
            continue

        for item_a in block.find_all("a", href=True):
            item_title = item_a.get_text(strip=True)
            item_href = item_a["href"]
            if not item_title or len(item_title) < 2:
                continue

            slug = clean_scraped_slug(item_href)
            payload = {
                "source_site": SITE_TAG,
                "day_of_week": day_num,
                "date_label": day_text.title(),
                "title": item_title,
                "slug": slug,
                "episode_label": "Yeni Bölüm",
                "category": "Anime",
                "cover_image": "",
                "source_url": item_href if item_href.startswith("http") else f"{BASE_URL}{item_href}",
            }
            # Upsert into calendar_schedules in Supabase
            try:
                sb_request("POST", "/rest/v1/calendar_schedules?on_conflict=source_site,slug,day_of_week", body=payload)
                synced += 1
            except Exception:
                pass
    return synced
