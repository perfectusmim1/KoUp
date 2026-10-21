"""
KoUp Otomasyon Log ve Sağlık Denetleyicisi (Automation Logs & Health Checker)

Kullanım:
    python scripts/check_automation_logs.py
    python scripts/check_automation_logs.py --limit 10
    python scripts/check_automation_logs.py --verbose
    python scripts/check_automation_logs.py --local
"""

import os
import sys
import argparse
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

from scrapers.supabase_sync_helper import sb_request

def inspect_supabase_runs(limit: int = 5, verbose: bool = False):
    print(f"\n[Supabase] Son {limit} otomasyon calismasi sorgulaniyor...", flush=True)
    endpoint = f"/rest/v1/automation_runs?select=*&order=id.desc&limit={limit}"
    runs = sb_request("GET", endpoint)

    if not runs or not isinstance(runs, list):
        print("  Uyari: Supabase automation_runs tablosundan kayit donmedi.", flush=True)
        return

    print(f"Toplam {len(runs)} kayit bulundu:\n" + "=" * 80)
    for r in runs:
        rid = r.get("id")
        run_name = r.get("run_id") or f"run_{rid}"
        status = r.get("status")
        target = r.get("target") or "all"
        trigger = r.get("trigger_type") or "cron"
        started = r.get("started_at") or "-"
        duration = r.get("duration_seconds") or 0
        dramas = r.get("total_dramas_added", 0)
        episodes = r.get("total_episodes_added", 0)
        sources = r.get("total_sources_added", 0)
        err_msg = r.get("error_message")

        status_icon = "[OK]" if status == "completed" else ("[RUNNING]" if status == "running" else "[ERROR]")
        print(f"{status_icon} #{rid} | {run_name} | Durum: {status.upper()} | Sure: {duration}s")
        print(f"    Tetikleyici: {trigger} | Hedef: {target} | Baslangic: {started}")
        print(f"    Eklenen: +{dramas} Seri | +{episodes} Bolum | +{sources} Kaynak")

        # Bot bazli ozet
        summary = r.get("scrapers_summary") or {}
        has_bot_errors = False
        if summary and isinstance(summary, dict):
            print("    Bot Durumlari:")
            for bot, info in summary.items():
                b_lbl = info.get("label", bot)
                b_stat = info.get("status", "unknown")
                b_err = info.get("error")
                b_eps = info.get("episodes_added", 0)
                b_src = info.get("sources_added", 0)
                b_dur = info.get("duration_seconds", 0)

                icon = "  * " if b_stat == "healthy" else ("  - " if b_stat == "disabled" else "  ! ")
                err_str = f" [HATA: {b_err}]" if b_err else ""
                if b_stat == "error":
                    has_bot_errors = True
                print(f"      {icon}{b_lbl}: {b_stat.upper()} ({b_dur}s, +{b_eps} bolum, +{b_src} kaynak){err_str}")

        if err_msg:
            print(f"    [GENEL HATA]: {err_msg}")

        # Detayli loglar
        logs = r.get("logs") or []
        if (verbose or has_bot_errors or err_msg or status == "failed") and logs:
            print(f"    Son Log Satirlari ({min(10, len(logs))} satir):")
            for l in logs[-10:]:
                print(f"      | {l}")

        print("-" * 80)

def inspect_local_logs(lines: int = 50):
    log_file = os.path.join(_ROOT, "logs", "automation.log")
    print(f"\n[Yerel Dosya] {log_file} kontrol ediliyor...", flush=True)
    if not os.path.exists(log_file):
        print(f"  Henuz yerel automation.log dosyasi olusturulmamis (otomasyon GitHub Actions bulutunda calisiyor olabilir).")
        return

    with open(log_file, "r", encoding="utf-8", errors="replace") as f:
        all_lines = f.readlines()

    print(f"Toplam {len(all_lines)} satir. Son {min(lines, len(all_lines))} satir gosteriliyor:\n" + "=" * 80)
    for l in all_lines[-lines:]:
        print(l.rstrip())
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(description="KoUp Otomasyon Log & Saglik Denetleyicisi")
    parser.add_argument("--limit", type=int, default=5, help="Sorgulanacak calisma sayisi (varsayilan: 5)")
    parser.add_argument("--verbose", action="store_true", help="Detayli calisma loglarini yazdir")
    parser.add_argument("--local", action="store_true", help="Yalnizca yerel log dosyasini oku")

    args = parser.parse_args()

    if args.local:
        inspect_local_logs()
    else:
        inspect_supabase_runs(limit=args.limit, verbose=args.verbose)
        if os.path.exists(os.path.join(_ROOT, "logs", "automation.log")):
            inspect_local_logs(lines=20)

if __name__ == '__main__':
    main()
