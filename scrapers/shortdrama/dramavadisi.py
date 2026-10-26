"""
DramaVadisi (dramavadisi.com) Scraper
- High-volume sitemap extraction (sitemap-diziler.xml, 3,912+ short dramas)
- Fast series ID resolution via PJAX
- Single-request full episode catalog ingestion (/api/series/{id}/watch)
- Concurrent network I/O with atomic single-thread DB writes & R2/Supabase cloud sync
"""

import json
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
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

BASE_URL = "https://dramavadisi.com"


class DramaVadisiScraper:
    def __init__(self, session=None):
        self.session = session or get_session()

    def get_catalog(self) -> list[str]:
        """Fetches all short drama URLs from DramaVadisi sitemap."""
        sitemap_url = f"{BASE_URL}/sitemap-diziler.xml"
        resp = safe_request(self.session, "GET", sitemap_url, delay=0.2)
        if not resp or resp.status_code != 200:
            return []

        urls = re.findall(r"<loc>(https://dramavadisi\.com/dizi/[^<]+)</loc>", resp.text)
        clean_urls = []
        seen = set()
        for u in urls:
            u_clean = u.rstrip("/")
            if u_clean not in seen and not any(u_clean.endswith(f"-{k}") for k in ("bolum", "fragman")):
                seen.add(u_clean)
                clean_urls.append(u_clean)

        return clean_urls

    def resolve_series_id(self, slug: str) -> int | None:
        """Resolves internal series ID using lightweight PJAX endpoint."""
        ep1_url = f"{BASE_URL}/dizi/{slug}/1-bolum"
        resp = safe_request(
            self.session,
            "GET",
            ep1_url,
            delay=0.05,
            headers={"X-Pjax": "1", "Referer": f"{BASE_URL}/dizi/{slug}"},
        )
        if resp and resp.status_code == 200:
            try:
                pjax_json = resp.json()
                player_info = pjax_json.get("player", {})
                sid = player_info.get("id")
                if sid:
                    return int(sid)
            except Exception:
                pass

        # Fallback: request HTML and extract data-sid or regex
        d_resp = safe_request(self.session, "GET", f"{BASE_URL}/dizi/{slug}", delay=0.05)
        if d_resp and d_resp.status_code == 200:
            m = re.search(r'data-sid="(\d+)"', d_resp.text) or re.search(r'/api/series/(\d+)/watch', d_resp.text)
            if m:
                return int(m.group(1))

        return None

    def fetch_drama_network_data(self, drama_url: str) -> dict | None:
        """Fetches drama details and all episodes purely in memory without any DB lock."""
        slug = drama_url.rstrip("/").split("/")[-1]
        series_id = self.resolve_series_id(slug)
        if not series_id:
            return None

        watch_url = f"{BASE_URL}/api/series/{series_id}/watch"
        w_resp = safe_request(
            self.session,
            "GET",
            watch_url,
            delay=0.1,
            headers={"Referer": drama_url},
        )
        if not w_resp or w_resp.status_code != 200:
            return None

        try:
            data = w_resp.json()
        except Exception:
            return None

        title = data.get("title") or data.get("name") or slug.replace("-", " ").title()
        poster_rel = data.get("poster")
        poster = f"{BASE_URL}{poster_rel}" if poster_rel and not poster_rel.startswith("http") else poster_rel
        platform = data.get("label") or data.get("platform") or "NetShort"
        episodes = data.get("episodes", [])

        # Fetch overview from HTML page
        overview = None
        d_resp = safe_request(self.session, "GET", drama_url, delay=0.05)
        if d_resp and d_resp.status_code == 200:
            soup = BeautifulSoup(d_resp.text, "html.parser")
            meta_desc = soup.find("meta", attrs={"name": "description"})
            if meta_desc and meta_desc.get("content"):
                overview = meta_desc["content"]

        return {
            "slug": slug,
            "series_id": series_id,
            "title": title,
            "poster": poster,
            "platform": platform,
            "overview": overview,
            "episodes": episodes,
            "source_url": drama_url,
        }

    def write_drama_to_db(self, info: dict, sync_cloud: bool = True) -> int | None:
        """Writes drama and episodes atomically to SQLite on main thread and syncs to cloud."""
        did = None
        sources_added = 0
        slug = info["slug"]
        title = info["title"]
        series_id = info["series_id"]
        episodes = info["episodes"]
        ep_count = len(episodes)

        for attempt in range(10):
            try:
                conn = get_db_connection()
                cur = conn.cursor()

                did, final_slug, is_new = upsert_short_drama(
                    conn=conn,
                    cur=cur,
                    title=title,
                    slug=slug,
                    cover_image=info["poster"],
                    overview=info["overview"],
                    episode_count=ep_count,
                    genres=["Kısa Drama", info["platform"]],
                    site_tag="dramavadisi",
                    source_url=info["source_url"],
                    country="CN",
                    country_name="Çin",
                )

                for ep_obj in episodes:
                    ep_no = ep_obj.get("no") or 1
                    season_no = ep_obj.get("season") or 1
                    src_url = (ep_obj.get("src") or "").strip()

                    if not src_url:
                        continue

                    ep_url = f"{BASE_URL}/dizi/{slug}/{ep_no}-bolum"
                    ep_id = get_or_create_episode(
                        cur=cur,
                        drama_id=did,
                        episode_number=ep_no,
                        season_number=season_no,
                        episode_name=f"{ep_no}. Bölüm",
                        episode_url=ep_url,
                    )

                    direct_stream_token = f"dramavadisi:{series_id}:{ep_no}"
                    if add_source(
                        cur=cur,
                        episode_id=ep_id,
                        source_name="DramaVadisi (HD)",
                        direct_url=direct_stream_token,
                        provider="dramavadisi",
                        site="dramavadisi",
                    ):
                        sources_added += 1

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        print(f"[DRAMAVADISI_INGESTED] #{did} {title}: {ep_count} eps, {sources_added} sources.")

        if sync_cloud and did:
            sync_short_drama_to_cloud(did)

        return did

    def scrape_drama(self, drama_url: str, sync_cloud: bool = True) -> int | None:
        """Scrapes full drama metadata and all episodes via /api/series/{id}/watch."""
        info = self.fetch_drama_network_data(drama_url)
        if not info:
            print(f"[DRAMAVADISI_WARN] Failed network fetch for {drama_url}")
            return None
        return self.write_drama_to_db(info, sync_cloud=sync_cloud)

    def run(self, limit: int = None, resume: bool = True, sync_cloud: bool = True):
        """Runs the DramaVadisi catalog ingestion in high-speed parallel batches."""
        print("[DRAMAVADISI_CATALOG] Fetching sitemap...")
        catalog = self.get_catalog()
        print(f"[DRAMAVADISI_CATALOG] Found {len(catalog)} short drama URLs.")
        if not catalog:
            return

        done = load_checkpoint("dramavadisi") if resume else set()
        pending = [u for u in catalog if u.split("/")[-1] not in done]

        if limit:
            pending = pending[:limit]

        print(f"[DRAMAVADISI_PROGRESS] Processing {len(pending)} dramas (Already processed: {len(done)})...")

        # Process in parallel batches of 10 for network fetching
        batch_size = 10
        for i in range(0, len(pending), batch_size):
            batch_urls = pending[i:i + batch_size]
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                fetched_items = list(executor.map(self.fetch_drama_network_data, batch_urls))

            for url, info in zip(batch_urls, fetched_items):
                slug = url.split("/")[-1]
                if not info:
                    print(f"[DRAMAVADISI_SKIP] Could not fetch {slug}")
                    continue
                try:
                    self.write_drama_to_db(info, sync_cloud=sync_cloud)
                    done.add(slug)
                    save_checkpoint("dramavadisi", done)
                except Exception as e:
                    print(f"[DRAMAVADISI_ITEM_ERROR] {slug}: {e}", file=sys.stderr)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = DramaVadisiScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
