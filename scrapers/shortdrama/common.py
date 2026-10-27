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
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

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


_thread_local = threading.local()


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


def get_thread_session(impersonate: str = "chrome120"):
    """Returns a thread-isolated curl_cffi session to guarantee 100% thread safety across concurrent workers."""
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = get_session(impersonate=impersonate)
        _thread_local.session = session
    return session


def safe_request(session, method: str, url: str, max_retries: int = 4, delay: float = 0.5, **kwargs):
    """Executes HTTP request with exponential backoff for 429 and 5xx errors."""
    if session is None:
        session = get_thread_session()
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


def clean_drama_title(title: str) -> str:
    """Thoroughly strips site tags, subtitle/dub flags, and leading/trailing dashes (ASCII & Unicode)."""
    if not title:
        return ""
    t = title.strip()
    t = re.sub(r"[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]", " ", t)

    suffixes = [
        r"\s*[-–—|•:~\s]+\s*(short[iıİI]zle(\.com)?|dramavadisi(\.com|\.net)?|dramabox(\.com)?|koredizi(\.com)?|diziyou|diziizle|hdfilmcehennemi).*$",
        r"\s*[-–—|•:~\s]+\s*(t[üu]rk[çc]e\s+altyaz[ıi]l[ıi]|t[üu]rk[çc]e\s+dublaj|altyaz[ıi]l[ıi]|dublaj|k[ıi]sa\s+dizi|mini\s+dizi|[iıİI]zle).*$",
        r"\s*(t[üu]rk[çc]e\s+altyaz[ıi]l[ıi]|t[üu]rk[çc]e\s+dublaj|k[ıi]sa\s+dizi|mini\s+dizi|[iıİI]zle)$",
        r"\s*[-–—|•:~\s]+$",
    ]
    changed = True
    while changed:
        old_t = t
        for pat in suffixes:
            t = re.sub(pat, "", t, flags=re.IGNORECASE).strip()
        t = re.sub(r"^[-–—|•:~\s]+", "", t).strip()
        changed = (t != old_t)

    return t or title.strip()


def clean_drama_overview(overview: str) -> str:
    """Strips SEO prefixes like '{Title} İzle: ', 'Türkçe Altyazılı İzle: ', etc."""
    if not overview:
        return ""
    ov = str(overview).strip()
    changed = True
    while changed:
        old_ov = ov
        ov = re.sub(
            r'^(?:[^\n]{1,120}?\s+)?(?:full\s+hd\s+|türkçe\s+altyazılı\s+|hd\s+)?izle\s*:\s*',
            '',
            ov,
            flags=re.IGNORECASE
        ).strip()
        changed = (ov != old_ov)
    return ov


