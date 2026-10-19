"""
Shared helper for KoUp scrapers (live_scanner.py & sync_target_drama.py):
- Prevents duplicate drama creation by checking TMDB ID, IMDb ID, AniList ID, slug, and normalized title
- Enriches any newly discovered series/movie/anime via resolve_tmdb_metadata / resolve_anilist_metadata
- Syncs new/updated dramas and episodes to Supabase and regenerates local r2_bundles/sources/{id}.json
- Emits real-time __ITEM__ events for live Admin Panel streaming preview
"""

import json
import os
import re
import ssl
import urllib.request
import urllib.error
from datetime import datetime

from scrapers.multisite import find_in_index, norm_title, tag_site, unique_slug, clean_episode_title, clean_scraped_slug
from scrapers.translator import (
    COUNTRY_CODE_TO_NAME,
    resolve_anilist_metadata,
    resolve_tmdb_metadata,
)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ctx = ssl.create_default_context()


def _load_supabase_creds():
    env_path = os.path.join(_ROOT, "koup-app", ".env.local")
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY=") and not key:
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return url.rstrip("/"), key


SUPABASE_URL, SUPABASE_KEY = _load_supabase_creds()


def _load_r2_creds():
    env_path = os.path.join(_ROOT, "koup-app", ".env.local")
    endpoint = os.environ.get("CF_R2_ENDPOINT", "")
    access_key = os.environ.get("CF_R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("CF_R2_SECRET_ACCESS_KEY", "")
    bucket = os.environ.get("CF_R2_BUCKET", "koup-archive")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("CF_R2_ENDPOINT="):
                        endpoint = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("CF_R2_ACCESS_KEY_ID="):
                        access_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("CF_R2_SECRET_ACCESS_KEY="):
                        secret_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("CF_R2_BUCKET="):
                        bucket = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return endpoint, access_key, secret_key, bucket


def upload_to_r2(local_path: str, r2_key: str) -> bool:
    """Uploads a local file directly to the Cloudflare R2 bucket."""
    try:
        import boto3
        from botocore.config import Config

        endpoint, access_key, secret_key, bucket = _load_r2_creds()
        if not (endpoint and access_key and secret_key and bucket):
            return False
        cfg = Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=8, read_timeout=20)
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=cfg,
        )
        content_type = "application/json" if local_path.endswith(".json") else "application/octet-stream"
        s3.upload_file(
            local_path,
            bucket,
            r2_key,
            ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=60"},
        )
        return True
    except Exception as e:
        print(f"[R2_UPLOAD_ERROR] {r2_key}: {e}", flush=True)
        return False


def backup_db_to_r2() -> bool:
    """Backs up the local SQLite webdrama_archive.db file to R2 under db/webdrama_archive.db."""
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if os.path.exists(db_path):
        return upload_to_r2(db_path, "db/webdrama_archive.db")
    return False


def sb_request(method: str, path: str, body=None, prefer: str = "return=representation"):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    url = f"{SUPABASE_URL}{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as e:
        err_msg = ""
        try:
            err_msg = e.read().decode("utf-8")
        except Exception:
            pass
        return {"_error": True, "status": e.code, "message": err_msg}
    except Exception as e:
        return {"_error": True, "message": str(e)}


def emit_live_item(item_dict: dict):
    """Emits an immediate real-time item event for the Admin Panel stream."""
    print(f"__ITEM__ {json.dumps(item_dict, ensure_ascii=False)}", flush=True)


