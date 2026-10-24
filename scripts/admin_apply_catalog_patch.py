#!/usr/bin/env python3
"""
Admin Catalog Full Storage Sync Engine (GEMINI.md Rule 11)
Ensures every catalog mutation made in the KoUp Admin Panel is propagated to:
1. Local SQLite (`webdrama_archive.db`: dramas, episodes, episode_sources) + WAL checkpoint
2. Local R2 JSON bundle (`r2_bundles/sources/{id}.json`)
3. Cloudflare R2 bucket (`sources/{id}.json`, and optionally `db/webdrama_archive.db`)
4. Supabase (`public.media` and `public.episodes`)
"""

import argparse
import json
import os
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    _load_r2_creds,
    backup_db_to_r2,
    sync_drama_bundle_and_counts,
)


def delete_r2_bundle(drama_id: int) -> bool:
    try:
        import boto3
        endpoint, access_key, secret_key, bucket = _load_r2_creds()
        if not (endpoint and access_key and secret_key and bucket):
            return False
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )
        s3.delete_object(Bucket=bucket, Key=f"sources/{drama_id}.json")
        return True
    except Exception as e:
        print(f"[R2_DELETE_BUNDLE_ERROR] sources/{drama_id}.json: {e}", flush=True)
        return False


def ensure_sqlite_episode(cur, drama_id: int, season_number: int, episode_number: int, episode_name: str = None, episode_type: str = "normal", source_status: str = "ok") -> int:
    row = cur.execute(
        "SELECT id FROM episodes WHERE drama_id = ? AND COALESCE(season_number, 1) = ? AND episode_number = ?",
        (drama_id, season_number, episode_number),
    ).fetchone()
    if row:
        ep_id = row[0]
        cur.execute(
            """
            UPDATE episodes
            SET episode_name = COALESCE(?, episode_name),
                episode_type = COALESCE(?, episode_type),
                source_status = COALESCE(?, source_status)
            WHERE id = ?
            """,
            (episode_name, episode_type, source_status, ep_id),
        )
        return ep_id
    cur.execute(
        """
        INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_type, source_status)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            drama_id,
            season_number,
            episode_number,
            episode_name or f"{episode_number}. Bölüm",
            episode_type or "normal",
            source_status or "ok",
        ),
    )
    return cur.lastrowid


def replace_sqlite_sources(cur, ep_id: int, sources: list):
    cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (ep_id,))
    for idx, src in enumerate(sources or []):
        if not isinstance(src, dict):
            continue
        direct_url = (src.get("direct_url") or src.get("url") or "").strip()
        if not direct_url:
            continue
        source_name = (src.get("source_name") or src.get("provider") or f"Kaynak {idx + 1}").strip()
        provider = (src.get("provider") or "other").strip()
        embed_id = (src.get("embed_id") or direct_url).strip()
        site = (src.get("site") or "admin").strip()
        fansub = src.get("fansub")
        cur.execute(
            """
            INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (ep_id, source_name, embed_id, direct_url, provider, fansub, site),
        )


