"""
SezonlukDizi Scraper & Synchronizer (https://sezonlukdizi.cc/)
- Catalog: sitemap/diziler.asp?s=1..12 (~6.000 series) & sitemap/bolumler.asp
- Matches via IMDb ID (tt...) from series page + TMDB enrichment
- Extracts all alternatives for both Altyazı (dil=1) & Dublaj (dil=0) via dataAlternatif22.asp
- Unpacks open player embeds via dataEmbed22.asp (Filemoon/Byse, Vidmoly, VK, OK.ru, Mail.ru)
- Discards captcha stubs (/ajax/reCAPTCHADATA.asp)
"""

import sys
import os
import re
import json
import time
import threading
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

BASE_URL = "https://sezonlukdizi.cc"
SITE_TAG = "sezonlukdizi"

_tls = threading.local()


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("SEZONLUKDIZI_COOKIE") or os.environ.get("SEZONLUKDIZI_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Referer", f"{BASE_URL}/")
    return s


def _get_tls_session():
    if not hasattr(_tls, "session"):
        _tls.session = _get_session()
    return _tls.session


def fetch_html(session, url, referer=None, timeout=12):
    headers = {"Referer": referer or f"{BASE_URL}/"}
    for attempt in range(3):
        try:
            r = session.get(url, headers=headers, timeout=timeout)
            if r.status_code == 200:
                # SezonlukDizi uses windows-1254 in HTML meta, decode properly
                text = r.text
                if "Ã" in text or "Ä" in text:
                    try:
                        text = r.content.decode("windows-1254", errors="ignore")
                    except Exception:
                        pass
                return text
            elif r.status_code in (502, 503):
                time.sleep(1.0 * (attempt + 1))
        except Exception:
            time.sleep(0.8)
    return None


def get_series_sitemap_urls(session=None, max_pages=12):
    session = session or _get_session()
    series_urls = []
    for s_idx in range(1, max_pages + 1):
        sitemap_url = f"{BASE_URL}/sitemap/diziler.asp?s={s_idx}"
        text = fetch_html(session, sitemap_url, timeout=15)
        if not text:
            continue
        locs = re.findall(r"<loc>(https?://sezonlukdizi\.cc/diziler/[^<]+)</loc>", text)
        if not locs:
            locs = re.findall(r"<loc>(https?://[^\s<]+)</loc>", text)
        series_urls.extend(locs)
    return series_urls


def extract_bid_from_episode(html):
    if not html:
        return None
    m = re.search(r'\bvar\s+bid\s*=\s*["\']?(\d+)', html) or \
        re.search(r'\bbid\s*[:=]\s*["\']?(\d+)', html) or \
        re.search(r'data-id=["\'](\d+)', html) or \
        re.search(r'asp\?bid=(\d+)', html)
    return m.group(1) if m else None


def fetch_episode_alternatives(session, bid, ep_url):
    """
    Calls dataAlternatif22.asp for dil=1 (Altyazı) and dil=0 (Dublaj),
    then calls dataEmbed22.asp for each alternative to extract open video embeds.
    """
    working_sources = []
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": ep_url,
    }

    # dil=1: Altyazı, dil=0: Dublaj
    for dil, dil_label in [(1, "Altyazılı"), (0, "Dublaj")]:
        try:
            resp = session.post(
                f"{BASE_URL}/ajax/dataAlternatif22.asp",
                data={"bid": bid, "dil": dil},
                headers=headers,
                timeout=10,
            )
            if resp.status_code != 200 or not resp.text:
                continue
            data_json = resp.json()
            items = data_json.get("data") or []
        except Exception:
            continue

        # Prioritize open embed players (Filemoon, OK, VK, Mail) over captcha-gated Dzen/Pixel
        items.sort(key=lambda x: 0 if any(k in (x.get("baslik") or "").lower() for k in ("filemoon", "ok", "vk", "mail", "rapid")) else 1)

        for item in items:
            alt_id = item.get("id")
            baslik = (item.get("baslik") or "Player").strip()
            if not alt_id:
                continue
            if any(k in baslik.lower() for k in ("dzen", "pixel", "sibnet", "sendvid")):
                continue

            try:
                emb_resp = session.post(
                    f"{BASE_URL}/ajax/dataEmbed22.asp",
                    data={"id": alt_id},
                    headers=headers,
                    timeout=10,
                )
                if emb_resp.status_code != 200 or not emb_resp.text:
                    continue
                emb_html = emb_resp.text

                # Ignore reCAPTCHA stubs
                if "/ajax/reCAPTCHADATA.asp" in emb_html or "reCAPTCHA" in emb_html:
                    continue

                m_iframe = re.search(r'<iframe[^\>]+src=["\']([^"\']+)["\']', emb_html, re.I)
                if not m_iframe:
                    continue

                embed_src = m_iframe.group(1).strip()
                if not embed_src.startswith("http"):
                    embed_src = "https:" + embed_src if embed_src.startswith("//") else f"{BASE_URL}{embed_src}"

                u_low = embed_src.lower()
                # Skip known dead or blocked hosts
                if any(dh in u_low for dh in ("sibnet", "sendvid", "drive.google", "reCAPTCHA")):
                    continue

                provider = "sezonlukdizi"
                if "byse" in u_low or "filemoon" in u_low:
                    provider = "filemoon"
                elif "vidmoly" in u_low:
                    provider = "vidmoly"
                elif "ok.ru" in u_low:
                    provider = "okru"
                elif "vk.com" in u_low:
                    provider = "vk"
                elif "mail.ru" in u_low:
                    provider = "mailru"
                elif "rapid" in u_low:
                    provider = "rapidrame"

                source_name = f"SezonlukDizi {baslik} ({dil_label})"
                working_sources.append((source_name, embed_src, provider))
            except Exception:
                continue

    return working_sources