def match_or_create_enriched_drama(
    conn,
    cur,
    idx,
    raw_title: str,
    slug_cand: str,
    content_type: str = "dizi",
    country_hint: str = "US",
    site_tag: str = "dizibox",
    source_url: str = None,
    year_hint: int = None,
    log_fn=None,
):
    """
    Finds an existing drama in SQLite (by title, split title, slug, or external IDs from TMDB/AniList)
    or creates a fully enriched drama in both SQLite and Supabase with 0 duplicates.
    Returns (drama_id, drama_title, drama_slug, cover_image).
    """
    clean_t = re.sub(
        r"\s*(izle|hdfilmcehennemi|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|kore dizisi).*$",
        "",
        raw_title or "",
        flags=re.I,
    )
    clean_t = re.sub(r"[\-_|:•]+$", "", clean_t).strip()
    if not clean_t:
        clean_t = (slug_cand or "yapim").replace("-", " ").title()

    clean_s_cand = clean_scraped_slug(slug_cand) if slug_cand else ""
    if site_tag == "ddizi":
        country_hint = "TR"

    # 1. Try existing index by full title or ' - ' parts
    did = find_in_index(idx, clean_t, slug=clean_s_cand or slug_cand, content_type=content_type, year=year_hint)
    if not did and " - " in clean_t:
        for part in clean_t.split(" - "):
            part = part.strip()
            if part:
                did = find_in_index(idx, part, content_type=content_type, year=year_hint)
                if did:
                    break

    if not did and (clean_s_cand or slug_cand):
        cur.execute(
            "SELECT id, title, slug, cover_image FROM dramas WHERE slug = ? OR slug = ? OR slug = ?",
            (clean_s_cand, (slug_cand or "").lower(), (slug_cand or "").lower().replace("-izle", "")),
        )
        row = cur.fetchone()
        if row:
            did = row[0]

    if did:
        cur.execute("SELECT id, title, slug, cover_image FROM dramas WHERE id = ?", (did,))
        row = cur.fetchone()
        if row:
            tag_site(cur, row[0], site_tag)
            return row[0], row[1], row[2], row[3] or "/logo-dark.png"

    # 2. Not found by string -> Resolve TMDB / AniList metadata first so we can check external IDs in DB!
    meta = None
    if content_type == "anime":
        ani = resolve_anilist_metadata(clean_t, year=year_hint)
        tmdb = resolve_tmdb_metadata(clean_t, year=year_hint, country_hint="JP", content_type="anime")
        meta = tmdb or {}
        if ani:
            meta.setdefault("anilist_id", ani.get("anilist_id"))
            meta.setdefault("anilist_url", ani.get("anilist_url"))
            meta.setdefault("original_title", ani.get("original_title"))
            meta.setdefault("release_year", ani.get("release_year"))
            meta.setdefault("cover_image", ani.get("cover_image"))
            meta.setdefault("backdrop_image", ani.get("backdrop_image"))
            meta.setdefault("overview", ani.get("overview"))
            meta["country_code"] = "JP"
            meta["country_name"] = "Japonya"
    else:
        hint_c = "TR" if site_tag == "ddizi" else country_hint
        meta = resolve_tmdb_metadata(
            clean_t, year=year_hint, country_hint=hint_c, content_type=content_type
        )

    # 3. Check if resolved tmdb_id, imdb_id, or anilist_id already exists in SQLite dramas!
    if meta:
        if meta.get("tmdb_id"):
            cur.execute(
                "SELECT id, title, slug, cover_image FROM dramas WHERE tmdb_id = ? AND content_type = ? LIMIT 1",
                (meta["tmdb_id"], content_type),
            )
            row = cur.fetchone()
            if row:
                tag_site(cur, row[0], site_tag)
                return row[0], row[1], row[2], row[3] or meta.get("cover_image") or "/logo-dark.png"
        if meta.get("imdb_id"):
            cur.execute(
                "SELECT id, title, slug, cover_image FROM dramas WHERE imdb_id = ? LIMIT 1",
                (meta["imdb_id"],),
            )
            row = cur.fetchone()
            if row:
                tag_site(cur, row[0], site_tag)
                return row[0], row[1], row[2], row[3] or meta.get("cover_image") or "/logo-dark.png"
        if meta.get("anilist_id"):
            cur.execute(
                "SELECT id, title, slug, cover_image FROM dramas WHERE anilist_id = ? LIMIT 1",
                (meta["anilist_id"],),
            )
            row = cur.fetchone()
            if row:
                tag_site(cur, row[0], site_tag)
                return row[0], row[1], row[2], row[3] or meta.get("cover_image") or "/logo-dark.png"

    # 4. Truly new item -> Prepare clean metadata
    if site_tag == "ddizi" or country_hint == "TR":
        c_code = "TR"
        c_name = "Türkiye"
    else:
        c_code = (meta.get("country_code") if meta else None) or country_hint or "US"
        c_name = COUNTRY_CODE_TO_NAME.get(c_code, "ABD")

    c_year = int((meta.get("release_year") if meta else None) or year_hint or datetime.now().year)
    c_cover = (meta.get("cover_image") if meta else None) or "/logo-dark.png"
    c_backdrop = (meta.get("backdrop_image") if meta else None) or c_cover
    c_orig = (meta.get("original_title") if meta else None) or clean_t
    c_tmdb = meta.get("tmdb_id") if meta else None
    c_imdb = meta.get("imdb_id") if meta else None
    c_ani_id = meta.get("anilist_id") if meta else None
    c_ani_url = meta.get("anilist_url") if meta else None

    type_label = "animesi" if content_type == "anime" else ("filmi" if content_type == "film" else "dizisi")
    c_overview = (meta.get("overview") if meta else None) or (
        f"{clean_t} ({c_year}), {c_name} yapımı {type_label} Türkçe altyazılı ve HD kalitesiyle KoUp arşivinde."
    )

    base_s = clean_s_cand or clean_scraped_slug(clean_t) or "yapim"
    final_slug = unique_slug(cur, base_s)
    status_b = "completed" if content_type == "film" else "ongoing"

    cur.execute(
        """
        INSERT INTO dramas (
            title, native_title, slug, content_type, country, country_name,
            release_year, status_broadcast, cover_image, backdrop_image,
            overview, source_url, tmdb_id, imdb_id, anilist_id, anilist_url,
            episode_count, sources_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        """,
        (
            clean_t,
            c_orig,
            final_slug,
            content_type,
            c_code,
            c_name,
            c_year,
            status_b,
            c_cover,
            c_backdrop,
            c_overview,
            source_url,
            c_tmdb,
            c_imdb,
            c_ani_id,
            c_ani_url,
        ),
    )
    did = cur.lastrowid
    tag_site(cur, did, site_tag)
    conn.commit()

    # Sync new media row to Supabase with exact same ID
    sb_payload = {
        "id": did,
        "slug": final_slug,
        "title": clean_t,
        "original_title": c_orig,
        "content_type": content_type,
        "country_code": c_code,
        "country_name": c_name,
        "release_year": c_year,
        "status_broadcast": "Final" if content_type == "film" else "Devam Ediyor",
        "cover_image": c_cover,
        "backdrop_image": c_backdrop,
        "overview": c_overview,
        "source_url": source_url,
        "tmdb_id": c_tmdb,
        "imdb_id": c_imdb,
        "tmdb_rating": meta.get("tmdb_rating") if meta else None,
        "imdb_rating": meta.get("imdb_rating") if meta else None,
        "anilist_id": c_ani_id,
        "anilist_url": c_ani_url,
        "cast_json": meta.get("cast_json") if meta else [],
    }
    sb_request(
        "POST",
        "/rest/v1/media?on_conflict=id",
        body=sb_payload,
        prefer="resolution=merge-duplicates,return=minimal",
    )

    if log_fn:
        log_fn(
            "YENİ YAPIM",
            f'"{clean_t}" ({c_name}, {c_year}) TMDB/AniList eşleşmesiyle arşive eklendi (ID: #{did})',
        )

    return did, clean_t, final_slug, c_cover


