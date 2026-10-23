"""
Merges all duplicate actors in SQLite (webdrama_archive.db).
Re-points all drama_actors relations, merges metadata, cleans slugs, and removes duplicates.
"""

import sqlite3
import re
import os
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

def norm_name(n):
    if not n:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', n.lower())

def clean_slug(s):
    if not s:
        return ""
    return re.sub(r'-\d+$', '', s.lower())

def score_actor(a, drama_counts):
    aid = a[0]
    slug = a[1] or ""
    image_url = a[5] or a[3]
    tmdb_id = a[13]
    bio = a[12]
    birth_date = a[8]
    
    score = drama_counts.get(aid, 0) * 10
    if not re.search(r'-\d+$', slug):
        score += 500
    if tmdb_id and tmdb_id > 0:
        score += 300
    if image_url and not image_url.endswith('/logo-dark.png'):
        score += 100
    if bio:
        score += 50
    if birth_date:
        score += 30
    score += max(0, 100000 - aid) * 0.0001
    return score

def run_sqlite_actor_merge():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    cur.execute("SELECT actor_id, COUNT(*) FROM drama_actors GROUP BY actor_id")
    drama_counts = dict(cur.fetchall())
    
    cur.execute("SELECT id, slug, name, profile_url, mydramalist_url, image_url, created_at, gender, birth_date, death_date, place_of_birth, native_name, bio_tr, tmdb_id, anilist_id FROM actors")
    actors = cur.fetchall()
    
    by_norm = defaultdict(list)
    for a in actors:
        norm = norm_name(a[2])
        if norm:
            by_norm[norm].append(a)
            
    dup_groups = [v for v in by_norm.values() if len(v) > 1]
    print(f"[SQLite] Toplam duplicate isim grubu: {len(dup_groups)}", flush=True)
    
    total_merged = 0
    total_relinked = 0
    
    for group in dup_groups:
        sorted_actors = sorted(group, key=lambda a: score_actor(a, drama_counts), reverse=True)
        primary = sorted_actors[0]
        duplicates = sorted_actors[1:]
        
        p_id = primary[0]
        p_slug = primary[1]
        
        clean_s = clean_slug(p_slug)
        if clean_s and clean_s != p_slug:
            cur.execute("SELECT id FROM actors WHERE slug = ? AND id != ?", (clean_s, p_id))
            if not cur.fetchone():
                cur.execute("UPDATE actors SET slug = ? WHERE id = ?", (clean_s, p_id))
                p_slug = clean_s
                
        for dup in duplicates:
            d_id = dup[0]
            updates = []
            params = []
            if not primary[5] and dup[5]:
                updates.append("image_url = ?")
                params.append(dup[5])
            if not primary[13] and dup[13]:
                updates.append("tmdb_id = ?")
                params.append(dup[13])
            if not primary[7] and dup[7]:
                updates.append("gender = ?")
                params.append(dup[7])
            if not primary[8] and dup[8]:
                updates.append("birth_date = ?")
                params.append(dup[8])
            if not primary[9] and dup[9]:
                updates.append("death_date = ?")
                params.append(dup[9])
            if not primary[10] and dup[10]:
                updates.append("place_of_birth = ?")
                params.append(dup[10])
            if not primary[11] and dup[11]:
                updates.append("native_name = ?")
                params.append(dup[11])
            if not primary[12] and dup[12]:
                updates.append("bio_tr = ?")
                params.append(dup[12])
                
            if updates:
                params.append(p_id)
                cur.execute(f"UPDATE actors SET {', '.join(updates)} WHERE id = ?", params)
                
            cur.execute("SELECT drama_id, character_name FROM drama_actors WHERE actor_id = ?", (d_id,))
            dup_dramas = cur.fetchall()
            for did, char in dup_dramas:
                cur.execute("SELECT actor_id FROM drama_actors WHERE drama_id = ? AND actor_id = ?", (did, p_id))
                if cur.fetchone():
                    cur.execute("DELETE FROM drama_actors WHERE drama_id = ? AND actor_id = ?", (did, d_id))
                else:
                    cur.execute("UPDATE drama_actors SET actor_id = ? WHERE drama_id = ? AND actor_id = ?", (p_id, did, d_id))
                    total_relinked += 1
                    
            cur.execute("DELETE FROM actors WHERE id = ?", (d_id,))
            total_merged += 1
            
    conn.commit()
    print(f"[SQLite] {total_merged} mükerrer aktör birleştirildi. {total_relinked} yapım ilişkisi aktarıldı.", flush=True)
    
    cur.execute("SELECT COUNT(*), name FROM actors GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1")
    remaining = cur.fetchall()
    print(f"[SQLite] Kalan duplicate aktör ismi: {len(remaining)}", flush=True)
    
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()

if __name__ == '__main__':
    run_sqlite_actor_merge()
