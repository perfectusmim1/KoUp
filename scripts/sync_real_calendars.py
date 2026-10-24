"""
KoUp Real Broadcast Calendar Synchronizer v2
- Scrapes https://dizikorea3.com/dizi-takvimi (K-Drama and Asian series releases)
- Scrapes https://www.dizibox.live/dizi-takvimi/ (Global TV series across 7 days)
- Scrapes https://animecix.tv/calendar & https://asyaanimeleri.top/takvim/
- Queries AniList GraphQL AiringSchedule for seasonal animes in KoUp catalog
- Queries TMDB next_episode_to_air for ongoing TV series in KoUp catalog
- Populates public.calendar_schedules AND public.media (air_days, next_episode_at, next_episode_number)
"""

import os
import sys
import json
import re
import html
import time
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
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


def _load_tmdb_key() -> str:
    env_path = os.path.join(_ROOT, "koup-app", ".env.local")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("TMDB_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return os.environ.get("TMDB_API_KEY", "4c092d2cfd6d9c0e3aa3dab12c7d4756")


TMDB_API_KEY = _load_tmdb_key()

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

TR_TZ = timezone(timedelta(hours=3))
DAY_LABELS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]

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


def compute_next_occurrence_iso(day_of_week: int, hour: int = 20) -> str:
    """Given day_of_week (1=Monday .. 7=Sunday), returns the next occurrence ISO timestamp in TRT (UTC+3)."""
    now_tr = datetime.now(TR_TZ)
    today_dow = now_tr.isoweekday()  # 1..7
    days_ahead = (day_of_week - today_dow) % 7
    target_date = (now_tr + timedelta(days=days_ahead)).date()
    target_dt = datetime(
        target_date.year, target_date.month, target_date.day, hour, 0, 0, tzinfo=TR_TZ
    )
    return target_dt.isoformat()


def extract_ep_number(episode_label: str) -> int | None:
    if not episode_label:
        return None
    # e.g. "1. Sezon 9-10. Bölümler" or "11. Bölüm"
    m = re.search(r"(?:Sezon\s+)?(\d+)(?:-\d+)?\.\s*Bölüm", episode_label, re.IGNORECASE)
    if m:
        return int(m.group(1))
    m2 = re.search(r"(\d+)", episode_label)
    if m2 and "sezon" not in episode_label.lower():
        return int(m2.group(1))
    return None


def call_upsert_rpc(item: dict):
    url = f"{SUPABASE_URL}/rest/v1/rpc/upsert_calendar_schedule"
    day_num = int(item["day_of_week"])
    ep_label = item.get("episode_label", "")
    next_ep_at = item.get("next_episode_at") or compute_next_occurrence_iso(day_num)
    next_ep_num = item.get("next_episode_number") or extract_ep_number(ep_label)

    payload = {
        "p_source_site": item["source_site"],
        "p_day_of_week": day_num,
        "p_date_label": item.get("date_label") or DAY_LABELS[day_num - 1],
        "p_title": item["title"],
        "p_slug": item["slug"],
        "p_episode_label": ep_label,
        "p_category": item.get("category", "Dizi"),
        "p_cover_image": item.get("cover_image", ""),
        "p_source_url": item.get("source_url", ""),
        "p_sync_secret": "koup_sync_secure_token_2026",
        "p_next_episode_at": next_ep_at,
        "p_next_episode_number": next_ep_num,
    }
    try:
        resp = requests.post(url, headers=HEADERS, json=payload, timeout=15)
        if resp.status_code in (200, 201):
            return resp.json()
        else:
            print(f"[RPC Error] {item['title']}: {resp.status_code} {resp.text[:120]}")
    except Exception as e:
        print(f"[RPC Ex] {item['title']}: {e}")
    return None


def sync_dizikorea() -> int:
    print("--- [1/6] Syncing DiziKorea Calendar (https://dizikorea3.com/dizi-takvimi) ---")
    url = "https://dizikorea3.com/dizi-takvimi"
    html_text = ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

    if not html_text:
        print("DiziKorea calendar HTML could not be loaded!")
        return 0

    soup = BeautifulSoup(html_text, "html.parser")
    count = 0

    day_panels = soup.select(".cal-day-panel")
    if day_panels:
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
                p_idx = 0
            dname = DAY_LABELS[p_idx] if 0 <= p_idx < len(DAY_LABELS) else "Pazartesi"

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
                next_ep_num = eps[0]
            elif len(eps) == 1:
                ep_label = f"{d['season_num']}. Sezon {eps[0]}. Bölüm"
                next_ep_num = eps[0]
            else:
                ep_label = "Yeni Bölüm"
                next_ep_num = None

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
                "next_episode_number": next_ep_num,
            }
            res = call_upsert_rpc(entry)
            if res:
                count += 1
    else:
        print("No .cal-day-panel elements found in DiziKorea calendar HTML.")

    print(f"DiziKorea synced {count} active calendar episodes across 7 days.")
    return count


