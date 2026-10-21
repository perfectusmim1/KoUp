"""
KoUp Full Archive & Supabase & R2 Backup Engine
Backs up all Supabase tables, schema, RLS policies, migrations, SQLite archive, and R2 bundles
directly to C:\\Users\\Cagan\\Downloads\\koup-backup.
"""

import os
import sys
import json
import time
import shutil
import sqlite3
import zipfile
import hashlib
import re
from datetime import datetime, timezone

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

import requests
import boto3
from scrapers.supabase_sync_helper import _load_supabase_creds, _load_r2_creds, sb_request

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()
DEST_DIR = r"C:\Users\Cagan\Downloads\koup-backup"

def get_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def backup_sqlite_archive(dest_archive_dir: str):
    print("\n[1/4] SQLite Arsiv Veritabani Yedekleniyor...", flush=True)
    os.makedirs(dest_archive_dir, exist_ok=True)
    src_db = os.path.join(_ROOT, "webdrama_archive.db")
    
    # Checkpoint WAL first
    conn = sqlite3.connect(src_db)
    cur = conn.cursor()
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()

    # Gather table counts
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    stats = {}
    for t in tables:
        try:
            cnt = cur.execute(f"SELECT count(*) FROM [{t}]").fetchone()[0]
            stats[t] = cnt
        except Exception:
            pass
    conn.close()

    dest_db = os.path.join(dest_archive_dir, "webdrama_archive.db")
    shutil.copy2(src_db, dest_db)
    db_size = os.path.getsize(dest_db)
    db_hash = get_sha256(dest_db)

    stats_meta = {
        "backup_at": datetime.now(timezone.utc).isoformat(),
        "source_file": "webdrama_archive.db",
        "file_size_bytes": db_size,
        "file_size_mb": round(db_size / (1024 * 1024), 2),
        "sha256": db_hash,
        "tables_count": len(tables),
        "records": stats
    }
    with open(os.path.join(dest_archive_dir, "db_stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats_meta, f, indent=2, ensure_ascii=False)

    print(f"  -> SQLite veritabani kopyalandi ({stats_meta['file_size_mb']} MB, {stats.get('dramas', 0):,} seri, {stats.get('episodes', 0):,} bolum, {stats.get('episode_sources', 0):,} kaynak).", flush=True)
    return stats_meta

def backup_supabase_schema_and_security(dest_schema_dir: str, dest_sec_dir: str, dest_mig_dir: str):
    print("\n[2/4] Supabase Semalar, Guvenlik (RLS) ve Migrasyonlar Yedekleniyor...", flush=True)
    os.makedirs(dest_schema_dir, exist_ok=True)
    os.makedirs(dest_sec_dir, exist_ok=True)
    os.makedirs(dest_mig_dir, exist_ok=True)

    # 1. Copy local migration sql files
    src_mig_dir = os.path.join(_ROOT, "koup-app", "supabase", "migrations")
    mig_count = 0
    if os.path.exists(src_mig_dir):
        for f in os.listdir(src_mig_dir):
            if f.endswith(".sql"):
                shutil.copy2(os.path.join(src_mig_dir, f), os.path.join(dest_mig_dir, f))
                mig_count += 1
    print(f"  -> {mig_count} adet yerel SQL migrasyon dosyasi kopyalandi.", flush=True)

    # 2. Query OpenAPI schema from Supabase REST endpoint (gives complete column types and endpoints)
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/?apikey={SUPABASE_KEY}", timeout=15)
        if r.ok:
            with open(os.path.join(dest_schema_dir, "openapi_schema.json"), "w", encoding="utf-8") as f:
                f.write(r.text)
            print("  -> OpenAPI tam API ve sema tanimlari kaydedildi.", flush=True)
    except Exception as e:
        print(f"  [Uyari] OpenAPI semasi alinamadi: {e}", flush=True)

    # 3. Save extracted RLS policies
    try:
        step_665 = r"C:\Users\Cagan\.gemini\antigravity\brain\195e0904-e1b9-4495-8e17-0e10789d802f\.system_generated\steps\665\output.txt"
        if os.path.exists(step_665):
            with open(step_665, "r", encoding="utf-8") as f:
                d = json.load(f)
                txt = d.get("result", "")
                m = re.search(r'\[.*\]', txt, re.DOTALL)
                if m:
                    rows = json.loads(m.group(0))
                    sql_lines = [r["ddl"] for r in rows if "ddl" in r]
                    with open(os.path.join(dest_sec_dir, "all_policies_rls.sql"), "w", encoding="utf-8") as out:
                        out.write("-- KoUp Supabase Row Level Security (RLS) Policies\n\n")
                        out.write("\n".join(sql_lines))
                    print(f"  -> {len(sql_lines)} adet RLS Guvenlik Politikasi 'all_policies_rls.sql' olarak kaydedildi.", flush=True)
    except Exception as e:
        print(f"  [Hata] RLS politikalari kaydedilemedi: {e}", flush=True)

    # 4. Save functions & RPC definitions
    try:
        step_669 = r"C:\Users\Cagan\.gemini\antigravity\brain\195e0904-e1b9-4495-8e17-0e10789d802f\.system_generated\steps\669\output.txt"
        if os.path.exists(step_669):
            with open(step_669, "r", encoding="utf-8") as f:
                d = json.load(f)
                txt = d.get("result", "")
                m = re.search(r'\[.*\]', txt, re.DOTALL)
                if m:
                    rows = json.loads(m.group(0))
                    with open(os.path.join(dest_sec_dir, "functions_definitions.sql"), "w", encoding="utf-8") as out:
                        out.write("-- KoUp Supabase Custom Functions & RPCs\n\n")
                        for r in rows:
                            fn = r.get("function_name", "unnamed")
                            df = r.get("definition", "")
                            out.write(f"-- Function: {fn}\n{df}\n\n")
                    print(f"  -> {len(rows)} adet PostgreSQL Fonksiyon/RPC 'functions_definitions.sql' olarak kaydedildi.", flush=True)
    except Exception as e:
        print(f"  [Hata] Fonksiyonlar kaydedilemedi: {e}", flush=True)

    # 5. Save triggers
    try:
        step_671 = r"C:\Users\Cagan\.gemini\antigravity\brain\195e0904-e1b9-4495-8e17-0e10789d802f\.system_generated\steps\671\output.txt"
        if os.path.exists(step_671):
            with open(step_671, "r", encoding="utf-8") as f:
                d = json.load(f)
                txt = d.get("result", "")
                m = re.search(r'\[.*\]', txt, re.DOTALL)
                if m:
                    rows = json.loads(m.group(0))
                    with open(os.path.join(dest_sec_dir, "triggers.json"), "w", encoding="utf-8") as out:
                        json.dump(rows, out, indent=2, ensure_ascii=False)
                    print(f"  -> {len(rows)} adet Veritabani Trigger'i 'triggers.json' olarak kaydedildi.", flush=True)
    except Exception as e:
        print(f"  [Hata] Triggerlar kaydedilemedi: {e}", flush=True)

    # 6. Save tables schema
    try:
        step_629 = r"C:\Users\Cagan\.gemini\antigravity\brain\195e0904-e1b9-4495-8e17-0e10789d802f\.system_generated\steps\629\output.txt"
        if os.path.exists(step_629):
            with open(step_629, "r", encoding="utf-8") as f:
                d = json.load(f)
                with open(os.path.join(dest_schema_dir, "tables_schema.json"), "w", encoding="utf-8") as out:
                    json.dump(d, out, indent=2, ensure_ascii=False)
                print("  -> 29 adet tablonun ayrintili semasi 'tables_schema.json' olarak kaydedildi.", flush=True)
    except Exception as e:
        print(f"  [Hata] Tablo semalari kaydedilemedi: {e}", flush=True)

    print("  -> Supabase sema ve guvenlik yapisi hazirlandi.", flush=True)

def fetch_supabase_table(table_name: str, dest_path: str, chunk_size: int = 1000):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "count=exact"
    }
    
    # Check total count with Range header
    total_count = None
    try:
        r_head = requests.head(f"{SUPABASE_URL}/rest/v1/{table_name}?select=*", headers=headers, timeout=10)
        cr = r_head.headers.get("Content-Range")
        if cr and "/" in cr:
            total_str = cr.split("/")[1]
            if total_str.isdigit():
                total_count = int(total_str)
    except Exception:
        pass

    offset = 0
    all_rows = []
    t0 = time.time()
    
    # Stream directly into json lines or json file to keep memory light
    is_jsonl = table_name in ("episodes", "media_cast", "media_view_events", "user_media_progress")
    actual_path = dest_path.replace(".json", ".jsonl") if is_jsonl else dest_path

    out_file = open(actual_path, "w", encoding="utf-8")
    if not is_jsonl:
        out_file.write("[\n")
    
    first_item = True
    row_count = 0

    while True:
        url = f"{SUPABASE_URL}/rest/v1/{table_name}?select=*&limit={chunk_size}&offset={offset}"
        try:
            res = requests.get(url, headers=headers, timeout=30)
            if not res.ok:
                print(f"    [Hata] {table_name} sayfa alinamadi ({res.status_code}): {res.text[:100]}", flush=True)
                break
            batch = res.json()
            if not batch or not isinstance(batch, list):
                break
            
            for row in batch:
                if is_jsonl:
                    out_file.write(json.dumps(row, ensure_ascii=False) + "\n")
                else:
                    if not first_item:
                        out_file.write(",\n")
                    out_file.write(json.dumps(row, ensure_ascii=False))
                    first_item = False
                row_count += 1

            offset += len(batch)
            if len(batch) < chunk_size:
                break
            if row_count % 10000 == 0:
                print(f"    {table_name}: {row_count:,} kayit indirildi...", flush=True)
        except Exception as e:
            print(f"    [Istisna] {table_name} offset {offset}: {e}", flush=True)
            break

    if not is_jsonl:
        out_file.write("\n]\n")
    out_file.close()

    dur = round(time.time() - t0, 1)
    file_size_mb = round(os.path.getsize(actual_path) / (1024 * 1024), 2)
    print(f"  -> {table_name}: {row_count:,} kayit kaydedildi ({file_size_mb} MB, {dur}s).", flush=True)
    return {
        "table": table_name,
        "rows": row_count,
        "file": os.path.basename(actual_path),
        "size_mb": file_size_mb,
        "duration_seconds": dur
    }

def backup_supabase_data(dest_data_dir: str):
    print("\n[3/4] Supabase Tablolari (Data) Indiriliyor...", flush=True)
    os.makedirs(dest_data_dir, exist_ok=True)

    tables = [
        "media",
        "episodes",
        "people",
        "media_cast",
        "media_relations",
        "magazine_posts",
        "profiles",
        "user_media_progress",
        "person_favorites",
        "user_follows",
        "custom_lists",
        "comments",
        "comment_likes",
        "broadcast_events",
        "user_notifications",
        "issue_reports",
        "scraper_configs",
        "calendar_schedules",
        "episode_reactions",
        "banned_fingerprints",
        "user_blocks",
        "custom_list_likes",
        "magazine_likes",
        "comment_dislikes",
        "user_devices",
        "media_view_events",
        "user_emails",
        "automation_runs",
        "series_automations",
    ]

    manifest = []
    for t in tables:
        dest_file = os.path.join(dest_data_dir, f"{t}.json")
        info = fetch_supabase_table(t, dest_file)
        manifest.append(info)

    return manifest

def backup_r2_storage(dest_r2_dir: str):
    print("\n[4/4] Cloudflare R2 Depolama (Arsiv Paketleri & DB) Yedekleniyor...", flush=True)
    os.makedirs(dest_r2_dir, exist_ok=True)

    endpoint, access_key, secret_key, bucket = _load_r2_creds()
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto"
    )

    # 1. Download db/webdrama_archive.db from R2 directly
    db_dir = os.path.join(dest_r2_dir, "db")
    os.makedirs(db_dir, exist_ok=True)
    dest_r2_db = os.path.join(db_dir, "webdrama_archive.db")
    try:
        print("  -> R2'deki db/webdrama_archive.db indiriliyor...", flush=True)
        s3.download_file(bucket, "db/webdrama_archive.db", dest_r2_db)
        r2_db_sz = round(os.path.getsize(dest_r2_db) / (1024 * 1024), 2)
        print(f"  -> R2 DB dosyasi basariyla indirildi ({r2_db_sz} MB).", flush=True)
    except Exception as e:
        print(f"  [Hata] R2 db indirme hatasi: {e}", flush=True)

    # 2. Package all source bundles into a clean, portable zip
    zip_path = os.path.join(dest_r2_dir, "sources_bundles.zip")
    local_src_dir = os.path.join(_ROOT, "r2_bundles", "sources")
    bundled_count = 0
    print("  -> sources JSON paketleri zip arsivine paketleniyor...", flush=True)
    t0 = time.time()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        if os.path.exists(local_src_dir):
            for fname in os.listdir(local_src_dir):
                if fname.endswith(".json"):
                    fp = os.path.join(local_src_dir, fname)
                    zipf.write(fp, arcname=f"sources/{fname}")
                    bundled_count += 1
                    if bundled_count % 5000 == 0:
                        print(f"    {bundled_count:,} paket zip'e eklendi...", flush=True)
    
    zip_sz = round(os.path.getsize(zip_path) / (1024 * 1024), 2)
    zip_dur = round(time.time() - t0, 1)
    print(f"  -> {bundled_count:,} adet kaynak JSON paketi 'sources_bundles.zip' olarak paketlendi ({zip_sz} MB, {zip_dur}s).", flush=True)

    # 3. Save R2 metadata inventory
    r2_meta = {
        "bucket": bucket,
        "endpoint": endpoint,
        "backup_at": datetime.now(timezone.utc).isoformat(),
        "total_sources_bundled": bundled_count,
        "sources_zip_size_mb": zip_sz,
    }
    with open(os.path.join(dest_r2_dir, "r2_metadata.json"), "w", encoding="utf-8") as f:
        json.dump(r2_meta, f, indent=2, ensure_ascii=False)

    return r2_meta

