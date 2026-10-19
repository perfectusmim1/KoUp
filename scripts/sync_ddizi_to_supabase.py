"""
DDizi verilerini SQLite (webdrama_archive.db) -> Supabase (public.media & public.episodes) senkronize eden köprü.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import json
import sqlite3
import requests
from scrapers.multisite import clean_scraped_slug

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY",
    os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
    ),
)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

def sync_ddizi_media():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, slug, title, cover_image, backdrop_image, release_year, overview, categories, tags, alt_sites
        FROM dramas
        WHERE alt_sites LIKE '%ddizi%' OR source_url LIKE '%ddizi%' OR id >= 31496
    """)
    dramas = cur.fetchall()
    print(f"📦 SQLite üzerinde DDizi etiketli {len(dramas)} yapım bulundu.")

    if not dramas:
        conn.close()
        return

    media_payload = []
    for d in dramas:
        did, slug, title, cover, backdrop, rel_year, overview, cats_raw, tags_raw, alts_raw = d
        try:
            cats = json.loads(cats_raw or '[]')
        except:
            cats = ["Yerli Dizi", "Dram"]
        try:
            tags = json.loads(tags_raw or '[]')
        except:
            tags = ["DDizi", "Yerli Dizi"]
        try:
            alts = json.loads(alts_raw or '[]')
        except:
            alts = ["ddizi"]

        cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id=?", (did,))
        ep_count = cur.fetchone()[0] or 1

        year_val = None
        if rel_year:
            try:
                year_val = int(str(rel_year)[:4])
            except:
                year_val = 2015
        else:
            year_val = 2015

        clean_s = clean_scraped_slug(slug) or f"dizi-{did}"
        media_payload.append({
            "id": did,
            "slug": clean_s,
            "content_type": "dizi",
            "country_code": "TR",
            "country_name": "Türkiye",
            "title": title,
            "title_tr": title,
            "title_en": title,
            "overview": overview or f"{title}, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.",
            "release_year": year_val,
            "episode_count": ep_count,
            "duration_minutes": 120,
            "status_broadcast": "Tamamlandı" if year_val < 2024 else "Devam Ediyor",
            "status_translation": "Orijinal Türkçe",
            "cover_image": cover or "https://www.ddizi.tel/images/logo.png",
            "backdrop_image": backdrop or cover or "https://www.ddizi.tel/images/logo.png",
            "categories": cats,
            "tags": tags,
            "alt_sites": alts,
            "views_total": 450,
            "search_text": f"{title} {clean_s} yerli dizi turkce ddizi",
            "is_featured": False
        })

    # Chunked upsert to Supabase via SECURITY DEFINER RPC
    for i in range(0, len(media_payload), 50):
        chunk = media_payload[i:i + 50]
        for attempt in range(3):
            try:
                r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/sync_media_items", headers=HEADERS, json={"items": chunk}, timeout=25)
                if r.status_code in (200, 201, 204):
                    print(f"✅ Supabase Media: {min(i + 50, len(media_payload))}/{len(media_payload)} yapım senkronize edildi.")
                    break
                else:
                    print(f"⚠️ Supabase Media Hata ({r.status_code}): {r.text[:200]}")
            except Exception as e:
                print(f"⚠️ Supabase Media Timeout/Hata (Deneme {attempt+1}): {e}")
                import time; time.sleep(1)

    # Now sync episodes and video sources
    drama_ids = [d[0] for d in dramas]
    placeholders = ",".join("?" for _ in drama_ids)
    cur.execute(f"""
        SELECT id, drama_id, season_number, episode_number, episode_name, episode_type
        FROM episodes
        WHERE drama_id IN ({placeholders})
    """, drama_ids)
    episodes = cur.fetchall()
    print(f"🎬 Senkronize edilecek {len(episodes)} bölüm bulundu.")

    cur.execute(f"""
        SELECT episode_id, source_name, direct_url, provider, site
        FROM episode_sources
        WHERE episode_id IN (
            SELECT id FROM episodes WHERE drama_id IN ({placeholders})
        )
    """, drama_ids)
    sources = cur.fetchall()
    
    sources_by_ep = {}
    for s in sources:
        eid, sname, durl, prov, site = s
        if not durl or durl == 'dead':
            continue
        if prov == 'youtube' or 'youtube' in (durl or ''):
            stype = 'youtube'
            ql = 'YouTube HD'
        elif '.m3u8' in durl or (prov and 'ddizi' in prov and 'mp4' not in durl and 'videoplayback' not in durl):
            stype = 'hls'
            ql = '1080p Doğrudan Akış'
        else:
            stype = 'mp4'
            ql = 'HD Doğrudan MP4'

        sources_by_ep.setdefault(eid, []).append({
            "source_name": sname or ("YouTube HD" if stype == 'youtube' else "DDizi HD"),
            "direct_url": durl,
            "embed_id": durl,
            "provider": prov or "ddizi",
            "site": site or "ddizi",
            "stream_type": stype,
            "quality_label": ql
        })

    episodes_payload = []
    seen_keys = set()
    for ep in episodes:
        eid, did, season, ep_num, ep_name, ep_type = ep
        key = (did, season or 1, ep_num or 1)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        ep_sources = sources_by_ep.get(eid, [])
        episodes_payload.append({
            "id": eid,
            "media_id": did,
            "season_number": season or 1,
            "episode_number": ep_num or 1,
            "episode_name": ep_name or f"{ep_num}. Bölüm",
            "episode_type": ep_type or "bolum",
            "status": "published",
            "video_sources": ep_sources
        })

    for i in range(0, len(episodes_payload), 50):
        chunk = episodes_payload[i:i + 50]
        for attempt in range(3):
            try:
                r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/sync_episodes_items", headers=HEADERS, json={"items": chunk}, timeout=25)
                if r.status_code in (200, 201, 204):
                    print(f"🎥 Supabase Episodes: {min(i + 50, len(episodes_payload))}/{len(episodes_payload)} bölüm senkronize edildi.")
                    break
                else:
                    print(f"⚠️ Supabase Episodes Hata ({r.status_code}): {r.text[:200]}")
            except Exception as e:
                print(f"⚠️ Supabase Episodes Timeout/Hata (Deneme {attempt+1}): {e}")
                import time; time.sleep(1)

    conn.close()
    print("✨ DDizi -> Supabase senkronizasyonu başarıyla tamamlandı!")

if __name__ == '__main__':
    sync_ddizi_media()
