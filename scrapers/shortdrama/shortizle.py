"""
Shortİzle (shortizle.com) Scraper
- Sitemap extraction (sitemap-titles-1..5.xml, 4,760+ short dramas)
- Inertia JSON parser for series and episode metadata
- Vidmoly / CDN video source extraction
- High-concurrency safe database writes & R2/Supabase cloud sync
"""

import json
import re
import sqlite3
import sys
import time
from bs4 import BeautifulSoup

from scrapers.multisite import add_source
from scrapers.shortdrama.common import (
    get_db_connection,
    get_or_create_episode,
    get_session,
    load_checkpoint,
    safe_request,
    save_checkpoint,
    sync_short_drama_to_cloud,
    upsert_short_drama,
)

BASE_URL = "https://shortizle.com"


class ShortizleScraper:
    def __init__(self, session=None):
        self.session = session or get_session()

    def get_catalog(self, max_sitemaps: int = 5) -> list[str]:
        """Fetches all drama URLs from Shortİzle title sitemaps."""
        drama_urls = []
        seen = set()

        # Check title sitemaps 1..max_sitemaps with generation token
        gen_tokens = ["?generation=4025c34a-c191-4bbc-84f1-e59463b0e7a0", ""]
        for i in range(1, max_sitemaps + 1):
            for tok in gen_tokens:
                sitemap_url = f"{BASE_URL}/sitemap-titles-{i}.xml{tok}"
                resp = safe_request(self.session, "GET", sitemap_url, delay=0.1)
                if resp and resp.status_code == 200 and "<loc>" in resp.text:
                    found = re.findall(r"<loc>(https://shortizle\.com/watch/[^<]+)</loc>", resp.text)
                    for u in found:
                        if u not in seen:
                            seen.add(u)
                            drama_urls.append(u)
                    break

        if not drama_urls:
            # Fallback to main sitemap index
            resp = safe_request(self.session, "GET", f"{BASE_URL}/sitemap.xml", delay=0.3)
            if resp and resp.status_code == 200:
                sitemaps = re.findall(r"<loc>(https://shortizle\.com/sitemap-titles-[^<]+)</loc>", resp.text)
                for sm in sitemaps:
                    sm_resp = safe_request(self.session, "GET", sm, delay=0.3)
                    if sm_resp and sm_resp.status_code == 200:
                        found = re.findall(r"<loc>(https://shortizle\.com/watch/[^<]+)</loc>", sm_resp.text)
                        for u in found:
                            if u not in seen:
                                seen.add(u)
                                drama_urls.append(u)

        return drama_urls

    def extract_inertia_data(self, html: str) -> dict | None:
        """Extracts Inertia JSON page props from HTML script tag or data-page attribute."""
        if not html:
            return None

        # 1. Search for script starting with {"component":"site/Watch"
        soup = BeautifulSoup(html, "html.parser")
        for s in soup.find_all("script"):
            txt = (s.string or s.text or "").strip()
            if "Watch" in txt and "externalSources" in txt and txt.startswith("{"):
                try:
                    return json.loads(txt)
                except Exception:
                    pass

        # 2. Search for div#app data-page
        app = soup.find(id="app")
        if app and app.get("data-page"):
            try:
                import html as html_lib
                return json.loads(html_lib.unescape(app["data-page"]))
            except Exception:
                pass

        # 3. Regex fallback
        m = re.search(r'data-page="([^"]+)"', html)
        if m:
            try:
                import html as html_lib
                return json.loads(html_lib.unescape(m.group(1)))
            except Exception:
                pass

        return None

    def extract_sources_from_ext(self, ext_dict: dict, ep_url: str = "") -> list[tuple[str, str, str]]:
        """Extracts playable sources: returns list of (display_name, direct_url, provider)."""
        sources = []
        if not ext_dict or not isinstance(ext_dict, dict):
            return sources

        watch_path = ""
        if ep_url:
            watch_path = ep_url.replace(BASE_URL, "")
            if not watch_path.startswith("/"):
                watch_path = "/" + watch_path

        for group_name in ("altyazi", "dublaj"):
            items = ext_dict.get(group_name, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                url = (item.get("url") or "").strip()
                resolve_url = (item.get("resolve_url") or "").strip()

                if url:
                    if url.startswith("/"):
                        url = f"{BASE_URL}{url}"
                    if "vidmoly" in url.lower():
                        embed_url = re.sub(r"vidmoly\.[a-z]+/([a-z0-9]+)", r"vidmoly.biz/embed-\1.html", url)
                        label = "Shortİzle (Türkçe Altyazı)" if group_name == "altyazi" else "Shortİzle (Türkçe Dublaj)"
                        sources.append((label, embed_url, "vidmoly"))
                    elif ".m3u8" in url.lower() or "b-cdn.net" in url.lower() or "mybigdramapool" in url.lower():
                        label = "Shortİzle (HLS Altyazılı)" if group_name == "altyazi" else "Shortİzle (HLS Dublaj)"
                        sources.append((label, url, "hls"))
                    elif ".mp4" in url.lower():
                        label = "Shortİzle (MP4)"
                        sources.append((label, url, "mp4"))
                    elif "/media/" in url.lower() or "shortizle.com" in url.lower():
                        label = "Shortİzle (Türkçe Altyazı)" if group_name == "altyazi" else "Shortİzle (Türkçe Dublaj)"
                        sources.append((label, url, "shortizle"))
                elif resolve_url:
                    base_media = resolve_url.split("?")[0]
                    if base_media.startswith("/"):
                        base_media = f"{BASE_URL}{base_media}"
                    if watch_path:
                        final_url = f"{base_media}?watch={watch_path}&kind={group_name}"
                    else:
                        final_url = f"{BASE_URL}{resolve_url}" if resolve_url.startswith("/") else resolve_url
                    label = "Shortİzle (Türkçe Altyazı)" if group_name == "altyazi" else "Shortİzle (Türkçe Dublaj)"
                    sources.append((label, final_url, "shortizle"))

        return sources

    def scrape_drama(self, drama_url: str, sync_cloud: bool = True) -> int | None:
        """Scrapes metadata and episodes for a single Shortİzle drama."""
        # 1. Network I/O phase (No DB connection held during HTTP)
        resp = safe_request(self.session, "GET", drama_url, delay=0.5)
        if not resp or resp.status_code != 200:
            print(f"[SHORTIZLE_WARN] Failed to fetch {drama_url}")
            return None

        data = self.extract_inertia_data(resp.text)
        if not data or "props" not in data:
            print(f"[SHORTIZLE_WARN] No Inertia data found in {drama_url}")
            return None

        props = data["props"]
        t = props.get("title", {})
        title = t.get("name") or drama_url.split("/")[-1].replace("-", " ").title()
        slug = t.get("slug") or drama_url.split("/")[-1]
        description = t.get("description") or ""

        poster = t.get("og_image_url") or t.get("poster")
        if not poster and "poster_gradient" in t and t["poster_gradient"]:
            m = re.search(r"url\(['\"]?([^'\")]+)['\"]?\)", t["poster_gradient"])
            if m:
                poster = m.group(1)
        if poster and not poster.startswith("http"):
            poster = f"{BASE_URL}{poster}"

        year = t.get("year")
        genres = [g.get("name") for g in t.get("genres", []) if isinstance(g, dict) and g.get("name")]
        if "Kısa Drama" not in genres:
            genres.append("Kısa Drama")

        seasons = t.get("seasons", [])
        episodes = seasons[0].get("episodes", []) if seasons else []
        ep_count = len(episodes)

        # Collect episode sources across all episodes
        episodes_data = []
        if episodes:
            # Ep 1 sources
            ep1_obj = episodes[0]
            ep1_num = ep1_obj.get("episode_number") or ep1_obj.get("number") or 1
            ep1_url = f"{BASE_URL}/watch/{slug}/1/{ep1_num}"
            ep1_ext = props.get("externalSources", {})
            ep1_sources = self.extract_sources_from_ext(ep1_ext, ep_url=ep1_url)
            if not ep1_sources:
                fallback_u = props.get("embedUrl") or props.get("videoUrl") or ep1_obj.get("video_url") or f"{BASE_URL}/embed/{slug}/1/{ep1_num}"
                if fallback_u.startswith("/"):
                    fallback_u = f"{BASE_URL}{fallback_u}"
                ep1_sources = [("Shortİzle (Türkçe Altyazı)", fallback_u, "shortizle")]
            episodes_data.append((ep1_num, ep1_obj.get("title") or f"{ep1_num}. Bölüm", ep1_url, ep1_sources))

            # Check if ep1 uses Shortİzle native resolve_url (/media/shortizle-live-alternate/...)
            active_resolve_groups = [
                g for g in ("altyazi", "dublaj")
                if any(isinstance(it, dict) and it.get("resolve_url") for it in (ep1_ext.get(g) or []))
            ]

            if active_resolve_groups:
                # Deterministic fast-path: no need to hammer 50-100 episode pages per drama;
                # /api/resolve-stream resolves each episode dynamically via ?watch=/watch/{slug}/1/{ep_num}&kind={g}
                for ep_idx, ep_obj in enumerate(episodes[1:], 2):
                    ep_num = ep_obj.get("episode_number") or ep_obj.get("number") or ep_idx
                    ep_url = f"{BASE_URL}/watch/{slug}/1/{ep_num}"
                    ep_Watch_path = f"/watch/{slug}/1/{ep_num}"
                    ep_sources = []
                    for g in active_resolve_groups:
                        lbl = "Shortİzle (Türkçe Altyazı)" if g == "altyazi" else "Shortİzle (Türkçe Dublaj)"
                        s_url = f"{BASE_URL}/media/shortizle-live-alternate/stream?watch={ep_Watch_path}&kind={g}"
                        ep_sources.append((lbl, s_url, "shortizle"))
                    episodes_data.append((ep_num, ep_obj.get("title") or f"{ep_num}. Bölüm", ep_url, ep_sources))
            else:
                # Fetch remaining episodes concurrently (e.g. when external Vidmoly embeds are used)
                from concurrent.futures import ThreadPoolExecutor

                def _fetch_shortizle_ep(item):
                    ep_idx, ep_obj = item
                    ep_num = ep_obj.get("episode_number") or ep_obj.get("number") or ep_idx
                    ep_url = f"{BASE_URL}/watch/{slug}/1/{ep_num}"
                    ep_resp = safe_request(self.session, "GET", ep_url, delay=0.05)
                    ep_sources = []
                    if ep_resp and ep_resp.status_code == 200:
                        ep_data = self.extract_inertia_data(ep_resp.text)
                        if ep_data:
                            ep_props = ep_data.get("props", {})
                            ep_ext = ep_props.get("externalSources", {})
                            ep_sources = self.extract_sources_from_ext(ep_ext, ep_url=ep_url)
                    if not ep_sources:
                        fallback_u = ep_obj.get("video_url") or f"{BASE_URL}/embed/{slug}/1/{ep_num}"
                        if fallback_u.startswith("/"):
                            fallback_u = f"{BASE_URL}{fallback_u}"
                        ep_sources = [("Shortİzle (Türkçe Altyazı)", fallback_u, "shortizle")]
                    return (ep_num, ep_obj.get("title") or f"{ep_num}. Bölüm", ep_url, ep_sources)

                with ThreadPoolExecutor(max_workers=8) as executor:
                    episodes_data.extend(list(executor.map(_fetch_shortizle_ep, enumerate(episodes[1:], 2))))

        # 2. Fast atomic database transaction phase with retry
        did = None
        sources_added = 0
        for attempt in range(10):
            try:
                conn = get_db_connection()
                cur = conn.cursor()

                did, final_slug, is_new = upsert_short_drama(
                    conn=conn,
                    cur=cur,
                    title=title,
                    slug=slug,
                    cover_image=poster,
                    overview=description,
                    release_year=year,
                    episode_count=ep_count,
                    genres=genres,
                    site_tag="shortizle",
                    source_url=drama_url,
                    country="CN",
                    country_name="Çin",
                )

                for ep_num, ep_name, ep_url, ep_sources in episodes_data:
                    ep_db_id = get_or_create_episode(
                        cur=cur,
                        drama_id=did,
                        episode_number=ep_num,
                        season_number=1,
                        episode_name=ep_name,
                        episode_url=ep_url,
                    )
                    for s_name, s_url, s_prov in ep_sources:
                        if add_source(cur, ep_db_id, s_name, s_url, s_prov, "shortizle"):
                            sources_added += 1

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        print(f"[SHORTIZLE_INGESTED] #{did} {title}: {ep_count} eps, {sources_added} sources.")

        # 3. Cloud sync phase
        if sync_cloud and did:
            sync_short_drama_to_cloud(did)

        return did

    def run(self, limit: int = None, resume: bool = True, sync_cloud: bool = True):
        """Runs the Shortİzle catalog ingestion with checkpointing."""
        print("[SHORTIZLE_CATALOG] Fetching sitemaps...")
        catalog = self.get_catalog(max_sitemaps=5)
        print(f"[SHORTIZLE_CATALOG] Found {len(catalog)} drama URLs.")
        if not catalog:
            return

        done = load_checkpoint("shortizle") if resume else set()
        pending = [u for u in catalog if u.split("/")[-1] not in done]

        if limit:
            pending = pending[:limit]

        print(f"[SHORTIZLE_PROGRESS] Processing {len(pending)} dramas (Already processed: {len(done)})...")
        for idx, drama_url in enumerate(pending, 1):
            slug = drama_url.split("/")[-1]
            print(f"[{idx}/{len(pending)}] Scraping Shortİzle: {slug}...")
            try:
                self.scrape_drama(drama_url, sync_cloud=sync_cloud)
                done.add(slug)
                save_checkpoint("shortizle", done)
            except Exception as e:
                print(f"[SHORTIZLE_ITEM_ERROR] {slug}: {e}", file=sys.stderr)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = ShortizleScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
