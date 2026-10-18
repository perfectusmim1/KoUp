"""
KoUp Universal Archive Repair & True Metadata Sync
Fixes:
1. Real IMDb ratings: Fetches actual authoritative IMDb ratings from Cinemeta for all records with imdb_id.
2. Dummy overviews & wrong country codes (e.g. 'US' flag on Chinese/Korean productions).
3. Auto-translation of foreign synopses to Turkish.
4. Clearing invalid MyDramaList links from Western/non-Asian media.
"""

import sys
import os
import re
import json
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

from scrapers.translator import resolve_tmdb_metadata, get_real_imdb_rating, translate_to_turkish, COUNTRY_CODE_TO_NAME

SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', 'https://aocvcotmikzlwbaezdpl.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjkyMDM5MSwiZXhwIjoyMDg4NDk2MzkxfQ.v4S_4_o4x0KzU9n2a2Qf6y7k8_3hY7W9-QeX-0z-1wE')

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

def fetch_supabase(endpoint: str, method: str = 'GET', body: dict = None) -> list | dict | None:
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    req = urllib.request.Request(url, headers=HEADERS, method=method)
    if body is not None:
        req.data = json.dumps(body).encode('utf-8')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode('utf-8')
            return json.loads(data) if data else None
    except Exception as e:
        print(f"Supabase error ({endpoint}): {e}")
        return None

def update_media_row(media_id: int, patch: dict) -> bool:
    endpoint = f"media?id=eq.{media_id}"
    res = fetch_supabase(endpoint, method='PATCH', body=patch)
    return res is not None

# =========================================================================
# PHASE 1: REPAIR REAL IMDB RATINGS
# =========================================================================
def repair_imdb_ratings(limit: int = 200):
    print(f"\n[PHASE 1] Gerçek IMDb Puanları Doğrulanıyor (Cinemeta)...")
    # Fetch rows with an imdb_id
    rows = fetch_supabase(f"media?select=id,title,imdb_id,imdb_rating,content_type&imdb_id=like.tt*&order=id.asc&limit={limit}")
    if not rows:
        print("  Hedef kayıt bulunamadı.")
        return

    print(f"  Toplam {len(rows)} kayıt kontrol ediliyor...")
    updated_count = 0

    def check_and_update(item):
        m_id = item['id']
        imdb_id = item['imdb_id']
        current_rating = float(item['imdb_rating']) if item.get('imdb_rating') else None
        c_type = item.get('content_type') or 'dizi'
        
        real_rating = get_real_imdb_rating(imdb_id, content_type='film' if c_type == 'film' else 'series')
        if real_rating and real_rating > 0:
            if current_rating is None or abs(current_rating - real_rating) >= 0.1:
                update_media_row(m_id, {'imdb_rating': real_rating})
                return (True, item['title'], imdb_id, current_rating, real_rating)
        return (False, None, None, None, None)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(check_and_update, r) for r in rows]
        for f in as_completed(futures):
            changed, title, imdb_id, old_r, new_r = f.result()
            if changed:
                updated_count += 1
                print(f"  [IMDb Puanı Güncellendi] {title[:32]} ({imdb_id}) -> Eski: {old_r} | Yeni: {new_r}")

    print(f"  Faz 1 Tamamlandı: {updated_count} yapımın IMDb puanı gerçek IMDb verisiyle güncellendi.")

