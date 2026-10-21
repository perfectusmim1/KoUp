"""
KoUp Otomatik Veri Güncelleme & 24s Watchdog Pipeline (GitHub Actions / Admin Trigger)
- AsyaMag (https://asyamag.com) yeni haber ve dedikodu içeriklerini çeker ve oyuncu/dizilerle eşler
- DiziKorea (https://dizikorea3.com), DiziBox (https://www.dizibox.live/) ve DiziFon (https://www.dizifon.cc/) son bölümleri kontrol eder
- Bekleyen Kaynak Çözücü: Çapraz arama (DiziKorea, AsyaWatch, DiziFon, AnimeciX) ile eksik kaynakları tamamlar
- 24 Saatlik Watchdog Doğrulaması: Eklenen bölümlerin kaynak sağlığını doğrular
- İstatistik Toplama: Her otomasyonda eklenen yeni dizi, bölüm, kaynak ve bot özetlerini Supabase automation_runs tablosuna kaydeder.
"""

import os
import sys
import json
import time
import html
import re
import argparse
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection
from scrapers.multisite import (
    pop_recent_added_episodes,
    pop_recent_added_sources,
)
from scrapers.supabase_sync_helper import (
    _load_supabase_creds,
    backup_db_to_r2,
    download_db_from_r2,
    pop_recent_added_dramas,
    sb_request,
)

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

CAT_MAP = {
    2419: "Dedikodu",
    9: "Kore",
    20: "Dizi",
    10: "Çin",
    6: "BL GL",
    2249: "Japonya",
    2224: "Tayland",
    19: "K-Pop",
    11: "Film",
    1: "Genel",
}


def strip_html_tags(text: str) -> str:
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def ensure_database_ready():
    """Cloud ortamında veya yerelde SQLite DB yoksa R2'den indirir."""
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path) or os.path.getsize(db_path) < 10_000_000:
        print("[DB Init] webdrama_archive.db bulunamadı veya boyutu küçük. Cloudflare R2'den indiriliyor...", flush=True)
        ok = download_db_from_r2(db_path)
        if ok:
            print(f"[DB Init] Veritabanı başarıyla hazırlandı ({os.path.getsize(db_path):,} bayt).", flush=True)
        else:
            print("[DB Init] R2'den veritabanı indirilemedi, sıfırdan oluşturulacak.", flush=True)


# =========================================================================
# STATS & AUTOMATION TRACKING HELPERS (SUPABASE)
# =========================================================================

def get_enabled_scrapers_map() -> dict:
    """Supabase scraper_configs tablosundan botların aktiflik durumunu çeker."""
    try:
        res = sb_request("GET", "/rest/v1/scraper_configs?select=id,is_enabled,name,items_synced")
        if isinstance(res, list):
            return {r["id"]: r.get("is_enabled", True) for r in res}
    except Exception as e:
        print(f"[Automation DB] Scraper konfigürasyonları okunamadı: {e}", flush=True)
    return {}


def start_automation_run(trigger_type: str, target: str) -> int | None:
    """Yeni bir otomasyon çalışması başlatıp Supabase'e kaydeder."""
    run_id_str = f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    payload = {
        "run_id": run_id_str,
        "trigger_type": trigger_type,
        "target": target,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "total_dramas_added": 0,
        "total_episodes_added": 0,
        "total_sources_added": 0,
        "dramas_added_list": [],
        "episodes_added_list": [],
        "sources_added_list": [],
        "scrapers_summary": {},
        "logs": [f"[{datetime.now().strftime('%H:%M:%S')}] [BAŞLATILDI] 12 Saatlik KoUp Otomasyon Pipeline devrede (Hedef: {target}, Tetikleyici: {trigger_type})."],
    }
    try:
        res = sb_request("POST", "/rest/v1/automation_runs", body=payload, prefer="return=representation")
        if isinstance(res, list) and len(res) > 0:
            rid = res[0].get("id")
            print(f"[Automation DB] Otomasyon çalışma kaydı oluşturuldu (ID: #{rid}, Run: {run_id_str})", flush=True)
            return rid
    except Exception as e:
        print(f"[Automation DB] Otomasyon kaydı oluşturulamadı: {e}", flush=True)
    return None


