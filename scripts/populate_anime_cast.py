"""
Full-Archive Character & Cast Populator (Anime via AniList Page(id_in) + Live-Action via TMDb)
- Preloads all existing Supabase `people` and `media_cast` media_ids in memory using 10x parallel pagination
- Batch-fetches AniList characters & Japanese voice actors (50 anime per single Page(id_in) GraphQL query, immune to 404s) for ALL anime in the archive
- Concurrently fetches TMDb credits (25 threads) for ALL live-action series/movies missing cast in the archive
- Bulk inserts new people and media_cast rows into Supabase in parallel chunks
"""

import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request


def _load_tmdb_key():
    env_path = os.path.join(_ROOT, "koup-app", ".env.local")
    key = os.environ.get("TMDB_API_KEY", "") or os.environ.get("NEXT_PUBLIC_TMDB_API_KEY", "")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TMDB_API_KEY=") or line.startswith("NEXT_PUBLIC_TMDB_API_KEY="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        key = val
    return key


TMDB_API_KEY = _load_tmdb_key()


def slugify(text: str) -> str:
    if not text:
        return "actor"
    s = text.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "actor"


def norm_name(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def fetch_all_pages(path_template: str, page_size: int = 1000):
    all_rows = []
    offset = 0
    while True:
        offsets = [offset + i * page_size for i in range(10)]
        batch_results = {}
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {
                pool.submit(sb_request, "GET", f"{path_template}&limit={page_size}&offset={off}"): off
                for off in offsets
            }
            for fut in as_completed(futs):
                off = futs[fut]
                res = fut.result()
                batch_results[off] = res if isinstance(res, list) else []

        stop = False
        for off in offsets:
            rows = batch_results.get(off) or []
            all_rows.extend(rows)
            if len(rows) < page_size:
                stop = True
                break
        if stop:
            break
        offset += 10 * page_size
    return all_rows


def preload_supabase_state():
    print("1. Supabase mevcut kadro ve oyuncu durumu taranıyor...", flush=True)
    cast_rows = fetch_all_pages("/rest/v1/media_cast?select=media_id&order=media_id.asc", 1000)
    media_with_cast = {int(r["media_id"]) for r in cast_rows if r.get("media_id")}
    print(
        f"   -> Halihazırda kadrosu olan yapım sayısı: {len(media_with_cast)} ({len(cast_rows)} kadro kaydı)",
        flush=True,
    )

    people_rows = fetch_all_pages("/rest/v1/people?select=id,slug,name,tmdb_id&order=id.asc", 1000)
    people_by_slug = {}
    people_by_norm = {}
    people_by_tmdb = {}
    for p in people_rows:
        pid = p.get("id")
        if not pid:
            continue
        slug = p.get("slug")
        name = p.get("name")
        tid = p.get("tmdb_id")
        if slug:
            people_by_slug[slug] = pid
        if name:
            nn = norm_name(name)
            if nn and nn not in people_by_norm:
                people_by_norm[nn] = pid
        if tid:
            people_by_tmdb[int(tid)] = pid

    print(f"   -> Önbelleğe alınan mevcut kişi/karakter sayısı: {len(people_by_slug)}", flush=True)
    return media_with_cast, people_by_slug, people_by_norm, people_by_tmdb


ANILIST_PAGE_QUERY = """
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      characters(sort: [ROLE, RELEVANCE, ID], perPage: 16) {
        edges {
          role
          node {
            id
            name { full userPreferred }
            image { large medium }
          }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            id
            name { full userPreferred }
            image { large medium }
          }
        }
      }
    }
  }
}
"""


def fetch_anilist_page_by_ids(aid_list):
    """
    Fetches up to 50 anime in a single Page(id_in: [...]) GraphQL request.
    Never fails with 404 even if some IDs do not exist on AniList.
    Returns dict: anilist_id -> list of character edges.
    """
    if not aid_list:
        return {}
    req = urllib.request.Request(
        "https://graphql.anilist.co",
        data=json.dumps({"query": ANILIST_PAGE_QUERY, "variables": {"ids": aid_list}}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "KoUp/1.0"},
    )
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    media_list = ((payload.get("data") or {}).get("Page") or {}).get("media") or []
                    out = {}
                    for m in media_list:
                        if m and m.get("id"):
                            edges = ((m.get("characters") or {}).get("edges")) or []
                            if edges:
                                out[int(m["id"])] = edges
                    return out
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", 4))
                time.sleep(max(retry_after, 3))
                continue
            time.sleep(1.5)
        except Exception:
            time.sleep(1.5)
    return {}


def ensure_people_and_insert_cast(
    planned_by_media,
    people_by_slug,
    people_by_norm,
    people_by_tmdb,
):
    new_people_map = {}
    for mid, items in planned_by_media.items():
        for item in items:
            pslug = item["slug"]
            nn = norm_name(item["name"])
            tid = item.get("tmdb_id")
            pid = (
                (people_by_tmdb.get(int(tid)) if tid else None)
                or people_by_slug.get(pslug)
                or people_by_norm.get(nn)
            )
            if not pid and pslug not in new_people_map:
                new_people_map[pslug] = {
                    "name": item["name"],
                    "slug": pslug,
                    "image_url": item["img_url"],
                    "tmdb_id": int(tid) if tid else None,
                    "person_type": "actor",
                }

    if new_people_map:
        new_list = list(new_people_map.values())
        chunks = [new_list[i : i + 250] for i in range(0, len(new_list), 250)]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = [
                pool.submit(
                    sb_request,
                    "POST",
                    "/rest/v1/people?on_conflict=slug",
                    chunk,
                    "resolution=merge-duplicates,return=representation",
                )
                for chunk in chunks
            ]
            for fut in as_completed(futs):
                res = fut.result()
                if isinstance(res, list):
                    for np in res:
                        if np.get("slug"):
                            people_by_slug[np["slug"]] = np["id"]
                        if np.get("name"):
                            people_by_norm[norm_name(np["name"])] = np["id"]
                        if np.get("tmdb_id"):
                            people_by_tmdb[int(np["tmdb_id"])] = np["id"]

    cast_rows_to_insert = []
    for mid, items in planned_by_media.items():
        seen_pids = set()
        for item in items:
            pslug = item["slug"]
            nn = norm_name(item["name"])
            tid = item.get("tmdb_id")
            pid = (
                (people_by_tmdb.get(int(tid)) if tid else None)
                or people_by_slug.get(pslug)
                or people_by_norm.get(nn)
            )
            if not pid or pid in seen_pids:
                continue
            seen_pids.add(pid)
            cast_rows_to_insert.append({
                "media_id": mid,
                "person_id": pid,
                "character_name": item["character_name"],
                "role_type": item["role_type"],
                "billing_order": item["billing_order"],
                "voice_actor_name": item.get("voice_actor_name"),
                "voice_actor_image": item.get("voice_actor_image"),
                "voice_actor_slug": item.get("voice_actor_slug"),
            })

    inserted_count = 0
    if cast_rows_to_insert:
        chunks = [cast_rows_to_insert[i : i + 500] for i in range(0, len(cast_rows_to_insert), 500)]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {
                pool.submit(sb_request, "POST", "/rest/v1/media_cast", chunk, "return=minimal"): len(chunk)
                for chunk in chunks
            }
            for fut in as_completed(futs):
                res = fut.result()
                if not isinstance(res, dict) or not res.get("_error"):
                    inserted_count += futs[fut]
    return inserted_count


def fetch_tmdb_cast_single(item):
    did, title, tid, ctype = item
    is_movie = ctype == "film"
    urls = (
        [f"https://api.themoviedb.org/3/movie/{tid}/credits?api_key={TMDB_API_KEY}"]
        if is_movie
        else [
            f"https://api.themoviedb.org/3/tv/{tid}/credits?api_key={TMDB_API_KEY}",
            f"https://api.themoviedb.org/3/tv/{tid}/aggregate_credits?api_key={TMDB_API_KEY}",
        ]
    )
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "KoUp/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    raw_cast = data.get("cast") or []
                    if raw_cast:
                        raw_cast.sort(key=lambda x: x.get("order", 999))
                        planned = []
                        for idx, c in enumerate(raw_cast[:16], 1):
                            name = c.get("name") or c.get("original_name") or ""
                            if not name:
                                continue
                            char = c.get("character") or ""
                            if not char and isinstance(c.get("roles"), list) and c["roles"]:
                                char = c["roles"][0].get("character") or ""
                            prof = c.get("profile_path")
                            img = f"https://image.tmdb.org/t/p/w500{prof}" if prof else None
                            role = "lead" if idx <= 4 else "support"
                            planned.append({
                                "name": name,
                                "slug": slugify(name),
                                "img_url": img,
                                "tmdb_id": c.get("id"),
                                "character_name": char,
                                "role_type": role,
                                "billing_order": idx,
                                "voice_actor_name": None,
                                "voice_actor_image": None,
                                "voice_actor_slug": None,
                            })
                        return did, planned
        except Exception:
            continue
    return did, []


def main():
    media_with_cast, people_by_slug, people_by_norm, people_by_tmdb = preload_supabase_state()

    print("2. Supabase `media` tablosundaki tüm yapımlar çekiliyor...", flush=True)
    sb_media = fetch_all_pages(
        "/rest/v1/media?select=id,title,content_type,anilist_id,tmdb_id&order=id.asc", 1000
    )
    print(f"   -> Supabase toplam medya sayısı: {len(sb_media)}", flush=True)

    conn = sqlite3.connect(os.path.join(_ROOT, "webdrama_archive.db"))
    cur = conn.cursor()
    sqlite_ids = {}
    for row in cur.execute("SELECT id, anilist_id, tmdb_id, content_type FROM dramas"):
        sqlite_ids[row[0]] = (row[1], row[2], row[3])

    # Map anilist_id -> list of media_ids
    aid_to_mids = defaultdict(list)
    missing_tmdb = []

    for m in sb_media:
        mid = int(m["id"])
        if mid in media_with_cast:
            continue
        title = m.get("title") or ""
        ctype = m.get("content_type") or ""
        aid = m.get("anilist_id")
        tid = m.get("tmdb_id")
        if mid in sqlite_ids:
            s_aid, s_tid, s_ctype = sqlite_ids[mid]
            if not aid and s_aid:
                aid = s_aid
            if not tid and s_tid:
                tid = s_tid
            if not ctype and s_ctype:
                ctype = s_ctype

        if ctype == "anime" and aid and int(aid) > 0:
            aid_to_mids[int(aid)].append(mid)
        elif tid and int(tid) > 0:
            missing_tmdb.append((mid, title, int(tid), ctype))

    unique_aids = sorted(aid_to_mids.keys())
    total_anime_targets = sum(len(v) for v in aid_to_mids.values())
    print(
        f"   -> Kadrosu eksik Anime sayısı: {total_anime_targets} ({len(unique_aids)} tekil AniList ID)",
        flush=True,
    )
    print(f"   -> Kadrosu eksik Dizi/Film sayısı (TMDb ID'li): {len(missing_tmdb)}", flush=True)

    # PHASE A: Fast 50-per-page AniList GraphQL enrichment
    total_anime_cast = 0
    total_anime_populated = 0
    page_size = 50
    for b_idx in range(0, len(unique_aids), page_size):
        aid_batch = unique_aids[b_idx : b_idx + page_size]
        edges_by_aid = fetch_anilist_page_by_ids(aid_batch)
        planned_by_media = {}

        for aid, edges in edges_by_aid.items():
            planned = []
            for c_idx, edge in enumerate(edges, 1):
                node = edge.get("node") or {}
                vas = edge.get("voiceActors") or []
                va = vas[0] if vas else {}
                char_name = (
                    (node.get("name") or {}).get("full")
                    or (node.get("name") or {}).get("userPreferred")
                    or ""
                )
                if not char_name:
                    continue
                va_name = (
                    (va.get("name") or {}).get("full")
                    or (va.get("name") or {}).get("userPreferred")
                    or ""
                )
                role_type = "lead" if edge.get("role") == "MAIN" else "support"
                img_url = (
                    (node.get("image") or {}).get("large")
                    or (node.get("image") or {}).get("medium")
                    or (va.get("image") or {}).get("large")
                )
                va_img = (va.get("image") or {}).get("large") or (va.get("image") or {}).get("medium")
                va_slug = slugify(va_name) if va_name else None

                planned.append({
                    "name": char_name,
                    "slug": slugify(char_name),
                    "img_url": img_url,
                    "tmdb_id": None,
                    "character_name": f"Seslendiren: {va_name}" if va_name else char_name,
                    "role_type": role_type,
                    "billing_order": c_idx,
                    "voice_actor_name": va_name or None,
                    "voice_actor_image": va_img,
                    "voice_actor_slug": va_slug,
                })
            if planned:
                for mid in aid_to_mids[aid]:
                    planned_by_media[mid] = planned

        if planned_by_media:
            added = ensure_people_and_insert_cast(
                planned_by_media, people_by_slug, people_by_norm, people_by_tmdb
            )
            total_anime_cast += added
            total_anime_populated += len(planned_by_media)

        done_so_far = min(b_idx + page_size, len(unique_aids))
        if done_so_far % 250 == 0 or done_so_far == len(unique_aids):
            print(
                f"   [Anime İlerleme] {done_so_far}/{len(unique_aids)} AniList ID tarandı -> {total_anime_populated} animeye +{total_anime_cast} karakter eklendi.",
                flush=True,
            )
        time.sleep(0.65)

    # PHASE B: Fast 25-thread TMDb enrichment for all remaining series & movies
    total_tmdb_cast = 0
    total_tmdb_populated = 0
    if missing_tmdb and TMDB_API_KEY:
        print(f"\n3. {len(missing_tmdb)} Dizi/Film için TMDb kadroları paralel çekiliyor...", flush=True)
        chunk_size = 250
        for c_idx in range(0, len(missing_tmdb), chunk_size):
            chunk = missing_tmdb[c_idx : c_idx + chunk_size]
            planned_by_media = {}
            with ThreadPoolExecutor(max_workers=25) as pool:
                futures = [pool.submit(fetch_tmdb_cast_single, item) for item in chunk]
                for fut in as_completed(futures):
                    did, planned = fut.result()
                    if planned:
                        planned_by_media[did] = planned

            if planned_by_media:
                added = ensure_people_and_insert_cast(
                    planned_by_media, people_by_slug, people_by_norm, people_by_tmdb
                )
                total_tmdb_cast += added
                total_tmdb_populated += len(planned_by_media)

            done_so_far = min(c_idx + chunk_size, len(missing_tmdb))
            if done_so_far % 500 == 0 or done_so_far == len(missing_tmdb):
                print(
                    f"   [Dizi/Film İlerleme] {done_so_far}/{len(missing_tmdb)} tarandı -> {total_tmdb_populated} yapıma +{total_tmdb_cast} oyuncu eklendi.",
                    flush=True,
                )

    print(
        f"\n[TAMAMLANDI] Tüm arşiv taraması bitti! "
        f"Anime: {total_anime_populated} yapım (+{total_anime_cast} karakter), "
        f"Dizi/Film: {total_tmdb_populated} yapım (+{total_tmdb_cast} oyuncu).",
        flush=True,
    )


if __name__ == "__main__":
    main()
