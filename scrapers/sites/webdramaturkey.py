"""
WebDramaTurkey2.com Scraper & WDT Stream Resolver.
Features:
- Restricted to ONLY New Series (/diziler) and New Movies (/filmler)
- Adaptive rate-limit defense: 1.2s minimum delay + exponential backoff (4s -> 8s -> 16s)
- WDT (dtpasn.asia) embed resolution via /ajax/embed and live HLS stream verification
- Multi-source fallback (WDT, Vidmoly, Filemoon) and full archive sync
"""

import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

import requests
from bs4 import BeautifulSoup

from scrapers.domain_resolver import get_site_base_url
from scrapers.multisite import (
    add_source,
    build_drama_index,
    clean_episode_title,
    clean_scraped_slug,
    match_or_create_episode,
)
from scrapers.supabase_sync_helper import (
    match_or_create_enriched_drama,
    sync_drama_bundle_and_counts,
)

DEFAULT_BASE_URL = "https://webdramaturkey2.com"
_LAST_REQUEST_TIME = 0.0


def _get_base() -> str:
    return get_site_base_url("webdramaturkey2", DEFAULT_BASE_URL)


def _rate_limited_fetch(
    url: str,
    method: str = "GET",
    data: dict = None,
    headers: dict = None,
    timeout: int = 12,
    max_retries: int = 3,
) -> tuple[int, str]:
    """
    Executes an HTTP request with adaptive rate-limit protection:
    - Guaranteed minimum 1.2s delay between requests
    - Exponential backoff on HTTP 429/503 (4s -> 8s -> 16s)
    """
    global _LAST_REQUEST_TIME

    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    }
    if headers:
        default_headers.update(headers)

    for attempt in range(max_retries):
        elapsed = time.time() - _LAST_REQUEST_TIME
        if elapsed < 1.2:
            time.sleep(1.2 - elapsed)

        _LAST_REQUEST_TIME = time.time()
        resp_status = 0
        resp_text = ""

        if cfr:
            try:
                if method.upper() == "POST":
                    r = cfr.post(url, data=data, headers=default_headers, impersonate="chrome", timeout=timeout)
                else:
                    r = cfr.get(url, headers=default_headers, impersonate="chrome", timeout=timeout)
                resp_status = r.status_code
                resp_text = r.text
            except Exception:
                pass

        if not resp_status:
            try:
                if method.upper() == "POST":
                    r = requests.post(url, data=data, headers=default_headers, timeout=timeout)
                else:
                    r = requests.get(url, headers=default_headers, timeout=timeout)
                resp_status = r.status_code
                resp_text = r.text
            except Exception:
                pass

        if resp_status in (429, 503):
            backoff = 4 * (2 ** attempt)
            print(f"[WDT RATE-LIMIT] HTTP {resp_status} on {url}. Backing off {backoff}s (attempt {attempt+1}/{max_retries})...", flush=True)
            time.sleep(backoff)
            continue

        return resp_status, resp_text

    return resp_status, resp_text