def clean_cover_image(cover: str, base_url: str = "") -> str | None:
    """Ensures cover image is absolute HTTPS and filters out site logos/fallbacks."""
    if not cover or not isinstance(cover, str):
        return None
    c = cover.strip()
    if not c or c in ("/logo-dark.png", "/logo.png", "logo-dark.png", "/default-poster.jpg") or c.endswith("/logo-dark.png"):
        return None
    if c.startswith("//"):
        c = f"https:{c}"
    elif c.startswith("/"):
        if base_url:
            c = f"{base_url.rstrip('/')}{c}"
        else:
            return None
    elif not c.startswith("http://") and not c.startswith("https://"):
        if base_url:
            c = f"{base_url.rstrip('/')}/{c}"
        else:
            return None
    if c.startswith("http://"):
        c = "https://" + c[7:]
    return c


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
    clean_t = clean_drama_title(title)
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

        valid_c = clean_cover_image(cover_image)
        if valid_c and (not matched_row["cover_image"] or "/logo" in str(matched_row["cover_image"]) or not str(matched_row["cover_image"]).startswith("http")):
            updates.append("cover_image = ?")
            params.append(valid_c)

        valid_bd = clean_cover_image(backdrop_image or cover_image)
        if valid_bd and (not matched_row["backdrop_image"] or "/logo" in str(matched_row["backdrop_image"]) or not str(matched_row["backdrop_image"]).startswith("http")):
            updates.append("backdrop_image = ?")
            params.append(valid_bd)

        if overview:
            valid_ov = clean_drama_overview(overview)
            if valid_ov and (not matched_row["overview"] or "izle:" in str(matched_row["overview"]).lower()):
                updates.append("overview = ?")
                params.append(valid_ov)

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

    c_cover = clean_cover_image(cover_image) or ""
    c_backdrop = clean_cover_image(backdrop_image) or c_cover
    c_overview = clean_drama_overview(overview) or f"{clean_t} ({yr}), {country_name} yapımı kısa drama Türkçe altyazılı olarak KoUp arşivinde."

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

        clean_cov = clean_cover_image(drama["cover_image"]) or ""
        clean_bd = clean_cover_image(drama["backdrop_image"]) or clean_cov
        clean_ov = clean_drama_overview(drama["overview"])

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
            "cover_image": clean_cov,
            "backdrop_image": clean_bd,
            "overview": clean_ov,
            "source_url": drama["source_url"],
            "categories": cats,
            "tags": tags,
            "alt_sites": sites,
            "episode_count": str(ep_count),
            "episodes_available": ep_count,
            "sources_count": src_count,
            "updated_at": now_iso,
        }

        for attempt in range(4):
            res = sb_request(
                "POST",
                "/rest/v1/media?on_conflict=id",
                body=payload,
                prefer="resolution=merge-duplicates,return=representation",
            )
            if isinstance(res, dict) and res.get("_error"):
                if attempt < 3:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                print(f"[SUPABASE_SYNC_ERROR] #{drama_id}: {res}", file=sys.stderr)
                return False
            break

        return True
    finally:
        if close_conn:
            conn.close()