def sync_dizibox() -> int:
    print("--- [2/6] Syncing DiziBox Calendar ---")
    urls = [
        "https://www.dizibox.live/dizi-takvimi/",
        "https://www.dizibox.plus/dizi-takvimi/",
        "https://www.dizibox.de/dizi-takvimi/",
    ]
    html_text = ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.dizibox.live/",
    }
    if cfr:
        for url in urls:
            try:
                r = cfr.get(url, headers=headers, impersonate="chrome", timeout=12)
                if r.status_code == 200 and "tv-calendar" in r.text:
                    html_text = r.text
                    break
            except Exception as e:
                print(f"curl_cffi DiziBox fetch error ({url}): {e}")

    if not html_text:
        print("DiziBox live calendar blocked by Cloudflare or unavailable; keeping existing/TMDB entries.")
        return 0

    soup = BeautifulSoup(html_text, "html.parser")
    table = soup.select_one("table.tv-calendar")
    if not table:
        print("DiziBox tv-calendar table not found!")
        return 0

    cols = table.select("tbody > tr > td")
    print(f"Found {len(cols)} calendar day columns in DiziBox table")

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
        dname = DAY_LABELS[idx]
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


def sync_animecix_calendar() -> int:
    print("--- [3/6] Syncing AnimeciX Real Calendar ---")
    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.tranimeizle",
            headers=HEADERS,
            timeout=10,
        )
    except Exception:
        pass

    endpoints = [
        "https://animecix.tv/secure/calendar",
        "https://animecix.net/secure/calendar",
    ]
    data = None
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://animecix.tv/calendar",
        "Accept": "application/json",
    }
    for ep in endpoints:
        try:
            if cfr:
                r = cfr.get(ep, headers=req_headers, impersonate="chrome", timeout=12)
            else:
                r = requests.get(ep, headers=req_headers, timeout=12)
            if r.status_code == 200:
                parsed = r.json()
                if parsed and parsed.get("data"):
                    data = parsed
                    print(f"Successfully fetched calendar from {ep}")
                    break
        except Exception as e:
            print(f"Endpoint {ep} error: {e}")

    if not data or not data.get("data"):
        print("AnimeciX calendar data could not be fetched directly; AniList GraphQL will cover seasonal animes.")
        return 0

    try:
        requests.delete(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?source_site=eq.animecix",
            headers=HEADERS,
            timeout=10,
        )
        print("Purged old animecix calendar entries.")
    except Exception as e:
        print(f"Warning purging animecix: {e}")

    days = data.get("data", [])
    count = 0

    for idx, day in enumerate(days[:7]):
        day_num = idx + 1
        dname = DAY_LABELS[idx]
        episodes = day.get("episodes", [])

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
            if isinstance(category, dict):
                category = category.get("display_name") or category.get("name") or "Anime"
            slug = re.sub(r"[^a-z0-9]+", "-", title_name.lower()).strip("-")

            item = {
                "source_site": "animecix",
                "day_of_week": day_num,
                "date_label": dname,
                "title": title_name[:100],
                "slug": slug,
                "episode_label": f"{ep_num}. Bölüm",
                "category": str(category),
                "cover_image": poster,
                "source_url": f"https://animecix.tv/titles/{t_id}" if t_id else "https://animecix.tv/calendar",
                "next_episode_number": int(ep_num) if str(ep_num).isdigit() else None,
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

    print(f"AnimeciX synced {count} active calendar episodes across 7 days.")
    return count


def sync_asyaanimeleri_calendar() -> int:
    print("--- [4/6] Syncing AsyaAnimeleri Calendar (https://asyaanimeleri.top/takvim/) ---")
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
                "next_episode_number": int(ep_num) if ep_num.isdigit() else None,
            }
            res = call_upsert_rpc(item)
            if res:
                count += 1

    print(f"AsyaAnimeleri synced {count} active calendar episodes across 7 days.")
    return count


