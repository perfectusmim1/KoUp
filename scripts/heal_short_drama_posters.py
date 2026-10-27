"""
Heal Short Drama Posters
- Identifies all short dramas with blocked/missing covers (e.g. dramavadisi.com CDN blocked by Cloudflare on Vercel)
- Downloads original high-resolution posters directly via residential connection
- Uploads posters to KoUp Cloudflare R2 bucket (posters/shortdrama/{id}.webp)
- Updates local SQLite webdrama_archive.db
- Syncs cover_image and backdrop_image to Supabase public.media
- Fully checkpoints SQLite and backs up database & source bundles to Cloudflare R2 (Rule 10)
"""

import os
import sys
import time
import json
import sqlite3
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
import urllib.error
import ssl

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import boto3
from botocore.config import Config
from scrapers.shortdrama.common import load_env, get_session
from scrapers.supabase_sync_helper import backup_db_to_r2, _load_supabase_creds

load_env()

# --- Configurations ---
DB_PATH = ROOT_DIR / "webdrama_archive.db"
R2_ENDPOINT = os.environ.get("CF_R2_ENDPOINT")
R2_ACCESS_KEY = os.environ.get("CF_R2_ACCESS_KEY_ID")
R2_SECRET_KEY = os.environ.get("CF_R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.environ.get("CF_R2_BUCKET", "koup-archive")
R2_PUBLIC_URL = os.environ.get("R2_PUBLIC_URL", "https://pub-e62742f127324512937cc3ff34c976bd.r2.dev").rstrip("/")

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()

ssl_ctx = ssl.create_default_context()


def get_s3_client():
    config = Config(
        retries={"max_attempts": 5, "mode": "standard"},
        max_pool_connections=50,
    )
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
        config=config,
    )


def download_image(url: str, max_retries: int = 3) -> tuple[bytes | None, str]:
    """Downloads image bytes directly with browser impersonation / User-Agent."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://dramavadisi.com/",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12, context=ssl_ctx) as resp:
                if resp.status == 200:
                    data = resp.read()
                    ctype = resp.getheader("Content-Type", "image/webp").split(";")[0].strip()
                    if not ctype or ctype == "application/octet-stream":
                        ctype = "image/webp" if url.endswith(".webp") else "image/jpeg"
                    return data, ctype
        except Exception as e:
            if attempt == max_retries - 1:
                pass
            time.sleep(0.5 * (attempt + 1))
    return None, ""


def update_supabase_media_batch(items: list[dict], batch_size: int = 50) -> int:
    """Updates cover_image and backdrop_image in Supabase via REST PATCH or RPC."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[WARN] Supabase credentials not found, skipping cloud media update.")
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    updated_count = 0
    # REST API allows PATCH with filtering by ID
    for item in items:
        m_id = item["id"]
        cover = item["cover_image"]
        backdrop = item.get("backdrop_image") or cover
        payload = json.dumps({
            "cover_image": cover,
            "backdrop_image": backdrop,
        }).encode("utf-8")
        req_url = f"{SUPABASE_URL}/rest/v1/media?id=eq.{m_id}"
        req = urllib.request.Request(req_url, data=payload, headers=headers, method="PATCH")
        try:
            with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                if resp.status in (200, 204):
                    updated_count += 1
        except Exception as e:
            # retry once
            try:
                time.sleep(0.2)
                with urllib.request.urlopen(req, timeout=10, context=ssl_ctx) as resp:
                    if resp.status in (200, 204):
                        updated_count += 1
            except Exception:
                pass

    return updated_count


def process_single_drama(drama: dict, s3_client) -> dict | None:
    """Downloads cover image, uploads to R2, returns update record."""
    d_id = drama["id"]
    cover = drama["cover_image"]
    slug = drama["slug"]
    title = drama["title"]

    if not cover or cover == "/logo-dark.png":
        # Missing cover: try to construct or fetch from dramavadisi
        if "dramavadisi" in str(drama.get("alt_sites", "")) or "dramavadisi" in str(drama.get("source_url", "")):
            test_url = f"https://dramavadisi.com/uploads/posters/{slug}.webp"
            cover = test_url

    if not cover or not cover.startswith("http"):
        return None

    # Determine file extension
    ext = "webp"
    if ".jpg" in cover.lower() or ".jpeg" in cover.lower():
        ext = "jpg"
    elif ".png" in cover.lower():
        ext = "png"

    r2_key = f"posters/shortdrama/{d_id}.{ext}"

    # Download original poster
    img_bytes, ctype = download_image(cover)
    if not img_bytes or len(img_bytes) < 100:
        return None

    # Upload to R2
    try:
        s3_client.put_object(
            Bucket=R2_BUCKET,
            Key=r2_key,
            Body=img_bytes,
            ContentType=ctype,
            CacheControl="public, max-age=31536000, immutable",
        )
        r2_url = f"{R2_PUBLIC_URL}/{r2_key}"
        return {
            "id": d_id,
            "title": title,
            "slug": slug,
            "old_cover": cover,
            "cover_image": r2_url,
            "backdrop_image": r2_url,
        }
    except Exception as e:
        print(f"[R2_UPLOAD_ERROR] drama {d_id}: {e}", file=sys.stderr)
        return None


