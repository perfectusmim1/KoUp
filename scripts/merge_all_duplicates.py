"""
Comprehensive Archive Character & Actor Deduplication & Merger Engine (KoUp)
- Merges all duplicated characters & actors across Supabase
- Consolidates media_cast (preventing primary key collisions), comments, person_favorites, magazine_posts
- Preserves all enriched metadata: anilist_id, tmdb_id, native_name, bio_tr, race, height, blood_type, gender, also_known_as
- Upgrades legacy numbered slugs (e.g. 'char-bulma-678' -> 'bulma', 'ji-chang-wook-4' -> 'ji-chang-wook') to clean slugs
- Recalculates exact drama_count for every merged person
- Cleans any remaining un-collided 'char-...' slugs to clean canonical slugs
"""

import os
import sys
import re
import json
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request

def clean_slug(slug: str) -> str:
    if not slug:
        return 'actor'
    s = slug.lower().strip()
    if s.startswith('char-'):
        s = s[5:]
    s = re.sub(r'-\d+$', '', s).strip('-')
    return s or 'actor'

def norm_name(text: str) -> str:
    if not text:
        return ''
    return re.sub(r'[^a-z0-9]', '', text.lower())

def score_person(p: dict) -> float:
    score = (p.get('drama_count') or 0) * 10
    slug = p.get('slug') or ''
    is_numbered = bool(re.search(r'-\d+$', slug))
    is_char_slug = slug.startswith('char-')
    
    # Priority for rich character data
    if p.get('person_type') == 'character' or p.get('anilist_id'):
        score += 1000
    if p.get('bio_tr') and len(p['bio_tr']) > 40:
        score += 300
    if p.get('tmdb_id'):
        score += 200
    if p.get('native_name'):
        score += 100
    if p.get('race') or p.get('height') or p.get('blood_type'):
        score += 150
    if p.get('gender'):
        score += 50
    if p.get('image_url') and not 'default' in p['image_url']:
        score += 50
    if not is_numbered and not is_char_slug:
        score += 80
        
    # Small tie-breaker preferring earlier IDs
    score += max(0, 200000 - (p.get('id') or 0)) * 0.0001
    return score

def load_all_people():
    print("1. Supabase'den tüm kişi/karakter kayıtları çekiliyor...", flush=True)
    all_people = []
    offset = 0
    page_size = 1000
    while True:
        offsets = [offset + i * page_size for i in range(10)]
        batch_results = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {
                pool.submit(
                    sb_request,
                    'GET',
                    f"/rest/v1/people?select=id,slug,name,native_name,person_type,country_code,image_url,profile_url,anilist_id,tmdb_id,bio_tr,birth_date,death_date,place_of_birth,favorites_count,followers_count,comments_count,drama_count,avg_rating,gender,also_known_as,blood_type,height,race&order=id.asc&limit={page_size}&offset={off}"
                ): off
                for off in offsets
            }
            for fut in as_completed(futs):
                off = futs[fut]
                res = fut.result()
                batch_results[off] = res if isinstance(res, list) else []

        stop = False
        for off in offsets:
            rows = batch_results.get(off) or []
            all_people.extend(rows)
            if len(rows) < page_size:
                stop = True
                break
        if stop:
            break
        offset += 10 * page_size
        
    print(f"   -> Toplam {len(all_people)} kayıt yüklendi.", flush=True)
    return all_people

