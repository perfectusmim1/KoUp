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
    sync_asyawatch_target,
    sync_dizifon_target,
    sync_bldrama_target,
    sync_dizibox_target,
    sync_dizilla_target,
    sync_hdfilm_target,
    sync_animecix_target,
    sync_asyaanimeleri_target,
    sync_ddizi_target,
    log,
)
from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)

ASIAN_COUNTRIES = {'KR', 'JP', 'CN', 'TH', 'TW', 'HK', 'PH', 'ID', 'MY', 'VN', 'SG', 'IN', 'PK'}


def _count_empty_eps(cur, did: int) -> int:
    cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id = ?", (did,))
    total = cur.fetchone()[0]
    if total == 0:
        return 1
    cur.execute("""
        SELECT COUNT(*) FROM episodes e
        WHERE e.drama_id = ?
          AND (e.source_status = 'pending' OR NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id))
    """, (did,))
    return cur.fetchone()[0]


def _min_sources_per_ep(cur, did: int) -> int:
    cur.execute("""
        SELECT MIN(cnt) FROM (
            SELECT COUNT(es.id) as cnt
            FROM episodes e
            LEFT JOIN episode_sources es ON es.episode_id = e.id
            WHERE e.drama_id = ?
            GROUP BY e.id
        )
    """, (did,))
    row = cur.fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _update_local_drama_counts(conn, cur, did: int):
    cur.execute(
        """
        UPDATE dramas
        SET episode_count = (SELECT COUNT(*) FROM episodes WHERE drama_id = ?),
            sources_count = (
                SELECT COUNT(*) FROM episode_sources es
                JOIN episodes e ON e.id = es.episode_id
                WHERE e.drama_id = ?
            )
        WHERE id = ?
        """,
        (did, did, did),
    )
    conn.commit()


def find_candidate_dramas(conn, limit=50, category='all', only_empty=False, max_gap_size=2500):
    cur = conn.cursor()
    
    # Category filter mapping
    cat_sql = ""
    params = []
    
    if category == 'anime':
        cat_sql = "AND LOWER(d.content_type) = 'anime'"
    elif category == 'korea':
        cat_sql = "AND UPPER(d.country) = 'KR' AND LOWER(d.content_type) != 'anime'"
    elif category == 'asia':
        cat_sql = "AND UPPER(d.country) IN ('CN', 'TH', 'JP', 'TW', 'HK', 'PH', 'ID', 'MY', 'IN') AND LOWER(d.content_type) != 'anime'"
    elif category == 'all_asian':
        cat_sql = "AND (UPPER(d.country) IN ('KR', 'JP', 'CN', 'TH', 'TW', 'HK', 'PH', 'ID', 'MY', 'IN') OR LOWER(d.content_type) = 'anime')"
    elif category == 'western':
        cat_sql = "AND UPPER(d.country) NOT IN ('KR', 'JP', 'CN', 'TH', 'TW', 'HK', 'PH', 'ID', 'MY', 'IN', 'TR') AND LOWER(d.content_type) != 'anime'"
    elif category == 'turkish':
        cat_sql = "AND UPPER(d.country) = 'TR'"

    candidates = []

    # 1. Target shows with empty or pending episodes or 0 episodes total (HIGHEST PRIORITY)
    cur.execute(f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url,
               COUNT(DISTINCT e.id) as total_eps,
               CASE WHEN COUNT(DISTINCT e.id) = 0 THEN 1
                    ELSE COUNT(DISTINCT CASE WHEN e.source_status = 'pending' 
                                                  OR NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id) 
                                               THEN e.id END)
               END as empty_eps
        FROM dramas d
        LEFT JOIN episodes e ON e.drama_id = d.id
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

    if ctype == 'anime':
        return 'animecix'
    if country == 'TR' or 'ddizi' in source_url:
        return 'ddizi'
    if country in ASIAN_COUNTRIES or any(k in source_url for k in ('dizikorea', 'asyawatch', 'dizifon', 'asyadizi', 'asyaluna', 'asyaking', 'bldrama', 'webdramaturkey')):
        return 'dizikorea'
    return 'dizibox'


def heal_drama(conn, cur, drama_item, sync_remote=True):
    did = drama_item['id']
    cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
    row = cur.fetchone()
    if not row:
        return 0, 0
    drama = dict(row)

    source_url = (drama.get('source_url') or '').lower()
    country = (drama.get('country') or '').upper()
    ctype = (drama.get('content_type') or '').lower()

    # Build multi-site fallback chain according to content_type & region
    if ctype == 'anime':
        chain = [
            ('animecix', sync_animecix_target),
            ('asyaanimeleri', sync_asyaanimeleri_target),
            ('asyawatch', sync_asyawatch_target),
            ('dizibox', sync_dizibox_target),
        ]
    elif country == 'TR' or 'ddizi' in source_url:
        chain = [
            ('ddizi', sync_ddizi_target),
        ]
    elif country in ASIAN_COUNTRIES or any(k in source_url for k in ('dizikorea', 'asyawatch', 'dizifon', 'asyadizi', 'asyaluna', 'asyaking', 'bldrama', 'webdramaturkey')):
        chain = [
            ('dizikorea', sync_dizikorea_target),
            ('asyawatch', sync_asyawatch_target),
            ('dizifon', sync_dizifon_target),
            ('bldrama', sync_bldrama_target),
            ('dizibox', sync_dizibox_target),
        ]
    else:
        chain = [
            ('dizibox', sync_dizibox_target),
            ('dizilla', sync_dizilla_target),
            ('hdfilm', sync_hdfilm_target),
        ]

    total_eps_added = 0
    total_srcs_added = 0

    for idx, (prov_name, sync_fn) in enumerate(chain):
        empty_rem = _count_empty_eps(cur, did)
        min_srcs = _min_sources_per_ep(cur, did)
        is_native_source = (
            (prov_name == 'bldrama' and ('bldrama' in source_url or 'webdramaturkey' in source_url))
            or (prov_name == 'dizifon' and any(d in source_url for d in ('dizifon', 'asyadizi', 'asyaluna', 'asyaking')))
            or (prov_name == 'asyaanimeleri' and 'asyaanimeleri' in source_url)
            or (prov_name == 'asyawatch' and 'asyawatch' in source_url)
            or (prov_name == 'dizibox' and 'dizibox' in source_url)
        )
        should_run = (idx == 0) or (empty_rem > 0) or (total_srcs_added == 0) or (is_native_source and min_srcs < 2)
        if not should_run:
            continue

        try:
            e_add, s_add = sync_fn(conn, cur, drama)
            total_eps_added += e_add
            total_srcs_added += s_add
        except Exception as e:
            log("ERROR", f"#{did} ({prov_name}) hata: {e}")

    if total_eps_added > 0 or total_srcs_added > 0:
        if sync_remote:
            sync_drama_bundle_and_counts(conn, cur, did)
        else:
            _update_local_drama_counts(conn, cur, did)

    return total_eps_added, total_srcs_added


def run_recovery(limit=30, category='all', only_empty=False, drama_id=None, sync_remote=True):
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
            'empty_count': _count_empty_eps(cur, row['id']),
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
            eps_add, srcs_add = heal_drama(conn, cur, item, sync_remote=sync_remote)
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

    if sync_remote:
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
    parser.add_argument("--no-remote-sync", action="store_true", help="Skip R2 and Supabase sync (local SQLite only)")
    args = parser.parse_args()

    run_recovery(
        limit=args.limit,
        category=args.category,
        only_empty=args.only_empty,
        drama_id=args.drama_id,
        sync_remote=not args.no_remote_sync,
    )


if __name__ == '__main__':
    main()
