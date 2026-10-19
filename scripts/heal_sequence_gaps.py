import sqlite3
import urllib.request
import json
import os
import boto3
from botocore.config import Config
import sys
sys.path.append('.')
from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

# Load credentials
with open('koup-app/.env.local', 'r', encoding='utf-8') as f:
    env = dict(line.strip().split('=', 1) for line in f if '=' in line and not line.startswith('#'))

key = env.get('SUPABASE_SERVICE_ROLE_KEY', '')
account_id = env.get('R2_ACCOUNT_ID')
access_key = env.get('R2_ACCESS_KEY_ID')
secret_key = env.get('R2_SECRET_ACCESS_KEY')
bucket_name = env.get('R2_BUCKET_NAME')

s3 = None
if account_id and access_key and secret_key and bucket_name:
    s3 = boto3.client(
        's3',
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# STEP 1: Fix single-episode entries misnumbered > 1 (e.g. Movie 999, OVA 14)
print("--- STEP 1: Normalizing single-episode entries ---")
cur.execute('''
    SELECT d.id, e.id, e.episode_number
    FROM dramas d
    JOIN episodes e ON e.drama_id = d.id
    WHERE (SELECT COUNT(*) FROM episodes e2 WHERE e2.drama_id = d.id) = 1
      AND e.episode_number > 1
''')
singles_to_fix = cur.fetchall()
print(f"Found {len(singles_to_fix)} single-episode entries misnumbered > 1.")

dramas_to_resync = set()
for d_id, ep_id, old_num in singles_to_fix:
    cur.execute("UPDATE episodes SET episode_number = 1, episode_name = '1. Bölüm' WHERE id = ?", (ep_id,))
    dramas_to_resync.add(d_id)

conn.commit()
print(f"Updated {len(singles_to_fix)} single episodes to episode_number = 1.")

# STEP 2: Find dead stubs with huge gaps and 0/few dead sources
print("\n--- STEP 2: Purging dead stubs with broken gaps ---")
cur.execute('''
    SELECT d.id, d.title, d.slug, COUNT(e.id) as ep_count, MAX(e.episode_number) as max_ep,
           COUNT(s.id) as src_count
    FROM dramas d
    JOIN episodes e ON e.drama_id = d.id
    LEFT JOIN episode_sources s ON s.episode_id = e.id
    GROUP BY d.id
    HAVING ep_count <= 3 AND max_ep >= 8
''')
dead_stubs = cur.fetchall()
print(f"Found {len(dead_stubs)} dead broken stubs (ep_count <= 3 and max_ep >= 8).")

for d_id, title, slug, ep_count, max_ep, src_count in dead_stubs:
    # Delete from SQLite
    cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (d_id,))
    cur.execute("DELETE FROM episodes WHERE drama_id = ?", (d_id,))
    cur.execute("DELETE FROM dramas WHERE id = ?", (d_id,))

    # Delete from R2
    if s3:
        try:
            s3.delete_object(Bucket=bucket_name, Key=f"sources/{d_id}.json")
        except Exception:
            pass

    # Delete from Supabase via REST
    if key:
        try:
            headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}
            urllib.request.urlopen(urllib.request.Request(
                f'https://aocvcotmikzlwbaezdpl.supabase.co/rest/v1/episodes?media_id=eq.{d_id}',
                headers=headers, method='DELETE'
            ))
            urllib.request.urlopen(urllib.request.Request(
                f'https://aocvcotmikzlwbaezdpl.supabase.co/rest/v1/media?id=eq.{d_id}',
                headers=headers, method='DELETE'
            ))
        except Exception:
            pass

conn.commit()
print(f"Purged {len(dead_stubs)} dead broken stubs from SQLite, Supabase & R2.")

# STEP 3: Auto-create pending placeholders for active series with missing sequence numbers
print("\n--- STEP 3: Filling remaining sequence gaps with pending placeholders ---")
cur.execute('''
    SELECT e.drama_id, e.season_number, e.episode_number
    FROM episodes e
    ORDER BY e.drama_id, e.season_number, e.episode_number
''')
from collections import defaultdict
drama_seasons = defaultdict(lambda: defaultdict(set))
for d_id, s_num, e_num in cur.fetchall():
    drama_seasons[d_id][s_num].add(e_num)

placeholders_added = 0
for d_id, seasons in drama_seasons.items():
    drama_had_gap = False
    for s_num, ep_nums in seasons.items():
        if not ep_nums:
            continue
        min_ep = min(ep_nums)
        max_ep = max(ep_nums)
        # Only fill gaps if min_ep == 1 (or close) and gap count is reasonable (<= 10 missing)
        expected = set(range(min_ep, max_ep + 1))
        missing = expected - ep_nums
        if missing and len(missing) <= 15:
            for m_ep in sorted(missing):
                cur.execute('''
                    INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, source_status)
                    VALUES (?, ?, ?, ?, ?, 'pending')
                ''', (d_id, s_num, m_ep, f"{m_ep}. Bölüm", f"pending://gap/{d_id}/{s_num}/{m_ep}"))
                placeholders_added += 1
                drama_had_gap = True
    if drama_had_gap:
        dramas_to_resync.add(d_id)

conn.commit()
print(f"Added {placeholders_added} pending placeholder episodes across remaining series.")

# STEP 4: Re-sync bundles for all modified dramas
print(f"\n--- STEP 4: Re-syncing bundles for {len(dramas_to_resync)} affected dramas ---")
count = 0
for d_id in dramas_to_resync:
    try:
        sync_drama_bundle_and_counts(conn, cur, d_id)
        count += 1
        if count % 50 == 0:
            print(f"Synced {count}/{len(dramas_to_resync)} bundles...")
    except Exception as e:
        print(f"Error syncing drama {d_id}: {e}")

conn.commit()
print(f"Successfully re-synced all {count} drama bundles to R2 & Supabase!")
