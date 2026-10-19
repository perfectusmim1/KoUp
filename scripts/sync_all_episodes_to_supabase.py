"""
SQLite (webdrama_archive.db) -> Supabase (public.episodes)
Tüm bölümleri temiz ve elenmiş video kaynaklarıyla birlikte Supabase'e aktarır.
Depolama kotasını (500MB) korumak için bölüm başına en iyi 2-3 benzersiz sağlayıcı kaynağı seçilir.
"""

import os
import sys
import json
import sqlite3
import requests
import time
from concurrent.futures import ThreadPoolExecutor

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.multisite import clean_episode_title

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://aocvcotmikzlwbaezdpl.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0."
    "JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk"
)
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def sync_episodes():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    print("📊 Supabase üzerinde mevcut media ID'leri alınıyor...")
    all_media_ids = set()
    limit = 1000
    offset = 0
    while True:
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/media?select=id&limit={limit}&offset={offset}", headers=HEADERS, timeout=25)
            if r.status_code != 200:
                break
            rows = r.json()
            if not rows:
                break
            for row in rows:
                all_media_ids.add(row["id"])
            offset += limit
            if len(rows) < limit:
                break
        except Exception:
            break

    print(f"✅ Supabase üzerinde {len(all_media_ids)} yapım doğrulandı.")

    print("🔍 SQLite üzerinden bölümler ve temiz kaynaklar çekiliyor...")
    # Fetch distinct clean sources per episode (max 3 top providers)
    cur.execute("""
        WITH ranked AS (
            SELECT 
                s.episode_id, s.source_name, s.direct_url, s.provider, s.site,
                ROW_NUMBER() OVER (
                    PARTITION BY s.episode_id, COALESCE(s.provider, s.site, 'other')
                    ORDER BY 
                        CASE 
                            WHEN s.direct_url LIKE '%.m3u8%' THEN 1
                            WHEN s.provider = 'asyawatch' OR s.direct_url LIKE '%pichive%' THEN 2
                            WHEN s.provider = 'dizilla' OR s.direct_url LIKE '%dplayer%' THEN 3
                            WHEN s.provider = 'rapidrame' OR s.provider = 'hdfilm-close' THEN 4
                            WHEN s.provider = 'vidmoly' THEN 5
                            WHEN s.provider = 'sibnet' THEN 6
                            WHEN s.provider = 'youtube' THEN 7
                            ELSE 8 
                        END,
                        s.id ASC
                ) as rn
            FROM episode_sources s
            WHERE s.direct_url IS NOT NULL 
              AND s.direct_url != 'dead'
              AND s.direct_url != ''
              AND s.provider != 'dead'
              AND s.direct_url NOT LIKE '%sendvid%'
              AND s.direct_url NOT LIKE '%drive.google.com%'
              AND s.direct_url NOT LIKE '%docs.google.com%'
              AND s.direct_url NOT LIKE '%uns.bio%'
              AND s.direct_url NOT LIKE '%playerdkorea.xyz%'
        ),
        capped AS (
            SELECT episode_id, source_name, direct_url, provider, site,
                ROW_NUMBER() OVER (
                    PARTITION BY episode_id
                    ORDER BY 
                        CASE 
                            WHEN direct_url LIKE '%.m3u8%' THEN 1
                            WHEN provider = 'asyawatch' OR direct_url LIKE '%pichive%' THEN 2
                            WHEN provider = 'dizilla' OR direct_url LIKE '%dplayer%' THEN 3
                            WHEN provider = 'rapidrame' OR provider = 'hdfilm-close' THEN 4
                            WHEN provider = 'vidmoly' THEN 5
                            WHEN provider = 'sibnet' THEN 6
                            WHEN provider = 'youtube' THEN 7
                            ELSE 8 
                        END
                ) as ep_rn
            FROM ranked
            WHERE rn = 1
        )
        SELECT episode_id, source_name, direct_url, provider, site
        FROM capped
        WHERE ep_rn <= 3
    """)
    sources_rows = cur.fetchall()
    print(f"📦 {len(sources_rows)} temiz video kaynağı hafızaya alındı.")

    sources_by_ep = {}
    for s in sources_rows:
        eid, sname, durl, prov, site = s
        stype = "hls" if (".m3u8" in durl or (prov and "hls" in prov)) else ("youtube" if (prov == "youtube" or "youtube" in durl) else "mp4")
        ql = "1080p Doğrudan Akış" if stype == "hls" else ("YouTube HD" if stype == "youtube" else "HD")
        sources_by_ep.setdefault(eid, []).append({
            "source_name": sname or (prov.capitalize() if prov else "Kaynak"),
            "direct_url": durl,
            "embed_id": durl,
            "provider": prov or "other",
            "site": site or "web",
            "stream_type": stype,
            "quality_label": ql,
        })

    # Fetch all episodes belonging to valid Supabase media
    cur.execute("""
        SELECT id, drama_id, season_number, episode_number, episode_name, episode_type
        FROM episodes
        ORDER BY drama_id, season_number, episode_number
    """)
    all_episodes = cur.fetchall()
    conn.close()

    valid_episodes = [ep for ep in all_episodes if ep[1] in all_media_ids]
    print(f"🎬 Senkronize edilecek geçerli bölüm sayısı: {len(valid_episodes)}")

    batches = []
    chunk_size = 200
    current_chunk = []
    seen_keys = set()

    for ep in valid_episodes:
        eid, did, s_num, ep_num, ep_name, ep_type = ep
        key = (did, s_num or 1, ep_num or 1)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        ep_srcs = sources_by_ep.get(eid, [])
        clean_name = clean_episode_title(ep_name, s_num or 1, ep_num or 1)
        current_chunk.append({
            "media_id": did,
            "season_number": s_num or 1,
            "episode_number": ep_num or 1,
            "episode_name": clean_name,
            "episode_type": ep_type or "bolum",
            "status": "published",
            "video_sources": ep_srcs,
        })

        if len(current_chunk) >= chunk_size:
            batches.append(current_chunk)
            current_chunk = []

    if current_chunk:
        batches.append(current_chunk)

    total_batches = len(batches)
    print(f"🚀 Toplam {len(seen_keys)} bölüm, {total_batches} paket halinde Supabase'e gönderiliyor...")

    def send_batch(idx_batch):
        idx, batch = idx_batch
        for attempt in range(3):
            try:
                r = requests.post(
                    f"{SUPABASE_URL}/rest/v1/rpc/sync_episodes_items",
                    headers=HEADERS,
                    json={"items": batch},
                    timeout=30,
                )
                if r.status_code in (200, 201, 204):
                    return len(batch)
                time.sleep(1)
            except Exception:
                time.sleep(2)
        return 0

    total_synced = 0
    with ThreadPoolExecutor(max_workers=4) as executor:
        for idx, res in enumerate(executor.map(send_batch, enumerate(batches))):
            total_synced += res
            if (idx + 1) % 50 == 0 or idx + 1 == total_batches:
                print(f"✅ Supabase Bölüm İlerlemesi: {total_synced}/{len(seen_keys)} bölüm senkronize edildi ({((idx+1)/total_batches)*100:.1f}%).")

    print(f"🎉 Tamamlandı! Toplam {total_synced} bölüm ve video kaynakları Supabase `public.episodes` tablosuna aktarıldı.")

if __name__ == "__main__":
    sync_episodes()
