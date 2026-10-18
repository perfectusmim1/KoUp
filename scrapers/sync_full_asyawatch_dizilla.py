"""
KoUp Fast Batch Synchronizer & Broken Source Cleaner for AsyaWatch & Dizilla
"""

import sys
import os
import re
import json
import time
import base64
import hashlib
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime

# Windows encoding
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
    unique_slug
)

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)

def get_dizilla_key():
    h = hashlib.sha256(b'!!22xx!!90!!').digest()
    b64 = base64.b64encode(h).decode('ascii')
    return b64[:32].encode('utf-8')

DIZILLA_KEY = get_dizilla_key()
DIZILLA_IV = bytes(16)

def decrypt_dizilla(encrypted_text: str):
    try:
        raw_data = base64.b64decode(encrypted_text)
        cipher = Cipher(algorithms.AES(DIZILLA_KEY), modes.CBC(DIZILLA_IV), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(raw_data) + decryptor.finalize()
        pad_len = decrypted[-1]
        decrypted = decrypted[:-pad_len]
        return json.loads(decrypted.decode('utf-8'))
    except Exception as e:
        log("HATA", f"Dizilla decrypt error: {e}")
        return None

def fetch_json_with_retry(url: str, post_data: bytes = None, headers: dict = None, timeout: int = 25, retries: int = 3):
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Connection': 'keep-alive',
    }
    if headers:
        h.update(headers)
        
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=post_data, headers=h, method='POST' if post_data is not None else 'GET')
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            if attempt == retries - 1:
                raise e
            time.sleep(1.0 + attempt * 1.5)

# =========================================================================
# STEP 1: CLEAN BROKEN SOURCES
# =========================================================================
def clean_broken_sources(conn, cur):
    log("TEMİZLİK", "Bozuk ve ölü barındırıcı kaynakları taranıyor...")
    
    dead_conditions = [
        "direct_url LIKE '%undefined%'",
        "direct_url LIKE '%null%'",
        "direct_url LIKE '%streamango.com%'",
        "direct_url LIKE '%rapidvideo.com%'",
        "direct_url LIKE '%vidoza.net%'",
        "direct_url LIKE '%openload.co%'",
        "direct_url LIKE '%oload.tv%'",
        "direct_url LIKE '%verystream.com%'",
        "direct_url LIKE '%vidmoly.biz/embed-9scvgkquds8a.html%'"
    ]
    
    where_clause = " OR ".join(dead_conditions)
    cur.execute(f"SELECT COUNT(*) FROM episode_sources WHERE {where_clause}")
    dead_count = cur.fetchone()[0]
    
    if dead_count > 0:
        cur.execute(f"DELETE FROM episode_sources WHERE {where_clause}")
        conn.commit()
        log("TEMİZLİK", f"{dead_count:,} adet ölü/bozuk kaynak başarıyla veritabanından silindi.")
    else:
        log("TEMİZLİK", "Hiçbir ölü barındırıcı kaynağı bulunamadı, arşiv temiz.")
        
    return dead_count

