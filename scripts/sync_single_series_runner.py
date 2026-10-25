"""
KoUp Single Series Sync Runner (GitHub Actions & CLI Entrypoint)
- Ensures webdrama_archive.db is pulled from Cloudflare R2 if running in cloud
- Invokes scrapers/sync_target_drama.py with --drama-id, --provider, --manual-url
- Reports real-time status and logs to Supabase admin_jobs table
- Ensures bundle upload, Supabase sync, and DB backup to R2 are finalized
"""

import os
import sys
import argparse
import subprocess
import requests
from datetime import datetime, timezone

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import download_db_from_r2, backup_db_to_r2


def log(tag: str, msg: str):
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] [{tag}] {msg}", flush=True)


def update_admin_job(job_id: str, status: str = None, progress: int = None, log_line: str = None, result: dict = None, error: str = None):
    """Safely updates admin_jobs in Supabase to stream real-time progress to KoUp UI."""
    if not job_id:
        return
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
    if not supabase_url or not service_key:
        return

    try:
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        patch_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if status:
            patch_data["status"] = status
            if status == "running":
                patch_data["started_at"] = datetime.now(timezone.utc).isoformat()
            elif status in ("completed", "failed"):
                patch_data["finished_at"] = datetime.now(timezone.utc).isoformat()
        if progress is not None:
            patch_data["progress"] = progress
        if result:
            patch_data["result"] = result
        if error:
            patch_data["error_message"] = error

        if log_line:
            # Fetch existing logs to append
            try:
                get_res = requests.get(
                    f"{supabase_url}/rest/v1/admin_jobs?id=eq.{job_id}&select=logs",
                    headers=headers,
                    timeout=5,
                )
                if get_res.ok and get_res.json():
                    cur_logs = get_res.json()[0].get("logs") or []
                    if isinstance(cur_logs, list):
                        cur_logs.append(log_line)
                        patch_data["logs"] = cur_logs[-120:]
            except Exception:
                pass

        requests.patch(
            f"{supabase_url}/rest/v1/admin_jobs?id=eq.{job_id}",
            json=patch_data,
            headers=headers,
            timeout=5,
        )
    except Exception as e:
        log("JOB_LOG_ERR", str(e))


def find_pending_job_id(drama_id: int) -> str:
    """Finds an existing queued/running job for this drama if not provided."""
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
    if not supabase_url or not service_key:
        return ""
    try:
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        res = requests.get(
            f"{supabase_url}/rest/v1/admin_jobs?kind=eq.sync_series&status=in.(queued,running)&order=created_at.desc&limit=5",
            headers=headers,
            timeout=5,
        )
        if res.ok:
            for job in res.json():
                params = job.get("params") or {}
                if str(params.get("dramaId")) == str(drama_id):
                    return job.get("id", "")
    except Exception:
        pass
    return ""


def ensure_db(job_id: str = ""):
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path) or os.path.getsize(db_path) < 10_000_000:
        log("DB", "webdrama_archive.db yerelde yok veya eksik. Cloudflare R2'den indiriliyor...")
        if job_id:
            now = datetime.now().strftime("%H:%M:%S")
            update_admin_job(job_id, progress=25, log_line=f"[{now}] [R2] Arşiv veritabanı Cloudflare R2'den çekiliyor...")
        ok = download_db_from_r2(db_path)
        if ok:
            log("DB", f"Veritabanı Cloudflare R2'den başarıyla indirildi ({os.path.getsize(db_path):,} bayt).")
            if job_id:
                now = datetime.now().strftime("%H:%M:%S")
                update_admin_job(job_id, progress=35, log_line=f"[{now}] [DB] R2 veritabanı hazırlandı ({os.path.getsize(db_path):,} bayt)")
        else:
            log("UYARI", "R2'den veritabanı indirilemedi!")
            if job_id:
                update_admin_job(job_id, status="failed", error="R2 veritabanı indirilemedi.")
            sys.exit(1)
    else:
        log("DB", f"Mevcut veritabanı kullanılıyor ({os.path.getsize(db_path):,} bayt).")
        if job_id:
            now = datetime.now().strftime("%H:%M:%S")
            update_admin_job(job_id, progress=35, log_line=f"[{now}] [DB] Yerel veritabanı kullanılıyor ({os.path.getsize(db_path):,} bayt)")