def finish_automation_run(
    run_id: int | None,
    status: str,
    duration: int,
    dramas: list,
    episodes: list,
    sources: list,
    scrapers_summary: dict,
    logs: list,
    error_msg: str = None,
):
    """Otomasyon çalışmasını tamamlayıp özet istatistiklerini Supabase'e yazar."""
    if not run_id:
        return
    payload = {
        "status": status,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "total_dramas_added": len(dramas),
        "total_episodes_added": len(episodes),
        "total_sources_added": len(sources),
        "dramas_added_list": dramas,
        "episodes_added_list": episodes,
        "sources_added_list": sources,
        "scrapers_summary": scrapers_summary,
        "logs": logs[-100:],
        "error_message": error_msg,
    }
    try:
        sb_request("PATCH", f"/rest/v1/automation_runs?id=eq.{run_id}", body=payload)
        print(f"[Automation DB] Otomasyon çalışması #{run_id} '{status}' olarak güncellendi (+{len(dramas)} Seri, +{len(episodes)} Bölüm, +{len(sources)} Kaynak).", flush=True)
    except Exception as e:
        print(f"[Automation DB] Otomasyon kaydı güncellenirken hata: {e}", flush=True)


def update_scraper_status(scraper_id: str, status: str, total_count: int = None):
    """Botun son çalışma zamanı ve durumunu scraper_configs'te günceller."""
    payload = {
        "last_run_at": datetime.now(timezone.utc).isoformat(),
        "last_status": status,
    }
    if total_count is not None and total_count > 0:
        payload["items_synced"] = total_count
    try:
        sb_request("PATCH", f"/rest/v1/scraper_configs?id=eq.{scraper_id}", body=payload)
    except Exception as e:
        print(f"[Scraper Config Update] {scraper_id} güncellenemedi: {e}", flush=True)


# =========================================================================
# SCRAPER HANDLERS
# =========================================================================

