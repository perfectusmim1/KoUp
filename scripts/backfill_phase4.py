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
from concurrent.futures import ThreadPoolExecutor, as_completed

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

from database import DB_PATH
from scrapers.multisite import build_drama_index, done_urls, mark_done, safe_commit
from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=120)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=120000;")
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
    print(f"\n--- [Phase 4] Running SezonlukDizi High-Speed Scraper (limit={limit}) ---", flush=True)
    session = sezonlukdizi._get_session()
    urls = sezonlukdizi.get_series_sitemap_urls(session, max_pages=20)
    print(f"[SezonlukDizi] Found {len(urls)} series in sitemap", flush=True)

    conn = get_db_connection()
    cur = conn.cursor()
    already_done = done_urls(cur, "sezonlukdizi") if resume else set()
    conn.close()

    to_process = [u for u in urls if not (resume and u in already_done)]
    if limit:
        to_process = to_process[:limit]

    print(f"[SezonlukDizi] To process: {len(to_process)} series in non-blocking batches of 24...", flush=True)
    total_added = 0
    batch_size = 24

    for b_idx in range(0, len(to_process), batch_size):
        batch_urls = to_process[b_idx: b_idx + batch_size]

        # Stage 1: Parallel in-memory HTTP resolution (NO DB HOLD)
        resolved_series = []
        with ThreadPoolExecutor(max_workers=12) as executor:
            futs = {executor.submit(sezonlukdizi.fetch_series_memory, u): u for u in batch_urls}
            for fut in as_completed(futs):
                try:
                    res = fut.result()
                    if res:
                        resolved_series.append(res)
                except Exception:
                    pass

        # Stage 2: Fast micro-transaction SQLite write
        conn = get_db_connection()
        cur = conn.cursor()
        idx = build_drama_index(cur, content_types=("dizi", "anime", "film"))
        added, affected_dramas = sezonlukdizi.save_series_batch(conn, cur, idx, resolved_series)
        for u in batch_urls:
            mark_done(cur, "sezonlukdizi", u)
        safe_commit(conn)
        conn.close()

        # Stage 3: Sync R2 bundles & Supabase for affected dramas
        if affected_dramas:
            conn = get_db_connection()
            cur = conn.cursor()
            for did in affected_dramas:
                try:
                    sync_drama_bundle_and_counts(conn, cur, did)
                except Exception:
                    pass
            conn.close()

        total_added += added
        processed_so_far = min(b_idx + len(batch_urls), len(to_process))
        print(f"[SezonlukDizi Batch {b_idx//batch_size + 1}] Processed {processed_so_far}/{len(to_process)} (Batch: +{added} sources, Total: +{total_added})", flush=True)

    return total_added


def run_dizipal(limit=None, resume=False):
    from scrapers.sites import dizipal
    print(f"\n--- [Phase 4] Running Dizipal High-Speed Scraper (limit={limit}) ---", flush=True)
    session = dizipal._get_session()
    base_url = dizipal.resolve_current_domain(session)
    print(f"[Dizipal] Active domain: {base_url}", flush=True)

    unique_urls = dizipal.get_catalog_items(session, base_url, max_pages=200)
    print(f"[Dizipal] Found {len(unique_urls)} items in catalog", flush=True)

    conn = get_db_connection()
    cur = conn.cursor()
    already_done = done_urls(cur, "dizipal") if resume else set()
    conn.close()

    to_process = [u for u in unique_urls if not (resume and (u in already_done or u.split("?")[0] in already_done))]
    if limit:
        to_process = to_process[:limit]

    print(f"[Dizipal] To process: {len(to_process)} items in non-blocking batches of 32...", flush=True)
    total_added = 0
    batch_size = 32

    for b_idx in range(0, len(to_process), batch_size):
        batch_urls = to_process[b_idx: b_idx + batch_size]

        # Stage 1: Parallel in-memory HTTP resolution (NO DB HOLD)
        resolved_items = []
        with ThreadPoolExecutor(max_workers=16) as executor:
            futs = {executor.submit(dizipal.fetch_dizipal_item_memory, u, base_url): u.split("?")[0] for u in batch_urls}
            for fut in as_completed(futs):
                try:
                    res = fut.result()
                    if res:
                        resolved_items.append(res)
                except Exception:
                    pass

        # Stage 2: Fast micro-transaction SQLite write
        conn = get_db_connection()
        cur = conn.cursor()
        idx = build_drama_index(cur, content_types=("dizi", "film", "anime"))
        added, affected_dramas = dizipal.save_dizipal_items_batch(conn, cur, idx, resolved_items, base_url)
        for u in batch_urls:
            mark_done(cur, "dizipal", u)
            mark_done(cur, "dizipal", u.split("?")[0])
        safe_commit(conn)
        conn.close()

        # Stage 3: Sync R2 bundles & Supabase for affected dramas
        if affected_dramas:
            conn = get_db_connection()
            cur = conn.cursor()
            for did in affected_dramas:
                try:
                    sync_drama_bundle_and_counts(conn, cur, did)
                except Exception:
                    pass
            conn.close()

        total_added += added
        processed_so_far = min(b_idx + len(batch_urls), len(to_process))
        print(f"[Dizipal Batch {b_idx//batch_size + 1}] Processed {processed_so_far}/{len(to_process)} (Batch: +{added} sources, Total: +{total_added})", flush=True)

    return total_added


