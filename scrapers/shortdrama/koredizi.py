"""
KoreDizi (koredizi.com) Scraper
- Automated authentication with CSRF/anti-bot timer handling
- Full catalog extraction (~67 dramas)
- Login-gated episode traversal (1..N)
- dtpasn.asia video verification and source injection
- High-concurrency safe database writes & R2/Supabase cloud sync
"""

import os
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
    load_env,
    safe_request,
    save_checkpoint,
    sync_short_drama_to_cloud,
    upsert_short_drama,
)

BASE_URL = "https://koredizi.com"


class KoreDiziScraper:
    def __init__(self, session=None):
        load_env()
        self.session = session or get_session()
        self.logged_in = False

    def login(self) -> bool:
        """Logs into KoreDizi using credentials from environment."""
        email = os.environ.get("KOREDIZI_EMAIL", "")
        password = os.environ.get("KOREDIZI_PASSWORD", "")
        if not email or not password:
            print("[KOREDIZI_LOGIN_WARN] KOREDIZI_EMAIL or KOREDIZI_PASSWORD missing from env.")
            return False

        try:
            resp = self.session.get(f"{BASE_URL}/", timeout=15)
            if not resp or resp.status_code != 200:
                print(f"[KOREDIZI_LOGIN_ERROR] Cannot fetch homepage: {resp.status_code if resp else 'None'}")
                return False

            soup = BeautifulSoup(resp.text, "html.parser")
            form = soup.find("form", id="loginForm")
            if not form:
                print("[KOREDIZI_LOGIN_ERROR] loginForm not found on homepage.")
                return False

            csrf_token = form.find("input", {"name": "csrf_token"})
            form_time = form.find("input", {"name": "form_time"})
            if not csrf_token or not form_time:
                print("[KOREDIZI_LOGIN_ERROR] CSRF tokens missing.")
                return False

            # KoreDizi server requires >= 2.5s anti-bot delay
            time.sleep(2.6)

            payload = {
                "csrf_token": csrf_token["value"],
                "form_time": form_time["value"],
                "website": "",
                "login": email,
                "password": password,
            }
            headers = {
                "Referer": f"{BASE_URL}/",
                "X-Requested-With": "XMLHttpRequest",
            }
            post_resp = self.session.post(f"{BASE_URL}/giris", data=payload, headers=headers, timeout=15)
            if post_resp and post_resp.status_code == 200:
                try:
                    res_json = post_resp.json()
                    if res_json.get("ok"):
                        print("[KOREDIZI_LOGIN_OK] Successfully authenticated with email.")
                        self.logged_in = True
                        return True
                except Exception:
                    pass

            # Fallback: try username part before @
            username = email.split("@")[0] if "@" in email else email
            time.sleep(2.6)
            payload["login"] = username
            post_resp2 = self.session.post(f"{BASE_URL}/giris", data=payload, headers=headers, timeout=15)
            if post_resp2 and post_resp2.status_code == 200:
                try:
                    res_json2 = post_resp2.json()
                    if res_json2.get("ok"):
                        print("[KOREDIZI_LOGIN_OK] Successfully authenticated with username.")
                        self.logged_in = True
                        return True
                except Exception:
                    pass

            print("[KOREDIZI_LOGIN_FAIL] Could not authenticate to KoreDizi.")
            return False
        except Exception as e:
            print(f"[KOREDIZI_LOGIN_EXCEPTION] {e}")
            return False

    def get_catalog(self) -> list[dict]:
        """Fetches all short dramas from KoreDizi directory."""
        resp = safe_request(self.session, "GET", f"{BASE_URL}/diziler", delay=0.5)
        if not resp or resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        items = []
        seen_slugs = set()

        for card in soup.find_all("a", href=re.compile(r"/dizi/")):
            href = card.get("href", "")
            if not href or href == "/diziler":
                continue
            slug = href.strip("/").split("/")[-1]
            if not slug or slug in seen_slugs or slug in ("diziler", "populer"):
                continue
            seen_slugs.add(slug)

            # Extract title and cover
            img = card.find("img")
            cover = img.get("src") if img else None
            if cover and not cover.startswith("http"):
                cover = f"{BASE_URL}{cover}"

            title_elem = card.find(class_=re.compile(r"title|name", re.I)) or card.find(["h2", "h3", "h4", "h5", "p", "span"])
            title = title_elem.get_text(strip=True) if title_elem else slug.replace("-", " ").title()

            full_url = href if href.startswith("http") else f"{BASE_URL}{href}"
            items.append({
                "slug": slug,
                "title": title,
                "cover_image": cover,
                "url": full_url,
            })

        return items

    def verify_dtpasn_video(self, video_hash: str) -> bool:
        """Verifies that dtpasn.asia returns a valid HLS stream for the video hash."""
        if not video_hash:
            return False
        try:
            v_url = f"https://dtpasn.asia/player/index.php?data={video_hash}&do=getVideo"
            headers = {
                "Referer": f"https://dtpasn.asia/video/{video_hash}",
                "Origin": "https://dtpasn.asia",
                "X-Requested-With": "XMLHttpRequest",
            }
            v_res = self.session.post(v_url, data={"r": f"{BASE_URL}/"}, headers=headers, timeout=10)
            if v_res and v_res.status_code == 200:
                txt = v_res.text
                return ("securedLink" in txt or "videoSource" in txt or ".m3u8" in txt or '"hls":true' in txt)
        except Exception:
            pass
        return False

    def scrape_drama(self, item: dict, sync_cloud: bool = True) -> int | None:
        """Scrapes full details, all episodes, and sources for a single drama."""
        url = item["url"]
        slug = item["slug"]

        # 1. Network I/O phase (No DB connection held during HTTP)
        resp = safe_request(self.session, "GET", url, delay=0.5)
        if not resp or resp.status_code != 200:
            print(f"[KOREDIZI_WARN] Failed to fetch drama page {url}")
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else item.get("title", slug)

        desc_elem = soup.find(class_=re.compile(r"description|ozet|summary|content", re.I)) or soup.find("p")
        overview = desc_elem.get_text(strip=True) if desc_elem else None

        img = soup.find("img", class_=re.compile(r"poster|cover|thumb", re.I))
        cover = img.get("src") if img else item.get("cover_image")
        if cover and not cover.startswith("http"):
            cover = f"{BASE_URL}{cover}"

        # Extract episode numbers from links like /dizi/{slug}/{ep_no}
        ep_numbers = []
        for a in soup.find_all("a", href=re.compile(rf"/dizi/{re.escape(slug)}/\d+")):
            href = a.get("href", "")
            m = re.search(rf"/dizi/{re.escape(slug)}/(\d+)", href)
            if m:
                ep_numbers.append(int(m.group(1)))

        if not ep_numbers:
            for a in soup.find_all("a"):
                txt = a.get_text(strip=True)
                if txt.isdigit() and int(txt) > 0:
                    href = a.get("href", "")
                    if slug in href:
                        ep_numbers.append(int(txt))

        ep_numbers = sorted(list(set(ep_numbers)))
        ep_count = max(ep_numbers) if ep_numbers else 0

        from concurrent.futures import ThreadPoolExecutor

        def _fetch_ep(ep_no):
            ep_url = f"{BASE_URL}/dizi/{slug}/{ep_no}"
            ep_resp = safe_request(self.session, "GET", ep_url, delay=0.05)
            if not ep_resp or ep_resp.status_code != 200:
                return None
            ep_soup = BeautifulSoup(ep_resp.text, "html.parser")
            for iframe in ep_soup.find_all("iframe"):
                src = iframe.get("src") or ""
                if "dtpasn.asia/video/" in src:
                    v_hash = src.split("video/")[-1].split("?")[0].split("/")[0].strip()
                    if self.verify_dtpasn_video(v_hash):
                        return (ep_no, ep_url, f"https://dtpasn.asia/video/{v_hash}")
            return None

        with ThreadPoolExecutor(max_workers=6) as executor:
            results = executor.map(_fetch_ep, ep_numbers)
            verified_episodes = [r for r in results if r is not None]

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
                    cover_image=cover,
                    overview=overview,
                    episode_count=ep_count,
                    genres=["Kısa Drama", "Romantik"],
                    site_tag="koredizi",
                    source_url=url,
                    country="KR",
                    country_name="Güney Kore",
                )

                for ep_no, ep_url, embed_url in verified_episodes:
                    ep_id = get_or_create_episode(
                        cur=cur,
                        drama_id=did,
                        episode_number=ep_no,
                        season_number=1,
                        episode_name=f"{ep_no}. Bölüm",
                        episode_url=ep_url,
                    )
                    added = add_source(
                        cur=cur,
                        episode_id=ep_id,
                        source_name="KoreDizi (Orijinal)",
                        direct_url=embed_url,
                        provider="koredizi",
                        site="koredizi",
                    )
                    if added:
                        sources_added += 1

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        print(f"[KOREDIZI_INGESTED] #{did} {title}: {len(ep_numbers)} eps, {sources_added} verified sources.")

        # 3. Cloud sync phase
        if sync_cloud and did:
            sync_short_drama_to_cloud(did)

        return did

    def run(self, limit: int = None, resume: bool = True, sync_cloud: bool = True):
        """Runs the KoreDizi scraping pipeline with authentication, checkpointing, and sync."""
        self.login()

        catalog = self.get_catalog()
        print(f"[KOREDIZI_CATALOG] Found {len(catalog)} short dramas on KoreDizi.")
        if not catalog:
            return

        done = load_checkpoint("koredizi") if resume else set()
        pending = [item for item in catalog if item["slug"] not in done]

        if limit:
            pending = pending[:limit]

        print(f"[KOREDIZI_PROGRESS] Processing {len(pending)} dramas (Already processed: {len(done)})...")
        for idx, item in enumerate(pending, 1):
            slug = item["slug"]
            print(f"[{idx}/{len(pending)}] Scraping KoreDizi: {slug}...")
            try:
                self.scrape_drama(item, sync_cloud=sync_cloud)
                done.add(slug)
                save_checkpoint("koredizi", done)
            except Exception as e:
                print(f"[KOREDIZI_ITEM_ERROR] {slug}: {e}", file=sys.stderr)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = KoreDiziScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
