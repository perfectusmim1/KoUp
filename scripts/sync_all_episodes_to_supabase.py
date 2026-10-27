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
import argparse
from concurrent.futures import ThreadPoolExecutor

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.multisite import clean_episode_title
from scrapers.clean_fansub import clean_source_name

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from scrapers.supabase_sync_helper import _load_supabase_creds

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def sync_episodes(include_short_drama: bool = False, drama_id: int = None):
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    if drama_id:
        print(f"🎯 Hedef Drama #{drama_id} için Supabase eşitlemesi başlatılıyor...")
        all_media_ids = {drama_id}
    else:
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
              AND s.provider != 'sibnet'
              AND s.provider != 'sendvid'
              AND s.direct_url NOT LIKE '%sibnet%'
              AND s.direct_url NOT LIKE '%sendvid%'
              AND s.direct_url NOT LIKE '%pixeldrain%'
              AND s.direct_url NOT LIKE '%drive.google.com%'
              AND s.direct_url NOT LIKE '%docs.google.com%'
              AND s.direct_url NOT LIKE '%uns.bio%'
              AND s.direct_url NOT LIKE '%asyaanim.upns.one%'
              AND s.direct_url NOT LIKE '%upns.one%'
              AND s.direct_url NOT LIKE '%upns.live%'
              AND s.direct_url NOT LIKE '%vidmoly.me%'
              AND s.direct_url NOT LIKE '%embed-7fm0wb9yzf4m.html%'
              AND s.direct_url NOT LIKE 'javascript:%'
              AND s.direct_url NOT LIKE '%void(0)%'
        ),
        capped AS (
            SELECT episode_id, source_name, direct_url, provider, site,
                ROW_NUMBER() OVER (
                    PARTITION BY episode_id
                    ORDER BY 
                        CASE 
                            WHEN provider = 'tau-video' OR direct_url LIKE '%tau-video%' THEN 0
                            WHEN direct_url LIKE '%.m3u8%' THEN 1
                            WHEN provider = 'asyawatch' OR direct_url LIKE '%pichive%' THEN 2
                            WHEN provider = 'dizilla' OR direct_url LIKE '%dplayer%' THEN 3
                            WHEN provider = 'rapidrame' OR provider = 'hdfilm-close' THEN 4
                            WHEN provider = 'vidmoly' THEN 5
                            WHEN provider = 'uqload' THEN 6
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
            "source_name": clean_source_name(sname or (prov.capitalize() if prov else "Kaynak")),
            "direct_url": durl,
            "embed_id": durl,
            "provider": prov or "other",
            "site": site or "web",
            "fansub": None,
            "stream_type": stype,
            "quality_label": ql,
        })

    # Identify short drama media IDs
    cur.execute("SELECT id, content_type, genres FROM dramas")
    short_drama_ids = set()
    for did, ctype, genres in cur.fetchall():
        ct = (ctype or "").lower()
        gn = str(genres or "").lower()
        if ct in ("kisa_drama", "short", "short_drama") or "kısa drama" in gn or "kisa drama" in gn:
            short_drama_ids.add(did)

    # Fetch all episodes belonging to valid Supabase media
    if drama_id:
        cur.execute("""
            SELECT id, drama_id, season_number, episode_number, episode_name, episode_type
            FROM episodes
            WHERE drama_id = ?
            ORDER BY drama_id, season_number, episode_number
        """, (drama_id,))
    else:
        cur.execute("""
            SELECT id, drama_id, season_number, episode_number, episode_name, episode_type
            FROM episodes
            ORDER BY drama_id, season_number, episode_number
        """)
    all_episodes = cur.fetchall()
    conn.close()

    if drama_id:
        valid_episodes = all_episodes
        print(f"🎬 Drama #{drama_id} için {len(valid_episodes)} bölüm senkronize edilecek.")
    elif not include_short_drama:
        valid_episodes = [ep for ep in all_episodes if ep[1] in all_media_ids and ep[1] not in short_drama_ids]
        print(f"🎬 Senkronize edilecek geçerli bölüm sayısı: {len(valid_episodes)} ({len(short_drama_ids)} kısa drama yapımı Supabase episodes tablosundan filtrelendi; R2 bundle & media üzerinden çalışır).")
    else:
        valid_episodes = [ep for ep in all_episodes if ep[1] in all_media_ids]
        print(f"🎬 Senkronize edilecek geçerli bölüm sayısı: {len(valid_episodes)} (Kısa dramalar dahil).")

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
    parser = argparse.ArgumentParser(description="Sync SQLite episodes to Supabase public.episodes")
    parser.add_argument("--include-short-drama", action="store_true", help="Include short dramas into Supabase episodes table")
    parser.add_argument("--drama-id", type=int, default=None, help="Specific drama ID to sync episodes for")
    args = parser.parse_args()
    sync_episodes(include_short_drama=args.include_short_drama, drama_id=args.drama_id)