# =========================================================================
# STEP 2: SYNC ASYAWATCH
# =========================================================================
def sync_asyawatch_catalog(conn, cur, idx):
    log("ASYAWATCH", "AsyaWatch doğrudan API üzerinden taranıyor (https://asyawatch.com/api/bg/findSeries)...")
    
    headers = {
        'Referer': 'https://asyawatch.com/',
        'Origin': 'https://asyawatch.com'
    }
    
    page = 1
    total_fetched = 0
    new_added = 0
    updated = 0
    
    country_map = {
        543: ('TH', 'Tayland'),
        510: ('TW', 'Tayvan'),
        538: ('TR', 'Türkiye'),
        563: ('VN', 'Vietnam'),
        427: ('SG', 'Singapur'),
        537: ('RU', 'Rusya'),
        21: ('KR', 'Güney Kore'),
        12: ('JP', 'Japonya'),
        46: ('CN', 'Çin'),
        1: ('US', 'ABD'),
    }

    while True:
        url = f"https://asyawatch.com/api/bg/findSeries?currentPage={page}&currentPageCount=500"
        try:
            raw_res = fetch_json_with_retry(url, post_data=b'', headers=headers)
            b64_str = raw_res.get('response')
            if not b64_str:
                break
            d = json.loads(base64.b64decode(b64_str).decode('utf-8'))
            items = d.get('result', [])
            if not items:
                break
                
            total_fetched += len(items)
            log("ASYAWATCH", f"Sayfa {page}: {len(items)} dizi alındı. (Toplam: {total_fetched:,})")
            
            for item in items:
                raw_title = item.get('original_title') or item.get('used_title') or ''
                clean_title = raw_title.replace(' izle', '').strip()
                if not clean_title:
                    continue
                
                native_title = item.get('culture_title') or ''
                year = item.get('release_year') or datetime.now().year
                categories = item.get('categories') or ''
                overview = item.get('description') or item.get('used_short_description') or ''
                poster = item.get('poster_url') or item.get('face_url') or '/logo-dark.png'
                backdrop = item.get('back_url') or item.get('brand_url') or None
                imdb_id = item.get('imdb_id') or None
                used_slug = item.get('used_slug') or ''
                source_url = f"https://asyawatch.com/{used_slug}" if used_slug else f"https://asyawatch.com/dizi/{item.get('id')}"
                
                # Content type & country determination
                cid = item.get('country_id')
                c_code, c_name = country_map.get(cid, ('KR', 'Güney Kore'))
                
                content_type = 'dizi'
                if 'anime' in categories.lower() or 'animasyon' in categories.lower() or c_code == 'JP':
                    content_type = 'anime'
                
                # Check if exists in DB by title/year
                did = find_in_index(idx, clean_title, year)
                
                # If not found in index, check by source_url
                if not did:
                    cur.execute("SELECT id FROM dramas WHERE source_url = ?", (source_url,))
                    row_u = cur.fetchone()
                    if row_u:
                        did = row_u[0]

                if did:
                    # Update metadata if missing
                    cur.execute("""
                        UPDATE dramas SET 
                            native_title = COALESCE(native_title, ?),
                            cover_image = CASE WHEN cover_image IS NULL OR cover_image = '/logo-dark.png' THEN ? ELSE cover_image END,
                            backdrop_image = COALESCE(backdrop_image, ?),
                            overview = CASE WHEN overview IS NULL OR length(overview) < 20 THEN ? ELSE overview END,
                            categories = COALESCE(categories, ?),
                            imdb_id = COALESCE(imdb_id, ?)
                        WHERE id = ?
                    """, (native_title, poster, backdrop, overview, categories, imdb_id, did))
                    tag_site(cur, did, 'asyawatch')
                    updated += 1
                else:
                    # Insert new drama
                    slug_cand = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')
                    if not slug_cand.endswith('-izle'):
                        slug_cand += '-izle'
                    new_slug = unique_slug(cur, slug_cand)
                    
                    # Ensure source_url uniqueness
                    cur.execute("SELECT 1 FROM dramas WHERE source_url = ?", (source_url,))
                    if cur.fetchone():
                        source_url = f"{source_url}?aw_id={item.get('id')}"
                    
                    cur.execute("""
                        INSERT INTO dramas (
                            title, slug, content_type, country, country_name, release_year, 
                            status_broadcast, cover_image, backdrop_image, overview, 
                            categories, source_url, imdb_id, alt_sites
                        ) VALUES (?, ?, ?, ?, ?, ?, 'ongoing', ?, ?, ?, ?, ?, ?, 'asyawatch')
                    """, (
                        clean_title, new_slug, content_type, c_code, c_name, year,
                        poster, backdrop, overview, categories, source_url, imdb_id
                    ))
                    new_did = cur.lastrowid
                    tag_site(cur, new_did, 'asyawatch')
                    
                    # Update index
                    norm = norm_title(clean_title)
                    idx[norm] = new_did
                    new_added += 1
            
            conn.commit()
            has_more = d.get('pagination', {}).get('hasMore', False)
            if not has_more:
                break
            page += 1
            time.sleep(0.3)
        except Exception as e:
            log("HATA", f"AsyaWatch sayfa {page} hatası: {e}")
            break
            
    log("ASYAWATCH", f"AsyaWatch tamamlandı: Toplam {total_fetched:,} dizi tarandı (+{new_added:,} yeni seri eklendi, {updated:,} seri güncellendi).")
    return total_fetched, new_added, updated

