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
from datetime import datetime
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


def _get_session():
    s = cfr.Session(impersonate="chrome124") if hasattr(cfr, "Session") else cfr.Session()
    cookie = os.environ.get("DIZIPAL_COOKIE") or os.environ.get("DIZIPAL_CF_CLEARANCE")
    if cookie:
        s.headers["Cookie"] = cookie if "=" in cookie else f"cf_clearance={cookie}"
    s.headers.setdefault("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    s.headers.setdefault("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    return s


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
    raw_title = title_elem.get_text(strip=True).replace("İzle", "").replace("izle", "").strip()

    slug = clean_scraped_slug(series_url)
    m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", raw_title)
    year = int(m_yr.group(1)) if m_yr else None

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

    # Extract all episode links from page
    ep_links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/bolum/" in href:
            if not href.startswith("http"):
                href = f"{base_url}{href}" if href.startswith("/") else f"{base_url}/{href}"
            if href not in ep_links:
                ep_links.append((href, a.get_text(strip=True)))

    added_sources_count = 0
    for ep_url, ep_text in ep_links:
        season, number = parse_season_and_episode(ep_url, ep_text)
        ep_name = f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

        sources = scrape_dizipal_episode(session, ep_url, base_url)
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
    )
    if not drama_id:
        return 0

    sources = scrape_dizipal_episode(session, ep_url, base_url)
    added_count = 0
    if sources:
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