def verify_wdt_stream(hash_code: str, base_url: str = DEFAULT_BASE_URL) -> bool:
    """Verifies that dtpasn.asia stream is active and returns valid HLS videoSource."""
    if not hash_code:
        return False
    api_url = f"https://dtpasn.asia/player/index.php?data={hash_code}&do=getVideo"
    headers = {
        "Referer": f"https://dtpasn.asia/video/{hash_code}",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    data = {"hash": hash_code, "r": f"{base_url}/"}
    status, text = _rate_limited_fetch(api_url, method="POST", data=data, headers=headers, timeout=10)
    if status == 200 and text:
        return '"hls":true' in text or "videoSource" in text or ".m3u8" in text
    return False


def resolve_wdt_embed(
    embed_id: str,
    page_url: str,
    base_url: str = DEFAULT_BASE_URL,
) -> tuple[str, str, str] | None:
    """
    Resolves a data-embed ID via /ajax/embed and parses the embedded player iframe.
    Returns (source_name, direct_url, provider) or None if unusable.
    """
    ajax_url = f"{base_url}/ajax/embed"
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": page_url,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    status, text = _rate_limited_fetch(ajax_url, method="POST", data={"id": embed_id}, headers=headers, timeout=10)
    if status != 200 or not text:
        return None

    video_url = None
    # 1. Parse video.php?hash=
    hash_m = re.search(r'video\.php\?hash=([a-zA-Z0-9_\-]+)', text)
    if hash_m:
        video_url = f"{base_url}/video.php?hash={hash_m.group(1)}"
    else:
        src_m = re.search(r'src=["\']([^"\']+)["\']', text)
        if src_m:
            src = src_m.group(1)
            video_url = urljoin(base_url, src)

    if not video_url:
        return None

    # Fetch intermediate video.php page to inspect actual iframe src
    v_status, v_text = _rate_limited_fetch(video_url, headers={"Referer": page_url}, timeout=10)
    if v_status != 200 or not v_text:
        return None

    soup = BeautifulSoup(v_text, "html.parser")
    iframe = soup.select_one("iframe#main-iframe, iframe")
    iframe_src = iframe.get("src", "") if iframe else ""
    if not iframe_src:
        m_if = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', v_text)
        if m_if:
            iframe_src = m_if.group(1)

    if not iframe_src:
        return None

    iframe_src = urljoin(base_url, iframe_src)
    src_low = iframe_src.lower()

    # 1. WDT (dtpasn.asia)
    if "dtpasn.asia/video/" in src_low:
        dt_hash = iframe_src.split("/video/")[-1].split("?")[0].split("#")[0].strip()
        if verify_wdt_stream(dt_hash, base_url):
            return "WDT (Full HD)", f"https://dtpasn.asia/video/{dt_hash}#r=wdt", "wdt"
        return None

    # 2. Vidmoly
    if "vidmoly" in src_low:
        if not any(bad in src_low for bad in ("vidmoly.me", "dead")):
            return "Vidmoly HD", iframe_src, "vidmoly"

    # 3. Filemoon
    if "filemoon" in src_low:
        return "Filemoon HD", iframe_src, "filemoon"

    # 4. Filter out dead / forbidden providers (sibnet, etc.)
    if any(dead in src_low for dead in ("sibnet", "sendvid", "uns.bio", "playerdkorea", "upns")):
        return None

    # 5. Generic valid player
    if iframe_src.startswith("http"):
        p_name = urlparse(iframe_src).netloc.replace("www.", "").split(".")[0].title()
        return f"{p_name} HD", iframe_src, p_name.lower()

    return None


def scrape_wdt_series_or_film(
    cur,
    conn,
    item_url: str,
    idx: dict = None,
    is_film: bool = False,
    max_episodes: int = 30,
) -> dict:
    """
    Scrapes a single drama or movie from webdramaturkey2.com:
    - Parses Schema.org / metadata
    - Enriches via TMDB
    - Discovers episodes and resolves WDT/Vidmoly/Filemoon sources
    - Updates bundles and database
    """
    base_url = _get_base()
    full_url = urljoin(base_url, item_url)
    status, html = _rate_limited_fetch(full_url)
    if status != 200 or not html:
        return {"error": f"Failed to fetch {full_url}", "episodes_added": 0, "sources_added": 0}

    soup = BeautifulSoup(html, "html.parser")

    # 1. Title, Overview, Poster
    title = ""
    h1 = soup.select_one("h1")
    if h1:
        title = h1.get_text(strip=True)
    if not title and soup.title:
        title = soup.title.get_text(strip=True).split("-")[0].strip()

    title = re.sub(r"\s*(izle|türkçe altyazılı|hd izle|dizisi|filmi).*$", "", title, flags=re.I).strip()

    m_slug = re.search(r"/(?:dizi|film)/([^/]+)", full_url)
    slug = m_slug.group(1) if m_slug else full_url.strip("/").split("/")[-1]
    slug = clean_scraped_slug(slug)

    content_type = "film" if (is_film or "/film/" in full_url) else "dizi"

    year = None
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", html[:2000])
    if m_yr:
        try:
            year = int(m_yr.group(1))
        except Exception:
            pass

    if idx is None:
        idx = build_drama_index(cur)

    # 2. Match or create enriched drama in SQLite and Supabase
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=title,
        slug_cand=slug,
        content_type=content_type,
        country_hint="KR",
        site_tag="webdramaturkey2",
        source_url=full_url,
        year_hint=year,
    )

    episodes_added = 0
    sources_added = 0
    sample_sources = []

    if content_type == "film":
        # Movies have only 1 episode (Season 1 Episode 1)
        ep_id, is_new = match_or_create_episode(cur, drama_id, 1, 1, f"{d_title} (Film)", full_url)
        if is_new:
            episodes_added += 1

        # Check existing WDT sources
        cur.execute(
            "SELECT id FROM episode_sources WHERE episode_id = ? AND (provider = 'wdt' OR direct_url LIKE '%dtpasn%')",
            (ep_id,),
        )
        if not cur.fetchone():
            embed_btns = soup.select("a[data-embed]")
            for btn in embed_btns:
                eid = btn.get("data-embed")
                resolved = resolve_wdt_embed(eid, full_url, base_url)
                if resolved:
                    s_name, s_url, s_prov = resolved
                    if add_source(cur, ep_id, s_name, s_url, s_prov, "webdramaturkey2", embed_id=eid):
                        sources_added += 1
                        sample_sources.append(s_url)
    else:
        # Series: discover episode links
        ep_links = []
        for a in soup.find_all("a", href=True):
            h = a["href"]
            if ("/sezon/" in h or "-sezon-" in h) and ("/bolum" in h or "-bolum" in h):
                full_h = urljoin(base_url, h)
                if full_h not in ep_links and full_h != full_url:
                    ep_links.append(full_h)

        if not ep_links:
            # Fallback for alternative URL schemes
            for a in soup.select(".episodes a, .seasons a, a[href*='bolum']"):
                h = a.get("href")
                if h:
                    full_h = urljoin(base_url, h)
                    if full_h not in ep_links and full_h != full_url:
                        ep_links.append(full_h)

        def _wdt_ep_sort(u):
            sm = re.search(r"(\d+)[-_]sezon", u)
            em = re.search(r"(\d+)[-_]bolum", u)
            return (int(sm.group(1)) if sm else 1, int(em.group(1)) if em else 1)

        ep_links.sort(key=_wdt_ep_sort)
        if max_episodes and len(ep_links) > max_episodes:
            ep_links = ep_links[-max_episodes:]

        for ep_url in ep_links:
            sm = re.search(r"(\d+)[-_]sezon", ep_url)
            em = re.search(r"(\d+)[-_]bolum", ep_url)
            s_num = int(sm.group(1)) if sm else 1
            e_num = int(em.group(1)) if em else 1

            ep_name = f"{s_num}. Sezon {e_num}. Bölüm"
            ep_id, is_new = match_or_create_episode(cur, drama_id, s_num, e_num, ep_name, ep_url)
            if is_new:
                episodes_added += 1

            # Check if WDT source already exists
            cur.execute(
                "SELECT id FROM episode_sources WHERE episode_id = ? AND (provider = 'wdt' OR direct_url LIKE '%dtpasn%')",
                (ep_id,),
            )
            if cur.fetchone():
                continue

            # Fetch episode page to get data-embed buttons
            ep_status, ep_html = _rate_limited_fetch(ep_url)
            if ep_status != 200 or not ep_html:
                continue

            ep_soup = BeautifulSoup(ep_html, "html.parser")
            embed_btns = ep_soup.select("a[data-embed]")
            for btn in embed_btns:
                eid = btn.get("data-embed")
                resolved = resolve_wdt_embed(eid, ep_url, base_url)
                if resolved:
                    s_name, s_url, s_prov = resolved
                    if add_source(cur, ep_id, s_name, s_url, s_prov, "webdramaturkey2", embed_id=eid):
                        sources_added += 1
                        sample_sources.append(s_url)

    if episodes_added > 0 or sources_added > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)

    return {
        "drama_id": drama_id,
        "title": d_title,
        "slug": d_slug,
        "content_type": content_type,
        "episodes_added": episodes_added,
        "sources_added": sources_added,
        "sample_sources": sample_sources[:3],
    }


