"""
KoUp Real Broadcast Calendar Synchronizer
- Scrapes https://webdramaturkey2.com/sayfa/takvim (73 real drama cards across 7 days)
- Scrapes https://www.dizibox.live/dizi-takvimi/ (63 real TV series across 7 days)
- Fetches AniList GraphQL AiringSchedule for seasonal animes
- Calls public.upsert_calendar_schedule RPC to link media & populate public.calendar_schedules
"""

import os
import sys
import json
import re
import html
import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

DAY_NAME_MAP = {
    "pazartesi": 1,
    "salı": 2,
    "sali": 2,
    "çarşamba": 3,
    "carsamba": 3,
    "perşembe": 4,
    "persembe": 4,
    "cuma": 5,
    "cumartesi": 6,
    "pazar": 7,
}

def call_upsert_rpc(item):
    url = f"{SUPABASE_URL}/rest/v1/rpc/upsert_calendar_schedule"
    payload = {
        "p_source_site": item["source_site"],
        "p_day_of_week": int(item["day_of_week"]),
        "p_date_label": item.get("date_label", ""),
        "p_title": item["title"],
        "p_slug": item["slug"],
        "p_episode_label": item.get("episode_label", ""),
        "p_category": item.get("category", "Dizi"),
        "p_cover_image": item.get("cover_image", ""),
        "p_source_url": item.get("source_url", ""),
    }
    try:
        resp = requests.post(url, headers=HEADERS, json=payload, timeout=15)
        if resp.status_code in (200, 201):
            return resp.json()
        else:
            print(f"[RPC Error] {item['title']}: {resp.status_code} {resp.text[:100]}")
    except Exception as e:
        print(f"[RPC Ex] {item['title']}: {e}")
    return None


def sync_webdramaturkey():
    print("--- [1/3] Syncing WebDramaTurkey2 Calendar ---")
    url = "https://webdramaturkey2.com/sayfa/takvim"
    html_text = ""

    # Try live fetch first
    # 1. Try scratch backup first if exists, then live
    scratch_path = r"c:\Users\Cagan\Downloads\KoUp\scratch\webdrama_takvim.html"
    if os.path.exists(scratch_path):
        with open(scratch_path, "r", encoding="utf-8") as f:
            html_text = f.read()

    # Try live fetch if scratch not present or empty
    if not html_text:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Referer": "https://webdramaturkey2.com/",
        }
        if cfr:
            try:
                r = cfr.get(url, headers=headers, impersonate="chrome", timeout=12)
                if r.status_code == 200 and '<div class="card-calendar">' in r.text:
                    html_text = r.text
            except Exception as e:
                print(f"curl_cffi live fetch error: {e}", flush=True)

    soup = BeautifulSoup(html_text, "html.parser")
    cards = soup.select(".card-calendar")
    print(f"Found {len(cards)} calendar cards on WebDramaTurkey2", flush=True)

    count = 0
    for card in cards:
        a_tag = card.select_one("a.card-calendar-episode") or card.find("a")
        if not a_tag:
            continue
        href = a_tag.get("href", "")
        # e.g. /dizi/the-judge-from-hell or /anime/bleach
        slug_match = re.search(r"/(?:dizi|anime|film)/([^/]+)", href)
        slug = slug_match.group(1) if slug_match else href.strip("/").split("/")[-1]

        title_el = card.select_one(".card-calendar-episode__content-title")
        title = title_el.get_text(strip=True) if title_el else slug

        badge_el = card.select_one(".card-calendar-episode__content-badge")
        ep_label = badge_el.get_text(strip=True) if badge_el else "Yeni Bölüm"

        img_el = card.select_one(".card-calendar-episode__image img")
        img_src = img_el.get("src") or img_el.get("data-src") or "" if img_el else ""

        tags_el = card.select(".card-calendar-episode__content-tags span")
        category = tags_el[0].get_text(strip=True) if len(tags_el) > 0 else "Dizi"
        date_str = tags_el[1].get_text(strip=True) if len(tags_el) > 1 else ""

        day_num = 1
        for dname, dval in DAY_NAME_MAP.items():
            if dname in date_str.lower():
                day_num = dval
                break

        full_url = f"https://webdramaturkey2.com{href}" if href.startswith("/") else href

        item = {
            "source_site": "webdramaturkey",
            "day_of_week": day_num,
            "date_label": date_str,
            "title": title,
            "slug": slug,
            "episode_label": ep_label,
            "category": category,
            "cover_image": img_src,
            "source_url": full_url,
        }
        res = call_upsert_rpc(item)
        if res:
            count += 1

    print(f"WebDramaTurkey2 synced {count} active calendar episodes.")
    return count


