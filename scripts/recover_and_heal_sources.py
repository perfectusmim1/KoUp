"""
KoUp Universal Source Recovery & Catalog Healing Engine
=======================================================
- Detects series with empty/pending episodes (0 active sources) or sequence gaps
- Recovers working streams from live providers:
    * Anime / Donghua -> AnimeciX (AESGCM API, Tau-Video Native priority #1, Uqload #2)
    * Korean / Asian Drama -> DiziKorea / AsyaWatch / BLDrama
    * Western Drama -> DiziBox
    * Turkish Drama -> DDizi
- Validates streams and removes dead / broken links
- Reconciles episode pending status to published once working sources are attached
- Syncs R2 JSON bundles and Supabase media/episode records atomically
- Periodically checkpoints SQLite WAL and backs up database to Cloudflare R2
"""

import sys
import os
import re
import time
import argparse
import sqlite3
from datetime import datetime

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
    log,
)
from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)

def find_candidate_dramas(conn, limit=50, category='all', only_empty=False, max_gap_size=50):
    cur = conn.cursor()
    
    # Category filter mapping
    cat_sql = ""
    params = []
    
    if category == 'anime':
        cat_sql = "AND LOWER(d.content_type) = 'anime'"
    elif category == 'korea':
        cat_sql = "AND UPPER(d.country) = 'KR'"
    elif category == 'asia':
        cat_sql = "AND (UPPER(d.country) IN ('KR', 'JP', 'CN', 'TH', 'TW') OR LOWER(d.content_type) = 'anime')"
    elif category == 'western':
        cat_sql = "AND UPPER(d.country) IN ('US', 'GB', 'CA', 'AU') AND LOWER(d.content_type) != 'anime'"
    elif category == 'turkish':
        cat_sql = "AND UPPER(d.country) = 'TR'"

    candidates = []

    # 1. Target shows with empty or pending episodes (HIGHEST PRIORITY)
    cur.execute(f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url,
               COUNT(DISTINCT e.id) as total_eps,
               COUNT(DISTINCT CASE WHEN e.source_status = 'pending' 
                                      OR NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id) 
                                   THEN e.id END) as empty_eps
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        WHERE 1=1 {cat_sql}
        GROUP BY d.id
        HAVING empty_eps > 0
        ORDER BY empty_eps DESC, d.id DESC
        LIMIT ?
    """, (*params, limit))
    
    empty_rows = cur.fetchall()
    for row in empty_rows:
        candidates.append({
            'id': row['id'],
            'title': row['title'],
            'slug': row['slug'],
            'content_type': (row['content_type'] or '').lower(),
            'country': (row['country'] or '').upper(),
            'source_url': row['source_url'] or '',
            'empty_count': row['empty_eps'],
            'total_eps': row['total_eps'],
            'reason': 'empty_sources',
        })

    if only_empty or len(candidates) >= limit:
        return candidates[:limit]

    # 2. Target shows with sequence gaps if quota remains
    remaining = limit - len(candidates)
    existing_ids = set(c['id'] for c in candidates)

    cur.execute(f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        WHERE 1=1 {cat_sql}
        GROUP BY d.id
        HAVING count(e.id) > 0
    """, params)
    
    all_dramas = cur.fetchall()
    for row in all_dramas:
        did = row['id']
        if did in existing_ids:
            continue
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
            candidates.append({
                'id': did,
                'title': row['title'],
                'slug': row['slug'],
                'content_type': (row['content_type'] or '').lower(),
                'country': (row['country'] or '').upper(),
                'source_url': row['source_url'] or '',
                'empty_count': len(diff),
                'total_eps': max_ep,
                'reason': 'sequence_gap',
            })
            if len(candidates) >= limit:
                break

    return candidates[:limit]

def choose_provider(item):
    source_url = (item.get('source_url') or '').lower()
    country = (item.get('country') or '').upper()
    ctype = (item.get('content_type') or '').lower()

    if 'bldrama' in source_url or 'webdramaturkey' in source_url:
        return 'bldrama'
    if ctype == 'anime':
        return 'animecix'
    if country == 'TR':
        return 'ddizi'
    if country in ('KR', 'JP', 'CN', 'TH', 'TW'):
        return 'dizikorea'
    return 'dizibox'

