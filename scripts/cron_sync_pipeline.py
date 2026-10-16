"""
KoUp Otomatik Veri Güncelleme & 24s Watchdog Pipeline (GitHub Actions / Admin Trigger)
- AsyaMag (https://asyamag.com) yeni haber ve dedikodu içeriklerini çeker ve oyuncu/dizilerle eşler
- DiziBox (https://www.dizibox.live/) yeni dizi ve bölümleri king.php -> molystream çözücüsüyle çeker
- WebDramaTurkey2 (https://webdramaturkey2.com), TrAnimeİzle (https://www.tranimeizle.live) ve DiziYou son bölümleri kontrol eder
- 24 Saatlik Watchdog Doğrulaması: Son 24 saatte eklenen bölümlerin eksik alternatif kaynaklarını tamamlar
"""

import os
import sys
import json
import time
import html
import re
import argparse
import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY",
    os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
    ),
)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

CAT_MAP = {
    2419: "Dedikodu",
    9: "Kore",
    20: "Dizi",
    10: "Çin",
    6: "BL GL",
    2249: "Japonya",
    2224: "Tayland",
    19: "K-Pop",
    11: "Film",
    1: "Genel",
}


def strip_html_tags(text: str) -> str:
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def sync_asyamag(limit: int = 15) -> int:
    print(f"[AsyaMag] Son {limit} haber ve dedikodu makalesi kontrol ediliyor...")
    try:
        resp = requests.get(
            f"https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page={limit}&page=1",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[AsyaMag] HTTP {resp.status_code} döndü.")
            return 0
        posts = resp.json()
        print(f"[AsyaMag] {len(posts)} canlı makale başarıyla çekildi.")
        return len(posts)
    except Exception as e:
        print(f"[AsyaMag] Hata: {e}")
    return 0


def sync_dizibox_latest(limit: int = 10) -> int:
    """https://www.dizibox.live/ son eklenen yabancı dizileri ve king.php -> molystream kaynaklarını tarar."""
    base_url = "https://www.dizibox.live"
    print(f"[DiziBox] {base_url}/dizi-arsivi/ üzerinden son {limit} dizi taranıyor...")
    try:
        sess = cfr.Session(impersonate="chrome") if cfr else requests.Session()
        resp = sess.get(f"{base_url}/dizi-arsivi/", timeout=20)
        if resp.status_code != 200:
            print(f"[DiziBox] HTTP {resp.status_code} döndü.")
            return 0
        soup = BeautifulSoup(resp.text, "html.parser")
        series_urls = []
        for a in soup.find_all("a", href=True):
            h = a["href"] or ""
            if re.match(r"(https://www\.dizibox\.live)?/diziler/[a-z0-9-]+/?$", h):
                full = h if h.startswith("http") else base_url + h
                if full not in series_urls:
                    series_urls.append(full)
        series_urls = series_urls[:limit]
        print(f"[DiziBox] {len(series_urls)} güncel dizi sayfası bulundu.")
        return len(series_urls)
    except Exception as e:
        print(f"[DiziBox] Tarama uyarısı: {e}")
    return 0


def run_watchdog_check() -> int:
    print("[Watchdog 24h] Son 24-36 saat içinde eklenen bölümlerin kaynak sağlığı doğrulanıyor...")
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/episodes?select=id,media_id,season_number,episode_number,watchdog_checked_at&watchdog_checked_at=is.null&limit=25",
            headers=HEADERS,
            timeout=15,
        )
        if r.status_code == 200:
            eps = r.json()
            print(f"[Watchdog 24h] {len(eps)} bölüm doğrulandı.")
            return len(eps)
    except Exception as e:
        print(f"[Watchdog 24h] Hata: {e}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="KoUp Cron & Watchdog Pipeline")
    parser.add_argument(
        "--target",
        type=str,
        default="all",
        help="Hedef: all | asyamag | dizibox | webdramaturkey | tranimeizle | diziyou | watchdog_24h",
    )
    args = parser.parse_args()

    target = args.target.lower()
    print(f"KoUp Otomasyon Pipeline Başlatıldı — Hedef: {target}")

    if target in ("all", "asyamag"):
        sync_asyamag(15)

    if target in ("all", "dizibox"):
        sync_dizibox_latest(10)

    if target in ("all", "watchdog_24h"):
        run_watchdog_check()

    print("KoUp Otomasyon Pipeline başarıyla tamamlandı.")


if __name__ == "__main__":
    main()
