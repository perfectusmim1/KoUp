"""
Short Drama Common Utilities
- Environment variable loader (.env, koup-app/.env.local)
- Rate-limited HTTP session & backoff
- Persistent checkpointing
- Cross-site deduplication and archive DB insertion
- Cloud sync (Supabase media metadata & Cloudflare R2 source bundles)
"""

import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Project root
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scrapers.multisite import add_source, clean_scraped_slug, norm_title, tag_site, unique_slug
from scrapers.supabase_sync_helper import sb_request, upload_to_r2


def load_env():
    """Loads environment variables from .env and koup-app/.env.local without overwriting existing."""
    env_paths = [
        ROOT_DIR / ".env",
        ROOT_DIR / "koup-app" / ".env.local",
    ]
    for env_path in env_paths:
        if env_path.exists():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass


load_env()


def get_db_connection(db_path: str = "webdrama_archive.db") -> sqlite3.Connection:
    """Creates a high-concurrency SQLite connection using WAL mode and 60s timeout."""
    abs_path = ROOT_DIR / db_path if not os.path.isabs(db_path) else Path(db_path)
    conn = sqlite3.connect(abs_path, timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    conn.row_factory = sqlite3.Row
    return conn


def get_session(impersonate: str = "chrome120"):
    """Returns a curl_cffi session with browser impersonation or standard requests fallback."""
    try:
        from curl_cffi import requests
        return requests.Session(impersonate=impersonate)
    except ImportError:
        import requests
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })
        return s


def safe_request(session, method: str, url: str, max_retries: int = 4, delay: float = 0.5, **kwargs):
    """Executes HTTP request with exponential backoff for 429 and 5xx errors."""
    for attempt in range(max_retries):
        try:
            if delay > 0:
                time.sleep(delay)
            resp = session.request(method, url, timeout=kwargs.pop("timeout", 20), **kwargs)
            if resp.status_code in (429, 502, 503, 504):
                wait = (2 ** attempt) * 1.5
                time.sleep(wait)
                continue
            return resp
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
    return None


CHECKPOINT_DIR = ROOT_DIR / "data" / "checkpoints"


