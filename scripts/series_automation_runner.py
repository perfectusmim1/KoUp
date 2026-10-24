#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/series_automation_runner.py

KoUp Multi-Site Per-Series Automation Runner:
- Takes a drama_id or --all-active
- Reads connected sites and custom slug overrides from series_automations table
- Scans all bound sites (AsyaWatch, DiziKorea, DiziFon, DiziBox, Dizilla, AnimeciX, DDizi, HDFilm)
- Automatically discovers missing episodes, extracts direct streams
- Reconciles episodes and recalculates counts
- Generates/updates R2 JSON bundle (sources/{id}.json) and uploads to Cloudflare R2
- Updates SQLite archive and creates Cloudflare R2 DB backup
- Syncs to Supabase (media, episodes, series_automations)
- Emits real-time __LOG__, __ITEM__, __RESULT__ for Admin Panel streaming
"""

import sys
import os
import re
import json
import time
import argparse
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection
from scrapers.live_scanner import (
    scan_asyawatch,
    scan_dizikorea,
    scan_dizifon,
    scan_dizibox,
    scan_dizilla,
    scan_animecix,
    scan_ddizi,
    scan_hdfilm,
    build_drama_index,
)
from scrapers.multisite import (
    pop_recent_added_episodes,
    pop_recent_added_sources,
)
from scrapers.supabase_sync_helper import (
    upload_to_r2,
    backup_db_to_r2,
    sb_request,
)
from scripts.export_sources_bundles import export_all


def emit_log(msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    line = f"[{now}] {msg}"
    print(line, flush=True)


def emit_item(item: dict):
    print(f"__ITEM__ {json.dumps(item, ensure_ascii=False)}", flush=True)


def emit_result(res: dict):
    print(f"__RESULT__ {json.dumps(res, ensure_ascii=False)}", flush=True)


SUPPORTED_SITES = [
    {"id": "asyawatch", "name": "AsyaWatch", "badge": "1080p HLS"},
    {"id": "dizikorea", "name": "DiziKorea", "badge": "PlayerDKorea"},
    {"id": "dizifon", "name": "DiziFon", "badge": "OK.ru / Vidmoly"},
    {"id": "dizibox", "name": "DiziBox", "badge": "DBX Pro HLS"},
    {"id": "dizilla", "name": "Dizilla", "badge": "1080p Native"},
    {"id": "animecix", "name": "AnimeciX", "badge": "Tau-Video"},
    {"id": "ddizi", "name": "DDizi", "badge": "YouTube HD"},
    {"id": "hdfilm", "name": "HDFilmcehennemi", "badge": "Rapidrame HLS"},
]


def auto_resolve_site_slug(site_id: str, title: str):
    """Dynamically discovers the exact site-specific slug used on this site via live search."""
    try:
        from scripts.live_multi_search import (
            search_asyawatch, search_dizifon, search_dizikorea, search_animecix, search_dizibox
        )
        fn_map = {
            "asyawatch": search_asyawatch,
            "dizifon": search_dizifon,
            "dizikorea": search_dizikorea,
            "animecix": search_animecix,
            "dizibox": search_dizibox,
        }
        fn = fn_map.get(site_id)
        if not fn:
            return None
        items = fn(title)
        if items and len(items) > 0:
            return items[0]
    except Exception:
        pass
    return None


def resolve_all_site_slugs(title: str, connected_sites=None) -> dict:
    """Searches all connected/supported sites concurrently and returns exact slugs and match details."""
    from scripts.live_multi_search import (
        search_asyawatch, search_dizifon, search_dizikorea, search_animecix, search_dizibox
    )
    from concurrent.futures import ThreadPoolExecutor

    fn_map = {
        "asyawatch": (search_asyawatch, "AsyaWatch"),
        "dizifon": (search_dizifon, "DiziFon"),
        "dizikorea": (search_dizikorea, "DiziKorea"),
        "animecix": (search_animecix, "AnimeciX"),
        "dizibox": (search_dizibox, "DiziBox"),
    }
    targets = connected_sites or list(fn_map.keys())
    results = {}
    suggested = {}

    def check_site(site_id):
        if site_id not in fn_map:
            return site_id, {"found": False, "reason": "Desteklenmeyen veya arama API'si olmayan site"}
        fn, name = fn_map[site_id]
        try:
            items = fn(title)
            if items and len(items) > 0:
                first = items[0]
                return site_id, {
                    "found": True,
                    "site_name": name,
                    "slug": first["slug"],
                    "title": first.get("title") or title,
                    "url": first.get("url") or "",
                }
            else:
                return site_id, {
                    "found": False,
                    "site_name": name,
                    "reason": f"Sitede '{title}' aramasıyla eşleşen yapım bulunamadı",
                }
        except Exception as e:
            return site_id, {
                "found": False,
                "site_name": name,
                "reason": f"Arama hatası: {e}",
            }

    with ThreadPoolExecutor(max_workers=5) as ex:
        for sid, res in ex.map(check_site, targets):
            results[sid] = res
            if res.get("found") and res.get("slug"):
                suggested[sid] = res["slug"]

    return {
        "title": title,
        "results": results,
        "suggested_slugs": suggested,
    }


def sync_single_series(drama_id: int) -> dict:
    conn = get_connection()
    cur = conn.cursor()

    # 1. Fetch automation config
    cur.execute("""
        SELECT sa.media_id, sa.title, sa.slug, sa.connected_sites, sa.site_slugs, sa.is_active,
               d.content_type, d.episode_count, d.sources_count, d.status_broadcast
        FROM series_automations sa
        JOIN dramas d ON sa.media_id = d.id
        WHERE sa.media_id = ?
    """, (drama_id,))
    row = cur.fetchone()

    if not row:
        # Fallback to dramas table if not in series_automations yet
        cur.execute("SELECT id, title, slug, content_type, episode_count, sources_count, status_broadcast FROM dramas WHERE id=?", (drama_id,))
        d_row = cur.fetchone()
        if not d_row:
            emit_log(f"[HATA] Seri bulunamadı: #{drama_id}")
            conn.close()
            return {"ok": False, "error": f"Dizi bulunamadı: #{drama_id}"}
        
        # Auto register into series_automations
        def_sites = ["asyawatch", "dizikorea", "dizifon"] if d_row[3] == "dizi" else ["animecix", "asyawatch"]
        cur.execute("""
            INSERT OR REPLACE INTO series_automations (
                media_id, title, slug, content_type, status_broadcast, episode_count, sources_count,
                is_active, connected_sites, site_slugs, last_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, '{}', 'idle', datetime('now'), datetime('now'))
        """, (d_row[0], d_row[1], d_row[2], d_row[3], d_row[6], d_row[4], d_row[5], json.dumps(def_sites)))
        conn.commit()

        connected_sites = def_sites
        site_slugs = {}
        title = d_row[1]
        slug = d_row[2]
        content_type = d_row[3]
    else:
        title = row[1]
        slug = row[2]
        try:
            connected_sites = json.loads(row[3]) if isinstance(row[3], str) else (row[3] or [])
        except:
            connected_sites = ["asyawatch", "dizikorea", "dizifon"]
        try:
            site_slugs = json.loads(row[4]) if isinstance(row[4], str) else (row[4] or {})
        except:
            site_slugs = {}
        content_type = row[6]

    emit_log(f"============================================================")
    emit_log(f"🚀 Seri Otomasyonu Başlatıldı: {title} (#{drama_id})")
    emit_log(f"Bağlı Siteler: {', '.join(connected_sites) if connected_sites else 'Hiçbiri'}")
    emit_log(f"============================================================")

    # Clear recent queues
    pop_recent_added_episodes()
    pop_recent_added_sources()

    initial_sources_count = cur.execute("SELECT count(s.id) FROM episode_sources s JOIN episodes e ON s.episode_id=e.id WHERE e.drama_id=?", (drama_id,)).fetchone()[0]
    initial_episodes_count = cur.execute("SELECT count(*) FROM episodes WHERE drama_id=?", (drama_id,)).fetchone()[0]

    idx = build_drama_index(cur)
    results_by_site = {}
    total_added_streams = 0

    # 2. Iterate through each connected site
    for site_id in connected_sites:
        site_id = site_id.lower().strip()
        target_term = site_slugs.get(site_id)
        if not target_term:
            # Dynamically auto-resolve slug on this site
            res_info = auto_resolve_site_slug(site_id, title)
            if res_info and res_info.get("slug"):
                discovered_slug = res_info["slug"]
                emit_log(f"[{site_id.upper()}] ✨ Otomatik özel adres tespit edildi: '{discovered_slug}' ({res_info.get('title', '')})")
                target_term = discovered_slug
                site_slugs[site_id] = discovered_slug
                # Persist to database so it's remembered
                try:
                    c_persist = conn.cursor()
                    c_persist.execute(
                        "UPDATE series_automations SET site_slugs = ?, updated_at = datetime('now') WHERE media_id = ?",
                        (json.dumps(site_slugs), drama_id)
                    )
                    conn.commit()
                    sb_request("PATCH", f"/rest/v1/series_automations?media_id=eq.{drama_id}", body={"site_slugs": site_slugs})
                except Exception:
                    pass
            else:
                target_term = slug or title

        emit_log(f"[{site_id.upper()}] Taranıyor: '{target_term}'...")

        site_delta = 0
        try:
            cur.execute("SELECT * FROM dramas WHERE id = ?", (drama_id,))
            d_current = cur.fetchone()
            dr_dict = dict(d_current) if d_current else {}
            manual_u = target_term if target_term and target_term.startswith('http') else None

            if site_id == "asyawatch":
                from scrapers.sync_target_drama import sync_asyawatch_target
                eps_a, srcs_a = sync_asyawatch_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "dizikorea":
                from scrapers.sync_target_drama import sync_dizikorea_target
                eps_a, srcs_a = sync_dizikorea_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "dizifon":
                from scrapers.sync_target_drama import sync_dizifon_target
                eps_a, srcs_a = sync_dizifon_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "dizibox":
                from scrapers.sync_target_drama import sync_dizibox_target
                eps_a, srcs_a = sync_dizibox_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "dizilla":
                from scrapers.sync_target_drama import sync_dizilla_target
                eps_a, srcs_a = sync_dizilla_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "animecix":
                from scrapers.sync_target_drama import sync_animecix_target
                eps_a, srcs_a = sync_animecix_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "ddizi":
                from scrapers.sync_target_drama import sync_ddizi_target
                eps_a, srcs_a = sync_ddizi_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "hdfilm":
                from scrapers.sync_target_drama import sync_hdfilm_target
                eps_a, srcs_a = sync_hdfilm_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "bldrama":
                from scrapers.sync_target_drama import sync_bldrama_target
                eps_a, srcs_a = sync_bldrama_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            elif site_id == "asyaanimeleri":
                from scrapers.sync_target_drama import sync_asyaanimeleri_target
                eps_a, srcs_a = sync_asyaanimeleri_target(conn, cur, dr_dict, target_url=manual_u)
                site_delta = eps_a + srcs_a
            else:
                emit_log(f"[{site_id}] Bilinmeyen site atlandı.")
                continue

            results_by_site[site_id] = {"ok": True, "delta": site_delta}
            total_added_streams += site_delta
            emit_log(f"[{site_id.upper()}] Tamamlandı: +{site_delta} yeni bölüm/akış işlendi.")
        except Exception as e:
            results_by_site[site_id] = {"ok": False, "error": str(e)}
            emit_log(f"[{site_id.upper()}] Hata oluştu: {e}")

    # 3. Recalculate episode and source counts
    new_sources_count = cur.execute("SELECT count(s.id) FROM episode_sources s JOIN episodes e ON s.episode_id=e.id WHERE e.drama_id=?", (drama_id,)).fetchone()[0]
    new_episodes_count = cur.execute("SELECT count(*) FROM episodes WHERE drama_id=?", (drama_id,)).fetchone()[0]

    net_episodes_added = max(0, new_episodes_count - initial_episodes_count)
    net_sources_added = max(0, new_sources_count - initial_sources_count)

    # Check if series has ended (Final)
    is_series_final = False
    latest_ep = cur.execute("SELECT episode_number, episode_name FROM episodes WHERE drama_id=? ORDER BY episode_number DESC LIMIT 1", (drama_id,)).fetchone()
    if latest_ep and latest_ep[1]:
        ep_title_lower = str(latest_ep[1]).lower()
        if "final" in ep_title_lower and "sezon" not in ep_title_lower:
            is_series_final = True

    cur_status = cur.execute("SELECT status_broadcast FROM dramas WHERE id=?", (drama_id,)).fetchone()
    if cur_status and str(cur_status[0]).lower() in ("final", "completed", "bitti"):
        is_series_final = True

    new_status_broadcast = "Final" if is_series_final else "Devam Ediyor"

    # Update dramas table
    cur.execute("""
        UPDATE dramas
        SET episode_count = ?, sources_count = ?, status_broadcast = ?, updated_at = datetime('now')
        WHERE id = ?
    """, (str(new_episodes_count), new_sources_count, new_status_broadcast, drama_id))

    # Update series_automations status (Final series are automatically removed from pool)
    if is_series_final:
        status_summary = f"🎉 Final Yaptı ({new_episodes_count} Bölüm Tamamlandı)"
        cur.execute("DELETE FROM series_automations WHERE media_id = ?", (drama_id,))
        conn.commit()
        emit_log(f"🎉 #{drama_id} {title} Final yaptığı için Seri Otomasyonu listesinden otomatik kaldırıldı.")
    else:
        status_summary = f"+{net_episodes_added} Bölüm | +{net_sources_added} Kaynak ({len(connected_sites)} Site)"
        cur.execute("""
            UPDATE series_automations
            SET episode_count = ?, sources_count = ?, status_broadcast = ?,
                is_active = 1,
                last_status = 'healthy',
                last_message = ?, last_episodes_added = ?, last_sources_added = ?,
                last_synced_at = datetime('now'), updated_at = datetime('now')
            WHERE media_id = ?
        """, (new_episodes_count, new_sources_count, new_status_broadcast, status_summary, net_episodes_added, net_sources_added, drama_id))
        conn.commit()

    # Checkpoint SQLite
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()

    # 4. Re-export R2 Bundle (Rule 11)
    emit_log(f"[R2 Bundle] #{drama_id} için JSON paketi yeniden oluşturuluyor...")
    export_all(drama_id=drama_id)

    bundle_path = os.path.join(_ROOT, "r2_bundles", "sources", f"{drama_id}.json")
    if os.path.exists(bundle_path):
        emit_log(f"[R2 Upload] sources/{drama_id}.json Cloudflare R2'ye yükleniyor...")
        upload_to_r2(bundle_path, f"sources/{drama_id}.json")

    # 5. Backup SQLite to Cloudflare R2
    emit_log("[R2 Backup] SQLite veritabanı yedeği Cloudflare R2'ye yükleniyor...")
    backup_db_to_r2()

    # 6. Supabase Sync (Rule 11)
    emit_log(f"[Supabase Sync] Supabase media, episodes ve series_automations eşitleniyor...")
    try:
        from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts
        conn2 = get_connection()
        c2 = conn2.cursor()
        sync_drama_bundle_and_counts(conn2, c2, drama_id)
        conn2.close()

        if is_series_final:
            sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{drama_id}")
            emit_log(f"[Supabase Sync] #{drama_id} Supabase series_automations tablosundan silindi.")
        else:
            now_iso = datetime.now(timezone.utc).isoformat()
            sb_request("PATCH", f"/rest/v1/series_automations?media_id=eq.{drama_id}", body={
                "episode_count": new_episodes_count,
                "sources_count": new_sources_count,
                "status_broadcast": new_status_broadcast,
                "is_active": True,
                "last_status": "healthy",
                "last_message": status_summary,
                "last_episodes_added": net_episodes_added,
                "last_sources_added": net_sources_added,
                "last_synced_at": now_iso,
                "updated_at": now_iso,
            })
    except Exception as e:
        emit_log(f"[Supabase Sync] Uyarı: {e}")

    result_payload = {
        "ok": True,
        "dramaId": drama_id,
        "title": title,
        "episodesAdded": net_episodes_added,
        "sourcesAdded": net_sources_added,
        "totalEpisodes": new_episodes_count,
        "totalSources": new_sources_count,
        "resultsBySite": results_by_site,
        "summary": status_summary,
    }
    emit_log(f"✅ Tamamlandı: {status_summary}")
    emit_result(result_payload)
    return result_payload


def sync_all_active_series(limit: int = 10) -> int:
    conn = get_connection()
    cur = conn.cursor()

    # Pre-clean: Otomasyon havuzundaki Final yapmış yapımları otomatik temizle
    cur.execute("""
        SELECT sa.media_id, sa.title 
        FROM series_automations sa 
        JOIN dramas d ON sa.media_id = d.id 
        WHERE d.status_broadcast IN ('Final', 'Tamamlandı', 'Canceled')
    """)
    final_rows = cur.fetchall()
    for f_id, f_title in final_rows:
        cur.execute("DELETE FROM series_automations WHERE media_id = ?", (f_id,))
        try:
            sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{f_id}")
        except Exception:
            pass
        emit_log(f"🧹 #{f_id} {f_title} Final yaptığı için Seri Otomasyonundan temizlendi.")
    if final_rows:
        conn.commit()

    if limit and limit > 0:
        cur.execute("SELECT media_id, title FROM series_automations WHERE is_active = 1 ORDER BY last_synced_at ASC NULLS FIRST LIMIT ?", (limit,))
    else:
        cur.execute("SELECT media_id, title FROM series_automations WHERE is_active = 1 ORDER BY last_synced_at ASC NULLS FIRST")
    rows = cur.fetchall()
    conn.close()

    emit_log(f"============================================================")
    emit_log(f"🤖 Aktif Seri Otomasyonları Taraması: {len(rows)} Dizi Bulundu")
    emit_log(f"============================================================")

    total_eps = 0
    total_srcs = 0
    for did, dtitle in rows:
        try:
            res = sync_single_series(did)
            total_eps += res.get("episodesAdded", 0)
            total_srcs += res.get("sourcesAdded", 0)
        except Exception as e:
            emit_log(f"[HATA] #{did} {dtitle} taranırken hata: {e}")

    emit_log(f"🎯 Tüm aktif seriler tamamlandı: Toplam +{total_eps} Bölüm | +{total_srcs} Kaynak.")
    return len(rows)


def add_and_bind_series(
    drama_id: int = None,
    title: str = "",
    slug: str = "",
    site: str = "asyawatch",
    connected_sites: list = None,
    site_slugs: dict = None,
    content_type: str = "dizi",
    poster: str = "",
    run_sync: bool = False
) -> dict:
    conn = get_connection()
    cur = conn.cursor()
    idx = build_drama_index(cur)

    if not connected_sites:
        connected_sites = ["asyawatch", "dizikorea", "dizifon"] if content_type == "dizi" else ["animecix", "asyawatch"]
    if site_slugs is None:
        site_slugs = {}
    if slug and site and site not in site_slugs:
        site_slugs[site] = slug

    # Auto-resolve slugs for connected sites if not explicitly provided
    resolved_all = resolve_all_site_slugs(title or (slug or "").replace("-", " ").title(), connected_sites)
    for s_id, s_slug in resolved_all.get("suggested_slugs", {}).items():
        if s_id not in site_slugs or not site_slugs[s_id]:
            site_slugs[s_id] = s_slug
            emit_log(f"[OTOMATİK SLUG] {s_id.upper()} için özel adres bulundu: '{s_slug}'")

    # If drama_id is provided, verify it exists
    if drama_id:
        cur.execute("SELECT id, title, slug, cover_image, content_type, status_broadcast, episode_count, sources_count FROM dramas WHERE id=?", (drama_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return {"ok": False, "error": f"Dizi bulunamadı: #{drama_id}"}
        if row[5] in ("Final", "Tamamlandı", "Canceled"):
            conn.close()
            emit_log(f"[UYARI] #{drama_id} '{row[1]}' zaten {row[5]} yapmış. Seri otomasyonuna eklenmedi.")
            return {"ok": False, "error": f"'{row[1]}' zaten {row[5]} yapmış bir dizi. Seri otomasyonu yalnızca devam eden serileri takip eder."}
        did = row[0]
        dtitle = row[1]
        dslug = row[2]
        dcover = row[3] or poster
        content_type = row[4] or content_type
        status_broadcast = row[5] or "Devam Ediyor"
        ep_count = row[6] or 0
        src_count = row[7] or 0
    else:
        # Out-of-catalog: Match or create enriched drama via TMDB/AniList
        from scrapers.supabase_sync_helper import match_or_create_enriched_drama
        did, dtitle, dslug, dcover = match_or_create_enriched_drama(
            conn, cur, idx,
            raw_title=title,
            slug_cand=slug,
            content_type=content_type,
            site_tag=site,
        )
        cur.execute("SELECT episode_count, sources_count, status_broadcast FROM dramas WHERE id=?", (did,))
        dr = cur.fetchone()
        ep_count = dr[0] if dr else 0
        src_count = dr[1] if dr else 0
        status_broadcast = dr[2] if dr else "Devam Ediyor"

    # Deduplicate: Check if a series with same media_id OR matching title/slug is already in series_automations
    norm_incoming = norm_title(dtitle)
    cur.execute("SELECT media_id, title, slug FROM series_automations")
    for ex_mid, ex_title, ex_slug in cur.fetchall():
        if ex_mid == did or norm_title(ex_title) == norm_incoming or (dslug and ex_slug == dslug):
            emit_log(f"[DEDUP] '{dtitle}' zaten seri otomasyonunda kayıtlı (#{ex_mid}). Tekrarlanan kayıt engellendi.")
            did = ex_mid
            dtitle = ex_title
            dslug = ex_slug
            break

    # Insert or update series_automations
    cur.execute("""
        INSERT INTO series_automations (
            media_id, title, slug, poster_url, content_type, status_broadcast,
            episode_count, sources_count, is_active, connected_sites, site_slugs,
            last_status, last_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'idle', 'Otomasyona bağlandı', datetime('now'), datetime('now'))
        ON CONFLICT(media_id) DO UPDATE SET
            title = excluded.title,
            slug = excluded.slug,
            poster_url = COALESCE(excluded.poster_url, series_automations.poster_url),
            is_active = 1,
            connected_sites = excluded.connected_sites,
            site_slugs = excluded.site_slugs,
            updated_at = datetime('now')
    """, (did, dtitle, dslug, dcover or poster, content_type, status_broadcast, ep_count, src_count, json.dumps(connected_sites), json.dumps(site_slugs)))
    conn.commit()

    # Full Storage Sync for new drama & automation
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.close()

    # Sync to Supabase series_automations with explicit on_conflict=media_id
    try:
        sb_request("POST", "/rest/v1/series_automations?on_conflict=media_id", body={
            "media_id": did,
            "title": dtitle,
            "slug": dslug,
            "poster_url": dcover or poster,
            "content_type": content_type,
            "status_broadcast": status_broadcast,
            "episode_count": ep_count,
            "sources_count": src_count,
            "is_active": True,
            "connected_sites": connected_sites,
            "site_slugs": site_slugs,
            "last_status": "idle",
            "last_message": "Otomasyona bağlandı",
            "updated_at": datetime.now().isoformat(),
        }, prefer="resolution=merge-duplicates")
    except Exception as e:
        emit_log(f"[Supabase Sync] series_automations uyarısı: {e}")

    # Backup DB to R2
    backup_db_to_r2()

    res_payload = {
        "ok": True,
        "media_id": did,
        "title": dtitle,
        "slug": dslug,
        "cover_image": dcover or poster,
        "content_type": content_type,
        "status_broadcast": status_broadcast,
        "connected_sites": connected_sites,
        "site_slugs": site_slugs,
    }
    emit_result(res_payload)

    if run_sync:
        sync_single_series(did)

    return res_payload


def main():
    parser = argparse.ArgumentParser(description="KoUp Series Multi-Site Automation Runner")
    parser.add_argument("--drama-id", type=int, default=None, help="Target drama ID")
    parser.add_argument("--all-active", action="store_true", help="Sync all active automated series")
    parser.add_argument("--add", action="store_true", help="Add or bind a series (creates drama if out-of-catalog)")
    parser.add_argument("--title", type=str, default="", help="Drama title")
    parser.add_argument("--slug", type=str, default="", help="Drama slug or candidate slug")
    parser.add_argument("--site", type=str, default="asyawatch", help="Primary discovery site")
    parser.add_argument("--connected-sites", type=str, default="asyawatch,dizikorea,dizifon", help="Comma-separated sites")
    parser.add_argument("--site-slugs", type=str, default="{}", help="JSON site slugs mapping")
    parser.add_argument("--content-type", type=str, default="dizi", help="Content type (dizi/anime/film)")
    parser.add_argument("--poster", type=str, default="", help="Cover image URL")
    parser.add_argument("--sync", action="store_true", help="Immediately run sync after adding")
    parser.add_argument("--resolve-slugs", action="store_true", help="Resolve real slugs across connected sites")
    args = parser.parse_args()

    if args.add:
        c_sites = [s.strip() for s in args.connected_sites.split(",") if s.strip()]
        try:
            s_slugs = json.loads(args.site_slugs) if args.site_slugs else {}
        except:
            s_slugs = {}
        add_and_bind_series(
            drama_id=args.drama_id,
            title=args.title,
            slug=args.slug,
            site=args.site,
            connected_sites=c_sites,
            site_slugs=s_slugs,
            content_type=args.content_type,
            poster=args.poster,
            run_sync=args.sync,
        )
    elif args.drama_id:
        sync_single_series(args.drama_id)
    elif args.all_active:
        sync_all_active_series()
    elif args.resolve_slugs:
        c_sites = [s.strip() for s in args.connected_sites.split(",") if s.strip()] if args.connected_sites else None
        res = resolve_all_site_slugs(args.title, connected_sites=c_sites)
        print(json.dumps(res, ensure_ascii=False))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
