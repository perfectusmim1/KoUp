import sqlite3
import requests
import json
import os
import boto3
from botocore.config import Config

# 1. Purge Pale Moon (15278) from SQLite
conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

drama_id = 15278
print(f"Purging Pale Moon (ID: {drama_id}) from SQLite...")
cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (drama_id,))
cur.execute("DELETE FROM episodes WHERE drama_id = ?", (drama_id,))
cur.execute("DELETE FROM dramas WHERE id = ?", (drama_id,))
conn.commit()
print("Purged from SQLite!")

# 2. Purge from Cloudflare R2
with open('koup-app/.env.local', 'r', encoding='utf-8') as f:
    env = dict(line.strip().split('=', 1) for line in f if '=' in line and not line.startswith('#'))

account_id = env.get('R2_ACCOUNT_ID')
access_key = env.get('R2_ACCESS_KEY_ID')
secret_key = env.get('R2_SECRET_ACCESS_KEY')
bucket_name = env.get('R2_BUCKET_NAME')

if account_id and access_key and secret_key and bucket_name:
    s3 = boto3.client(
        's3',
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version='s3v4'),
        region_name='auto',
    )
    r2_key = f"sources/{drama_id}.json"
    try:
        s3.delete_object(Bucket=bucket_name, Key=r2_key)
        print(f"Deleted {r2_key} from R2!")
    except Exception as e:
        print(f"R2 delete error: {e}")