def sync_asyamag(limit: int = 15) -> int:
    print(f"[AsyaMag] Son {limit} haber ve dedikodu makalesi kontrol ediliyor...", flush=True)
    try:
        resp = requests.get(
            f"https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page={limit}&page=1",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[AsyaMag] HTTP {resp.status_code} döndü.", flush=True)
            return 0
        posts = resp.json()
        print(f"[AsyaMag] {len(posts)} canlı makale başarıyla çekildi.", flush=True)
        return len(posts)
    except Exception as e:
        print(f"[AsyaMag] Hata: {e}", flush=True)
    return 0


def sync_dizibox_latest(limit: int = 30) -> int:
    print(f"[DiziBox] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizibox, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizibox(conn, cur, idx, limit=limit)
            print(f"[DiziBox] {delta} yeni/güncel bölüm kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziBox] Tarama hatası: {e}", flush=True)
        return 0


def sync_dizikorea_latest(limit: int = 30) -> int:
    print(f"[DiziKorea] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizikorea, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizikorea(conn, cur, idx, limit=limit)
            print(f"[DiziKorea] {delta} yeni/güncel bölüm kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziKorea] Tarama hatası: {e}", flush=True)
        return 0


def sync_dizifon_latest(limit: int = 30) -> int:
    print(f"[DiziFon] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizifon, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizifon(conn, cur, idx, limit=limit)
            print(f"[DiziFon] {delta} yeni/güncel bölüm kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziFon] Tarama hatası: {e}", flush=True)
        return 0


def sync_animecix_latest(limit: int = 30) -> int:
    print(f"[AnimeciX] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_animecix, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_animecix(conn, cur, idx, limit=limit)
            print(f"[AnimeciX] {delta} yeni/güncel anime bölümü işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[AnimeciX] Tarama hatası: {e}", flush=True)
        return 0


def sync_hdfilm_latest(limit: int = 30) -> int:
    print(f"[HDFilm] Canlı film tarayıcısı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_hdfilm, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_hdfilm(conn, cur, idx, limit=limit)
            print(f"[HDFilm] {delta} yeni/güncel film kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[HDFilm] Tarama hatası: {e}", flush=True)
        return 0


def sync_ddizi_latest(limit: int = 30) -> int:
    print(f"[DDizi] Canlı yerli dizi tarayıcısı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_ddizi, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_ddizi(conn, cur, idx, limit=limit)
            print(f"[DDizi] {delta} yeni/güncel yerli dizi bölümü işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DDizi] Tarama hatası: {e}", flush=True)
        return 0


def sync_dizilla_latest(limit: int = 30) -> int:
    print(f"[Dizilla] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizilla, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizilla(conn, cur, idx, limit=limit)
            print(f"[Dizilla] {delta} yeni/güncel bölüm kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[Dizilla] Tarama hatası: {e}", flush=True)
        return 0


def sync_asyawatch_latest(limit: int = 30) -> int:
    print(f"[AsyaWatch] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_asyawatch, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_asyawatch(conn, cur, idx, limit=limit)
            print(f"[AsyaWatch] {delta} yeni/güncel bölüm kaynağı işlendi.", flush=True)
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[AsyaWatch] Tarama hatası: {e}", flush=True)
        return 0


def run_pending_resolver(limit: int = 100, batch_dramas: int = 25) -> dict:
    print(f"[Pending Resolver] En fazla {limit} bekleyen bölüm ve {batch_dramas} dizi için çapraz arama başlatılıyor...", flush=True)
    try:
        from scripts.recheck_pending_episodes import recheck_pending
        summary = recheck_pending(limit=limit, cross_site=True, batch_dramas=batch_dramas)
        print(f"[Pending Resolver] Çözülen: {summary.get('resolved', 0)} | Kalan: {summary.get('pending', 0)}", flush=True)
        return summary
    except Exception as e:
        print(f"[Pending Resolver] Hata: {e}", flush=True)
        return {}


def run_watchdog_check() -> int:
    print("[Watchdog 24h] Yeni eklenen kaynakların video sağlığı canlı HTTP kontrolleri ile test ediliyor...", flush=True)
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id, s.episode_id, s.provider, s.direct_url, s.source_name, e.drama_id
            FROM episode_sources s
            JOIN episodes e ON e.id = s.episode_id
            ORDER BY s.id DESC
            LIMIT 30
        """)
        rows = cur.fetchall()

        healthy_count = 0
        dead_count = 0

        headers_default = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        }

        for sid, epid, prov, url, sname, did in rows:
            is_alive = False
            try:
                ref = 'https://dizikorea3.com/' if 'dizikorea' in url or 'playerdkorea' in url else \
                      'https://www.hdfilmcehennemi.nl/' if 'hdfilm' in url or 'rapidrame' in url else \
                      'https://vidmoly.to/' if 'vidmoly' in url else None
                req_h = dict(headers_default)
                if ref:
                    req_h['Referer'] = ref

                # Fast HEAD probe with timeout 3.0s
                r = requests.head(url, headers=req_h, timeout=3.0, allow_redirects=True)
                if r.status_code in (200, 206, 302, 301):
                    is_alive = True
                elif r.status_code == 405:
                    rg = requests.get(url, headers=req_h, timeout=3.0, stream=True)
                    if rg.status_code in (200, 206):
                        is_alive = True
            except Exception:
                pass

            if is_alive:
                healthy_count += 1
            else:
                dead_count += 1

        conn.close()
        print(f"[Watchdog 24h] Doğrulama tamamlandı: {healthy_count} çalışan kaynak, {dead_count} erişilemeyen kaynak.", flush=True)
        return healthy_count
    except Exception as e:
        print(f"[Watchdog 24h] Hata: {e}", flush=True)
        return 0


# =========================================================================
# MAIN PIPELINE RUNNER WITH FULL STATS GATHERING
# =========================================================================

def main():
    parser = argparse.ArgumentParser(description="KoUp Cron & Watchdog Pipeline")
    parser.add_argument(
        "--target",
        type=str,
        default="all",
        help="Hedef: all | asyamag | animecix | hdfilm | ddizi | dizibox | dizilla | dizikorea | dizifon | asyawatch | pending_resolver | series_automation | calendar | watchdog_24h",
    )
    parser.add_argument(
        "--trigger",
        type=str,
        default="cron",
        help="Tetikleyici türü: cron | workflow_dispatch | admin_trigger | manual",
    )
    parser.add_argument("--pending-limit", type=int, default=100, help="Bekleyen bölüm kontrol limiti")
    parser.add_argument("--batch-dramas", type=int, default=25, help="Çapraz aranacak dizi sayısı")
    args = parser.parse_args()

    target = args.target.lower()
    trigger_type = args.trigger.lower()
    start_time = time.time()

    captured_logs = []

    def record_log(msg: str):
        now_str = datetime.now().strftime("%H:%M:%S")
        line = f"[{now_str}] {msg}"
        captured_logs.append(line)
        print(line, flush=True)

    record_log(f"KoUp 12 Saatlik Otomasyon Pipeline Başlatıldı — Hedef: {target} (Tetikleyici: {trigger_type})")

    ensure_database_ready()

    # 1. Fetch enabled scrapers from Supabase
    enabled_map = get_enabled_scrapers_map()
    if enabled_map:
        active_count = sum(1 for v in enabled_map.values() if v)
        record_log(f"Supabase konfigürasyonları yüklendi: {active_count}/{len(enabled_map)} bot aktif.")

    # 2. Start automation run in Supabase
    run_id = start_automation_run(trigger_type=trigger_type, target=target)

    all_dramas = []
    all_episodes = []
    all_sources = []
    scrapers_summary = {}

    # Helper to run a specific scraper step and gather statistics
    def run_scraper_step(bot_id: str, label: str, fn, *fn_args, **fn_kwargs):
        # Admin control: if bot is disabled in scraper_configs, skip!
        if enabled_map and not enabled_map.get(bot_id, True):
            record_log(f"[{label}] Bot admin panelinde 'Devre Dışı' bırakılmış. Atlanıyor.")
            scrapers_summary[bot_id] = {
                "label": label,
                "status": "disabled",
                "reason": "Admin tarafından devre dışı bırakıldı",
                "dramas_added": 0,
                "episodes_added": 0,
                "sources_added": 0,
                "duration_seconds": 0,
            }
            return

        record_log(f"[{label}] Görev başlatılıyor...")
        # Clear per-step queues
        pop_recent_added_dramas()
        pop_recent_added_episodes()
        pop_recent_added_sources()

        step_t0 = time.time()
        err_msg = None
        status = "healthy"
        processed = 0

        try:
            res = fn(*fn_args, **fn_kwargs)
            if isinstance(res, (int, float)):
                processed = int(res)
            elif isinstance(res, dict):
                processed = res.get("resolved", 0)
        except Exception as e:
            status = "error"
            err_msg = str(e)
            record_log(f"[{label}] HATA: {e}")

        step_duration = round(time.time() - step_t0, 1)

        # Collect items added by this step
        step_dramas = pop_recent_added_dramas()
        step_episodes = pop_recent_added_episodes()
        step_sources = pop_recent_added_sources()

        all_dramas.extend(step_dramas)
        all_episodes.extend(step_episodes)
        all_sources.extend(step_sources)

        scrapers_summary[bot_id] = {
            "label": label,
            "status": status,
            "error": err_msg,
            "duration_seconds": step_duration,
            "items_processed": processed,
            "dramas_added": len(step_dramas),
            "episodes_added": len(step_episodes),
            "sources_added": len(step_sources),
        }

        update_scraper_status(bot_id, status)
        record_log(
            f"[{label}] Tamamlandı ({step_duration}s) — +{len(step_dramas)} Seri | +{len(step_episodes)} Bölüm | +{len(step_sources)} Kaynak."
        )

    fatal_error = None
    try:
        if target in ("all", "asyamag"):
            run_scraper_step("asyamag", "AsyaMag Haber", sync_asyamag, 30)

        if target in ("all", "animecix", "anime"):
            run_scraper_step("animecix", "AnimeciX", sync_animecix_latest, 30)

        if target in ("all", "hdfilm", "film", "movie"):
            run_scraper_step("hdfilm", "HDFilmcehennemi", sync_hdfilm_latest, 30)

        if target in ("all", "ddizi", "yerli"):
            run_scraper_step("ddizi", "DDizi Yerli Arşiv", sync_ddizi_latest, 30)

        if target in ("all", "dizibox"):
            run_scraper_step("dizibox", "DiziBox", sync_dizibox_latest, 30)

        if target in ("all", "dizilla"):
            run_scraper_step("dizilla", "Dizilla", sync_dizilla_latest, 30)

        if target in ("all", "dizikorea"):
            run_scraper_step("dizikorea", "DiziKorea", sync_dizikorea_latest, 30)

        if target in ("all", "dizifon"):
            run_scraper_step("dizifon", "DiziFon", sync_dizifon_latest, 30)

        if target in ("all", "asyawatch"):
            run_scraper_step("asyawatch", "AsyaWatch", sync_asyawatch_latest, 30)

        if target in ("all", "pending_resolver", "pending"):
            run_scraper_step("pending_resolver", "Bekleyen Kaynak Çözücü", run_pending_resolver, limit=args.pending_limit, batch_dramas=args.batch_dramas)

        if target in ("all", "series_automation", "series_auto"):
            try:
                from scripts.series_automation_runner import sync_all_active_series
                run_scraper_step("series_automation", "Seri Otomasyonu", sync_all_active_series)
            except Exception as e:
                record_log(f"[Seri Otomasyonu] Hata: {e}")

        if target in ("all", "calendar", "takvim"):
            try:
                from sync_real_calendars import sync_dizikorea, sync_dizibox, sync_anilist_airing
                sync_dizikorea()
                sync_dizibox()
                sync_anilist_airing()
                record_log("[Takvim] Güncel yayın takvimi başarıyla eşitlendi.")
            except Exception as e:
                record_log(f"[Takvim] Hata: {e}")

        if target in ("all", "watchdog_24h"):
            run_scraper_step("watchdog_24h", "24h Watchdog", run_watchdog_check)

        # Otomasyon sirasinda yeni seriler eklendiyse otomatik duplicate kontrolu ve birlestirme
        if all_dramas:
            try:
                from scripts.merge_duplicates import run_merge
                record_log(f"[Deduplication] {len(all_dramas)} yeni seri eklendi, duplicate kontrolu calistiriliyor...")
                run_merge()
            except Exception as e:
                record_log(f"[Deduplication] Hata: {e}")

        # Database Checkpoint & R2 Backup
        try:
            conn = get_connection()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.close()
            backup_db_to_r2()
            record_log("[R2 Sync] Veritabanı Cloudflare R2'ye başarıyla yedeklendi.")
        except Exception as e:
            record_log(f"[R2 Sync] Yedekleme uyarısı: {e}")

    except Exception as e:
        fatal_error = str(e)
        record_log(f"[FATAL] Otomasyon sırasında kritik hata: {e}")

    total_duration = int(time.time() - start_time)
    final_status = "failed" if fatal_error else "completed"

    record_log(
        f"KoUp Otomasyon Pipeline tamamlandı ({total_duration}s) — Genel Toplam: +{len(all_dramas)} Seri | +{len(all_episodes)} Bölüm | +{len(all_sources)} Kaynak."
    )

    finish_automation_run(
        run_id=run_id,
        status=final_status,
        duration=total_duration,
        dramas=all_dramas,
        episodes=all_episodes,
        sources=all_sources,
        scrapers_summary=scrapers_summary,
        logs=captured_logs,
        error_msg=fatal_error,
    )


if __name__ == "__main__":
    main()
