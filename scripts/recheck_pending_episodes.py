#!/usr/bin/env python3
"""
Pending Episodes Rechecker & Source Resolver for KoUp.

Scans episodes tagged as 'pending' (episodes that exist on a site but didn't have
playable sources yet), re-fetches their sources using existing scraper extractors,
inserts newly appeared sources, clears the pending tag, updates R2 bundles and Supabase,
and performs checkpoints and R2 database backups.

CLI Flags:
  --limit INT         Maximum pending episodes to re-check (default: 50)
  --drama-id INT      Re-check only episodes of a specific drama
  --dry-run           Preview check without writing changes to DB, R2, or Supabase
  --max-attempts INT  Skip episodes that have reached max re-check attempts (default: 60)
  --force             Bypass time backoff and check immediately
"""

import sys
import os
import re
import json
import time
import argparse
from datetime import datetime
import sqlite3

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection, DB_PATH
from scrapers.multisite import add_source, safe_commit
from scrapers.pending_sources import (
    ensure_pending_columns,
    page_is_placeholder,
    reconcile_episode,
    list_pending,
)
from scrapers.supabase_sync_helper import (
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)
from scrapers.sync_hdfilm_target import resolve_hdfilm_streams
from scrapers.sync_target_drama import fetch_html


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)


def extract_sources_for_episode(ep_url: str) -> tuple:
    """
    Reuses existing site-specific extraction logic across all scrapers.
    Returns (sources_list, is_placeholder) where each source is
    (source_name, direct_url, provider, site, fansub).
    """
    if not ep_url or not ep_url.startswith("http"):
        return [], False

    url_low = ep_url.lower()

    # 1. DiziBOX
    if "dizibox.live" in url_low or "/diziler/" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://www.dizibox.live/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            m_sheila = re.search(r"sheila/([a-zA-Z0-9_-]+)", ep_html)
            m_molystream = re.search(r"https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+", ep_html)
            m_king = re.search(r'src=["\'](https://www\.dizibox\.live/player/king/king\.php\?v=[^"\']+)["\']', ep_html)
            if not m_king:
                m_king = re.search(r"king\.php\?post_id=(\d+)", ep_html)

            v_url = None
            if m_sheila:
                v_url = f"https://dbx.molystream.org/embed/sheila/{m_sheila.group(1)}"
            elif m_molystream:
                v_url = m_molystream.group(0)
            elif m_king:
                king_u = (
                    m_king.group(1)
                    if m_king.group(1).startswith("http")
                    else f"https://www.dizibox.live/king.php?post_id={m_king.group(1)}"
                )
                try:
                    king_html = fetch_html(king_u, referer=ep_url, timeout=10)
                    m_moly = re.search(r'src=["\'](https://dbx\.molystream\.org/embed/[^"\']+)["\']', king_html or "")
                    if m_moly:
                        m_id = re.search(r"/embed/([a-zA-Z0-9-]+)", m_moly.group(1))
                        if m_id:
                            v_url = f"https://dbx.molystream.org/embed/sheila/{m_id.group(1)}"
                except Exception:
                    pass

            if v_url:
                return [("DBX Pro 1080p", v_url, "dbx", "dizibox", None)], False
            return [], is_ph
        except Exception:
            return [], False

    # 2. HDFilmcehennemi
    if "hdfilmcehennemi" in url_low:
        try:
            ep_html = fetch_html(ep_url, timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            streams = resolve_hdfilm_streams(ep_url, ep_html)
            out = []
            for sname, surl, sprov, ssite in streams:
                out.append((sname, surl, sprov, ssite, None))
            return out, is_ph
        except Exception:
            return [], False

    # 3. DiziKorea
    if "dizikorea" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://dizikorea3.com/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            # Match both src and data-src (lazy-load) or anywhere in html
            dk_matches = re.findall(r"https?://(?:www\.)?playerdkorea\.xyz/video/[a-zA-Z0-9]+", ep_html)
            vm_matches = re.findall(r"https?://(?:www\.)?vidmoly\.[a-z]+/embed-[a-zA-Z0-9]+(?:\.html)?", ep_html)

            out = []
            for u in set(dk_matches):
                out.append(("DiziKorea 1080p HLS", u, "dizikorea", "dizikorea", None))
            for u in set(vm_matches):
                out.append(("Vidmoly", u, "vidmoly", "dizikorea", None))
            return out, is_ph
        except Exception:
            return [], False

    # 4. DDizi
    if "ddizi" in url_low:
        try:
            ep_html = fetch_html(ep_url, referer="https://www.ddizi.tel/", timeout=12)
            if not ep_html:
                return [], False
            is_ph = page_is_placeholder(ep_html)
            out = []

            # 1. YouTube embed
            yt_match = re.search(
                r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']',
                ep_html,
            )
            if yt_match:
                v_id_m = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)", yt_match.group(1))
                if v_id_m:
                    out.append(("YouTube HD", f"https://www.youtube.com/embed/{v_id_m.group(1)}?autoplay=1&enablejsapi=1", "youtube", "ddizi", None))
                    return out, False

            # 2. DDizi Native JWPlayer
            player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
            if not player_paths:
                player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)

            if player_paths:
                p_path = player_paths[0]
                p_url = p_path if p_path.startswith("http") else f"https://www.ddizi.tel{p_path}"
                p_html = fetch_html(p_url, referer=ep_url, timeout=10)
                if p_html:
                    yt_thumb = re.search(r"https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/", p_html)
                    if yt_thumb:
                        out.append(("YouTube HD", f"https://www.youtube.com/embed/{yt_thumb.group(1)}?autoplay=1&enablejsapi=1", "youtube", "ddizi", None))
                        return out, False

                    m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
                    for raw_m in m3u8_matches:
                        clean_m = raw_m.replace(r"\/", "/")
                        if clean_m.startswith("http"):
                            out.append(("DDizi HLS", clean_m, "ddizi", "ddizi", None))
                            return out, False

                    raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
                    for raw_f in raw_files:
                        clean_u = raw_f.replace(r"\/", "/")
                        if clean_u.startswith("http") and "videoplayback" not in clean_u and ".mp4" in clean_u:
                            out.append(("DDizi HD", clean_u, "ddizi", "ddizi", None))
                            return out, False

            return out, is_ph
        except Exception:
            return [], False

    # 5. Generic / fallback extractor
    try:
        ep_html = fetch_html(ep_url, timeout=10)
        if not ep_html:
            return [], False
        is_ph = page_is_placeholder(ep_html)
        out = []

        # Check for vidmoly / playerdkorea / youtube / molystream / direct m3u8
        vm = re.findall(r"https?://(?:www\.)?vidmoly\.[a-z]+/embed-[a-zA-Z0-9]+(?:\.html)?", ep_html)
        for u in set(vm):
            out.append(("Vidmoly", u, "vidmoly", "other", None))

        dk = re.findall(r"https?://(?:www\.)?playerdkorea\.xyz/video/[a-zA-Z0-9]+", ep_html)
        for u in set(dk):
            out.append(("DiziKorea 1080p HLS", u, "dizikorea", "other", None))

        moly = re.findall(r"https?://(?:dbx\.)?molystream\.org/embed/[a-zA-Z0-9_/=-]+", ep_html)
        for u in set(moly):
            out.append(("MolyStream HLS", u, "dbx", "other", None))

        return out, is_ph
    except Exception:
        return [], False


