"""
KoUp Single Series Sync Runner (GitHub Actions & CLI Entrypoint)
- Ensures webdrama_archive.db is pulled from Cloudflare R2 if running in cloud
- Invokes scrapers/sync_target_drama.py with --drama-id, --provider, --manual-url
- Ensures bundle upload, Supabase sync, and DB backup to R2 are finalized
"""

import os
import sys
import argparse
import subprocess
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import download_db_from_r2, backup_db_to_r2


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)


def ensure_db():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path) or os.path.getsize(db_path) < 10_000_000:
        log("DB", "webdrama_archive.db yerelde yok veya eksik. Cloudflare R2'den indiriliyor...")
        ok = download_db_from_r2(db_path)
        if ok:
            log("DB", f"Veritabanı Cloudflare R2'den başarıyla indirildi ({os.path.getsize(db_path):,} bayt).")
        else:
            log("UYARI", "R2'den veritabanı indirilemedi!")
            sys.exit(1)
    else:
        log("DB", f"Mevcut veritabanı kullanılıyor ({os.path.getsize(db_path):,} bayt).")


def main():
    parser = argparse.ArgumentParser(description="KoUp Single Series Live Cloud Sync Runner")
    parser.add_argument("--drama-id", type=int, required=True, help="Senkronize edilecek Dizi ID")
    parser.add_argument("--provider", type=str, default="auto", help="Sağlayıcı (auto, dizibox, dizikorea, bldrama, etc.)")
    parser.add_argument("--manual-url", type=str, default="", help="Opsiyonel doğrudan dizi bağlantısı")
    args = parser.parse_args()

    log("BAŞLATILDI", f"Tek seri bulut senkronizasyonu başlatıldı -> Dizi ID: {args.drama_id}, Sağlayıcı: {args.provider}")
    if args.manual_url:
        log("MANUEL", f"Hedef bağlantı: {args.manual_url}")

    ensure_db()

    # Invoke scrapers/sync_target_drama.py
    script_path = os.path.join(_ROOT, "scrapers", "sync_target_drama.py")
    cmd = [
        sys.executable,
        "-u",
        script_path,
        "--drama-id",
        str(args.drama_id),
        "--provider",
        args.provider,
    ]
    if args.manual_url and args.manual_url.strip():
        cmd.extend(["--manual-url", args.manual_url.strip()])

    log("ÇALIŞTIRILIYOR", f"Komut: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=_ROOT)

    if result.returncode != 0:
        log("HATA", f"Senkronizasyon alt işlemi hata ile sonlandı (kod: {result.returncode})")
        sys.exit(result.returncode)

    log("BAŞARILI", f"Dizi #{args.drama_id} için senkronizasyon ve bulut eşitlemesi tamamlandı.")


if __name__ == "__main__":
    main()
