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
from datetime import datetime, timezone

from scrapers.multisite import find_in_index, norm_title, tag_site, unique_slug, clean_episode_title, clean_scraped_slug
from scrapers.clean_fansub import clean_source_name
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
    key = (
        os.environ.get("SUPABASE_SECRET_KEY", "")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    )
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("NEXT_PUBLIC_SUPABASE_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("SUPABASE_SECRET_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("SUPABASE_SERVICE_ROLE_KEY=") and not key:
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif (line.startswith("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=") or line.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY=")) and not key:
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


def download_db_from_r2(local_path: str = None) -> bool:
    """Downloads the master SQLite database from Cloudflare R2 if missing or needed."""
    try:
        import boto3
        from botocore.config import Config

        if not local_path:
            local_path = os.path.join(_ROOT, "webdrama_archive.db")
        endpoint, access_key, secret_key, bucket = _load_r2_creds()
        if not (endpoint and access_key and secret_key and bucket):
            print("[R2_DOWNLOAD_ERROR] Missing Cloudflare R2 credentials.", flush=True)
            return False

        cfg = Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=15, read_timeout=120)
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=cfg,
        )
        temp_path = local_path + ".download.tmp"
        print(f"[R2_DOWNLOAD] Downloading db/webdrama_archive.db from R2 ({bucket})...", flush=True)
        s3.download_file(bucket, "db/webdrama_archive.db", temp_path)
        if os.path.exists(temp_path) and os.path.getsize(temp_path) > 10_000_000:
            if os.path.exists(local_path):
                try:
                    os.remove(local_path)
                except Exception:
                    pass
            os.rename(temp_path, local_path)
            print(f"[R2_DOWNLOAD] Successfully downloaded webdrama_archive.db ({os.path.getsize(local_path)} bytes).", flush=True)
            return True
        else:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            print("[R2_DOWNLOAD_ERROR] Downloaded DB file is missing or too small.", flush=True)
            return False
    except Exception as e:
        print(f"[R2_DOWNLOAD_ERROR] {e}", flush=True)
        return False


def backup_db_to_r2() -> bool:
    """Backs up the local SQLite webdrama_archive.db file to R2 under db/webdrama_archive.db."""
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if os.path.exists(db_path) and os.path.getsize(db_path) > 10_000_000:
        return upload_to_r2(db_path, "db/webdrama_archive.db")
    print(f"[R2_BACKUP_SKIPPED] Local DB file does not exist or is too small (<10MB).", flush=True)
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



_RECENT_ADDED_DRAMAS = []

