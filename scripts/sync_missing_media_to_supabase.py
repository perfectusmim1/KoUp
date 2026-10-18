"""
SQLite (webdrama_archive.db) -> Supabase (public.media)
Eksik 4,931 yapımı Supabase media tablosuna toplu senkronize eder.
"""

import os
import sys
import json
import sqlite3
import requests
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

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

def sync_missing_media():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    print("🔍 Supabase üzerindeki mevcut yapım ID'leri alınıyor...")
    all_supabase_ids = set()
    limit = 1000
    offset = 0
    while True:
        try:
            r = requests.get(f"{SUPABASE_URL}/rest/v1/media?select=id&limit={limit}&offset={offset}", headers=HEADERS, timeout=30)
            if r.status_code != 200:
                print(f"Hata ({r.status_code}): {r.text[:200]}")
                break
            rows = r.json()
            if not rows:
                break
            for row in rows:
                all_supabase_ids.add(row["id"])
            offset += limit
            if len(rows) < limit:
                break
        except Exception as e:
            print(f"Supabase ID alma hatası: {e}")
            time.sleep(2)

    print(f"✅ Supabase üzerinde {len(all_supabase_ids)} yapım bulundu.")

    cur.execute("""
        SELECT id, slug, title, native_title, cover_image, backdrop_image,
               country, country_name, release_year, episode_count,
               status_broadcast, status_translation, overview, categories,
               tags, content_type, alt_sites, tmdb_id
        FROM dramas
    """)
    all_sqlite_dramas = cur.fetchall()
    conn.close()

    missing_dramas = [d for d in all_sqlite_dramas if d[0] not in all_supabase_ids]
    print(f"📦 Supabase'e aktarılacak eksik yapım sayısı: {len(missing_dramas)}")

    if not missing_dramas:
        print("Tüm yapımlar zaten Supabase üzerinde mevcut!")
        return

    payload = []
    for d in missing_dramas:
        (
            did, slug, title, native_title, cover, backdrop,
            country, country_name, rel_year, ep_count,
            st_broad, st_trans, overview, cats_raw,
            tags_raw, ctype, alts_raw, tmdb_id
        ) = d

        try:
            cats = json.loads(cats_raw) if cats_raw else []
            if not isinstance(cats, list): cats = [str(cats)]
        except:
            cats = []

        try:
            tags = json.loads(tags_raw) if tags_raw else []
            if not isinstance(tags, list): tags = [str(tags)]
        except:
            tags = []

        try:
            alts = json.loads(alts_raw) if alts_raw else []
            if not isinstance(alts, list): alts = [str(alts)]
        except:
            alts = []

        year_val = None
        if rel_year:
            try:
                year_val = int(str(rel_year)[:4])
            except:
                year_val = None

        c_code = country or ("KR" if ctype in ("dizi", "kdrama") else ("TR" if "ddizi" in alts else "US"))
        c_name = country_name or (
            "Güney Kore" if c_code == "KR" else (
                "Japonya" if c_code == "JP" else (
                    "Çin" if c_code == "CN" else (
                        "Tayland" if c_code == "TH" else (
                            "Türkiye" if c_code == "TR" else "Diğer"
                        )
                    )
                )
            )
        )

        payload.append({
            "id": did,
            "slug": slug or f"yapim-{did}",
            "content_type": ctype or "dizi",
            "country_code": c_code,
            "country_name": c_name,
            "title": title or f"Yapım #{did}",
            "title_tr": title,
            "title_en": title,
            "native_title": native_title,
            "overview": overview or f"{title} serisi hakkında detaylar ve tüm bölümler.",
            "release_year": year_val,
            "episode_count": ep_count or 1,
            "duration_minutes": 60 if ctype != "film" else 120,
            "status_broadcast": st_broad or "Tamamlandı",
            "status_translation": st_trans or "Tamamlandı",
            "cover_image": cover,
            "backdrop_image": backdrop or cover,
            "categories": cats,
            "tags": tags,
            "alt_sites": alts,
            "tmdb_id": int(tmdb_id) if tmdb_id and str(tmdb_id).isdigit() else None,
            "aka_titles": [],
            "views_total": 150,
            "search_text": f"{title} {slug} {c_name} {ctype}".strip(),
            "is_featured": False
        })

    # Chunked upsert via RPC
    chunk_size = 50
    total = len(payload)
    success_count = 0

    print(f"🚀 {total} yapım {chunk_size}'lik paketlerle Supabase'e gönderiliyor...")
    for i in range(0, total, chunk_size):
        chunk = payload[i:i + chunk_size]
        for attempt in range(3):
            try:
                r = requests.post(
                    f"{SUPABASE_URL}/rest/v1/rpc/sync_media_items",
                    headers=HEADERS,
                    json={"items": chunk},
                    timeout=30
                )
                if r.status_code in (200, 201, 204):
                    success_count += len(chunk)
                    if (i + chunk_size) % 500 == 0 or i + chunk_size >= total:
                        print(f"✅ Supabase Media: {min(i + chunk_size, total)}/{total} aktarıldı.")
                    break
                else:
                    print(f"⚠️ Hata (Durum {r.status_code}): {r.text[:200]}")
                    time.sleep(1)
            except Exception as e:
                print(f"⚠️ Bağlantı hatası (Deneme {attempt+1}): {e}")
                time.sleep(2)

    print(f"🎉 Tamamlandı! Toplam {success_count}/{total} eksik yapım Supabase `public.media` tablosuna başarıyla aktarıldı.")

if __name__ == "__main__":
    sync_missing_media()