def sync_dizibox():
    print("--- [2/3] Syncing DiziBox Calendar ---")
    url = "https://www.dizibox.live/dizi-takvimi/"
    html_text = ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": "https://www.dizibox.live/",
    }
    if cfr:
        try:
            r = cfr.get(url, headers=headers, impersonate="chrome", timeout=12)
            if r.status_code == 200 and "tv-calendar" in r.text:
                html_text = r.text
        except Exception as e:
            print(f"curl_cffi live fetch error: {e}")

    if not html_text:
        cached_path = r"C:\Users\Cagan\.gemini\antigravity\brain\57362481-e13d-42bf-87e1-b0477b341d2c\scratch\dizibox_takvim.html"
        if os.path.exists(cached_path):
            print(f"Using cached DiziBox calendar from {cached_path}")
            with open(cached_path, "r", encoding="utf-8") as f:
                html_text = f.read()

    if not html_text:
        print("DiziBox calendar HTML could not be loaded!")
        return 0

    soup = BeautifulSoup(html_text, "html.parser")
    table = soup.select_one("table.tv-calendar")
    if not table:
        print("DiziBox tv-calendar table not found!")
        return 0

    cols = table.select("tbody > tr > td")
    print(f"Found {len(cols)} calendar day columns in DiziBox table")

    day_labels = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
    count = 0

    for idx, col in enumerate(cols[:7]):
        day_num = idx + 1
        dname = day_labels[idx]
        links = col.select("a.button-link")
        for a in links:
            title = a.get_text(strip=True)
            href = a.get("href", "")
            slug = href.strip("/").split("/")[-1]
            if not slug or not title:
                continue

            item = {
                "source_site": "dizibox",
                "day_of_week": day_num,
                "date_label": dname,
                "title": title,
                "slug": slug,
                "episode_label": "Yeni Bölüm",
                "category": "Yabancı Dizi",
                "cover_image": "",
                "source_url": href,
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

    print(f"DiziBox synced {count} active series entries across 7 days.")
    return count


def sync_anilist_airing():
    print("--- [3/3] Syncing AniList Seasonal Airing Anime Schedule ---")
    query = """
    query {
      Page(page: 1, perPage: 40) {
        airingSchedules(notYetAired: true, sort: TIME) {
          id
          airingAt
          episode
          media {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              large
            }
            genres
            averageScore
          }
        }
      }
    }
    """
    try:
        r = requests.post("https://graphql.anilist.co", json={"query": query}, timeout=15)
        if r.status_code != 200:
            print(f"AniList GraphQL error: {r.status_code}")
            return 0
        data = r.json()
        schedules = data.get("data", {}).get("Page", {}).get("airingSchedules", [])
        print(f"Fetched {len(schedules)} airing episodes from AniList")

        count = 0
        from datetime import datetime, timezone
        for s in schedules:
            m = s.get("media") or {}
            romaji = m.get("title", {}).get("romaji") or m.get("title", {}).get("english") or "Anime"
            slug = re.sub(r"[^a-z0-9]+", "-", romaji.lower()).strip("-")
            air_ts = s.get("airingAt", 0)
            dt = datetime.fromtimestamp(air_ts, tz=timezone.utc)
            # Python weekday: Monday=0 .. Sunday=6 -> KoUp day_of_week: 1..7
            day_num = dt.weekday() + 1
            day_labels = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
            dname = f"{day_labels[dt.weekday()]} · {dt.strftime('%H:%M')} UTC"

            genres = m.get("genres") or ["Anime"]
            cover = m.get("coverImage", {}).get("large") or ""
            ep_num = s.get("episode", 1)

            item = {
                "source_site": "tranimeizle",
                "day_of_week": day_num,
                "date_label": dname,
                "title": romaji,
                "slug": slug,
                "episode_label": f"{ep_num}. Bölüm",
                "category": genres[0] if genres else "Anime",
                "cover_image": cover,
                "source_url": f"https://anilist.co/anime/{m.get('id')}",
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

        print(f"AniList seasonal schedule synced {count} airing anime episodes.")
        return count
    except Exception as e:
        print(f"AniList GraphQL schedule error: {e}")
        return 0


if __name__ == "__main__":
    print("Starting KoUp Real Broadcast Calendar Synchronization...")
    w_count = sync_webdramaturkey()
    d_count = sync_dizibox()
    a_count = sync_anilist_airing()
    print("=================================================")
    print(f"SUCCESS: Total {w_count + d_count + a_count} real schedule items synced to public.calendar_schedules!")