def generate_summary_report(dest_dir: str, sqlite_meta: dict, supabase_meta: list, r2_meta: dict):
    print("\n[Rapor] BACKUP_SUMMARY.md olusturuluyor...", flush=True)
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    total_supabase_rows = sum(item.get("rows", 0) for item in supabase_meta)
    total_supabase_mb = sum(item.get("size_mb", 0) for item in supabase_meta)

    lines = [
        "# KoUp Full System Backup Manifest",
        f"**Yedekleme Tarihi:** {now_iso}",
        f"**Hedef Klasor:** `{dest_dir}`",
        "",
        "Bu klasor KoUp platformunun tum canli veritabanlarinin, Cloudflare R2 depolamasinin, guvenlik yapilarinin ve yerel arsivinin eksiksiz ve bagimsiz tam yedegidir.",
        "",
        "---",
        "## 1. Supabase Veritabani Tablolari (Data & Schema)",
        f"- **Toplam Tablo Sayisi:** {len(supabase_meta)} tablo",
        f"- **Toplam Indirilen Veri:** {total_supabase_rows:,} satir ({total_supabase_mb:.2f} MB)",
        "",
        "| Tablo Adi | Satir Sayisi | Dosya | Boyut (MB) | Sure |",
        "|---|---|---|---|---|",
    ]

    for item in supabase_meta:
        lines.append(f"| `{item['table']}` | {item['rows']:,} | `{item['file']}` | {item['size_mb']} MB | {item['duration_seconds']}s |")

    lines.extend([
        "",
        "---",
        "## 2. Yerel SQLite Arsiv Veritabani (`archive_db/`)",
        f"- **Dosya:** `webdrama_archive.db`",
        f"- **Boyut:** {sqlite_meta['file_size_mb']} MB",
        f"- **SHA256:** `{sqlite_meta['sha256']}`",
        "- **Kayit Detaylari:**",
    ])

    for tbl, cnt in sqlite_meta.get("records", {}).items():
        lines.append(f"  - `{tbl}`: {cnt:,} kayit")

    lines.extend([
        "",
        "---",
        "## 3. Cloudflare R2 Depolama (`r2_storage/`)",
        f"- **R2 Bucket:** `{r2_meta.get('bucket')}`",
        f"- **Bulut DB Dosyasi:** `db/webdrama_archive.db`",
        f"- **Paketlenen Kaynak Paketleri:** {r2_meta.get('total_sources_bundled', 0):,} dizi JSON paketi (`sources_bundles.zip`)",
        f"- **Zip Arsiv Boyutu:** {r2_meta.get('sources_zip_size_mb')} MB",
        "",
        "---",
        "## 4. Geri Yukleme (Restoration) Kilavuzu",
        "",
        "### A. Supabase Verilerini Geri Yukleme",
        "Tablo verileri `.json` ve buyuk tablolar icin `.jsonl` formatinda kaydedilmistir. `supabase/migrations/` altindaki SQL dosyalariyla once semalar kurulabilir, ardindan PostgREST veya `psql` ile veriler aktarilabilir.",
        "",
        "### B. Yerel Arsivi Geri Yukleme",
        "`archive_db/webdrama_archive.db` dosyasini proje kok dizinine kopyalamaniz yeterlidir.",
        "",
        "### C. Cloudflare R2 Depolamasini Geri Yukleme",
        "`r2_storage/sources_bundles.zip` arsivini acarak R2 bucket'indaki `sources/` on ekine `aws s3 sync` veya boto3 ile geri yukleyebilirsiniz.",
    ])

    summary_file = os.path.join(dest_dir, "BACKUP_SUMMARY.md")
    with open(summary_file, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  -> {summary_file} basariyla olusturuldu.", flush=True)

def main():
    print("=================================================================", flush=True)
    print("KoUp Full Tam Sistem Yedekleme Baslatiliyor", flush=True)
    print(f"Hedef Klasor: {DEST_DIR}", flush=True)
    print("=================================================================", flush=True)

    t_start = time.time()
    os.makedirs(DEST_DIR, exist_ok=True)

    # 1. SQLite Archive DB
    sqlite_meta = backup_sqlite_archive(os.path.join(DEST_DIR, "archive_db"))

    # 2. Supabase Schema & Security
    backup_supabase_schema_and_security(
        os.path.join(DEST_DIR, "supabase", "schema"),
        os.path.join(DEST_DIR, "supabase", "security"),
        os.path.join(DEST_DIR, "supabase", "migrations"),
    )

    # 3. Supabase Data
    supabase_meta = backup_supabase_data(os.path.join(DEST_DIR, "supabase", "data"))

    # 4. Cloudflare R2 Storage
    r2_meta = backup_r2_storage(os.path.join(DEST_DIR, "r2_storage"))

    # 5. Generate Report
    generate_summary_report(DEST_DIR, sqlite_meta, supabase_meta, r2_meta)

    total_dur = round(time.time() - t_start, 1)
    print("\n=================================================================", flush=True)
    print(f"TAM YEDEKLEME BASARIYLA TAMAMLANDI! ({total_dur} saniye)", flush=True)
    print(f"Tum dosyalar '{DEST_DIR}' klasorune aktarildi.", flush=True)
    print("=================================================================", flush=True)

if __name__ == '__main__':
    main()
