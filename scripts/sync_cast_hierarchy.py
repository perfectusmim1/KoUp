"""
Fast Batch Cast Hierarchy & Lead Alignment Script
- Preloads people dictionary in memory
- Fetches official TMDb credits
- Categorizes orders 0..3 as 'lead' ("Başrol") and orders 4+ as 'support' ("Kadro")
- Bulk upserts new people and bulk inserts media_cast
- Runs in seconds
"""

import os
import sys
import re
import requests
from dotenv import load_dotenv

load_dotenv('koup-app/.env.local')

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
TMDB_KEY = os.getenv('TMDB_API_KEY') or os.getenv('NEXT_PUBLIC_TMDB_API_KEY')

if not SUPABASE_KEY or not TMDB_KEY:
    print("Hata: SUPABASE_SERVICE_ROLE_KEY veya TMDB_API_KEY eksik!", flush=True)
    sys.exit(1)

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json'
}

def slugify(text: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9]+', '-', text.lower()).strip('-')
    return s or 'actor'

def main():
    print("=== Supabase & TMDb Hızlı Kadro Hiyerarşisi Senkronizasyonu ===", flush=True)
    
    # 1. Preload existing people cache
    print("Mevcut oyuncu veritabanı önbelleğe alınıyor...", flush=True)
    people_by_tmdb = {}
    people_by_slug = {}
    offset = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/people?select=id,slug,tmdb_id&limit=5000&offset={offset}",
            headers=HEADERS
        )
        data = r.json()
        if not data or not isinstance(data, list):
            break
        for p in data:
            if p.get('tmdb_id'):
                people_by_tmdb[p['tmdb_id']] = p['id']
            if p.get('slug'):
                people_by_slug[p['slug']] = p['id']
        offset += len(data)
        if len(data) < 5000:
            break
            
    print(f"{len(people_by_slug)} oyuncu önbelleğe alındı.", flush=True)
    
    # 2. Get top 50 dramas with tmdb_id
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/media?tmdb_id=not.is.null&select=id,title,tmdb_id,content_type,views_total&order=views_total.desc&limit=50",
        headers=HEADERS
    )
    items = r.json()
    print(f"İncelenecek en popüler yapım adedi: {len(items)}\n", flush=True)
    
    success_count = 0
    for item in items:
        mid = item['id']
        tid = item.get('tmdb_id')
        ctype = item.get('content_type') or 'dizi'
        title = item.get('title') or f"Media #{mid}"
        is_movie = (ctype == 'film')
        
        endpoint = f"https://api.themoviedb.org/3/movie/{tid}/credits?api_key={TMDB_KEY}" if is_movie \
            else f"https://api.themoviedb.org/3/tv/{tid}/credits?api_key={TMDB_KEY}"
            
        try:
            res = requests.get(endpoint, timeout=6)
            if res.status_code != 200 and not is_movie:
                res = requests.get(f"https://api.themoviedb.org/3/tv/{tid}/aggregate_credits?api_key={TMDB_KEY}", timeout=6)
            if res.status_code != 200:
                print(f"[UYARI] {title} (#{mid}): TMDb kredisi bulunamadı ({res.status_code})", flush=True)
                continue
                
            c_data = res.json()
            raw_cast = c_data.get('cast', [])
            if not raw_cast:
                print(f"[UYARI] {title} (#{mid}): TMDb oyuncu listesi boş", flush=True)
                continue
                
            raw_cast.sort(key=lambda x: x.get('order', 999))
            
            # Identify people to create
            new_people_to_insert = []
            cast_plan = []
            
            for idx, c in enumerate(raw_cast[:20]):
                name = c.get('name') or c.get('original_name') or 'Bilinmeyen Oyuncu'
                pslug = slugify(name)
                tmdb_pid = c.get('id')
                char = c.get('character') or ''
                if not char and c.get('roles') and len(c['roles']) > 0:
                    char = c['roles'][0].get('character') or ''
                role = 'lead' if (c.get('order', idx) < 4 and idx < 4) else 'support'
                profile_path = c.get('profile_path')
                img_url = f"https://image.tmdb.org/t/p/w500{profile_path}" if profile_path else None
                order = idx + 1
                
                pid = people_by_tmdb.get(tmdb_pid) or people_by_slug.get(pslug)
                if not pid:
                    new_people_to_insert.append({
                        'name': name,
                        'slug': pslug,
                        'image_url': img_url,
                        'tmdb_id': tmdb_pid,
                        'person_type': 'actor'
                    })
                    
                cast_plan.append({
                    'name': name,
                    'slug': pslug,
                    'tmdb_pid': tmdb_pid,
                    'char': char,
                    'role': role,
                    'order': order,
                    'pid': pid
                })
                
            # Bulk insert new people if any
            if new_people_to_insert:
                p_resp = requests.post(
                    f"{SUPABASE_URL}/rest/v1/people",
                    json=new_people_to_insert,
                    headers={**HEADERS, 'Prefer': 'return=representation'}
                ).json()
                if isinstance(p_resp, list):
                    for np in p_resp:
                        if np.get('tmdb_id'):
                            people_by_tmdb[np['tmdb_id']] = np['id']
                        if np.get('slug'):
                            people_by_slug[np['slug']] = np['id']
                            
            # Assign resolved person_ids
            media_cast_batch = []
            for cp in cast_plan:
                pid = cp['pid'] or people_by_tmdb.get(cp['tmdb_pid']) or people_by_slug.get(cp['slug'])
                if pid:
                    media_cast_batch.append({
                        'media_id': mid,
                        'person_id': pid,
                        'role_type': cp['role'],
                        'character_name': cp['char'],
                        'billing_order': cp['order']
                    })
                    
            if media_cast_batch:
                # Delete existing cast for this media
                requests.delete(f"{SUPABASE_URL}/rest/v1/media_cast?media_id=eq.{mid}", headers=HEADERS)
                # Bulk insert new sorted cast
                requests.post(f"{SUPABASE_URL}/rest/v1/media_cast", json=media_cast_batch, headers=HEADERS)
                
                leads = [x['character_name'] or 'Başrol' for x in media_cast_batch if x['role_type'] == 'lead']
                print(f"[BAŞARILI] {title} (#{mid}): {len(media_cast_batch)} oyuncu (Başroller: {len(leads)} adet)", flush=True)
                success_count += 1
        except Exception as e:
            print(f"[HATA] {title}: {e}", flush=True)
            
    print(f"\nİşlem Tamamlandı! {success_count}/{len(items)} yapımın kadrosu başarıyla güncellendi.", flush=True)

if __name__ == '__main__':
    main()
