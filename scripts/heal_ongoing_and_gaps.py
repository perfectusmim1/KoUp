import os
import sys
import sqlite3
import time
import re
from curl_cffi import requests
from bs4 import BeautifulSoup

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.sync_target_drama import (
    sync_dizikorea_target,
    sync_asyawatch_target,
    sync_dizifon_target,
    sync_dizilla_target,
    sync_animecix_target
)

def heal_recent_dramas():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path, timeout=60.0)
    cur = conn.cursor()
    cur.execute("PRAGMA busy_timeout = 60000")

    # DiziKorea ve Asya dizilerinde 4 bölümü olan dizileri tarayalım
    cur.execute("""
        SELECT id, title, source_url, mydramalist_url 
        FROM dramas 
        WHERE source_url LIKE '%dizikorea%' OR source_url LIKE '%asyawatch%'
        ORDER BY id DESC
        LIMIT 30
    """)
    target_dramas = cur.fetchall()
    print(f"🎯 Toplam {len(target_dramas)} güncel Asya/Kore dizisi taranıyor...")

    total_eps_added = 0
    total_srcs_added = 0

    for r in target_dramas:
        did, title, source_url, mdl_url = r
        cur.execute("SELECT count(*) FROM episodes WHERE drama_id = ?", (did,))
        cur_ep_count = cur.fetchone()[0]

        drama_dict = {
            "id": did,
            "title": title,
            "source_url": source_url,
            "mydramalist_url": mdl_url
        }

        print(f"\n🔍 Yapım #{did} ({title}) [Mevcut: {cur_ep_count} bölüm] taranıyor...")
        try:
            if 'dizikorea' in (source_url or ''):
                eps, srcs = sync_dizikorea_target(conn, cur, drama_dict)
                total_eps_added += eps
                total_srcs_added += srcs
                if eps > 0 or srcs > 0:
                    print(f"  ✨ +{eps} yeni bölüm, +{srcs} yeni kaynak eklendi!")
            elif 'asyawatch' in (source_url or ''):
                eps, srcs = sync_asyawatch_target(conn, cur, drama_dict)
                total_eps_added += eps
                total_srcs_added += srcs
                if eps > 0 or srcs > 0:
                    print(f"  ✨ +{eps} yeni bölüm, +{srcs} yeni kaynak eklendi!")
        except Exception as e:
            print(f"  ⚠️ Tarama hatası: {e}")

        # Mevcut bölüm sayısını güncelle
        try:
            cur.execute("""
                UPDATE dramas 
                SET episodes_available = (SELECT count(*) FROM episodes WHERE drama_id = ?)
                WHERE id = ?
            """, (did, did))
            conn.commit()
        except Exception as e:
            print(f"  ⚠️ DB güncelleme hatası: {e}")

    conn.close()
    print(f"\n🎉 Tarama tamamlandı! Toplam +{total_eps_added} yeni bölüm ve +{total_srcs_added} yeni kaynak eklendi.")

if __name__ == "__main__":
    heal_recent_dramas()