def sync_drama_bundle_and_counts(conn, cur, drama_id: int):
    """Updates SQLite episode_count/sources_count and writes r2_bundles/sources/{drama_id}.json."""
    try:
        cur.execute(
            """
            UPDATE dramas
            SET episode_count = (SELECT COUNT(*) FROM episodes WHERE drama_id = ?),
                sources_count = (
                    SELECT COUNT(*) FROM episode_sources es
                    JOIN episodes e ON e.id = es.episode_id
                    WHERE e.drama_id = ?
                )
            WHERE id = ?
            """,
            (drama_id, drama_id, drama_id),
        )
        conn.commit()

        cur.execute("SELECT id, title, slug, content_type FROM dramas WHERE id = ?", (drama_id,))
        d_row = cur.fetchone()
        if not d_row:
            return

        cur.execute(
            """
            SELECT id, season_number, episode_number, episode_name, episode_type, source_status
            FROM episodes
            WHERE drama_id = ?
            ORDER BY COALESCE(season_number, 1) ASC, episode_number ASC
            """,
            (drama_id,),
        )
        eps = cur.fetchall()
        ep_out = []
        for ep in eps:
            ep_id, s_num, e_num, ep_name, ep_type, src_status = ep
            cur.execute(
                """
                SELECT id, source_name, provider, direct_url, embed_id, fansub, site
                FROM episode_sources
                WHERE episode_id = ? AND direct_url IS NOT NULL AND direct_url != ''
                ORDER BY id ASC
                """,
                (ep_id,),
            )
            srcs = []
            seen = set()
            for sr in cur.fetchall():
                sid, sname, prov, durl, eid, fsub, site = sr
                key = f"{prov}::{durl}"
                if key in seen:
                    continue
                seen.add(key)
                srcs.append({
                    "id": sid,
                    "source_name": sname or prov or "Kaynak",
                    "provider": prov or "other",
                    "direct_url": durl,
                    "embed_id": eid or "",
                    "site": site or "",
                    "fansub": fsub or None,
                    "quality_label": "1080p",
                })
            is_pending = (src_status == "pending")
            if srcs or is_pending:
                clean_name = clean_episode_title(ep_name, s_num or 1, e_num)
                ep_obj = {
                    "id": ep_id,
                    "season_number": s_num or 1,
                    "episode_number": e_num,
                    "episode_name": clean_name,
                    "episode_type": ep_type or "normal",
                    "sources": srcs,
                }
                if is_pending:
                    ep_obj["pending"] = True
                ep_out.append(ep_obj)

        if ep_out:
            bundle_dir = os.path.join(_ROOT, "r2_bundles", "sources")
            os.makedirs(bundle_dir, exist_ok=True)
            bundle_path = os.path.join(bundle_dir, f"{drama_id}.json")
            payload = {
                "media_id": drama_id,
                "title": d_row[1],
                "slug": d_row[2],
                "content_type": d_row[3] or "dizi",
                "episodes": ep_out,
            }
            with open(bundle_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)

            # 1. Immediately upload bundle to Cloudflare R2 bucket so Cloud and Edge CDN are 100% updated
            upload_to_r2(bundle_path, f"sources/{drama_id}.json")

            # 2. Update Supabase media episode_count
            sb_request(
                "PATCH",
                f"/rest/v1/media?id=eq.{drama_id}",
                body={"episode_count": len(ep_out)},
                prefer="return=minimal",
            )

            # 3. Upsert episodes into Supabase public.episodes table with their sources
            sb_episodes = []
            for ep in ep_out:
                is_pend = bool(ep.get("pending"))
                sb_episodes.append({
                    "media_id": drama_id,
                    "season_number": ep.get("season_number") or 1,
                    "episode_number": ep.get("episode_number"),
                    "episode_name": ep.get("episode_name") or f"Bölüm {ep.get('episode_number')}",
                    "episode_type": ep.get("episode_type") or "normal",
                    "status": "pending_source" if is_pend else "published",
                    "video_sources": ep.get("sources") or [],
                })
            if sb_episodes:
                for i in range(0, len(sb_episodes), 50):
                    chunk = sb_episodes[i : i + 50]
                    res = sb_request(
                        "POST",
                        "/rest/v1/episodes?on_conflict=media_id,season_number,episode_number",
                        body=chunk,
                        prefer="resolution=merge-duplicates,return=minimal",
                    )
                    # If check constraint doesn't allow 'pending_source' yet, fall back to 'published'
                    if isinstance(res, dict) and res.get("_error"):
                        err_msg = str(res.get("message", ""))
                        print(f"[SUPABASE_UPSERT_FALLBACK] Upsert with pending_source status failed ({err_msg[:120]}), falling back to published...", flush=True)
                        fallback_chunk = []
                        for ep_item in chunk:
                            item_copy = dict(ep_item)
                            if item_copy.get("status") == "pending_source":
                                item_copy["status"] = "published"
                            fallback_chunk.append(item_copy)
                        sb_request(
                            "POST",
                            "/rest/v1/episodes?on_conflict=media_id,season_number,episode_number",
                            body=fallback_chunk,
                            prefer="resolution=merge-duplicates,return=minimal",
                        )

        # Checkpoint SQLite WAL so changes flush directly into webdrama_archive.db
        try:
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        except Exception:
            pass
    except Exception as e:
        print(f"[SYNC_DRAMA_BUNDLE_ERROR] {drama_id}: {e}", flush=True)
