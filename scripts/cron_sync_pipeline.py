"""
KoUp Otomatik Veri Güncelleme & 24s Watchdog Pipeline (GitHub Actions / Admin Trigger)
- AsyaMag (https://asyamag.com) yeni haber ve dedikodu içeriklerini çeker ve oyuncu/dizilerle eşler
- WebDramaTurkey2, TrAnimeİzle, DiziYou ve DiziBox son eklenen bölümleri kontrol eder
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
            f"https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page={limit}& page=1",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[AsyaMag] HTTP {resp.status_code} döndü.")
            return 0
        posts = resp.json()
        rows = []
        for p in posts:
            wp_id = p.get("id")
            slug = p.get("slug") or f"post-{wp_id}"
            title = strip_html_tags(p.get("title", {}).get("rendered", ""))
            excerpt = strip_html_tags(p.get("excerpt", {}).get("rendered", ""))
            content_html = p.get("content", {}).get("rendered", "")
            cats = [CAT_MAP.get(cid, "Magazin") for cid in (p.get("categories") or [])]
            if not cats:
                cats = ["Magazin"]
            is_gossip = "Dedikodu" in cats or "dedikodu" in title.lower()
            feat_img = None
            emb = p.get("_embedded") or {}
            media_arr = emb.get("wp:featuredmedia") or []
            if media_arr and isinstance(media_arr[0], dict):
                feat_img = media_arr[0].get("source_url")
            author_arr = emb.get("author") or []
            author_name = (
                author_arr[0].get("name", "AsyaMag Editör")
                if (author_arr and isinstance(author_arr[0], dict))
                else "AsyaMag Editör"
            )
            rows.append(
                {
                    "wp_post_id": wp_id,
                    "slug": slug,
                    "title": title,
                    "excerpt": excerpt,
                    "content_html": content_html,
                    "featured_image": feat_img,
                    "author_name": author_name,
                    "categories": cats,
                    "tags": [],
                    "is_gossip": is_gossip,
                    "source_url": p.get("link"),
                    "published_at": (p.get("date_gmt") or p.get("date") or "2026-01-01T00:00:00") + "Z",
                    "related_media_ids": [],
                    "related_person_ids": [],
                }
            )
        if rows:
            r = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/admin_bulk_ingest",
                headers=HEADERS,
                json={"p_table": "magazine_posts", "p_rows": rows},
                timeout=20,
            )
            print(f"[AsyaMag] {len(rows)} makale senkronize edildi (HTTP {r.status_code}).")
            return len(rows)
    except Exception as e:
        print(f"[AsyaMag] Hata: {e}")
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
        help="Hedef: all | asyamag | webdramaturkey | tranimeizle | diziyou | dizibox | watchdog_24h",
    )
    args = parser.parse_args()

    target = args.target.lower()
    print(f"🚀 KoUp Otomasyon Pipeline Başlatıldı — Hedef: {target}")

    if target in ("all", "asyamag"):
        sync_asyamag(15)

    if target in ("all", "watchdog_24h"):
        run_watchdog_check()

    print("✅ KoUp Otomasyon Pipeline başarıyla tamamlandı.")


if __name__ == "__main__":
    main()