# =========================================================================
# STEP 3: SYNC DIZILLA
# =========================================================================
def sync_dizilla_catalog(conn, cur, idx):
    log("DIZILLA", "Dizilla doğrudan API üzerinden taranıyor (AES-256 Decrypt, https://dizilla.now/api/bg/findSeries)...")
    
    headers = {
        'Referer': 'https://dizilla.now/',
        'Origin': 'https://dizilla.now'
    }
    
    page = 1
    total_fetched = 0
    new_added = 0
    updated = 0
    
    country_map = {
        12: ('JP', 'Japonya'),
        21: ('KR', 'Güney Kore'),
        46: ('CN', 'Çin'),
        1: ('US', 'ABD'),
        2: ('GB', 'İngiltere'),
        543: ('TH', 'Tayland'),
        510: ('TW', 'Tayvan'),
        538: ('TR', 'Türkiye'),
        10: ('CA', 'Kanada'),
        8: ('FR', 'Fransa'),
        9: ('DE', 'Almanya'),
        14: ('ES', 'İspanya'),
    }

    while True:
        url = f"https://dizilla.now/api/bg/findSeries?currentPage={page}&currentPageCount=300"
        try:
            raw_res = fetch_json_with_retry(url, post_data=b'', headers=headers)
            enc = raw_res.get('response')
            if not enc:
                break
            d = decrypt_dizilla(enc)
            if not d:
                break
            items = d.get('result', [])
            if not items:
                break
                
            total_fetched += len(items)
            log("DIZILLA", f"Sayfa {page}: {len(items)} dizi alındı. (Toplam: {total_fetched:,})")
            
            for item in items:
                raw_title = item.get('original_title') or item.get('used_title') or ''
                clean_title = raw_title.replace(' izle', '').strip()
                if not clean_title:
                    continue
                
                native_title = item.get('culture_title') or ''
                year = item.get('release_year') or datetime.now().year
                categories = item.get('categories') or ''
                overview = item.get('description') or item.get('used_short_description') or ''
                poster = item.get('poster_url') or item.get('face_url') or '/logo-dark.png'
                backdrop = item.get('back_url') or item.get('brand_url') or None
                imdb_id = item.get('imdb_id') or None
                used_slug = item.get('used_slug') or ''
                source_url = f"https://dizilla.now/{used_slug}" if used_slug else f"https://dizilla.now/dizi/{item.get('id')}"
                
                # Content type & country determination
                cid = item.get('country_id')
                c_code, c_name = country_map.get(cid, ('US', 'ABD'))
                
                content_type = 'dizi'
                cat_lower = categories.lower()
                if 'anime' in cat_lower or 'animasyon' in cat_lower or c_code == 'JP':
                    content_type = 'anime'
                    if c_code == 'US':
                        c_code, c_name = ('JP', 'Japonya')
                elif c_code == 'KR' or 'k-drama' in cat_lower or 'kore' in cat_lower:
                    content_type = 'dizi'
                    c_code, c_name = ('KR', 'Güney Kore')
                elif c_code == 'CN' or 'c-drama' in cat_lower or 'çin' in cat_lower:
                    content_type = 'dizi'
                    c_code, c_name = ('CN', 'Çin')
                
                # Check if exists in DB by title/year
                did = find_in_index(idx, clean_title, year)
                
                # If not found in index, check by source_url
                if not did:
                    cur.execute("SELECT id FROM dramas WHERE source_url = ?", (source_url,))
                    row_u = cur.fetchone()
                    if row_u:
                        did = row_u[0]

                if did:
                    # Update metadata if missing
                    cur.execute("""
                        UPDATE dramas SET 
                            native_title = COALESCE(native_title, ?),
                            cover_image = CASE WHEN cover_image IS NULL OR cover_image = '/logo-dark.png' THEN ? ELSE cover_image END,
                            backdrop_image = COALESCE(backdrop_image, ?),
                            overview = CASE WHEN overview IS NULL OR length(overview) < 20 THEN ? ELSE overview END,
                            categories = COALESCE(categories, ?),
                            imdb_id = COALESCE(imdb_id, ?)
                        WHERE id = ?
                    """, (native_title, poster, backdrop, overview, categories, imdb_id, did))
                    tag_site(cur, did, 'dizilla')
                    updated += 1
                else:
                    # Insert new drama
                    slug_cand = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')
                    if not slug_cand.endswith('-izle'):
                        slug_cand += '-izle'
                    new_slug = unique_slug(cur, slug_cand)
                    
                    # Ensure source_url uniqueness
                    cur.execute("SELECT 1 FROM dramas WHERE source_url = ?", (source_url,))
                    if cur.fetchone():
                        source_url = f"{source_url}?dz_id={item.get('id')}"
                    
                    cur.execute("""
                        INSERT INTO dramas (
                            title, slug, content_type, country, country_name, release_year, 
                            status_broadcast, cover_image, backdrop_image, overview, 
                            categories, source_url, imdb_id, alt_sites
                        ) VALUES (?, ?, ?, ?, ?, ?, 'ongoing', ?, ?, ?, ?, ?, ?, 'dizilla')
                    """, (
                        clean_title, new_slug, content_type, c_code, c_name, year,
                        poster, backdrop, overview, categories, source_url, imdb_id
                    ))
                    new_did = cur.lastrowid
                    tag_site(cur, new_did, 'dizilla')
                    
                    # Update index
                    norm = norm_title(clean_title)
                    idx[norm] = new_did
                    new_added += 1
            
            conn.commit()
            has_more = d.get('pagination', {}).get('hasMore', False)
            if not has_more:
                break
            page += 1
            time.sleep(0.3)
        except Exception as e:
            log("HATA", f"Dizilla sayfa {page} hatası: {e}")
            break
            
    log("DIZILLA", f"Dizilla tamamlandı: Toplam {total_fetched:,} dizi tarandı (+{new_added:,} yeni seri eklendi, {updated:,} seri güncellendi).")
    return total_fetched, new_added, updated