def pop_recent_added_dramas():
    global _RECENT_ADDED_DRAMAS
    items = list(_RECENT_ADDED_DRAMAS)
    _RECENT_ADDED_DRAMAS = []
    return items

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
        cur.execute("SELECT id, title, slug, cover_image, backdrop_image, tmdb_id FROM dramas WHERE id = ?", (did,))
        row = cur.fetchone()
        if row:
            tag_site(cur, row[0], site_tag)
            cover = row[3]
            backdrop = row[4]
            tmdb_id = row[5]
            if not cover or cover == "/logo-dark.png" or any(h in (cover or "").lower() for h in ["dizifon", "dizikorea", "ddizi", "dizibox", "asyaanimeleri"]):
                try:
                    meta = resolve_tmdb_metadata(clean_t, year=year_hint, country_hint=country_hint, content_type=content_type)
                    if meta and meta.get("cover_image") and "image.tmdb.org" in meta["cover_image"]:
                        cover = meta["cover_image"]
                        backdrop = meta.get("backdrop_image") or backdrop or cover
                        tmdb_id = meta.get("tmdb_id") or tmdb_id
                        cur.execute("UPDATE dramas SET cover_image = ?, backdrop_image = COALESCE(?, backdrop_image), tmdb_id = COALESCE(?, tmdb_id) WHERE id = ?", (cover, backdrop, tmdb_id, row[0]))
                        conn.commit()
                        sb_request("PATCH", f"/rest/v1/media?id=eq.{row[0]}", body={"cover_image": cover, "backdrop_image": backdrop, "tmdb_id": tmdb_id})
                except Exception:
                    pass
            return row[0], row[1], row[2], cover or "/logo-dark.png"

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
        if content_type != "film":
            ani = resolve_anilist_metadata(clean_t, year=year_hint)
            if ani and ani.get("anilist_id"):
                meta = meta or {}
                meta["anilist_id"] = ani.get("anilist_id")
                meta.setdefault("anilist_url", ani.get("anilist_url"))
                meta.setdefault("original_title", ani.get("original_title"))
                meta.setdefault("cover_image", ani.get("cover_image"))
                meta.setdefault("backdrop_image", ani.get("backdrop_image"))
                meta.setdefault("overview", ani.get("overview"))

    # 3. Check if resolved tmdb_id, imdb_id, or anilist_id already exists in SQLite dramas!
    if meta:
        if meta.get("tmdb_id"):
            if content_type == "film":
                cur.execute(
                    "SELECT id, title, slug, cover_image FROM dramas WHERE tmdb_id = ? AND content_type = 'film' LIMIT 1",
                    (meta["tmdb_id"],),
                )
            else:
                cur.execute(
                    "SELECT id, title, slug, cover_image FROM dramas WHERE tmdb_id = ? AND content_type != 'film' LIMIT 1",
                    (meta["tmdb_id"],),
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
    status_b = "Final" if content_type == "film" else "Devam Ediyor"

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
            source_url or f"https://koup.tv/seri/{final_slug}",
            c_tmdb,
            c_imdb,
            c_ani_id,
            c_ani_url,
        ),
    )
    did = cur.lastrowid
    tag_site(cur, did, site_tag)
    conn.commit()
    _RECENT_ADDED_DRAMAS.append({
        "id": did,
        "title": clean_t,
        "slug": final_slug,
        "cover_image": c_cover,
        "content_type": content_type,
        "country_code": c_code,
        "country_name": c_name,
        "release_year": c_year,
        "site": site_tag,
        "added_at": datetime.now().isoformat(),
    })

    # Sync new media row to Supabase with exact same ID
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_payload = {
        "id": did,
        "slug": final_slug,
        "title": clean_t,
        "native_title": c_orig,
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
        "imdb_rating": meta.get("imdb_rating") if meta else None,
        "anilist_id": c_ani_id,
        "anilist_url": c_ani_url,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    media_res = sb_request(
        "POST",
        "/rest/v1/media?on_conflict=id",
        body=clean_payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(media_res, dict) and media_res.get("_error"):
        print(f"[SUPABASE_MEDIA_INSERT_ERROR] #{did} {clean_t}: {media_res}", flush=True)

    if log_fn:
        log_fn(
            "YENİ YAPIM",
            f'"{clean_t}" ({c_name}, {c_year}) TMDB/AniList eşleşmesiyle arşive eklendi (ID: #{did})',
        )

    # Automatically populate cast/characters (top 10) and link into Seri Evreni (franchise graph)
    try:
        auto_sync_drama_cast(did, clean_t, content_type, tmdb_id=c_tmdb, anilist_id=c_ani_id)
    except Exception as e:
        print(f"[AUTO_CAST_SYNC_WARN] #{did}: {e}", flush=True)

    try:
        auto_sync_drama_franchise(
            conn, cur, did, clean_t, final_slug, content_type, c_year, c_cover,
            tmdb_id=c_tmdb, anilist_id=c_ani_id,
        )
    except Exception as e:
        print(f"[AUTO_FRANCHISE_SYNC_WARN] #{did}: {e}", flush=True)

    return did, clean_t, final_slug, c_cover


def _slugify_person(text: str) -> str:
    if not text:
        return "actor"
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "actor"


def auto_sync_drama_cast(drama_id: int, title: str, content_type: str = "dizi", tmdb_id=None, anilist_id=None):
    """
    Automatically fetches top 10 characters/actors from AniList (for anime) or TMDb (for dizi/film)
    and populates Supabase `people` and `media_cast` if the media has no cast yet.
    """
    existing = sb_request("GET", f"/rest/v1/media_cast?media_id=eq.{drama_id}&select=person_id&limit=1")
    if isinstance(existing, list) and len(existing) > 0:
        return 0

    planned = []
    if content_type == "anime" and (anilist_id or title):
        q = """
        query ($id: Int, $search: String) {
          Media(id: $id, search: $search, type: ANIME) {
            id
            characters(sort: [ROLE, RELEVANCE, ID], perPage: 10) {
              edges {
                role
                node {
                  id
                  name { full userPreferred }
                  image { large medium }
                }
                voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
                  id
                  name { full userPreferred }
                  image { large medium }
                }
              }
            }
          }
        }
        """
        vars_dict = {"id": int(anilist_id)} if (anilist_id and int(anilist_id) > 0) else {"search": title}
        try:
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=json.dumps({"query": q, "variables": vars_dict}).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "KoUp/1.0"},
            )
            with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    edges = (((payload.get("data") or {}).get("Media") or {}).get("characters") or {}).get("edges") or []
                    for idx, edge in enumerate(edges[:10], 1):
                        node = edge.get("node") or {}
                        vas = edge.get("voiceActors") or []
                        va = vas[0] if vas else {}
                        char_name = (node.get("name") or {}).get("full") or (node.get("name") or {}).get("userPreferred") or ""
                        if not char_name:
                            continue
                        va_name = (va.get("name") or {}).get("full") or (va.get("name") or {}).get("userPreferred") or ""
                        role_type = "lead" if edge.get("role") == "MAIN" else "support"
                        img_url = (
                            (node.get("image") or {}).get("large")
                            or (node.get("image") or {}).get("medium")
                            or (va.get("image") or {}).get("large")
                        )
                        va_img = (va.get("image") or {}).get("large") or (va.get("image") or {}).get("medium")
                        planned.append({
                            "name": char_name,
                            "slug": _slugify_person(char_name),
                            "image_url": img_url,
                            "tmdb_id": None,
                            "character_name": f"Seslendiren: {va_name}" if va_name else char_name,
                            "role_type": role_type,
                            "billing_order": idx,
                            "voice_actor_name": va_name or None,
                            "voice_actor_image": va_img,
                            "voice_actor_slug": _slugify_person(va_name) if va_name else None,
                        })
        except Exception:
            pass

    if not planned and tmdb_id:
        from scrapers.translator import TMDB_API_KEY
        if TMDB_API_KEY:
            is_movie = content_type == "film"
            urls = (
                [f"https://api.themoviedb.org/3/movie/{tmdb_id}/credits?api_key={TMDB_API_KEY}"]
                if is_movie
                else [
                    f"https://api.themoviedb.org/3/tv/{tmdb_id}/credits?api_key={TMDB_API_KEY}",
                    f"https://api.themoviedb.org/3/tv/{tmdb_id}/aggregate_credits?api_key={TMDB_API_KEY}",
                ]
            )
            for u in urls:
                try:
                    req = urllib.request.Request(u, headers={"User-Agent": "KoUp/1.0"})
                    with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                        if resp.status == 200:
                            data = json.loads(resp.read().decode("utf-8"))
                            raw_cast = data.get("cast") or []
                            if raw_cast:
                                raw_cast.sort(key=lambda x: x.get("order", 999))
                                for idx, c in enumerate(raw_cast[:10], 1):
                                    name = c.get("name") or c.get("original_name") or ""
                                    if not name:
                                        continue
                                    char = c.get("character") or ""
                                    if not char and isinstance(c.get("roles"), list) and c["roles"]:
                                        char = c["roles"][0].get("character") or ""
                                    prof = c.get("profile_path")
                                    img = f"https://image.tmdb.org/t/p/w500{prof}" if prof else None
                                    planned.append({
                                        "name": name,
                                        "slug": _slugify_person(name),
                                        "image_url": img,
                                        "tmdb_id": c.get("id"),
                                        "character_name": char,
                                        "role_type": "lead" if idx <= 4 else "support",
                                        "billing_order": idx,
                                        "voice_actor_name": None,
                                        "voice_actor_image": None,
                                        "voice_actor_slug": None,
                                    })
                                break
                except Exception:
                    continue

    if not planned:
        return 0

    people_payload = []
    seen_slugs = set()
    slug_to_id = {}

    for p in planned:
        pslug = p["slug"]
        if pslug in seen_slugs:
            continue
        seen_slugs.add(pslug)

        # 1. Deduplication check by TMDb ID
        existing_pid = None
        if p.get("tmdb_id"):
            ex_tmdb = sb_request("GET", f"/rest/v1/people?tmdb_id=eq.{p['tmdb_id']}&select=id,slug&limit=1")
            if isinstance(ex_tmdb, list) and ex_tmdb:
                existing_pid = ex_tmdb[0]["id"]
                slug_to_id[pslug] = existing_pid

        # 2. Deduplication check by clean slug / char- prefix
        if not existing_pid:
            cslug = re.sub(r'-\d+$', '', pslug)
            ex_slug = sb_request("GET", f"/rest/v1/people?or=(slug.eq.{pslug},slug.eq.{cslug},slug.ilike.char-{cslug}-%)&select=id,slug&limit=1")
            if isinstance(ex_slug, list) and ex_slug:
                existing_pid = ex_slug[0]["id"]
                slug_to_id[pslug] = existing_pid

        if not existing_pid:
            people_payload.append({
                "name": p["name"],
                "slug": pslug,
                "image_url": p["image_url"],
                "tmdb_id": p["tmdb_id"],
                "person_type": "actor",
            })

    if people_payload:
        p_res = sb_request(
            "POST",
            "/rest/v1/people?on_conflict=slug",
            body=people_payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
        if isinstance(p_res, list):
            for r in p_res:
                if r.get("slug") and r.get("id"):
                    slug_to_id[r["slug"]] = r["id"]

    cast_rows = []
    seen_pids = set()
    for p in planned:
        pid = slug_to_id.get(p["slug"])
        if not pid:
            g = sb_request("GET", f"/rest/v1/people?slug=eq.{p['slug']}&select=id&limit=1")
            if isinstance(g, list) and g:
                pid = g[0]["id"]
        if pid and pid not in seen_pids:
            seen_pids.add(pid)
            cast_rows.append({
                "media_id": drama_id,
                "person_id": pid,
                "character_name": p["character_name"],
                "role_type": p["role_type"],
                "billing_order": p["billing_order"],
                "voice_actor_name": p["voice_actor_name"],
                "voice_actor_image": p["voice_actor_image"],
                "voice_actor_slug": p["voice_actor_slug"],
            })

    if cast_rows:
        sb_request("POST", "/rest/v1/media_cast", body=cast_rows, prefer="return=minimal")
    return len(cast_rows)


def auto_sync_drama_franchise(
    conn, cur, drama_id: int, title: str, slug: str, content_type: str,
    release_year: int, cover_image: str, tmdb_id=None, anilist_id=None
):
    """
    Automatically checks if a newly added or updated drama connects to any existing series/movies
    in the archive (via AniList relations or base title prefix) and updates both Supabase
    `franchise_items` and `franchise_graph.json` (local + Cloudflare R2).
    """
    related_drama_ids = set()

    # 1. Check AniList relations if anilist_id is available
    if anilist_id and int(anilist_id) > 0:
        q = """
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            relations {
              edges {
                relationType(version: 2)
                node { id type }
              }
            }
          }
        }
        """
        try:
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=json.dumps({"query": q, "variables": {"id": int(anilist_id)}}).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "KoUp/1.0"},
            )
            with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    edges = (((payload.get("data") or {}).get("Media") or {}).get("relations") or {}).get("edges") or []
                    rel_aids = [
                        int(e["node"]["id"])
                        for e in edges
                        if e.get("node") and e["node"].get("type") == "ANIME" and e["node"].get("id")
                    ]
                    if rel_aids:
                        placeholders = ",".join("?" for _ in rel_aids)
                        cur.execute(f"SELECT id FROM dramas WHERE anilist_id IN ({placeholders})", rel_aids)
                        for r in cur.fetchall():
                            if r[0] != drama_id:
                                related_drama_ids.add(int(r[0]))
        except Exception:
            pass

    # 2. Check normalized base title match (e.g. "2. Sezon", "Season 2", "Part 2", "Movie")
    base_t = re.sub(
        r"\s*(?:\d+\.\s*sezon|season\s*\d+|part\s*\d+|cour\s*\d+|movie.*|film.*|ova.*|special.*|\bii\b|\biii\b|\biv\b).*$",
        "",
        title or "",
        flags=re.I,
    ).strip(" -–—:")
    if len(base_t) >= 4:
        cur.execute(
            "SELECT id, title FROM dramas WHERE id != ? AND content_type = ? AND title LIKE ?",
            (drama_id, content_type, f"{base_t}%"),
        )
        for r_id, r_title in cur.fetchall():
            r_base = re.sub(
                r"\s*(?:\d+\.\s*sezon|season\s*\d+|part\s*\d+|cour\s*\d+|movie.*|film.*|ova.*|special.*|\bii\b|\biii\b|\biv\b).*$",
                "",
                r_title or "",
                flags=re.I,
            ).strip(" -–—:")
            if norm_title(r_base) == norm_title(base_t):
                related_drama_ids.add(int(r_id))

    if not related_drama_ids:
        return False

    # Load existing franchise_graph.json
    graph_path = os.path.join(_ROOT, "koup-app", "src", "data", "franchise_graph.json")
    if not os.path.exists(graph_path):
        return False

    with open(graph_path, "r", encoding="utf-8") as f:
        graph_data = json.load(f)

    m2f = graph_data.get("media_to_franchise") or {}
    franchises = graph_data.get("franchises") or {}

    target_fid = None
    for rid in related_drama_ids:
        if str(rid) in m2f:
            target_fid = m2f[str(rid)]
            break

    all_member_ids = {drama_id} | related_drama_ids
    if target_fid and target_fid in franchises:
        for existing_item in franchises[target_fid].get("items", []):
            all_member_ids.add(int(existing_item["id"]))
    else:
        target_fid = f"fr_{min(all_member_ids)}"

    placeholders = ",".join("?" for _ in all_member_ids)
    cur.execute(
        f"SELECT id, slug, title, release_year, content_type, episode_count, cover_image FROM dramas WHERE id IN ({placeholders})",
        list(all_member_ids),
    )
    rows = cur.fetchall()
    if len(rows) < 2:
        return False

    items_list = []
    for r in rows:
        rid, rslug, rtitle, ryear, rctype, repcount, rcover = r
        is_mov = rctype == "film" or bool(re.search(r"\b(movie|film|ova|special|ona)\b", rtitle or "", re.I))
        cat = "side" if is_mov else "main"
        items_list.append({
            "id": int(rid),
            "slug": clean_scraped_slug(rslug) or rslug,
            "title": rtitle,
            "release_year": int(ryear or 0),
            "content_type": rctype or "dizi",
            "episode_count": int(repcount or 0),
            "cover_image": rcover or "/logo-dark.png",
            "category": cat,
            "role_label": "Film / Özel" if cat == "side" else "Ana Seri",
            "format": "MOVIE" if is_mov else "TV",
            "watch_order": 1,
        })

    items_list.sort(key=lambda x: (0 if x["category"] == "main" else 1, x["release_year"] or 9999, x["id"]))
    for idx_order, it in enumerate(items_list, 1):
        it["watch_order"] = idx_order

    fr_title = items_list[0]["title"]
    franchises[target_fid] = {
        "franchise_id": target_fid,
        "title": fr_title,
        "items": items_list,
    }
    for it in items_list:
        m2f[str(it["id"])] = target_fid

    with open(graph_path, "w", encoding="utf-8") as f:
        json.dump(graph_data, f, ensure_ascii=False, separators=(",", ":"))

    r2_graph_path = os.path.join(_ROOT, "r2_bundles", "franchise_graph.json")
    if os.path.exists(os.path.dirname(r2_graph_path)):
        with open(r2_graph_path, "w", encoding="utf-8") as f:
            json.dump(graph_data, f, ensure_ascii=False, separators=(",", ":"))
        upload_to_r2(r2_graph_path, "bundles/franchise_graph.json")

    sb_rows = [
        {
            "media_id": it["id"],
            "franchise_id": target_fid,
            "franchise_title": fr_title,
            "category": it["category"],
            "role_label": it["role_label"],
            "format": it["format"],
            "watch_order": it["watch_order"],
            "release_year": it["release_year"],
        }
        for it in items_list
    ]
    sb_request(
        "POST",
        "/rest/v1/franchise_items?on_conflict=media_id",
        body=sb_rows,
        prefer="resolution=merge-duplicates,return=minimal",
    )
    return True


