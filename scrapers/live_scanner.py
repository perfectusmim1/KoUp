"""
KoUp Universal Live Scanner
Handles live scanning and target series synchronization for:
- DiziKorea (1080p HLS)
- DiziBox (DBX Pro 1080p HLS)
- DDizi (HLS & YouTube HD)
- AnimeciX (Tau-Video Native)
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from bs4 import BeautifulSoup
import sqlite3
import base64
import hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    ANIMECIX_KEY = b'i4C7R2fXGocdYgFLzCbDlsJjukf8G58b'
    ANIMECIX_AES = AESGCM(ANIMECIX_KEY)
except Exception:
    ANIMECIX_AES = None

def make_animecix_header(query_str: str) -> str:
    if not ANIMECIX_AES:
        return ""
    iv = os.urandom(12)
    plaintext = ('{version}' + query_str).encode('utf-8')
    ciphertext = ANIMECIX_AES.encrypt(iv, plaintext, None)
    ct_b64 = base64.b64encode(ciphertext).decode('ascii')
    iv_b64 = base64.b64encode(iv).decode('ascii')
    return f'{ct_b64}.{iv_b64}'

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

from database import get_connection
from scrapers.multisite import (
    norm_title,
    build_drama_index,
    find_in_index,
    match_or_create_episode,
    add_source,
    tag_site,
    safe_commit,
    unique_slug,
    parse_season_and_episode,
    clean_episode_title,
    clean_scraped_slug,
)
from scrapers.clean_fansub import clean_fansub_name, clean_source_name
from scrapers.sync_hdfilm_target import resolve_hdfilm_streams
from scrapers.translator import resolve_tmdb_metadata, translate_to_turkish
from scrapers.supabase_sync_helper import (
    emit_live_item,
    match_or_create_enriched_drama,
    sync_drama_bundle_and_counts,
)
from scrapers.pending_sources import (
    ensure_pending_columns,
    page_is_placeholder,
    reconcile_episode,
)

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    line = f"[{now}] [{tag}] {msg}"
    print(line, flush=True)


def _decode_response_content(content: bytes, text: str, url: str = "") -> str:
    if not content:
        return ""
    if url and "ddizi" in url.lower():
        try:
            return content.decode("windows-1254")
        except Exception:
            pass
    if "\ufffd" in text:
        for enc in ("windows-1254", "iso-8859-9", "utf-8"):
            try:
                dec = content.decode(enc)
                if "\ufffd" not in dec:
                    return dec
            except Exception:
                pass
    return text


def fetch_url(url: str, headers: dict = None, timeout: int = 12) -> str:
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    }
    if headers:
        h.update(headers)
    if cffi_requests is not None:
        try:
            resp = cffi_requests.get(url, headers=h, impersonate="chrome", timeout=timeout)
            if resp.status_code == 200 and 'Just a moment...' not in resp.text:
                return _decode_response_content(resp.content, resp.text, url)
        except Exception:
            pass
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw_bytes = resp.read()
        return _decode_response_content(raw_bytes, raw_bytes.decode('utf-8', errors='replace'), url)


# =========================================================================
# SCANNER: DIZIBOX
# =========================================================================
def scan_dizibox(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "DiziBox canlı tarama motoru devrede (https://www.dizibox.live)...")
    headers = {'Referer': 'https://www.dizibox.live/'}

    ep_links = []
    if target:
        log("ARAMA", f'DiziBox üzerinde hedef aranıyor: "{target}"')
        q = urllib.parse.quote(target)
        try:
            s_html = fetch_url(f"https://www.dizibox.live/?s={q}", headers=headers)
            soup = BeautifulSoup(s_html, 'html.parser')
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/diziler/' in h or '-izle' in h:
                    log("BULUNDU", f"Hedef yapım sayfası: {h}")
                    detail_html = fetch_url(h, headers=headers)
                    d_soup = BeautifulSoup(detail_html, 'html.parser')
                    for ea in d_soup.find_all('a', href=True):
                        eh = ea['href']
                        if '-sezon-' in eh and '-bolum' in eh:
                            ep_links.append((ea.get_text(strip=True), eh))
                    break
        except Exception as e:
            log("UYARI", f"Arama hatası: {e}")
    else:
        try:
            home_html = fetch_url("https://www.dizibox.live/", headers=headers)
            soup = BeautifulSoup(home_html, 'html.parser')
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '-sezon-' in h and '-bolum' in h and h not in seen:
                    seen.add(h)
                    ep_links.append((a.get_text(strip=True), h))
                    if len(ep_links) >= limit:
                        break
        except Exception as e:
            log("HATA", f"Ana sayfa alınamadı: {e}")
            return 0, []

    log("KAYIT", f"{len(ep_links)} adet güncel bölüm bağlantısı ayrıştırıldı.")
    synced_items = []
    touched_dramas = set()

    for txt, ep_url in ep_links:
        try:
            m = re.search(r'/([^/]+)-(\d+)-sezon-(\d+)-bolum', ep_url)
            if not m:
                continue
            slug_raw = m.group(1)
            season = int(m.group(2))
            ep_num = int(m.group(3))
            drama_title = slug_raw.replace('-', ' ').title()

            did, drama_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, drama_title, slug_raw,
                content_type='dizi', country_hint='US', site_tag='dizibox',
                source_url=ep_url, log_fn=log
            )

            ep_id, is_new_ep = match_or_create_episode(cur, did, season, ep_num, f"{season}. Sezon {ep_num}. Bölüm", ep_url)
            if not target and not is_new_ep:
                has_dbx = cur.execute("SELECT 1 FROM episode_sources WHERE episode_id=? AND provider='dbx' LIMIT 1", (ep_id,)).fetchone()
                if has_dbx:
                    item_obj = {
                        'id': f"dizibox-{did}-{season}-{ep_num}",
                        'title': drama_title,
                        'subtitle': f"{season}. Sezon {ep_num}. Bölüm (DBX Pro 1080p)",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{ep_num}",
                        'date': datetime.now().isoformat(),
                        'status': 'Doğrulandı',
                        'sourceName': 'Orijinal',
                    }
                    log("DOĞRULANDI", f'"{drama_title}" -> {season}. Sezon {ep_num}. Bölüm kaynağı güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
                    continue

            ep_html = fetch_url(ep_url, headers=headers)
            is_ph = page_is_placeholder(ep_html)
            added = False

            m_king = re.search(r'src=["\'](https://www\.dizibox\.live/player/king/king\.php\?v=[^"\']+)["\']', ep_html)
            if m_king:
                king_url = m_king.group(1)
                king_html = fetch_url(king_url, headers={'Referer': ep_url})
                m_moly = re.search(r'src=["\'](https://dbx\.molystream\.org/embed/[^"\']+)["\']', king_html)
                if m_moly:
                    embed_url = m_moly.group(1)
                    m_id = re.search(r'/embed/([a-zA-Z0-9-]+)', embed_url)
                    if m_id:
                        video_id = m_id.group(1)
                        hls_url = f"https://dbx.molystream.org/embed/sheila/{video_id}"
                        is_dead = False
                        try:
                            probe_html = fetch_url(embed_url, headers={'Referer': 'https://www.dizibox.live/'}, timeout=6)
                            if not probe_html or any(err in probe_html.lower() for err in ['no video found', 'this video not found', 'file was deleted', 'video not found', 'file not found', '404 not found']) or '{"status":"error"}' in probe_html:
                                is_dead = True
                        except Exception:
                            pass
                        if not is_dead:
                            added = add_source(cur, ep_id, "Orijinal", hls_url, "dbx", "dizibox")

            is_pending = reconcile_episode(cur, ep_id, is_placeholder=is_ph)
            if added or is_new_ep:
                touched_dramas.add(did)
            safe_commit(conn)

            status_text = 'Canlı Çözüldü' if added else ('Kaynak Bekleniyor (Yakında)' if is_pending else 'Doğrulandı')
            item_obj = {
                'id': f"dizibox-{did}-{season}-{ep_num}",
                'title': drama_title,
                'subtitle': f"{season}. Sezon {ep_num}. Bölüm (DBX Pro 1080p)",
                'image': cover_img,
                'link': f"/seri/{drama_slug}/{ep_num}",
                'date': datetime.now().isoformat(),
                'status': status_text,
                'sourceName': 'Orijinal',
            }
            if added:
                log("AKINCI", f'"{drama_title}" -> {season}. Sezon {ep_num}. Bölüm (DBX Pro 1080p HLS) eklendi.')
            elif is_pending:
                log("BEKLEMEDE", f'"{drama_title}" -> {season}. Sezon {ep_num}. Bölüm henüz kaynak yok (yakında/hazırlanıyor).')
            else:
                log("DOĞRULANDI", f'"{drama_title}" -> {season}. Sezon {ep_num}. Bölüm kaynağı güncel.')
            emit_live_item(item_obj)
            synced_items.append(item_obj)
        except Exception as err:
            log("HATA", f"{ep_url} çözümlenirken hata: {err}")

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    return len(synced_items), synced_items


# =========================================================================
# SCANNER: DIZIKOREA
# =========================================================================
def scan_dizikorea(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "DiziKorea canlı tarama motoru devrede (https://dizikorea3.com)...")
    headers = {'Referer': 'https://dizikorea3.com/'}
    series_links = []

    if target:
        log("ARAMA", f'DiziKorea üzerinde hedef aranıyor: "{target}"')
        q = urllib.parse.quote(target)
        try:
            s_html = fetch_url(f"https://dizikorea3.com/?s={q}", headers=headers)
            soup = BeautifulSoup(s_html, 'html.parser')
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('-izle' in h or '-dq' in h):
                    t_name = a.get_text(strip=True)
                    s_core = re.sub(r'[^a-z0-9]', '', h.split('/dizi/')[-1].split('/')[0].lower())
                    q_core = re.sub(r'[^a-z0-9]', '', target.lower())
                    if q_core in s_core or s_core in q_core or norm_title(target) in norm_title(t_name) or norm_title(t_name) in norm_title(target):
                        series_links.append((t_name, h))
        except Exception as e:
            log("UYARI", f"Arama hatası: {e}")
    else:
        try:
            home_html = fetch_url("https://dizikorea3.com/", headers=headers)
            soup = BeautifulSoup(home_html, 'html.parser')
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('-izle' in h or '-dq' in h) and h not in seen:
                    seen.add(h)
                    series_links.append((a.get_text(strip=True), h))
                    if len(series_links) >= limit:
                        break
        except Exception as e:
            log("HATA", f"Ana sayfa alınamadı: {e}")
            return 0, []

    log("KAYIT", f"{len(series_links)} adet Kore/Asya dizisi akışı tespit edildi.")
    synced_items = []
    touched_dramas = set()

    for raw_title, s_url in series_links:
        try:
            s_html = fetch_url(s_url, headers=headers)
            soup = BeautifulSoup(s_html, 'html.parser')

            d_title = soup.find('h1')
            drama_title = d_title.get_text(strip=True) if d_title else raw_title
            drama_title = re.sub(r'\s*(izle|türkçe altyazılı|kore dizisi).*$', '', drama_title, flags=re.I).strip()
            slug_cand = s_url.rstrip('/').split('/')[-1].replace('-izle', '')

            did, drama_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, drama_title, slug_cand,
                content_type='dizi', country_hint='KR', site_tag='dizikorea',
                source_url=s_url, log_fn=log
            )

            ep_anchors = []
            for a in soup.find_all('a', href=True):
                h = a['href']
                if ('bolum' in h or 'bölüm' in a.get_text(strip=True).lower()) and s_url in h:
                    ep_anchors.append((a.get_text(strip=True), h))

            if not ep_anchors:
                ep_anchors = [("1. Bölüm", s_url)]

            anchors_to_scan = ep_anchors if target else ep_anchors[:5]
            for ep_txt, ep_url in anchors_to_scan:
                season_num, ep_num = parse_season_and_episode(ep_url, ep_txt)
                clean_name = clean_episode_title(ep_txt or f"{season_num}. Sezon {ep_num}. Bölüm", season_num, ep_num, drama_title=drama_title)
                ep_id, _ = match_or_create_episode(cur, did, season_num, ep_num, clean_name, ep_url)
                ep_html = fetch_url(ep_url, headers=headers)
                is_ph = page_is_placeholder(ep_html)

                # Match both src and data-src (lazy-load) or anywhere in page for PlayerDKorea & Vidmoly
                dk_matches = re.findall(r'https?://(?:www\.)?playerdkorea\.xyz/video/[a-zA-Z0-9]+', ep_html)
                vm_matches = re.findall(r'https?://(?:www\.)?vidmoly\.[a-z]+/embed-[a-zA-Z0-9]+(?:\.html)?', ep_html)

                sources_found = []
                for u in set(dk_matches):
                    sources_found.append(('dizikorea', 'Orijinal', u))
                for u in set(vm_matches):
                    sources_found.append(('vidmoly', 'Vidmoly', u))

                for prov, sname, direct_u in sources_found:
                    added = add_source(cur, ep_id, sname, direct_u, prov, "dizikorea")
                    if added:
                        touched_dramas.add(did)
                    item_obj = {
                        'id': f"dizikorea-{did}-{season_num}-{ep_num}-{prov}",
                        'title': drama_title,
                        'subtitle': f"{season_num}. Sezon {ep_num}. Bölüm ({sname})",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{ep_num}",
                        'date': datetime.now().isoformat(),
                        'status': 'Canlı Çözüldü' if added else 'Doğrulandı',
                        'sourceName': sname,
                    }
                    if added:
                        safe_commit(conn)
                        log("AKINCI", f'"{drama_title}" -> {season_num}. Sezon {ep_num}. Bölüm ({sname}) eklendi.')
                    else:
                        log("DOĞRULANDI", f'"{drama_title}" -> {season_num}. Sezon {ep_num}. Bölüm ({sname}) güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)

                is_pending = reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                safe_commit(conn)

                if not sources_found:
                    item_obj = {
                        'id': f"dizikorea-{did}-{season_num}-{ep_num}",
                        'title': drama_title,
                        'subtitle': f"{season_num}. Sezon {ep_num}. Bölüm",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{ep_num}",
                        'date': datetime.now().isoformat(),
                        'status': 'Kaynak Bekleniyor (Yakında)',
                        'sourceName': 'DiziKorea',
                    }
                    log("BEKLEMEDE", f'"{drama_title}" -> {season_num}. Sezon {ep_num}. Bölüm kaynak bekleniyor (yakında).')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
        except Exception as err:
            log("HATA", f"{s_url} işlenirken hata: {err}")

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    return len(synced_items), synced_items


# =========================================================================
# SCANNER: DDIZI
# =========================================================================
def scan_ddizi(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "DDizi canlı tarama motoru devrede (https://www.ddizi.tel)...")
    headers = {'Referer': 'https://www.ddizi.tel/'}

    if target:
        log("HEDEF", f"DDizi hedef seri taraması: '{target}'")
        from scrapers.sync_target_drama import sync_ddizi_target
        match = find_in_index(idx, target)
        if match:
            did, dtitle, dslug = match
            cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
            dr = cur.fetchone()
            if dr:
                if isinstance(dr, sqlite3.Row):
                    dr_dict = dict(dr)
                elif isinstance(dr, dict):
                    dr_dict = dr
                else:
                    cols = [d[0] for d in cur.description]
                    dr_dict = dict(zip(cols, dr))
                eps_added, srcs_added = sync_ddizi_target(conn, cur, dr_dict, target_url=target if target.startswith('http') else None)
                sync_drama_bundle_and_counts(conn, cur, did)
                safe_commit(conn)
                return eps_added, []
        return 0, []

    ep_links = []

    try:
        html = fetch_url("https://www.ddizi.tel/yeni-eklenenler8", headers=headers)
        soup = BeautifulSoup(html, 'html.parser')
        seen = set()
        for a in soup.find_all('a', href=True):
            h = a['href']
            t = a.get_text(strip=True)
            if '/izle/' in h and h not in seen:
                seen.add(h)
                full_h = h if h.startswith('http') else f"https://www.ddizi.tel{h}"
                ep_links.append((t, full_h))
                if len(ep_links) >= limit:
                    break
    except Exception as e:
        log("HATA", f"DDizi akışı alınamadı: {e}")
        return 0, []

    log("KAYIT", f"{len(ep_links)} adet yerli dizi bölümü tespit edildi.")
    synced_items = []
    touched_dramas = set()

    for txt, ep_url in ep_links:
        try:
            season_num, ep_num = parse_season_and_episode(ep_url, txt)

            clean_title = re.sub(r'\|\s*ddizi.*$', '', txt, flags=re.I)
            clean_title = re.sub(r'\b\d+\s*\.\s*b[öo]l[üu]m.*$', '', clean_title, flags=re.I).strip()
            if not clean_title:
                clean_title = "Yerli Dizi"
            slug_base = clean_scraped_slug(re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-'))

            did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, clean_title, slug_base,
                content_type='dizi', country_hint='TR', site_tag='ddizi',
                source_url=ep_url, log_fn=log
            )

            clean_name = clean_episode_title(txt or f"{season_num}. Sezon {ep_num}. Bölüm", season_num, ep_num, drama_title=clean_title)
            ep_id, _ = match_or_create_episode(cur, did, season_num, ep_num, clean_name, ep_url)
            ep_html = fetch_url(ep_url, headers=headers)
            is_ph = page_is_placeholder(ep_html)

            # If drama's source_url is an episode URL or missing, resolve to full series page
            try:
                cur.execute("SELECT source_url FROM dramas WHERE id = ?", (did,))
                cur_src = cur.fetchone()
                if not cur_src or not cur_src[0] or '/izle/' in cur_src[0]:
                    ep_soup = BeautifulSoup(ep_html, 'html.parser')
                    for a_tag in ep_soup.find_all('a', href=True):
                        h_dizi = a_tag['href']
                        t_dizi = (a_tag.get_text(strip=True) + ' ' + a_tag.get('title', '')).lower()
                        if '/diziler/' in h_dizi and ('dizi sayfasina git' in t_dizi or clean_title.lower() in t_dizi):
                            full_dizi_u = h_dizi if h_dizi.startswith('http') else f"https://www.ddizi.tel{h_dizi}"
                            cur.execute("UPDATE dramas SET source_url = ?, updated_at = datetime('now') WHERE id = ?", (full_dizi_u, did))
                            safe_commit(conn)
                            break
            except Exception:
                pass

            # Automatic Gap Detection: If latest episode is > 1 and DB doesn't have all episodes, backfill!
            try:
                cur.execute("SELECT MIN(episode_number), MAX(episode_number), COUNT(*) FROM episodes WHERE drama_id = ?", (did,))
                m_row = cur.fetchone()
                if m_row and m_row[1] and (m_row[0] > 1 or (m_row[1] - m_row[0] + 1) > m_row[2]):
                    log("BOŞLUK TESPİTİ", f"'{clean_title}' için eksik bölümler tespit edildi (Min: {m_row[0]}, Max: {m_row[1]}, Sayı: {m_row[2]}). Tam seri taranıyor...")
                    from scrapers.sync_target_drama import sync_ddizi_target
                    cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
                    dr_full = cur.fetchone()
                    if dr_full:
                        if isinstance(dr_full, sqlite3.Row):
                            dr_dict = dict(dr_full)
                        elif isinstance(dr_full, dict):
                            dr_dict = dr_full
                        else:
                            cols = [d[0] for d in cur.description]
                            dr_dict = dict(zip(cols, dr_full))
                        sync_ddizi_target(conn, cur, dr_dict)
            except Exception as e_gap:
                log("BOŞLUK UYARISI", f"Boşluk taraması uyarısı: {e_gap}")

            # DDizi: Prioritize full player stream (/player/oynat/) over YouTube trailers
            m_p = re.search(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
            source_obj = None
            is_fragman = bool(re.search(r'fragman', txt or '', re.I) or re.search(r'fragman', ep_url, re.I))

            if m_p:
                p_url = f"https://www.ddizi.tel{m_p.group(1)}"
                p_html = fetch_url(p_url, headers={'Referer': ep_url})
                m3u8_m = re.search(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                if m3u8_m:
                    hls_u = m3u8_m.group(1).replace('\\/', '/')
                    source_obj = ("Orijinal", hls_u, "ddizi")
                    cur.execute("DELETE FROM episode_sources WHERE episode_id = ? AND provider = 'youtube'", (ep_id,))
                else:
                    mp4_b64 = re.search(r'file:\s*["\']([^"\']*/player/mp4/[a-zA-Z0-9=+/]+(?:\.mp4)?)["\']', p_html)
                    if mp4_b64:
                        try:
                            b64_part = mp4_b64.group(1).split('/player/mp4/')[-1].replace('.mp4', '').strip()
                            decoded = base64.b64decode(b64_part).decode('utf-8', errors='ignore')
                            if decoded.startswith('http'):
                                source_obj = ("Orijinal", decoded, "ddizi")
                                cur.execute("DELETE FROM episode_sources WHERE episode_id = ? AND provider = 'youtube'", (ep_id,))
                        except Exception:
                            pass
                if not source_obj:
                    yt_thumb = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
                    if yt_thumb and not is_fragman:
                        yt_id = yt_thumb.group(1)
                        source_obj = ("YouTube HD", f"https://www.youtube.com/embed/{yt_id}?autoplay=1&enablejsapi=1", "youtube")

            if not source_obj and not is_fragman:
                m_yt_php = re.search(r'youtube\.php\?id=([a-zA-Z0-9_\-]+)', ep_html)
                if m_yt_php:
                    v_id = m_yt_php.group(1)
                    source_obj = ("YouTube HD", f"https://www.youtube.com/embed/{v_id}?autoplay=1&enablejsapi=1", "youtube")
                if not source_obj:
                    m_og = re.search(r'og:video["\']\s*content=["\']https?://(?:www\.)?youtube\.com/watch\?v=([a-zA-Z0-9_\-]+)', ep_html)
                    if m_og:
                        v_id = m_og.group(1)
                        source_obj = ("YouTube HD", f"https://www.youtube.com/embed/{v_id}?autoplay=1&enablejsapi=1", "youtube")
                if not source_obj:
                    yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
                    if yt_match:
                        raw_yt = yt_match.group(1)
                        v_id = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt).group(1)
                        source_obj = ("YouTube HD", f"https://www.youtube.com/embed/{v_id}?autoplay=1&enablejsapi=1", "youtube")

            if is_fragman and not source_obj:
                is_ph = True

            added = False
            if source_obj:
                sname, surl, sprov = source_obj
                # If provider is ddizi and direct_url contains tokenized m3u8, check if ddizi source already exists
                cur.execute("SELECT id, direct_url FROM episode_sources WHERE episode_id = ? AND provider = 'ddizi'", (ep_id,))
                existing_ddizi = cur.fetchone()
                if existing_ddizi and sprov == 'ddizi':
                    # Refresh tokenized URL without treating as new addition
                    if existing_ddizi[1] != surl:
                        cur.execute("UPDATE episode_sources SET direct_url = ? WHERE id = ?", (surl, existing_ddizi[0]))
                        safe_commit(conn)
                    added = False
                else:
                    added = add_source(cur, ep_id, sname, surl, sprov, "ddizi")

                if added:
                    touched_dramas.add(did)
                    safe_commit(conn)
                    log("AKINCI", f'"{clean_title}" -> {season_num}. Sezon {ep_num}. Bölüm ({sname}) eklendi.')
                else:
                    log("DOĞRULANDI", f'"{clean_title}" -> {season_num}. Sezon {ep_num}. Bölüm ({sname}) güncel.')

                item_obj = {
                    'id': f"ddizi-{did}-{season_num}-{ep_num}",
                    'title': clean_title,
                    'subtitle': f"{season_num}. Sezon {ep_num}. Bölüm ({sname})",
                    'image': cover_img,
                    'link': f"/seri/{drama_slug}/{ep_num}",
                    'date': datetime.now().isoformat(),
                    'status': 'Canlı Çözüldü' if added else 'Doğrulandı',
                    'sourceName': sname,
                }
                emit_live_item(item_obj)
                synced_items.append(item_obj)

            is_pending = reconcile_episode(cur, ep_id, is_placeholder=is_ph)
            safe_commit(conn)
            if not source_obj:
                item_obj = {
                    'id': f"ddizi-{did}-{season_num}-{ep_num}",
                    'title': clean_title,
                    'subtitle': f"{season_num}. Sezon {ep_num}. Bölüm",
                    'image': cover_img,
                    'link': f"/seri/{drama_slug}/{ep_num}",
                    'date': datetime.now().isoformat(),
                    'status': 'Kaynak Bekleniyor (Yakında)',
                    'sourceName': 'DDizi',
                }
                log("BEKLEMEDE", f'"{clean_title}" -> {season_num}. Sezon {ep_num}. Bölüm kaynak bekleniyor (yakında).')
                emit_live_item(item_obj)
                synced_items.append(item_obj)
        except Exception as err:
            log("HATA", f"{ep_url} işlenirken hata: {err}")

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    return len(synced_items), synced_items

# =========================================================================
# SCANNER: ANIMECIX
# =========================================================================
def clean_animecix_provider(name: str, url: str) -> str:
    url_low = (url or '').lower()
    name_low = (name or '').lower()
    if 'tau-video' in url_low or 'tau-video' in name_low or 'tau' in name_low:
        return 'tau-video'
    if 'sibnet.ru' in url_low:
        return 'sibnet'
    if 'ok.ru' in url_low or 'odnoklassniki' in url_low:
        return 'ok.ru'
    if 'drive.google.com' in url_low:
        return 'googledrive'
    if 'mega.nz' in url_low:
        return 'mega'
    if 'dailymotion.com' in url_low:
        return 'dailymotion'
    if 'dood' in url_low:
        return 'doodstream'
    if 'uqload' in url_low:
        return 'uqload'
    if 'mp4upload' in url_low:
        return 'mp4upload'
    if 'sendvid' in url_low:
        return 'sendvid'
    if 'mail.ru' in url_low:
        return 'mail.ru'
    if name_low:
        return name_low.replace(' ', '')
    return 'embed'

def fetch_animecix_json(endpoint: str, qs: str, retries: int = 3):
    url = f"https://animecix.tv/secure/{endpoint}?{qs}"
    for attempt in range(retries):
        try:
            h = make_animecix_header(qs)
            headers = {
                'X-E-H': h,
                'Accept': 'application/json',
                'Referer': 'https://animecix.tv/',
                'Origin': 'https://animecix.tv',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            }
            try:
                from curl_cffi import requests as cffi_requests
                resp = cffi_requests.get(url, headers=headers, impersonate='chrome120', timeout=15)
                if resp.status_code == 200:
                    return resp.json()
            except ImportError:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            if attempt == retries - 1:
                log("UYARI", f"AnimeciX API isteği başarısız ({endpoint}): {e}")
            time.sleep(0.5)
    return None

def scan_animecix(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "AnimeciX canlı tarama motoru devrede...")
    synced_items = []
    touched_dramas = set()

    # 1. Target mode (Live search & ingest by title name or title ID)
    if target and ANIMECIX_AES:
        log("ARAMA", f'AnimeciX üzerinde aranıyor: "{target}"')
        target_titles = []

        if str(target).strip().isdigit():
            target_titles.append({'id': int(str(target).strip()), 'name': f"AnimeciX #{target}"})
        else:
            q_enc = urllib.parse.quote(target.strip())
            qs = f"query={q_enc}&onlyStreamable=true&page=1&perPage=5"
            data = fetch_animecix_json("titles", qs)
            if data and 'pagination' in data:
                target_titles = data['pagination'].get('data', [])

        log("KAYIT", f"{len(target_titles)} adet AnimeciX anime başlığı bulundu.")

        for t_item in target_titles:
            title_id = t_item.get('id')
            raw_name = t_item.get('name') or target
            clean_title = re.sub(r'[\-_]?(anime|izle|\d{1,4})+$', '', raw_name, flags=re.I).strip()
            slug_cand = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')

            did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, clean_title, slug_cand,
                content_type='anime', country_hint='JP', site_tag='animecix',
                year_hint=t_item.get('year'), log_fn=log
            )
            touched_dramas.add(did)

            page = 1
            added_for_title = 0
            while page <= 25:
                v_qs = f"titleId={title_id}&page={page}&perPage=100"
                v_data = fetch_animecix_json("videos", v_qs)
                if not v_data or 'pagination' not in v_data:
                    break
                videos = v_data['pagination'].get('data', [])
                if not videos:
                    break

                for v in videos:
                    v_url = (v.get('url') or '').strip()
                    if not v_url:
                        continue
                    v_low = v_url.lower()
                    if any(dead in v_low for dead in ['sibnet.ru', 'sibnet', 'sendvid', 'drive.google.com', 'docs.google.com', 'dood', 'short.icu']):
                        continue

                    prov = clean_animecix_provider(v.get('name'), v_url)
                    s_num = v.get('season_num') or 1
                    e_num = v.get('episode_num') or 1
                    ep_url = f"https://animecix.tv/titles/{title_id}/season/{s_num}/episode/{e_num}"

                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                    s_name = clean_source_name(v.get('name') or ('Tau-Video' if prov == 'tau-video' else 'Orijinal'))
                    clean_extra = clean_fansub_name(v.get('extra'))
                    if add_source(cur, ep_id, s_name, v_url, prov, 'animecix', fansub=clean_extra):
                        added_for_title += 1
                        log("AKINCI", f'"{clean_title}" -> {s_num}. Sezon {e_num}. Bölüm ({s_name}) eklendi.')
                        if len(synced_items) < limit:
                            item_obj = {
                                'id': f"animecix-{did}-{s_num}-{e_num}-{prov}",
                                'title': clean_title,
                                'subtitle': f"{s_num}. Sezon {e_num}. Bölüm ({s_name})",
                                'image': cover_img,
                                'link': f"/seri/{drama_slug}/{e_num}",
                                'date': datetime.now().isoformat(),
                                'status': 'Tau-Video Canlı Eklendi',
                                'sourceName': s_name,
                            }
                            emit_live_item(item_obj)
                            synced_items.append(item_obj)
                    reconcile_episode(cur, ep_id)

                if page >= v_data['pagination'].get('last_page', 1):
                    break
                page += 1

            if added_for_title > 0:
                safe_commit(conn)
                sync_drama_bundle_and_counts(conn, cur, did)

        if synced_items:
            log("TAMAMLANDI", f"AnimeciX hedef tarama tamamlandı: +{len(synced_items)} yeni akış.")
            return len(synced_items), synced_items

    # 2. Live Latest Episodes Feed from AnimeciX API
    if not target and ANIMECIX_AES:
        try:
            log("TARAMA", f"AnimeciX son eklenen bölümler çekiliyor (limit: {limit})...")
            latest_data = fetch_animecix_json("last-episodes", f"page=1&perPage={min(max(limit, 15), 35)}")
            ep_items = latest_data.get('data', []) if isinstance(latest_data, dict) else []
            for ep_item in ep_items[:limit]:
                title_id = ep_item.get('title_id')
                raw_name = (ep_item.get('title_name') or '').strip()
                if not title_id or not raw_name:
                    continue
                clean_title = re.sub(r'[\-_]?(anime|izle|\d{1,4})+$', '', raw_name, flags=re.I).strip()
                slug_cand = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')
                s_num = ep_item.get('season_number') or 1
                e_num = ep_item.get('episode_number') or 1
                videos = ep_item.get('videos') or []
                if not videos:
                    continue

                did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                    conn, cur, idx, clean_title, slug_cand,
                    content_type='anime', country_hint='JP', site_tag='animecix',
                    log_fn=log
                )
                ep_url = f"https://animecix.tv/titles/{title_id}/season/{s_num}/episode/{e_num}"
                ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                ep_added = False
                for v in videos:
                    v_url = (v.get('url') or '').strip()
                    if not v_url:
                        continue
                    v_low = v_url.lower()
                    if any(dead in v_low for dead in ['sibnet.ru', 'sibnet', 'sendvid', 'drive.google.com', 'docs.google.com', 'dood', 'short.icu']):
                        continue
                    prov = clean_animecix_provider(v.get('name'), v_url)
                    s_name = clean_source_name(v.get('name') or ('Tau-Video' if prov == 'tau-video' else 'Orijinal'))
                    clean_extra = clean_fansub_name(v.get('extra'))
                    if add_source(cur, ep_id, s_name, v_url, prov, 'animecix', fansub=clean_extra):
                        ep_added = True
                        touched_dramas.add(did)
                        log("AKINCI", f'"{clean_title}" -> {s_num}. Sezon {e_num}. Bölüm ({s_name}) eklendi.')
                reconcile_episode(cur, ep_id)
                item_obj = {
                    'id': f"animecix-{did}-{s_num}-{e_num}",
                    'title': clean_title,
                    'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (Tau-Video)",
                    'image': cover_img or ep_item.get('title_poster') or '/logo-dark.png',
                    'link': f"/seri/{drama_slug}/{e_num}",
                    'date': datetime.now().isoformat(),
                    'status': 'Tau-Video Canlı Eklendi' if ep_added else 'Doğrulandı',
                    'sourceName': 'Tau-Video',
                }
                if not ep_added:
                    log("DOĞRULANDI", f'"{clean_title}" -> {s_num}. Sezon {e_num}. Bölüm (Tau-Video) güncel.')
                emit_live_item(item_obj)
                synced_items.append(item_obj)

            if touched_dramas:
                safe_commit(conn)
                for did in touched_dramas:
                    sync_drama_bundle_and_counts(conn, cur, did)
            if synced_items:
                log("TAMAMLANDI", f"AnimeciX canlı tarama tamamlandı: {len(synced_items)} bölüm işlendi.")
                return len(synced_items), synced_items
        except Exception as e:
            log("UYARI", f"AnimeciX canlı son bölümler tarama uyarısı: {e}")

    # 3. Database view fallback (Verification of recent active Tau-Video streams)
    log("SİSTEM", "AnimeciX Tau-Video ve güncel akışlar doğrulanıyor...")
    cur.execute("""
        SELECT es.id, d.title, d.slug, e.season_number, e.episode_number, es.source_name, es.direct_url, d.cover_image
        FROM episode_sources es
        JOIN episodes e ON es.episode_id = e.id
        JOIN dramas d ON e.drama_id = d.id
        WHERE es.site = 'animecix' OR es.provider = 'tau-video'
        ORDER BY es.id DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()

    for r in rows:
        item_obj = {
            'id': f"animecix-{r[0]}",
            'title': r[1],
            'subtitle': f"{r[3]}. Sezon {r[4]}. Bölüm (Tau-Video)",
            'image': r[7] or '/logo-dark.png',
            'link': f"/seri/{r[2]}/{r[4]}",
            'date': datetime.now().isoformat(),
            'status': 'Aktif Akış',
            'sourceName': 'Orijinal',
        }
        log("DOĞRULANDI", f'"{r[1]}" -> {r[3]}. Sezon {r[4]}. Bölüm (Tau-Video) doğrulandı.')
        emit_live_item(item_obj)
        synced_items.append(item_obj)
    log("TAMAMLANDI", f"AnimeciX {len(synced_items)} adet güncel Tau-Video akışı doğrulandı.")
    return len(synced_items), synced_items


