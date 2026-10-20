#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/purge_dead_voe_sources.py

Scans all VOE (voe.sx) sources in the KoUp webdrama archive, accurately detects
404/deleted videos through DDoS-Guard-resilient probing and mirror fallback, and purges them from:
1. SQLite (episode_sources, recalculates counts & sets pending tags if 0 sources)
2. Cloudflare R2 bundles (sources/{drama_id}.json)
3. Supabase (public.episodes.video_sources & public.media.sources_count)
"""

import sys
import os
import time
import json
import sqlite3
import argparse
import threading
import re
from concurrent.futures import ThreadPoolExecutor

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.multisite import clean_episode_title
from scrapers.supabase_sync_helper import upload_to_r2, sb_request, backup_db_to_r2

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

VOE_CODE_RE = re.compile(r'(?:voe\.sx|derricknationtop\.com|roberttrailerflash\.com)/(?:e/)?([a-zA-Z0-9_-]+)')

_thread_local = threading.local()

def _get_thread_session():
    if not hasattr(_thread_local, 'session'):
        import requests
        s = requests.Session()
        s.headers.update(HEADERS)
        _thread_local.session = s
    return _thread_local.session

def extract_voe_code(url: str) -> str | None:
    m = VOE_CODE_RE.search(url)
    if m:
        return m.group(1)
    return None

def check_voe_url(url: str) -> tuple[int, bool]:
    """
    Returns (status_code, is_dead).
    is_dead is True ONLY when HTTP status is 404 or 410 or explicit 'Not Found' in body.
    Temporary 503 (DDoS-Guard) or network timeouts trigger fallback to derricknationtop.com mirror.
    If still 503 or error, returns is_dead=False to prevent accidental purge.
    """
    session = _get_thread_session()
    code = extract_voe_code(url)

    # 1. Primary probe on voe.sx
    primary_code = 0
    try:
        r = session.head(url, allow_redirects=True, timeout=5)
        primary_code = r.status_code
        if primary_code in (404, 410):
            return (primary_code, True)
        if primary_code in (200, 302):
            return (primary_code, False)
    except Exception:
        pass

    # 2. If voe.sx returned 503, 429, timeout, or primary probe failed, try mirror domain
    if code:
        mirror_url = f"https://derricknationtop.com/e/{code}"
        try:
            mr = session.head(mirror_url, allow_redirects=True, timeout=5)
            if mr.status_code in (404, 410):
                return (mr.status_code, True)
            if mr.status_code in (200, 302):
                return (mr.status_code, False)
        except Exception:
            pass

    # 3. If HEAD failed or gave 503, try 1 lightweight streamed GET on voe.sx or mirror
    test_urls = [url]
    if code:
        test_urls.append(f"https://derricknationtop.com/e/{code}")

    for tu in test_urls:
        try:
            gr = session.get(tu, timeout=6, stream=True)
            if gr.status_code in (404, 410):
                return (gr.status_code, True)
            chunk = next(gr.iter_content(512), b'').decode('utf-8', errors='ignore')
            if '404 - Not found' in chunk or '<title>404' in chunk:
                return (404, True)
            if gr.status_code in (200, 302):
                return (gr.status_code, False)
        except Exception:
            continue

    return (primary_code or 503, False)

_thread_db = threading.local()

def _get_thread_db():
    if not hasattr(_thread_db, 'conn'):
        db_path = os.path.join(_ROOT, "webdrama_archive.db")
        _thread_db.conn = sqlite3.connect(db_path, timeout=60.0)
    return _thread_db.conn

def sync_single_drama_bundle(drama_id: int) -> bool:
    """
    Thread-safe generator for R2 bundle and Supabase sync.
    Reads clean SQLite data, builds r2_bundles/sources/{id}.json, uploads to R2,
    and updates Supabase media & episodes.
    """
    try:
        conn = _get_thread_db()
        cur = conn.cursor()

        cur.execute("SELECT id, title, slug, content_type FROM dramas WHERE id = ?", (drama_id,))
        d_row = cur.fetchone()
        if not d_row:
            return False

        cur.execute(
            """
            SELECT id, season_number, episode_number, episode_name, episode_type, source_status
            FROM episodes
            WHERE drama_id = ?
            ORDER BY COALESCE(season_number, 1) ASC, episode_number ASC
            """,
            (drama_id,),
        )
        eps = cur.fetchall()
        ep_out = []
        for ep in eps:
            ep_id, s_num, e_num, ep_name, ep_type, src_status = ep
            cur.execute(
                """
                SELECT id, source_name, provider, direct_url, embed_id, fansub, site
                FROM episode_sources
                WHERE episode_id = ? AND direct_url IS NOT NULL AND direct_url != ''
                ORDER BY id ASC
                """,
                (ep_id,),
            )
            srcs = []
            seen = set()
            for sr in cur.fetchall():
                sid, sname, prov, durl, eid, fsub, site = sr
                key = f"{prov}::{durl}"
                if key in seen:
                    continue
                seen.add(key)
                srcs.append({
                    "id": sid,
                    "source_name": sname or prov or "Kaynak",
                    "provider": prov or "other",
                    "direct_url": durl,
                    "embed_id": eid or "",
                    "site": site or "",
                    "fansub": fsub or None,
                    "quality_label": "1080p",
                })
            is_pending = (src_status == "pending")
            if srcs or is_pending:
                clean_name = clean_episode_title(ep_name, s_num or 1, e_num)
                ep_obj = {
                    "id": ep_id,
                    "season_number": s_num or 1,
                    "episode_number": e_num,
                    "episode_name": clean_name,
                    "episode_type": ep_type or "normal",
                    "sources": srcs,
                }
                if is_pending:
                    ep_obj["pending"] = True
                ep_out.append(ep_obj)

        if ep_out:
            bundle_dir = os.path.join(_ROOT, "r2_bundles", "sources")
            os.makedirs(bundle_dir, exist_ok=True)
            bundle_path = os.path.join(bundle_dir, f"{drama_id}.json")
            payload = {
                "media_id": drama_id,
                "title": d_row[1],
                "slug": d_row[2],
                "content_type": d_row[3] or "dizi",
                "episodes": ep_out,
            }
            with open(bundle_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)

            # 1. Upload bundle to Cloudflare R2 bucket
            upload_to_r2(bundle_path, f"sources/{drama_id}.json")

            # 2. Update Supabase media episode_count
            sb_request(
                "PATCH",
                f"/rest/v1/media?id=eq.{drama_id}",
                body={"episode_count": len(ep_out)},
                prefer="return=minimal",
            )

            # 3. Upsert episodes into Supabase public.episodes
            sb_episodes_map = {}
            for ep in ep_out:
                s_num = ep.get("season_number") or 1
                e_num = ep.get("episode_number")
                key = (s_num, e_num)
                is_pend = bool(ep.get("pending"))
                candidate = {
                    "media_id": drama_id,
                    "season_number": s_num,
                    "episode_number": e_num,
                    "episode_name": ep.get("episode_name") or f"Bölüm {e_num}",
                    "episode_type": ep.get("episode_type") or "normal",
                    "status": "pending_source" if is_pend else "published",
                    "video_sources": ep.get("sources") or [],
                }
                if key not in sb_episodes_map or (len(candidate["video_sources"]) > len(sb_episodes_map[key]["video_sources"])):
                    sb_episodes_map[key] = candidate

            sb_episodes = list(sb_episodes_map.values())
            if sb_episodes:
                for i in range(0, len(sb_episodes), 50):
                    chunk = sb_episodes[i : i + 50]
                    res = sb_request(
                        "POST",
                        "/rest/v1/episodes?on_conflict=media_id,season_number,episode_number",
                        body=chunk,
                        prefer="resolution=merge-duplicates,return=minimal",
                    )
                    if isinstance(res, dict) and res.get("_error"):
                        fallback_chunk = []
                        for ep_item in chunk:
                            item_copy = dict(ep_item)
                            if item_copy.get("status") == "pending_source":
                                item_copy["status"] = "published"
                            fallback_chunk.append(item_copy)
                        sb_request(
                            "POST",
                            "/rest/v1/episodes?on_conflict=media_id,season_number,episode_number",
                            body=fallback_chunk,
                            prefer="resolution=merge-duplicates,return=minimal",
                        )
        return True
    except Exception as e:
        print(f"  [SYNC_ERROR] Dizi ID {drama_id}: {e}", flush=True)
        return False

def main():
    parser = argparse.ArgumentParser(description="Purge dead 404 VOE sources across the archive.")
    parser.add_argument("--dry-run", action="store_true", help="Scan and report without modifying database or R2.")
    parser.add_argument("--limit", type=int, default=0, help="Scan only first N sources.")
    parser.add_argument("--workers", type=int, default=3, help="Number of concurrent worker threads (default 3).")
    parser.add_argument("--sync-workers", type=int, default=8, help="Number of concurrent sync worker threads (default 8).")
    parser.add_argument("--drama-id", type=int, default=0, help="Scan only sources for specific drama ID.")
    args = parser.parse_args()

    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    sql = """
        SELECT s.id, s.episode_id, e.drama_id, s.direct_url, d.slug, d.title, e.episode_number, e.season_number
        FROM episode_sources s
        JOIN episodes e ON s.episode_id = e.id
        JOIN dramas d ON e.drama_id = d.id
        WHERE s.direct_url LIKE '%voe.sx%' OR (s.provider = 'voe' AND s.direct_url LIKE '%voe%')
    """
    params = []
    if args.drama_id > 0:
        sql += " AND e.drama_id = ?"
        params.append(args.drama_id)
    sql += " ORDER BY s.id ASC"
    if args.limit > 0:
        sql += f" LIMIT {args.limit}"

    cur.execute(sql, params)
    sources = cur.fetchall()
    total = len(sources)

    print("=== VOE DEAD SOURCE PURGER ===")
    print(f"Toplam taranacak VOE kaynağı: {total:,}")
    print(f"Mod: {'DRY RUN (Değişiklik yapılmayacak)' if args.dry_run else 'CANLI PURGE (DB, R2 ve Supabase güncellenecek)'}")
    print(f"Tarama İş Parçacığı (workers): {args.workers}")
    print(f"Senkronizasyon İş Parçacığı (sync-workers): {args.sync_workers}")
    print("-" * 65)

    if total == 0:
        print("Taranacak VOE kaynağı bulunamadı.")
        conn.close()
        return

    dead_sources = []
    alive_sources = []
    uncertain_sources = []
    touched_dramas = set()

    t_start = time.time()

    def process_item(item):
        sid, ep_id, did, url, slug, title, ep_num, s_num = item
        code, is_dead = check_voe_url(url)
        time.sleep(0.06)
        return (item, code, is_dead)

    print("\n[PASS 1] Çoklu iş parçacığı ve ayna etki alanı (mirror) ile taranıyor...")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for idx, (item, code, is_dead) in enumerate(executor.map(process_item, sources), 1):
            sid, ep_id, did, url, slug, title, ep_num, s_num = item
            if is_dead:
                dead_sources.append(item)
                touched_dramas.add(did)
            elif code in (200, 302):
                alive_sources.append(item)
            else:
                uncertain_sources.append(item)

            if idx % 100 == 0 or idx == total:
                elapsed = time.time() - t_start
                rate = idx / elapsed if elapsed > 0 else 0
                eta_sec = (total - idx) / rate if rate > 0 else 0
                eta_str = f"{int(eta_sec // 60)}d {int(eta_sec % 60)}s"
                print(f"[{idx:,}/{total:,}] Ölü={len(dead_sources):,}, Canlı={len(alive_sources):,}, Belirsiz/503={len(uncertain_sources):,} ({rate:.1f} req/s, Kalan: {eta_str})")

    # Pass 2: Retry uncertain sources if any
    if uncertain_sources:
        print(f"\n[PASS 2] {len(uncertain_sources):,} adet belirsiz/503 kaynak tek iş parçacığıyla tekrar taranıyor...")
        time.sleep(2.0)
        still_uncertain = []
        for idx, item in enumerate(uncertain_sources, 1):
            sid, ep_id, did, url, slug, title, ep_num, s_num = item
            time.sleep(0.20)
            code, is_dead = check_voe_url(url)
            if is_dead:
                dead_sources.append(item)
                touched_dramas.add(did)
            elif code in (200, 302):
                alive_sources.append(item)
            else:
                still_uncertain.append(item)
            if idx % 50 == 0 or idx == len(uncertain_sources):
                print(f"  [Pass 2: {idx:,}/{len(uncertain_sources):,}] Çözülen Ölü={len(dead_sources):,}, Çözülen Canlı={len(alive_sources):,}, Kalan={len(still_uncertain):,}")
        uncertain_sources = still_uncertain

    total_time = time.time() - t_start
    print("\n" + "=" * 65)
    print(f"Tarama Tamamlandı ({total_time:.1f} saniye):")
    print(f"  - Toplam Taranan: {total:,}")
    print(f"  - Doğrulanmış ÖLÜ (404/Deleted): {len(dead_sources):,} (%{len(dead_sources)/total*100:.1f})")
    print(f"  - Doğrulanmış ÇALIŞAN (200 OK): {len(alive_sources):,} (%{len(alive_sources)/total*100:.1f})")
    print(f"  - Belirsiz Kalan (Dokunulmayan): {len(uncertain_sources):,} (%{len(uncertain_sources)/total*100:.1f})")
    print(f"  - Etkilenen Dizi/Film Sayısı: {len(touched_dramas):,}")
    print("=" * 65)

    if dead_sources:
        print("\nÖrnek Doğrulanmış Ölü VOE Linkleri (İlk 5):")
        for sid, ep_id, did, url, slug, title, ep_num, s_num in dead_sources[:5]:
            print(f"  • ID {sid}: {title} (S{s_num}:B{ep_num}) -> {url}")

    if alive_sources:
        print("\nÖrnek Doğrulanmış Canlı/Çalışan VOE Linkleri (İlk 5):")
        for sid, ep_id, did, url, slug, title, ep_num, s_num in alive_sources[:5]:
            print(f"  • ID {sid}: {title} (S{s_num}:B{ep_num}) -> {url}")

    if args.dry_run:
        print("\n[DRY RUN] Hiçbir kayıt silinmedi. Gerçek silme işlemi için --dry-run olmadan çalıştırın.")
        conn.close()
        return

    if not dead_sources:
        print("\nSilinecek doğrulanmış ölü VOE kaynağı bulunamadı.")
        conn.close()
        return

    # Real Purge Execution
    dead_ids = [d[0] for d in dead_sources]
    print(f"\n[PURGE] {len(dead_ids):,} ölü VOE kaynağı SQLite veritabanından siliniyor...")

    # 1. Batch delete in chunks of 500
    for i in range(0, len(dead_ids), 500):
        chunk = dead_ids[i:i+500]
        placeholders = ",".join("?" * len(chunk))
        cur.execute(f"DELETE FROM episode_sources WHERE id IN ({placeholders})", chunk)
    conn.commit()
    print("✓ SQLite episode_sources tablosundan ölü linkler başarıyla silindi.")

    # 2. Tag episodes with 0 sources as pending
    cur.execute("""
        UPDATE episodes
        SET source_status = 'pending',
            pending_since = COALESCE(pending_since, CURRENT_TIMESTAMP),
            last_source_check = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT e.id FROM episodes e
            LEFT JOIN episode_sources es ON e.id = es.episode_id
            WHERE es.id IS NULL AND (e.source_status IS NULL OR e.source_status != 'pending')
        )
    """)
    newly_pending = cur.rowcount
    conn.commit()
    if newly_pending > 0:
        print(f"✓ Kaynaksız kalan {newly_pending:,} bölüm 'pending' (yakında) olarak etiketlendi.")

    # 3. Update dramas episode_count and sources_count in SQLite
    print(f"[SQLITE] {len(touched_dramas):,} etkilenen dizinin sayaçları güncelleniyor...")
    touched_list = list(touched_dramas)
    for i in range(0, len(touched_list), 500):
        chunk = touched_list[i:i+500]
        placeholders = ",".join("?" * len(chunk))
        cur.execute(f"""
            UPDATE dramas
            SET episode_count = (SELECT COUNT(*) FROM episodes WHERE drama_id = dramas.id),
                sources_count = (
                    SELECT COUNT(*) FROM episode_sources es
                    JOIN episodes e ON e.id = es.episode_id
                    WHERE e.drama_id = dramas.id
                )
            WHERE id IN ({placeholders})
        """, chunk)
    conn.commit()
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()
    print("✓ SQLite sayaçları güncellendi ve WAL checkpoint tamamlandı.")

    # 4. Sync touched dramas to R2 bundles and Supabase in parallel
    print(f"\n[SYNC] {len(touched_list):,} etkilenen dizi Cloudflare R2 bundle ve Supabase ile paralel ({args.sync_workers} workers) senkronize ediliyor...")
    t_sync_start = time.time()
    synced_count = 0
    with ThreadPoolExecutor(max_workers=args.sync_workers) as sync_executor:
        for idx, res in enumerate(sync_executor.map(sync_single_drama_bundle, touched_list), 1):
            if res:
                synced_count += 1
            if idx % 100 == 0 or idx == len(touched_list):
                elapsed_sync = time.time() - t_sync_start
                rate_sync = idx / elapsed_sync if elapsed_sync > 0 else 0
                print(f"  [{idx:,}/{len(touched_list):,}] R2 & Supabase senkronize edildi ({rate_sync:.1f} dizi/s)...")

    print(f"✓ {synced_count:,} dizi Cloudflare R2 ve Supabase'e başarıyla senkronize edildi.")

    # 5. Backup updated SQLite database to Cloudflare R2
    print("\n[BACKUP] Güncellenmiş SQLite veritabanı Cloudflare R2'ye yedekleniyor...")
    try:
        backed_up = backup_db_to_r2()
        if backed_up:
            print("✓ SQLite veritabanı Cloudflare R2 bucket'ına başarıyla yüklendi.")
        else:
            print("⚠ R2 yedekleme tamamlanamadı (credentials veya network kontrol edin).")
    except Exception as e:
        print(f"⚠ R2 yedekleme hatası: {e}")

    print("\n" + "=" * 65)
    print("✓ VOE ARŞİV TEMİZLEME VE SENKRONİZASYON EKSİKSİZ TAMAMLANDI!")
    print(f"  • Silinen Ölü VOE Linki: {len(dead_sources):,}")
    print(f"  • Korunan Çalışan VOE Linki: {len(alive_sources):,}")
    print(f"  • Güncellenen Dizi Sayısı: {len(touched_dramas):,}")
    print(f"  • Senkronize Edilen Dizi Bundle: {synced_count:,}")
    print("=" * 65)

if __name__ == '__main__':
    main()
