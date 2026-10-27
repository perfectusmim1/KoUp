"""
WebDramaTurkey2.com Scraper & WDT Stream Resolver.
Features:
- Balanced discovery of New Series (/diziler) and New Movies (/filmler)
- Adaptive rate-limit defense: 1.2s - 1.8s random delay + Retry-After / exponential backoff (5s -> 10s -> 20s -> 40s)
- WDT (dtpasn.asia) embed resolution via /ajax/embed and live HLS stream verification
- Multi-source fallback (WDT, Vidmoly, Filemoon) and full archive sync
- Detailed diagnostic logging for deep tracing and rate-limit prevention
"""

import argparse
import json
import random
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

import requests
from bs4 import BeautifulSoup

import os
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

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
    sb_request,
    sync_drama_bundle_and_counts,
)

DEFAULT_BASE_URL = "https://webdramaturkey2.com"
_LAST_REQUEST_TIME = 0.0
_cfr_session = None
_req_session = None


def clean_site_title(raw_title: str) -> str:
    """Cleans site names, Unicode dashes (–, —, |), and watch suffixes from scraped title."""
    if not raw_title:
        return ""
    t = re.sub(r"[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d]", "-", raw_title)
    t = re.sub(
        r"\s*(?:[-|–—:]\s*)?(?:webdramaturkey(?:\d+)?(?:\.com)?|diziizle(?:\.wiki)?|izle|hd izle|türkçe altyazılı|turkce altyazili|türkçe dublaj|turkce dublaj|kore dizisi|dizisi|filmi).*$",
        "",
        t,
        flags=re.I,
    )
    t = re.sub(r"[\-_|:•\s]+$", "", t).strip()
    return re.sub(r"\s+", " ", t)


def _get_wdt_session():
    """Returns persistent curl_cffi and requests sessions to keep Cloudflare cookies & connections alive."""
    global _cfr_session, _req_session
    if _cfr_session is None and cfr:
        try:
            _cfr_session = cfr.Session(impersonate="chrome")
        except Exception as e:
            print(f"[WDT Session] curl_cffi başlatılamadı ({e}), requests fallback kullanılacak.", flush=True)
            _cfr_session = None
    if _req_session is None:
        _req_session = requests.Session()
    return _cfr_session, _req_session


def _get_base() -> str:
    return get_site_base_url("webdramaturkey2", DEFAULT_BASE_URL)


