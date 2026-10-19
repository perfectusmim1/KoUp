import sqlite3
import os
import sys
import time
import boto3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request, _load_r2_creds

def run_purge():
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()

    print("[PURGE] Finding all dramas/movies with ZERO playable sources across all episodes...", flush=True)

    cur.execute("""
        SELECT d.id, d.title, d.slug, d.content_type,
               (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count,
               (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) as src_count
        FROM dramas d
        WHERE (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) = 0
    """)
    zero_source_rows = cur.fetchall()

    print(f"[PURGE] Identified {len(zero_source_rows)} dramas/movies with ZERO sources.", flush=True)
    if not zero_source_rows:
        print("[PURGE] No zero-source dramas found. Archive is 100% clean!")
        conn.close()
        return

    all_ids = [r[0] for r in zero_source_rows]
    start_time = time.time()

    # 1. Purge from SQLite
    print(f"[PURGE] Deleting {len(all_ids)} records from SQLite (episodes, sources, dramas)...", flush=True)
    chunk_size = 500
    for i in range(0, len(all_ids), chunk_size):
        chunk = all_ids[i:i+chunk_size]
        placeholders = ",".join("?" for _ in chunk)
        cur.execute(f"DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id IN ({placeholders}))", chunk)
        cur.execute(f"DELETE FROM episodes WHERE drama_id IN ({placeholders})", chunk)
        cur.execute(f"DELETE FROM dramas WHERE id IN ({placeholders})", chunk)
        conn.commit()

    conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()
    print(f"[PURGE] SQLite records deleted.", flush=True)

    # 2. Batch Purge from Supabase
    print(f"[PURGE] Batch deleting from Supabase (media and episodes)...", flush=True)
    sb_chunk = 60
    for i in range(0, len(all_ids), sb_chunk):
        chunk = all_ids[i:i+sb_chunk]
        id_filter = f"in.({','.join(str(x) for x in chunk)})"
        try:
            sb_request("DELETE", f"/rest/v1/episodes?media_id={id_filter}")
            sb_request("DELETE", f"/rest/v1/media?id={id_filter}")
        except Exception as e:
            print(f"[PURGE-SUPABASE] Warning on chunk {i}: {e}", flush=True)
        if (i // sb_chunk) % 5 == 0:
            print(f"  Supabase purged {min(i+sb_chunk, len(all_ids))}/{len(all_ids)}...", flush=True)

    # 3. Batch Purge from Cloudflare R2
    print(f"[PURGE] Batch deleting bundle JSONs from Cloudflare R2...", flush=True)
    endpoint, access_key, secret_key, bucket = _load_r2_creds()
    if endpoint and access_key and secret_key and bucket:
        try:
            s3 = boto3.client(
                's3',
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name='auto'
            )
            r2_chunk = 500
            for i in range(0, len(all_ids), r2_chunk):
                chunk = all_ids[i:i+r2_chunk]
                delete_keys = [{'Key': f"sources/{did}.json"} for did in chunk]
                try:
                    s3.delete_objects(Bucket=bucket, Delete={'Objects': delete_keys})
                except Exception as e:
                    print(f"[PURGE-R2] Warning on chunk {i}: {e}", flush=True)
        except Exception as e:
            print(f"[PURGE-R2] Init error: {e}", flush=True)

    print(f"\n[PURGE COMPLETE] Cleanly purged {len(all_ids)} zero-source series and movies from SQLite, Supabase, and R2 in {time.time()-start_time:.1f}s!", flush=True)

if __name__ == '__main__':
    run_purge()
