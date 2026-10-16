import sqlite3
import json
import sys
import os
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")

print(f"Connecting to {DB_PATH}")
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

print("\n--- SQLite Tables ---")
for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    print(" -", r[0])

print("\n--- Columns of episode_sources ---")
for col in cur.execute("PRAGMA table_info(episode_sources)"):
    print(" ", col)

print("\n--- Columns of episodes ---")
for col in cur.execute("PRAGMA table_info(episodes)"):
    print(" ", col)

print("\n--- Columns of dramas ---")
for col in cur.execute("PRAGMA table_info(dramas)"):
    print(" ", col)

# Test Supabase connection
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY",
    os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
    ),
)

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

print(f"\nTesting Supabase REST: {SUPABASE_URL}/rest/v1/episodes?limit=1")
try:
    resp = requests.get(f"{SUPABASE_URL}/rest/v1/episodes?limit=1", headers=headers, timeout=10)
    print("Status code:", resp.status_code)
    if resp.status_code == 200:
        data = resp.json()
        print("Sample episode from Supabase:")
        if data:
            print(json.dumps(data[0], indent=2, ensure_ascii=False))
        else:
            print("Empty list returned")
    else:
        print("Response text:", resp.text[:300])
except Exception as e:
    print("Supabase connection error:", e)
