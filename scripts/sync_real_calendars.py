"""
KoUp Real Broadcast Calendar Synchronizer
- Scrapes https://dizikorea3.com/ (K-Drama and Asian series releases)
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

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from scrapers.supabase_sync_helper import _load_supabase_creds

SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()

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
        "p_sync_secret": "koup_sync_secure_token_2026",
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


def sync_dizikorea():
    print("--- [1/3] Syncing DiziKorea Calendar (https://dizikorea3.com/dizi-takvimi) ---")
    url = "https://dizikorea3.com/dizi-takvimi"
    html_text = ""

    # 1. Try live fetch first
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Referer": "https://dizikorea3.com/",
    }
    if cfr:
        try:
            r = cfr.get(url, headers=headers, impersonate="chrome", timeout=12)
            if r.status_code == 200 and ("cal-day-panel" in r.text or "calendar-page" in r.text):
                html_text = r.text
        except Exception as e:
            print(f"curl_cffi live fetch error: {e}", flush=True)

    if not html_text:
        try:
            r = requests.get(url, headers=headers, timeout=12)
            if r.status_code == 200 and ("cal-day-panel" in r.text or "calendar-page" in r.text):
                html_text = r.text
        except Exception as e:
            print(f"requests fetch error: {e}", flush=True)

    # 2. Try cached scratch backup if fetch fails
    if not html_text:
        scratch_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scratch", "dizikorea_takvim.html")
        if os.path.exists(scratch_path):
            print(f"Using cached DiziKorea calendar from {scratch_path}")
            try:
                with open(scratch_path, "r", encoding="utf-8") as f:
                    html_text = f.read()
            except Exception:
                pass

    if not html_text:
        print("DiziKorea calendar HTML could not be loaded!")
        return 0

    soup = BeautifulSoup(html_text, "html.parser")
    count = 0
    day_labels = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]

    day_panels = soup.select(".cal-day-panel")
    if day_panels:
        # Purge old dizikorea entries before inserting current week
        try:
            requests.delete(
                f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.dizikorea",
                headers=HEADERS,
                timeout=10,
            )
            print("Purged old dizikorea calendar entries.")
        except Exception as e:
            print(f"Warning purging dizikorea: {e}")

        dedup_map = {}
        for panel in day_panels:
            pid = panel.get("data-cal-panel")
            try:
                p_idx = int(pid)
                day_num = p_idx + 1
            except (ValueError, TypeError):
                day_num = 1
            dname = day_labels[p_idx] if 0 <= p_idx < len(day_labels) else "Haftalık"

            items = panel.select(".cal-schedule-item")
            for item in items:
                href = item.get("href", "")
                if not href:
                    continue

                slug_match = re.search(r"/dizi/([^/]+)", href)
                raw_slug = slug_match.group(1) if slug_match else href.strip("/").split("/")[-1]
                slug = re.sub(r"-(izle|dq\d*)$", "", raw_slug)

                title_el = item.select_one(".cal-schedule-title")
                title = html.unescape(title_el.get_text(strip=True)) if title_el else raw_slug.replace("-", " ").title()

                ep_el = item.select_one(".cal-schedule-ep")
                ep_raw = html.unescape(ep_el.get_text(strip=True)) if ep_el else "Yeni Bölüm"

                genre_el = item.select_one(".cal-schedule-genre")
                category = html.unescape(genre_el.get_text(strip=True)) if genre_el else "K-Drama"

                img_el = item.select_one(".cal-schedule-poster img")
                img_src = (img_el.get("src") or img_el.get("data-src") or "") if img_el else ""

                key = (day_num, slug)
                if key not in dedup_map:
                    s_m = re.search(r"(\d+)\.\s*Sezon", ep_raw)
                    s_num = int(s_m.group(1)) if s_m else 1
                    dedup_map[key] = {
                        "day_num": day_num,
                        "day_name": dname,
                        "title": title[:100],
                        "slug": slug,
                        "season_num": s_num,
                        "episodes": [],
                        "category": category,
                        "cover_image": img_src,
                        "source_url": href,
                    }

                e_m = re.search(r"(\d+)\.\s*B", ep_raw)
                if e_m:
                    dedup_map[key]["episodes"].append(int(e_m.group(1)))
                else:
                    dedup_map[key]["episodes"].append(ep_raw)
                dedup_map[key]["source_url"] = href

        for key, d in dedup_map.items():
            eps = sorted([x for x in d["episodes"] if isinstance(x, int)])
            if len(eps) > 1:
                ep_label = f"{d['season_num']}. Sezon {eps[0]}-{eps[-1]}. Bölümler"
            elif len(eps) == 1:
                ep_label = f"{d['season_num']}. Sezon {eps[0]}. Bölüm"
            else:
                ep_label = "Yeni Bölüm"

            entry = {
                "source_site": "dizikorea",
                "day_of_week": d["day_num"],
                "date_label": d["day_name"],
                "title": d["title"],
                "slug": d["slug"],
                "episode_label": ep_label,
                "category": d["category"],
                "cover_image": d["cover_image"],
                "source_url": d["source_url"],
            }
            res = call_upsert_rpc(entry)
            if res:
                count += 1
    else:
        print("No .cal-day-panel elements found in DiziKorea calendar HTML.")

    print(f"DiziKorea synced {count} active calendar episodes across 7 days.")
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

    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.dizibox",
            headers=HEADERS,
            timeout=10,
        )
        print("Purged old dizibox calendar entries.")
    except Exception as e:
        print(f"Warning purging dizibox: {e}")

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


def sync_animecix_calendar():
    print("--- [3/3] Syncing AnimeciX Real Calendar (https://animecix.tv/calendar) ---")
    
    # 1. Clean up old legacy tranimeizle entries
    try:
        del_resp = requests.delete(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.tranimeizle",
            headers=HEADERS,
            timeout=10
        )
        if del_resp.status_code in (200, 204):
            print("Cleaned up legacy tranimeizle entries from calendar_schedules.")
    except Exception as e:
        print(f"Cleanup warning: {e}")

    # 2. Fetch official AnimeciX calendar API
    endpoints = [
        "https://animecix.tv/secure/calendar",
        "https://animecix.net/secure/calendar"
    ]
    data = None
    for ep in endpoints:
        try:
            r = requests.get(ep, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://animecix.tv/calendar",
                "Accept": "application/json"
            }, timeout=12)
            if r.status_code == 200:
                data = r.json()
                print(f"Successfully fetched calendar from {ep}")
                break
        except Exception as e:
            print(f"Endpoint {ep} error: {e}")

    if not data or not data.get("data"):
        print("AnimeciX calendar data could not be fetched!")
        return 0

    days = data.get("data", [])
    day_labels = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
    count = 0

    for idx, day in enumerate(days[:7]):
        day_num = idx + 1
        dname = day_labels[idx]
        episodes = day.get("episodes", [])
        print(f"  {dname} (Gün {day_num}): {len(episodes)} anime yayınlanıyor.")

        for ep_item in episodes:
            title_obj = ep_item.get("title") or {}
            if isinstance(title_obj, dict):
                title_name = title_obj.get("name") or ep_item.get("name") or "Anime"
                poster = title_obj.get("poster") or ep_item.get("poster") or ""
                genres = title_obj.get("genres") or ["Anime"]
                t_id = title_obj.get("id") or ep_item.get("title_id")
            else:
                title_name = ep_item.get("name") or "Anime"
                poster = ep_item.get("poster") or ""
                genres = ["Anime"]
                t_id = ep_item.get("title_id")

            ep_num = ep_item.get("episode_number") or ep_item.get("number") or 1
            category = genres[0] if (genres and isinstance(genres, list)) else "Anime"
            slug = re.sub(r"[^a-z0-9]+", "-", title_name.lower()).strip("-")

            item = {
                "source_site": "animecix",
                "day_of_week": day_num,
                "date_label": dname,
                "title": title_name[:100],
                "slug": slug,
                "episode_label": f"{ep_num}. Bölüm",
                "category": category,
                "cover_image": poster,
                "source_url": f"https://animecix.tv/titles/{t_id}" if t_id else "https://animecix.tv/calendar",
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

    print(f"AnimeciX synced {count} active calendar episodes across 7 days.")
    return count


def sync_asyaanimeleri_calendar():
    print("--- [4/4] Syncing AsyaAnimeleri Calendar (https://asyaanimeleri.top/takvim/) ---")
    url = "https://asyaanimeleri.top/takvim/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://asyaanimeleri.top/",
    }
    try:
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code != 200:
            print(f"AsyaAnimeleri takvim fetch failed with status {r.status_code}")
            return 0
    except Exception as e:
        print(f"AsyaAnimeleri takvim fetch error: {e}")
        return 0

    soup = BeautifulSoup(r.text, "html.parser")
    day_class_map = {
        "sch_monday": (1, "Pazartesi"),
        "sch_tuesday": (2, "Salı"),
        "sch_wednesday": (3, "Çarşamba"),
        "sch_thursday": (4, "Perşembe"),
        "sch_friday": (5, "Cuma"),
        "sch_saturday": (6, "Cumartesi"),
        "sch_sunday": (7, "Pazar"),
    }

    count = 0
    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.asyaanimeleri",
            headers=HEADERS,
            timeout=10,
        )
        print("Purged old asyaanimeleri calendar entries.")
    except Exception as e:
        print(f"Warning purging asyaanimeleri: {e}")

    for sch_class, (day_num, day_name) in day_class_map.items():
        box = soup.select_one(f".bixbox.schedulepage.{sch_class}")
        if not box:
            continue
        cards = box.select(".bsx")
        print(f"  {day_name} (Gün {day_num}): {len(cards)} Donghua / Asya animesi yayınlanıyor.")
        for card in cards:
            a_tag = card.find("a")
            if not a_tag:
                continue
            title = a_tag.get("title") or a_tag.get_text(strip=True)
            title_upper = title.upper()
            if any(j in title_upper for j in ["[ASMV]", "ASMV", "[AMV]", " AMV ", "TANITIM", "FRAGMAN"]):
                continue
            href = a_tag.get("href", "")
            img = a_tag.find("img")
            cover = img.get("src") or img.get("data-src") or "" if img else ""
            ep_span = a_tag.select_one(".sb.Sub")
            ep_num = ep_span.get_text(strip=True) if ep_span else ""
            ep_label = f"{ep_num}. Bölüm" if ep_num and ep_num != "??" else "Yeni Bölüm"
            slug = href.rstrip("/").split("/")[-1] if href else re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
            if "anime-asmv" in slug.lower():
                continue

            item = {
                "source_site": "asyaanimeleri",
                "day_of_week": day_num,
                "date_label": day_name,
                "title": title[:100],
                "slug": slug,
                "episode_label": ep_label,
                "category": "Donghua & Asya Animesi",
                "cover_image": cover,
                "source_url": href,
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

    print(f"AsyaAnimeleri synced {count} active calendar episodes across 7 days.")
    return count


if __name__ == "__main__":
    print("Starting KoUp Real Broadcast Calendar Synchronization...")
    w_count = sync_dizikorea()
    d_count = sync_dizibox()
    a_count = sync_animecix_calendar()
    asya_count = sync_asyaanimeleri_calendar()
    print("=================================================")
    print(f"SUCCESS: Total {w_count + d_count + a_count + asya_count} real schedule items synced to public.calendar_schedules!")

