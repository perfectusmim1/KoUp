#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/recover_and_heal_sources.py

KoUp Universal Under-Scraped & Sequence-Gap Recovery Engine:
1. Cross-references SQLite `episode_count` AND optional live TMDB/AniList/MDL expected
   episode counts (--check-external) to find:
   - 0-source / pending episodes (`empty_sources`)
   - Internal min..max sequence gaps (`sequence_gap`)
   - Under-scraped series where expected episode_count >> sourced episodes (`under_scraped`)
2. Runs multi-site recovery across all working scrapers:
   - Anime: animecix, asyaanimeleri, animelvl, asyawatch, dizibox
   - Korean/Asian: dizikorea, asyawatch, dizifon, diziizle, bldrama, dizibox
     (skips Turnstile-gated webdramaturkey2 automatically on first 403/Challenge;
      optional --wdt-slow throttle flag for residential IP runs, never bypassing Turnstile)
   - Turkish: ddizi, diziizle, sezonlukdizi
   - Western: dizibox, dizilla, sezonlukdizi, diziizle, hdfilm
   - Short Drama: shortizle, dramavadisi
3. Never inserts `pending://gap` placeholders. Logs exact unfillable gaps to JSON.
4. Supports --dry-run (default unless --apply), --db, --limit, --category, --drama-id, --no-remote-sync.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.sync_target_drama import (
    get_db,
    sync_animecix_target,
    sync_asyaanimeleri_target,
    sync_asyawatch_target,
    sync_bldrama_target,
    sync_ddizi_target,
    sync_dizibox_target,
    sync_dizifon_target,
    sync_dizikorea_target,
    sync_dizilla_target,
    sync_hdfilm_target,
)
from scrapers.supabase_sync_helper import backup_db_to_r2, sync_drama_bundle_and_counts

ASIAN_COUNTRIES = {"KR", "JP", "CN", "TH", "TW", "HK", "PH", "ID", "MY", "VN", "SG", "IN", "PK"}
TURNSTILE_BLOCKED_HOSTS: set[str] = set()


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)


def _load_tmdb_key() -> str:
    for cand in (
        os.path.join(_ROOT, "koup-app", ".env.local"),
        os.path.join(os.path.dirname(_ROOT), "koup-app", ".env.local"),
    ):
        if os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip().startswith("TMDB_API_KEY="):
                            return line.split("=", 1)[1].strip().strip('"').strip("'")
            except Exception:
                pass
    return os.environ.get("TMDB_API_KEY") or ""


