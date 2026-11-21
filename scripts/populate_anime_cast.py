#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/populate_anime_cast.py

Full-Archive Character & Cast Populator (AniList + TMDb + MyDramaList):
- Preloads existing Supabase `people` and `media_cast` media_ids via parallel pagination
- Batch-fetches AniList characters (up to 20 per anime, MAIN -> lead, SUPPORTING -> support)
- Concurrently fetches TMDb credits (25 threads, order < 4 & rank <= 4 -> lead)
- Optionally fetches MyDramaList /cast for Asian dramas without TMDb ID (aborting cleanly on CF)
- Supports --dry-run, --apply, --db, --limit, and --refresh-hierarchy
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.sync_cast_hierarchy import (
    _get_creds,
    apply_cast_for_batch,
    clean_slug,
    fetch_all_pages,
    fetch_anilist_page_by_ids,
    fetch_mdl_cast_single,
    fetch_tmdb_cast_single,
    norm_name,
    sb_http,
    slugify,
)


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def main():
    parser = argparse.ArgumentParser(description="KoUp Full-Archive Cast & Character Populator")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--apply", action="store_true", help="Write changes to Supabase (default dry-run if --dry-run set)")
    parser.add_argument("--dry-run", action="store_true", help="Preview backfill counts without writing to Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Max media per provider phase (0 = all)")
    parser.add_argument("--refresh-hierarchy", action="store_true", help="Also fix existing media with mismatched lead/support roles")
    parser.add_argument("--include-mdl", action="store_true", help="Also try MyDramaList /cast for dramas without TMDb ID")
    args = parser.parse_args()

    dry_run = bool(args.dry_run and not args.apply)
    sb_url, sb_key, tmdb_key = _get_creds()
    if not sb_url or not sb_key:
        print("[ERROR] SUPABASE credentials missing!", flush=True)
        sys.exit(1)

    print(f"1. Supabase mevcut kadro ve kişi durumu taranıyor ({'DRY-RUN' if dry_run else 'APPLY'})...", flush=True)
    cast_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/media_cast?select=media_id,person_id,role_type,billing_order,character_name&order=media_id.asc,person_id.asc")
    existing_cast_by_media = defaultdict(list)
    for r in cast_rows:
        existing_cast_by_media[int(r["media_id"])].append(r)
    media_with_cast = set(existing_cast_by_media.keys())
    print(f"   -> Kadrosu olan yapım: {len(media_with_cast):,} ({len(cast_rows):,} kayıt)", flush=True)

    people_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/people?select=id,slug,name,tmdb_id,anilist_id&order=id.asc")
    people_idx = {"slug": {}, "clean": {}, "norm": {}, "tmdb": {}, "anilist": {}}
    for p in people_rows:
        pid = p.get("id")
        if not pid:
            continue
        if p.get("slug"):
            people_idx["slug"][p["slug"]] = pid
            cs = clean_slug(p["slug"])
            if cs and cs not in people_idx["clean"]:
                people_idx["clean"][cs] = pid
        if p.get("name"):
            nn = norm_name(p["name"])
            if nn and nn not in people_idx["norm"]:
                people_idx["norm"][nn] = pid
        if p.get("tmdb_id"):
            people_idx["tmdb"][int(p["tmdb_id"])] = pid
        if p.get("anilist_id"):
            people_idx["anilist"][int(p["anilist_id"])] = pid

    sb_media = fetch_all_pages(sb_url, sb_key, "/rest/v1/media?select=id,title,content_type,anilist_id,tmdb_id,mydramalist_url&order=id.asc")
    db_path = args.db or os.environ.get("ARCHIVE_DB_PATH") or os.path.join(_ROOT, "webdrama_archive.db")
    sqlite_ids = {}
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path, timeout=30.0)
        for row in conn.execute("SELECT id, anilist_id, tmdb_id, content_type, mydramalist_url FROM dramas"):
            sqlite_ids[row[0]] = row[1:]
        conn.close()

    aid_to_mids = defaultdict(list)
    missing_tmdb = []
    missing_mdl = []

    for m in sb_media:
        mid = int(m["id"])
        has_cast = mid in media_with_cast
        if has_cast and not args.refresh_hierarchy:
            continue
        ctype = m.get("content_type") or ""
        aid = m.get("anilist_id")
        tid = m.get("tmdb_id")
        mdl = m.get("mydramalist_url")
        if mid in sqlite_ids:
            s_aid, s_tid, s_ctype, s_mdl = sqlite_ids[mid]
            aid = aid or s_aid
            tid = tid or s_tid
            ctype = ctype or (s_ctype or "")
            mdl = mdl or s_mdl

        if ctype == "anime" and aid and int(aid) > 0:
            aid_to_mids[int(aid)].append(mid)
        elif tid and int(tid) > 0:
            missing_tmdb.append((mid, int(tid), ctype))
        elif mdl and args.include_mdl:
            missing_mdl.append((mid, mdl))

    unique_aids = sorted(aid_to_mids.keys())
    if args.limit > 0:
        unique_aids = unique_aids[: args.limit]
        missing_tmdb = missing_tmdb[: args.limit]
        missing_mdl = missing_mdl[: args.limit]

    print(
        f"2. Hedefler -> AniList Anime: {len(unique_aids):,} tekil ID | TMDb Dizi/Film: {len(missing_tmdb):,} | MDL: {len(missing_mdl):,}",
        flush=True,
    )

    totals = defaultdict(int)
    for b_idx in range(0, len(unique_aids), 50):
        aid_batch = unique_aids[b_idx : b_idx + 50]
        edges_by_aid = fetch_anilist_page_by_ids(aid_batch)
        planned_by_media = {}
        for aid, edges in edges_by_aid.items():
            planned = []
            for c_idx, edge in enumerate(edges, 1):
                node = edge.get("node") or {}
                vas = edge.get("voiceActors") or []
                va = vas[0] if vas else {}
                char_name = (node.get("name") or {}).get("full") or (node.get("name") or {}).get("userPreferred") or ""
                if not char_name:
                    continue
                va_name = (va.get("name") or {}).get("full") or (va.get("name") or {}).get("userPreferred") or ""
                planned.append({
                    "name": char_name,
                    "slug": slugify(char_name),
                    "img_url": (node.get("image") or {}).get("large") or (node.get("image") or {}).get("medium") or (va.get("image") or {}).get("large"),
                    "tmdb_id": None,
                    "anilist_id": int(node["id"]) if node.get("id") else None,
                    "person_type": "character",
                    "character_name": f"Seslendiren: {va_name}" if va_name else char_name,
                    "role_type": "lead" if edge.get("role") == "MAIN" else "support",
                    "billing_order": c_idx,
                    "voice_actor_name": va_name or None,
                    "voice_actor_image": (va.get("image") or {}).get("large") or (va.get("image") or {}).get("medium"),
                    "voice_actor_slug": slugify(va_name) if va_name else None,
                })
            if planned:
                for mid in aid_to_mids[aid]:
                    planned_by_media[mid] = planned
        if planned_by_media:
            res = apply_cast_for_batch(sb_url, sb_key, planned_by_media, existing_cast_by_media, people_idx, dry_run=dry_run)
            for k, v in res.items():
                totals[k] += v
        done = min(b_idx + 50, len(unique_aids))
        if done % 250 == 0 or done == len(unique_aids):
            print(f"[{_ts()}] [{done}/{len(unique_aids)}] ({done/max(1,len(unique_aids))*100:.1f}%) - AniList backfill", flush=True)
        time.sleep(0.6)

    if missing_tmdb and tmdb_key:
        for c_idx in range(0, len(missing_tmdb), 250):
            chunk = missing_tmdb[c_idx : c_idx + 250]
            planned_by_media = {}
            with ThreadPoolExecutor(max_workers=25) as pool:
                for fut in as_completed([pool.submit(fetch_tmdb_cast_single, tmdb_key, item) for item in chunk]):
                    did, planned = fut.result()
                    if planned:
                        planned_by_media[did] = planned
            if planned_by_media:
                res = apply_cast_for_batch(sb_url, sb_key, planned_by_media, existing_cast_by_media, people_idx, dry_run=dry_run)
                for k, v in res.items():
                    totals[k] += v
            done = min(c_idx + 250, len(missing_tmdb))
            print(f"[{_ts()}] [{done}/{len(missing_tmdb)}] ({done/len(missing_tmdb)*100:.1f}%) - TMDb backfill", flush=True)

    if missing_mdl:
        planned_mdl = {}
        for idx, (mid, mdl_url) in enumerate(missing_mdl, 1):
            planned, cf_blocked = fetch_mdl_cast_single(mdl_url)
            if cf_blocked:
                print(f"[MDL] Cloudflare engeli algılandı -> MDL atlandı ({idx}/{len(missing_mdl)}).", flush=True)
                break
            if planned:
                planned_mdl[mid] = planned
            time.sleep(0.6)
        if planned_mdl:
            res = apply_cast_for_batch(sb_url, sb_key, planned_mdl, existing_cast_by_media, people_idx, dry_run=dry_run)
            for k, v in res.items():
                totals[k] += v

    print(f"\n[TAMAMLANDI] ({'DRY-RUN' if dry_run else 'APPLY'}) -> {json.dumps(dict(totals), ensure_ascii=False)}", flush=True)
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': dry_run, **dict(totals)}, ensure_ascii=False)}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
