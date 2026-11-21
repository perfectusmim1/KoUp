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

from scrapers.multisite import (
    SiteBlockedError,
    add_source,
    bind_stop_event,
    get_step_stop_event,
    is_blocked_response,
    is_step_stopped,
)
from scrapers.shortdrama.common import (
    CHECKPOINT_DIR,
    clean_cover_image,
    clean_drama_overview,
    get_db_connection,
    get_or_create_episode,
    get_session,
    load_checkpoint,
    load_checkpoint_counts,
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
            if resp:
                blocked, reason = is_blocked_response(resp.status_code, resp.text)
                if blocked:
                    print(f"[KOREDIZI_BLOCKED] Login/homepage blocked ({reason}); aborting KoreDizi.", flush=True)
                    raise SiteBlockedError(reason)
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
        if resp is not None:
            blocked, reason = is_blocked_response(resp.status_code, resp.text)
            if blocked:
                print(f"[KOREDIZI_BLOCKED] {reason} on /diziler; fail-fast abort.", flush=True)
                raise SiteBlockedError(reason)
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
            cover_raw = img.get("src") if img else None
            cover = clean_cover_image(cover_raw, base_url=BASE_URL)

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

    @staticmethod
    def _extract_dtpasn_hash(url_str: str) -> str | None:
        m = re.search(r"dtpasn\.asia/video/([A-Za-z0-9_-]+)", url_str or "")
        return m.group(1) if m else None

    @staticmethod
    def _extract_embed_links(soup_obj, slug: str) -> dict[int, str]:
        """Extract distinct per-episode dtpasn/player embed URLs from a[data-embed-url] elements."""
        ep_map: dict[int, str] = {}
        for a in soup_obj.find_all("a", attrs={"data-embed-url": True}):
            embed_url = (a.get("data-embed-url") or "").strip()
            if not embed_url:
                continue
            ep_raw = (a.get("data-episode") or "").strip()
            ep_no = None
            if ep_raw.isdigit():
                ep_no = int(ep_raw)
            else:
                href = a.get("href") or ""
                m = re.search(rf"/dizi/{re.escape(slug)}/(\d+)", href)
                if m:
                    ep_no = int(m.group(1))
            if ep_no and ep_no > 0:
                ep_map[ep_no] = embed_url
        return ep_map

    def scrape_drama(self, item: dict, sync_cloud: bool = True) -> int | None:
        """Scrapes full details, all episodes, and distinct sources for a single drama."""
        self._last_drama_stats = {"dramas_added": 0, "episodes_added": 0, "sources_added": 0}
        if is_step_stopped():
            return None

        url = item["url"]
        slug = item["slug"]

        # 1. Network I/O phase (No DB connection held during HTTP)
        resp = safe_request(self.session, "GET", url, delay=0.5)
        if resp is not None:
            blocked, reason = is_blocked_response(resp.status_code, resp.text)
            if blocked:
                print(f"[KOREDIZI_BLOCKED] {reason} on {url}; fail-fast abort.", flush=True)
                raise SiteBlockedError(reason)
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

        # Extract per-episode embed URLs directly from data-embed-url attributes when present
        ep_embed_map = self._extract_embed_links(soup, slug)

        # Extract episode numbers from links like /dizi/{slug}/{ep_no}
        ep_numbers = list(ep_embed_map.keys())
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

        # If data-embed-url list only renders inside episode watch pages, fetch episode 1 once
        if ep_numbers and not ep_embed_map:
            ep1_url = f"{BASE_URL}/dizi/{slug}/{ep_numbers[0]}"
            ep1_resp = safe_request(self.session, "GET", ep1_url, delay=0.1)
            if ep1_resp is not None:
                blocked, reason = is_blocked_response(ep1_resp.status_code, ep1_resp.text)
                if blocked:
                    raise SiteBlockedError(reason)
                if ep1_resp.status_code == 200:
                    ep1_soup = BeautifulSoup(ep1_resp.text, "html.parser")
                    ep_embed_map = self._extract_embed_links(ep1_soup, slug)

        # Check DB upfront for episodes that already have a valid koredizi dtpasn source
        existing_eps_with_src = set()
        try:
            conn_chk = get_db_connection()
            try:
                cur_chk = conn_chk.cursor()
                cur_chk.execute(
                    "SELECT id FROM dramas WHERE content_type = 'kisa_drama' AND slug = ?",
                    (slug,),
                )
                drow = cur_chk.fetchone()
                if drow:
                    cur_chk.execute("""
                        SELECT DISTINCT e.episode_number
                        FROM episodes e
                        JOIN episode_sources es ON es.episode_id = e.id
                        WHERE e.drama_id = ? AND es.site = 'koredizi' AND es.direct_url LIKE '%dtpasn.asia/video/%'
                    """, (drow[0],))
                    existing_eps_with_src = {int(r[0]) for r in cur_chk.fetchall() if r[0] is not None}
            finally:
                conn_chk.close()
        except Exception:
            pass

        missing_eps = [ep for ep in ep_numbers if ep not in existing_eps_with_src]
        if not missing_eps and ep_numbers:
            self._last_drama_stats["already_complete"] = True
            self._last_drama_stats["total_eps"] = ep_count
            print(f"[KOREDIZI_SKIP] {slug}: all {len(ep_numbers)} episodes already present.")
            return None

        # Reject duplicate identical hashes across distinct episodes in the same drama
        candidates: list[tuple[int, str, str, str]] = []
        if ep_embed_map:
            hash_counts: dict[str, int] = {}
            parsed_map: dict[int, tuple[str, str]] = {}
            for ep_no, emb_u in sorted(ep_embed_map.items()):
                vh = self._extract_dtpasn_hash(emb_u)
                if vh:
                    hash_counts[vh] = hash_counts.get(vh, 0) + 1
                    parsed_map[ep_no] = (vh, f"https://dtpasn.asia/video/{vh}")

            dup_hashes = {h for h, cnt in hash_counts.items() if cnt > 1 and len(parsed_map) > 1}
            if dup_hashes:
                print(
                    f"[KOREDIZI_DUP_HASH] {slug}: detected {len(dup_hashes)} duplicate dtpasn hash(es) across episodes; rejecting duplicates.",
                    flush=True,
                )
            for ep_no in missing_eps:
                if ep_no in parsed_map:
                    vh, canon_u = parsed_map[ep_no]
                    if vh in dup_hashes:
                        continue
                    candidates.append((ep_no, f"{BASE_URL}/dizi/{slug}/{ep_no}", vh, canon_u))
        else:
            # Legacy fallback if site page lacks data-embed-url; still guard strictly against identical hashes
            from concurrent.futures import ThreadPoolExecutor
            step_ev = get_step_stop_event()

            def _fetch_ep(ep_no):
                bind_stop_event(step_ev)
                if is_step_stopped(step_ev):
                    return None
                ep_url = f"{BASE_URL}/dizi/{slug}/{ep_no}"
                ep_resp = safe_request(self.session, "GET", ep_url, delay=0.05)
                if not ep_resp or ep_resp.status_code != 200:
                    return None
                ep_soup = BeautifulSoup(ep_resp.text, "html.parser")
                for iframe in ep_soup.find_all("iframe"):
                    src = iframe.get("src") or ""
                    vh = self._extract_dtpasn_hash(src)
                    if vh:
                        return (ep_no, ep_url, vh, f"https://dtpasn.asia/video/{vh}")
                return None

            with ThreadPoolExecutor(max_workers=6) as executor:
                raw_results = [r for r in executor.map(_fetch_ep, missing_eps) if r is not None]

            hash_counts: dict[str, int] = {}
            for _, _, vh, _ in raw_results:
                hash_counts[vh] = hash_counts.get(vh, 0) + 1
            dup_hashes = {h for h, cnt in hash_counts.items() if cnt > 1 and len(raw_results) > 1}
            if dup_hashes:
                print(
                    f"[KOREDIZI_DUP_HASH] {slug}: fallback iframe returned duplicate dtpasn hash(es) across episodes; skipping duplicates.",
                    flush=True,
                )
            candidates = [c for c in raw_results if c[2] not in dup_hashes]

        if not candidates:
            print(f"[KOREDIZI_WARN] {slug}: no unique verified episode hashes found.")
            return None

        from concurrent.futures import ThreadPoolExecutor
        step_ev = get_step_stop_event()

        def _verify_candidate(cand):
            bind_stop_event(step_ev)
            if is_step_stopped(step_ev):
                return None
            ep_no, ep_url, vh, canon_u = cand
            if self.verify_dtpasn_video(vh):
                return (ep_no, ep_url, canon_u)
            return None

        with ThreadPoolExecutor(max_workers=6) as executor:
            verified_episodes = [r for r in executor.map(_verify_candidate, candidates) if r is not None]

        if not verified_episodes:
            return None

        # 2. Fast atomic database transaction phase with retry
        did = None
        sources_added = 0
        eps_added = 0
        is_new_drama = False
        for attempt in range(10):
            sources_added = 0
            eps_added = 0
            try:
                conn = get_db_connection()
                cur = conn.cursor()

                did, final_slug, is_new_drama = upsert_short_drama(
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

                ep_before = cur.execute("SELECT COUNT(id) FROM episodes WHERE drama_id = ?", (did,)).fetchone()[0]
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
                ep_after = cur.execute("SELECT COUNT(id) FROM episodes WHERE drama_id = ?", (did,)).fetchone()[0]
                eps_added = max(0, ep_after - ep_before)

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        self._last_drama_stats = {
            "dramas_added": 1 if is_new_drama else 0,
            "episodes_added": eps_added,
            "sources_added": sources_added,
        }
        print(f"[KOREDIZI_INGESTED] #{did} {title}: {len(ep_numbers)} eps, {eps_added} new eps, {sources_added} verified sources.")

        # 3. Cloud sync phase
        if sync_cloud and did and (eps_added > 0 or sources_added > 0):
            sync_short_drama_to_cloud(did)

        return did

    def run(self, limit: int = None, resume: bool = True, sync_cloud: bool = True) -> dict:
        """Runs the KoreDizi scraping pipeline with authentication, checkpointing, and sync."""
        try:
            self.login()
            catalog = self.get_catalog()
        except SiteBlockedError as e:
            print(f"[KOREDIZI_ABORT] Stopped cleanly due to block: {e}")
            return {"processed": 0, "dramas_added": 0, "episodes_added": 0, "sources_added": 0, "blocked": True}

        print(f"[KOREDIZI_CATALOG] Found {len(catalog)} short dramas on KoreDizi.")
        if not catalog:
            return {"processed": 0, "dramas_added": 0, "episodes_added": 0, "sources_added": 0}

        done_counts = load_checkpoint_counts("koredizi") if resume else {}
        if resume and not done_counts:
            # Bootstrap checkpoints from already-synced SQLite koredizi dramas so ephemeral runners never start at 0
            try:
                conn_seed = get_db_connection()
                try:
                    cur_seed = conn_seed.cursor()
                    cur_seed.execute("""
                        SELECT d.slug, COUNT(DISTINCT e.id)
                        FROM dramas d
                        JOIN episodes e ON e.drama_id = d.id
                        JOIN episode_sources es ON es.episode_id = e.id
                        WHERE d.content_type = 'kisa_drama' AND es.site = 'koredizi'
                        GROUP BY d.id
                    """)
                    for s_slug, cnt in cur_seed.fetchall():
                        if s_slug:
                            done_counts[str(s_slug)] = int(cnt or 0)
                    if done_counts:
                        save_checkpoint("koredizi", set(done_counts.keys()), done_counts)
                finally:
                    conn_seed.close()
            except Exception:
                pass

        done = set(done_counts.keys())
        pending = [item for item in catalog if item["slug"] not in done]

        if limit:
            pending = pending[:limit]

        print(f"[KOREDIZI_PROGRESS] Processing {len(pending)} dramas (Already processed: {len(done)})...")
        processed_cnt = 0
        dramas_added = 0
        eps_added = 0
        sources_added = 0
        for idx, item in enumerate(pending, 1):
            if is_step_stopped():
                print("[KOREDIZI_STOP] Cooperative stop event set; halting KoreDizi cleanly.", flush=True)
                break
            slug = item["slug"]
            print(f"[{idx}/{len(pending)}] Scraping KoreDizi: {slug}...")
            try:
                did = self.scrape_drama(item, sync_cloud=sync_cloud)
                st = getattr(self, "_last_drama_stats", {})
                dramas_added += st.get("dramas_added", 0)
                eps_added += st.get("episodes_added", 0)
                sources_added += st.get("sources_added", 0)
                processed_cnt += 1
                if did or st.get("already_complete"):
                    done.add(slug)
                    done_counts[slug] = max(done_counts.get(slug, 0), st.get("total_eps", st.get("episodes_added", 0)))
                    save_checkpoint("koredizi", done, done_counts)
            except SiteBlockedError as e:
                print(f"[KOREDIZI_ABORT] Blocked mid-run ({e}); saving checkpoint and stopping.")
                break
            except Exception as e:
                print(f"[KOREDIZI_ITEM_ERROR] {slug}: {e}", file=sys.stderr)

        return {
            "processed": processed_cnt,
            "dramas_added": dramas_added,
            "episodes_added": eps_added,
            "sources_added": sources_added,
        }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = KoreDiziScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
