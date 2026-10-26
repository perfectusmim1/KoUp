"""
DramaBox (dramabox.com) Matcher & Backfill Scraper
- Matches existing short dramas in webdrama_archive.db and injects free unlocked episodes
- Also directly ingests standalone Turkish short dramas from dramabox.com/tr with free episodes
- Dynamic resolver token: dramabox:{bookId}:{chapterId}
"""

import json
import re
import sqlite3
import sys
import time
from urllib.parse import quote_plus
from bs4 import BeautifulSoup

from scrapers.multisite import add_source, norm_title, tag_site
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

BASE_URL = "https://www.dramabox.com"


class DramaBoxScraper:
    def __init__(self, session=None):
        self.session = session or get_session()
        self._cached_catalog = None

    def get_catalog_books(self) -> list[dict]:
        """Fetches all Turkish short drama books featured on dramabox.com/tr."""
        if self._cached_catalog is not None:
            return self._cached_catalog

        books = []
        seen = set()

        resp = safe_request(self.session, "GET", f"{BASE_URL}/tr", delay=0.5)
        if resp and resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            nxt = soup.find("script", id="__NEXT_DATA__")
            if nxt and nxt.string:
                try:
                    data = json.loads(nxt.string)
                    pp = data.get("props", {}).get("pageProps", {})

                    def _extract(obj):
                        if isinstance(obj, dict):
                            if "bookId" in obj and ("bookName" in obj or "name" in obj):
                                bid = str(obj.get("bookId")).strip()
                                bname = (obj.get("bookName") or obj.get("name") or "").strip()
                                bcover = obj.get("cover") or obj.get("bookCover") or ""
                                bintro = obj.get("introduction") or obj.get("intro") or ""
                                if bid and bname and bid not in seen:
                                    seen.add(bid)
                                    books.append({
                                        "book_id": bid,
                                        "title": bname,
                                        "cover_image": bcover,
                                        "overview": bintro,
                                    })
                            for v in obj.values():
                                _extract(v)
                        elif isinstance(obj, list):
                            for item in obj:
                                _extract(item)

                    _extract(pp)
                except Exception:
                    pass

        self._cached_catalog = books
        return books

    def search_books(self, query: str) -> list[dict]:
        """Searches DramaBox by title and extracts candidate book items."""
        if not query:
            return []

        # 1. Check local catalog first
        norm_q = norm_title(query)
        cat_matches = []
        for b in self.get_catalog_books():
            if norm_title(b["title"]) == norm_q or norm_q in norm_title(b["title"]):
                cat_matches.append(b)
        if cat_matches:
            return cat_matches

        # 2. Search endpoint
        search_url = f"{BASE_URL}/tr/search?q={quote_plus(query)}"
        resp = safe_request(self.session, "GET", search_url, delay=0.4)
        if not resp or resp.status_code != 200:
            return []

        books = []
        soup = BeautifulSoup(resp.text, "html.parser")

        next_script = soup.find("script", id="__NEXT_DATA__")
        if next_script and next_script.string:
            try:
                data = json.loads(next_script.string)
                pp = data.get("props", {}).get("pageProps", {})
                raw_list = (
                    pp.get("searchResult")
                    or pp.get("bookList")
                    or pp.get("list")
                    or pp.get("data")
                    or []
                )
                if isinstance(raw_list, list):
                    for b in raw_list:
                        bid = str(b.get("bookId") or b.get("id") or "").strip()
                        bname = b.get("bookName") or b.get("name") or b.get("title") or ""
                        if bid and bname:
                            books.append({"book_id": bid, "title": bname, "raw": b})
            except Exception:
                pass

        if not books:
            for a in soup.find_all("a", href=re.compile(r"/video/(\d+)_play")):
                m = re.search(r"/video/(\d+)_play", a["href"])
                if m:
                    bid = m.group(1)
                    title_elem = a.find(["h2", "h3", "h4", "p", "span"])
                    bname = title_elem.get_text(strip=True) if title_elem else a.get_text(strip=True)
                    if bid and bname and not any(x["book_id"] == bid for x in books):
                        books.append({"book_id": bid, "title": bname})

        return books

    def get_unlocked_chapters(self, book_id: str) -> list[dict]:
        """Fetches the chapter list and filters for unlocked episodes with MP4 streams."""
        play_url = f"{BASE_URL}/tr/video/{book_id}_play/1_Episode-1"
        resp = safe_request(self.session, "GET", play_url, delay=0.4)
        if not resp or resp.status_code != 200:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        next_script = soup.find("script", id="__NEXT_DATA__")
        if not next_script or not next_script.string:
            return []

        unlocked = []
        try:
            data = json.loads(next_script.string)
            pp = data.get("props", {}).get("pageProps", {})
            chapter_list = (
                pp.get("chapterList")
                or pp.get("videoInfo", {}).get("chapterList")
                or pp.get("bookInfo", {}).get("chapterList")
                or []
            )

            for idx, c in enumerate(chapter_list, 1):
                if not isinstance(c, dict):
                    continue

                is_unlocked = c.get("unlock") is True or (c.get("unlock") is not False and not c.get("isLocked"))
                mp4_url = c.get("mp4") or c.get("videoUrl") or c.get("url")

                ep_index = c.get("chapterIndex") or c.get("index") or c.get("chapterNo") or idx
                chapter_id = c.get("chapterId") or c.get("id") or ep_index

                if is_unlocked and (mp4_url or int(ep_index) <= 15):
                    unlocked.append({
                        "episode_number": int(ep_index),
                        "chapter_id": str(chapter_id),
                        "mp4": mp4_url,
                    })
        except Exception as e:
            print(f"[DRAMABOX_PARSE_ERROR] {book_id}: {e}", file=sys.stderr)

        return unlocked

    def match_and_backfill_drama(self, drama_row: dict, sync_cloud: bool = True) -> int:
        """Searches DramaBox for this existing drama and adds unlocked episodes as secondary sources."""
        drama_id = drama_row["id"]
        title = drama_row["title"]
        norm_orig = norm_title(title)

        candidates = self.search_books(title)
        best_match = None

        for cand in candidates:
            cand_norm = norm_title(cand["title"])
            if cand_norm == norm_orig:
                best_match = cand
                break

        if not best_match:
            return 0

        book_id = best_match["book_id"]
        unlocked = self.get_unlocked_chapters(book_id)
        if not unlocked:
            return 0

        sources_added = 0
        for attempt in range(10):
            try:
                conn = get_db_connection()
                cur = conn.cursor()

                for chap in unlocked:
                    ep_no = chap["episode_number"]
                    chap_id = chap["chapter_id"]

                    cur.execute("""
                        SELECT id FROM episodes
                        WHERE drama_id = ? AND episode_number = ?
                    """, (drama_id, ep_no))
                    ep_row = cur.fetchone()
                    if not ep_row:
                        continue

                    ep_id = ep_row[0]
                    stream_token = f"dramabox:{book_id}:{chap_id}"
                    if add_source(
                        cur=cur,
                        episode_id=ep_id,
                        source_name="DramaBox (Ücretsiz HD)",
                        direct_url=stream_token,
                        provider="dramabox",
                        site="dramabox",
                    ):
                        sources_added += 1

                if sources_added > 0:
                    tag_site(cur, drama_id, "dramabox")

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        if sources_added > 0:
            print(f"[DRAMABOX_MATCH] #{drama_id} {title} -> DramaBox #{book_id}: added {sources_added} sources.")
            if sync_cloud:
                sync_short_drama_to_cloud(drama_id)

        return sources_added

    def ingest_standalone_dramabox(self, book: dict, sync_cloud: bool = True) -> int | None:
        """Ingests a standalone Turkish DramaBox title with unlocked episodes directly as kisa_drama."""
        book_id = book["book_id"]
        title = book["title"]
        unlocked = self.get_unlocked_chapters(book_id)
        if not unlocked:
            return None

        did = None
        sources_added = 0
        ep_count = len(unlocked)

        for attempt in range(10):
            try:
                conn = get_db_connection()
                cur = conn.cursor()

                did, final_slug, is_new = upsert_short_drama(
                    conn=conn,
                    cur=cur,
                    title=title,
                    cover_image=book.get("cover_image"),
                    overview=book.get("overview"),
                    episode_count=ep_count,
                    genres=["Kısa Drama", "DramaBox"],
                    site_tag="dramabox",
                    source_url=f"{BASE_URL}/tr/video/{book_id}_play/1_Episode-1",
                    country="CN",
                    country_name="Çin",
                )

                for chap in unlocked:
                    ep_no = chap["episode_number"]
                    chap_id = chap["chapter_id"]
                    ep_id = get_or_create_episode(
                        cur=cur,
                        drama_id=did,
                        episode_number=ep_no,
                        season_number=1,
                        episode_name=f"{ep_no}. Bölüm",
                        episode_url=f"{BASE_URL}/tr/video/{book_id}_play/{ep_no}_Episode-{ep_no}",
                    )

                    stream_token = f"dramabox:{book_id}:{chap_id}"
                    if add_source(
                        cur=cur,
                        episode_id=ep_id,
                        source_name="DramaBox (Ücretsiz HD)",
                        direct_url=stream_token,
                        provider="dramabox",
                        site="dramabox",
                    ):
                        sources_added += 1

                conn.commit()
                conn.close()
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(1.0)

        print(f"[DRAMABOX_INGESTED] #{did} {title}: {ep_count} eps, {sources_added} sources.")

        if sync_cloud and did:
            sync_short_drama_to_cloud(did)

        return did

    def run(self, limit: int = 300, resume: bool = True, sync_cloud: bool = True):
        """Runs match & backfill against existing short dramas and ingests catalog books."""
        # 1. Match against existing dramas in DB
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT id, title, slug, content_type
            FROM dramas
            WHERE content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%'
            ORDER BY id ASC
        """)
        dramas = [dict(r) for r in cur.fetchall()]
        conn.close()

        print(f"[DRAMABOX_SCAN] Found {len(dramas)} existing short dramas in database to match.")
        done = load_checkpoint("dramabox") if resume else set()
        pending = [d for d in dramas if str(d["id"]) not in done]

        if limit:
            pending = pending[:limit]

        total_matched = 0
        for idx, d in enumerate(pending, 1):
            did = str(d["id"])
            try:
                added = self.match_and_backfill_drama(d, sync_cloud=sync_cloud)
                total_matched += added
                done.add(did)
                save_checkpoint("dramabox", done)
            except Exception as e:
                print(f"[DRAMABOX_MATCH_ERROR] #{did}: {e}", file=sys.stderr)

        print(f"[DRAMABOX_MATCH_COMPLETE] Backfilled {total_matched} sources across existing dramas.")

        # 2. Ingest catalog books directly from dramabox.com/tr
        print("[DRAMABOX_CATALOG] Fetching Turkish catalog from dramabox.com/tr...")
        catalog_books = self.get_catalog_books()
        print(f"[DRAMABOX_CATALOG] Found {len(catalog_books)} Turkish short drama books.")

        standalone_added = 0
        for b in catalog_books:
            b_key = f"db_{b['book_id']}"
            if b_key in done:
                continue
            try:
                res = self.ingest_standalone_dramabox(b, sync_cloud=sync_cloud)
                if res:
                    standalone_added += 1
                done.add(b_key)
                save_checkpoint("dramabox", done)
            except Exception as e:
                print(f"[DRAMABOX_STANDALONE_ERROR] {b['title']}: {e}", file=sys.stderr)

        print(f"[DRAMABOX_COMPLETE] Ingested {standalone_added} standalone Turkish short dramas.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = DramaBoxScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
