#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/audit_and_heal_catalog.py

Comprehensive SQLite (+ optional Supabase/R2) catalog remediation engine:
1. Misclassified `kisa_drama` restorer:
   - Detects non-shortdrama series falsely flipped to `kisa_drama` (ddizi, webdramaturkey2,
     hdfilmcehennemi, dizikorea, asyawatch, dizifon, dizipal, etc.) using source_url,
     alt_sites, MDL/TMDB metadata & episode runtime checks.
   - Restores `content_type` to 'dizi' (or 'film' when confirmed movie) and strips
     spurious 'Kısa Drama' category tag.
2. Bogus slug-derived episode number cleaner:
   - Detects episodes where URL `SxE` (`-1x1`) contradicts slug-derived `episode_number`
     (e.g. #54171 ep 2008, #54105 ep 1923, #19308 ep 1899, #54098 ep 548, #53959 ep 500)
     or single high year-outlier `episode_number > 100` where `actual_eps <= 50` and
     `episode_count <= 50`.
   - Safely migrates unique sources to the real episode (or renumbers to real SxE) and
     deletes duplicate bogus episode rows.
3. `pending://gap` placeholder cleaner:
   - Deletes all `pending://gap/%` rows with 0 real `episode_sources`.
   - Reconciles any `pending://gap/%` row that already gained real sources to `source_status='active'`.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

NON_SHORT_SOURCE_HOSTS = (
    "ddizi",
    "webdramaturkey",
    "hdfilmcehennemi",
    "dizikorea",
    "asyawatch",
    "dizifon",
    "asyadizi",
    "asyaluna",
    "asyaking",
    "bldrama",
    "diziyou",
    "dizibox",
    "dizilla",
    "diziizle",
    "dizipal",
    "sezonlukdizi",
    "fullhdfilmizlesene",
    "tranimeizle",
    "animelvl",
    "animecix",
    "asyaanimeleri",
)

SHORT_SOURCE_HOSTS = ("shortizle", "dramavadisi", "dramabox")


def _progress(label: str, current: int, total: int, status: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    pct = (current / total * 100.0) if total > 0 else 100.0
    print(f"[{ts}] [{current}/{total}] ({pct:.1f}%) - {label}: {status}", flush=True)


def _load_env_map() -> dict[str, str]:
    env: dict[str, str] = {}
    for cand in (
        os.path.join(_ROOT, "koup-app", ".env.local"),
        os.path.join(os.path.dirname(_ROOT), "koup-app", ".env.local"),
    ):
        if os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            env[k.strip()] = v.strip().strip('"').strip("'")
                break
            except Exception:
                pass
    return env


def _resolve_db_path(cli_db: str | None) -> str:
    if cli_db:
        return cli_db
    env = _load_env_map()
    return os.environ.get("ARCHIVE_DB_PATH") or env.get("ARCHIVE_DB_PATH") or os.path.join(_ROOT, "webdrama_archive.db")


def _parse_alt_sites(raw_alt: str | None) -> list[str]:
    if not raw_alt:
        return []
    try:
        val = json.loads(raw_alt)
        if isinstance(val, list):
            return [str(x).strip().lower() for x in val if x]
    except Exception:
        pass
    return [x.strip().lower() for x in str(raw_alt).split(",") if x.strip()]


def _fetch_tmdb_details(tmdb_id: int, tmdb_key: str) -> tuple[str | None, int | None]:
    """Returns (media_kind 'tv'|'movie'|None, runtime_minutes|None) from TMDB."""
    if not tmdb_id or not tmdb_key:
        return None, None
    for kind in ("tv", "movie"):
        url = f"https://api.themoviedb.org/3/{kind}/{tmdb_id}?api_key={tmdb_key}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "KoUp/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if kind == "tv":
                        rts = data.get("episode_run_time") or []
                        rt = max(rts) if rts else (data.get("last_episode_to_air") or {}).get("runtime")
                        return "tv", int(rt) if rt else None
                    rt = data.get("runtime")
                    return "movie", int(rt) if rt else None
        except Exception:
            continue
    return None, None


def detect_misclassified_kisa_drama(cur: sqlite3.Cursor, tmdb_key: str = "", probe_tmdb: bool = False) -> list[dict]:
    rows = cur.execute(
        """
        SELECT d.id, d.title, d.slug, d.source_url, d.alt_sites, d.episode_count,
               d.tmdb_id, d.mydramalist_url, d.categories, d.country,
               (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) AS actual_eps
        FROM dramas d
        WHERE d.content_type = 'kisa_drama'
        ORDER BY d.id ASC
        """
    ).fetchall()

    findings: list[dict] = []
    total = len(rows)
    for idx, r in enumerate(rows, 1):
        did, title, slug, surl, raw_alt, epc, tid, mdl, cats, ctry, actual_eps = r
        u = (surl or "").lower()
        host = urlparse(u).netloc.lower() if "://" in u else ""
        alts = _parse_alt_sites(raw_alt)

        is_short_src = any(sh in u for sh in SHORT_SOURCE_HOSTS)
        has_non_short_src = any(ns in host or ns in u for ns in NON_SHORT_SOURCE_HOSTS)
        non_short_alts = [a for a in alts if any(ns in a for ns in NON_SHORT_SOURCE_HOSTS)]

        reason = None
        target_type = "dizi"

        if has_non_short_src:
            reason = f"non_short_source_url:{host}"
        elif "koredizi" in u and (non_short_alts or mdl):
            reason = f"koredizi_with_regular_signals(mdl={bool(mdl)},alts={non_short_alts})"
        elif not is_short_src and (non_short_alts or mdl):
            reason = f"non_short_host_with_regular_signals(alts={non_short_alts})"
        elif probe_tmdb and tid and non_short_alts and tmdb_key:
            kind, rt = _fetch_tmdb_details(int(tid), tmdb_key)
            if kind == "movie" or (rt and rt >= 20):
                reason = f"tmdb_confirmed_regular({kind},rt={rt}m)"
                if kind == "movie" and actual_eps <= 1:
                    target_type = "film"

        if reason:
            if "hdfilmcehennemi" in u and actual_eps <= 1 and tid and probe_tmdb and tmdb_key:
                kind, _ = _fetch_tmdb_details(int(tid), tmdb_key)
                if kind == "movie":
                    target_type = "film"
            findings.append(
                {
                    "id": did,
                    "title": title,
                    "slug": slug,
                    "source_url": surl,
                    "target_type": target_type,
                    "categories": cats,
                    "reason": reason,
                }
            )
        if idx % 2000 == 0 or idx == total:
            _progress("kisa_drama taraması", idx, total, f"{len(findings)} hatalı kayıt bulundu")

    return findings


def detect_bogus_episodes(cur: sqlite3.Cursor) -> list[dict]:
    """
    Identifies bogus slug-derived episode numbers:
    1) episode_url carries explicit -SxE(-cN) that disagrees with episode_number
       (e.g. 1899 -> 1899-1x1, 1923 -> 1923-1x1-c10, 2008 -> 2008-milli-takim-hikayesi-1x1)
    2) Single high outlier episode_number >= 1800 where actual_eps <= 50 and episode_count <= 50
       and the number matches digits in drama title/slug.
    """
    rows = cur.execute(
        """
        SELECT e.id, e.drama_id, d.title, d.slug, d.content_type, d.episode_count,
               e.season_number, e.episode_number, e.episode_url,
               (SELECT COUNT(*) FROM episodes e2 WHERE e2.drama_id = d.id) AS actual_eps,
               (SELECT COUNT(*) FROM episode_sources es WHERE es.episode_id = e.id) AS src_cnt
        FROM episodes e
        JOIN dramas d ON d.id = e.drama_id
        WHERE e.episode_number > 50
        ORDER BY e.id ASC
        """
    ).fetchall()

    findings: list[dict] = []
    seen_eids: set[int] = set()
    sxe_re = re.compile(r"-(\d+)x(\d+)(?:-c\d+)?/?$", re.I)

    for r in rows:
        eid, did, title, slug, ctype, epc, snum, enum, eurl, actual_eps, src_cnt = r
        m = sxe_re.search(eurl or "")
        if m:
            url_s, url_e = int(m.group(1)), int(m.group(2))
            if url_e != enum and 1 <= url_e <= 1000:
                existing = cur.execute(
                    "SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                    (did, url_s, url_e),
                ).fetchone()
                findings.append(
                    {
                        "episode_id": eid,
                        "drama_id": did,
                        "title": title,
                        "old_season": snum,
                        "old_episode": enum,
                        "target_season": url_s,
                        "target_episode": url_e,
                        "merge_into_id": existing[0] if existing and existing[0] != eid else None,
                        "src_cnt": src_cnt,
                        "reason": f"url_sxe_mismatch:{url_s}x{url_e}_vs_{enum}",
                    }
                )
                seen_eids.add(eid)
                continue

        epc_int = int(epc) if (epc and str(epc).isdigit()) else 0
        if eid not in seen_eids and enum >= 1800 and actual_eps <= 50 and epc_int <= 50:
            if str(enum) in (title or "") or str(enum) in (slug or ""):
                existing = cur.execute(
                    "SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = 1",
                    (did, snum or 1),
                ).fetchone()
                findings.append(
                    {
                        "episode_id": eid,
                        "drama_id": did,
                        "title": title,
                        "old_season": snum,
                        "old_episode": enum,
                        "target_season": snum or 1,
                        "target_episode": 1,
                        "merge_into_id": existing[0] if existing and existing[0] != eid else None,
                        "src_cnt": src_cnt,
                        "reason": f"year_in_title_outlier:{enum}",
                    }
                )
                seen_eids.add(eid)

    return findings


def detect_pending_gaps(cur: sqlite3.Cursor) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    zero_src = cur.execute(
        """
        SELECT e.id, e.drama_id
        FROM episodes e
        WHERE e.episode_url LIKE 'pending://gap/%'
          AND NOT EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
        """
    ).fetchall()
    with_src_pending = cur.execute(
        """
        SELECT e.id, e.drama_id
        FROM episodes e
        WHERE e.episode_url LIKE 'pending://gap/%'
          AND (e.source_status IS NULL OR e.source_status = 'pending')
          AND EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
        """
    ).fetchall()
    return zero_src, with_src_pending


def _strip_kisa_category(raw_cats: str | None) -> str | None:
    if not raw_cats:
        return raw_cats
    try:
        arr = json.loads(raw_cats)
        if isinstance(arr, list):
            cleaned = [c for c in arr if str(c).strip().lower() not in ("kısa drama", "kisa drama")]
            return json.dumps(cleaned, ensure_ascii=False)
    except Exception:
        pass
    return raw_cats


def apply_repairs(
    conn: sqlite3.Connection,
    cur: sqlite3.Cursor,
    mis_kisa: list[dict],
    bogus_eps: list[dict],
    zero_pending: list[tuple[int, int]],
    reconcile_pending: list[tuple[int, int]],
    sync_remote: bool = False,
) -> dict:
    affected_dramas: set[int] = set()
    stats = {
        "kisa_restored": 0,
        "bogus_merged": 0,
        "bogus_renumbered": 0,
        "bogus_deleted": 0,
        "pending_gap_deleted": 0,
        "pending_gap_reconciled": 0,
        "remote_synced": 0,
    }

    # 1. Restore misclassified kisa_drama
    for item in mis_kisa:
        new_cats = _strip_kisa_category(item["categories"])
        cur.execute(
            "UPDATE dramas SET content_type = ?, categories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (item["target_type"], new_cats, item["id"]),
        )
        affected_dramas.add(item["id"])
        stats["kisa_restored"] += 1

    # 2. Clean/renumber bogus slug-derived episodes
    for item in bogus_eps:
        eid = item["episode_id"]
        did = item["drama_id"]
        target_id = item["merge_into_id"]
        affected_dramas.add(did)

        if target_id:
            srcs = cur.execute(
                "SELECT source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site FROM episode_sources WHERE episode_id = ?",
                (eid,),
            ).fetchall()
            for sname, emb_id, aurl, durl, prov, fansub, site in srcs:
                exists = cur.execute(
                    "SELECT id FROM episode_sources WHERE episode_id = ? AND (embed_id = ? OR (direct_url IS NOT NULL AND direct_url = ?))",
                    (target_id, emb_id or "__none__", durl or "__none__"),
                ).fetchone()
                if not exists:
                    cur.execute(
                        """
                        INSERT INTO episode_sources (episode_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                        """,
                        (target_id, sname, emb_id, aurl, durl, prov, fansub, site),
                    )
            cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (eid,))
            cur.execute("DELETE FROM episodes WHERE id = ?", (eid,))
            stats["bogus_merged"] += 1
        elif item["src_cnt"] > 0:
            cur.execute(
                """
                UPDATE episodes
                SET season_number = ?, episode_number = ?, episode_name = ?
                WHERE id = ?
                """,
                (item["target_season"], item["target_episode"], f"{item['target_episode']}. Bölüm", eid),
            )
            stats["bogus_renumbered"] += 1
        else:
            cur.execute("DELETE FROM episodes WHERE id = ?", (eid,))
            stats["bogus_deleted"] += 1

    # 3. Remove 0-source pending://gap rows & reconcile source-bearing ones
    if zero_pending:
        ids = [r[0] for r in zero_pending]
        for r in zero_pending:
            affected_dramas.add(r[1])
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            ph = ",".join("?" * len(chunk))
            cur.execute(f"DELETE FROM episodes WHERE id IN ({ph})", chunk)
        stats["pending_gap_deleted"] = len(ids)

    if reconcile_pending:
        ids = [r[0] for r in reconcile_pending]
        for r in reconcile_pending:
            affected_dramas.add(r[1])
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            ph = ",".join("?" * len(chunk))
            cur.execute(
                f"UPDATE episodes SET source_status = 'active', pending_since = NULL WHERE id IN ({ph})",
                chunk,
            )
        stats["pending_gap_reconciled"] = len(ids)

    # 4. Refresh SQLite counts
    for did in affected_dramas:
        cur.execute(
            """
            UPDATE dramas
            SET episodes_available = (
                    SELECT COUNT(*) FROM episodes e
                    WHERE e.drama_id = ?
                      AND EXISTS (SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)
                ),
                sources_count = (
                    SELECT COUNT(*) FROM episode_sources es
                    JOIN episodes e ON e.id = es.episode_id
                    WHERE e.drama_id = ?
                ),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (did, did, did),
        )
    conn.commit()

    if sync_remote and affected_dramas:
        from scrapers.supabase_sync_helper import sb_request, sync_drama_bundle_and_counts

        for item in mis_kisa:
            sb_request(
                "PATCH",
                f"/rest/v1/media?id=eq.{item['id']}",
                body={"content_type": item["target_type"]},
            )
        total = len(affected_dramas)
        for idx, did in enumerate(sorted(affected_dramas), 1):
            try:
                sync_drama_bundle_and_counts(conn, cur, did)
                stats["remote_synced"] += 1
            except Exception as e:
                print(f"[SYNC_ERROR] drama #{did}: {e}", flush=True)
            if idx % 25 == 0 or idx == total:
                _progress("Supabase/R2 senkronizasyonu", idx, total, f"#{did}")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="KoUp Misclassified kisa_drama & Bogus Episode Cleaner")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB (default: webdrama_archive.db)")
    parser.add_argument("--apply", action="store_true", help="Apply repairs to SQLite (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Preview issues without writing")
    parser.add_argument("--sync-remote", action="store_true", help="Also sync repaired dramas to Supabase & R2 (requires --apply)")
    parser.add_argument("--probe-tmdb", action="store_true", help="Verify borderline kisa_drama entries against TMDB API")
    args = parser.parse_args()

    is_apply = bool(args.apply and not args.dry_run)
    db_path = _resolve_db_path(args.db)
    if not os.path.exists(db_path):
        print(f"[ERROR] SQLite DB bulunamadı: {db_path}", flush=True)
        sys.exit(1)

    env = _load_env_map()
    tmdb_key = os.environ.get("TMDB_API_KEY") or env.get("TMDB_API_KEY") or ""

    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.execute("PRAGMA busy_timeout = 60000;")
    cur = conn.cursor()

    print(f"=== KoUp Catalog Cleaner ({'APPLY' if is_apply else 'DRY-RUN'}) | DB: {db_path} ===", flush=True)

    mis_kisa = detect_misclassified_kisa_drama(cur, tmdb_key=tmdb_key, probe_tmdb=args.probe_tmdb)
    bogus_eps = detect_bogus_episodes(cur)
    zero_pending, reconcile_pending = detect_pending_gaps(cur)

    print(f"\n[BULGULAR]", flush=True)
    print(f"  - Hatalı 'kisa_drama' kayıtları          : {len(mis_kisa)}", flush=True)
    for item in mis_kisa[:20]:
        print(f"      #{item['id']} '{item['title']}' -> '{item['target_type']}' ({item['reason']})", flush=True)

    print(f"  - Sahte slug-türevli bölüm numaraları    : {len(bogus_eps)}", flush=True)
    for item in bogus_eps[:20]:
        action = f"merge->{item['merge_into_id']}" if item["merge_into_id"] else f"renumber->{item['target_season']}x{item['target_episode']}"
        print(f"      ep #{item['episode_id']} (drama #{item['drama_id']} '{item['title']}'): {item['old_season']}x{item['old_episode']} -> {action} ({item['reason']})", flush=True)

    print(f"  - 0-kaynaklı pending://gap satırları     : {len(zero_pending)}", flush=True)
    print(f"  - Kaynaklı ama pending kalan gap satırı  : {len(reconcile_pending)}", flush=True)

    if is_apply:
        stats = apply_repairs(
            conn,
            cur,
            mis_kisa,
            bogus_eps,
            zero_pending,
            reconcile_pending,
            sync_remote=args.sync_remote,
        )
        print(f"\n[SONUÇ] Uygulanan onarımlar: {json.dumps(stats, ensure_ascii=False)}", flush=True)
    else:
        stats = {
            "kisa_candidates": len(mis_kisa),
            "bogus_ep_candidates": len(bogus_eps),
            "pending_gap_zero_src": len(zero_pending),
            "pending_gap_reconcile": len(reconcile_pending),
        }
        print("\n[DRY-RUN] Veritabanında değişiklik yapılmadı. Uygulamak için --apply kullanın.", flush=True)

    conn.close()
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': not is_apply, **stats}, ensure_ascii=False)}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