def _rate_limited_fetch(
    url: str,
    method: str = "GET",
    data: dict = None,
    headers: dict = None,
    timeout: int = 15,
    max_retries: int = 4,
) -> tuple[int, str]:
    """
    Executes an HTTP request with adaptive rate-limit protection:
    - 1.2s - 1.8s randomized delay between requests to avoid burst rate limiting
    - Retry-After header awareness with exponential backoff on HTTP 429/503/502/504
    - Persistent sessions to preserve CF cookies and TLS sessions
    - Clear diagnostic logging for any network, status, or Cloudflare challenge failures
    """
    global _LAST_REQUEST_TIME

    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if headers:
        default_headers.update(headers)

    cfr_s, req_s = _get_wdt_session()

    for attempt in range(max_retries):
        target_delay = random.uniform(1.2, 1.8)
        elapsed = time.time() - _LAST_REQUEST_TIME
        if elapsed < target_delay:
            time.sleep(target_delay - elapsed)

        _LAST_REQUEST_TIME = time.time()
        resp_status = 0
        resp_text = ""
        retry_after_hdr = None
        last_error = None

        if cfr_s:
            try:
                if method.upper() == "POST":
                    r = cfr_s.post(url, data=data, headers=default_headers, timeout=timeout)
                else:
                    r = cfr_s.get(url, headers=default_headers, timeout=timeout)
                resp_status = r.status_code
                resp_text = r.text
                retry_after_hdr = r.headers.get("Retry-After")
            except Exception as e_cfr:
                last_error = f"curl_cffi: {e_cfr}"

        if not resp_status:
            try:
                if method.upper() == "POST":
                    r = req_s.post(url, data=data, headers=default_headers, timeout=timeout)
                else:
                    r = req_s.get(url, headers=default_headers, timeout=timeout)
                resp_status = r.status_code
                resp_text = r.text
                retry_after_hdr = r.headers.get("Retry-After")
            except Exception as e_req:
                last_error = f"{last_error} | requests: {e_req}" if last_error else f"requests: {e_req}"

        # Network / Connection level failure
        if not resp_status and last_error:
            wait_net = 2.0 + attempt * 2.5
            print(f"[WDT Ağ Hatası] {method} {url} -> {last_error}. {wait_net}s bekleniyor (deneme {attempt+1}/{max_retries})...", flush=True)
            time.sleep(wait_net)
            continue

        # Rate Limit (429) or temporary server errors (503, 502, 504)
        if resp_status in (429, 503, 502, 504):
            backoff = 5.0 * (2 ** attempt)
            if retry_after_hdr:
                try:
                    parsed_ra = float(retry_after_hdr)
                    if 1.0 <= parsed_ra <= 120.0:
                        backoff = parsed_ra
                except Exception:
                    pass
            backoff = round(backoff + random.uniform(0.5, 2.0), 1)
            print(
                f"[WDT RATE-LIMIT] HTTP {resp_status} on {url}. "
                f"Sakinleşme süresi (backoff): {backoff}s (deneme {attempt+1}/{max_retries})...",
                flush=True,
            )
            time.sleep(backoff)
            continue

        # Cloudflare Challenge Check
        if resp_status == 403 or (resp_text and any(k in resp_text.lower() for k in ("just a moment...", "cf-turnstile", "challenge-running", "turnstile.render"))):
            print(f"[WDT Cloudflare Engeli] HTTP {resp_status} Cloudflare Challenge/Turnstile algılandı: {url}", flush=True)

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
        is_valid = '"hls":true' in text or "videoSource" in text or ".m3u8" in text
        if not is_valid:
            print(f"[WDT Stream] dtpasn.asia hash={hash_code} HLS akışı içermiyor (yanıt: {text[:100]}).", flush=True)
        return is_valid
    print(f"[WDT Stream Hatası] dtpasn.asia hash={hash_code} sorgusu başarısız (HTTP {status}).", flush=True)
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
        print(f"[WDT Embed Hatası] /ajax/embed id={embed_id} HTTP {status} döndü.", flush=True)
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
        print(f"[WDT Embed] id={embed_id} yanıtında video URL bulunamadı (yanıt: {text[:120]}).", flush=True)
        return None

    # Fetch intermediate video.php page to inspect actual iframe src
    v_status, v_text = _rate_limited_fetch(video_url, headers={"Referer": page_url}, timeout=10)
    if v_status != 200 or not v_text:
        print(f"[WDT Embed] video.php iframe sayfası alınamadı: {video_url} (HTTP {v_status})", flush=True)
        return None

    soup = BeautifulSoup(v_text, "html.parser")
    iframe = soup.select_one("iframe#main-iframe, iframe")
    iframe_src = iframe.get("src", "") if iframe else ""
    if not iframe_src:
        m_if = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', v_text)
        if m_if:
            iframe_src = m_if.group(1)

    if not iframe_src:
        print(f"[WDT Embed] video.php içinde iframe etiketi bulunamadı: {video_url}", flush=True)
        return None

    iframe_src = urljoin(base_url, iframe_src)
    src_low = iframe_src.lower()

    # 1. WDT (dtpasn.asia)
    if "dtpasn.asia/video/" in src_low:
        dt_hash = iframe_src.split("/video/")[-1].split("?")[0].split("#")[0].strip()
        if verify_wdt_stream(dt_hash, base_url):
            return "WDT (Full HD)", f"https://dtpasn.asia/video/{dt_hash}#r=wdt", "wdt"
        print(f"[WDT Stream] dtpasn.asia hash={dt_hash} doğrulamadan geçemedi.", flush=True)
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
        print(f"[WDT Embed Filtre] Ölü/yasaklı sağlayıcı elendi: {iframe_src}", flush=True)
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
    max_episodes: int = 100,
) -> dict:
    """
    Scrapes a single drama or movie from webdramaturkey2.com:
    - Parses Schema.org / metadata
    - Enriches via TMDB
    - Discovers episodes and resolves WDT/Vidmoly/Filemoon sources
    - Updates bundles and database
    """
    t_start = time.time()
    base_url = _get_base()
    full_url = urljoin(base_url, item_url)
    status, html = _rate_limited_fetch(full_url)
    if status != 200 or not html:
        err = f"HTTP {status} ile {full_url} alınamadı"
        print(f"[WDT Hata] {err}", flush=True)
        return {"error": err, "episodes_added": 0, "sources_added": 0}

    soup = BeautifulSoup(html, "html.parser")

    # 1. Title, Overview, Poster
    title = ""
    h1 = soup.select_one("h1")
    if h1:
        title = h1.get_text(strip=True)
    if not title and soup.title:
        title = soup.title.get_text(strip=True).split("-")[0].strip()

    title = clean_site_title(title)

    m_slug = re.search(r"/(?:dizi|film)/([^/]+)", full_url)
    slug = m_slug.group(1) if m_slug else full_url.strip("/").split("/")[-1]
    slug = clean_scraped_slug(slug)

    content_type = "film" if (is_film or "/film/" in full_url) else "dizi"

    # Precise country detection from flag icon or text
    country_hint = "KR"
    flag_el = soup.select_one("span.flag-icon")
    if flag_el:
        for c in flag_el.get("class", []):
            m_f = re.search(r"flag-icon-([a-z]{2})", c)
            if m_f:
                country_hint = m_f.group(1).upper()
                break
    else:
        page_sample = html[:5000].lower()
        if any(w in page_sample for w in ("çin", "cin", "china")):
            country_hint = "CN"
        elif any(w in page_sample for w in ("japon", "japan")):
            country_hint = "JP"
        elif any(w in page_sample for w in ("tayland", "thailand")):
            country_hint = "TH"
        elif any(w in page_sample for w in ("filipin", "philippines")):
            country_hint = "PH"
        elif any(w in page_sample for w in ("tayvan", "taiwan")):
            country_hint = "TW"
        elif any(w in page_sample for w in ("türk", "turkey")):
            country_hint = "TR"

    # Year detection from metadata attributes
    year = None
    for fa in soup.select(".featured-attr, .detail-attr"):
        attr_name = fa.select_one(".attr")
        attr_val = fa.select_one(".text")
        if attr_name and attr_val:
            an_text = attr_name.get_text(strip=True).lower()
            if any(k in an_text for k in ("yıl", "yil", "vizyon", "yayın")):
                m_y = re.search(r"\b(19\d{2}|20\d{2})\b", attr_val.get_text(strip=True))
                if m_y:
                    year = int(m_y.group(1))
                    break

    if not year:
        m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", html[:3000])
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
        country_hint=country_hint,
        site_tag="webdramaturkey2",
        source_url=full_url,
        year_hint=year,
    )

    print(f"[WDT Yapım] #{drama_id} '{d_title}' ({content_type}, {country_hint}, yıl: {year or 'bilinmiyor'}) işleniyor...", flush=True)

    episodes_added = 0
    sources_added = 0
    sample_sources = []

    if content_type == "film":
        # Movies have only 1 episode (Season 1 Episode 1)
        ep_id, is_new = match_or_create_episode(cur, drama_id, 1, 1, f"{d_title} (Film)", full_url)
        if is_new:
            episodes_added += 1
            print(f"[WDT Film Bölüm] '{d_title}' için film bölüm kaydı oluşturuldu (ep_id={ep_id}).", flush=True)

        # Check existing WDT sources
        cur.execute(
            "SELECT id, provider, direct_url FROM episode_sources WHERE episode_id = ? AND (provider = 'wdt' OR direct_url LIKE '%dtpasn%')",
            (ep_id,),
        )
        existing_src = cur.fetchone()
        if existing_src:
            print(f"[WDT Kaynak Atlandı] '{d_title}' film kaynağı zaten mevcut (id={existing_src[0]}).", flush=True)
        else:
            embed_btns = soup.select("a[data-embed]")
            print(f"[WDT Embed] '{d_title}' film sayfasında {len(embed_btns)} embed butonu bulundu.", flush=True)
            for btn in embed_btns:
                eid = btn.get("data-embed")
                resolved = resolve_wdt_embed(eid, full_url, base_url)
                if resolved:
                    s_name, s_url, s_prov = resolved
                    if add_source(cur, ep_id, s_name, s_url, s_prov, "webdramaturkey2", embed_id=eid):
                        sources_added += 1
                        sample_sources.append(s_url)
                        print(f"[WDT Kaynak Eklendi] '{d_title}' -> +{s_name} ({s_prov}): {s_url[:80]}", flush=True)
                        if s_prov == "wdt":
                            break
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
        total_discovered = len(ep_links)
        if max_episodes and len(ep_links) > max_episodes:
            ep_links = ep_links[-max_episodes:]

        print(f"[WDT Dizi Keşif] '{d_title}': Toplam {total_discovered} bölüm linki bulundu (işlenecek: {len(ep_links)}).", flush=True)

        for ep_idx, ep_url in enumerate(ep_links, 1):
            sm = re.search(r"(\d+)[-_]sezon", ep_url)
            em = re.search(r"(\d+)[-_]bolum", ep_url)
            s_num = int(sm.group(1)) if sm else 1
            e_num = int(em.group(1)) if em else 1

            ep_name = f"{s_num}. Sezon {e_num}. Bölüm"
            ep_id, is_new = match_or_create_episode(cur, drama_id, s_num, e_num, ep_name, ep_url)
            if is_new:
                episodes_added += 1
                print(f"[WDT Bölüm Eklendi] '{d_title}' -> {ep_name} (yeni)", flush=True)

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
                print(f"[WDT Bölüm Hatası] '{d_title}' S{s_num}E{e_num} ({ep_url}) HTTP {ep_status}", flush=True)
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
                        print(f"[WDT Kaynak Eklendi] '{d_title}' S{s_num}E{e_num} -> +{s_name} ({s_prov})", flush=True)
                        if s_prov == "wdt":
                            break

    conn.commit()

    # Check if drama has any valid sources (Zero Empty Shell guarantee)
    cur.execute(
        """
        SELECT count(es.id) 
        FROM episodes e 
        JOIN episode_sources es ON es.episode_id = e.id 
        WHERE e.drama_id = ?
        """,
        (drama_id,),
    )
    total_sources = cur.fetchone()[0]

    if total_sources == 0:
        print(f"[WDT PURGE] '{d_title}' (#{drama_id}) geçerli kaynağa sahip değil. Boş kabuk temizleniyor...", flush=True)
        cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (drama_id,))
        cur.execute("DELETE FROM episodes WHERE drama_id = ?", (drama_id,))
        cur.execute("DELETE FROM dramas WHERE id = ?", (drama_id,))
        conn.commit()
        try:
            sb_request("DELETE", f"/rest/v1/media?id=eq.{drama_id}")
        except Exception:
            pass
        return {
            "drama_id": drama_id,
            "title": d_title,
            "error": "No valid sources found, purged empty shell",
            "episodes_added": 0,
            "sources_added": 0,
        }

    if episodes_added > 0 or sources_added > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)

    item_dur = round(time.time() - t_start, 1)
    print(f"[WDT Yapım Tamamlandı] '{d_title}' -> +{episodes_added} Bölüm, +{sources_added} Kaynak ({item_dur}s)", flush=True)

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
    limit: int = 40,
    category: str = "all",
    max_pages: int = 5,
) -> list[dict]:
    """
    Crawls New Series (/diziler?page=1..5) and New Movies (/filmler?page=1..5) from webdramaturkey2.com.
    Interleaves series and movies in 'all' mode to guarantee balanced coverage without starvation.
    """
    t_crawl_start = time.time()
    base_url = _get_base()
    film_candidates = []
    dizi_candidates = []
    seen = set()

    # 1. New Movies (/filmler pages 1..max_pages)
    if category in ("all", "film"):
        for page in range(1, max_pages + 1):
            page_url = f"{base_url}/filmler" if page == 1 else f"{base_url}/filmler?page={page}"
            status, html = _rate_limited_fetch(page_url)
            if status == 200 and html:
                soup = BeautifulSoup(html, "html.parser")
                found_count = 0
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if "/film/" in h and "/sezon" not in h and "/bolum" not in h:
                        full_u = urljoin(base_url, h)
                        if full_u not in seen:
                            film_candidates.append((full_u, True))
                            seen.add(full_u)
                            found_count += 1
                print(f"[WDT Keşif] /filmler Sayfa {page}/{max_pages}: +{found_count} film adayı bulundu.", flush=True)
            elif status != 200:
                print(f"[WDT Keşif Hatası] /filmler Sayfa {page} alınamadı (HTTP {status})", flush=True)

    # 2. New Series (/diziler pages 1..max_pages)
    if category in ("all", "dizi"):
        for page in range(1, max_pages + 1):
            page_url = f"{base_url}/diziler" if page == 1 else f"{base_url}/diziler?page={page}"
            status, html = _rate_limited_fetch(page_url)
            if status == 200 and html:
                soup = BeautifulSoup(html, "html.parser")
                found_count = 0
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if "/dizi/" in h and "/sezon" not in h and "/bolum" not in h:
                        full_u = urljoin(base_url, h)
                        if full_u not in seen:
                            dizi_candidates.append((full_u, False))
                            seen.add(full_u)
                            found_count += 1
                print(f"[WDT Keşif] /diziler Sayfa {page}/{max_pages}: +{found_count} dizi adayı bulundu.", flush=True)
            elif status != 200:
                print(f"[WDT Keşif Hatası] /diziler Sayfa {page} alınamadı (HTTP {status})", flush=True)

    # Combine candidates fairly (interleaving so series aren't starved by films)
    if category == "all":
        candidates = []
        max_len = max(len(dizi_candidates), len(film_candidates))
        for i in range(max_len):
            if i < len(dizi_candidates):
                candidates.append(dizi_candidates[i])
            if i < len(film_candidates):
                candidates.append(film_candidates[i])
    elif category == "dizi":
        candidates = dizi_candidates
    else:
        candidates = film_candidates

    if idx is None:
        idx = build_drama_index(cur)

    # Pre-filter movies that already have WDT sources to save HTTP budget
    filtered_candidates = []
    for item_u, is_f in candidates:
        if is_f:
            f_slug = item_u.strip("/").split("/")[-1]
            cur.execute(
                """
                SELECT 1 FROM dramas d
                JOIN episodes e ON e.drama_id = d.id
                JOIN episode_sources es ON es.episode_id = e.id
                WHERE (d.slug = ? OR d.source_url = ?) AND (es.provider = 'wdt' OR es.direct_url LIKE '%dtpasn%')
                LIMIT 1
                """,
                (f_slug, item_u),
            )
            if cur.fetchone():
                continue
        filtered_candidates.append((item_u, is_f))

    candidates = filtered_candidates
    print(f"[WDT ARCHIVE] Toplam {len(candidates)} yeni yapım adayı keşfedildi (Sayfa 1-{max_pages}, Dizi: {len(dizi_candidates)}, Film: {len(film_candidates)}). Hedef limit: {limit}", flush=True)

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
        time.sleep(0.5)

    total_episodes = sum(r.get("episodes_added", 0) for r in results)
    total_sources = sum(r.get("sources_added", 0) for r in results)
    elapsed_total = round(time.time() - t_crawl_start, 1)
    print(
        f"[WDT Özet] Tarama tamamlandı ({elapsed_total}s): {len(results)} yapım işlendi. "
        f"+{total_episodes} Bölüm | +{total_sources} Kaynak eklendi.",
        flush=True,
    )

    return results


def main():
    parser = argparse.ArgumentParser(description="WebDramaTurkey2 Scraper & Stream Resolver")
    parser.add_argument("--limit", type=int, default=40, help="Taranacak maksimum yapım sayısı")
    parser.add_argument("--category", type=str, default="all", choices=["all", "dizi", "film"], help="Kategori filtresi")
    parser.add_argument("--pages", type=int, default=5, help="Taranacak sayfa derinliği (1..N)")
    args = parser.parse_args()

    import os
    _root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if _root not in sys.path:
        sys.path.insert(0, _root)
    from database import get_connection

    conn = get_connection()
    cur = conn.cursor()
    try:
        crawl_webdramaturkey_recent(
            cur=cur,
            conn=conn,
            limit=args.limit,
            category=args.category,
            max_pages=args.pages,
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