# =========================================================================
# SCANNER: HDFILM (Direct Inner HLS Only)
# =========================================================================
def scan_hdfilm(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "HDFilmcehennemi canlı tarama motoru devrede (Doğrudan HLS Çözücü)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.hdfilmcehennemi.nl/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    }
    synced_items = []
    touched_dramas = set()

    # 1. Target mode (Search by query or direct URL)
    if target:
        log("ARAMA", f'HDFilmcehennemi üzerinde aranıyor: "{target}"')
        target_links = []
        if target.startswith("http"):
            target_links.append((target, "Hedef Bağlantı", "/logo-dark.png", str(datetime.now().year)))
        else:
            try:
                q = urllib.parse.quote(target.strip())
                search_url = f"https://www.hdfilmcehennemi.nl/search?q={q}"
                raw_json = fetch_url(search_url, headers={
                    **headers,
                    'X-Requested-With': 'fetch',
                    'Content-Type': 'application/json',
                })
                data = json.loads(raw_json)
                for r_html in data.get('results', []):
                    bs = BeautifulSoup(r_html, 'html.parser')
                    a = bs.find('a', href=True)
                    if a:
                        t_node = bs.find('h4', class_='title') or bs.find(class_='title')
                        title_txt = t_node.get_text(strip=True) if t_node else a.get_text(strip=True)
                        img_node = bs.find('img')
                        img_src = img_node.get('src') if img_node and img_node.get('src') else '/logo-dark.png'
                        y_node = bs.find('span', class_='year')
                        year_val = y_node.get_text(strip=True) if y_node else str(datetime.now().year)
                        target_links.append((a['href'], title_txt, img_src, year_val))
            except Exception as e:
                log("UYARI", f"Arama hatası: {e}")

        log("KAYIT", f"{len(target_links)} adet arama sonucu bulundu.")
        for item_url, item_title, item_img, item_year in target_links[:limit]:
            try:
                yr_int = int(item_year) if str(item_year).isdigit() else None
                if '/dizi/' in item_url:
                    s_html = fetch_url(item_url, headers=headers)
                    soup = BeautifulSoup(s_html, 'html.parser')
                    slug_cand = clean_scraped_slug(item_url.rstrip('/').split('/')[-1])

                    did, t, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, item_title, slug_cand,
                        content_type='dizi', country_hint='US', site_tag='hdfilm',
                        source_url=item_url, year_hint=yr_int, log_fn=log
                    )
                    touched_dramas.add(did)

                    ep_links = []
                    seen = set()
                    for a in soup.find_all('a', href=True):
                        h = a['href']
                        if '/dizi/' in h and ('/sezon-' in h and '/bolum-' in h):
                            if h not in seen:
                                seen.add(h)
                                m = re.search(r'/sezon-(\d+)/bolum-(\d+)', h)
                                if m:
                                    ep_links.append((int(m.group(1)), int(m.group(2)), h))
                    ep_links.sort(key=lambda x: (x[0], x[1]))
                    links_to_scan = ep_links if target else ep_links[:5]
                    for s_num, e_num, ep_url in links_to_scan:
                        ep_html = fetch_url(ep_url, headers={'Referer': item_url})
                        is_ph = page_is_placeholder(ep_html)
                        streams = resolve_hdfilm_streams(ep_url, ep_html)
                        ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                        for sname, surl, sprov, ssite in streams:
                            added = add_source(cur, ep_id, sname, surl, sprov, ssite)
                            item_obj = {
                                'id': f"hdfilm-{did}-{s_num}-{e_num}-{sprov}",
                                'title': t,
                                'subtitle': f"{s_num}. Sezon {e_num}. Bölüm ({sname})",
                                'image': cover_img,
                                'link': f"/seri/{drama_slug}/{e_num}",
                                'date': datetime.now().isoformat(),
                                'status': 'Doğrudan HLS Çözüldü' if added else 'Doğrulandı',
                                'sourceName': sname,
                            }
                            if added:
                                safe_commit(conn)
                                log("AKINCI", f'"{t}" -> S{s_num}B{e_num} ({sname} Doğrudan HLS) bağlandı.')
                            else:
                                log("DOĞRULANDI", f'"{t}" -> S{s_num}B{e_num} ({sname}) güncel.')
                            emit_live_item(item_obj)
                            synced_items.append(item_obj)
                        reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                        safe_commit(conn)
                else:
                    m_html = fetch_url(item_url, headers=headers)
                    slug_cand = clean_scraped_slug(item_url.rstrip('/').split('/')[-1])

                    did, t, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, item_title, slug_cand,
                        content_type='film', country_hint='US', site_tag='hdfilm',
                        source_url=item_url, year_hint=yr_int, log_fn=log
                    )
                    touched_dramas.add(did)

                    streams = resolve_hdfilm_streams(item_url, m_html)
                    ep_id, _ = match_or_create_episode(cur, did, 1, 1, "Film", item_url)
                    for sname, surl, sprov, ssite in streams:
                        added = add_source(cur, ep_id, sname, surl, sprov, ssite)
                        item_obj = {
                            'id': f"hdfilm-{did}-film-{sprov}",
                            'title': t,
                            'subtitle': f"Film ({sname})",
                            'image': cover_img,
                            'link': f"/seri/{drama_slug}/1",
                            'date': datetime.now().isoformat(),
                            'status': 'Doğrudan HLS Çözüldü' if added else 'Doğrulandı',
                            'sourceName': sname,
                        }
                        if added:
                            safe_commit(conn)
                            log("AKINCI", f'"{t}" -> Film ({sname} Doğrudan HLS) bağlandı.')
                        else:
                            log("DOĞRULANDI", f'"{t}" -> Film ({sname}) güncel.')
                        emit_live_item(item_obj)
                        synced_items.append(item_obj)
                    reconcile_episode(cur, ep_id, is_placeholder=page_is_placeholder(m_html))
                    safe_commit(conn)
            except Exception as err:
                log("HATA", f"{item_url} işlenirken hata: {err}")

    # 2. Live scan mode (Latest TV Series & Movies from HDFilmcehennemi)
    else:
        log("TARAMA", "HDFilmcehennemi güncel dizi bölümleri ve filmler taranıyor...")
        try:
            dizi_html = fetch_url("https://www.hdfilmcehennemi.nl/yabancidiziizle-5/", headers=headers)
            soup = BeautifulSoup(dizi_html, 'html.parser')
            ep_candidates = []
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('/sezon-' in h and '/bolum-' in h) and h not in seen:
                    seen.add(h)
                    t = a.get_text(strip=True)
                    ep_candidates.append((t, h))
                    if len(ep_candidates) >= limit:
                        break

            log("KAYIT", f"{len(ep_candidates)} adet güncel yabancı dizi bölümü bulundu.")
            for ep_title, ep_url in ep_candidates:
                try:
                    m = re.search(r'/dizi/([^/]+)/sezon-(\d+)/bolum-(\d+)', ep_url)
                    if not m:
                        continue
                    slug_cand = m.group(1)
                    s_num = int(m.group(2))
                    e_num = int(m.group(3))

                    raw_t = re.sub(r'^\d+\.\s*Sezon\s*\d+\.\s*B[öo]l[üu]m\s*', '', ep_title, flags=re.I)
                    raw_t = re.sub(r'\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}.*$', '', raw_t).strip()
                    clean_title = raw_t if raw_t else re.sub(r'[\-_]?(dizi|hdfc|izle|\d{1,4})+$', '', slug_cand, flags=re.I).replace('-', ' ').strip().title()

                    did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, clean_title, slug_cand,
                        content_type='dizi', country_hint='US', site_tag='hdfilm',
                        source_url=ep_url, log_fn=log
                    )
                    touched_dramas.add(did)

                    ep_html = fetch_url(ep_url, headers=headers)
                    is_ph = page_is_placeholder(ep_html)
                    streams = resolve_hdfilm_streams(ep_url, ep_html)
                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                    for sname, surl, sprov, ssite in streams:
                        added = add_source(cur, ep_id, sname, surl, sprov, ssite)
                        item_obj = {
                            'id': f"hdfilm-{did}-{s_num}-{e_num}-{sprov}",
                            'title': clean_title,
                            'subtitle': f"{s_num}. Sezon {e_num}. Bölüm ({sname})",
                            'image': cover_img,
                            'link': f"/seri/{drama_slug}/{e_num}",
                            'date': datetime.now().isoformat(),
                            'status': 'Doğrudan HLS Çözüldü' if added else 'Doğrulandı',
                            'sourceName': sname,
                        }
                        if added:
                            safe_commit(conn)
                            log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} ({sname} Doğrudan HLS) bağlandı.')
                        else:
                            log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} ({sname}) güncel.')
                        emit_live_item(item_obj)
                        synced_items.append(item_obj)
                    reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                    safe_commit(conn)
                except Exception as err:
                    log("HATA", f"{ep_url} çözümlenirken hata: {err}")

        except Exception as e:
            log("HATA", f"HDFilmcehennemi canlı tarama hatası: {e}")

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    log("TAMAMLANDI", f"HDFilmcehennemi işlemi tamamlandı: {len(synced_items)} doğrudan HLS akış işlendi.")
    return len(synced_items), synced_items