# =========================================================================
# PHASE 2: REPAIR DUMMY OVERVIEWS & WRONG COUNTRIES (US -> REAL ASIAN/TMDB)
# =========================================================================
def repair_dummy_overviews_and_countries(limit: int = 150):
    print(f"\n[PHASE 2] Hatalı Açıklamalar ('üzerinden eklendi') ve Yanlış Ülke Kodları Onarılıyor...")
    # Fetch rows with dummy overviews
    rows = fetch_supabase(f"media?select=id,title,slug,release_year,country_code,content_type,overview,imdb_id,cover_image&overview=like.*üzerinden eklendi*&order=id.asc&limit={limit}")
    if not rows:
        print("  Hedef kayıt bulunamadı.")
        return

    print(f"  Toplam {len(rows)} sahte açıklamalı yapım taranıyor...")
    fixed_count = 0

    def process_item(item):
        m_id = item['id']
        title = item['title']
        year = item.get('release_year')
        c_type = item.get('content_type') or 'dizi'
        cur_country = item.get('country_code')

        meta = resolve_tmdb_metadata(title, year=year, country_hint=cur_country if cur_country != 'US' else None, content_type=c_type)
        if not meta:
            return (False, title, "TMDB eşleşmesi bulunamadı")

        patch = {}
        if meta.get('overview') and len(meta['overview']) > 20:
            patch['overview'] = meta['overview']
        if meta.get('country_code') and meta['country_code'] != cur_country:
            patch['country_code'] = meta['country_code']
            patch['country_name'] = meta.get('country_name', COUNTRY_CODE_TO_NAME.get(meta['country_code'], 'Asya'))
        if meta.get('release_year') and (not year or abs(year - meta['release_year']) > 0):
            patch['release_year'] = meta['release_year']
        if meta.get('tmdb_id'):
            patch['tmdb_id'] = meta['tmdb_id']
        if meta.get('imdb_id') and not item.get('imdb_id'):
            patch['imdb_id'] = meta['imdb_id']
        if meta.get('imdb_rating'):
            patch['imdb_rating'] = meta['imdb_rating']
        if meta.get('title_tr'):
            patch['title_tr'] = meta['title_tr']
        if meta.get('native_title'):
            patch['native_title'] = meta['native_title']
        if meta.get('cover_image') and ('logo-dark' in (item.get('cover_image') or '') or not item.get('cover_image')):
            patch['cover_image'] = meta['cover_image']
        if meta.get('backdrop_image'):
            patch['backdrop_image'] = meta['backdrop_image']

        if patch:
            success = update_media_row(m_id, patch)
            return (success, title, f"Ülke: {patch.get('country_code', cur_country)}, Yıl: {patch.get('release_year', year)}, Özet: {len(patch.get('overview', ''))} karakter")
        return (False, title, "Güncelleme gerekmedi")

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(process_item, r) for r in rows]
        for f in as_completed(futures):
            ok, title, note = f.result()
            if ok:
                fixed_count += 1
                print(f"  [Onarıldı #{fixed_count}] {title[:32]} -> {note}")

    print(f"  Faz 2 Tamamlandı: {fixed_count} yapım TMDB + Çeviri ile baştan aşağı onarıldı.")

# =========================================================================
# PHASE 3: CLEAR BOGUS MYDRAMALIST LINKS ON NON-ASIAN TITLES
# =========================================================================
def clean_bogus_mdl_links():
    print(f"\n[PHASE 3] Batı / Global Yapımlardaki Hatalı MyDramaList Bağlantıları Temizleniyor...")
    # Western country codes that should not have an MDL link
    western_countries = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'CA', 'AU']
    rows = fetch_supabase(f"media?select=id,title,country_code,mdl_id,mydramalist_url&country_code=in.({','.join(western_countries)})&mdl_id=not.is.null&limit=200")
    if not rows:
        print("  Hatalı MDL bağlantısı bulunamadı.")
        return

    print(f"  Toplam {len(rows)} kayıt temizleniyor...")
    cleaned = 0
    for r in rows:
        update_media_row(r['id'], {'mdl_id': None, 'mydramalist_url': None})
        cleaned += 1
        print(f"  [MDL Temizlendi] {r['title']} ({r['country_code']})")

    print(f"  Faz 3 Tamamlandı: {cleaned} yapımın hatalı MDL bağlantısı temizlendi.")

if __name__ == '__main__':
    print("=================================================================")
    print("KoUp Veritabanı ve Arşiv Onarım Motoru Başlatıldı")
    print("=================================================================")
    clean_bogus_mdl_links()
    repair_imdb_ratings(limit=150)
    repair_dummy_overviews_and_countries(limit=100)
    print("\n[TAMAMLANDI] Arşiv onarım işlemi başarıyla sona erdi.")
