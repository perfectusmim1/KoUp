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

BASE_URL = "https://sezonlukdizi.cc"
SITE_TAG = "sezonlukdizi"


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("SEZONLUKDIZI_COOKIE") or os.environ.get("SEZONLUKDIZI_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Referer", f"{BASE_URL}/")
    return s


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

        for item in items:
            alt_id = item.get("id")
            baslik = (item.get("baslik") or "Player").strip()
            if not alt_id:
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


def scrape_series(conn, cur, idx, session, series_url):
    html = fetch_html(session, series_url, timeout=12)
    if not html:
        return 0

    soup = BeautifulSoup(html, "html.parser")
    title_elem = soup.find("h1") or soup.find("title")
    if not title_elem:
        return 0
    raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").replace("dizisi", "").strip()

    # Extract IMDb ID
    imdb_id = None
    m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html)
    if m_imdb:
        imdb_id = m_imdb.group(1)

    slug = clean_scraped_slug(series_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title) or re.search(r"yillar\.asp\?yil=(\d{4})", html)
    year = int(m_yr.group(1)) if m_yr else None

    # Get or create drama
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
    )

    if not drama_id:
        return 0

    # Extract episode links from series page
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.search(r"/\d+-sezon-\d+-bolum\.html", href) or re.search(r"/bolum/\d+", href):
            if not href.startswith("http"):
                href = f"{BASE_URL}{href}" if href.startswith("/") else f"{BASE_URL}/{href}"
            if href not in ep_links:
                ep_links.append((href, a.get_text(strip=True)))

    added_sources_count = 0
    for ep_url, ep_text in ep_links:
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

        ep_html = fetch_html(session, ep_url, referer=series_url, timeout=10)
        if not ep_html:
            continue

        bid = extract_bid_from_episode(ep_html)
        if not bid:
            continue

        sources = fetch_episode_alternatives(session, bid, ep_url)
        if sources:
            ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
            for sname, surl, sprovider in sources:
                if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                    added_sources_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_sources_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_sources_count