# =========================================================================
# SCANNER: ASYAWATCH
# =========================================================================
def scan_asyawatch(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "AsyaWatch canlı tarama motoru devrede (https://asyawatch.com)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://asyawatch.com/',
        'Origin': 'https://asyawatch.com',
        'Accept': 'application/json, text/plain, */*',
    }
    synced_items = []
    touched_dramas = set()
    build_id = "roDxiuBEE4QePAtjVppYK"

    if target:
        log("ARAMA", f'AsyaWatch üzerinde aranıyor: "{target}"')
        target_slug = re.sub(r'[^a-z0-9]+', '-', target.lower()).strip('-').replace('-izle', '')

        try:
            url = f"https://asyawatch.com/_next/data/{build_id}/dizi/{target_slug}.json"
            raw_text = fetch_url(url, headers=headers)
            data = json.loads(raw_text)
            sec = data.get('pageProps', {}).get('secureData')
            parsed = json.loads(base64.b64decode(sec).decode('utf-8'))

            ci = parsed.get('contentItem', {})
            clean_title = ci.get('original_title') or target
            year = ci.get('release_year') or datetime.now().year

            did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, clean_title, target_slug,
                content_type='dizi', country_hint='KR', site_tag='asyawatch',
                source_url=f"https://asyawatch.com/dizi/{target_slug}", year_hint=year, log_fn=log
            )
            touched_dramas.add(did)

            season_results = parsed.get('RelatedResults', {}).get('getSerieSeasonAndEpisodes', {}).get('result', [])
            flat_eps = []
            for s in season_results:
                if isinstance(s, dict) and 'episodes' in s:
                    flat_eps.extend(s['episodes'])
                else:
                    flat_eps.append(s)
            log("BÖLÜMLER", f'"{clean_title}" için {len(flat_eps)} bölüm bulundu. Kaynaklar taranıyor...')

            eps_to_scan = flat_eps if target else flat_eps[:limit]
            for ep in eps_to_scan:
                s_num = ep.get('season_no') if ep.get('season_no') is not None else 1
                e_num = ep.get('episode_no') if ep.get('episode_no') is not None else 1
                ep_text = ep.get('episode_text') or f"{s_num}. Sezon {e_num}. Bölüm"
                ep_slug = ep.get('used_slug', f"dizi/{target_slug}/sezon-{s_num}/bolum-{e_num}")
                ep_page_url = f"https://asyawatch.com/{ep_slug.lstrip('/')}"

                try:
                    ep_json_url = f"https://asyawatch.com/_next/data/{build_id}/{ep_slug.lstrip('/')}.json"
                    edata = json.loads(fetch_url(ep_json_url, headers=headers))
                    esec = json.loads(base64.b64decode(edata['pageProps']['secureData']).decode('utf-8'))
                    esources = esec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])

                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, ep_text, ep_page_url)
                    for s in esources:
                        s_content = s.get('source_content', '')
                        m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                        if m_iframe:
                            embed_url = m_iframe.group(1)
                            if embed_url.startswith('//'):
                                embed_url = 'https:' + embed_url

                            added = add_source(cur, ep_id, 'Asyawatch (1080p)', embed_url, 'asyawatch', 'asyawatch')
                            item_obj = {
                                'id': f"asyawatch-{did}-{s_num}-{e_num}",
                                'title': clean_title,
                                'subtitle': f"{ep_text} (Asyawatch 1080p)",
                                'image': cover_img,
                                'link': f"/seri/{drama_slug}/{e_num}",
                                'date': datetime.now().isoformat(),
                                'status': '1080p HLS Bağlandı' if added else 'Doğrulandı',
                                'sourceName': 'Asyawatch',
                            }
                            if added:
                                safe_commit(conn)
                                log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} Asyawatch (1080p) bağlandı.')
                            else:
                                log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} Asyawatch (1080p) güncel.')
                            emit_live_item(item_obj)
                            synced_items.append(item_obj)
                    reconcile_episode(cur, ep_id)
                    safe_commit(conn)
                except Exception as e:
                    log("HATA", f"Bölüm {ep_slug} hatası: {e}")
        except Exception as e:
            log("HATA", f"AsyaWatch hedef arama hatası: {e}")
    else:
        log("TARAMA", "AsyaWatch son eklenen bölümler canlı taranıyor...")
        try:
            idx_url = f"https://asyawatch.com/_next/data/{build_id}/index.json"
            idx_data = json.loads(fetch_url(idx_url, headers=headers, timeout=10))
            idx_sec = idx_data.get('pageProps', {}).get('secureData')
            idx_parsed = json.loads(base64.b64decode(idx_sec).decode('utf-8')) if idx_sec else {}
            feed_eps = (idx_parsed.get('getEpisodesOnBrandAll') or []) + (idx_parsed.get('getEpisodesOnNewSeries') or [])
            seen_ep_slugs = set()
            for ep in feed_eps:
                if len(synced_items) >= min(limit, 12):
                    break
                ep_slug = ep.get('episode_used_slug') or ep.get('used_slug')
                raw_title = (ep.get('original_title') or ep.get('culture_title') or '').strip()
                if not ep_slug or not raw_title or ep_slug in seen_ep_slugs:
                    continue
                seen_ep_slugs.add(ep_slug)
                s_num = ep.get('season_no') or 1
                e_num = ep.get('episode_no') or 1
                m_s = re.search(r'dizi/([^/]+)', ep_slug)
                s_slug = m_s.group(1) if m_s else re.sub(r'[^a-z0-9]+', '-', raw_title.lower()).strip('-')
                try:
                    ep_json_url = f"https://asyawatch.com/_next/data/{build_id}/{ep_slug}.json"
                    edata = json.loads(fetch_url(ep_json_url, headers=headers, timeout=8))
                    esec = json.loads(base64.b64decode(edata['pageProps']['secureData']).decode('utf-8'))
                    esources = esec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                    if not esources:
                        continue
                    did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, raw_title, s_slug,
                        content_type='dizi', country_hint='KR', site_tag='asyawatch',
                        source_url=f"https://asyawatch.com/dizi/{s_slug}", log_fn=log
                    )
                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://asyawatch.com/{ep_slug}")
                    any_added = False
                    for s in esources:
                        s_content = s.get('source_content', '')
                        m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                        if m_iframe:
                            embed_url = m_iframe.group(1)
                            if embed_url.startswith('//'):
                                embed_url = 'https:' + embed_url
                            if add_source(cur, ep_id, 'Asyawatch (1080p)', embed_url, 'asyawatch', 'asyawatch'):
                                any_added = True
                                touched_dramas.add(did)
                                log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} Asyawatch (1080p) bağlandı.')
                    reconcile_episode(cur, ep_id)
                    safe_commit(conn)
                    item_obj = {
                        'id': f"asyawatch-{did}-{s_num}-{e_num}",
                        'title': clean_title,
                        'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (Asyawatch 1080p)",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{e_num}",
                        'date': datetime.now().isoformat(),
                        'status': '1080p HLS Bağlandı' if any_added else 'Doğrulandı',
                        'sourceName': 'Asyawatch',
                    }
                    if not any_added:
                        log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} Asyawatch (1080p) güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
                except Exception:
                    continue
        except Exception as e:
            log("UYARI", f"AsyaWatch canlı akış tarama uyarısı: {e}")
        log("TARAMA", "AsyaWatch güncel akışları doğrulanıyor...")
        cur.execute("""
            SELECT es.id, d.title, d.slug, e.season_number, e.episode_number, es.source_name, es.direct_url, d.cover_image
            FROM episode_sources es
            JOIN episodes e ON es.episode_id = e.id
            JOIN dramas d ON e.drama_id = d.id
            WHERE es.site = 'asyawatch' OR es.provider = 'asyawatch'
            ORDER BY es.id DESC
            LIMIT ?
        """, (limit,))
        for r in cur.fetchall():
            item_obj = {
                'id': f"asyawatch-{r[0]}",
                'title': r[1],
                'subtitle': f"{r[3]}. Sezon {r[4]}. Bölüm ({r[5]})",
                'image': r[7] or '/logo-dark.png',
                'link': f"/seri/{r[2]}/{r[4]}",
                'date': datetime.now().isoformat(),
                'status': 'Aktif 1080p Akış',
                'sourceName': r[5],
            }
            log("DOĞRULANDI", f'"{r[1]}" -> {r[3]}. Sezon {r[4]}. Bölüm ({r[5]}) doğrulandı.')
            emit_live_item(item_obj)
            synced_items.append(item_obj)

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    log("TAMAMLANDI", f"AsyaWatch işlemi tamamlandı: {len(synced_items)} adet akış hazır.")
    return len(synced_items), synced_items


