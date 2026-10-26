"""
DramaBox (dramabox.com) Matcher & Backfill Scraper
- User rule: DramaBox is NEVER added as standalone incomplete series.
- ONLY matches against existing short dramas in webdrama_archive.db.
- Enriches existing dramas by adding free unlocked episodes (unlock: true, mp4 present)
  as secondary sources: dramabox:{bookId}:{chapterId}
"""

import json
import re
import sys
import time
from urllib.parse import quote_plus
from bs4 import BeautifulSoup

from scrapers.multisite import add_source, norm_title, tag_site
from scrapers.shortdrama.common import (
    get_db_connection,
    get_session,
    load_checkpoint,
    safe_request,
    save_checkpoint,
    sync_short_drama_to_cloud,
)

BASE_URL = "https://www.dramabox.com"


class DramaBoxScraper:
    def __init__(self, session=None):
        self.session = session or get_session()

    def search_books(self, query: str) -> list[dict]:
        """Searches DramaBox by title and extracts candidate book items."""
        if not query:
            return []
        search_url = f"{BASE_URL}/tr/search?q={quote_plus(query)}"
        resp = safe_request(self.session, "GET", search_url, delay=0.5)
        if not resp or resp.status_code != 200:
            return []

        books = []
        soup = BeautifulSoup(resp.text, "html.parser")

        # 1. Next.js data
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

        # 2. HTML cards fallback
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
        resp = safe_request(self.session, "GET", play_url, delay=0.5)
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

                # Check if chapter is unlocked and has video
                is_unlocked = c.get("unlock") is True or (c.get("unlock") is not False and not c.get("isLocked"))
                mp4_url = c.get("mp4") or c.get("videoUrl") or c.get("url")

                # If chapter is within first free episodes (e.g. 1..10)
                ep_index = c.get("chapterIndex") or c.get("index") or c.get("chapterNo") or idx
                chapter_id = c.get("chapterId") or c.get("id") or ep_index

                if is_unlocked and (mp4_url or int(ep_index) <= 12):
                    unlocked.append({
                        "episode_number": int(ep_index),
                        "chapter_id": str(chapter_id),
                        "mp4": mp4_url,
                    })
        except Exception as e:
            print(f"[DRAMABOX_PARSE_ERROR] {book_id}: {e}", file=sys.stderr)

        return unlocked

    def match_and_backfill_drama(self, drama_row: dict, conn=None, sync_cloud: bool = True) -> int:
        """
        Searches DramaBox for this existing drama and adds unlocked episodes as secondary sources.
        Returns number of sources added.
        """
        close_conn = False
        if conn is None:
            conn = get_db_connection()
            close_conn = True

        try:
            cur = conn.cursor()
            drama_id = drama_row["id"]
            title = drama_row["title"]
            norm_orig = norm_title(title)

            # Search DramaBox
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
                print(f"[DRAMABOX_MATCH] #{drama_id} {title} -> DramaBox #{book_id}: added {sources_added} sources.")
                if sync_cloud:
                    sync_short_drama_to_cloud(drama_id, conn)

            return sources_added
        finally:
            if close_conn:
                conn.close()

    def run(self, limit: int = None, resume: bool = True, sync_cloud: bool = True):
        """Runs match & backfill against existing short dramas in the database."""
        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, title, slug, content_type
                FROM dramas
                WHERE content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%'
                ORDER BY id ASC
            """)
            dramas = [dict(r) for r in cur.fetchall()]

            print(f"[DRAMABOX_SCAN] Found {len(dramas)} existing short dramas in database to match.")
            done = load_checkpoint("dramabox") if resume else set()
            pending = [d for d in dramas if str(d["id"]) not in done]

            if limit:
                pending = pending[:limit]

            total_added = 0
            for idx, d in enumerate(pending, 1):
                did = str(d["id"])
                print(f"[{idx}/{len(pending)}] Matching DramaBox for #{did} {d['title']}...")
                try:
                    added = self.match_and_backfill_drama(d, conn=conn, sync_cloud=sync_cloud)
                    total_added += added
                    done.add(did)
                    save_checkpoint("dramabox", done)
                except Exception as e:
                    print(f"[DRAMABOX_ITEM_ERROR] #{did}: {e}", file=sys.stderr)

            print(f"[DRAMABOX_COMPLETE] Backfilled {total_added} unlocked sources.")
        finally:
            conn.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args()

    scraper = DramaBoxScraper()
    scraper.run(limit=args.limit, resume=not args.no_resume, sync_cloud=not args.no_sync)
