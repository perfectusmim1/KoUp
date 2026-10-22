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

def sync_anilist_episodes(conn, cur):
    print("🚀 [AniList] Animelerin resmi toplam bölüm sayıları GraphQL ile çekiliyor...")
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
                        if m and m.get("episodes"):
                            canon_eps = m["episodes"]
                            raw_st = m.get("status")
                            st_tr = "Tamamlandı" if raw_st == "FINISHED" else ("Devam Ediyor" if raw_st == "RELEASING" else "Yakında")
                            cur.execute("""
                                UPDATE dramas 
                                SET episode_count = ?, status_broadcast = ?
                                WHERE id = ?
                            """, (str(canon_eps), st_tr, did))
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

    print(f"✅ [AniList] Toplam {updated_count} animenin resmi bölüm sayısı ve yayın durumu güncellendi.")


def sync_tmdb_episodes(conn, cur, limit=2000):
    print(f"🚀 [TMDB] Dizilerin resmi toplam bölüm sayıları çekiliyor (Limit: {limit})...")
    # Öncelikli olarak TMDB ID'si olan ve henüz kanon bölüm sayısı teyit edilmemiş veya dizi türündeki yapımlar
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
                num_eps = d.get("number_of_episodes")
                st = d.get("status")
                # Durumu Türkçeleştir
                st_tr = "Tamamlandı" if st == "Ended" else ("Devam Ediyor" if st == "Returning Series" else ("Yakında" if st in ("In Production", "Planned") else st))
                return did, num_eps, st_tr
        except Exception:
            pass
        return did, None, None

    updated_count = 0
    with ThreadPoolExecutor(max_workers=15) as executor:
        for did, num_eps, st_tr in executor.map(fetch_tmdb_details, rows):
            if num_eps and num_eps > 0:
                cur.execute("""
                    UPDATE dramas 
                    SET episode_count = ?, status_broadcast = COALESCE(?, status_broadcast)
                    WHERE id = ?
                """, (str(num_eps), st_tr, did))
                updated_count += 1
                if updated_count % 100 == 0:
                    conn.commit()

    conn.commit()
    print(f"✅ [TMDB] Toplam {updated_count} dizinin resmi bölüm sayısı ve yayın durumu güncellendi.")


def main():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 1. AniList
    sync_anilist_episodes(conn, cur)

    # 2. TMDB (Öncelikli son eklenen ve popüler diziler)
    sync_tmdb_episodes(conn, cur, limit=5000)

    conn.close()

if __name__ == "__main__":
    main()
