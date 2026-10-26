import os
import sys
import json
import sqlite3
import time
import requests
from concurrent.futures import ThreadPoolExecutor

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from scrapers.translator import _load_tmdb_key

TMDB_API_KEY = _load_tmdb_key()

def sync_actual_episode_counts(conn, cur):
    print("🚀 [SQLite] dramas tablosundaki episode_count ve episodes_available gerçek bölüm sayılarıyla senkronize ediliyor...")
    cur.execute("""
        UPDATE dramas
        SET 
            episode_count = CAST((
                SELECT COUNT(*) 
                FROM episodes 
                WHERE episodes.drama_id = dramas.id
            ) AS TEXT),
            episodes_available = (
                SELECT COUNT(*) 
                FROM episodes 
                WHERE episodes.drama_id = dramas.id 
                  AND COALESCE(episodes.source_status, 'published') != 'pending_source'
            )
        WHERE id IN (SELECT DISTINCT drama_id FROM episodes)
          AND content_type != 'film';
    """)
    conn.commit()
    print("✅ [SQLite] dramas tablosundaki gerçek bölüm sayıları senkronize edildi.")


def sync_anilist_episodes(conn, cur):
    print("🚀 [AniList] Animelerin resmi yayın durumları (status_broadcast) GraphQL ile çekiliyor...")
    cur.execute("""
        SELECT id, anilist_id, episode_count, episodes_available 
        FROM dramas 
        WHERE anilist_id IS NOT NULL AND content_type = 'anime'
    """)
    rows = cur.fetchall()
    print(f"📦 Toplam {len(rows)} AniList bağlantılı anime bulundu.")

    # 50'şerli paketler
    chunk_size = 50
    updated_count = 0

    query = """
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id
          episodes
          status
        }
      }
    }
    """

    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i+chunk_size]
        a_ids = [r[1] for r in chunk if r[1]]
        if not a_ids:
            continue

        for attempt in range(3):
            try:
                res = requests.post(
                    "https://graphql.anilist.co",
                    json={"query": query, "variables": {"ids": a_ids}},
                    timeout=15
                )
                if res.status_code == 200:
                    data = res.json().get("data", {}).get("Page", {}).get("media", [])
                    m_map = {m["id"]: m for m in data}
                    for r in chunk:
                        did, aid, old_cnt, avail_cnt = r
                        m = m_map.get(aid)
                        if m and m.get("status"):
                            raw_st = m.get("status")
                            st_tr = "Tamamlandı" if raw_st == "FINISHED" else ("Devam Ediyor" if raw_st == "RELEASING" else "Yakında")
                            cur.execute("""
                                UPDATE dramas 
                                SET status_broadcast = ?
                                WHERE id = ?
                            """, (st_tr, did))
                            updated_count += 1
                    conn.commit()
                    break
                elif res.status_code == 429:
                    time.sleep(3)
                else:
                    break
            except Exception as e:
                time.sleep(2)

        if (i // chunk_size + 1) % 10 == 0:
            print(f"  ⚡ AniList İlerleme: {i + len(chunk)}/{len(rows)} anime tarandı (Güncellenen: {updated_count}).")

    print(f"✅ [AniList] Toplam {updated_count} animenin yayın durumu güncellendi.")


def sync_tmdb_episodes(conn, cur, limit=2000):
    print(f"🚀 [TMDB] Dizilerin resmi yayın durumları (status_broadcast) çekiliyor (Limit: {limit})...")
    # Öncelikli olarak TMDB ID'si olan yapımlar
    cur.execute("""
        SELECT id, tmdb_id, title, episode_count, episodes_available 
        FROM dramas 
        WHERE tmdb_id IS NOT NULL 
          AND content_type != 'film'
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    print(f"📦 Taranacak {len(rows)} dizi seçildi.")

    def fetch_tmdb_details(r):
        did, tmdb_id, title, old_cnt, avail_cnt = r
        try:
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={TMDB_API_KEY}&language=tr-TR"
            res = requests.get(url, timeout=8)
            if res.status_code == 200:
                d = res.json()
                st = d.get("status")
                # Durumu Türkçeleştir
                st_tr = "Tamamlandı" if st == "Ended" else ("Devam Ediyor" if st == "Returning Series" else ("Yakında" if st in ("In Production", "Planned") else st))
                return did, st_tr
        except Exception:
            pass
        return did, None

    updated_count = 0
    with ThreadPoolExecutor(max_workers=15) as executor:
        for did, st_tr in executor.map(fetch_tmdb_details, rows):
            if st_tr:
                cur.execute("""
                    UPDATE dramas 
                    SET status_broadcast = COALESCE(?, status_broadcast)
                    WHERE id = ?
                """, (st_tr, did))
                updated_count += 1
                if updated_count % 100 == 0:
                    conn.commit()

    conn.commit()
    print(f"✅ [TMDB] Toplam {updated_count} dizinin yayın durumu güncellendi.")


def main():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 1. Gerçek bölüm sayılarını episodes tablosundan senkronize et
    sync_actual_episode_counts(conn, cur)

    # 2. AniList yayın durumu
    sync_anilist_episodes(conn, cur)

    # 3. TMDB yayın durumu
    sync_tmdb_episodes(conn, cur, limit=5000)

    # 4. Son kontrol: episode_count ve episodes_available her zaman episodes tablosuyla eşleşmeli
    sync_actual_episode_counts(conn, cur)

    conn.close()

if __name__ == "__main__":
    main()