def sync_anilist_airing_schedule() -> int:
    """Fetches real-time AniList AiringSchedule for the next 7 days and syncs matching catalog animes."""
    print("--- [5/6] Syncing AniList GraphQL AiringSchedule (7-Day Window) ---")
    now_ts = int(time.time())
    end_ts = now_ts + 7 * 86400

    query = """
    query ($page: Int, $start: Int, $end: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo {
          hasNextPage
        }
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          airingAt
          episode
          media {
            id
            type
            format
            status
            countryOfOrigin
            siteUrl
            title {
              romaji
              english
              native
            }
            coverImage {
              extraLarge
              large
            }
          }
        }
      }
    }
    """

    schedules = []
    for page in range(1, 5):
        try:
            r = requests.post(
                "https://graphql.anilist.co",
                json={"query": query, "variables": {"page": page, "start": now_ts - 3600, "end": end_ts}},
                timeout=12,
            )
            if r.status_code != 200:
                break
            pdata = r.json().get("data", {}).get("Page", {})
            batch = pdata.get("airingSchedules") or []
            schedules.extend(batch)
            if not pdata.get("pageInfo", {}).get("hasNextPage"):
                break
        except Exception as e:
            print(f"AniList GraphQL page {page} error: {e}")
            break

    if not schedules:
        print("No AniList airing schedules returned.")
        return 0

    # Load ongoing/active animes from public.media to match against
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/media?content_type=eq.anime&select=id,slug,title,title_en,native_title,anilist_id,cover_image,episodes_available&limit=3000",
            headers=HEADERS,
            timeout=15,
        )
        catalog_animes = resp.json() if resp.status_code == 200 else []
    except Exception:
        catalog_animes = []

    by_anilist_id = {}
    by_norm_title = {}

    def _norm(s: str | None) -> str:
        if not s:
            return ""
        return re.sub(r"[^a-z0-9]+", "", s.lower())

    for m in catalog_animes:
        if m.get("anilist_id"):
            by_anilist_id[int(m["anilist_id"])] = m
        for field in ("title", "title_en", "native_title", "slug"):
            nt = _norm(m.get(field))
            if nt and len(nt) >= 4:
                if nt not in by_norm_title or (m.get("episodes_available") or 0) > (by_norm_title[nt].get("episodes_available") or 0):
                    by_norm_title[nt] = m

    count = 0
    seen_media_days = set()

    for item in schedules:
        media_obj = item.get("media") or {}
        if media_obj.get("type") != "ANIME":
            continue
        al_id = media_obj.get("id")
        titles = media_obj.get("title") or {}
        romaji = titles.get("romaji") or ""
        english = titles.get("english") or ""
        native = titles.get("native") or ""

        matched = by_anilist_id.get(al_id)
        if not matched:
            for cand in (romaji, english, native):
                nc = _norm(cand)
                if nc and nc in by_norm_title:
                    matched = by_norm_title[nc]
                    break

        if not matched:
            continue

        airing_at = item.get("airingAt")
        ep_num = item.get("episode") or 1
        if not airing_at:
            continue

        dt_tr = datetime.fromtimestamp(airing_at, tz=TR_TZ)
        day_num = dt_tr.isoweekday()
        dname = DAY_LABELS[day_num - 1]
        iso_str = dt_tr.isoformat()

        dedup_key = (matched["id"], day_num)
        if dedup_key in seen_media_days:
            continue
        seen_media_days.add(dedup_key)

        cover = (
            matched.get("cover_image")
            or (media_obj.get("coverImage") or {}).get("extraLarge")
            or (media_obj.get("coverImage") or {}).get("large")
            or ""
        )

        entry = {
            "source_site": "animecix",
            "day_of_week": day_num,
            "date_label": dname,
            "title": matched.get("title") or romaji or english,
            "slug": matched.get("slug"),
            "episode_label": f"{ep_num}. Bölüm",
            "category": "Anime",
            "cover_image": cover,
            "source_url": media_obj.get("siteUrl") or f"https://anilist.co/anime/{al_id}",
            "next_episode_at": iso_str,
            "next_episode_number": int(ep_num),
        }
        res = call_upsert_rpc(entry)
        if res:
            count += 1

    print(f"AniList GraphQL synced {count} verified catalog anime schedules.")
    return count


