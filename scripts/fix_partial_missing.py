import sqlite3
import requests
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

conn = sqlite3.connect("webdrama_archive.db")
cur = conn.cursor()

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 1. Inspect 8. Gun (drama_id 31532)
print("=== Checking 8. Gün on Ddizi ===")
try:
    r = requests.get("https://www.ddizi.tel/diziler/1676/8-gun-hd", headers=headers, timeout=10)
    links = re.findall(r'href="([^"]*8-gun-1-bolum[^"]*)"', r.text) + re.findall(r'href="([^"]*8-gun-2-bolum[^"]*)"', r.text)
    print("Found links:", links)
    for l in set(links):
        url = l if l.startswith("http") else "https://www.ddizi.tel" + l
        r2 = requests.get(url, headers=headers, timeout=10)
        # extract iframe or youtube
        yt = re.findall(r'(https://www\.youtube\.com/embed/[a-zA-Z0-9_-]+)', r2.text)
        print(f"Page {url} -> YouTube: {yt}")
        if "1-bolum" in url and yt:
            cur.execute("INSERT OR IGNORE INTO episode_sources (episode_id, source_name, direct_url, provider, site) VALUES (?, ?, ?, ?, ?)",
                        (417766, "YouTube HD", yt[0], "youtube", "ddizi"))
            print("Added Ep 1 source!")
        elif "2-bolum" in url and yt:
            cur.execute("INSERT OR IGNORE INTO episode_sources (episode_id, source_name, direct_url, provider, site) VALUES (?, ?, ?, ?, ?)",
                        (417767, "YouTube HD", yt[0], "youtube", "ddizi"))
            print("Added Ep 2 source!")
    conn.commit()
except Exception as e:
    print("Error 8. Gun:", e)

# 2. Inspect Around 40 Otoko no Isekai Tsuuhan (drama_id 6067)
print("\n=== Checking Around 40 Otoko (6067) ===")
cur.execute("SELECT id, episode_number FROM episodes WHERE drama_id=6067 AND id NOT IN (SELECT episode_id FROM episode_sources)")
missing = cur.fetchall()
print("Missing episodes:", missing)
# Let's see if episode 13 or 14 is a special/OVA that doesn't exist
cur.execute("SELECT episode_number, episode_name FROM episodes WHERE drama_id=6067")
print("All episodes:", cur.fetchall())

# 3. Inspect Venus Versus Virus (drama_id 11404)
print("\n=== Checking Venus Versus Virus (11404) ===")
cur.execute("SELECT id, episode_number FROM episodes WHERE drama_id=11404 AND id NOT IN (SELECT episode_id FROM episode_sources)")
missing_vv = cur.fetchall()
print("Missing episodes:", missing_vv)
cur.execute("SELECT episode_number, episode_name FROM episodes WHERE drama_id=11404")
print("All episodes:", cur.fetchall())
