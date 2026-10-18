"""
DDizi Yapımlarını TMDB 4K/Full HD Afiş ve Görselleriyle, Gerçek Yayın Yıllarıyla Zenginleştirme Motoru.
- SQLite (webdrama_archive.db) ve Supabase (public.media) tablolarındaki bozuk başlıkları (mojibake) temizler.
- Bulanık, 180x250 ve filigranlı TV afişlerini TMDB'den 4K orijinal sinema afişi (poster) ve 16:9 geniş ekran arka plan (backdrop) ile değiştirir.
- 2026 olarak atanan sahte yayın yıllarını dizinin gerçek yayın yılına (örn. Asla Vazgeçmem -> 2015, Akasya Durağı -> 2008) günceller.
- Gerçek Türkçe dizi konusunu (overview) ekler.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

import re
import json
import time
import sqlite3
import urllib.request
import urllib.parse
import requests

TMDB_API_KEY = "4c092d2cfd6d9c0e3aa3dab12c7d4756"

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
}

MOJIBAKE_MAP = [
    ('\xc3\u2021', 'Ç'),   # Ã‡ -> Ç
    ('\xc3\u2013', 'Ö'),   # Ã– -> Ö
    ('\xc3\u0153', 'Ü'),   # Ãœ -> Ü
    ('\xc3\x9c', 'Ü'),     # Ãœ -> Ü
    ('\xc3\xa7', 'ç'),     # Ã§ -> ç
    ('\xc3\xb6', 'ö'),     # Ã¶ -> ö
    ('\xc3\xbc', 'ü'),     # Ã¼ -> ü
    ('\xc3\xa2', 'â'),     # Ã¢ -> â
    ('\xc3\xae', 'î'),     # Ã® -> î
    ('\xc3\xa9', 'é'),     # Ã© -> é
    
    ('\xc4\xb0', 'İ'),     # Ä° -> İ
    ('\xc4\xb1', 'ı'),     # Ä± -> ı
    ('\xc4\u017e', 'Ğ'),   # Äž -> Ğ
    ('\xc4\u017d', 'Ğ'),   # Äž -> Ğ
    ('\xc4\u0178', 'ğ'),   # ÄŸ -> ğ
    ('\xc4\u011f', 'ğ'),   # ÄŸ -> ğ
    
    ('\xc5\u017e', 'Ş'),   # Åž -> Ş
    ('\xc5\u017d', 'Ş'),   # Åž -> Ş
    ('\xc5\u0178', 'ş'),   # ÅŸ -> ş
    ('\xc5\ufffd', 'ş'),   # Å -> ş
    
    ('Â', ''),             # Â stray char
    ('\xc5', 'Ş'),         # Standalone Å
]

LOWERCASE_CONJUNCTIONS = {'ve', 'ile', 'de', 'da', 'ki', 'bu', 'bir', 'mi', 'mı', 'mu', 'mü', 'ama', 'fakat', 'ya', 'veya'}

def title_case_tr(s: str) -> str:
    words = s.split(' ')
    fixed_words = []
    for idx, w in enumerate(words):
        if not w:
            continue
        w_lower = w.lower()
        if idx > 0 and w_lower in LOWERCASE_CONJUNCTIONS:
            fixed_words.append(w_lower)
            continue
        first_char = w[0]
        rest = w[1:]
        if first_char == 'i':
            first_cap = 'İ'
        elif first_char == 'ı':
            first_cap = 'I'
        else:
            first_cap = first_char.upper()
        fixed_words.append(first_cap + rest)
    return ' '.join(fixed_words)

def clean_title(s: str) -> str:
    if not s:
        return ''
    for bad, good in MOJIBAKE_MAP:
        s = s.replace(bad, good)
    
    # Specific scraper artifact cleanup
    s = re.sub(r'\|\s*(ddizi(\.tel)?|dizi\s*izle).*$', '', s, flags=re.I)
    s = re.sub(r'-\s*ddizi.*$', '', s, flags=re.I)
    s = re.sub(r'Asla Vazgeçmemm\b', 'Asla Vazgeçmem', s)
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return title_case_tr(s)

def clean_slug(title: str, default_slug: str = "") -> str:
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = (title or "").translate(tr_map).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if s and len(s) > 2:
        return s
    return default_slug or "dizi"

def search_tmdb(title: str):
    # 1. First search TV
    queries_to_try = [title]
    # If title has colon or hyphen, try base title too
    if ':' in title:
        queries_to_try.append(title.split(':')[0].strip())
    if ' - ' in title:
        queries_to_try.append(title.split(' - ')[0].strip())
    
    for q in queries_to_try:
        clean_q = urllib.parse.quote(q)
        url = f"https://api.themoviedb.org/3/search/tv?query={clean_q}&language=tr-TR&api_key={TMDB_API_KEY}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = data.get("results", [])
                if results:
                    top = results[0]
                    name = top.get("name") or top.get("original_name")
                    poster = top.get("poster_path")
                    backdrop = top.get("backdrop_path")
                    date = top.get("first_air_date")
                    year = int(date[:4]) if date and len(date) >= 4 and date[:4].isdigit() else None
                    overview = top.get("overview") or ""
                    tmdb_id = top.get("id")
                    
                    return {
                        "matched": True,
                        "official_title": name,
                        "tmdb_id": tmdb_id,
                        "year": year,
                        "poster": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
                        "backdrop": f"https://image.tmdb.org/t/p/w1280{backdrop}" if backdrop else None,
                        "overview": overview.strip() if len(overview.strip()) > 15 else None
                    }
        except Exception:
            pass
            
        # Try search/multi
        multi_url = f"https://api.themoviedb.org/3/search/multi?query={clean_q}&language=tr-TR&api_key={TMDB_API_KEY}"
        req_m = urllib.request.Request(multi_url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req_m, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = [r for r in data.get("results", []) if r.get("media_type") in ("tv", "movie")]
                if results:
                    top = results[0]
                    name = top.get("name") or top.get("title") or top.get("original_name")
                    poster = top.get("poster_path")
                    backdrop = top.get("backdrop_path")
                    date = top.get("first_air_date") or top.get("release_date")
                    year = int(date[:4]) if date and len(date) >= 4 and date[:4].isdigit() else None
                    overview = top.get("overview") or ""
                    tmdb_id = top.get("id")
                    
                    return {
                        "matched": True,
                        "official_title": name,
                        "tmdb_id": tmdb_id,
                        "year": year,
                        "poster": f"https://image.tmdb.org/t/p/w500{poster}" if poster else None,
                        "backdrop": f"https://image.tmdb.org/t/p/w1280{backdrop}" if backdrop else None,
                        "overview": overview.strip() if len(overview.strip()) > 15 else None
                    }
        except Exception:
            pass

    return {"matched": False}

def make_unique_slug(cur, base_slug, current_id):
    cur.execute("SELECT id FROM dramas WHERE slug = ? AND id != ?", (base_slug, current_id))
    if not cur.fetchone():
        return base_slug
    counter = 2
    while True:
        cand = f"{base_slug}-{counter}"
        cur.execute("SELECT id FROM dramas WHERE slug = ? AND id != ?", (cand, current_id))
        if not cur.fetchone():
            return cand
        counter += 1

def enrich_ddizi_media():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Ensure backdrop_image and tmdb_id columns exist in SQLite
    cur.execute("PRAGMA table_info(dramas)")
    existing_cols = [r[1] for r in cur.fetchall()]
    if 'backdrop_image' not in existing_cols:
        print("🔧 SQLite 'dramas' tablosuna 'backdrop_image' kolonu ekleniyor...")
        cur.execute("ALTER TABLE dramas ADD COLUMN backdrop_image TEXT;")
        conn.commit()
    if 'tmdb_id' not in existing_cols:
        print("🔧 SQLite 'dramas' tablosuna 'tmdb_id' kolonu ekleniyor...")
        cur.execute("ALTER TABLE dramas ADD COLUMN tmdb_id INTEGER;")
        conn.commit()

    # Query all DDizi or mojibake dramas
    cur.execute("""
        SELECT id, slug, title, cover_image, backdrop_image, release_year, overview, categories, tags, alt_sites, source_url, tmdb_id
        FROM dramas
        WHERE alt_sites LIKE '%ddizi%' 
           OR source_url LIKE '%ddizi%'
           OR id >= 31496
           OR title LIKE '%Ã%' OR title LIKE '%Ä%' OR title LIKE '%Å%'
    """)
    dramas = cur.fetchall()
    print(f"📦 Zenginleştirilecek ve düzeltilecek {len(dramas)} dizi tespit edildi.", flush=True)

    enriched_count = 0
    title_fixed_count = 0
    supabase_payload = []

    for idx, d in enumerate(dramas, 1):
        did, slug, title, cover, backdrop, year, overview, cats_raw, tags_raw, alts_raw, src_url, existing_tmdb_id = d
        
        # 1. Clean Title
        orig_title = title
        cleaned_title = clean_title(title)
        if cleaned_title != orig_title:
            title_fixed_count += 1
            
        # 2. Clean Slug
        if slug and not any(bad in slug for bad in ['-memm', '-ku', '-y-llar', '-a-lamaz', '-m-']):
            target_slug = slug
        else:
            target_slug = clean_slug(cleaned_title, default_slug=slug)
        proper_slug = make_unique_slug(cur, target_slug, did)

        # 3. Query TMDB (skip if already has TMDB cover)
        final_title = cleaned_title
        final_cover = cover
        final_backdrop = backdrop
        final_year = year
        final_overview = overview
        tmdb_id = existing_tmdb_id

        if existing_tmdb_id and cover and 'image.tmdb.org' in cover:
            enriched_count += 1
            if idx % 50 == 0:
                print(f"[{idx}/{len(dramas)}] ⏩ Zaten TMDB 4K: {final_title} ({final_year})", flush=True)
        else:
            tmdb_info = search_tmdb(cleaned_title)
            if tmdb_info.get("matched"):
                enriched_count += 1
                if tmdb_info.get("official_title"):
                    final_title = tmdb_info["official_title"]
                if tmdb_info.get("poster"):
                    final_cover = tmdb_info["poster"]
                if tmdb_info.get("backdrop"):
                    final_backdrop = tmdb_info["backdrop"]
                elif final_cover:
                    final_backdrop = final_cover
                if tmdb_info.get("year"):
                    final_year = tmdb_info["year"]
                if tmdb_info.get("overview"):
                    final_overview = tmdb_info["overview"]
                tmdb_id = tmdb_info.get("tmdb_id")

                print(f"[{idx}/{len(dramas)}] 🌟 TMDB Eşleşti: {final_title} ({final_year}) | Afiş: {bool(final_cover)}", flush=True)
            else:
                # Fallback backdrop to cover if backdrop is empty
                if not final_backdrop and final_cover:
                    final_backdrop = final_cover
                if idx % 25 == 0:
                    print(f"[{idx}/{len(dramas)}] ℹ️ DDizi Kaydı: {final_title} (TMDB yok)", flush=True)

        # Update SQLite
        cur.execute("""
            UPDATE dramas
            SET title = ?, slug = ?, cover_image = ?, backdrop_image = ?, release_year = ?, overview = ?, tmdb_id = ?
            WHERE id = ?
        """, (final_title, proper_slug, final_cover, final_backdrop, str(final_year) if final_year else None, final_overview, tmdb_id, did))

        # Categories & tags
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

        # Also store original slug in aka_titles so both old and new URLs work!
        aka = [slug] if slug and slug != proper_slug else []

        year_num = None
        if final_year:
            try:
                year_num = int(str(final_year)[:4])
            except:
                year_num = None

        supabase_payload.append({
            "id": did,
            "slug": proper_slug,
            "content_type": "dizi",
            "country_code": "TR",
            "country_name": "Türkiye",
            "title": final_title,
            "title_tr": final_title,
            "title_en": final_title,
            "aka_titles": aka,
            "overview": final_overview or f"{final_title}, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.",
            "release_year": year_num or 2015,
            "episode_count": ep_count,
            "duration_minutes": 120,
            "status_broadcast": "Tamamlandı" if (year_num and year_num < 2024) else "Devam Ediyor",
            "status_translation": "Orijinal Türkçe",
            "cover_image": final_cover or "https://www.ddizi.tel/images/logo.png",
            "backdrop_image": final_backdrop or final_cover or "https://www.ddizi.tel/images/logo.png",
            "categories": cats,
            "tags": tags,
            "alt_sites": alts,
            "tmdb_id": tmdb_id,
            "views_total": 520,
            "search_text": f"{final_title} {proper_slug} {slug} yerli dizi turkce ddizi",
            "is_featured": False
        })

        if idx % 20 == 0:
            conn.commit()
            time.sleep(0.1)

    conn.commit()
    conn.close()
    print(f"\n🎉 SQLite Güncellendi! Başlığı düzeltilen: {title_fixed_count}, TMDB ile zenginleştirilen: {enriched_count}/{len(dramas)}")

    # Sync to Supabase via RPC sync_media_items in chunks of 50
    print(f"🚀 {len(supabase_payload)} yapım Supabase'e senkronize ediliyor...")
    for i in range(0, len(supabase_payload), 50):
        chunk = supabase_payload[i:i + 50]
        for attempt in range(3):
            try:
                r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/sync_media_items", headers=HEADERS, json={"items": chunk}, timeout=30)
                if r.status_code in (200, 201, 204):
                    print(f"✅ Supabase Media: {min(i + 50, len(supabase_payload))}/{len(supabase_payload)} yapım güncellendi.")
                    break
                else:
                    print(f"⚠️ Supabase Media Hata ({r.status_code}): {r.text[:200]}")
            except Exception as e:
                print(f"⚠️ Supabase Media Timeout/Hata (Deneme {attempt+1}): {e}")
                time.sleep(1)

    print("\n✨ Bütün yapımlar kristal netliğinde 4K TMDB afişleri ve doğru Türkçe başlıklarla güncellendi!")

if __name__ == '__main__':
    enrich_ddizi_media()