def _fetch_expected_episode_count(drama_row: dict, tmdb_key: str) -> int | None:
    """Cross-references TMDB or AniList for expected episode_count when available."""
    ctype = (drama_row.get("content_type") or "").lower()
    tid = drama_row.get("tmdb_id")
    aid = drama_row.get("anilist_id")

    if ctype == "anime" and aid:
        try:
            q = "query ($id: Int) { Media(id: $id, type: ANIME) { episodes } }"
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=json.dumps({"query": q, "variables": {"id": int(aid)}}).encode("utf-8"),
                headers={"Content-Type": "application/json", "User-Agent": "KoUp/1.0"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                if resp.status == 200:
                    eps = ((json.loads(resp.read().decode("utf-8")).get("data") or {}).get("Media") or {}).get("episodes")
                    if eps:
                        return int(eps)
        except Exception:
            pass

    if tid and tmdb_key and ctype != "film":
        try:
            url = f"https://api.themoviedb.org/3/tv/{int(tid)}?api_key={tmdb_key}"
            req = urllib.request.Request(url, headers={"User-Agent": "KoUp/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                if resp.status == 200:
                    n = json.loads(resp.read().decode("utf-8")).get("number_of_episodes")
                    if n:
                        return int(n)
        except Exception:
            pass
    return None


def _count_empty_eps(cur, did: int) -> int:
    total = cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id = ?", (did,)).fetchone()[0]
    if total == 0:
        return 1
    return cur.execute(
        """
        SELECT COUNT(*) FROM episodes e
        WHERE e.drama_id = ?
          AND (e.source_status = 'pending' OR NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id))
        """,
        (did,),
    ).fetchone()[0]


def _min_sources_per_ep(cur, did: int) -> int:
    row = cur.execute(
        """
        SELECT MIN(cnt) FROM (
            SELECT COUNT(es.id) as cnt
            FROM episodes e
            LEFT JOIN episode_sources es ON es.episode_id = e.id
            WHERE e.drama_id = ?
            GROUP BY e.id
        )
        """,
        (did,),
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def _update_local_drama_counts(conn, cur, did: int):
    cur.execute(
        """
        UPDATE dramas
        SET episodes_available = (
                SELECT COUNT(*) FROM episodes e
                WHERE e.drama_id = ? AND EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
            ),
            sources_count = (
                SELECT COUNT(*) FROM episode_sources es
                JOIN episodes e ON e.id = es.episode_id
                WHERE e.drama_id = ?
            )
        WHERE id = ?
        """,
        (did, did, did),
    )
    conn.commit()


def _category_sql(category: str) -> str:
    if category == "anime":
        return "AND LOWER(d.content_type) = 'anime'"
    if category == "korea":
        return "AND UPPER(d.country) = 'KR' AND LOWER(d.content_type) != 'anime'"
    if category == "asia":
        return "AND UPPER(d.country) IN ('CN', 'TH', 'JP', 'TW', 'HK', 'PH', 'ID', 'MY', 'IN') AND LOWER(d.content_type) != 'anime'"
    if category == "western":
        return "AND UPPER(d.country) NOT IN ('KR', 'JP', 'CN', 'TH', 'TW', 'HK', 'PH', 'ID', 'MY', 'IN', 'TR') AND LOWER(d.content_type) != 'anime'"
    if category == "turkish":
        return "AND UPPER(d.country) = 'TR'"
    if category == "shortdrama":
        return "AND LOWER(d.content_type) = 'kisa_drama'"
    return ""


def find_candidate_dramas(conn, limit=50, category="all", only_empty=False, max_gap_size=2500):
    cur = conn.cursor()
    cat_sql = _category_sql(category)
    candidates = []
    seen_ids = set()

    # 1. Empty / pending episodes (highest priority)
    cur.execute(
        f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url, d.episode_count,
               d.tmdb_id, d.anilist_id, d.mydramalist_url,
               COUNT(DISTINCT e.id) as total_eps,
               CASE WHEN COUNT(DISTINCT e.id) = 0 THEN 1
                    ELSE COUNT(DISTINCT CASE WHEN e.source_status = 'pending'
                                                  OR NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
                                               THEN e.id END)
               END as empty_eps
        FROM dramas d
        LEFT JOIN episodes e ON e.drama_id = d.id
        WHERE 1=1 {cat_sql}
        GROUP BY d.id
        HAVING empty_eps > 0
        ORDER BY empty_eps DESC, d.id DESC
        LIMIT ?
        """,
        (limit,),
    )
    for row in cur.fetchall():
        did = row[0]
        seen_ids.add(did)
        candidates.append({
            "id": did,
            "title": row[1],
            "slug": row[2],
            "content_type": (row[3] or "").lower(),
            "country": (row[4] or "").upper(),
            "source_url": row[5] or "",
            "expected_count": int(row[6]) if row[6] and str(row[6]).isdigit() else 0,
            "tmdb_id": row[7],
            "anilist_id": row[8],
            "mydramalist_url": row[9],
            "total_eps": row[10],
            "empty_count": row[11],
            "reason": "empty_sources",
        })

    if only_empty or len(candidates) >= limit:
        return candidates[:limit]

    # 2. Under-scraped dramas (expected episode_count >= 10 & missing >= 5 sourced eps)
    cur.execute(
        f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url, d.episode_count,
               d.tmdb_id, d.anilist_id, d.mydramalist_url,
               COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id) THEN e.id END) AS sourced_eps
        FROM dramas d
        LEFT JOIN episodes e ON e.drama_id = d.id
        WHERE CAST(COALESCE(d.episode_count, '0') AS INTEGER) >= 10
          AND LOWER(COALESCE(d.content_type, 'dizi')) != 'film'
          {cat_sql}
        GROUP BY d.id
        HAVING (CAST(d.episode_count AS INTEGER) - sourced_eps) >= 5
        ORDER BY (CAST(d.episode_count AS INTEGER) - sourced_eps) DESC
        LIMIT ?
        """,
        (limit,),
    )
    for row in cur.fetchall():
        did = row[0]
        if did in seen_ids:
            continue
        seen_ids.add(did)
        exp_c = int(row[6]) if row[6] and str(row[6]).isdigit() else 0
        candidates.append({
            "id": did,
            "title": row[1],
            "slug": row[2],
            "content_type": (row[3] or "").lower(),
            "country": (row[4] or "").upper(),
            "source_url": row[5] or "",
            "expected_count": exp_c,
            "tmdb_id": row[7],
            "anilist_id": row[8],
            "mydramalist_url": row[9],
            "total_eps": row[10],
            "empty_count": max(0, exp_c - row[10]),
            "reason": "under_scraped",
        })
        if len(candidates) >= limit:
            return candidates[:limit]

    # 3. Internal sequence gaps (min..max)
    cur.execute(
        f"""
        SELECT d.id, d.title, d.slug, d.content_type, d.country, d.source_url, d.episode_count,
               d.tmdb_id, d.anilist_id, d.mydramalist_url
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        WHERE LOWER(COALESCE(d.content_type, 'dizi')) != 'film' {cat_sql}
        GROUP BY d.id
        HAVING COUNT(e.id) > 0
        """
    )
    for row in cur.fetchall():
        did = row[0]
        if did in seen_ids:
            continue
        ep_nums = {
            r[0]
            for r in cur.execute(
                "SELECT episode_number FROM episodes WHERE drama_id = ? AND COALESCE(season_number, 1) > 0",
                (did,),
            ).fetchall()
            if r[0] is not None
        }
        if not ep_nums:
            continue
        min_ep, max_ep = min(ep_nums), max(ep_nums)
        if max_ep > 2500:
            continue
        start_ep = 1 if min_ep <= 3 else min_ep
        missing = set(range(start_ep, max_ep + 1)) - ep_nums
        if missing and len(missing) <= max_gap_size:
            seen_ids.add(did)
            candidates.append({
                "id": did,
                "title": row[1],
                "slug": row[2],
                "content_type": (row[3] or "").lower(),
                "country": (row[4] or "").upper(),
                "source_url": row[5] or "",
                "expected_count": max_ep,
                "tmdb_id": row[7],
                "anilist_id": row[8],
                "mydramalist_url": row[9],
                "total_eps": len(ep_nums),
                "empty_count": len(missing),
                "reason": "sequence_gap",
            })
            if len(candidates) >= limit:
                break

    return candidates[:limit]


def choose_provider(item):
    source_url = (item.get("source_url") or "").lower()
    country = (item.get("country") or "").upper()
    ctype = (item.get("content_type") or "").lower()
    if ctype == "kisa_drama":
        return "shortdrama"
    if ctype == "anime":
        return "animecix"
    if country == "TR" or "ddizi" in source_url:
        return "ddizi"
    if country in ASIAN_COUNTRIES or any(
        k in source_url for k in ("dizikorea", "asyawatch", "dizifon", "asyadizi", "asyaluna", "asyaking", "bldrama", "webdramaturkey")
    ):
        return "dizikorea"
    return "dizibox"


def _sync_animelvl_target(conn, cur, drama):
    surl = (drama.get("source_url") or "").lower()
    if "animelvl" not in surl:
        return 0, 0
    try:
        from curl_cffi import requests as cfr
        from scrapers.multisite import build_drama_index
        from scrapers.sites.animelvl import scrape_anime_page

        sess = cfr.Session(impersonate="chrome")
        idx = build_drama_index(cur)
        added = scrape_anime_page(conn, cur, idx, sess, drama["source_url"])
        return 0, int(added or 0)
    except Exception:
        return 0, 0


def _sync_diziizle_target(conn, cur, drama):
    surl = (drama.get("source_url") or "").lower()
    if "diziizle" not in surl:
        return 0, 0
    try:
        from scrapers.multisite import build_drama_index
        from scrapers.sites.diziizle import scrape_diziizle_series

        idx = build_drama_index(cur)
        res = scrape_diziizle_series(
            cur=cur,
            conn=conn,
            series_url=drama["source_url"],
            idx=idx,
            is_anime=(drama.get("content_type") == "anime"),
            max_episodes=250,
        )
        return int(res.get("episodes_added", 0)), int(res.get("sources_added", 0))
    except Exception:
        return 0, 0


def _sync_sezonlukdizi_target(conn, cur, drama):
    surl = (drama.get("source_url") or "").lower()
    if "sezonlukdizi" not in surl:
        return 0, 0
    try:
        from curl_cffi import requests as cfr
        from scrapers.multisite import build_drama_index
        from scrapers.sites.sezonlukdizi import scrape_series

        sess = cfr.Session(impersonate="chrome")
        idx = build_drama_index(cur)
        added = scrape_series(conn, cur, idx, sess, drama["source_url"])
        return 0, int(added or 0)
    except Exception:
        return 0, 0


def _sync_wdt_slow_target(conn, cur, drama, wdt_slow: bool):
    if not wdt_slow or "webdramaturkey2" in TURNSTILE_BLOCKED_HOSTS:
        return 0, 0, ("turnstile_blocked:webdramaturkey2" if "webdramaturkey2" in TURNSTILE_BLOCKED_HOSTS else "")
    surl = (drama.get("source_url") or "").lower()
    if "webdramaturkey" not in surl:
        return 0, 0, ""
    try:
        from scrapers.multisite import build_drama_index
        from scrapers.sites.webdramaturkey import scrape_wdt_series_or_film

        time.sleep(3.0)
        idx = build_drama_index(cur)
        res = scrape_wdt_series_or_film(cur, conn, drama["source_url"], idx=idx, is_film=(drama.get("content_type") == "film"))
        err = str(res.get("error") or "")
        if "403" in err or "turnstile" in err.lower() or "alınamadı" in err.lower():
            TURNSTILE_BLOCKED_HOSTS.add("webdramaturkey2")
            log("TURNSTILE_SKIP", "webdramaturkey2 403/Turnstile algılandı -> oturum boyunca temizce atlanıyor (bypass yok).")
            return 0, 0, "turnstile_blocked:webdramaturkey2"
        return int(res.get("episodes_added", 0)), int(res.get("sources_added", 0)), ""
    except Exception as e:
        return 0, 0, str(e)


def _sync_shortdrama_target(conn, cur, drama):
    surl = (drama.get("source_url") or "").lower()
    if "shortizle" in surl:
        try:
            from scrapers.shortdrama.shortizle import ShortizleScraper
            sc = ShortizleScraper()
            if hasattr(sc, "scrape_drama"):
                res = sc.scrape_drama(drama["source_url"])
                if isinstance(res, dict):
                    return int(res.get("episodes_added", 0)), int(res.get("sources_added", 0))
        except Exception:
            pass
    elif "dramavadisi" in surl:
        try:
            from scrapers.shortdrama.dramavadisi import DramaVadisiScraper
            sc = DramaVadisiScraper()
            if hasattr(sc, "scrape_drama"):
                res = sc.scrape_drama(drama["source_url"])
                if isinstance(res, dict):
                    return int(res.get("episodes_added", 0)), int(res.get("sources_added", 0))
        except Exception:
            pass
    return 0, 0


def heal_drama(conn, cur, drama_item, sync_remote=True, wdt_slow=False, unfillable_log=None):
    did = drama_item["id"]
    cur.execute("SELECT * FROM dramas WHERE id = ?", (did,))
    row = cur.fetchone()
    if not row:
        return 0, 0
    drama = dict(row)

    source_url = (drama.get("source_url") or "").lower()
    country = (drama.get("country") or "").upper()
    ctype = (drama.get("content_type") or "").lower()

    if ctype == "kisa_drama":
        e_add, s_add = _sync_shortdrama_target(conn, cur, drama)
        if e_add > 0 or s_add > 0:
            if sync_remote:
                sync_drama_bundle_and_counts(conn, cur, did)
            else:
                _update_local_drama_counts(conn, cur, did)
        elif unfillable_log is not None:
            unfillable_log.append({"drama_id": did, "title": drama.get("title"), "reason": "shortdrama_source_exhausted"})
        return e_add, s_add

    if ctype == "anime":
        chain = [
            ("animecix", sync_animecix_target),
            ("asyaanimeleri", sync_asyaanimeleri_target),
            ("animelvl", _sync_animelvl_target),
            ("asyawatch", sync_asyawatch_target),
            ("dizibox", sync_dizibox_target),
        ]
    elif country == "TR" or "ddizi" in source_url:
        chain = [
            ("ddizi", sync_ddizi_target),
            ("diziizle", _sync_diziizle_target),
            ("sezonlukdizi", _sync_sezonlukdizi_target),
        ]
    elif country in ASIAN_COUNTRIES or any(
        k in source_url for k in ("dizikorea", "asyawatch", "dizifon", "asyadizi", "asyaluna", "asyaking", "bldrama", "webdramaturkey", "diziizle")
    ):
        chain = [
            ("dizikorea", sync_dizikorea_target),
            ("asyawatch", sync_asyawatch_target),
            ("dizifon", sync_dizifon_target),
            ("diziizle", _sync_diziizle_target),
            ("bldrama", sync_bldrama_target),
            ("dizibox", sync_dizibox_target),
        ]
    else:
        chain = [
            ("dizibox", sync_dizibox_target),
            ("dizilla", sync_dizilla_target),
            ("sezonlukdizi", _sync_sezonlukdizi_target),
            ("diziizle", _sync_diziizle_target),
            ("hdfilm", sync_hdfilm_target),
        ]

    total_eps_added = 0
    total_srcs_added = 0
    skip_reasons = []

    if "webdramaturkey" in source_url:
        if not wdt_slow:
            skip_reasons.append("turnstile_skipped_default:webdramaturkey2")
        else:
            we, ws, werr = _sync_wdt_slow_target(conn, cur, drama, wdt_slow=True)
            total_eps_added += we
            total_srcs_added += ws
            if werr:
                skip_reasons.append(werr)

    for idx, (prov_name, sync_fn) in enumerate(chain):
        empty_rem = _count_empty_eps(cur, did)
        min_srcs = _min_sources_per_ep(cur, did)
        should_run = (idx == 0) or (empty_rem > 0) or (total_srcs_added == 0) or (min_srcs < 2 and prov_name in source_url)
        if not should_run:
            continue
        try:
            e_add, s_add = sync_fn(conn, cur, drama)
            total_eps_added += e_add
            total_srcs_added += s_add
        except Exception as e:
            log("ERROR", f"#{did} ({prov_name}) hata: {e}")

    if total_eps_added > 0 or total_srcs_added > 0:
        if sync_remote:
            sync_drama_bundle_and_counts(conn, cur, did)
        else:
            _update_local_drama_counts(conn, cur, did)
    elif unfillable_log is not None:
        unfillable_log.append({
            "drama_id": did,
            "title": drama.get("title"),
            "source_url": drama.get("source_url"),
            "reason": ";".join(skip_reasons) if skip_reasons else "no_new_sources_on_providers",
        })

    return total_eps_added, total_srcs_added


def run_recovery(
    limit=30,
    category="all",
    only_empty=False,
    drama_id=None,
    sync_remote=True,
    dry_run=False,
    db_path=None,
    check_external=False,
    wdt_slow=False,
):
    if db_path:
        conn = sqlite3.connect(db_path, timeout=60.0)
        conn.row_factory = sqlite3.Row
    else:
        conn = get_db()
    cur = conn.cursor()

    if drama_id:
        row = cur.execute(
            "SELECT id, title, slug, content_type, country, source_url, episode_count, tmdb_id, anilist_id, mydramalist_url FROM dramas WHERE id = ?",
            (drama_id,),
        ).fetchone()
        if not row:
            log("ERROR", f"Dizi #{drama_id} veritabanında bulunamadı.")
            conn.close()
            return 0, 0, 0
        candidates = [{
            "id": row["id"],
            "title": row["title"],
            "slug": row["slug"],
            "content_type": (row["content_type"] or "").lower(),
            "country": (row["country"] or "").upper(),
            "source_url": row["source_url"] or "",
            "expected_count": int(row["episode_count"]) if row["episode_count"] and str(row["episode_count"]).isdigit() else 0,
            "tmdb_id": row["tmdb_id"],
            "anilist_id": row["anilist_id"],
            "mydramalist_url": row["mydramalist_url"],
            "empty_count": _count_empty_eps(cur, row["id"]),
            "total_eps": 0,
            "reason": "manual_id",
        }]
    else:
        candidates = find_candidate_dramas(conn, limit=limit, category=category, only_empty=only_empty)

    if check_external and candidates:
        tmdb_key = _load_tmdb_key()
        for c in candidates:
            ext_cnt = _fetch_expected_episode_count(c, tmdb_key)
            if ext_cnt and ext_cnt > c.get("expected_count", 0):
                c["expected_count"] = ext_cnt

    log("ENGINE", f"Kaynak Kurtarma Motoru ({'DRY-RUN' if dry_run else 'APPLY'}): {len(candidates)} aday (Kategori: {category}, Limit: {limit})")

    if dry_run:
        for idx, item in enumerate(candidates, 1):
            prov = choose_provider(item)
            pct = idx / max(1, len(candidates)) * 100.0
            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] [{idx}/{len(candidates)}] ({pct:.1f}%) - "
                f"#{item['id']} '{item['title']}' ({prov}) | reason={item['reason']} empty/gap={item['empty_count']} exp={item.get('expected_count', 0)}",
                flush=True,
            )
        conn.close()
        print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': True, 'candidatesCount': len(candidates)}, ensure_ascii=False)}", flush=True)
        return 0, 0, 0

    healed_count = 0
    total_eps_recovered = 0
    total_srcs_recovered = 0
    unfillable_log: list[dict] = []
    start_time = time.time()

    for idx, item in enumerate(candidates, 1):
        did = item["id"]
        title = item["title"]
        provider = choose_provider(item)
        pct = idx / max(1, len(candidates)) * 100.0
        log("PROGRESS", f"[{idx}/{len(candidates)}] ({pct:.1f}%) #{did} '{title}' ({provider.upper()}) | {item.get('reason')} ({item.get('empty_count', 0)})")

        try:
            eps_add, srcs_add = heal_drama(conn, cur, item, sync_remote=sync_remote, wdt_slow=wdt_slow, unfillable_log=unfillable_log)
            if eps_add > 0 or srcs_add > 0:
                healed_count += 1
                total_eps_recovered += eps_add
                total_srcs_recovered += srcs_add
                log("SUCCESS", f"-> #{did} '{title}' (+{eps_add} bölüm, +{srcs_add} kaynak)")
        except Exception as e:
            log("ERROR", f"-> #{did} '{title}' onarım hatası: {e}")

        if idx % 10 == 0:
            try:
                conn.commit()
                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
            except Exception:
                pass

    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
    conn.close()

    if unfillable_log:
        os.makedirs(os.path.join(_ROOT, "scratch"), exist_ok=True)
        report_path = os.path.join(_ROOT, "scratch", "unfillable_gaps.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(unfillable_log, f, ensure_ascii=False, indent=2)
        log("GAP_LOG", f"{len(unfillable_log)} doldurulamayan seri kaydedildi -> {report_path}")

    if sync_remote:
        try:
            backup_db_to_r2()
        except Exception as e:
            log("R2_SYNC", f"Final R2 yedekleme hatası: {e}")

    elapsed = round(time.time() - start_time, 1)
    log("SUMMARY", f"Tamamlandı ({elapsed}s) | Onarılan: {healed_count} | +Bölüm: {total_eps_recovered} | +Kaynak: {total_srcs_recovered} | Doldurulamayan: {len(unfillable_log)}")
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': False, 'healed': healed_count, 'epsAdded': total_eps_recovered, 'srcsAdded': total_srcs_recovered, 'unfillable': len(unfillable_log)}, ensure_ascii=False)}", flush=True)
    return healed_count, total_eps_recovered, total_srcs_recovered


def main():
    parser = argparse.ArgumentParser(description="KoUp Universal Source Recovery & Catalog Healing Engine")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--drama-id", type=int, default=None, help="Specific drama ID to heal")
    parser.add_argument("--limit", type=int, default=30, help="Number of series to inspect/heal")
    parser.add_argument("--category", type=str, default="all", choices=["all", "anime", "korea", "asia", "western", "turkish", "shortdrama"])
    parser.add_argument("--only-empty", action="store_true", help="Only target series with empty/pending episodes")
    parser.add_argument("--dry-run", action="store_true", help="Preview candidate gaps without scraping or writing")
    parser.add_argument("--no-remote-sync", action="store_true", help="Skip R2 and Supabase sync (local SQLite only)")
    parser.add_argument("--check-external", action="store_true", help="Cross-reference TMDB/AniList expected episode_count")
    parser.add_argument("--wdt-slow", action="store_true", help="Optional slow throttle for webdramaturkey2 (aborts on first Turnstile)")
    args = parser.parse_args()

    run_recovery(
        limit=args.limit,
        category=args.category,
        only_empty=args.only_empty,
        drama_id=args.drama_id,
        sync_remote=not args.no_remote_sync,
        dry_run=args.dry_run,
        db_path=args.db,
        check_external=args.check_external,
        wdt_slow=args.wdt_slow,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
