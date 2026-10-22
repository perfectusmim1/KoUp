"""
KoUp Batch Source Recovery Runner (Current Available Providers)
=============================================================
Runs multi-site healing on candidate series using currently available providers:
- Donghua / Anime: AsyaAnimeleri, AnimeciX, AsyaWatch
- Korean / Asian Drama: DiziKorea, BLDrama, DiziFon, AsyaWatch, DiziBox
- Western: DiziBox, Dizilla

Skips series that cannot be found on current providers and leaves them in 'pending'
status for future integration with the user's new sites.
"""

import sys
import os
import json
import time
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.recover_and_heal_sources import (
    find_candidate_dramas,
    heal_drama,
    _update_local_drama_counts,
    log,
)
from scrapers.sync_target_drama import get_db
from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts, backup_db_to_r2


def run_batch(categories=['anime', 'korea', 'asia'], limit_per_cat=30):
    conn = get_db()
    cur = conn.cursor()

    all_affected_dramas = []
    summary = {
        'healed_dramas': [],
        'skipped_dramas': [],
        'total_eps_added': 0,
        'total_srcs_added': 0,
    }

    start_time = time.time()
    log("BATCH", f"Mevcut desteklenen sağlayıcılarla toplu kaynak kurtarma başlatılıyor (Kategoriler: {categories}, Limit: {limit_per_cat}/kat)...")

    seen_ids = set()
    for cat in categories:
        log("BATCH", f"--- Kategori Taranıyor: {cat.upper()} ---")
        candidates = find_candidate_dramas(conn, limit=limit_per_cat, category=cat, only_empty=True)
        candidates = [c for c in candidates if c['id'] not in seen_ids]
        log("BATCH", f"{len(candidates)} aday dizi tespit edildi.")

        for idx, cand in enumerate(candidates):
            did = cand['id']
            seen_ids.add(did)
            title = cand['title']
            empty_cnt = cand.get('empty_count', 0)
            log("PROGRESS", f"[{idx+1}/{len(candidates)}] #{did} '{title}' ({cat}) | {empty_cnt} boş bölüm")

            try:
                e_add, s_add = heal_drama(conn, cur, cand, sync_remote=False)
                if e_add > 0 or s_add > 0:
                    _update_local_drama_counts(conn, cur, did)
                    all_affected_dramas.append(did)
                    summary['healed_dramas'].append({
                        'id': did,
                        'title': title,
                        'category': cat,
                        'eps_added': e_add,
                        'srcs_added': s_add,
                    })
                    summary['total_eps_added'] += e_add
                    summary['total_srcs_added'] += s_add
                    log("SUCCESS", f"#{did} '{title}' kurtarıldı! (+{e_add} bölüm, +{s_add} kaynak)")
                else:
                    summary['skipped_dramas'].append({
                        'id': did,
                        'title': title,
                        'category': cat,
                        'empty_count': empty_cnt,
                    })
                    log("INFO", f"#{did} '{title}' mevcut sitelerde bulunamadı -> Gelecek yeni siteler için 'pending' bırakıldı.")
            except Exception as e:
                log("ERROR", f"#{did} '{title}' hata: {e}")

    elapsed = round(time.time() - start_time, 1)
    log("SUMMARY", f"Mevcut Sağlayıcılar Taraması Tamamlandı! Süre: {elapsed}s | Kurtarılan Seri: {len(summary['healed_dramas'])} | Eklenen Kaynak: {summary['total_srcs_added']}")

    # Save summary
    summary['affected_ids'] = all_affected_dramas
    out_dir = os.path.join(_ROOT, 'scratch')
    os.makedirs(out_dir, exist_ok=True)
    summary_path = os.path.join(out_dir, 'current_providers_recovery_summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    return all_affected_dramas, summary


if __name__ == '__main__':
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    run_batch(categories=['anime', 'korea', 'asia'], limit_per_cat=limit)
