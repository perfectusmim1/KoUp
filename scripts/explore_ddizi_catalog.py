import urllib.request
import re
from bs4 import BeautifulSoup

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
        return raw.decode('windows-1254', errors='replace')

# 1. Check sitemaps
for sm in ['https://www.ddizi.tel/sitemap.xml', 'https://www.ddizi.tel/robots.txt', 'https://www.ddizi.tel/sitemap_index.xml']:
    try:
        t = fetch(sm)
        print(f"=== {sm} ===")
        print(t[:500])
    except Exception as e:
        print(f"{sm} error: {e}")

# 2. Check https://www.ddizi.tel/eski.diziler
try:
    html = fetch('https://www.ddizi.tel/eski.diziler')
    soup = BeautifulSoup(html, 'html.parser')
    dramas = {}
    for a in soup.find_all('a', href=True):
        if '/diziler/' in a['href']:
            dramas[a['href']] = a.get_text(strip=True)
    print(f"\neski.diziler count: {len(dramas)}")
    for k, v in list(dramas.items())[:10]:
        print(f"  {k} -> {v}")
except Exception as e:
    print("eski.diziler error:", e)

# 3. Check https://www.ddizi.tel/yabanci-dizi-izle
try:
    html = fetch('https://www.ddizi.tel/yabanci-dizi-izle')
    soup = BeautifulSoup(html, 'html.parser')
    dramas = {}
    for a in soup.find_all('a', href=True):
        if '/diziler/' in a['href']:
            dramas[a['href']] = a.get_text(strip=True)
    print(f"\nyabanci-dizi-izle count: {len(dramas)}")
    for k, v in list(dramas.items())[:10]:
        print(f"  {k} -> {v}")
except Exception as e:
    print("yabanci-dizi-izle error:", e)
