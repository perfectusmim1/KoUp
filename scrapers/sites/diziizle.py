"""
DiziIzle.wiki Scraper & Stream Resolver & Live Calendar Syncer.
Features:
- Pilavyer Player (play2.pilavyerplay.top) HLS stream extraction and live verification
- Full Turkish TV series and anime catalog parsing (JSON-LD TVSeries + TMDB enrichment)
- Live Calendar (/takvim) parser syncing to public.calendar_schedules & media.air_days
"""

import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urljoin, urlparse

try:
    from zoneinfo import ZoneInfo
    TR_TZ = ZoneInfo("Europe/Istanbul")
except Exception:
    TR_TZ = timezone(timedelta(hours=3))

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

import requests
from bs4 import BeautifulSoup

from scrapers.domain_resolver import get_site_base_url
from scrapers.multisite import (
    add_source,
    build_drama_index,
    clean_episode_title,
    clean_scraped_slug,
    find_in_index,
    match_or_create_episode,
)
from scrapers.supabase_sync_helper import (
    SUPABASE_KEY,
    SUPABASE_URL,
    backup_db_to_r2,
    match_or_create_enriched_drama,
    sb_request,
    sync_drama_bundle_and_counts,
)

DEFAULT_BASE_URL = "https://diziizle.wiki"
DAY_MAP = {
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
DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]


def _get_base() -> str:
    return get_site_base_url("diziizle", DEFAULT_BASE_URL)


def _safe_fetch(url: str, headers: dict = None, timeout: int = 12) -> str:
    h = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    }
    if headers:
        h.update(headers)

    if cfr:
        try:
            r = cfr.get(url, headers=h, impersonate="chrome", timeout=timeout)
            if r.status_code == 200:
                return r.text
        except Exception:
            pass
    try:
        r = requests.get(url, headers=h, timeout=timeout)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return ""


def compute_next_occurrence_iso(day_of_week: int, hour: int = 20) -> str:
    now_tr = datetime.now(TR_TZ)
    today_dow = now_tr.isoweekday()
    days_ahead = (day_of_week - today_dow) % 7
    target_date = (now_tr + timedelta(days=days_ahead)).date()
    target_dt = datetime(
        target_date.year, target_date.month, target_date.day, hour, 0, 0, tzinfo=TR_TZ
    )
    return target_dt.isoformat()


def extract_ep_number(episode_label: str) -> int | None:
    if not episode_label:
        return None
    m = re.search(r"(?:Sezon\s+)?(\d+)(?:-\d+)?\.\s*Bölüm", episode_label, re.IGNORECASE)
    if m:
        return int(m.group(1))
    m2 = re.search(r"(\d+)", episode_label)
    if m2 and "sezon" not in episode_label.lower():
        return int(m2.group(1))
    return None


def batch_calendar_upsert(items: list[dict]) -> int:
    """Batch upserts calendar schedule items directly to Supabase with 0 timeouts."""
    if not items:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    rest_url = f"{SUPABASE_URL}/rest/v1/calendar_schedules"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    rows = []
    for it in items:
        day_num = int(it["day_of_week"])
        ep_label = it.get("episode_label", "")
        next_ep_at = it.get("next_episode_at") or compute_next_occurrence_iso(day_num)
        next_ep_num = it.get("next_episode_number") or extract_ep_number(ep_label)
        rows.append({
            "source_site": "diziizle",
            "day_of_week": day_num,
            "date_label": it.get("date_label") or DAY_NAMES[day_num - 1],
            "title": it["title"],
            "slug": it["slug"],
            "episode_label": ep_label,
            "category": it.get("category", "Dizi"),
            "cover_image": it.get("cover_image", ""),
            "source_url": it.get("source_url", ""),
            "next_episode_at": next_ep_at,
            "next_episode_number": next_ep_num,
            "updated_at": now_iso,
        })

    # Chunk in batches of 40
    saved = 0
    for i in range(0, len(rows), 40):
        batch = rows[i:i + 40]
        try:
            r = requests.post(
                f"{rest_url}?on_conflict=source_site,day_of_week,slug",
                headers=headers,
                json=batch,
                timeout=20,
            )
            if r.status_code in (200, 201, 204):
                saved += len(batch)
            else:
                # Try single RPC fallback if REST returns schema error
                for it in batch:
                    if call_calendar_upsert(it):
                        saved += 1
        except Exception as e:
            print(f"[CALENDAR_BATCH_WARN] Batch error: {e}", flush=True)
            for it in batch:
                if call_calendar_upsert(it):
                    saved += 1
    return saved