def fetch_series_memory(series_url):
    """Fetches a series and all its episodes in memory without holding a DB connection. Returns dict or None."""
    sess = _get_tls_session()
    html = fetch_html(sess, series_url, timeout=12)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    title_elem = soup.find("h1") or soup.find("title")
    if not title_elem:
        return None
    raw_title = title_elem.get_text(strip=True)
    raw_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", raw_title, flags=re.I)
    raw_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", raw_title, flags=re.I).strip()
    raw_title = re.sub(r"[\s\-_–—|•:]+$", "", raw_title).strip()

    imdb_id = None
    m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html)
    if m_imdb:
        imdb_id = m_imdb.group(1)

    slug = clean_scraped_slug(series_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title) or re.search(r"yillar\.asp\?yil=(\d{4})", html)
    year = int(m_yr.group(1)) if m_yr else None

    ep_links = []
    seen_ep_hrefs = set()
    pages_to_scan = [soup]
    if "/diziler/" in series_url:
        bolumler_html = fetch_html(sess, series_url.replace("/diziler/", "/bolumler/"), referer=series_url, timeout=12)
        if bolumler_html:
            pages_to_scan.insert(0, BeautifulSoup(bolumler_html, "html.parser"))

    for page_soup in pages_to_scan:
        for a in page_soup.find_all("a", href=True):
            href = a["href"]
            if re.search(r"/\d+-sezon-\d+-bolum\.html", href) or re.search(r"/bolum/\d+", href):
                if not href.startswith("http"):
                    href = f"{BASE_URL}{href}" if href.startswith("/") else f"{BASE_URL}/{href}"
                if href not in seen_ep_hrefs:
                    seen_ep_hrefs.add(href)
                    ep_links.append((href, a.get_text(strip=True)))

    if not ep_links:
        return None

    def _fetch_single_ep(ep_u, ep_t):
        local_sess = _get_tls_session()
        ep_html = fetch_html(local_sess, ep_u, referer=series_url, timeout=10)
        if not ep_html:
            return (ep_u, ep_t, [])
        bid = extract_bid_from_episode(ep_html)
        if not bid:
            return (ep_u, ep_t, [])
        s_list = fetch_episode_alternatives(local_sess, bid, ep_u)
        return (ep_u, ep_t, s_list)

    resolved_episodes = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futs = [executor.submit(_fetch_single_ep, u, t) for u, t in ep_links]
        for fut in as_completed(futs):
            try:
                resolved_episodes.append(fut.result())
            except Exception:
                pass

    if not any(sources for _, _, sources in resolved_episodes if sources):
        return None

    return {
        "url": series_url,
        "title": raw_title,
        "slug": slug,
        "year": year,
        "imdb_id": imdb_id,
        "resolved_episodes": resolved_episodes,
    }


