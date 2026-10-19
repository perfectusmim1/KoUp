import os
import glob
import time
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
import boto3
from botocore.config import Config

R2_ENDPOINT = os.getenv("CF_R2_ENDPOINT", "https://03a5ec82372e5d09633fa832dbcef3dc.r2.cloudflarestorage.com")
R2_ACCESS_KEY = os.getenv("CF_R2_ACCESS_KEY_ID", "")
R2_SECRET_KEY = os.getenv("CF_R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("CF_R2_BUCKET", "koup-archive")

SOURCES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "r2_bundles", "sources")

def get_s3_client():
    config = Config(
        retries={'max_attempts': 5, 'mode': 'standard'},
        max_pool_connections=50
    )
    return boto3.client(
        's3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name='auto',
        config=config
    )

def upload_file(s3_client, local_path, s3_key):
    try:
        s3_client.upload_file(
            local_path,
            R2_BUCKET,
            s3_key,
            ExtraArgs={
                'ContentType': 'application/json',
                'CacheControl': 'public, max-age=604800, stale-while-revalidate=86400'
            }
        )
        return True, s3_key, None
    except Exception as e:
        return False, s3_key, str(e)

def main():
    print(f"Checking sources directory: {SOURCES_DIR}")
    if not os.path.exists(SOURCES_DIR):
        print(f"ERROR: Directory not found: {SOURCES_DIR}")
        sys.exit(1)

    files = glob.glob(os.path.join(SOURCES_DIR, "*.json"))
    total_files = len(files)
    print(f"Found {total_files} JSON bundle files to upload to R2 bucket '{R2_BUCKET}'...")

    if total_files == 0:
        print("No files found!")
        return

    s3 = get_s3_client()
    
    # Test connection
    print("Testing connection to R2...")
    try:
        resp = s3.list_objects_v2(Bucket=R2_BUCKET, Prefix='sources/', MaxKeys=5)
        print(f"Connection OK. Bucket currently has {resp.get('KeyCount', 0)} sample objects under sources/.")
    except Exception as e:
        print(f"Connection failed: {e}")
        sys.exit(1)

    start_time = time.time()
    uploaded_count = 0
    failed_count = 0

    print(f"Starting parallel upload with 30 worker threads...")
    with ThreadPoolExecutor(max_workers=30) as executor:
        futures = {}
        for fpath in files:
            fname = os.path.basename(fpath)
            s3_key = f"sources/{fname}"
            fut = executor.submit(upload_file, s3, fpath, s3_key)
            futures[fut] = fname

        for i, fut in enumerate(as_completed(futures), 1):
            success, key, err = fut.result()
            if success:
                uploaded_count += 1
            else:
                failed_count += 1
                if failed_count <= 5:
                    print(f"\n[FAIL] {key}: {err}")

            if i % 1000 == 0 or i == total_files:
                elapsed = time.time() - start_time
                rate = uploaded_count / elapsed if elapsed > 0 else 0
                remaining = (total_files - i) / rate if rate > 0 else 0
                print(f"Progress: {i}/{total_files} ({i*100.0/total_files:.1f}%) | Speed: {rate:.1f} files/s | ETA: {remaining:.0f}s | Success: {uploaded_count} | Failed: {failed_count}")

    total_time = time.time() - start_time
    print(f"\n==========================================")
    print(f"Upload Complete!")
    print(f"Total files: {total_files}")
    print(f"Uploaded successfully: {uploaded_count}")
    print(f"Failed: {failed_count}")
    print(f"Total time: {total_time:.1f} seconds (average {uploaded_count/total_time:.1f} files/sec)")
    print(f"==========================================")

if __name__ == '__main__':
    main()