def crawl_webdramaturkey_recent(
    cur,
    conn,
    idx: dict = None,
    limit: int = 35,
    category: str = "all",
) -> list[dict]:
    """
    Crawls ONLY New Series (/diziler?page=1..3) and New Movies (/filmler?page=1..3) from webdramaturkey2.com.
    Adheres strictly to the user requirement: no full archive crawl, only new items.
    """
    base_url = _get_base()
    candidates = []
    seen = set()

    # 1. New Series (/diziler pages 1..3)
    if category in ("all", "dizi"):
        for page in range(1, 4):
            page_url = f"{base_url}/diziler" if page == 1 else f"{base_url}/diziler?page={page}"
            status, html = _rate_limited_fetch(page_url)
            if status == 200 and html:
                soup = BeautifulSoup(html, "html.parser")
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if "/dizi/" in h and "/sezon" not in h and "/bolum" not in h:
                        full_u = urljoin(base_url, h)
                        if full_u not in seen:
                            candidates.append((full_u, False))
                            seen.add(full_u)

    # 2. New Movies (/filmler pages 1..3)
    if category in ("all", "film"):
        for page in range(1, 4):
            page_url = f"{base_url}/filmler" if page == 1 else f"{base_url}/filmler?page={page}"
            status, html = _rate_limited_fetch(page_url)
            if status == 200 and html:
                soup = BeautifulSoup(html, "html.parser")
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if "/film/" in h and "/sezon" not in h and "/bolum" not in h:
                        full_u = urljoin(base_url, h)
                        if full_u not in seen:
                            candidates.append((full_u, True))
                            seen.add(full_u)

    if idx is None:
        idx = build_drama_index(cur)

    print(f"[WDT ARCHIVE] Toplam {len(candidates)} yeni yapım adayı keşfedildi (Sayfa 1-3). Hedef limit: {limit}", flush=True)

    results = []
    for count_idx, (item_url, is_film) in enumerate(candidates[:limit], 1):
        print(f"[{count_idx}/{min(len(candidates), limit)}] Scraping {'Film' if is_film else 'Dizi'}: {item_url}...", flush=True)
        res = scrape_wdt_series_or_film(
            cur=cur,
            conn=conn,
            item_url=item_url,
            idx=idx,
            is_film=is_film,
        )
        results.append(res)

    return results