# =========================================================================
# SCANNER: DIZILLA
# =========================================================================
def scan_dizilla(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "Dizilla canlı tarama motoru devrede (https://dizilla.now)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://dizilla.now/',
        'Origin': 'https://dizilla.now',
        'Accept': 'application/json, text/plain, */*',
    }
    synced_items = []
    touched_dramas = set()
    build_id = "SMdJuCNMmz-cwhEqAI8Eb"

    if target:
        log("ARAMA", f'Dizilla üzerinde aranıyor: "{target}"')
        target_slug = re.sub(r'[^a-z0-9]+', '-', target.lower()).strip('-').replace('-izle', '')

        try:
            url = f"https://dizilla.now/_next/data/{build_id}/dizi/{target_slug}.json"
            data = json.loads(fetch_url(url, headers=headers))
            sec = data.get('pageProps', {}).get('secureData')

            h = hashlib.sha256(b'!!22xx!!90!!').digest()
            b64 = base64.b64encode(h).decode('ascii')
            key = b64[:32].encode('utf-8')
            iv = bytes(16)
            raw_data = base64.b64decode(sec)
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            dec = cipher.decryptor()
            decrypted = dec.update(raw_data) + dec.finalize()
            pad_len = decrypted[-1]
            parsed = json.loads(decrypted[:-pad_len].decode('utf-8'))

            ci = parsed.get('contentItem', {})
            clean_title = ci.get('original_title') or target
            year = ci.get('release_year') or datetime.now().year

            did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                conn, cur, idx, clean_title, target_slug,
                content_type='dizi', country_hint='US', site_tag='dizilla',
                source_url=f"https://dizilla.now/dizi/{target_slug}", year_hint=year, log_fn=log
            )
            touched_dramas.add(did)

            season_results = parsed.get('RelatedResults', {}).get('getSerieSeasonAndEpisodes', {}).get('result', [])
            flat_eps = []
            for s in season_results:
                if isinstance(s, dict) and 'episodes' in s:
                    flat_eps.extend(s['episodes'])
                else:
                    flat_eps.append(s)
            log("BÖLÜMLER", f'"{clean_title}" için {len(flat_eps)} bölüm bulundu. Kaynaklar taranıyor...')

            eps_to_scan = flat_eps if target else flat_eps[:limit]
            for ep in eps_to_scan:
                s_num = ep.get('season_no', 1) or 1
                e_num = ep.get('episode_no', 1) or 1
                ep_slug = ep.get('used_slug', f"{target_slug}-{s_num}-sezon-{e_num}-bolum")
                ep_page_url = f"https://dizilla.now/{ep_slug}"

                try:
                    ep_json_url = f"https://dizilla.now/_next/data/{build_id}/{ep_slug}.json"
                    edata = json.loads(fetch_url(ep_json_url, headers=headers))
                    esec = edata.get('pageProps', {}).get('secureData')
                    raw_edata = base64.b64decode(esec)
                    edec = cipher.decryptor().update(raw_edata) + cipher.decryptor().finalize()
                    ep_parsed = json.loads(edec[:-edec[-1]].decode('utf-8'))
                    esources = ep_parsed.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])

                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_page_url)
                    for s in esources:
                        s_content = s.get('source_content', '')
                        m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                        if m_iframe:
                            embed_url = m_iframe.group(1)
                            if embed_url.startswith('//'):
                                embed_url = 'https:' + embed_url

                            added = add_source(cur, ep_id, 'Dizilla (1080p)', embed_url, 'dizilla', 'dizilla')
                            item_obj = {
                                'id': f"dizilla-{did}-{s_num}-{e_num}",
                                'title': clean_title,
                                'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (Dizilla 1080p)",
                                'image': cover_img,
                                'link': f"/seri/{drama_slug}/{e_num}",
                                'date': datetime.now().isoformat(),
                                'status': '1080p HLS Bağlandı' if added else 'Doğrulandı',
                                'sourceName': 'Dizilla',
                            }
                            if added:
                                safe_commit(conn)
                                log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} Dizilla (1080p) bağlandı.')
                            else:
                                log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} Dizilla (1080p) güncel.')
                            emit_live_item(item_obj)
                            synced_items.append(item_obj)
                    reconcile_episode(cur, ep_id)
                    safe_commit(conn)
                except Exception as e:
                    log("HATA", f"Bölüm {ep_slug} hatası: {e}")
        except Exception as e:
            log("HATA", f"Dizilla hedef arama hatası: {e}")
    else:
        log("TARAMA", "Dizilla son eklenen bölümler canlı taranıyor...")
        try:
            idx_url = f"https://dizilla.now/_next/data/{build_id}/index.json"
            idx_data = json.loads(fetch_url(idx_url, headers=headers, timeout=10))
            idx_sec = idx_data.get('pageProps', {}).get('secureData')
            h = hashlib.sha256(b'!!22xx!!90!!').digest()
            key = base64.b64encode(h).decode('ascii')[:32].encode('utf-8')
            cipher = Cipher(algorithms.AES(key), modes.CBC(bytes(16)), backend=default_backend())
            dec = cipher.decryptor()
            decrypted = dec.update(base64.b64decode(idx_sec)) + dec.finalize()
            idx_parsed = json.loads(decrypted[:-decrypted[-1]].decode('utf-8'))
            feed_eps = (idx_parsed.get('getEpisodesOnBrandAll') or []) + (idx_parsed.get('getEpisodesOnNewSeries') or [])
            seen_ep_slugs = set()
            for ep in feed_eps:
                if len(synced_items) >= min(limit, 12):
                    break
                ep_slug = ep.get('episode_used_slug') or ep.get('used_slug')
                raw_title = (ep.get('original_title') or ep.get('culture_title') or '').strip()
                if not ep_slug or not raw_title or ep_slug in seen_ep_slugs:
                    continue
                seen_ep_slugs.add(ep_slug)
                s_num = ep.get('season_no') or 1
                e_num = ep.get('episode_no') or 1
                s_slug = re.sub(r'-\d+-sezon-\d+-bolum.*$', '', ep_slug.replace('dizi/', '').strip('/'))
                try:
                    ep_json_url = f"https://dizilla.now/_next/data/{build_id}/{ep_slug}.json"
                    edata = json.loads(fetch_url(ep_json_url, headers=headers, timeout=8))
                    esec = edata.get('pageProps', {}).get('secureData')
                    raw_edata = base64.b64decode(esec)
                    edec = cipher.decryptor().update(raw_edata) + cipher.decryptor().finalize()
                    ep_parsed = json.loads(edec[:-edec[-1]].decode('utf-8'))
                    esources = ep_parsed.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
                    if not esources:
                        continue
                    did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, raw_title, s_slug,
                        content_type='dizi', country_hint='US', site_tag='dizilla',
                        source_url=f"https://dizilla.now/dizi/{s_slug}", log_fn=log
                    )
                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", f"https://dizilla.now/{ep_slug}")
                    any_added = False
                    for s in esources:
                        s_content = s.get('source_content', '')
                        m_iframe = re.search(r'src=["\']([^"\']+)["\']', s_content)
                        if m_iframe:
                            embed_url = m_iframe.group(1)
                            if embed_url.startswith('//'):
                                embed_url = 'https:' + embed_url
                            if add_source(cur, ep_id, 'Dizilla (1080p)', embed_url, 'dizilla', 'dizilla'):
                                any_added = True
                                touched_dramas.add(did)
                                log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} Dizilla (1080p) bağlandı.')
                    reconcile_episode(cur, ep_id)
                    safe_commit(conn)
                    item_obj = {
                        'id': f"dizilla-{did}-{s_num}-{e_num}",
                        'title': clean_title,
                        'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (Dizilla 1080p)",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{e_num}",
                        'date': datetime.now().isoformat(),
                        'status': '1080p HLS Bağlandı' if any_added else 'Doğrulandı',
                        'sourceName': 'Dizilla',
                    }
                    if not any_added:
                        log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} Dizilla (1080p) güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
                except Exception:
                    continue
        except Exception as e:
            log("UYARI", f"Dizilla canlı akış tarama uyarısı: {e}")
        log("TARAMA", "Dizilla güncel akışları doğrulanıyor...")
        cur.execute("""
            SELECT es.id, d.title, d.slug, e.season_number, e.episode_number, es.source_name, es.direct_url, d.cover_image
            FROM episode_sources es
            JOIN episodes e ON es.episode_id = e.id
            JOIN dramas d ON e.drama_id = d.id
            WHERE es.site = 'dizilla' OR es.provider = 'dizilla'
            ORDER BY es.id DESC
            LIMIT ?
        """, (limit,))
        for r in cur.fetchall():
            item_obj = {
                'id': f"dizilla-{r[0]}",
                'title': r[1],
                'subtitle': f"{r[3]}. Sezon {r[4]}. Bölüm ({r[5]})",
                'image': r[7] or '/logo-dark.png',
                'link': f"/seri/{r[2]}/{r[4]}",
                'date': datetime.now().isoformat(),
                'status': 'Aktif 1080p Akış',
                'sourceName': r[5],
            }
            log("DOĞRULANDI", f'"{r[1]}" -> {r[3]}. Sezon {r[4]}. Bölüm ({r[5]}) doğrulandı.')
            emit_live_item(item_obj)
            synced_items.append(item_obj)

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    log("TAMAMLANDI", f"Dizilla işlemi tamamlandı: {len(synced_items)} adet akış hazır.")
    return len(synced_items), synced_items


