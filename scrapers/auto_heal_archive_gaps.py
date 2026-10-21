"""
KoUp Automated Archive Gap Healer Engine
- Automatically scans webdrama_archive.db for series with sequence gaps
- Detects the optimal provider (DiziKorea, BLDrama, DiziBOX, Animecix, DDizi)
- Crawls and recovers missing episodes and working stream sources
- Updates R2 bundles and drama metadata counts
- Periodically creates WAL checkpoints and triggers backup_db_to_r2
- Can be invoked directly or run as an unattended background worker
"""

import sys
import os
import re
import time
import argparse
from datetime import datetime
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.sync_target_drama import (
    get_db,
    sync_dizikorea_target,
    sync_bldrama_target,
    sync_dizibox_target,
    sync_animecix_target,
    sync_ddizi_target,
    log
)
from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2
)

def find_gapped_series(conn, limit=100, max_gap_size=50, country_filter=None, provider_filter=None):
    cur = conn.cursor()
    cur.execute("""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        GROUP BY d.id
        HAVING count(e.id) > 0
    """)
    rows = cur.fetchall()
    
    gapped = []
    for row in rows:
        did = row['id']
        cur.execute("SELECT episode_number FROM episodes WHERE drama_id = ?", (did,))
        existing = set(r[0] for r in cur.fetchall())
        if not existing:
            continue
        max_ep = max(existing)
        min_ep = min(existing)
        start_ep = 1 if min_ep <= 3 else min_ep
        full = set(range(start_ep, max_ep + 1))
        diff = full - existing
        if diff and len(diff) <= max_gap_size:
            country = (row['country'] or '').upper()
            if country_filter and country_filter.upper() != 'ALL' and country != country_filter.upper():
                continue
            item = {
                'id': did,
                'title': row['title'],
                'slug': row['slug'],
                'content_type': (row['content_type'] or '').lower(),
                'country': country,
                'source_url': row['source_url'] or '',
                'missing_count': len(diff),
                'missing_eps': sorted(list(diff))
            }
            prov = choose_provider(item)
            if provider_filter and provider_filter.lower() != 'all' and prov != provider_filter.lower():
                continue
            gapped.append(item)
    
    # Sort: Prioritize high-yield Asian live scraper targets first, then by missing_count
    def sort_key(x):
        is_asian = 0 if x['country'] in ('KR', 'CN', 'TH', 'TW') else 1
        return (is_asian, x['missing_count'])
    
    gapped.sort(key=sort_key)
    return gapped[:limit]

def choose_provider(item):
    source_url = item['source_url']
    country = item['country']
    ctype = item['content_type']
    
    if 'bldrama' in source_url or 'webdramaturkey' in source_url:
        return 'bldrama'
    elif ctype == 'anime':
        return 'animecix'
    elif country == 'TR':
        return 'ddizi'
    elif country in ('KR', 'JP', 'CN', 'TH', 'TW'):
        return 'dizikorea'
    else:
        return 'dizibox'

def run_healing_loop(limit=50, max_gap_size=50, country=None, provider=None):
    log("ENGINE", f"Otomatik Arşiv İyileştirici Başlatıldı. Hedef: İlk {limit} seri (Max Gap: {max_gap_size}, Country: {country or 'ALL'}, Provider: {provider or 'ALL'})...")
    conn = get_db()
    cur = conn.cursor()
    
    candidates = find_gapped_series(conn, limit=limit, max_gap_size=max_gap_size, country_filter=country, provider_filter=provider)
    log("ENGINE", f"Toplam {len(candidates)} adet iyileştirilebilir dizi tespit edildi.")
    
    healed_dramas = 0
    total_eps_added = 0
    total_srcs_added = 0
    start_time = time.time()
    
    for i, item in enumerate(candidates, 1):
        did = item['id']
        title = item['title']
        provider = choose_provider(item)
        log("PROGRESS", f"[{i}/{len(candidates)}] #{did} '{title}' ({provider.upper()}) - Eksik: {item['missing_eps'][:5]}...")
        
        try:
            cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
            drama = dict(cur.fetchone())
            
            eps_added, srcs_added = 0, 0
            if provider == 'dizikorea':
                eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_bldrama_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
            elif provider == 'bldrama':
                eps_added, srcs_added = sync_bldrama_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
            elif provider == 'animecix':
                eps_added, srcs_added = sync_animecix_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
            elif provider == 'ddizi':
                eps_added, srcs_added = sync_ddizi_target(conn, cur, drama)
            elif provider == 'dizibox':
                eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
                if eps_added == 0:
                    eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)
            
            if eps_added > 0 or srcs_added > 0:
                sync_drama_bundle_and_counts(conn, cur, did)
                healed_dramas += 1
                total_eps_added += eps_added
                total_srcs_added += srcs_added
                log("SUCCESS", f"-> #{did} '{title}' Onarıldı! (+{eps_added} bölüm, +{srcs_added} kaynak)")
            else:
                log("NO_CHANGE", f"-> #{did} '{title}' Canlı sağlayıcıda yeni bölüm bulunamadı.")
        except Exception as e:
            log("ERROR", f"-> #{did} '{title}' Hata: {e}")
        
        # Periodic DB checkpoint & R2 backup every 15 dramas
        if i % 15 == 0:
            try:
                conn.commit()
                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
                backup_db_to_r2()
                log("R2_SYNC", f"Geçici checkpoint ve R2 senkronizasyonu tamamlandı ({i}/{len(candidates)}).")
            except Exception as e:
                log("R2_SYNC", f"R2 senkronizasyon uyarısı: {e}")

    # Final checkpoint & R2 backup
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()
    
    try:
        backup_db_to_r2()
        log("R2_SYNC", "Final veritabanı yedeği Cloudflare R2'ye yüklendi.")
    except Exception as e:
        log("R2_SYNC", f"Final R2 yedekleme hatası: {e}")
    
    elapsed = round(time.time() - start_time, 1)
    log("SUMMARY", f"Tamamlandı! Süre: {elapsed}s | Onarılan Dizi: {healed_dramas} | Kurtarılan Bölüm: {total_eps_added} | Yeni Kaynak: {total_srcs_added}")
    return healed_dramas, total_eps_added, total_srcs_added

def main():
    parser = argparse.ArgumentParser(description="KoUp Automated Archive Gap Healer")
    parser.add_argument("--limit", type=int, default=50, help="Number of series to heal in this run")
    parser.add_argument("--max-gap", type=int, default=50, help="Max gap size to process")
    parser.add_argument("--country", type=str, default=None, help="Filter by country (e.g. KR, CN, TH, TR)")
    parser.add_argument("--provider", type=str, default=None, help="Filter by target provider (e.g. dizikorea, bldrama)")
    args = parser.parse_args()
    
    run_healing_loop(limit=args.limit, max_gap_size=args.max_gap, country=args.country, provider=args.provider)

if __name__ == '__main__':
    main()
