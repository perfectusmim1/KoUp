import os
import sys
import sqlite3
import json
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts, _load_supabase_creds
import requests

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()

def clean_phantom_gaps():
    db_path = os.path.join(_ROOT, 'webdrama_archive.db')
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Step 1: Detect phantom gaps
    # A) All gaps in dramas where gap_count > 15
    # B) Prefix gaps where ep_num < min(real_ep_num)
    cur.execute('''
        SELECT e.id, e.drama_id, e.season_number, e.episode_number, e.episode_url
        FROM episodes e
        ORDER BY e.drama_id, e.season_number, e.episode_number
    ''')
    all_eps = cur.fetchall()

    real_min_per_season = {}
    gap_ids_per_drama = defaultdict(list)
    prefix_gap_ids = set()

    for eid, did, snum, enum, eurl in all_eps:
        snum = snum or 1
        key = (did, snum)
        if eurl and eurl.startswith('pending://gap/'):
            gap_ids_per_drama[did].append(eid)
        else:
            if key not in real_min_per_season or enum < real_min_per_season[key]:
                real_min_per_season[key] = enum

    # Check prefix gaps
    for eid, did, snum, enum, eurl in all_eps:
        if eurl and eurl.startswith('pending://gap/'):
            snum = snum or 1
            key = (did, snum)
            min_real = real_min_per_season.get(key)
            if min_real is not None and enum < min_real:
                prefix_gap_ids.add(eid)

    # Combine phantom gap IDs:
    # 1. Any gap in drama with > 15 gaps
    # 2. Any prefix gap
    phantom_gap_ids = set()
    dramas_affected = set()

    for did, g_ids in gap_ids_per_drama.items():
        if len(g_ids) > 15:
            phantom_gap_ids.update(g_ids)
            dramas_affected.add(did)

    for eid in prefix_gap_ids:
        phantom_gap_ids.add(eid)

    print(f"Toplam tespit edilen yapay/hayalet boşluk sayısı: {len(phantom_gap_ids)}")
    print(f"Etkilenen dizi sayısı: {len(dramas_affected)}")

    if not phantom_gap_ids:
        print("Temizlenecek hayalet boşluk bulunamadı.")
        return

    # Delete phantom gap episodes from SQLite
    p_list = list(phantom_gap_ids)
    BATCH = 500
    for i in range(0, len(p_list), BATCH):
        batch = p_list[i:i+BATCH]
        qmarks = ','.join('?' for _ in batch)
        cur.execute(f"DELETE FROM episodes WHERE id IN ({qmarks})", batch)

    conn.commit()
    print(f"{len(p_list)} adet yapay boşluk kaydı SQLite 'episodes' tablosundan silindi.")

    # Re-sync bundles for affected dramas
    print(f"{len(dramas_affected)} adet etkilenen dizinin R2 paketleri ve Supabase kayıtları güncelleniyor...")
    synced = 0
    for did in dramas_affected:
        try:
            sync_drama_bundle_and_counts(conn, cur, did)
            synced += 1
            if synced % 50 == 0:
                print(f"  {synced}/{len(dramas_affected)} dizi güncellendi...")
        except Exception as e:
            print(f"  Hata (Dizi {did}): {e}")

    conn.commit()
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print(f"\nBaşarıyla tamamlandı! {len(phantom_gap_ids)} adet sahte boşluk silindi, {synced} dizi temizlendi.")

if __name__ == '__main__':
    clean_phantom_gaps()