# =========================================================================
# SCANNER: DIZIFON (Asya, Kore, Çin & Hint Arşivi)
# =========================================================================
def scan_dizifon(conn, cur, idx, limit=30, target=None):
    log("BAŞLATILDI", "DiziFon canlı tarama motoru devrede (https://www.dizifon.cc)...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.dizifon.cc/',
    }
    synced_items = []
    touched_dramas = set()

    if target:
        log("ARAMA", f'DiziFon üzerinde hedef aranıyor: "{target}"')
        q = urllib.parse.quote(target.strip())
        try:
            s_html = fetch_url(f"https://www.dizifon.cc/?s={q}", headers=headers)
            soup = BeautifulSoup(s_html, 'html.parser')
            target_series_url = None
            nt_target = norm_title(target)
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('-izle' in h or '-cin' in h or '-kore' in h or '-japon' in h or '-tayland' in h):
                    txt = a.get_text(strip=True)
                    if nt_target in norm_title(txt) or norm_title(txt) in nt_target:
                        target_series_url = h
                        break
            # Do not blindly fallback to random /dizi/ link if not matching target

            if target_series_url:
                log("BULUNDU", f"Hedef dizi sayfası: {target_series_url}")
                detail_html = fetch_url(target_series_url, headers=headers)
                d_soup = BeautifulSoup(detail_html, 'html.parser')

                title_elem = d_soup.find('h1') or d_soup.find('title')
                clean_title = title_elem.get_text(strip=True).replace('izle', '').strip() if title_elem else target

                m_slug = re.search(r'/dizi/([^/]+)/?', target_series_url)
                slug_raw = m_slug.group(1) if m_slug else clean_scraped_slug(clean_title)

                country_hint = 'KR'
                if '-cin' in target_series_url or 'çin' in clean_title.lower():
                    country_hint = 'CN'
                elif '-japon' in target_series_url or 'japon' in clean_title.lower():
                    country_hint = 'JP'
                elif '-tayland' in target_series_url or 'tayland' in clean_title.lower():
                    country_hint = 'TH'
                elif 'hint' in clean_title.lower():
                    country_hint = 'IN'

                did, clean_title, drama_slug, cover_img = match_or_create_enriched_drama(
                    conn, cur, idx, clean_title, slug_raw,
                    content_type='dizi', country_hint=country_hint, site_tag='dizifon',
                    source_url=target_series_url, log_fn=log
                )
                touched_dramas.add(did)

                ep_links = []
                for ea in d_soup.find_all('a', href=True):
                    eh = ea['href']
                    if '/bolum/' in eh:
                        ep_links.append((ea.get_text(strip=True), eh))

                log("BÖLÜMLER", f'"{clean_title}" için {len(ep_links)} bölüm bulundu. Kaynaklar çözümleniyor...')
                eps_to_scan = ep_links if target else ep_links[:limit]
                for txt, ep_url in eps_to_scan:
                    m_s = re.search(r'(\d+)-sezon', ep_url)
                    m_e = re.search(r'(\d+)-bolum', ep_url)
                    s_num = int(m_s.group(1)) if m_s else 1
                    e_num = int(m_e.group(1)) if m_e else 1

                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                    ep_html = fetch_url(ep_url, headers=headers)
                    is_ph = page_is_placeholder(ep_html)
                    added = False

                    esoup = BeautifulSoup(ep_html, 'html.parser')
                    for f in esoup.find_all('iframe'):
                        src = f.get('vdo-src') or f.get('src') or f.get('data-src')
                        if not src:
                            continue
                        if src.startswith('//'):
                            src = 'https:' + src
                        prov = 'ok.ru' if 'ok.ru' in src else ('vidmoly' if 'vidmoly' in src else ('youtube' if 'youtube' in src else 'other'))
                        sname = 'OK.ru HD' if prov == 'ok.ru' else ('Vidmoly 1080p' if prov == 'vidmoly' else ('YouTube HD' if prov == 'youtube' else 'Doğrudan Akış'))
                        if add_source(cur, ep_id, sname, src, prov, 'dizifon'):
                            added = True

                    is_pending = reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                    safe_commit(conn)

                    status_text = 'Canlı Çözüldü' if added else ('Kaynak Bekleniyor (Yakında)' if is_pending else 'Doğrulandı')
                    item_obj = {
                        'id': f"dizifon-{did}-{s_num}-{e_num}",
                        'title': clean_title,
                        'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (DiziFon)",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{e_num}",
                        'date': datetime.now().isoformat(),
                        'status': status_text,
                        'sourceName': 'DiziFon',
                    }
                    if added:
                        log("AKINCI", f'"{clean_title}" -> S{s_num}B{e_num} DiziFon kaynakları bağlandı.')
                    elif is_pending:
                        log("BEKLEMEDE", f'"{clean_title}" -> S{s_num}B{e_num} kaynak bekleniyor.')
                    else:
                        log("DOĞRULANDI", f'"{clean_title}" -> S{s_num}B{e_num} kaynak güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
        except Exception as e:
            log("HATA", f"DiziFon hedef tarama hatası: {e}")
    else:
        try:
            home_html = fetch_url("https://www.dizifon.cc/", headers=headers)
            soup = BeautifulSoup(home_html, 'html.parser')
            seen = set()
            ep_links = []
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/bolum/' in h and h not in seen and '#comment' not in h:
                    seen.add(h)
                    txt = a.get_text(strip=True)
                    if txt:
                        ep_links.append((txt, h))
                        if len(ep_links) >= limit:
                            break

            log("KAYIT", f"{len(ep_links)} adet son eklenen DiziFon bölümü tespit edildi.")
            for txt, ep_url in ep_links:
                try:
                    m_s = re.search(r'(\d+)-sezon', ep_url)
                    m_e = re.search(r'(\d+)-bolum', ep_url)
                    s_num = int(m_s.group(1)) if m_s else 1
                    e_num = int(m_e.group(1)) if m_e else 1

                    # Extract slug from URL: /bolum/{drama-slug}-{s}-{e}/
                    ep_slug_raw = re.sub(r'^https?://[^/]+/bolum/', '', ep_url).strip('/')
                    drama_slug_cand = re.sub(r'-(?:\d+-sezon-)?\d+-bolum(?:-izle)?.*$', '', ep_slug_raw)
                    drama_slug_cand = re.sub(r'-\d{4}-(?:kore|cin|japon|tayland|asya)$', '', drama_slug_cand)
                    drama_title = drama_slug_cand.replace('-', ' ').title()

                    did, drama_title, drama_slug, cover_img = match_or_create_enriched_drama(
                        conn, cur, idx, drama_title, drama_slug_cand,
                        content_type='dizi', country_hint='KR', site_tag='dizifon',
                        source_url=ep_url, log_fn=log
                    )
                    touched_dramas.add(did)

                    ep_id, _ = match_or_create_episode(cur, did, s_num, e_num, f"{s_num}. Sezon {e_num}. Bölüm", ep_url)
                    ep_html = fetch_url(ep_url, headers=headers)
                    is_ph = page_is_placeholder(ep_html)
                    added = False

                    esoup = BeautifulSoup(ep_html, 'html.parser')
                    for f in esoup.find_all('iframe'):
                        src = f.get('vdo-src') or f.get('src') or f.get('data-src')
                        if not src:
                            continue
                        if src.startswith('//'):
                            src = 'https:' + src
                        prov = 'ok.ru' if 'ok.ru' in src else ('vidmoly' if 'vidmoly' in src else ('youtube' if 'youtube' in src else 'other'))
                        sname = 'OK.ru HD' if prov == 'ok.ru' else ('Vidmoly 1080p' if prov == 'vidmoly' else ('YouTube HD' if prov == 'youtube' else 'Doğrudan Akış'))
                        if add_source(cur, ep_id, sname, src, prov, 'dizifon'):
                            added = True

                    is_pending = reconcile_episode(cur, ep_id, is_placeholder=is_ph)
                    safe_commit(conn)

                    status_text = 'Canlı Çözüldü' if added else ('Kaynak Bekleniyor (Yakında)' if is_pending else 'Doğrulandı')
                    item_obj = {
                        'id': f"dizifon-{did}-{s_num}-{e_num}",
                        'title': drama_title,
                        'subtitle': f"{s_num}. Sezon {e_num}. Bölüm (DiziFon)",
                        'image': cover_img,
                        'link': f"/seri/{drama_slug}/{e_num}",
                        'date': datetime.now().isoformat(),
                        'status': status_text,
                        'sourceName': 'DiziFon',
                    }
                    if added:
                        log("AKINCI", f'"{drama_title}" -> S{s_num}B{e_num} DiziFon kaynakları bağlandı.')
                    elif is_pending:
                        log("BEKLEMEDE", f'"{drama_title}" -> S{s_num}B{e_num} kaynak bekleniyor.')
                    else:
                        log("DOĞRULANDI", f'"{drama_title}" -> S{s_num}B{e_num} kaynak güncel.')
                    emit_live_item(item_obj)
                    synced_items.append(item_obj)
                except Exception as err:
                    log("UYARI", f"{ep_url} DiziFon hatası: {err}")
        except Exception as e:
            log("HATA", f"DiziFon ana sayfa tarama hatası: {e}")

    for did in touched_dramas:
        sync_drama_bundle_and_counts(conn, cur, did)

    log("TAMAMLANDI", f"DiziFon işlemi tamamlandı: {len(synced_items)} adet akış hazır.")
    return len(synced_items), synced_items


# =========================================================================
# MAIN ENTRY
# =========================================================================
def main():
    parser = argparse.ArgumentParser(description="KoUp Live Scraper Engine")
    parser.add_argument("--provider", required=True, choices=["dizibox", "dizikorea", "ddizi", "animecix", "hdfilm", "asyawatch", "dizilla", "dizifon"])
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--target", type=str, default=None)
    args = parser.parse_args()

    conn = get_connection()
    ensure_pending_columns(conn)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")
    
    idx = build_drama_index(cur)

    delta = 0
    items = []
    if args.provider == "dizibox":
        delta, items = scan_dizibox(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "dizikorea":
        delta, items = scan_dizikorea(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "ddizi":
        delta, items = scan_ddizi(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "animecix":
        delta, items = scan_animecix(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "hdfilm":
        delta, items = scan_hdfilm(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "asyawatch":
        delta, items = scan_asyawatch(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "dizilla":
        delta, items = scan_dizilla(conn, cur, idx, limit=args.limit, target=args.target)
    elif args.provider == "dizifon":
        delta, items = scan_dizifon(conn, cur, idx, limit=args.limit, target=args.target)

    # Get updated total
    if args.provider == "hdfilm":
        cur.execute("SELECT COUNT(*) FROM episode_sources WHERE site LIKE '%hdfilm%' OR provider LIKE '%hdfilm%' OR provider = 'rapidrame' OR provider = 'close'")
    elif args.provider == "asyawatch":
        cur.execute("SELECT COUNT(*) FROM episode_sources WHERE site LIKE '%asyawatch%' OR provider LIKE '%asyawatch%'")
    elif args.provider == "dizilla":
        cur.execute("SELECT COUNT(*) FROM episode_sources WHERE site LIKE '%dizilla%' OR provider LIKE '%dizilla%'")
    elif args.provider == "dizifon":
        cur.execute("SELECT COUNT(*) FROM episode_sources WHERE site LIKE '%dizifon%' OR provider LIKE '%dizifon%'")
    else:
        cur.execute("SELECT COUNT(*) FROM episode_sources WHERE site=? OR provider=?", (args.provider, args.provider))
    new_total = cur.fetchone()[0]

    log("TAMAMLANDI", f"Tarama görevi tamamlandı. Yeni/Güncel Kaynak: +{delta}. Toplam Arşiv: {new_total:,}")

    # Admin trigger auto re-check: small batch of pending episodes
    try:
        from scripts.recheck_pending_episodes import recheck_pending
        recheck_res = recheck_pending(conn, cur, limit=40)
        if recheck_res.get("checked", 0) > 0:
            log("YENİDEN KONTROL", f"Bekleyen bölümler kontrol edildi: {recheck_res['checked']} kontrol, {recheck_res['resolved']} çözüldü, {recheck_res['pending']} halen beklemede.")
    except Exception as recheck_err:
        log("UYARI", f"Bekleyen kaynak yeniden kontrol uyarısı: {recheck_err}")

    # Output JSON line for API consumer
    result_data = {
        "ok": True,
        "provider": args.provider,
        "syncedDelta": delta,
        "newTotal": new_total,
        "items": items,
        "timestamp": datetime.now().isoformat()
    }
    print(f"__RESULT__ {json.dumps(result_data, ensure_ascii=False)}")

if __name__ == "__main__":
    main()
