"""
Dizipal Scraper & Synchronizer (https://dizipal1592.com/ + Auto-Domain)
- Auto-resolves current active Dizipal domain
- Catalogs /yeni-eklenen-dizi-bolumler, /yabanci-dizi-izle, /film-izle
- Decrypts PBKDF2 (SHA-512, 999 iter) + AES-CBC (256-bit) client-side encryption
- Extracts direct master.m3u8 stream via source2.php (or dplayer iframe fallback)
- Preserves both Turkish Subtitle & Turkish Dubbed streams
"""

import sys
import os
import re
import json
import time
import base64
import hashlib
import threading
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
    parse_season_and_episode,
)
from scrapers.supabase_sync_helper import match_or_create_enriched_drama, sync_drama_bundle_and_counts

DEFAULT_BASE_URL = "https://dizipal1592.com"
SITE_TAG = "dizipal"

_tls = threading.local()


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("DIZIPAL_COOKIE") or os.environ.get("DIZIPAL_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    return s


def _get_tls_session():
    if not hasattr(_tls, "session"):
        _tls.session = _get_session()
    return _tls.session


def resolve_current_domain(session=None, start_num=1592, max_tries=10):
    session = session or _get_session()
    base_override = os.environ.get("DIZIPAL_BASE_URL")
    if base_override:
        return base_override.rstrip("/")

    for num in range(start_num, start_num + max_tries):
        cand = f"https://dizipal{num}.com"
        try:
            r = session.get(cand, timeout=5, allow_redirects=True)
            if r.status_code == 200 and len(r.text) > 1000:
                final_domain = r.url.rstrip("/")
                if final_domain.endswith("/"):
                    final_domain = final_domain[:-1]
                return final_domain
        except Exception:
            continue
    return DEFAULT_BASE_URL


def decrypt_dizipal_payload(k, ciphertext_b64, iv_hex, salt_hex):
    """Decrypts PBKDF2 SHA-512 (999 iterations) + AES-256-CBC."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        salt_bytes = bytes.fromhex(salt_hex)
        iv_bytes = bytes.fromhex(iv_hex)
        cipher_bytes = base64.b64decode(ciphertext_b64.replace(r"\/", "/"))

        derived_key = hashlib.pbkdf2_hmac("sha512", k.encode("utf-8"), salt_bytes, 999, dklen=32)
        cipher = Cipher(algorithms.AES(derived_key), modes.CBC(iv_bytes))
        decryptor = cipher.decryptor()
        plain_padded = decryptor.update(cipher_bytes) + decryptor.finalize()
        pad_len = plain_padded[-1]
        if 1 <= pad_len <= 16:
            plain_padded = plain_padded[:-pad_len]
        return plain_padded.decode("utf-8", errors="ignore")
    except Exception:
        return None


def extract_stream_from_dplayer(session, dplayer_url, referer_url):
    """
    Extracts direct master.m3u8 from dplayer iframe via source2.php.
    Returns (master_m3u8_url or dplayer_url).
    """
    if not dplayer_url.startswith("http"):
        dplayer_url = "https:" + dplayer_url if dplayer_url.startswith("//") else f"https://{dplayer_url.lstrip('/')}"

    try:
        r = session.get(dplayer_url, headers={"Referer": referer_url}, timeout=8)
        if r.status_code != 200 or not r.text:
            return dplayer_url

        m_open = re.search(r"openPlayer\(['\"]([^'\"]+)['\"]", r.text)
        if not m_open:
            return dplayer_url

        playlist_arg = m_open.group(1)
        base_match = re.match(r"(https?://[^/]+)", dplayer_url)
        dplayer_host = base_match.group(1) if base_match else "https://sn.dplayer82.site"
        s2_url = f"{dplayer_host}/source2.php?v={playlist_arg}"

        r_s2 = session.get(s2_url, headers={"Referer": dplayer_url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
        if r_s2.status_code == 200 and r_s2.text:
            try:
                data = r_s2.json()
                playlist = data.get("playlist") or []
                if playlist and playlist[0].get("sources"):
                    raw_file = playlist[0]["sources"][0].get("file", "")
                    if raw_file:
                        master_m3u8 = raw_file.replace("m.php", "master.m3u8")
                        return master_m3u8
            except Exception:
                pass
    except Exception:
        pass
    return dplayer_url


def scrape_dizipal_episode(session, ep_url, base_url):
    """Scrapes episode and extracts streams for all player variants (Altyazı & Dublaj)."""
    try:
        r = session.get(ep_url, timeout=10)
        if r.status_code != 200 or not r.text:
            return []
    except Exception:
        return []

    html = r.text
    # Extract Next.js RSC payload
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html)
    blob = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\') if chunks else html

    sources = []
    # Find player variants (e.g. Altyazı and Dublaj)
    m_sources = re.search(r'"sources":\s*(\[[^\]]+\])', blob)
    alt_players = []
    if m_sources:
        try:
            alt_players = json.loads(m_sources.group(1))
        except Exception:
            pass

    # Extract primary stream
    m_k = re.search(r'"k":"([^"]+)"', blob)
    m_cipher = re.search(r'"ciphertext":"([^"]+)"', blob)
    m_iv = re.search(r'"iv":"([^"]+)"', blob)
    m_salt = re.search(r'"salt":"([^"]+)"', blob)

    if m_k and m_cipher and m_iv and m_salt:
        decrypted_player = decrypt_dizipal_payload(m_k.group(1), m_cipher.group(1), m_iv.group(1), m_salt.group(1))
        if decrypted_player:
            stream_url = extract_stream_from_dplayer(session, decrypted_player, ep_url)
            s_name = "Dizipal (Direct HLS)" if ".m3u8" in stream_url else "Dizipal DPlayer"
            sources.append((s_name, stream_url, "dizipal"))

    # If alternative players exist (e.g. Dublaj ?player=...)
    for p in alt_players:
        if not p.get("on") and p.get("href"):
            alt_href = p["href"]
            if not alt_href.startswith("http"):
                alt_href = f"{base_url}{alt_href}"
            try:
                r_alt = session.get(alt_href, headers={"Referer": ep_url}, timeout=8)
                if r_alt.status_code == 200:
                    alt_chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', r_alt.text)
                    alt_blob = "".join(alt_chunks).replace('\\"', '"').replace('\\\\', '\\')
                    ak = re.search(r'"k":"([^"]+)"', alt_blob)
                    ac = re.search(r'"ciphertext":"([^"]+)"', alt_blob)
                    aiv = re.search(r'"iv":"([^"]+)"', alt_blob)
                    asalt = re.search(r'"salt":"([^"]+)"', alt_blob)
                    if ak and ac and aiv and asalt:
                        dec = decrypt_dizipal_payload(ak.group(1), ac.group(1), aiv.group(1), asalt.group(1))
                        if dec:
                            alt_stream = extract_stream_from_dplayer(session, dec, alt_href)
                            label = p.get("label", "Dublaj")
                            s_name = f"Dizipal {label} (Direct HLS)" if ".m3u8" in alt_stream else f"Dizipal {label}"
                            sources.append((s_name, alt_stream, "dizipal"))
            except Exception:
                continue

    return sources


def scrape_series(conn, cur, idx, session, series_url, base_url):
    try:
        r = session.get(series_url, timeout=12)
        if r.status_code != 200:
            return 0
    except Exception:
        return 0

    html = r.text
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
    m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html) or re.search(r'["\'](tt\d{7,8})["\']', html)
    if m_imdb:
        imdb_id = m_imdb.group(1)

    slug = clean_scraped_slug(series_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

    # Extract all episode links from page
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/bolum/" in href:
            if not href.startswith("http"):
                href = f"{base_url}{href}" if href.startswith("/") else f"{base_url}/{href}"
            if href not in [x[0] for x in ep_links]:
                ep_links.append((href, a.get_text(strip=True)))

    if not ep_links:
        return 0

    # Parallel in-memory episode stream fetching
    resolved_episodes = []
    def _fetch_ep(ep_u, ep_t):
        local_sess = _get_tls_session()
        s_list = scrape_dizipal_episode(local_sess, ep_u, base_url)
        return (ep_u, ep_t, s_list)

    with ThreadPoolExecutor(max_workers=12) as executor:
        futs = [executor.submit(_fetch_ep, u, t) for u, t in ep_links]
        for fut in as_completed(futs):
            try:
                resolved_episodes.append(fut.result())
            except Exception:
                pass

    # Ensure at least 1 working source exists before creating drama
    if not any(sources for _, _, sources in resolved_episodes if sources):
        return 0

    # Batch write to SQLite
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


def get_catalog_items(session, base_url, max_pages=150):
    """Gathers catalog items from /yeni-eklenen-dizi-bolumler, /yabanci-dizi-izle, /film-izle, deduplicated without query params."""
    unique_urls = []
    seen = set()
    routes = [
        "/yeni-eklenen-dizi-bolumler",
        "/yabanci-dizi-izle",
        "/film-izle",
    ]
    for route in routes:
        empty_streak = 0
        for p in range(1, max_pages + 1):
            p_url = f"{base_url}{route}" if p == 1 else f"{base_url}{route}?page={p}"
            try:
                r = session.get(p_url, timeout=10)
                if r.status_code == 200:
                    links = re.findall(r'href=["\'](/series/[^"\']+|/bolum/[^"\']+|/film/[^"\']+)["\']', r.text)
                    new_found = 0
                    for l in links:
                        full = f"{base_url}{l}".split("?")[0]
                        if full not in seen:
                            seen.add(full)
                            unique_urls.append(full)
                            new_found += 1
                    if new_found == 0:
                        empty_streak += 1
                        if empty_streak >= 2:
                            break
                    else:
                        empty_streak = 0
                else:
                    break
            except Exception:
                continue
    return unique_urls


def fetch_dizipal_item_memory(url, base_url):
    """Fetches a Dizipal item (series or episode) completely in memory without holding a DB connection."""
    clean_u = url.split("?")[0]
    sess = _get_tls_session()

    if "/series/" in clean_u:
        try:
            r = sess.get(clean_u, timeout=12)
            if r.status_code != 200 or not r.text:
                return None
        except Exception:
            return None

        html = r.text
        soup = BeautifulSoup(html, "html.parser")
        title_elem = soup.find("h1") or soup.find("title")
        if not title_elem:
            return None
        raw_title = title_elem.get_text(strip=True)
        raw_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", raw_title, flags=re.I)
        raw_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", raw_title, flags=re.I).strip()
        raw_title = re.sub(r"[\s\-_–—|•:]+$", "", raw_title).strip()

        imdb_id = None
        m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html) or re.search(r'["\'](tt\d{7,8})["\']', html)
        if m_imdb:
            imdb_id = m_imdb.group(1)

        slug = clean_scraped_slug(clean_u)
        m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
        year = int(m_yr.group(1)) if m_yr else None

        ep_links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/bolum/" in href:
                if not href.startswith("http"):
                    href = f"{base_url}{href}" if href.startswith("/") else f"{base_url}/{href}"
                h_clean = href.split("?")[0]
                if h_clean not in [x[0] for x in ep_links]:
                    ep_links.append((h_clean, a.get_text(strip=True)))

        if not ep_links:
            return None

        def _fetch_single_ep(ep_item):
            ep_u, ep_t = ep_item
            t_sess = _get_tls_session()
            s_list = scrape_dizipal_episode(t_sess, ep_u, base_url)
            if s_list:
                season, number = parse_season_and_episode(ep_u, ep_t)
                return (ep_u, ep_t, season, number, s_list)
            return None

        resolved_episodes = []
        with ThreadPoolExecutor(max_workers=8) as ep_executor:
            futs = [ep_executor.submit(_fetch_single_ep, item) for item in ep_links]
            for fut in as_completed(futs):
                try:
                    res = fut.result()
                    if res:
                        resolved_episodes.append(res)
                except Exception:
                    pass

        if not resolved_episodes:
            return None

        return {
            "type": "series",
            "url": clean_u,
            "title": raw_title,
            "slug": slug,
            "year": year,
            "imdb_id": imdb_id,
            "episodes": resolved_episodes,
        }
    else:
        # Episode
        try:
            r = sess.get(clean_u, timeout=12)
            if r.status_code != 200 or not r.text:
                return None
        except Exception:
            return None

        html = r.text
        chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html)
        blob = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\') if chunks else html

        series_title = ""
        series_slug = ""
        season = 1
        number = 1

        m_title = re.search(r'"seriesId":\d+,"title":"([^"]+)"', blob) or re.search(r'"title":"([^"]+)","altTitle"', blob)
        if m_title:
            series_title = m_title.group(1).strip()

        m_sno = re.search(r'"seasonNo":(\d+)', blob)
        if m_sno:
            season = int(m_sno.group(1))

        m_eno = re.search(r'"episodeNo":(\d+)', blob)
        if m_eno:
            number = int(m_eno.group(1))

        m_shref = re.search(r'"seriesHref":"/series/([^"]+)"', blob)
        if m_shref:
            series_slug = clean_scraped_slug(m_shref.group(1))

        if not series_title or not series_slug:
            ep_slug_raw = clean_u.strip("/").split("/")[-1]
            m_se = re.search(r'-(\d+)x(\d+)$', ep_slug_raw)
            if m_se:
                season = int(m_se.group(1))
                number = int(m_se.group(2))
                clean_base = re.sub(r'-\d+x\d+$', '', ep_slug_raw)
            else:
                season, number = parse_season_and_episode(clean_u, "")
                clean_base = re.sub(r'-(?:\d+-sezon-)?\d+-bolum.*$', '', ep_slug_raw)

            if not series_slug:
                series_slug = clean_scraped_slug(clean_base)
            if not series_title:
                series_title = series_slug.replace("-", " ").title()

        series_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", series_title, flags=re.I)
        series_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", series_title, flags=re.I).strip()
        series_title = re.sub(r"[\s\-_–—|•:]+$", "", series_title).strip()

        imdb_id = None
        m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html) or re.search(r'["\'](tt\d{7,8})["\']', html)
        if m_imdb:
            imdb_id = m_imdb.group(1)

        sources = scrape_dizipal_episode(sess, clean_u, base_url)
        if not sources:
            return None

        return {
            "type": "episode",
            "url": clean_u,
            "title": series_title,
            "slug": series_slug,
            "season": season,
            "number": number,
            "imdb_id": imdb_id,
            "sources": sources,
            "base_url": base_url,
        }


def save_dizipal_items_batch(conn, cur, idx, batch_items, base_url):
    """Saves memory-resolved Dizipal items in a single quick transaction. Returns (total_added, affected_drama_ids)."""
    total_added = 0
    affected_dramas = set()

    for item in batch_items:
        if not item:
            continue
        itype = item.get("type")
        if itype == "series":
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

            item_sources_added = 0
            for ep_u, ep_t, season, number, sources in item["episodes"]:
                ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
                ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_u)
                for sname, surl, sprovider in sources:
                    if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                        item_sources_added += 1

            tag_site(cur, drama_id, SITE_TAG)
            if item_sources_added > 0:
                affected_dramas.add(drama_id)
                total_added += item_sources_added

        elif itype == "episode":
            drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
                conn=conn,
                cur=cur,
                idx=idx,
                raw_title=item["title"],
                slug_cand=item["slug"],
                content_type="dizi",
                country_hint="US",
                site_tag=SITE_TAG,
                source_url=f"{base_url}/series/{item['slug']}",
                imdb_id=item.get("imdb_id"),
            )
            if not drama_id:
                continue

            season = item["season"]
            number = item["number"]
            ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
            ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, item["url"])
            item_sources_added = 0
            for sname, surl, sprovider in item["sources"]:
                if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
                    item_sources_added += 1

            tag_site(cur, drama_id, SITE_TAG)
            if item_sources_added > 0:
                affected_dramas.add(drama_id)
                total_added += item_sources_added

    safe_commit(conn)
    return total_added, affected_dramas


def scrape_episode_and_save(conn, cur, idx, session, ep_url, base_url):
    """Scrapes a single episode URL from catalog, resolves its series, and saves to DB."""
    try:
        r = session.get(ep_url, timeout=12)
        if r.status_code != 200 or not r.text:
            return 0
    except Exception:
        return 0

    html = r.text
    # 1. Parse Series Title, Season, Episode from RSC or schema
    series_title = ""
    series_slug = ""
    season = 1
    number = 1

    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html)
    blob = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\') if chunks else html

    m_title = re.search(r'"seriesId":\d+,"title":"([^"]+)"', blob) or re.search(r'"title":"([^"]+)","altTitle"', blob)
    if m_title:
        series_title = m_title.group(1).strip()

    m_sno = re.search(r'"seasonNo":(\d+)', blob)
    if m_sno:
        season = int(m_sno.group(1))

    m_eno = re.search(r'"episodeNo":(\d+)', blob)
    if m_eno:
        number = int(m_eno.group(1))

    m_shref = re.search(r'"seriesHref":"/series/([^"]+)"', blob)
    if m_shref:
        series_slug = clean_scraped_slug(m_shref.group(1))

    # Fallback to URL parsing: e.g. /bolum/slug-4x8
    if not series_title or not series_slug:
        ep_slug_raw = ep_url.strip("/").split("/")[-1]
        m_se = re.search(r'-(\d+)x(\d+)$', ep_slug_raw)
        if m_se:
            season = int(m_se.group(1))
            number = int(m_se.group(2))
            clean_base = re.sub(r'-\d+x\d+$', '', ep_slug_raw)
        else:
            season, number = parse_season_and_episode(ep_url, "")
            clean_base = re.sub(r'-(?:\d+-sezon-)?\d+-bolum.*$', '', ep_slug_raw)

        if not series_slug:
            series_slug = clean_scraped_slug(clean_base)
        if not series_title:
            series_title = series_slug.replace("-", " ").title()

    series_title = re.sub(r"\s*[-–—|•:]\s*(?:sezonluk\s*dizi|dizipal\d*|fullhdfilm\w*|tranimeci|tranimaci|anizm|animelvl).*$", "", series_title, flags=re.I)
    series_title = re.sub(r"\b(?:dizisi\s*izle|dizi\s*izle|filmi\s*izle|film\s*izle|anime\s*izle|dizisi|izle)\b", "", series_title, flags=re.I).strip()
    series_title = re.sub(r"[\s\-_–—|•:]+$", "", series_title).strip()

    # Extract IMDb ID
    imdb_id = None
    m_imdb = re.search(r"imdb\.com/title/(tt\d+)", html) or re.search(r'["\'](tt\d{7,8})["\']', html)
    if m_imdb:
        imdb_id = m_imdb.group(1)

    # Fetch sources first, never create empty drama shells
    sources = scrape_dizipal_episode(session, ep_url, base_url)
    if not sources:
        return 0

    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=series_title,
        slug_cand=series_slug,
        content_type="dizi",
        country_hint="US",
        site_tag=SITE_TAG,
        source_url=f"{base_url}/series/{series_slug}",
        imdb_id=imdb_id,
    )
    if not drama_id:
        return 0

    added_count = 0
    ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
    ep_id, is_new = match_or_create_episode(cur, drama_id, season, number, ep_name, ep_url)
    for sname, surl, sprovider in sources:
        if add_source(cur, ep_id, sname, surl, sprovider, SITE_TAG):
            added_count += 1

    tag_site(cur, drama_id, SITE_TAG)
    safe_commit(conn)
    if added_count > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)
    return added_count
