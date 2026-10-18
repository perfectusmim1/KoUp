import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os, json
import sqlite3
import requests

db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webdrama_archive.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. Update SQLite
cur.execute("SELECT count(*) FROM episode_sources WHERE direct_url LIKE '%youtube-nocookie.com%'")
cnt = cur.fetchone()[0]
print(f"Found {cnt} sources with youtube-nocookie.com in SQLite.")

if cnt > 0:
    cur.execute("UPDATE episode_sources SET direct_url = REPLACE(direct_url, 'youtube-nocookie.com', 'youtube.com') WHERE direct_url LIKE '%youtube-nocookie.com%'")
    conn.commit()
    print("Updated SQLite sources to use www.youtube.com.")

# 2. Update Supabase
SUPABASE_URL = "https://aocvcotmikzlwbaezdpl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk"
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Fetch episodes for Daha 17
m_resp = requests.get(f"{SUPABASE_URL}/rest/v1/media?slug=eq.daha-17&select=id", headers=headers)
if m_resp.ok and m_resp.json():
    mid = m_resp.json()[0]['id']
    ep_resp = requests.get(f"{SUPABASE_URL}/rest/v1/episodes?media_id=eq.{mid}&select=id,video_sources", headers=headers)
    if ep_resp.ok:
        for ep in ep_resp.json():
            sources = ep.get('video_sources') or []
            modified = False
            for s in sources:
                if 'youtube-nocookie.com' in s.get('direct_url', ''):
                    s['direct_url'] = s['direct_url'].replace('youtube-nocookie.com', 'youtube.com')
                    modified = True
                if 'youtube-nocookie.com' in s.get('embed_id', ''):
                    s['embed_id'] = s['embed_id'].replace('youtube-nocookie.com', 'youtube.com')
                    modified = True
            if modified:
                p_resp = requests.patch(
                    f"{SUPABASE_URL}/rest/v1/episodes?id=eq.{ep['id']}",
                    headers=headers,
                    json={"video_sources": sources}
                )
                print(f"Patched Supabase episode {ep['id']}: status {p_resp.status_code}")

print("YouTube URL cleanup complete!")