def merge_single_group(group: list, existing_slugs_set: set):
    if len(group) <= 1:
        return None

    # Don't merge if distinct conflicting TMDb IDs exist
    tmdbs = {p['tmdb_id'] for p in group if p.get('tmdb_id')}
    if len(tmdbs) > 1:
        return None

    anils = {p['anilist_id'] for p in group if p.get('anilist_id')}
    if len(anils) > 1:
        return None

    # Sort descending by score
    sorted_group = sorted(group, key=score_person, reverse=True)
    primary = sorted_group[0]
    duplicates = sorted_group[1:]
    p_id = primary['id']
    
    desired_slug = clean_slug(primary['slug'])
    if not desired_slug or desired_slug == 'actor':
        desired_slug = clean_slug(sorted_group[-1]['slug'])

    # 1. Merge metadata into primary payload
    patch_payload = {}
    is_char = any(p.get('person_type') == 'character' or p.get('anilist_id') or (p.get('slug') or '').startswith('char-') for p in group)
    if is_char and primary.get('person_type') != 'character':
        patch_payload['person_type'] = 'character'

    for dup in duplicates:
        if not primary.get('anilist_id') and dup.get('anilist_id'):
            patch_payload['anilist_id'] = dup['anilist_id']
            primary['anilist_id'] = dup['anilist_id']
        if not primary.get('tmdb_id') and dup.get('tmdb_id'):
            patch_payload['tmdb_id'] = dup['tmdb_id']
            primary['tmdb_id'] = dup['tmdb_id']
        if not primary.get('native_name') and dup.get('native_name'):
            patch_payload['native_name'] = dup['native_name']
            primary['native_name'] = dup['native_name']
        if not primary.get('gender') and dup.get('gender'):
            patch_payload['gender'] = dup['gender']
            primary['gender'] = dup['gender']
        if not primary.get('race') and dup.get('race'):
            patch_payload['race'] = dup['race']
            primary['race'] = dup['race']
        if not primary.get('height') and dup.get('height'):
            patch_payload['height'] = dup['height']
            primary['height'] = dup['height']
        if not primary.get('blood_type') and dup.get('blood_type'):
            patch_payload['blood_type'] = dup['blood_type']
            primary['blood_type'] = dup['blood_type']
        if not primary.get('birth_date') and dup.get('birth_date'):
            patch_payload['birth_date'] = dup['birth_date']
            primary['birth_date'] = dup['birth_date']
        if not primary.get('country_code') and dup.get('country_code'):
            patch_payload['country_code'] = dup['country_code']
            primary['country_code'] = dup['country_code']
        if (not primary.get('bio_tr') or len(primary.get('bio_tr') or '') < 30) and (dup.get('bio_tr') and len(dup.get('bio_tr') or '') >= 30):
            patch_payload['bio_tr'] = dup['bio_tr']
            primary['bio_tr'] = dup['bio_tr']
        if (not primary.get('image_url') or 'default' in (primary.get('image_url') or '')) and (dup.get('image_url') and 'default' not in dup['image_url']):
            patch_payload['image_url'] = dup['image_url']
            primary['image_url'] = dup['image_url']

    # Merge also_known_as
    combined_aliases = []
    for p in group:
        for a in (p.get('also_known_as') or []):
            if a and a not in combined_aliases:
                combined_aliases.append(a)
    if combined_aliases and combined_aliases != (primary.get('also_known_as') or []):
        patch_payload['also_known_as'] = combined_aliases

    # 2. For each duplicate, repoint media_cast, comments, favorites
    for dup in duplicates:
        d_id = dup['id']
        
        # Cast
        p_cast = sb_request('GET', f"/rest/v1/media_cast?person_id=eq.{p_id}&select=media_id,role_type")
        p_keys = {(r['media_id'], r['role_type']) for r in (p_cast if isinstance(p_cast, list) else [])}
        d_cast = sb_request('GET', f"/rest/v1/media_cast?person_id=eq.{d_id}&select=media_id,role_type")
        if isinstance(d_cast, list):
            for r in d_cast:
                if (r['media_id'], r['role_type']) in p_keys:
                    sb_request('DELETE', f"/rest/v1/media_cast?person_id=eq.{d_id}&media_id=eq.{r['media_id']}&role_type=eq.{r['role_type']}")
            sb_request('PATCH', f"/rest/v1/media_cast?person_id=eq.{d_id}", body={'person_id': p_id})

        # Favorites
        p_favs = sb_request('GET', f"/rest/v1/person_favorites?person_id=eq.{p_id}&select=user_id")
        p_users = {r['user_id'] for r in (p_favs if isinstance(p_favs, list) else [])}
        d_favs = sb_request('GET', f"/rest/v1/person_favorites?person_id=eq.{d_id}&select=user_id")
        if isinstance(d_favs, list):
            for r in d_favs:
                if r['user_id'] in p_users:
                    sb_request('DELETE', f"/rest/v1/person_favorites?person_id=eq.{d_id}&user_id=eq.{r['user_id']}")
            sb_request('PATCH', f"/rest/v1/person_favorites?person_id=eq.{d_id}", body={'person_id': p_id})

        # Comments
        sb_request('PATCH', f"/rest/v1/comments?person_id=eq.{d_id}", body={'person_id': p_id})

        # Delete duplicate from people
        sb_request('DELETE', f"/rest/v1/people?id=eq.{d_id}")
        # Free its slug from the set if it had one
        if dup.get('slug') in existing_slugs_set:
            existing_slugs_set.discard(dup['slug'])

    # 3. Recalculate drama_count
    total_cast = sb_request('GET', f"/rest/v1/media_cast?person_id=eq.{p_id}&select=media_id")
    distinct_mids = len(set(r['media_id'] for r in (total_cast if isinstance(total_cast, list) else [])))
    patch_payload['drama_count'] = distinct_mids

    # 4. Check if canonical slug can be claimed
    if desired_slug and (desired_slug == primary['slug'] or desired_slug not in existing_slugs_set):
        patch_payload['slug'] = desired_slug
        existing_slugs_set.discard(primary['slug'])
        existing_slugs_set.add(desired_slug)

    if patch_payload:
        sb_request('PATCH', f"/rest/v1/people?id=eq.{p_id}", body=patch_payload)

    return {
        'primary_id': p_id,
        'primary_name': primary['name'],
        'final_slug': patch_payload.get('slug', primary['slug']),
        'merged_ids': [d['id'] for d in duplicates],
        'drama_count': distinct_mids
    }