def bulk_sync_short_dramas_to_cloud(drama_ids: list[int] = None) -> bool:
    """
    High-throughput bulk cloud synchronization for short dramas:
    1. Batch update counters (episodes_available & sources_count) in SQLite.
    2. Bulk export local JSON bundles (scripts/export_sources_bundles.py).
    3. 32-worker parallel Cloudflare R2 upload (r2_bundles/sources/{id}.json).
    4. 100-item chunk array upsert to Supabase public.media.
    """
    from concurrent.futures import ThreadPoolExecutor
    from scripts.export_sources_bundles import export_all

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        if not drama_ids:
            cur.execute("""
                SELECT id FROM dramas
                WHERE content_type = 'kisa_drama' OR categories LIKE '%Kısa Drama%'
            """)
            drama_ids = [r[0] for r in cur.fetchall()]

        if not drama_ids:
            print("[BULK_SYNC] No dramas found to sync.")
            return True

        print(f"[BULK_SYNC_PHASE_1] Updating stats for {len(drama_ids)} dramas...", flush=True)
        chunk_size = 500
        for i in range(0, len(drama_ids), chunk_size):
            c_ids = drama_ids[i:i + chunk_size]
            placeholders = ",".join("?" for _ in c_ids)
            cur.execute(f"""
                UPDATE dramas
                SET episodes_available = (SELECT count(e.id) FROM episodes e WHERE e.drama_id = dramas.id),
                    sources_count = (
                        SELECT count(DISTINCT s.direct_url)
                        FROM episode_sources s
                        JOIN episodes e ON e.id = s.episode_id
                        WHERE e.drama_id = dramas.id
                          AND s.direct_url IS NOT NULL AND s.direct_url != '' AND s.direct_url != 'dead'
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id IN ({placeholders})
            """, c_ids)
            conn.commit()

        print(f"[BULK_SYNC_PHASE_2] Exporting JSON bundles for {len(drama_ids)} dramas...", flush=True)
        def _export_one(did):
            try:
                export_all(drama_id=did)
            except Exception as e:
                print(f"[EXPORT_ERR] #{did}: {e}", file=sys.stderr)

        with ThreadPoolExecutor(max_workers=16) as executor:
            list(executor.map(_export_one, drama_ids))

        print(f"[BULK_SYNC_PHASE_3] Uploading {len(drama_ids)} bundles to Cloudflare R2 with 32 workers...", flush=True)
        def _upload_one(did):
            bp = ROOT_DIR / "r2_bundles" / "sources" / f"{did}.json"
            if bp.exists():
                return upload_to_r2(str(bp), f"sources/{did}.json")
            return False

        with ThreadPoolExecutor(max_workers=32) as executor:
            upload_results = list(executor.map(_upload_one, drama_ids))
        success_r2 = sum(1 for r in upload_results if r)
        print(f"[BULK_SYNC_PHASE_3] Successfully uploaded {success_r2}/{len(drama_ids)} bundles to R2.", flush=True)

        print(f"[BULK_SYNC_PHASE_4] Fetching metadata for 100-item batch Supabase upserts...", flush=True)
        cur.execute(f"""
            SELECT * FROM dramas
            WHERE id IN ({','.join('?' for _ in drama_ids)})
        """, drama_ids)
        rows = cur.fetchall()

        now_iso = datetime.now(timezone.utc).isoformat()
        payloads = []
        for d in rows:
            cats = []
            try:
                cats = json.loads(d["categories"]) if d["categories"] else ["Kısa Drama"]
            except Exception:
                cats = ["Kısa Drama"]
            if "Kısa Drama" not in cats:
                cats.append("Kısa Drama")

            tags = []
            try:
                tags = json.loads(d["tags"]) if d["tags"] else ["kısa drama"]
            except Exception:
                tags = ["kısa drama"]

            sites = []
            raw_sites = d["alt_sites"]
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

            yr = int(d["release_year"]) if str(d["release_year"]).isdigit() else datetime.now().year
            ep_cnt = int(d["episodes_available"] or 0)
            src_cnt = int(d["sources_count"] or 0)

            clean_cov = clean_cover_image(d["cover_image"]) or ""
            clean_bd = clean_cover_image(d["backdrop_image"]) or clean_cov
            clean_ov = clean_drama_overview(d["overview"])

            payloads.append({
                "id": d["id"],
                "slug": d["slug"],
                "title": d["title"],
                "native_title": d["native_title"] or d["title"],
                "content_type": "kisa_drama",
                "country_code": d["country"] or "CN",
                "country_name": d["country_name"] or "Çin",
                "release_year": yr,
                "status_broadcast": d["status_broadcast"] or "Devam Ediyor",
                "cover_image": clean_cov,
                "backdrop_image": clean_bd,
                "overview": clean_ov,
                "source_url": d["source_url"],
                "categories": cats,
                "tags": tags,
                "alt_sites": sites,
                "episode_count": str(ep_cnt),
                "episodes_available": ep_cnt,
                "sources_count": src_cnt,
                "updated_at": now_iso,
            })

        print(f"[BULK_SYNC_PHASE_4] Pushing {len(payloads)} dramas to Supabase in chunks of 100...", flush=True)
        sb_success = 0
        chunk_size = 100
        for i in range(0, len(payloads), chunk_size):
            chunk = payloads[i:i + chunk_size]
            for attempt in range(4):
                res = sb_request(
                    "POST",
                    "/rest/v1/media?on_conflict=id",
                    body=chunk,
                    prefer="resolution=merge-duplicates,return=minimal",
                )
                if isinstance(res, dict) and res.get("_error"):
                    time.sleep(2 * (attempt + 1))
                    continue
                sb_success += len(chunk)
                break

        print(f"[BULK_SYNC_COMPLETE] Successfully synced {sb_success}/{len(payloads)} dramas to Supabase public.media!", flush=True)
        return True
    finally:
        conn.close()