def main():
    parser = argparse.ArgumentParser(description="KoUp Admin Catalog Full Storage Sync Patch")
    parser.add_argument("--action", required=True, choices=[
        "series_upsert",
        "series_delete",
        "episode_upsert",
        "episode_delete",
        "source_sync",
        "backup_db",
    ])
    parser.add_argument("--payload-json", default="{}")
    parser.add_argument("--backup-r2", action="store_true")
    args = parser.parse_args()

    try:
        payload = json.loads(args.payload_json or "{}")
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Invalid payload JSON: {e}"}))
        sys.exit(1)

    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    if not os.path.exists(db_path):
        print(json.dumps({"ok": False, "error": "Local webdrama_archive.db not found"}))
        sys.exit(1)

    conn = sqlite3.connect(db_path, timeout=45.0)
    conn.execute("PRAGMA busy_timeout = 45000;")
    cur = conn.cursor()

    try:
        action = args.action
        if action == "backup_db":
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.commit()
            conn.close()
            ok = backup_db_to_r2()
            print(f"__RESULT__ {json.dumps({'ok': ok, 'action': action})}", flush=True)
            return

        drama_id = int(payload.get("media_id") or payload.get("id") or 0)
        if not drama_id:
            conn.close()
            print(f"__RESULT__ {json.dumps({'ok': False, 'error': 'Missing media_id/id'})}", flush=True)
            sys.exit(1)

        if action == "series_upsert":
            exists = cur.execute("SELECT id FROM dramas WHERE id = ?", (drama_id,)).fetchone()
            title = (payload.get("title") or "").strip()
            slug = (payload.get("slug") or "").strip()
            native_title = payload.get("native_title")
            content_type = payload.get("content_type") or "dizi"
            country = payload.get("country_code") or payload.get("country") or "KR"
            country_name = payload.get("country_name") or "Güney Kore"
            release_year = int(payload.get("release_year") or 2024)
            status_broadcast = payload.get("status_broadcast") or "Devam Ediyor"
            cover_image = payload.get("cover_image") or "/logo-dark.png"
            backdrop_image = payload.get("backdrop_image") or cover_image
            overview = payload.get("overview") or ""
            tmdb_id = payload.get("tmdb_id")
            imdb_id = payload.get("imdb_id")
            anilist_id = payload.get("anilist_id")

            if exists:
                cur.execute(
                    """
                    UPDATE dramas
                    SET title = COALESCE(NULLIF(?, ''), title),
                        slug = COALESCE(NULLIF(?, ''), slug),
                        native_title = COALESCE(?, native_title),
                        content_type = COALESCE(?, content_type),
                        country = COALESCE(?, country),
                        country_name = COALESCE(?, country_name),
                        release_year = COALESCE(?, release_year),
                        status_broadcast = COALESCE(?, status_broadcast),
                        cover_image = COALESCE(NULLIF(?, ''), cover_image),
                        backdrop_image = COALESCE(NULLIF(?, ''), backdrop_image),
                        overview = COALESCE(?, overview),
                        tmdb_id = COALESCE(?, tmdb_id),
                        imdb_id = COALESCE(?, imdb_id),
                        anilist_id = COALESCE(?, anilist_id)
                    WHERE id = ?
                    """,
                    (
                        title, slug, native_title, content_type, country, country_name,
                        release_year, status_broadcast, cover_image, backdrop_image,
                        overview, tmdb_id, imdb_id, anilist_id, drama_id,
                    ),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO dramas (
                        id, title, slug, native_title, content_type, country, country_name,
                        release_year, status_broadcast, cover_image, backdrop_image, overview,
                        tmdb_id, imdb_id, anilist_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        drama_id, title, slug, native_title or title, content_type, country,
                        country_name, release_year, status_broadcast, cover_image, backdrop_image,
                        overview, tmdb_id, imdb_id, anilist_id,
                    ),
                )
            conn.commit()
            sync_drama_bundle_and_counts(conn, cur, drama_id)

        elif action == "series_delete":
            cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (drama_id,))
            cur.execute("DELETE FROM episodes WHERE drama_id = ?", (drama_id,))
            try:
                cur.execute("DELETE FROM drama_actors WHERE drama_id = ?", (drama_id,))
            except Exception:
                pass
            try:
                cur.execute("DELETE FROM series_automations WHERE media_id = ?", (drama_id,))
            except Exception:
                pass
            cur.execute("DELETE FROM dramas WHERE id = ?", (drama_id,))
            conn.commit()

            local_bundle = os.path.join(_ROOT, "r2_bundles", "sources", f"{drama_id}.json")
            if os.path.exists(local_bundle):
                try:
                    os.remove(local_bundle)
                except Exception:
                    pass
            delete_r2_bundle(drama_id)

        elif action == "episode_upsert":
            season_number = int(payload.get("season_number") or 1)
            episode_number = int(payload.get("episode_number") or 1)
            episode_name = payload.get("episode_name") or f"{episode_number}. Bölüm"
            episode_type = payload.get("episode_type") or "normal"
            status = payload.get("status") or "published"
            source_status = "pending" if status == "pending_source" else "ok"
            ep_id = ensure_sqlite_episode(cur, drama_id, season_number, episode_number, episode_name, episode_type, source_status)
            if "video_sources" in payload and isinstance(payload["video_sources"], list):
                replace_sqlite_sources(cur, ep_id, payload["video_sources"])
            conn.commit()
            sync_drama_bundle_and_counts(conn, cur, drama_id)

        elif action == "episode_delete":
            season_number = int(payload.get("season_number") or 1)
            episode_number = int(payload.get("episode_number") or 1)
            rows = cur.execute(
                "SELECT id FROM episodes WHERE drama_id = ? AND COALESCE(season_number, 1) = ? AND episode_number = ?",
                (drama_id, season_number, episode_number),
            ).fetchall()
            for (ep_id,) in rows:
                cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (ep_id,))
                cur.execute("DELETE FROM episodes WHERE id = ?", (ep_id,))
            conn.commit()
            sync_drama_bundle_and_counts(conn, cur, drama_id)

        elif action == "source_sync":
            season_number = int(payload.get("season_number") or 1)
            episode_number = int(payload.get("episode_number") or 1)
            episode_name = payload.get("episode_name")
            sources = payload.get("video_sources") or []
            source_status = "pending" if len(sources) == 0 and payload.get("status") == "pending_source" else "ok"
            ep_id = ensure_sqlite_episode(cur, drama_id, season_number, episode_number, episode_name, "normal", source_status)
            replace_sqlite_sources(cur, ep_id, sources)
            conn.commit()
            sync_drama_bundle_and_counts(conn, cur, drama_id)

        cur.execute("PRAGMA wal_checkpoint(PASSIVE);")
        conn.commit()
        conn.close()

        r2_db_backed_up = False
        if args.backup_r2:
            r2_db_backed_up = backup_db_to_r2()

        print(f"__RESULT__ {json.dumps({'ok': True, 'action': action, 'mediaId': drama_id, 'r2DbBackedUp': r2_db_backed_up})}", flush=True)
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        print(f"__RESULT__ {json.dumps({'ok': False, 'error': str(e)})}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
