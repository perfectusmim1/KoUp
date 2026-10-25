import asyncio
import json
import os
import re
import sqlite3
import sys
import time
import aiohttp
import requests
from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")


def load_tmdb_key():
    env_path = os.path.join(_ROOT, "koup-app", ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("TMDB_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("TMDB_API_KEY", "")


def init_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS anilist_relations_cache (
            anilist_id INTEGER PRIMARY KEY,
            format TEXT,
            start_year INTEGER,
            start_month INTEGER,
            episodes INTEGER,
            romaji_title TEXT,
            english_title TEXT,
            relations_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tmdb_movie_collections (
            tmdb_id INTEGER PRIMARY KEY,
            collection_id INTEGER,
            collection_name TEXT,
            release_date TEXT,
            original_title TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS mdl_relations_cache (
            mdl_slug TEXT PRIMARY KEY,
            mdl_url TEXT,
            relations_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()


ANILIST_BATCH_QUERY = """
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      format
      episodes
      startDate { year month }
      title { romaji english native }
      relations {
        edges {
          relationType(version: 2)
          node {
            id
            type
            format
            episodes
            startDate { year month }
            title { romaji english native }
          }
        }
      }
    }
  }
}
"""


def fetch_anilist_relations(conn):
    cur = conn.cursor()
    all_al_ids = [
        r[0]
        for r in cur.execute(
            "SELECT DISTINCT anilist_id FROM dramas WHERE anilist_id IS NOT NULL AND anilist_id > 0"
        ).fetchall()
    ]
    cached_ids = {
        r[0] for r in cur.execute("SELECT anilist_id FROM anilist_relations_cache").fetchall()
    }
    todo = [aid for aid in all_al_ids if aid not in cached_ids]
    print(f"[AniList] Toplam benzersiz ID: {len(all_al_ids)}, Önbellekte: {len(cached_ids)}, Çekilecek: {len(todo)}", flush=True)

    def fetch_batches(id_list, label="Pass 1"):
        batches = [id_list[i : i + 50] for i in range(0, len(id_list), 50)]
        session = requests.Session()
        for idx, batch in enumerate(batches, 1):
            for attempt in range(4):
                try:
                    resp = session.post(
                        "https://graphql.anilist.co",
                        json={"query": ANILIST_BATCH_QUERY, "variables": {"ids": batch}},
                        timeout=15,
                    )
                    if resp.status_code == 429:
                        retry_after = int(resp.headers.get("Retry-After", 20))
                        print(f"  [AniList 429] {retry_after}s bekleniyor...", flush=True)
                        time.sleep(retry_after + 1)
                        continue
                    if resp.status_code == 200:
                        data = resp.json().get("data", {}).get("Page", {}).get("media", [])
                        rows_to_insert = []
                        returned_ids = set()
                        for m in data:
                            mid = m["id"]
                            returned_ids.add(mid)
                            sd = m.get("startDate") or {}
                            t_obj = m.get("title") or {}
                            edges = []
                            for edge in (m.get("relations") or {}).get("edges") or []:
                                node = edge.get("node") or {}
                                if node.get("type") == "ANIME" and node.get("id"):
                                    nsd = node.get("startDate") or {}
                                    nt = node.get("title") or {}
                                    edges.append({
                                        "relationType": edge.get("relationType"),
                                        "id": node.get("id"),
                                        "format": node.get("format"),
                                        "episodes": node.get("episodes"),
                                        "year": nsd.get("year"),
                                        "month": nsd.get("month"),
                                        "romaji": nt.get("romaji"),
                                        "english": nt.get("english"),
                                    })
                            rows_to_insert.append((
                                mid,
                                m.get("format"),
                                sd.get("year"),
                                sd.get("month"),
                                m.get("episodes"),
                                t_obj.get("romaji"),
                                t_obj.get("english"),
                                json.dumps(edges, ensure_ascii=False),
                            ))
                        # Also mark any not-found IDs so we don't re-query them endlessly
                        for req_id in batch:
                            if req_id not in returned_ids:
                                rows_to_insert.append((req_id, None, None, None, None, None, None, "[]"))

                        cur.executemany("""
                            INSERT OR REPLACE INTO anilist_relations_cache
                            (anilist_id, format, start_year, start_month, episodes, romaji_title, english_title, relations_json)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, rows_to_insert)
                        conn.commit()
                        rem = int(resp.headers.get("X-RateLimit-Remaining", 30))
                        if idx % 10 == 0 or idx == len(batches):
                            print(f"  [AniList {label}] {idx}/{len(batches)} paket tamamlandı (RateLimit kalan: {rem})", flush=True)
                        if rem < 5:
                            time.sleep(2.5)
                        else:
                            time.sleep(0.65)
                        break
                except Exception as e:
                    print(f"  [AniList Hata] Paket {idx}: {e}", flush=True)
                    time.sleep(2)

    if todo:
        fetch_batches(todo, "Pass 1")

    # 1-hop bridge check: if any cached anime points via PREQUEL/SEQUEL/PARENT to an uncached anime ID,
    # and that uncached anime ID is pointed to by >= 2 archive animes, fetch it so bridges are connected!
    cached_now = {
        r[0] for r in cur.execute("SELECT anilist_id FROM anilist_relations_cache").fetchall()
    }
    bridge_counts = {}
    for (rel_json,) in cur.execute("SELECT relations_json FROM anilist_relations_cache WHERE relations_json IS NOT NULL").fetchall():
        try:
            edges = json.loads(rel_json)
            for e in edges:
                if e.get("relationType") in ("PREQUEL", "SEQUEL", "PARENT", "MAIN_STORY"):
                    tid = e.get("id")
                    if tid and tid not in cached_now:
                        bridge_counts[tid] = bridge_counts.get(tid, 0) + 1
        except Exception:
            pass

    bridge_todo = [tid for tid, cnt in bridge_counts.items() if cnt >= 2]
    if bridge_todo:
        print(f"[AniList Bridge] {len(bridge_todo)} ara köprü anime düğümü çekiliyor...", flush=True)
        fetch_batches(bridge_todo, "Bridge Pass")


async def fetch_tmdb_collections(conn):
    tmdb_key = load_tmdb_key()
    if not tmdb_key:
        print("[TMDB] API anahtarı bulunamadı, atlanıyor.", flush=True)
        return

    cur = conn.cursor()
    movie_tids = [
        r[0]
        for r in cur.execute(
            "SELECT DISTINCT tmdb_id FROM dramas WHERE content_type = 'film' AND tmdb_id IS NOT NULL AND tmdb_id > 0"
        ).fetchall()
    ]
    cached_tids = {
        r[0] for r in cur.execute("SELECT tmdb_id FROM tmdb_movie_collections").fetchall()
    }
    todo = [tid for tid in movie_tids if tid not in cached_tids]
    print(f"[TMDB Film Koleksiyonları] Toplam: {len(movie_tids)}, Önbellekte: {len(cached_tids)}, Çekilecek: {len(todo)}", flush=True)
    if not todo:
        return

    sem = asyncio.Semaphore(55)
    connector = aiohttp.TCPConnector(limit=75, ssl=False)
    t0 = time.time()

    async with aiohttp.ClientSession(connector=connector) as session:
        async def fetch_one(tid):
            url = f"https://api.themoviedb.org/3/movie/{tid}?api_key={tmdb_key}&language=tr-TR"
            async with sem:
                for _ in range(2):
                    try:
                        async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                            if resp.status == 200:
                                d = await resp.json()
                                col = d.get("belongs_to_collection")
                                return (
                                    tid,
                                    col.get("id") if col else None,
                                    col.get("name") if col else None,
                                    d.get("release_date") or "",
                                    d.get("original_title") or d.get("title") or "",
                                )
                            elif resp.status == 404:
                                return (tid, None, None, "", "")
                            elif resp.status == 429:
                                await asyncio.sleep(1.5)
                    except Exception:
                        await asyncio.sleep(0.5)
            return None

        chunk_size = 500
        for i in range(0, len(todo), chunk_size):
            chunk = todo[i : i + chunk_size]
            results = await asyncio.gather(*(fetch_one(tid) for tid in chunk))
            valid = [r for r in results if r is not None]
            if valid:
                cur.executemany("""
                    INSERT OR REPLACE INTO tmdb_movie_collections
                    (tmdb_id, collection_id, collection_name, release_date, original_title)
                    VALUES (?, ?, ?, ?, ?)
                """, valid)
                conn.commit()
            with_col = cur.execute("SELECT COUNT(*) FROM tmdb_movie_collections WHERE collection_id IS NOT NULL").fetchone()[0]
            print(
                f"  [TMDB] {min(i + chunk_size, len(todo))}/{len(todo)} tamamlandı ({time.time() - t0:.1f}s) | Koleksiyonlu film: {with_col}",
                flush=True,
            )


def extract_mdl_slug(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"mydramalist\.com/(\d+-[a-z0-9-]+)", url.lower())
    if m:
        return m.group(1)
    m2 = re.search(r"^/?(\d+-[a-z0-9-]+)", url.lower().strip())
    return m2.group(1) if m2 else ""


async def fetch_mdl_relations(conn):
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT DISTINCT mydramalist_url
        FROM dramas
        WHERE mydramalist_url IS NOT NULL AND LENGTH(mydramalist_url) > 10
    """).fetchall()

    url_map = {}
    for (u,) in rows:
        slug = extract_mdl_slug(u)
        if slug:
            url_map[slug] = f"https://mydramalist.com/{slug}"

    cached_slugs = {
        r[0] for r in cur.execute("SELECT mdl_slug FROM mdl_relations_cache").fetchall()
    }
    todo = [(s, u) for s, u in url_map.items() if s not in cached_slugs]
    print(f"[MDL Related Content] Toplam: {len(url_map)}, Önbellekte: {len(cached_slugs)}, Çekilecek: {len(todo)}", flush=True)
    if not todo:
        return

    sem = asyncio.Semaphore(25)
    t0 = time.time()

    async with AsyncSession(impersonate="chrome120") as session:
        async def fetch_one(slug, url):
            async with sem:
                for _ in range(2):
                    try:
                        r = await session.get(url, timeout=12)
                        if r.status_code == 200:
                            rels = []
                            if "related-content" in r.text:
                                soup = BeautifulSoup(r.text, "html.parser")
                                li = soup.select_one("li.related-content")
                                if li:
                                    for div_t in li.select("div.title"):
                                        a = div_t.find("a", href=True)
                                        if not a:
                                            continue
                                        target_slug = extract_mdl_slug(a["href"])
                                        target_title = a.get_text(strip=True)
                                        full_txt = div_t.get_text(" ", strip=True)
                                        # Extract parenthetical relation e.g. (Korean sequel)
                                        rel_m = re.search(r"\(([^()]+)\)\s*$", full_txt)
                                        rel_type = rel_m.group(1).strip() if rel_m else "related"
                                        if target_slug:
                                            rels.append({
                                                "slug": target_slug,
                                                "title": target_title,
                                                "relation": rel_type,
                                            })
                            return (slug, url, json.dumps(rels, ensure_ascii=False))
                        elif r.status_code == 404:
                            return (slug, url, "[]")
                        elif r.status_code in (429, 503):
                            await asyncio.sleep(2.0)
                    except Exception:
                        await asyncio.sleep(0.5)
            return None

        chunk_size = 300
        for i in range(0, len(todo), chunk_size):
            chunk = todo[i : i + chunk_size]
            results = await asyncio.gather(*(fetch_one(s, u) for s, u in chunk))
            valid = [r for r in results if r is not None]
            if valid:
                cur.executemany("""
                    INSERT OR REPLACE INTO mdl_relations_cache
                    (mdl_slug, mdl_url, relations_json)
                    VALUES (?, ?, ?)
                """, valid)
                conn.commit()
            with_rel = cur.execute("SELECT COUNT(*) FROM mdl_relations_cache WHERE relations_json != '[]'").fetchone()[0]
            print(
                f"  [MDL] {min(i + chunk_size, len(todo))}/{len(todo)} tamamlandı ({time.time() - t0:.1f}s) | Bağlantılı dizi: {with_rel}",
                flush=True,
            )


async def main():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    init_tables(conn)

    print("=== 1/3: AniList Resmi İlişki Ağacı Çekiliyor ===", flush=True)
    fetch_anilist_relations(conn)

    print("\n=== 2/3: TMDB Resmi Film Koleksiyonları Çekiliyor ===", flush=True)
    await fetch_tmdb_collections(conn)

    print("\n=== 3/3: MyDramaList (MDL) Related Content Çekiliyor ===", flush=True)
    await fetch_mdl_relations(conn)

    conn.close()
    print("\n[TAMAMLANDI] Tüm resmi ilişki verileri yerel önbelleğe kaydedildi!", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