def recheck_pending(
    conn=None,
    cur=None,
    limit: int = 50,
    dry_run: bool = False,
    max_attempts: int = 60,
    drama_id: int = None,
    force: bool = False,
) -> dict:
    """
    Main pending re-checker logic. Can be invoked directly from CLI or live_scanner.py.
    """
    close_conn = False
    if conn is None:
        conn = get_connection()
        close_conn = True
    if cur is None:
        cur = conn.cursor()

    ensure_pending_columns(conn)

    episodes = list_pending(
        conn,
        limit=limit,
        drama_id=drama_id,
        max_attempts=max_attempts,
        apply_backoff=not force,
    )

    cur.execute(
        "SELECT COUNT(*) FROM episodes WHERE source_status = 'pending' AND COALESCE(source_check_attempts, 0) >= ?",
        (max_attempts,),
    )
    skipped_max = cur.fetchone()[0]

    log("BAŞLATILDI", f"Yeniden kontrol başlatıldı: {len(episodes)} bekleyen bölüm taranacak (Max deneme: {max_attempts}, Atlanan: {skipped_max}).")

    checked_count = 0
    resolved_count = 0
    still_pending_count = 0
    touched_dramas = set()

    for ep in episodes:
        checked_count += 1
        ep_id = ep["id"]
        d_id = ep["drama_id"]
        d_title = ep.get("drama_title") or f"Yapım #{d_id}"
        s_num = ep.get("season_number") or 1
        e_num = ep.get("episode_number") or 1
        ep_url = ep.get("episode_url")
        attempts = ep.get("source_check_attempts") or 0

        if not ep_url:
            still_pending_count += 1
            if not dry_run:
                reconcile_episode(cur, ep_id, is_placeholder=True, increment_attempt=True)
                safe_commit(conn)
            continue

        sources, is_ph = extract_sources_for_episode(ep_url)

        if sources:
            resolved_count += 1
            touched_dramas.add(d_id)
            log("ÇÖZÜLDÜ", f'"{d_title}" S{s_num}B{e_num} ({ep_url[:50]}...): +{len(sources)} yeni kaynak bulundu!')
            if not dry_run:
                for sname, surl, sprov, ssite, sfansub in sources:
                    add_source(cur, ep_id, sname, surl, sprov, ssite, fansub=sfansub)
                reconcile_episode(cur, ep_id, is_placeholder=False, increment_attempt=True)
                safe_commit(conn)
        else:
            still_pending_count += 1
            reason = "yer tutucu algılandı (yakında/hazırlanıyor)" if is_ph else "henüz oynatılabilir kaynak yok"
            log("BEKLEMEDE", f'"{d_title}" S{s_num}B{e_num} (Deneme {attempts + 1}/{max_attempts}): {reason}.')
            if not dry_run:
                reconcile_episode(cur, ep_id, is_placeholder=is_ph, increment_attempt=True)
                safe_commit(conn)

    # If any sources were added, update bundle and Supabase for affected dramas
    if touched_dramas and not dry_run:
        log("SENKRONİZASYON", f"{len(touched_dramas)} yapımın R2 ve Supabase bundle güncellemesi yapılıyor...")
        for did in touched_dramas:
            sync_drama_bundle_and_counts(conn, cur, did)

        # Checkpoint SQLite WAL and trigger R2 database backup once
        try:
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            backup_db_to_r2()
            log("YEDEKLEME", "webdrama_archive.db R2 yedeği başarıyla tamamlandı.")
        except Exception as e:
            log("UYARI", f"R2 DB yedek uyarısı: {e}")

    summary = {
        "checked": checked_count,
        "resolved": resolved_count,
        "pending": still_pending_count,
        "skipped": skipped_max,
        "touched_dramas": len(touched_dramas),
        "dry_run": dry_run,
    }

    log(
        "ÖZET",
        f"Kontrol edilen: {checked_count} | Çözülen (Kaynak Eklenen): {resolved_count} | Halen Beklemede: {still_pending_count} | Atlanan (>max): {skipped_max}",
    )

    if close_conn:
        conn.close()

    return summary


def main():
    parser = argparse.ArgumentParser(description="KoUp Pending Episodes Rechecker")
    parser.add_argument("--limit", type=int, default=50, help="Maximum pending episodes to check (default: 50)")
    parser.add_argument("--drama-id", type=int, default=None, help="Re-check only a specific drama ID")
    parser.add_argument("--dry-run", action="store_true", help="Dry run without writing to DB or syncing to R2/Supabase")
    parser.add_argument("--max-attempts", type=int, default=60, help="Skip episodes exceeding max attempts (default: 60)")
    parser.add_argument("--force", action="store_true", help="Bypass backoff time intervals")
    args = parser.parse_args()

    recheck_pending(
        limit=args.limit,
        dry_run=args.dry_run,
        max_attempts=args.max_attempts,
        drama_id=args.drama_id,
        force=args.force,
    )


if __name__ == "__main__":
    main()