def load_checkpoint(site: str) -> set:
    """Loads processed slug/id set from JSON checkpoint file."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    cp_file = CHECKPOINT_DIR / f"shortdrama_{site}.json"
    if cp_file.exists():
        try:
            with open(cp_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data.get("processed", []))
        except Exception:
            return set()
    return set()


def save_checkpoint(site: str, processed_items: set):
    """Saves processed slug/id set into JSON checkpoint file."""
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    cp_file = CHECKPOINT_DIR / f"shortdrama_{site}.json"
    tmp_file = CHECKPOINT_DIR / f"shortdrama_{site}.tmp"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump({
                "site": site,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(processed_items),
                "processed": sorted(list(processed_items)),
            }, f, ensure_ascii=False, indent=2)
        if tmp_file.exists():
            tmp_file.replace(cp_file)
    except Exception as e:
        print(f"[CHECKPOINT_SAVE_ERROR] {site}: {e}", file=sys.stderr)


def upsert_short_drama(
    conn: sqlite3.Connection,
    cur: sqlite3.Cursor,
    title: str,
    original_title: str = None,
    slug: str = None,
    cover_image: str = None,
    backdrop_image: str = None,
    overview: str = None,
    release_year: int | str = None,
    episode_count: int = None,
    genres: list[str] = None,
    site_tag: str = "shortizle",
    source_url: str = None,
    country: str = "CN",
    country_name: str = "Çin",
    status: str = "Devam Ediyor",
) -> tuple[int, str, bool]:
    """
    Cross-site deduplication and drama insertion.
    Matches against existing 'kisa_drama' or 'Kısa Drama' entries by normalized title.
    Returns (drama_id, slug, is_new).
    """
    clean_t = re.sub(r"\s*(izle|türkçe altyazılı|türkçe dublaj|kısa dizi|mini dizi).*$", "", title or "", flags=re.I).strip()
    clean_t = re.sub(r"[\-_|:•]+$", "", clean_t).strip()
    if not clean_t:
        clean_t = title.strip()

    target_norm = norm_title(clean_t)
    target_clean_slug = clean_scraped_slug(slug or clean_t)

    # 1. Search existing short dramas for title match or slug match
    cur.execute("""
        SELECT id, slug, title, cover_image, backdrop_image, overview, episode_count, alt_sites, categories
        FROM dramas
        WHERE content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%'
    """)
    candidates = cur.fetchall()

    matched_id = None
    matched_slug = None
    matched_row = None

    for cand in candidates:
        cand_norm = norm_title(cand["title"])
        cand_slug = cand["slug"]
        if (target_norm and cand_norm == target_norm) or (target_clean_slug and cand_slug == target_clean_slug):
            matched_id = cand["id"]
            matched_slug = cand_slug
            matched_row = cand
            break

    # If not matched among short dramas, check if slug or exact title already exists in full table
    if not matched_id and target_clean_slug:
        cur.execute("SELECT id, slug, title, cover_image, backdrop_image, overview, episode_count, alt_sites, categories FROM dramas WHERE slug = ?", (target_clean_slug,))
        row = cur.fetchone()
        if row:
            matched_id = row["id"]
            matched_slug = row["slug"]
            matched_row = row

    yr = int(release_year) if str(release_year).isdigit() else datetime.now().year
    ep_cnt = int(episode_count) if episode_count and str(episode_count).isdigit() else 0

    if matched_id:
        # Drama exists! Merge sites and backfill better metadata if missing
        tag_site(cur, matched_id, site_tag)

        updates = []
        params = []

        if not matched_row["cover_image"] and cover_image:
            updates.append("cover_image = ?")
            params.append(cover_image)
        if not matched_row["backdrop_image"] and (backdrop_image or cover_image):
            updates.append("backdrop_image = ?")
            params.append(backdrop_image or cover_image)
        if not matched_row["overview"] and overview:
            updates.append("overview = ?")
            params.append(overview)

        existing_cnt = int(matched_row["episode_count"]) if str(matched_row["episode_count"]).isdigit() else 0
        if ep_cnt > existing_cnt:
            updates.append("episode_count = ?")
            params.append(str(ep_cnt))

        # Ensure content_type is kisa_drama
        updates.append("content_type = 'kisa_drama'")

        if updates:
            params.append(matched_id)
            cur.execute(f"UPDATE dramas SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params)
            conn.commit()

        return matched_id, matched_slug, False

    # 2. Insert new short drama
    final_slug = unique_slug(cur, target_clean_slug or "kisa-drama")
    cat_set = set(["Kısa Drama"])
    if genres:
        for g in genres:
            if g and isinstance(g, str):
                cat_set.add(g.strip().title())
    categories_json = json.dumps(sorted(list(cat_set)), ensure_ascii=False)
    tags_json = json.dumps(["kısa drama", "mini dizi", "dikey drama"], ensure_ascii=False)

    c_cover = cover_image or "/logo-dark.png"
    c_backdrop = backdrop_image or c_cover
    c_overview = overview or f"{clean_t} ({yr}), {country_name} yapımı kısa drama Türkçe altyazılı olarak KoUp arşivinde."

    # Ensure SQLite sequence counter is properly aligned with max(id)
    cur.execute("SELECT max(id) FROM dramas")
    max_id_row = cur.fetchone()
    max_local = max_id_row[0] if max_id_row and max_id_row[0] else 0

    cur.execute("SELECT seq FROM sqlite_sequence WHERE name = 'dramas'")
    seq_row = cur.fetchone()
    seq_val = seq_row[0] if seq_row and seq_row[0] else 0

    if max_local > seq_val:
        cur.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'dramas'", (max_local,))

    cur.execute("""
        INSERT INTO dramas (
            title, native_title, slug, content_type, country, country_name,
            release_year, status_broadcast, cover_image, backdrop_image,
            overview, source_url, categories, tags, alt_sites,
            episode_count, sources_count, episodes_available
        ) VALUES (?, ?, ?, 'kisa_drama', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    """, (
        clean_t,
        original_title or clean_t,
        final_slug,
        country,
        country_name,
        str(yr),
        status,
        c_cover,
        c_backdrop,
        c_overview,
        source_url or f"https://koup.tv/seri/{final_slug}",
        categories_json,
        tags_json,
        site_tag,
        str(ep_cnt)
    ))
    conn.commit()
    did = cur.lastrowid
    tag_site(cur, did, site_tag)
    return did, final_slug, True


def get_or_create_episode(
    cur: sqlite3.Cursor,
    drama_id: int,
    episode_number: int,
    season_number: int = 1,
    episode_name: str = None,
    episode_url: str = None,
) -> int:
    """Finds existing episode or inserts a new episode row in SQLite."""
    cur.execute("""
        SELECT id FROM episodes
        WHERE drama_id = ? AND season_number = ? AND episode_number = ?
    """, (drama_id, season_number, episode_number))
    row = cur.fetchone()
    if row:
        return row[0]

    ep_name = episode_name or f"{episode_number}. Bölüm"
    ep_url = episode_url or f"urn:kdrama:{drama_id}:{season_number}:{episode_number}"

    # Verify uniqueness of episode_url
    cur.execute("SELECT id FROM episodes WHERE episode_url = ?", (ep_url,))
    if cur.fetchone():
        ep_url = f"{ep_url}:{int(time.time() * 1000)}"

    cur.execute("""
        INSERT INTO episodes (
            drama_id, season_number, episode_number, episode_name, episode_url,
            episode_type, sources_scraped
        ) VALUES (?, ?, ?, ?, ?, 'bolum', 1)
    """, (drama_id, season_number, episode_number, ep_name, ep_url))
    return cur.lastrowid


def sync_short_drama_to_cloud(drama_id: int, conn: sqlite3.Connection = None) -> bool:
    """
    Syncs a short drama to:
    1. Cloudflare R2: regenerates and uploads r2_bundles/sources/{drama_id}.json
    2. Supabase: upserts series metadata into public.media table
    (Episodes are NEVER pushed to Supabase public.episodes to avoid DB bloating).
    """
    close_conn = False
    if conn is None:
        conn = get_db_connection()
        close_conn = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM dramas WHERE id = ?", (drama_id,))
        drama = cur.fetchone()
        if not drama:
            return False

        # Count episodes and sources
        cur.execute("SELECT count(id) FROM episodes WHERE drama_id = ?", (drama_id,))
        ep_count = cur.fetchone()[0]

        cur.execute("""
            SELECT count(DISTINCT direct_url) FROM episode_sources
            WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)
              AND direct_url IS NOT NULL AND direct_url != '' AND direct_url != 'dead'
        """, (drama_id,))
        src_count = cur.fetchone()[0]

        # Update local drama counts with retry
        for attempt in range(5):
            try:
                cur.execute("""
                    UPDATE dramas
                    SET episodes_available = ?, sources_count = ?, episode_count = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (ep_count, src_count, str(ep_count), drama_id))
                conn.commit()
                break
            except sqlite3.OperationalError:
                time.sleep(1.5)

        # 1. Export sources bundle locally and upload to Cloudflare R2
        from scripts.export_sources_bundles import export_all
        export_all(drama_id=drama_id)

        bundle_path = ROOT_DIR / "r2_bundles" / "sources" / f"{drama_id}.json"
        if bundle_path.exists():
            upload_to_r2(str(bundle_path), f"sources/{drama_id}.json")

        # 2. Upsert metadata to Supabase public.media
        now_iso = datetime.now(timezone.utc).isoformat()
        cats = []
        try:
            cats = json.loads(drama["categories"]) if drama["categories"] else ["Kısa Drama"]
        except Exception:
            cats = ["Kısa Drama"]
        if "Kısa Drama" not in cats:
            cats.append("Kısa Drama")

        tags = []
        try:
            tags = json.loads(drama["tags"]) if drama["tags"] else ["kısa drama"]
        except Exception:
            tags = ["kısa drama"]

        sites = []
        raw_sites = drama["alt_sites"]
        if raw_sites:
            try:
                if isinstance(raw_sites, str) and raw_sites.startswith("["):
                    sites = json.loads(raw_sites)
                elif isinstance(raw_sites, str):
                    sites = [s.strip() for s in raw_sites.split(",") if s.strip()]
                elif isinstance(raw_sites, list):
                    sites = raw_sites
            except Exception:
                sites = [raw_sites]
        if not sites:
            sites = ["shortdrama"]

        yr = int(drama["release_year"]) if str(drama["release_year"]).isdigit() else datetime.now().year

        payload = {
            "id": drama_id,
            "slug": drama["slug"],
            "title": drama["title"],
            "native_title": drama["native_title"] or drama["title"],
            "content_type": "kisa_drama",
            "country_code": drama["country"] or "CN",
            "country_name": drama["country_name"] or "Çin",
            "release_year": yr,
            "status_broadcast": drama["status_broadcast"] or "Devam Ediyor",
            "cover_image": drama["cover_image"],
            "backdrop_image": drama["backdrop_image"] or drama["cover_image"],
            "overview": drama["overview"],
            "source_url": drama["source_url"],
            "categories": cats,
            "tags": tags,
            "alt_sites": sites,
            "episode_count": str(ep_count),
            "episodes_available": ep_count,
            "sources_count": src_count,
            "updated_at": now_iso,
        }

        res = sb_request(
            "POST",
            "/rest/v1/media?on_conflict=id",
            body=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
        if isinstance(res, dict) and res.get("_error"):
            print(f"[SUPABASE_SYNC_ERROR] #{drama_id}: {res}", file=sys.stderr)
            return False

        return True
    finally:
        if close_conn:
            conn.close()
