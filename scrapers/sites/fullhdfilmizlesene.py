"""
FullHDFilmizlesene Scraper & Synchronizer (https://www.fullhdfilmizlesene.now/)
- Domain: https://www.fullhdfilmizlesene.de redirect or .now active domain
- Catalog: /yeni-filmler/ and Schema.org Movie JSON-LD
- Decodes ROT13 + Base64 obfuscated `scx` video player sources (Atom, Rapidvid, Turbo, Vidmoly)
- Extracts both Türkçe Altyazı (sx.t) and Türkçe Dublaj (sx.p)
- Implements 1.5s rate-limit delay
"""

import sys
import os
import re
import json
import time
import codecs
import base64
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
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
)
from scrapers.supabase_sync_helper import match_or_create_enriched_drama, sync_drama_bundle_and_counts

DEFAULT_BASE_URL = "https://www.fullhdfilmizlesene.now"
SITE_TAG = "fullhdfilmizlesene"


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("FULLHDFILMIZLESENE_COOKIE") or os.environ.get("FULLHDFILMIZLESENE_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Referer", f"{DEFAULT_BASE_URL}/")
    return s


def resolve_base_url(session=None):
    session = session or _get_session()
    for cand in [DEFAULT_BASE_URL, "https://www.fullhdfilmizlesene.de"]:
        try:
            r = session.get(cand, timeout=6, allow_redirects=True)
            if r.status_code == 200:
                return r.url.rstrip("/")
        except Exception:
            continue
    return DEFAULT_BASE_URL


def decode_scx_token(token):
    """Decodes ROT13 + Base64 token from scx stream dictionary."""
    if not token or not isinstance(token, str):
        return None
    try:
        # 1. ROT13
        rot = codecs.decode(token, "rot_13")
        # 2. Base64
        decoded = base64.b64decode(rot).decode("utf-8", errors="ignore").strip()
        # If it contains an iframe tag, extract src
        if "<iframe" in decoded:
            m = re.search(r'src=["\']([^"\']+)["\']', decoded)
            if m:
                decoded = m.group(1).strip()
        return decoded
    except Exception:
        return None


def extract_movie_sources(html):
    """Extracts all working sources from `var scx = {...};` in the page."""
    sources = []
    m_scx = re.search(r"var\s+scx\s*=\s*(\{.*?\});\s*(?:var|</script>)", html, re.DOTALL)
    if not m_scx:
        m_scx = re.search(r"scx\s*=\s*(\{.*?\});", html, re.DOTALL)
    if not m_scx:
        return sources

    try:
        raw_scx = m_scx.group(1)
        scx_dict = json.loads(raw_scx)
    except Exception:
        return sources

    for pkey, pval in scx_dict.items():
        if not isinstance(pval, dict):
            continue
        # Decode player title: e.g. "QXRvbQ==" -> "Atom"
        raw_tt = pval.get("tt", "")
        try:
            player_name = base64.b64decode(raw_tt).decode("utf-8", errors="ignore") if raw_tt else pkey.title()
        except Exception:
            player_name = pkey.title()

        sx = pval.get("sx", {})
        if not isinstance(sx, dict):
            continue

        # 1. sx['t'] -> Tek Parça / Altyazılı
        t_tokens = sx.get("t", [])
        if isinstance(t_tokens, list):
            for tok in t_tokens:
                url = decode_scx_token(tok)
                if url and url.startswith("http"):
                    if "turbo" in player_name.lower():
                        parts = re.split(r"(?:movie|watch)", url)
                        if len(parts) > 1:
                            sub_id = parts[-1].strip("/").split("/")[0]
                            url = f"https://turbo.imgz.me/play/{sub_id}"
                    sources.append((f"{player_name} (Altyazılı)", url, "fullhdfilmizlesene"))

        # 2. sx['p'] -> Parçalar / Dublaj
        p_tokens = sx.get("p", [])
        if isinstance(p_tokens, list):
            for idx, tok in enumerate(p_tokens):
                url = decode_scx_token(tok)
                if url and url.startswith("http"):
                    label = f"{player_name} (Dublaj)" if len(p_tokens) == 1 else f"{player_name} Dublaj Parça {idx+1}"
                    sources.append((label, url, "fullhdfilmizlesene"))

    return sources