def sync_tmdb_ongoing_series() -> int:
    """Checks TMDB next_episode_to_air for ongoing TV series in public.media and updates calendar_schedules + media."""
    print("--- [6/6] Syncing TMDB Live Airing Schedules for Ongoing Series ---")
    if not TMDB_API_KEY:
        print("TMDB_API_KEY not found, skipping TMDB schedule sync.")
        return 0

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/media?content_type=eq.dizi&status_broadcast=in.(%22Devam%20Ediyor%22,%22Yay%C4%B1nda%22)&tmdb_id=not.is.null&select=id,slug,title,tmdb_id,country_code,cover_image,status_broadcast,views_total&order=views_total.desc.nullslast&limit=150",
            headers=HEADERS,
            timeout=15,
        )
        ongoing_list = resp.json() if resp.status_code == 200 and isinstance(resp.json(), list) else []
    except Exception as e:
        print(f"Failed to query ongoing series from Supabase: {e}")
        return 0

    if not ongoing_list:
        return 0

    def _check_one(row: dict):
        tmdb_id = row.get("tmdb_id")
        if not tmdb_id:
            return None
        try:
            r = requests.get(
                f"https://api.themoviedb.org/3/tv/{tmdb_id}",
                params={"api_key": TMDB_API_KEY, "language": "tr-TR"},
                timeout=8,
            )
            if r.status_code != 200:
                return None
            data = r.json()
            tmdb_status = data.get("status") or ""
            next_ep = data.get("next_episode_to_air")
            if next_ep and next_ep.get("air_date"):
                return ("airing", row, next_ep, data)
            elif tmdb_status in ("Ended", "Canceled"):
                return ("ended", row, None, data)
        except Exception:
            pass
        return None

    airing_updates = 0
    ended_cleanups = 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_check_one, r) for r in ongoing_list]
        for fut in as_completed(futures):
            res = fut.result()
            if not res:
                continue
            kind, row, next_ep, tmdb_data = res
            if kind == "airing" and next_ep:
                air_date_str = next_ep.get("air_date")  # YYYY-MM-DD
                try:
                    dt_date = datetime.strptime(air_date_str, "%Y-%m-%d").date()
                    # Only include in weekly calendar if airing within the next 14 days (or past 2 days)
                    today_d = datetime.now(TR_TZ).date()
                    diff_days = (dt_date - today_d).days
                    day_num = dt_date.isoweekday()
                    dname = DAY_LABELS[day_num - 1]
                    iso_str = datetime(dt_date.year, dt_date.month, dt_date.day, 20, 0, 0, tzinfo=TR_TZ).isoformat()
                    ep_num = next_ep.get("episode_number") or 1
                    s_num = next_ep.get("season_number") or 1
                    ep_label = f"{s_num}. Sezon {ep_num}. Bölüm"

                    # Always update media.next_episode_at, media.next_episode_number, media.air_days
                    requests.patch(
                        f"{SUPABASE_URL}/rest/v1/media?id=eq.{row['id']}",
                        headers=HEADERS,
                        json={
                            "next_episode_at": iso_str,
                            "next_episode_number": int(ep_num),
                            "air_days": [day_num],
                        },
                        timeout=10,
                    )

                    if -2 <= diff_days <= 14:
                        cc = (row.get("country_code") or "").upper()
                        source_site = "dizikorea" if cc in ("KR", "CN", "JP", "TH", "TW") else "dizibox"
                        category = "K-Drama" if cc == "KR" else ("C-Drama" if cc == "CN" else "Dizi")
                        entry = {
                            "source_site": source_site,
                            "day_of_week": day_num,
                            "date_label": dname,
                            "title": row["title"][:100],
                            "slug": row["slug"],
                            "episode_label": ep_label,
                            "category": category,
                            "cover_image": row.get("cover_image") or "",
                            "source_url": f"https://www.themoviedb.org/tv/{row['tmdb_id']}",
                            "next_episode_at": iso_str,
                            "next_episode_number": int(ep_num),
                        }
                        if call_upsert_rpc(entry):
                            airing_updates += 1
                except Exception as e:
                    print(f"TMDB date parse error for {row['title']}: {e}")
            elif kind == "ended":
                ended_cleanups += 1

    print(f"TMDB Live Sync updated {airing_updates} airing seriesschedules (detected {ended_cleanups} ended series).")
    return airing_updates


def cleanup_stale_calendar_entries():
    """Removes calendar_schedules rows whose linked media is completed/canceled or unlinked stubs."""
    print("--- Cleaning up completed/stale calendar entries ---")
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/calendar_schedules?select=id,title,slug,source_site,day_of_week,media_id,media(id,slug,status_broadcast,release_year,episodes_available)",
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code != 200:
            return
        rows = resp.json()
        to_delete = []
        for r in rows:
            m = r.get("media")
            if m:
                st = m.get("status_broadcast") or ""
                yr = m.get("release_year") or 2026
                if st in ("Final", "Canceled") or (st == "Tamamlandı" and yr < 2026):
                    to_delete.append(r["id"])
        if to_delete:
            ids_csv = ",".join(str(x) for x in to_delete)
            requests.delete(
                f"{SUPABASE_URL}/rest/v1/calendar_schedules?id=in.({ids_csv})",
                headers=HEADERS,
                timeout=10,
            )
            print(f"Removed {len(to_delete)} completed/ended series from calendar_schedules.")
    except Exception as e:
        print(f"Cleanup warning: {e}")


if __name__ == "__main__":
    print("Starting KoUp Real Broadcast Calendar Synchronization v2...")
    w_count = sync_dizikorea()
    d_count = sync_dizibox()
    a_count = sync_animecix_calendar()
    asya_count = sync_asyaanimeleri_calendar()
    al_count = sync_anilist_airing_schedule()
    tmdb_count = sync_tmdb_ongoing_series()
    cleanup_stale_calendar_entries()
    total = w_count + d_count + a_count + asya_count + al_count + tmdb_count
    print("=================================================")
    print(f"SUCCESS: Total {total} real schedule items synced to public.calendar_schedules!")
