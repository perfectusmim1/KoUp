import sys
import os
import re
import json
import requests
from bs4 import BeautifulSoup
try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

print("1. Testing DiziYou...")
try:
    r = requests.get("https://www.diziyou.one/?s=CSI", headers=headers, timeout=10)
    print("DiziYou status:", r.status_code, "Length:", len(r.text))
except Exception as e:
    print("DiziYou error:", e)

print("\n2. Testing WebDramaTurkey...")
try:
    sess = cfr.Session(impersonate="chrome") if cfr else requests.Session()
    r = sess.get("https://webdramaturkey2.com/?s=revenge", headers=headers, timeout=10)
    print("WebDramaTurkey status:", r.status_code, "Length:", len(r.text))
except Exception as e:
    print("WebDramaTurkey error:", e)

print("\n3. Testing DiziBox...")
try:
    sess = cfr.Session(impersonate="chrome") if cfr else requests.Session()
    r = sess.get("https://www.dizibox.live/?s=CSI", headers=headers, timeout=10)
    print("DiziBox status:", r.status_code, "Length:", len(r.text))
except Exception as e:
    print("DiziBox error:", e)

print("\n4. Testing Animecix...")
try:
    from scrapers.scraper_animecix import fetch_catalog_page, make_header
    data, last_page, total = fetch_catalog_page(1, per_page=5)
    print("Animecix success! Total streamable:", total, "Sample title:", data[0].get("name") if data else None)
except Exception as e:
    print("Animecix error:", e)

print("\n5. Testing TrAnimeİzle...")
try:
    sess = cfr.Session(impersonate="chrome") if cfr else requests.Session()
    r = sess.get("https://www.tranimeizle.live/anime-listesi", headers=headers, timeout=10)
    print("TrAnimeİzle status:", r.status_code, "Length:", len(r.text))
except Exception as e:
    print("TrAnimeİzle error:", e)
