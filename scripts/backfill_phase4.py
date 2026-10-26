"""
KoUp Phase 4 Backfill Runner
Executes Phase 4 scrapers:
- animelvl: AnimeLVL (https://animelvl.com/)
- sezonlukdizi: SezonlukDizi (https://sezonlukdizi.cc/)
- dizipal: Dizipal (https://dizipal1592.com/ + auto-domain)
- fullhdfilmizlesene: FullHDfilmizlesene (https://www.fullhdfilmizlesene.now/)
- tranimaci: TRAnimeci (https://tranimaci.com/)
- anizm: Anizm (https://anizm.net/)

Usage:
    python scripts/backfill_phase4.py --site all --limit 10
    python scripts/backfill_phase4.py --site sezonlukdizi --limit 5
"""

import sys
import os
import argparse
import time
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

from database import DB_PATH
from scrapers.multisite import build_drama_index, done_urls, mark_done, safe_commit


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    return conn


def run_animelvl(limit=None, resume=False):
    from scrapers.sites import animelvl
    print(f"\n--- [Phase 4] Running AnimeLVL Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("anime", "dizi", "film"))
    session = animelvl._get_session()

    # Sync Takvim first
    try:
        cal_count = animelvl.sync_animelvl_calendar(session)
        print(f"[AnimeLVL] Calendar synced: {cal_count} items", flush=True)
    except Exception as e:
        print(f"[AnimeLVL] Calendar sync notice: {e}", flush=True)

    catalog = animelvl.get_animes_catalog(session)
    if not catalog:
        print("[AnimeLVL] Catalog unavailable. Exiting.", flush=True)
        conn.close()
        return 0

    already_done = done_urls(cur, "animelvl") if resume else set()
    total_added = 0
    processed = 0

    for item in catalog:
        slug = item.get("slug")
        u = f"https://animelvl.com/anime/{item.get('id', '')}-{slug}"
        if resume and u in already_done:
            continue
        try:
            added = animelvl.scrape_anime_item(conn, cur, idx, item)
            mark_done(cur, "animelvl", u)
            safe_commit(conn)
            total_added += added
            processed += 1
            print(f"[AnimeLVL] Processed: {item.get('t') or slug} (+{added} sources)", flush=True)
        except Exception as e:
            print(f"[AnimeLVL] Error on {slug}: {e}", flush=True)

        if limit and processed >= limit:
            break

    conn.close()
    return total_added


def run_sezonlukdizi(limit=None, resume=False):
    from scrapers.sites import sezonlukdizi
    print(f"\n--- [Phase 4] Running SezonlukDizi Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("dizi", "anime", "film"))
    session = sezonlukdizi._get_session()

    urls = sezonlukdizi.get_series_sitemap_urls(session, max_pages=3)
    print(f"[SezonlukDizi] Found {len(urls)} series in sitemap", flush=True)

    already_done = done_urls(cur, "sezonlukdizi") if resume else set()
    total_added = 0
    processed = 0

    for u in urls:
        if resume and u in already_done:
            continue
        try:
            added = sezonlukdizi.scrape_series(conn, cur, idx, session, u)
            mark_done(cur, "sezonlukdizi", u)
            safe_commit(conn)
            total_added += added
            processed += 1
            print(f"[SezonlukDizi] Processed: {u} (+{added} sources)", flush=True)
        except Exception as e:
            print(f"[SezonlukDizi] Error on {u}: {e}", flush=True)

        if limit and processed >= limit:
            break

    conn.close()
    return total_added


def run_dizipal(limit=None, resume=False):
    from scrapers.sites import dizipal
    print(f"\n--- [Phase 4] Running Dizipal Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("dizi", "film", "anime"))
    session = dizipal._get_session()
    base_url = dizipal.resolve_current_domain(session)
    print(f"[Dizipal] Active domain: {base_url}", flush=True)

    unique_urls = dizipal.get_catalog_items(session, base_url, max_pages=3)
    print(f"[Dizipal] Found {len(unique_urls)} items in catalog", flush=True)

    already_done = done_urls(cur, "dizipal") if resume else set()
    total_added = 0
    processed = 0

    for u in unique_urls:
        if resume and u in already_done:
            continue
        try:
            if "/series/" in u:
                added = dizipal.scrape_series(conn, cur, idx, session, u, base_url)
            else:
                added = dizipal.scrape_episode_and_save(conn, cur, idx, session, u, base_url)
            mark_done(cur, "dizipal", u)
            safe_commit(conn)
            total_added += added
            processed += 1
            print(f"[Dizipal] Processed: {u} (+{added} sources)", flush=True)
        except Exception as e:
            print(f"[Dizipal] Error on {u}: {e}", flush=True)

        if limit and processed >= limit:
            break

    conn.close()
    return total_added


def run_fullhdfilmizlesene(limit=None, resume=False):
    from scrapers.sites import fullhdfilmizlesene
    print(f"\n--- [Phase 4] Running FullHDfilmizlesene Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("film", "dizi"))
    session = fullhdfilmizlesene._get_session()
    base_url = fullhdfilmizlesene.resolve_base_url(session)
    print(f"[FullHDFilmizlesene] Base domain: {base_url}", flush=True)

    urls = fullhdfilmizlesene.get_catalog_urls(session, base_url=base_url, max_pages=10)
    print(f"[FullHDFilmizlesene] Found {len(urls)} movies in catalog", flush=True)

    already_done = done_urls(cur, "fullhdfilmizlesene") if resume else set()
    to_process = [u for u in urls if not (resume and u in already_done)]
    if limit:
        to_process = to_process[:limit]

    print(f"[FullHDFilmizlesene] Batch processing {len(to_process)} movies...", flush=True)
    total_added = fullhdfilmizlesene.scrape_movies_batch(conn, cur, idx, session, to_process)
    for u in to_process:
        mark_done(cur, "fullhdfilmizlesene", u)
    safe_commit(conn)
    print(f"[FullHDFilmizlesene] Completed: {len(to_process)} movies (+{total_added} sources)", flush=True)
    conn.close()
    return total_added


def run_tranimaci(limit=None, resume=False):
    from scrapers.sites import tranimaci_anizm
    print(f"\n--- [Phase 4] Running TRAnimeci Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("anime", "dizi"))
    session = tranimaci_anizm._get_session("tranimaci")

    urls = tranimaci_anizm.get_tranimaci_sitemap_urls(session)
    print(f"[TRAnimeci] Found {len(urls)} anime in sitemap", flush=True)

    already_done = done_urls(cur, "tranimaci") if resume else set()
    total_added = 0
    processed = 0

    for u in urls:
        if resume and u in already_done:
            continue
        try:
            added = tranimaci_anizm.scrape_tranimaci_anime(conn, cur, idx, session, u)
            mark_done(cur, "tranimaci", u)
            safe_commit(conn)
            total_added += added
            processed += 1
            print(f"[TRAnimeci] Processed: {u} (+{added} sources)", flush=True)
        except Exception as e:
            print(f"[TRAnimeci] Error on {u}: {e}", flush=True)

        if limit and processed >= limit:
            break

    conn.close()
    return total_added


def run_anizm(limit=None, resume=False):
    from scrapers.sites import tranimaci_anizm
    print(f"\n--- [Phase 4] Running Anizm Scraper (limit={limit}) ---", flush=True)
    conn = get_db_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur, content_types=("anime", "dizi"))
    session = tranimaci_anizm._get_session("anizm")

    urls = tranimaci_anizm.get_anizm_catalog_urls(session, max_pages=5)
    print(f"[Anizm] Found {len(urls)} items in catalog", flush=True)

    already_done = done_urls(cur, "anizm") if resume else set()
    total_added = 0
    processed = 0

    for u in urls:
        if resume and u in already_done:
            continue
        try:
            added = tranimaci_anizm.scrape_anizm_episode(conn, cur, idx, session, u)
            mark_done(cur, "anizm", u)
            safe_commit(conn)
            total_added += added
            processed += 1
            print(f"[Anizm] Processed: {u} (+{added} sources)", flush=True)
        except Exception as e:
            print(f"[Anizm] Error on {u}: {e}", flush=True)

        if limit and processed >= limit:
            break

    conn.close()
    return total_added


def main():
    parser = argparse.ArgumentParser(description="KoUp Phase 4 Backfill Runner")
    parser.add_argument(
        "--site",
        choices=["animelvl", "sezonlukdizi", "dizipal", "fullhdfilmizlesene", "tranimaci", "anizm", "all"],
        default="all",
        help="Site to scrape",
    )
    parser.add_argument("--limit", type=int, default=None, help="Max items to process per site")
    parser.add_argument("--resume", action="store_true", help="Skip already processed URLs from site_done")

    args = parser.parse_args()

    runners = {
        "animelvl": run_animelvl,
        "sezonlukdizi": run_sezonlukdizi,
        "dizipal": run_dizipal,
        "fullhdfilmizlesene": run_fullhdfilmizlesene,
        "tranimaci": run_tranimaci,
        "anizm": run_anizm,
    }

    start_t = time.time()
    total = 0

    if args.site == "all":
        for sname, fn in runners.items():
            try:
                cnt = fn(limit=args.limit, resume=args.resume)
                total += cnt
            except Exception as e:
                print(f"[{sname}] Runner exception: {e}", flush=True)
    else:
        fn = runners.get(args.site)
        if fn:
            total = fn(limit=args.limit, resume=args.resume)

    elapsed = int(time.time() - start_t)
    print(f"\n==========================================", flush=True)
    print(f"Phase 4 Run Complete: {total} total sources added in {elapsed}s", flush=True)
    print(f"==========================================", flush=True)


if __name__ == "__main__":
    main()