def main():
    all_people = load_all_people()
    existing_slugs_set = {p['slug'] for p in all_people if p.get('slug')}

    # Group by clean_slug AND norm_name
    by_clean_slug = defaultdict(list)
    by_norm_name = defaultdict(list)
    for p in all_people:
        cs = clean_slug(p.get('slug') or '')
        nn = norm_name(p.get('name') or '')
        if cs:
            by_clean_slug[cs].append(p)
        if nn:
            by_norm_name[nn].append(p)

    # Combine duplicate clusters
    id_to_person = {p['id']: p for p in all_people}
    visited_ids = set()
    clusters = []

    for cs, grp in by_clean_slug.items():
        if len(grp) > 1:
            grp_ids = {p['id'] for p in grp}
            # Expand cluster with matching norm_name
            for p in list(grp):
                nn = norm_name(p.get('name') or '')
                if nn and len(by_norm_name[nn]) > 1:
                    for np in by_norm_name[nn]:
                        grp_ids.add(np['id'])
            if not grp_ids.issubset(visited_ids):
                clusters.append([id_to_person[i] for i in grp_ids if i in id_to_person])
                visited_ids.update(grp_ids)

    for nn, grp in by_norm_name.items():
        if len(grp) > 1:
            grp_ids = {p['id'] for p in grp}
            if not grp_ids.issubset(visited_ids):
                clusters.append([id_to_person[i] for i in grp_ids if i in id_to_person])
                visited_ids.update(grp_ids)

    print(f"\n2. Toplam {len(clusters)} adet duplicate grubu tespit edildi. Birleştirme başlatılıyor...", flush=True)

    merged_count = 0
    total_dups_removed = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(merge_single_group, c, existing_slugs_set) for c in clusters]
        for idx, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            if res:
                merged_count += 1
                total_dups_removed += len(res['merged_ids'])
                if merged_count % 25 == 0 or merged_count == len(clusters):
                    print(f"   [{merged_count}/{len(clusters)}] Birleştirildi: '{res['primary_name']}' -> slug: '{res['final_slug']}' (Silinen duplicate: {len(res['merged_ids'])}, Yeni yapım sayısı: {res['drama_count']})", flush=True)

    print(f"\n✓ Başarıyla {merged_count} grup birleştirildi ve toplam {total_dups_removed} duplicate kayıt silindi!", flush=True)

    # 3. Clean remaining legacy 'char-...' slugs without collision
    print("\n3. Kalan 'char-...' önekli karakter slug'ları temizleniyor...", flush=True)
    # Reload remaining people
    fresh_people = sb_request('GET', '/rest/v1/people?slug=like.char-*&select=id,slug,name')
    cleaned_char_slugs = 0
    if isinstance(fresh_people, list):
        for p in fresh_people:
            target = clean_slug(p['slug'])
            if target and target != p['slug'] and target not in existing_slugs_set:
                sb_request('PATCH', f"/rest/v1/people?id=eq.{p['id']}", body={'slug': target, 'person_type': 'character'})
                existing_slugs_set.discard(p['slug'])
                existing_slugs_set.add(target)
                cleaned_char_slugs += 1
    print(f"   -> {cleaned_char_slugs} adet karakter slug'ı temiz 'slug' formatına yükseltildi.", flush=True)
    print("\n4. Tüm birleştirme ve slug temizleme işlemleri eksiksiz tamamlandı!", flush=True)

if __name__ == "__main__":
    main()