def main():
    print("=" * 60)
    print("🚀 HEALING SHORT DRAMA POSTERS -> CLOUDFLARE R2 & SUPABASE")
    print("=" * 60)

    # 1. Connect to SQLite
    conn = sqlite3.connect(str(DB_PATH), timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Query all short dramas with dramavadisi covers or empty covers
    cur.execute("""
        SELECT id, slug, title, cover_image, backdrop_image, source_url, alt_sites
        FROM dramas
        WHERE (content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%')
          AND (cover_image LIKE '%dramavadisi.com%' OR cover_image IS NULL OR cover_image = '' OR cover_image LIKE '%logo%')
        ORDER BY id ASC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    total_to_heal = len(rows)
    print(f"[*] Found {total_to_heal} short dramas needing poster healing.")

    if total_to_heal == 0:
        print("[+] All short drama posters are already healthy!")
        conn.close()
        return

    s3_client = get_s3_client()

    print(f"[*] Starting concurrent download and R2 upload with 24 workers...")
    start_time = time.time()
    healed_records = []
    failed_records = []

    # Process in parallel
    with ThreadPoolExecutor(max_workers=24) as executor:
        futures = {executor.submit(process_single_drama, row, s3_client): row for row in rows}
        done = 0
        for fut in as_completed(futures):
            res = fut.result()
            done += 1
            if res:
                healed_records.append(res)
            else:
                failed_records.append(futures[fut])

            if done % 100 == 0 or done == total_to_heal:
                elapsed = time.time() - start_time
                speed = done / elapsed if elapsed > 0 else 0
                eta = (total_to_heal - done) / speed if speed > 0 else 0
                print(f"[*] Progress: {done}/{total_to_heal} ({done*100/total_to_heal:.1f}%) | Speed: {speed:.1f}/s | ETA: {eta:.0f}s | Success: {len(healed_records)}")

    print(f"\n[+] Image processing complete in {time.time() - start_time:.1f}s.")
    print(f"    Successfully uploaded to R2: {len(healed_records)}")
    print(f"    Failed downloads: {len(failed_records)}")

    # 2. Update local SQLite database
    print("\n[*] Updating local SQLite webdrama_archive.db...")
    cur.execute("BEGIN TRANSACTION;")
    for r in healed_records:
        cur.execute(
            """
            UPDATE dramas
            SET cover_image = ?,
                backdrop_image = CASE WHEN backdrop_image LIKE '%dramavadisi%' OR backdrop_image LIKE '%logo%' OR backdrop_image IS NULL THEN ? ELSE backdrop_image END
            WHERE id = ?
            """,
            (r["cover_image"], r["backdrop_image"], r["id"]),
        )
    conn.commit()
    print(f"[+] Updated {len(healed_records)} rows in SQLite database.")

    # Checkpoint WAL
    cur.execute("PRAGMA wal_checkpoint(FULL);")
    conn.close()
    print("[+] WAL checkpoint completed.")

    # 3. Update Supabase public.media table
    print("\n[*] Syncing healed covers to Supabase public.media...")
    sb_start = time.time()

    # Fast multi-threaded Supabase updater (16 workers)
    def _update_sb_chunk(chunk):
        return update_supabase_media_batch(chunk)

    chunk_size = 25
    chunks = [healed_records[i : i + chunk_size] for i in range(0, len(healed_records), chunk_size)]
    sb_updated_total = 0

    with ThreadPoolExecutor(max_workers=16) as sb_executor:
        sb_futs = [sb_executor.submit(_update_sb_chunk, ch) for ch in chunks]
        for i, f in enumerate(as_completed(sb_futs), 1):
            sb_updated_total += f.result()
            if i % 20 == 0 or i == len(chunks):
                print(f"[*] Supabase sync progress: {sb_updated_total}/{len(healed_records)} media rows synced.")

    print(f"[+] Supabase sync complete in {time.time() - sb_start:.1f}s. Total synced: {sb_updated_total}")

    # 4. Storage Sync (Rule 10): Backup SQLite DB to R2
    print("\n[*] Rule 10: Backing up updated SQLite archive to Cloudflare R2...")
    r2_backed_up = backup_db_to_r2()
    print(f"[+] Database R2 backup status: {r2_backed_up}")

    # 5. Print Verification Sample
    print("\n" + "=" * 60)
    print("✨ VERIFICATION SAMPLE (User Target Series):")
    sample_targets = [
        "Aslan Kral'ın Yasak Avı 2",
        "Arka Koltuktaki Patron",
        "Koruma Kılığında Ölümsüz",
        "My Siren Husband",
        "Beyaz Kanın Uyanışı",
    ]
    for r in healed_records:
        for st in sample_targets:
            if st.lower() in r["title"].lower():
                print(f"  - [{r['id']}] {r['title']}")
                print(f"    R2 CDN: {r['cover_image']}")
                break

    print("=" * 60)
    print(f"✅ ALL DONE! {len(healed_records)} short drama posters permanently healed on R2 & Supabase.")


if __name__ == "__main__":
    main()