def verify_pilavyer_stream(pv_slug: str, base_url: str = DEFAULT_BASE_URL) -> bool:
    """Checks if play2.pilavyerplay.top stream is active and returns valid HLS stream."""
    if not pv_slug:
        return False
    check_url = f"https://play2.pilavyerplay.top/assets/js/s.php?s={pv_slug}"
    headers = {
        "Referer": f"{base_url}/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }
    text = _safe_fetch(check_url, headers=headers, timeout=10)
    if not text:
        return False
    return "stream.php" in text or ".m3u8" in text or "__PLAYER__" in text


def sync_diziizle_calendar(conn=None, cur=None) -> int:
    """
    Parses https://diziizle.wiki/takvim and syncs weekly broadcast schedule.
    Updates Supabase calendar_schedules and media.air_days.
    """
    base_url = _get_base()
    takvim_url = f"{base_url}/takvim"
    html = _safe_fetch(takvim_url)
    if not html:
        print(f"[DIZIIZLE CALENDAR] Could not load {takvim_url}", flush=True)
        return 0

    soup = BeautifulSoup(html, "html.parser")
    sections = soup.find_all("section")
    if not sections:
        print("[DIZIIZLE CALENDAR] No day sections found on takvim page", flush=True)
        return 0

    count = 0
    air_days_updates = {}
    all_items = []

    for sec in sections:
        # Determine day name
        day_el = sec.select_one("p.font-display")
        if not day_el:
            continue
        day_text = day_el.get_text(strip=True).lower()
        day_num = DAY_MAP.get(day_text)
        if not day_num:
            for k, v in DAY_MAP.items():
                if k in day_text:
                    day_num = v
                    break
        if not day_num:
            continue

        canonical_day_name = DAY_NAMES[day_num - 1]

        # Process series cards in this section
        cards = sec.select("a[href*='/dizi/'], a[href*='/anime/']")
        for c in cards:
            href = c.get("href", "")
            if not href:
                continue
            full_url = urljoin(base_url, href)
            m_slug = re.search(r"/(?:dizi|anime)/([^/]+)", full_url)
            slug = m_slug.group(1) if m_slug else href.strip("/").split("/")[-1]

            h3_el = c.select_one("h3")
            title = h3_el.get_text(strip=True) if h3_el else slug.replace("-", " ").title()

            p_el = c.select_one("p")
            ep_label = p_el.get_text(strip=True) if p_el else "Yeni Bölüm"

            img_el = c.select_one("img")
            img_src = img_el.get("src", "") if img_el else ""

            badge_el = c.select_one("span.badge")
            category = badge_el.get_text(strip=True) if badge_el else "Dizi"

            # Platform / Network name
            network = ""
            net_img = c.select_one("img[alt]")
            if net_img and net_img.get("alt") and net_img.get("alt") != title:
                network = net_img.get("alt")
            else:
                net_span = c.select_one("span.truncate")
                if net_span:
                    network = net_span.get_text(strip=True)

            item = {
                "title": title,
                "slug": slug,
                "day_of_week": day_num,
                "date_label": canonical_day_name,
                "episode_label": ep_label,
                "category": category,
                "cover_image": img_src,
                "source_url": full_url,
                "network": network,
            }
            all_items.append(item)
            air_days_updates.setdefault(slug, []).append(canonical_day_name)

    count = batch_calendar_upsert(all_items)

    # Update media.air_days in Supabase & SQLite where series exists
    if air_days_updates:
        for s_slug, days_list in air_days_updates.items():
            unique_days = list(dict.fromkeys(days_list))
            try:
                # 1. Update SQLite dramas if available
                if cur and conn:
                    cur.execute("SELECT id, air_days FROM dramas WHERE slug = ? OR slug LIKE ?", (s_slug, f"%{s_slug}%"))
                    d_row = cur.fetchone()
                    if d_row:
                        did, curr_days_raw = d_row
                        curr_days = []
                        if curr_days_raw:
                            try:
                                curr_days = json.loads(curr_days_raw) if isinstance(curr_days_raw, str) else curr_days_raw
                            except Exception:
                                curr_days = [x.strip() for x in str(curr_days_raw).split(",") if x.strip()]
                        merged_days = list(dict.fromkeys(curr_days + unique_days))
                        cur.execute("UPDATE dramas SET air_days = ? WHERE id = ?", (json.dumps(merged_days, ensure_ascii=False), did))
                        conn.commit()

                # 2. Update Supabase media
                sb_request("PATCH", f"/rest/v1/media?slug=eq.{s_slug}", body={"air_days": unique_days})
            except Exception:
                pass

    print(f"[DIZIIZLE CALENDAR] Successfully synced {count} broadcast entries across 7 days.", flush=True)
    return count


def _extract_pv_from_html(html: str) -> str | None:
    if not html:
        return None
    # 1. Check data-pv attribute
    m = re.search(r'data-pv=["\']([^"\']+)["\']', html)
    if m:
        return m.group(1).strip()
    # 2. Check s.php?s= URL parameter
    m2 = re.search(r's\.php\?s=([a-zA-Z0-9_\-]+)', html)
    if m2:
        return m2.group(1).strip()
    return None


def scrape_diziizle_series(
    cur,
    conn,
    series_url: str,
    idx: dict = None,
    is_anime: bool = False,
    max_episodes: int = 50,
) -> dict:
    """
    Scrapes a single drama/anime from diziizle.wiki:
    - Parses Schema.org TVSeries / TMDB
    - Upserts drama in SQLite and Supabase
    - Extracts all episode URLs and Pilavyer HD player streams
    - Verifies streams live and adds to episode_sources
    """
    base_url = _get_base()
    full_series_url = urljoin(base_url, series_url)
    html = _safe_fetch(full_series_url)
    if not html:
        return {"error": f"Failed to fetch {full_series_url}", "episodes_added": 0, "sources_added": 0}

    soup = BeautifulSoup(html, "html.parser")

    # 1. Extract JSON-LD TVSeries
    title = ""
    overview = ""
    cover_image = ""
    year = None
    genres = []

    for s_tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(s_tag.string)
            graph = data.get("@graph", [data]) if isinstance(data, dict) else [data]
            for node in graph:
                if isinstance(node, dict) and node.get("@type") in ("TVSeries", "Series", "CreativeWorkSeries"):
                    title = node.get("name") or title
                    overview = node.get("description") or overview
                    cover_image = node.get("image") or cover_image
                    if node.get("startDate"):
                        try:
                            year = int(str(node["startDate"])[:4])
                        except Exception:
                            pass
                    if node.get("genre"):
                        g = node["genre"]
                        genres = g if isinstance(g, list) else [g]
        except Exception:
            pass

    # Fallbacks from page HTML
    if not title:
        h1 = soup.select_one("h1")
        title = h1.get_text(strip=True) if h1 else ""
    if not title:
        title = soup.title.get_text(strip=True).split("-")[0].strip() if soup.title else ""

    m_slug = re.search(r"/(?:dizi|anime)/([^/]+)", full_series_url)
    slug = m_slug.group(1) if m_slug else full_series_url.strip("/").split("/")[-1]
    slug = clean_scraped_slug(slug)

    content_type = "anime" if (is_anime or "/anime/" in full_series_url) else "dizi"

    if idx is None:
        idx = build_drama_index(cur)

    # 2. Match or create enriched drama
    drama_id, d_title, d_slug, d_cover = match_or_create_enriched_drama(
        conn=conn,
        cur=cur,
        idx=idx,
        raw_title=title,
        slug_cand=slug,
        content_type=content_type,
        country_hint="JP" if is_anime else "TR",
        site_tag="diziizle",
        source_url=full_series_url,
        year_hint=year,
    )

    # 3. Find all seasons and episode links (newest seasons first)
    season_nums = []
    for a in soup.find_all("a", href=True):
        m_s = re.search(r"[?&]sezon=(\d+)", a["href"])
        if m_s:
            s_val = int(m_s.group(1))
            if s_val not in season_nums:
                season_nums.append(s_val)

    ep_links = []
    if season_nums:
        season_nums.sort(reverse=True)
        # Fetch newest seasons first to guarantee active Pilavyer HD streams
        for s_n in season_nums[:3]:
            s_url = f"{full_series_url}?sezon={s_n}"
            s_html = _safe_fetch(s_url) if (s_n != 1 or "?sezon=1" in full_series_url) else html
            if s_html:
                s_soup = BeautifulSoup(s_html, "html.parser")
                for a in s_soup.find_all("a", href=True):
                    h = a["href"]
                    if f"/sezon-{s_n}/" in h and "/bolum-" in h and h not in ep_links:
                        ep_links.append(h)

    # Fallback to current page links
    if not ep_links:
        for a in soup.find_all("a", href=True):
            h = a["href"]
            if "/sezon-" in h and "/bolum-" in h and h not in ep_links:
                ep_links.append(h)

    # Sort episodes by season and episode number
    def _ep_sort_key(u):
        sm = re.search(r"sezon-(\d+)", u)
        em = re.search(r"bolum-(\d+)", u)
        return (int(sm.group(1)) if sm else 1, int(em.group(1)) if em else 1)

    ep_links.sort(key=_ep_sort_key)
    if max_episodes and len(ep_links) > max_episodes:
        # Prioritize newest episodes if count exceeds max_episodes
        ep_links = ep_links[-max_episodes:]

    episodes_added = 0
    sources_added = 0
    sample_sources = []

    for ep_href in ep_links:
        full_ep_url = urljoin(base_url, ep_href)
        s_m = re.search(r"sezon-(\d+)", ep_href)
        e_m = re.search(r"bolum-(\d+)", ep_href)
        season_num = int(s_m.group(1)) if s_m else 1
        ep_num = int(e_m.group(1)) if e_m else 1

        ep_name = f"{season_num}. Sezon {ep_num}. Bölüm"
        ep_id, is_new = match_or_create_episode(cur, drama_id, season_num, ep_num, ep_name, full_ep_url)
        if is_new:
            episodes_added += 1

        # Check if pilavyer source already exists for this episode
        cur.execute(
            "SELECT id, direct_url FROM episode_sources WHERE episode_id = ? AND (provider = 'pilavyer' OR direct_url LIKE '%pilavyerplay%')",
            (ep_id,),
        )
        existing_src = cur.fetchone()
        if existing_src:
            continue

        # Fetch episode page HTML
        ep_html = _safe_fetch(full_ep_url)
        pv_slug = _extract_pv_from_html(ep_html)
        if not pv_slug:
            continue

        # Live stream check
        if verify_pilavyer_stream(pv_slug, base_url):
            pilavyer_url = f"https://play2.pilavyerplay.top/assets/js/s.php?s={pv_slug}"
            added = add_source(
                cur,
                episode_id=ep_id,
                source_name="Diziİzle (Pilavyer HD)",
                direct_url=pilavyer_url,
                provider="pilavyer",
                site="diziizle",
            )
            if added:
                sources_added += 1
                sample_sources.append(pilavyer_url)
                # Prioritize pilavyer over existing youtube sources
                cur.execute(
                    "UPDATE episode_sources SET provider = 'youtube_backup' WHERE episode_id = ? AND provider = 'youtube'",
                    (ep_id,),
                )
                conn.commit()

    # 4. Sync full bundle, counts, R2 and Supabase
    if episodes_added > 0 or sources_added > 0:
        sync_drama_bundle_and_counts(conn, cur, drama_id)

    return {
        "drama_id": drama_id,
        "title": d_title,
        "slug": d_slug,
        "episodes_total": len(ep_links),
        "episodes_added": episodes_added,
        "sources_added": sources_added,
        "sample_sources": sample_sources[:3],
    }


def crawl_diziizle_recent(
    cur,
    conn,
    idx: dict = None,
    limit: int = 5,
    max_episodes_per_series: int = 30,
    target_urls: list[str] = None,
) -> list[dict]:
    """
    Crawls recent series from diziizle.wiki homepage and sitemap.
    Targeting active Turkish dramas and recent uploads.
    """
    base_url = _get_base()
    candidates = list(target_urls) if target_urls else []

    # Discover candidate series from homepage
    home_html = _safe_fetch(base_url)
    if home_html:
        soup = BeautifulSoup(home_html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/dizi/" in href and "/sezon-" not in href:
                full_u = urljoin(base_url, href)
                if full_u not in candidates:
                    candidates.append(full_u)

    # Discover additional Turkish series from sitemap-series.xml
    sitemap_html = _safe_fetch(f"{base_url}/sitemap-series.xml")
    if sitemap_html:
        tr_keywords = [
            "gonul-dagi", "kizilcik-serbeti", "yali-capkini", "bahar",
            "tasacak-bu-deniz", "guller-ve-gunahlar", "guldur-guldur-show",
            "kardesler", "teskilat", "inci-taneleri", "kod-adi-paris"
        ]
        for line in sitemap_html.splitlines():
            if "<loc>" in line:
                m = re.search(r"<loc>(https?://[^<]+)</loc>", line)
                if m:
                    u = m.group(1).strip()
                    if any(k in u for k in tr_keywords) and u not in candidates:
                        candidates.insert(0, u)  # Prepend high-priority Turkish series

    if idx is None:
        idx = build_drama_index(cur)

    results = []
    for s_url in candidates[:limit]:
        print(f"[DIZIIZLE CRAWL] Scraping {s_url}...", flush=True)
        res = scrape_diziizle_series(
            cur=cur,
            conn=conn,
            series_url=s_url,
            idx=idx,
            max_episodes=max_episodes_per_series,
        )
        results.append(res)
        time.sleep(1.0)

    return results