def save_series_batch(conn, cur, idx, batch_series):
    """Saves memory-resolved SezonlukDizi series in a single quick transaction. Returns (total_added, affected_drama_ids)."""
    total_added = 0
    affected_dramas = set()

    for item in batch_series:
        if not item:
            continue
        drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
            conn=conn,
            cur=cur,
            idx=idx,
            raw_title=item["title"],
            slug_cand=item["slug"],
            content_type="dizi",
            country_hint="US",
            site_tag=SITE_TAG,
            source_url=item["url"],
            year_hint=item.get("year"),
            imdb_id=item.get("imdb_id"),
        )
        if not drama_id:
            continue

        added_for_series = 0
        for ep_url, ep_text, sources in item["resolved_episodes"]:
            if not sources:
                continue
            season, number = parse_season_and_episode(ep_url, ep_text)
            ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
            ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
            for sname, surl, sprovider in sources:
                if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                    added_for_series += 1

        tag_site(cur, drama_id, SITE_TAG)
        if added_for_series > 0:
            affected_dramas.add(drama_id)
            total_added += added_for_series

    safe_commit(conn)
    return total_added, affected_dramas


def scrape_series(conn, cur, idx, session, series_url):
    html = fetch_html(session, series_url, timeout=12)
    if not html:
        return 0

    soup = BeautifulSoup(html, "html.parser")
    title_elem = soup.find("h1") or soup.find("title")
    if not title_elem:
        return 0
    raw_title = title_elem.get_text(strip=True)
    raw_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", raw_title, flags=re.I)
    raw_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", raw_title, flags=re.I).strip()
    raw_title = re.sub(r"[\s\-_–—|•:]+$", "", raw_title).strip()

    # Extract IMDb ID
    imdb_id = None
    m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html)
    if m_imdb:
        imdb_id = m_imdb.group(1)

    slug = clean_scraped_slug(series_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title) or re.search(r"yillar\.asp\?yil=(\d{4})", html)
    year = int(m_yr.group(1)) if m_yr else None

    # Extract episode links from series page and /bolumler/ tab
    ep_links = []
    seen_ep_hrefs = set()
    pages_to_scan = [soup]
    if "/diziler/" in series_url:
        bolumler_html = fetch_html(session, series_url.replace("/diziler/", "/bolumler/"), referer=series_url, timeout=12)
        if bolumler_html:
            pages_to_scan.insert(0, BeautifulSoup(bolumler_html, "html.parser"))

    for page_soup in pages_to_scan:
        for a in page_soup.find_all("a", href=True):
            href = a["href"]
            if re.search(r"/\d+-sezon-\d+-bolum\.html", href) or re.search(r"/bolum/\d+", href):
                if not href.startswith("http"):
                    href = f"{BASE_URL}{href}" if href.startswith("/") else f"{BASE_URL}/{href}"
                if href not in seen_ep_hrefs:
                    seen_ep_hrefs.add(href)
                    ep_links.append((href, a.get_text(strip=True)))

    if not ep_links:
        return 0

    # Parallel in-memory episode alternatives fetching (each thread uses isolated session)
    def _fetch_single_ep(ep_u, ep_t):
        local_sess = _get_tls_session()
        ep_html = fetch_html(local_sess, ep_u, referer=series_url, timeout=10)
        if not ep_html:
            return (ep_u, ep_t, [])
        bid = extract_bid_from_episode(ep_html)
        if not bid:
            return (ep_u, ep_t, [])
        s_list = fetch_episode_alternatives(local_sess, bid, ep_u)
        return (ep_u, ep_t, s_list)

    resolved_episodes = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futs = [executor.submit(_fetch_single_ep, u, t) for u, t in ep_links]
        for fut in as_completed(futs):
            try:
                resolved_episodes.append(fut.result())
            except Exception:
                pass

    # Never create empty shells: ensure at least 1 working source exists
    if not any(sources for _, _, sources in resolved_episodes if sources):
        return 0

    # Get or create drama only after confirming working sources
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=raw_title,
        slug_cand=slug,
        content_type="dizi",
        country_hint="US",
        site_tag=SITE_TAG,
        source_url=series_url,
        year_hint=year,
        imdb_id=imdb_id,
    )

    if not drama_id:
        return 0

    # Batch write to SQLite
    added_sources_count = 0
    for ep_url, ep_text, sources in resolved_episodes:
        if not sources:
            continue
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

        ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
        for sname, surl, sprovider in sources:
            if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                added_sources_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count