def run_fullhdfilmizlesene(limit=None, resume=False):
    from scrapers.sites import fullhdfilmizlesene
    print(f"\n--- [Phase 4] Running FullHDfilmizlesene High-Speed Scraper (limit={limit}) ---", flush=True)
    session = fullhdfilmizlesene._get_session()
    base_url = fullhdfilmizlesene.resolve_base_url(session)
    print(f"[FullHDFilmizlesene] Base domain: {base_url}", flush=True)

    urls = fullhdfilmizlesene.get_catalog_urls(session, base_url=base_url, max_pages=1500)
    print(f"[FullHDFilmizlesene] Found {len(urls)} movies in catalog", flush=True)

    conn = get_db_connection()
    cur = conn.cursor()
    already_done = done_urls(cur, "fullhdfilmizlesene") if resume else set()
    conn.close()

    to_process = [u for u in urls if not (resume and u in already_done)]
    if limit:
        to_process = to_process[:limit]

    print(f"[FullHDFilmizlesene] To process: {len(to_process)} movies in non-blocking batches of 32...", flush=True)
    total_added = 0
    batch_size = 32

    for b_idx in range(0, len(to_process), batch_size):
        batch_urls = to_process[b_idx: b_idx + batch_size]

        # Stage 1: Parallel in-memory HTTP resolution (NO DB HOLD)
        resolved_movies = []
        with ThreadPoolExecutor(max_workers=16) as executor:
            futs = {executor.submit(fullhdfilmizlesene.fetch_movie_memory, u): u for u in batch_urls}
            for fut in as_completed(futs):
                try:
                    res = fut.result()
                    if res and res.get("sources"):
                        resolved_movies.append(res)
                except Exception:
                    pass

        # Stage 2: Fast micro-transaction SQLite write (<100ms)
        conn = get_db_connection()
        cur = conn.cursor()
        idx = build_drama_index(cur, content_types=("film", "dizi"))
        added, affected_dramas = fullhdfilmizlesene.save_movies_batch(conn, cur, idx, resolved_movies)
        for u in batch_urls:
            mark_done(cur, "fullhdfilmizlesene", u)
        safe_commit(conn)
        conn.close()

        # Stage 3: Sync R2 bundles & Supabase for affected dramas
        if affected_dramas:
            conn = get_db_connection()
            cur = conn.cursor()
            for did in affected_dramas:
                try:
                    sync_drama_bundle_and_counts(conn, cur, did)
                except Exception:
                    pass
            conn.close()

        total_added += added
        processed_so_far = min(b_idx + len(batch_urls), len(to_process))
        print(f"[FullHDFilmizlesene Batch {b_idx//batch_size + 1}] Processed {processed_so_far}/{len(to_process)} (Batch: +{added} sources, Total: +{total_added})", flush=True)

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

    urls = tranimaci_anizm.get_anizm_catalog_urls(session, max_pages=150)
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