def ensure_media_synced(conn, cur, drama_id: int):
    """Defensive self-healing: ensures the drama exists in Supabase public.media before episodes are synced."""
    try:
        cur.execute("SELECT * FROM dramas WHERE id = ?", (drama_id,))
        row = cur.fetchone()
        if not row:
            return False
        cols = [d[0] for d in cur.description]
        d = dict(zip(cols, row))
        now_iso = datetime.now(timezone.utc).isoformat()
        parsed_tags = None
        if d.get("tags"):
            try:
                parsed_tags = json.loads(d["tags"]) if isinstance(d["tags"], str) else d["tags"]
            except Exception:
                parsed_tags = [x.strip() for x in str(d["tags"]).split(",") if x.strip()]
            if not isinstance(parsed_tags, list):
                parsed_tags = [str(parsed_tags)]

        parsed_alt_sites = None
        if d.get("alt_sites"):
            try:
                parsed_alt_sites = json.loads(d["alt_sites"]) if isinstance(d["alt_sites"], str) else d["alt_sites"]
            except Exception:
                parsed_alt_sites = [x.strip() for x in str(d["alt_sites"]).split(",") if x.strip()]
            if not isinstance(parsed_alt_sites, list):
                parsed_alt_sites = [str(parsed_alt_sites)]

        clean_payload = {
            "id": d["id"],
            "slug": d["slug"],
            "title": d["title"],
            "native_title": d.get("native_title") or d["title"],
            "content_type": d.get("content_type") or "dizi",
            "country_code": d.get("country") or "KR",
            "country_name": d.get("country_name") or "Güney Kore",
            "release_year": int(d.get("release_year") or datetime.now().year),
            "status_broadcast": d.get("status_broadcast") or "Devam Ediyor",
            "cover_image": d.get("cover_image") or "/logo-dark.png",
            "backdrop_image": d.get("backdrop_image") or d.get("cover_image") or "/logo-dark.png",
            "overview": d.get("overview") or "",
            "source_url": d.get("source_url") or None,
            "tmdb_id": d.get("tmdb_id") or None,
            "imdb_id": d.get("imdb_id") or None,
            "anilist_id": d.get("anilist_id") or None,
            "anilist_url": d.get("anilist_url") or None,
            "episode_count": int(d.get("episode_count") or 0),
            "sources_count": int(d.get("sources_count") or 0),
            "tags": parsed_tags,
            "alt_sites": parsed_alt_sites,
            "updated_at": now_iso,
        }
        res = sb_request("POST", "/rest/v1/media?on_conflict=id", body=clean_payload, prefer="resolution=merge-duplicates,return=representation")
        if isinstance(res, dict) and res.get("_error"):
            print(f"[ENSURE_MEDIA_SYNC_ERROR] Drama #{drama_id}: {res}", flush=True)
            return False
        try:
            auto_sync_drama_cast(
                d["id"],
                d["title"],
                d.get("content_type") or "dizi",
                tmdb_id=d.get("tmdb_id"),
                anilist_id=d.get("anilist_id"),
            )
        except Exception:
            pass
        return True
    except Exception as e:
        print(f"[ENSURE_MEDIA_SYNC_EXCEPTION] Drama #{drama_id}: {e}", flush=True)
        return False