def heal_drama(conn, cur, drama_item):
    did = drama_item['id']
    title = drama_item['title']
    provider = choose_provider(drama_item)
    
    cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
    row = cur.fetchone()
    if not row:
        return 0, 0
    drama = dict(row)

    eps_added, srcs_added = 0, 0
    if provider == 'animecix':
        eps_added, srcs_added = sync_animecix_target(conn, cur, drama)
        if srcs_added == 0:
            eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
    elif provider == 'dizikorea':
        eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)
        if srcs_added == 0:
            eps_added, srcs_added = sync_bldrama_target(conn, cur, drama)
        if srcs_added == 0:
            eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
    elif provider == 'bldrama':
        eps_added, srcs_added = sync_bldrama_target(conn, cur, drama)
        if srcs_added == 0:
            eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)
    elif provider == 'ddizi':
        eps_added, srcs_added = sync_ddizi_target(conn, cur, drama)
    elif provider == 'dizibox':
        eps_added, srcs_added = sync_dizibox_target(conn, cur, drama)
        if srcs_added == 0 and drama.get('country') in ('KR', 'CN', 'TH', 'JP'):
            eps_added, srcs_added = sync_dizikorea_target(conn, cur, drama)

    if eps_added > 0 or srcs_added > 0:
        sync_drama_bundle_and_counts(conn, cur, did)

    return eps_added, srcs_added

def run_recovery(limit=30, category='all', only_empty=False, drama_id=None):
    conn = get_db()
    cur = conn.cursor()

    if drama_id:
        cur.execute("SELECT id, title, slug, content_type, country, source_url FROM dramas WHERE id = ?", (drama_id,))
        row = cur.fetchone()
        if not row:
            log("ERROR", f"Dizi #{drama_id} veritabanında bulunamadı.")
            return 0, 0, 0
        candidates = [{
            'id': row['id'],
            'title': row['title'],
            'slug': row['slug'],
            'content_type': (row['content_type'] or '').lower(),
            'country': (row['country'] or '').upper(),
            'source_url': row['source_url'] or '',
            'empty_count': 0,
            'total_eps': 0,
            'reason': 'manual_id'
        }]
    else:
        candidates = find_candidate_dramas(conn, limit=limit, category=category, only_empty=only_empty)

    log("ENGINE", f"Kaynak Kurtarma Motoru devrede: {len(candidates)} seri taranacak (Kategori: {category}, Limit: {limit})...")

    healed_count = 0
    total_eps_recovered = 0
    total_srcs_recovered = 0
    start_time = time.time()

    for idx, item in enumerate(candidates, 1):
        did = item['id']
        title = item['title']
        reason = item.get('reason', 'healing')
        empty_cnt = item.get('empty_count', 0)
        provider = choose_provider(item)

        log("PROGRESS", f"[{idx}/{len(candidates)}] #{did} '{title}' ({provider.upper()}) | Durum: {reason} ({empty_cnt} boş/eksik)")

        try:
            eps_add, srcs_add = heal_drama(conn, cur, item)
            if eps_add > 0 or srcs_add > 0:
                healed_count += 1
                total_eps_recovered += eps_add
                total_srcs_recovered += srcs_add
                log("SUCCESS", f"-> #{did} '{title}' başarıyla kurtarıldı! (+{eps_add} bölüm, +{srcs_add} kaynak)")
            else:
                log("NO_CHANGE", f"-> #{did} '{title}' için canlı sağlayıcıda yeni kaynak bulunamadı.")
        except Exception as e:
            log("ERROR", f"-> #{did} '{title}' onarım hatası: {e}")

        # Lightweight passive commit every 10 series (no blocking R2 upload during loop)
        if idx % 10 == 0:
            try:
                conn.commit()
                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
            except Exception:
                pass

    # Final commit and passive WAL checkpoint
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
    conn.close()

    try:
        backup_db_to_r2()
        log("R2_SYNC", "Final veritabanı yedeği Cloudflare R2'ye yüklendi.")
    except Exception as e:
        log("R2_SYNC", f"Final R2 yedekleme hatası: {e}")

    elapsed = round(time.time() - start_time, 1)
    log("SUMMARY", f"Tamamlandı! Süre: {elapsed}s | Onarılan Seri: {healed_count} | Eklenen Bölüm: {total_eps_recovered} | Eklenen Kaynak: {total_srcs_recovered}")
    return healed_count, total_eps_recovered, total_srcs_recovered

def main():
    parser = argparse.ArgumentParser(description="KoUp Universal Source Recovery & Catalog Healing Engine")
    parser.add_argument("--drama-id", type=int, default=None, help="Specific drama ID to heal")
    parser.add_argument("--limit", type=int, default=30, help="Number of series to heal")
    parser.add_argument("--category", type=str, default="all", choices=["all", "anime", "korea", "asia", "western", "turkish"], help="Category filter")
    parser.add_argument("--only-empty", action="store_true", help="Only target series with empty/pending episodes")
    args = parser.parse_args()

    run_recovery(limit=args.limit, category=args.category, only_empty=args.only_empty, drama_id=args.drama_id)

if __name__ == '__main__':
    main()
