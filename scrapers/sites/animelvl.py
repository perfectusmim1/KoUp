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
import threading
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

_tls = threading.local()


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("ANIMELVL_COOKIE") or os.environ.get("ANIMELVL_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Referer", f"{BASE_URL}/")
    return s


def _get_tls_session():
    if not hasattr(_tls, "session"):
        _tls.session = _get_session()
    return _tls.session


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


_ANIMES_CACHE = None

def get_animes_catalog(session=None):
    """Fetches full catalog from https://animelvl.com/animes.json (1650+ anime with episodes & streams)."""
    global _ANIMES_CACHE
    if _ANIMES_CACHE is not None:
        return _ANIMES_CACHE
    session = session or _get_session()
    for cand in [f"{BASE_URL}/animes.json", f"{BASE_URL}/data/animes.json"]:
        try:
            r = session.get(cand, timeout=18)
            if r.status_code == 200 and r.text:
                data = r.json()
                if isinstance(data, list) and len(data) > 0:
                    _ANIMES_CACHE = data
                    return _ANIMES_CACHE
        except Exception:
            continue
    return []


def get_sitemap_urls(session=None):
    session = session or _get_session()
    catalog = get_animes_catalog(session)
    if catalog:
        return [f"{BASE_URL}/anime/{a.get('id', '')}-{a.get('slug', '')}" for a in catalog if a.get("slug")]

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


def _detect_provider(url):
    u_low = (url or "").lower()
    if "mail.ru" in u_low:
        return "mailru"
    if "ok.ru" in u_low or "odnoklassniki" in u_low:
        return "okru"
    if "vidmoly" in u_low:
        return "vidmoly"
    if "filemoon" in u_low or "byse" in u_low:
        return "filemoon"
    if "vk.com" in u_low:
        return "vk"
    return "animelvl"


def scrape_anime_item(conn, cur, idx, a_data):
    """Ingests anime directly from animes.json object."""
    if not isinstance(a_data, dict):
        return 0

    raw_title = (a_data.get("title") or a_data.get("t") or "").strip()
    raw_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", raw_title, flags=re.I)
    raw_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", raw_title, flags=re.I).strip()
    raw_title = re.sub(r"[\s\-_–—|•:]+$", "", raw_title).strip()

    slug = a_data.get("slug") or clean_scraped_slug(raw_title)
    if not raw_title or not slug:
        return 0

    episodes = a_data.get("episodes") or []
    # Guard against 0-stream empty shells
    has_any_stream = False
    for ep in episodes:
        if isinstance(ep, dict) and any(ep.get(k) and str(ep.get(k)).startswith("http") for k in ("sub", "embed", "dub")):
            has_any_stream = True
            break
    if not has_any_stream:
        return 0

    a_id = a_data.get("id", "")
    anime_url = f"{BASE_URL}/anime/{a_id}-{slug}" if a_id else f"{BASE_URL}/anime/{slug}"
    year = None
    try:
        if a_data.get("y"):
            year = int(a_data.get("y"))
    except Exception:
        pass

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
    added_sources_count = 0

    for ep in episodes:
        if not isinstance(ep, dict):
            continue
        try:
            number = int(ep.get("n", 1))
        except Exception:
            number = 1
        season = 1
        ep_name = f"Bölüm {number}"
        ep_url = f"{BASE_URL}/izle/{a_id}-{slug}/{number}" if a_id else f"{BASE_URL}/izle/{slug}/{number}"

        ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)

        # Collect streams
        streams = []
        sub = ep.get("sub")
        if sub and isinstance(sub, str) and sub.startswith("http"):
            streams.append(("AnimeLVL Altyazılı", sub, _detect_provider(sub)))

        embed = ep.get("embed")
        if embed and isinstance(embed, str) and embed.startswith("http") and embed != sub:
            streams.append(("AnimeLVL Embed", embed, _detect_provider(embed)))

        dub = ep.get("dub")
        if dub and isinstance(dub, str) and dub.startswith("http"):
            streams.append(("AnimeLVL Dublaj", dub, _detect_provider(dub)))

        for sname, surl, sprovider in streams:
            if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                added_sources_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count


def scrape_anime_page(conn, cur, idx, session, anime_url):
    catalog = get_animes_catalog(session)
    slug_cand = clean_scraped_slug(anime_url)
    m_id = re.search(r"/anime/(\d+)-", anime_url)
    a_id = int(m_id.group(1)) if m_id else None

    # Search in catalog
    for item in catalog:
        if a_id and item.get("id") == a_id:
            return scrape_anime_item(conn, cur, idx, item)
        if slug_cand and item.get("slug") == slug_cand:
            return scrape_anime_item(conn, cur, idx, item)

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

    headers = soup.find_all(["h2", "h3", "h4", "div"], class_=re.compile(r"title|header|gun|day", re.I)) or soup.find_all(["h2", "h3"])
    payloads = []
    seen_keys = set()
    for h in headers:
        day_text = h.get_text(strip=True).lower()
        day_num = None
        for dk, dv in days_map.items():
            if dk in day_text:
                day_num = dv
                break
        if not day_num:
            continue

        nxt = h.find_next_sibling()
        item_links = nxt.find_all("a", href=True) if nxt else []
        if not item_links and h.parent:
            item_links = h.parent.find_all("a", href=True)

        for item_a in item_links:
            item_title = item_a.get_text(strip=True)
            item_href = item_a["href"]
            if not item_title or len(item_title) < 2 or "/anime/" not in item_href:
                continue

            slug = clean_scraped_slug(item_href)
            key = (SITE_TAG, slug, day_num)
            if key in seen_keys:
                continue
            seen_keys.add(key)

            payloads.append({
                "source_site": SITE_TAG,
                "day_of_week": day_num,
                "date_label": day_text.title(),
                "title": item_title,
                "slug": slug,
                "episode_label": "Yeni Bölüm",
                "category": "Anime",
                "cover_image": "",
                "source_url": item_href if item_href.startswith("http") else f"{BASE_URL}{item_href}",
            })

    if payloads:
        try:
            sb_request(
                "POST",
                "/rest/v1/calendar_schedules?on_conflict=source_site,slug,day_of_week",
                body=payloads,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            return len(payloads)
        except Exception:
            pass
    return 0
