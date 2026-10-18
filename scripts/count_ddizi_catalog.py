import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os, json, time
import urllib.request
import re
from bs4 import BeautifulSoup

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode('windows-1254', errors='replace')

all_dramas = {}

# 1. Eski Diziler (32 sayfa)
print("📡 DDizi eski diziler kataloglanıyor...")
for p in range(1, 35):
    url = f"https://www.ddizi.tel/eski.diziler/{p}" if p > 1 else "https://www.ddizi.tel/eski.diziler"
    try:
        html = fetch(url)
        soup = BeautifulSoup(html, 'html.parser')
        page_dramas = {}
        for a in soup.find_all('a', href=True):
            h = a['href']
            t = a.get_text(strip=True)
            if '/diziler/' in h and t and len(t) > 1:
                full_h = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                page_dramas[full_h] = t
        if not page_dramas:
            break
        all_dramas.update(page_dramas)
        print(f"  Sayfa {p}: +{len(page_dramas)} dizi (Toplam: {len(all_dramas)})")
        time.sleep(0.3)
    except Exception as e:
        print(f"  Sayfa {p} hata: {e}")
        break

# 2. Güncel & Yeni Eklenenler
for u in ["https://www.ddizi.tel/", "https://www.ddizi.tel/yeni-eklenenler8", "https://www.ddizi.tel/yabanci-dizi-izle"]:
    try:
        html = fetch(u)
        soup = BeautifulSoup(html, 'html.parser')
        for a in soup.find_all('a', href=True):
            h = a['href']
            t = a.get_text(strip=True)
            if '/diziler/' in h and t and len(t) > 1:
                full_h = h if h.startswith('http') else 'https://www.ddizi.tel' + h
                all_dramas[full_h] = t
        time.sleep(0.3)
    except Exception as e:
        print(f"Hata {u}: {e}")

out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scrapers", "ddizi_catalog.json")
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(all_dramas, f, ensure_ascii=False, indent=2)

print(f"\n🎉 Toplam {len(all_dramas)} DDizi yapımı {out_path} dosyasına kaydedildi!")