def sync_drama_bundle_and_counts(conn, cur, drama_id: int):
    """Updates SQLite episode_count/sources_count, uploads R2 bundle, and syncs Supabase media & episodes."""
    try:
        ensure_media_synced(conn, cur, drama_id)
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
                WHERE episode_id = ? 
                  AND direct_url IS NOT NULL 
                  AND direct_url != ''
                  AND direct_url != 'dead'
                  AND provider != 'dead'
                  AND provider != 'sibnet'
                  AND provider != 'sendvid'
                  AND provider NOT LIKE '%sibnet%'
                  AND direct_url NOT LIKE '%sibnet%'
                  AND direct_url NOT LIKE '%sendvid%'
                  AND direct_url NOT LIKE '%uns.bio%'
                  AND direct_url NOT LIKE '%playerdkorea.xyz%'
                  AND direct_url NOT LIKE '%asyaanim.upns.one%'
                  AND direct_url NOT LIKE '%upns.one%'
                  AND direct_url NOT LIKE '%upns.live%'
                  AND direct_url NOT LIKE '%vidmoly.me%'
                  AND direct_url NOT LIKE '%embed-7fm0wb9yzf4m.html%'
                  AND direct_url NOT LIKE 'javascript:%'
                  AND direct_url NOT LIKE '%void(0)%'
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
                c_sname = clean_source_name(sname or prov or "Kaynak")
                srcs.append({
                    "id": sid,
                    "source_name": c_sname,
                    "provider": prov or "other",
                    "direct_url": durl,
                    "embed_id": eid or "",
                    "site": site or "",
                    "fansub": None,
                    "quality_label": "1080p",
                })

            def _src_priority(s):
                p = (s.get("provider") or "").lower()
                n = (s.get("source_name") or "").lower()
                u = (s.get("direct_url") or "").lower()
                if "tau-video" in p or "tau" in n or "tau-video" in u:
                    return -5
                if "morencius" in p or "ev" in p or n == "ev" or n.startswith("ev ") or "morencius" in u:
                    return -4.5
                if "rapidrame" in p or "diziyou" in p:
                    return -4
                if "tr-dublaj" in p or "tr-altyazi" in p or "player" in p or "hls" in p:
                    return -3
                if "uqload" in p or "uqload" in u:
                    return -2
                if "vidmoly" in p or "vidmoly" in u:
                    return -1
                return 0
            srcs.sort(key=_src_priority)
            is_pending = (src_status == "pending")
            if is_pending:
                srcs = []
            if srcs or is_pending:
                clean_name = clean_episode_title(ep_name, s_num or 1, e_num, drama_title=d_row[1])
                ep_obj = {
                    "id": ep_id,
                    "season_number": s_num or 1,
                    "episode_number": e_num,
                    "episode_name": clean_name,
                    "episode_type": ep_type or "normal",
                    "status": "pending_source" if is_pending else "published",
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

            now_iso = datetime.now(timezone.utc).isoformat()
            max_ep = max((ep.get("episode_number") or 1 for ep in ep_out), default=1)

            # 2. Fetch existing episodes from Supabase to preserve real published_at timestamps
            existing_ep_rows = sb_request(
                "GET",
                f"/rest/v1/episodes?media_id=eq.{drama_id}&select=id,season_number,episode_number,status,published_at",
            )
            existing_map = {}
            if isinstance(existing_ep_rows, list):
                for r in existing_ep_rows:
                    existing_map[(r.get("season_number") or 1, r.get("episode_number"))] = r

            has_newly_published = False

            # 3. Upsert episodes into Supabase public.episodes table with their sources
            sb_episodes_map = {}
            for ep in ep_out:
                s_num = ep.get("season_number") or 1
                e_num = ep.get("episode_number")
                key = (s_num, e_num)
                is_pend = bool(ep.get("pending"))
                new_status = "pending_source" if is_pend else "published"

                existing_ep = existing_map.get(key)
                ep_pub_at = None
                if existing_ep:
                    # If previously pending and now published, mark as newly published
                    if existing_ep.get("status") in ("pending_source", "placeholder") and new_status == "published":
                        ep_pub_at = now_iso
                        has_newly_published = True
                    else:
                        # PRESERVE existing published_at! Never re-bump an already published episode to now()!
                        ep_pub_at = existing_ep.get("published_at")
                else:
                    if new_status == "published":
                        ep_pub_at = now_iso
                        has_newly_published = True

                candidate = {
                    "media_id": drama_id,
                    "season_number": s_num,
                    "episode_number": e_num,
                    "episode_name": ep.get("episode_name") or f"Bölüm {e_num}",
                    "episode_type": ep.get("episode_type") or "normal",
                    "status": new_status,
                    "video_sources": ep.get("sources") or [],
                    "published_at": ep_pub_at,
                }

                # If duplicate season/episode exists in SQLite, keep the one with sources
                if key not in sb_episodes_map or (len(candidate["video_sources"]) > len(sb_episodes_map[key]["video_sources"])):
                    sb_episodes_map[key] = candidate

            # 4. Update Supabase media counts and timestamps (only update last_published_at if a new episode was published)
            media_patch = {
                "episode_count": len(ep_out),
                "episodes_available": len([e for e in ep_out if not e.get("pending")]),
                "updated_at": now_iso,
            }
            if has_newly_published:
                media_patch["last_published_episode"] = max_ep
                media_patch["last_published_at"] = now_iso

            sb_request(
                "PATCH",
                f"/rest/v1/media?id=eq.{drama_id}",
                body=media_patch,
                prefer="return=minimal",
            )

            sb_episodes = list(sb_episodes_map.values())
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

        # Checkpoint SQLite WAL non-blocking so changes flush into webdrama_archive.db
        try:
            cur.execute("PRAGMA wal_checkpoint(PASSIVE);")
        except Exception:
            pass
    except Exception as e:
        print(f"[SYNC_DRAMA_BUNDLE_ERROR] {drama_id}: {e}", flush=True)
