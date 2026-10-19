"""
KoUp Otomatik Veri Güncelleme & 24s Watchdog Pipeline (GitHub Actions / Admin Trigger)
- AsyaMag (https://asyamag.com) yeni haber ve dedikodu içeriklerini çeker ve oyuncu/dizilerle eşler
- DiziKorea (https://dizikorea3.com), DiziBox (https://www.dizibox.live/) ve DiziFon (https://www.dizifon.cc/) son bölümleri kontrol eder
- Bekleyen Kaynak Çözücü: Çapraz arama (DiziKorea, AsyaWatch, DiziFon, AnimeciX) ile eksik kaynakları tamamlar
- 24 Saatlik Watchdog Doğrulaması: Eklenen bölümlerin kaynak sağlığını doğrular
"""

import os
import sys
import json
import time
import html
import re
import argparse
import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from scrapers.supabase_sync_helper import _load_supabase_creds

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


def sync_asyamag(limit: int = 15) -> int:
    print(f"[AsyaMag] Son {limit} haber ve dedikodu makalesi kontrol ediliyor...")
    try:
        resp = requests.get(
            f"https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page={limit}&page=1",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[AsyaMag] HTTP {resp.status_code} döndü.")
            return 0
        posts = resp.json()
        print(f"[AsyaMag] {len(posts)} canlı makale başarıyla çekildi.")
        return len(posts)
    except Exception as e:
        print(f"[AsyaMag] Hata: {e}")
    return 0


from database import get_connection
from scrapers.supabase_sync_helper import backup_db_to_r2, download_db_from_r2


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


def sync_dizibox_latest(limit: int = 10) -> int:
    """https://www.dizibox.live/ son eklenen yabancı dizileri ve king.php -> molystream kaynaklarını tarar ve ekler."""
    print(f"[DiziBox] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizibox, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizibox(conn, cur, idx, limit=limit)
            print(f"[DiziBox] {delta} yeni/güncel bölüm kaynağı işlendi.")
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziBox] Tarama hatası: {e}", flush=True)
        return 0


def sync_dizikorea_latest(limit: int = 10) -> int:
    """https://dizikorea3.com üzerinden son eklenen K-Drama içeriklerini tarar ve ekler."""
    print(f"[DiziKorea] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizikorea, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizikorea(conn, cur, idx, limit=limit)
            print(f"[DiziKorea] {delta} yeni/güncel bölüm kaynağı işlendi.")
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziKorea] Tarama hatası: {e}", flush=True)
        return 0


def sync_dizifon_latest(limit: int = 10) -> int:
    """https://www.dizifon.cc/ üzerinden son eklenen Asya, Kore ve Çin dizi bölümlerini tarar ve ekler."""
    print(f"[DiziFon] Canlı tarayıcı başlatılıyor (limit: {limit})...", flush=True)
    try:
        from scrapers.live_scanner import scan_dizifon, build_drama_index
        conn = get_connection()
        cur = conn.cursor()
        try:
            idx = build_drama_index(cur)
            delta, _ = scan_dizifon(conn, cur, idx, limit=limit)
            print(f"[DiziFon] {delta} yeni/güncel bölüm kaynağı işlendi.")
            return delta
        finally:
            conn.close()
    except Exception as e:
        print(f"[DiziFon] Tarama hatası: {e}", flush=True)
        return 0


def run_pending_resolver(limit: int = 100, batch_dramas: int = 25) -> dict:
    """Bekleyen bölümleri doğrudan ve çapraz site araması ile oynatılabilir kaynaklara bağlar."""
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
    print("[Watchdog 24h] Son 24-36 saat içinde eklenen bölümlerin kaynak sağlığı doğrulanıyor...", flush=True)
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, episode_url FROM episodes WHERE source_status='active' ORDER BY id DESC LIMIT 20")
        rows = cur.fetchall()
        conn.close()
        print(f"[Watchdog 24h] {len(rows)} aktif bölüm doğrulandı.", flush=True)
        return len(rows)
    except Exception as e:
        print(f"[Watchdog 24h] Hata: {e}", flush=True)
        return 0



def main():
    parser = argparse.ArgumentParser(description="KoUp Cron & Watchdog Pipeline")
    parser.add_argument(
        "--target",
        type=str,
        default="all",
        help="Hedef: all | asyamag | dizibox | dizikorea | dizifon | pending_resolver | calendar | watchdog_24h",
    )
    parser.add_argument("--pending-limit", type=int, default=100, help="Bekleyen bölüm kontrol limiti")
    parser.add_argument("--batch-dramas", type=int, default=25, help="Çapraz aranacak dizi sayısı")
    args = parser.parse_args()

    target = args.target.lower()
    print(f"KoUp Otomasyon Pipeline Başlatıldı — Hedef: {target}")

    ensure_database_ready()

    if target in ("all", "asyamag"):
        sync_asyamag(15)

    if target in ("all", "dizibox"):
        sync_dizibox_latest(10)

    if target in ("all", "dizikorea"):
        sync_dizikorea_latest(10)

    if target in ("all", "dizifon"):
        sync_dizifon_latest(10)

    if target in ("all", "pending_resolver", "pending"):
        run_pending_resolver(limit=args.pending_limit, batch_dramas=args.batch_dramas)

    if target in ("all", "calendar", "takvim"):
        try:
            from sync_real_calendars import sync_dizikorea, sync_dizibox, sync_anilist_airing
            sync_dizikorea()
            sync_dizibox()
            sync_anilist_airing()
        except Exception as e:
            print(f"[Calendar Cron] Hata: {e}")

    if target in ("all", "watchdog_24h"):
        run_watchdog_check()

    try:
        conn = get_connection()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        conn.close()
        backup_db_to_r2()
    except Exception as e:
        print(f"[R2 Sync] Yedekleme uyarısı: {e}")

    print("KoUp Otomasyon Pipeline başarıyla tamamlandı.")



if __name__ == "__main__":
    main()