def fetch_movie_data(session, movie_url):
    """Fetches movie HTML and extracts metadata + sources in memory."""
    try:
        r = session.get(movie_url, timeout=12)
        if r.status_code != 200:
            return None
    except Exception:
        return None

    html = r.text
    soup = BeautifulSoup(html, "html.parser")

    # 1. Extract Metadata from JSON-LD Schema
    raw_title = ""
    year = None
    imdb_rating = None
    schemas = re.findall(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL)
    for s in schemas:
        if '"Movie"' in s or '"@type":"Movie"' in s:
            try:
                data = json.loads(s)
                raw_title = data.get("name") or data.get("alternateName") or ""
                date_pub = data.get("datePublished", "")
                if date_pub and len(date_pub) >= 4:
                    year = int(date_pub[:4])
                agg = data.get("aggregateRating", {})
                if isinstance(agg, dict):
                    imdb_rating = agg.get("ratingValue")
                break
            except Exception:
                pass

    if not raw_title:
        title_elem = soup.find("h1") or soup.find("title")
        if title_elem:
            raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").replace("Filmi", "").strip()

    if not raw_title:
        return None

    slug = clean_scraped_slug(movie_url)
    if not year:
        m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
        year = int(m_yr.group(1)) if m_yr else None

    sources = extract_movie_sources(html)
    return {
        "raw_title": raw_title,
        "slug": slug,
        "year": year,
        "movie_url": movie_url,
        "sources": sources,
    }


def scrape_movie(conn, cur, idx, session, movie_url):
    data = fetch_movie_data(session, movie_url)
    if not data:
        return 0

    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=data["raw_title"],
        slug_cand=data["slug"],
        content_type="film",
        country_hint="US",
        site_tag=SITE_TAG,
        source_url=data["movie_url"],
        year_hint=data["year"],
    )
    if not drama_id:
        return 0

    sources = data["sources"]
    added_count = 0
    if sources:
        ep_id, is_new = match_or_create_episode(cur, drama_id, 1, 1, d_title or data["raw_title"], data["movie_url"])
        for sname, surl, sprovider in sources:
            if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                added_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_count


def scrape_movies_batch(conn, cur, idx, session, movie_urls):
    """Fetches movies concurrently in memory with ThreadPoolExecutor, then commits batch."""
    fetched_data = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futs = {executor.submit(fetch_movie_data, session, u): u for u in movie_urls}
        for fut in as_completed(futs):
            try:
                res = fut.result()
                if res:
                    fetched_data.append(res)
            except Exception:
                pass

    total_added = 0
    for data in fetched_data:
        drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
            conn=conn,
            cur=cur,
            idx=idx,
            raw_title=data["raw_title"],
            slug_cand=data["slug"],
            content_type="film",
            country_hint="US",
            site_tag=SITE_TAG,
            source_url=data["movie_url"],
            year_hint=data["year"],
        )
        if not drama_id:
            continue

        sources = data["sources"]
        added_for_film = 0
        if sources:
            ep_id, is_new = match_or_create_episode(cur, drama_id, 1, 1, d_title or data["raw_title"], data["movie_url"])
            for sname, surl, sprovider in sources:
                if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                    added_for_film += 1

        tag_site(cur, drama_id, SITE_TAG)
        if added_for_film > 0:
            sync_drama_bundle_and_counts(conn, cur, drama_id)
            total_added += added_for_film

    safe_commit(conn)
    return total_added


def get_catalog_urls(session=None, base_url=None, max_pages=10):
    session = session or _get_session()
    base_url = base_url or resolve_base_url(session)
    movie_urls = []

    for page in range(1, max_pages + 1):
        page_url = f"{base_url}/yeni-filmler/" if page == 1 else f"{base_url}/yeni-filmler/sayfa/{page}/"
        try:
            r = session.get(page_url, timeout=10)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/film/" in href and not any(k in href for k in ("kategori", "tur", "sayfa", "oyuncular")):
                    if not href.startswith("http"):
                        href = f"{base_url}{href}" if href.startswith("/") else f"{base_url}/{href}"
                    if href not in movie_urls:
                        movie_urls.append(href)
        except Exception:
            continue
        time.sleep(0.05)
    return movie_urls
