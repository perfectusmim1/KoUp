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

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from scrapers.multisite import add_source
from scrapers.shortdrama.common import (
    CHECKPOINT_DIR,
    clean_cover_image,
    clean_drama_overview,
    get_db_connection,
    get_or_create_episode,
    get_session,
    get_thread_session,
    load_checkpoint,
    safe_request,
    save_checkpoint,
    sync_short_drama_to_cloud,
    upsert_short_drama,
)

BASE_URL = "https://dramavadisi.com"


class DramaVadisiScraper:
    def __init__(self, session=None):
        self._session = session

    def _get_sess(self):
        return self._session if self._session is not None else get_thread_session()

    def get_catalog(self) -> list[str]:
        """Fetches all short drama URLs from DramaVadisi sitemap with local caching."""
        cache_file = CHECKPOINT_DIR / "dramavadisi_catalog.json"
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached_urls = json.load(f)
                    if cached_urls and len(cached_urls) > 500:
                        print(f"[DRAMAVADISI_CATALOG] Loaded {len(cached_urls)} URLs from local cache.")
                        return cached_urls
            except Exception:
                pass

        sitemap_url = f"{BASE_URL}/sitemap-diziler.xml"
        resp = safe_request(self._get_sess(), "GET", sitemap_url, delay=0.2, timeout=45)
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

        if clean_urls:
            try:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(clean_urls, f, ensure_ascii=False)
            except Exception:
                pass

        return clean_urls

    def resolve_series_id(self, slug: str, session=None) -> int | None:
        """Resolves internal series ID using lightweight PJAX endpoint."""
        sess = session or self._get_sess()
        ep1_url = f"{BASE_URL}/dizi/{slug}/1-bolum"
        resp = safe_request(
            sess,
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
        d_resp = safe_request(sess, "GET", f"{BASE_URL}/dizi/{slug}", delay=0.05)
        if d_resp and d_resp.status_code == 200:
            m = re.search(r'data-sid="(\d+)"', d_resp.text) or re.search(r'/api/series/(\d+)/watch', d_resp.text)
            if m:
                return int(m.group(1))

        return None

    def fetch_drama_network_data(self, drama_url: str) -> dict | None:
        """Fetches drama details and all episodes purely in memory without any DB lock."""
        sess = self._get_sess()
        slug = drama_url.rstrip("/").split("/")[-1]
        series_id = self.resolve_series_id(slug, session=sess)
        if not series_id:
            return None

        watch_url = f"{BASE_URL}/api/series/{series_id}/watch"
        w_resp = safe_request(
            sess,
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
        poster = clean_cover_image(poster_rel, base_url=BASE_URL)
        platform = data.get("label") or data.get("platform") or "NetShort"
        episodes = data.get("episodes", [])

        # Fetch overview from HTML page
        overview = None
        d_resp = safe_request(sess, "GET", drama_url, delay=0.05)
        if d_resp and d_resp.status_code == 200:
            soup = BeautifulSoup(d_resp.text, "html.parser")
            meta_desc = soup.find("meta", attrs={"name": "description"})
            if meta_desc and meta_desc.get("content"):
                overview = clean_drama_overview(meta_desc["content"])

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
        episodes = info.get("episodes", [])
        valid_episodes = [ep for ep in episodes if (ep.get("src") or "").strip()]
        if not valid_episodes:
            print(f"[DRAMAVADISI_SKIP] {info.get('slug')}: 0 valid episode streams found, skipping to prevent empty entry.")
            return None

        did = None
        sources_added = 0
        slug = info["slug"]
        title = info["title"]
        series_id = info["series_id"]
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

                if sources_added == 0:
                    conn.rollback()
                    conn.close()
                    print(f"[DRAMAVADISI_SKIP] #{slug}: No sources could be attached, rolled back.")
                    return None

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

    def write_batch_to_db(self, infos: list[dict], sync_cloud: bool = False) -> list[int]:
        """Writes a batch of dramas atomically in a single fast SQLite transaction (<50ms)."""
        ingested_ids = []
        if not infos:
            return ingested_ids

        for attempt in range(10):
            try:
                conn = get_db_connection()
                cur = conn.cursor()
                for info in infos:
                    if not info:
                        continue
                    episodes = info.get("episodes", [])
                    valid_eps = [ep for ep in episodes if (ep.get("src") or "").strip()]
                    if not valid_eps:
                        continue

                    slug = info["slug"]
                    title = info["title"]
                    series_id = info["series_id"]
                    ep_count = len(episodes)

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
                    src_count = 0
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
                            src_count += 1

                    if src_count > 0:
                        ingested_ids.append(did)

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(0.5)

        if sync_cloud and ingested_ids:
            for did in ingested_ids:
                sync_short_drama_to_cloud(did)

        return ingested_ids

    def scrape_drama(self, drama_url: str, sync_cloud: bool = True) -> int | None:
        """Scrapes full drama metadata and all episodes via /api/series/{id}/watch."""
        info = self.fetch_drama_network_data(drama_url)
        if not info:
            print(f"[DRAMAVADISI_WARN] Failed network fetch for {drama_url}")
            return None
        res = self.write_batch_to_db([info], sync_cloud=sync_cloud)
        return res[0] if res else None

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

        print(f"[DRAMAVADISI_PROGRESS] Processing {len(pending)} dramas (Already processed: {len(done)})...", flush=True)

        batch_size = 24
        all_new_ids = set()
        for i in range(0, len(pending), batch_size):
            batch_urls = pending[i:i + batch_size]
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                fetched_items = list(executor.map(self.fetch_drama_network_data, batch_urls))

            valid_items = [it for it in fetched_items if it]
            if valid_items:
                b_ids = self.write_batch_to_db(valid_items, sync_cloud=False)
                all_new_ids.update(b_ids)

            for url in batch_urls:
                slug = url.split("/")[-1]
                done.add(slug)

            save_checkpoint("dramavadisi", done)
            processed_count = min(i + batch_size, len(pending))
            if processed_count % 120 == 0 or processed_count == len(pending):
                print(f"[DRAMAVADISI_PROGRESS] {processed_count}/{len(pending)} processed ({len(all_new_ids)} dramas ingested)...", flush=True)

        print(f"[DRAMAVADISI_INGEST_COMPLETE] Finished network + DB ingest of {len(all_new_ids)} dramas.", flush=True)

        if sync_cloud and all_new_ids:
            print(f"[DRAMAVADISI_CLOUD_SYNC] Starting bulk cloud sync for {len(all_new_ids)} dramas...", flush=True)
            from scrapers.shortdrama.common import bulk_sync_short_dramas_to_cloud
            bulk_sync_short_dramas_to_cloud(list(all_new_ids))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = DramaVadisiScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