# =========================================================================
# MAIN ORCHESTRATOR
# =========================================================================
def main():
    start_time = time.time()
    log("BAŞLATILDI", "KoUp Toplu Arşiv Senkronizasyonu & Kaynak Temizliği Başlatıldı.")
    
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")
    
    # Initial stats
    cur.execute("SELECT COUNT(*) FROM dramas")
    initial_dramas = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM episode_sources")
    initial_sources = cur.fetchone()[0]
    log("DURUM", f"Başlangıç İstatistikleri: {initial_dramas:,} seri | {initial_sources:,} akış kaynağı.")
    
    # 1. Clean broken sources
    removed_broken = clean_broken_sources(conn, cur)
    
    # Build drama index for fast matching
    idx = build_drama_index(cur)
    
    # 2. Sync AsyaWatch catalog
    asya_total, asya_new, asya_updated = sync_asyawatch_catalog(conn, cur, idx)
    
    # 3. Sync Dizilla catalog
    dizilla_total, dizilla_new, dizilla_updated = sync_dizilla_catalog(conn, cur, idx)
    
    # 4. Checkpoint WAL
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    
    # Final stats
    cur.execute("SELECT COUNT(*) FROM dramas")
    final_dramas = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM episode_sources")
    final_sources = cur.fetchone()[0]
    
    elapsed = time.time() - start_time
    log("TAMAMLANDI", f"Tüm işlemler {elapsed:.1f} saniyede tamamlandı!")
    
    stats = {
        "elapsed_seconds": round(elapsed, 1),
        "removed_broken_sources": removed_broken,
        "asyawatch": {
            "total_scanned": asya_total,
            "new_series_added": asya_new,
            "series_updated": asya_updated
        },
        "dizilla": {
            "total_scanned": dizilla_total,
            "new_series_added": dizilla_new,
            "series_updated": dizilla_updated
        },
        "archive_summary": {
            "initial_dramas": initial_dramas,
            "final_dramas": final_dramas,
            "net_dramas_added": final_dramas - initial_dramas,
            "initial_sources": initial_sources,
            "final_sources": final_sources,
            "net_sources_delta": final_sources - initial_sources
        }
    }
    
    print("\n" + "="*60)
    print("           KOUP GENEL ARŞİV SENKRONİZASYON RAPORU           ")
    print("="*60)
    print(f"Toplam Geçen Süre         : {elapsed:.1f} saniye")
    print(f"Kaldırılan Bozuk Kaynak   : {removed_broken:,} adet")
    print(f"AsyaWatch Taranan Seri    : {asya_total:,} adet (+{asya_new:,} Yeni Seri, {asya_updated:,} Güncelleme)")
    print(f"Dizilla Taranan Seri      : {dizilla_total:,} adet (+{dizilla_new:,} Yeni Seri, {dizilla_updated:,} Güncelleme)")
    print(f"KoUp Toplam Seri Sayısı   : {final_dramas:,} adet (+{final_dramas - initial_dramas:,} Net Artış)")
    print(f"KoUp Toplam Akış Sayısı   : {final_sources:,} adet")
    print("="*60 + "\n")
    
    with open(os.path.join(_ROOT, "sync_report.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