def main():
    parser = argparse.ArgumentParser(description="KoUp Single Series Live Cloud Sync Runner")
    parser.add_argument("--drama-id", type=int, required=True, help="Senkronize edilecek Dizi ID")
    parser.add_argument("--provider", type=str, default="auto", help="Sağlayıcı (auto, dizibox, dizikorea, bldrama, etc.)")
    parser.add_argument("--manual-url", type=str, default="", help="Opsiyonel doğrudan dizi bağlantısı")
    parser.add_argument("--job-id", type=str, default="", help="Supabase admin_jobs UUID")
    args = parser.parse_args()

    job_id = args.job_id.strip() if args.job_id else ""
    if not job_id:
        job_id = find_pending_job_id(args.drama_id)

    now = datetime.now().strftime("%H:%M:%S")
    start_msg = f"Tek seri bulut senkronizasyonu başlatıldı -> Dizi #{args.drama_id}, Sağlayıcı: {args.provider}"
    log("BAŞLATILDI", start_msg)
    if job_id:
        update_admin_job(job_id, status="running", progress=15, log_line=f"[{now}] [Bulut] {start_msg}")

    if args.manual_url:
        log("MANUEL", f"Hedef bağlantı: {args.manual_url}")
        if job_id:
            update_admin_job(job_id, log_line=f"[{now}] [Hedef URL] {args.manual_url}")

    ensure_db(job_id)

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
    if job_id:
        now = datetime.now().strftime("%H:%M:%S")
        update_admin_job(job_id, progress=45, log_line=f"[{now}] [Tarama] Sağlayıcı taranıyor & kaynaklar çözümleniyor...")

    proc = subprocess.Popen(
        cmd,
        cwd=_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    step_count = 0
    last_error_line = ""
    for line in iter(proc.stdout.readline, ''):
        line_clean = line.strip()
        if not line_clean:
            continue
        print(line_clean, flush=True)

        is_error = any(kw in line_clean for kw in ("HATA", "Error", "Exception", "Traceback", "failed", "başarısız"))
        if is_error:
            last_error_line = line_clean

        step_count += 1
        # Stream important status lines to Supabase Realtime
        if job_id and (
            line_clean.startswith("[")
            or is_error
            or "BÖLÜM" in line_clean
            or "KAYIT" in line_clean
            or "YENİ" in line_clean
            or "EŞLEŞME" in line_clean
            or "R2" in line_clean
            or "ONARIM" in line_clean
            or step_count % 8 == 0
        ):
            progress_val = min(92, 45 + min(45, step_count * 2))
            update_admin_job(job_id, progress=progress_val, log_line=line_clean)

    proc.wait()

    if proc.returncode != 0:
        err_msg = f"Senkronizasyon alt işlemi hata ile sonlandı (kod: {proc.returncode})"
        if last_error_line:
            err_msg += f" -> {last_error_line}"
        log("HATA", err_msg)
        if job_id:
            now = datetime.now().strftime("%H:%M:%S")
            update_admin_job(job_id, status="failed", error=err_msg, log_line=f"[{now}] [HATA] {err_msg}")
        sys.exit(proc.returncode)

    success_msg = f"Dizi #{args.drama_id} için senkronizasyon ve bulut eşitlemesi tamamlandı."
    log("BAŞARILI", success_msg)
    if job_id:
        now = datetime.now().strftime("%H:%M:%S")
        update_admin_job(
            job_id,
            status="completed",
            progress=100,
            result={"ok": True, "dramaId": args.drama_id, "provider": args.provider},
            log_line=f"[{now}] [BAŞARILI] {success_msg}",
        )


if __name__ == "__main__":
    main()
