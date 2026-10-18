#!/usr/bin/env python3
"""
Exports all titles with sources from webdrama_archive.db into R2-ready JSON bundles:
  r2_bundles/sources/{mediaId}.json

This matches the exact schema expected by /api/sources/[mediaId] and Cloudflare R2 CDN.
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ARCHIVE_DB_PATH", "webdrama_archive.db"))
OUT_DIR = Path("r2_bundles/sources")

def classify_stream_type(provider: str, direct_url: str) -> str:
    p = (provider or "").lower()
    u = (direct_url or "").lower()
    if (
        p in ("diziyou-hls", "hdfilm-hls", "asyawatch", "dizilla", "dbx", "dizibox")
        or "pichive" in u
        or "dplayer" in u
        or "hotlinger" in u
        or "molystream" in u
        or ".m3u8" in u
        or "master.txt" in u
    ):
        return "hls"
    if u.endswith(".mp4") or ".mp4?" in u:
        return "mp4"
    if p == "tau-video" or "tau-video.xyz" in u:
        return "tau"
    if p in ("ok.ru", "odnoklassniki", "vk", "dailymotion"):
        return "postmessage_iframe"
    return "locked_iframe"

def get_provider_priority(provider: str, direct_url: str, content_type: str) -> int:
    p = (provider or "").lower()
    u = (direct_url or "").lower()

    if p == "asyawatch" or "pichive" in u or p == "dizilla" or "dplayer" in u:
        return 0
    if p == "hdfilm-close" or "/video/embed/" in u:
        return 10

    if content_type == "anime":
        if p == "tau-video" or "tau-video" in u:
            return 1
        if "hls" in p or ".m3u8" in u:
            return 2
    else:
        if (
            "rapid" in p
            or "hls" in p
            or "rapidrame" in u
            or p in ("diziyou", "dbx", "dizibox")
            or "molystream" in u
            or ".m3u8" in u
        ):
            return 1
        if p == "tau-video" or "tau-video" in u:
            return 2

    if p in ("vidmoly", "filemoon", "yourupload"):
        return 3
    if p == "sibnet" or "sibnet.ru" in u:
        return 4
    if p in ("sendvid", "uqload", "mp4upload", "doodstream", "voe", "vudeo"):
        return 5
    if p in ("vk", "mail.ru", "mail", "dailymotion", "mega"):
        return 6
    if "gdrive" in p or "google" in p or "drive.google.com" in u:
        return 7
    if p in ("ok.ru", "odnoklassniki") or "ok.ru" in u or "odnoklassniki" in u:
        return 90
    return 8

def export_all():
    if not DB_PATH.exists():
        print(f"Error: {DB_PATH} not found.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    print("Fetching dramas with episodes and sources...")
    # Get all dramas that have at least 1 episode with sources
    dramas = c.execute("""
        SELECT DISTINCT d.id, d.title, d.content_type
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        JOIN episode_sources s ON s.episode_id = e.id
        WHERE s.direct_url IS NOT NULL 
          AND s.direct_url != '' 
          AND s.direct_url != 'dead'
    """).fetchall()

    print(f"Found {len(dramas):,} dramas with verified sources.")

    src_query = """
        SELECT source_name, embed_id, direct_url, provider, site, fansub
        FROM episode_sources
        WHERE episode_id = ?
          AND direct_url IS NOT NULL
          AND direct_url != 'dead'
          AND direct_url != ''
          AND provider != 'dead'
          AND provider != 'sendvid'
          AND provider NOT LIKE '%gdrive%'
          AND provider NOT LIKE '%google%'
          AND direct_url NOT LIKE '%sendvid%'
          AND direct_url NOT LIKE '%drive.google.com%'
          AND direct_url NOT LIKE '%docs.google.com%'
          AND direct_url NOT LIKE '%4meplayer%'
          AND direct_url NOT LIKE '%p2pplay%'
          AND direct_url NOT LIKE '%rpmplay%'
          AND direct_url NOT LIKE '%uns.bio%'
          AND direct_url NOT LIKE '%playerdkorea.xyz%'
          AND direct_url NOT LIKE '%video.diziasya.com%'
    """

    count = 0
    total_sources = 0

    for drama_id, drama_title, content_type in dramas:
        content_type = (content_type or "dizi").lower()

        ep_rows = c.execute("""
            SELECT id, season_number, episode_number, episode_name, episode_type
            FROM episodes
            WHERE drama_id = ?
            ORDER BY season_number ASC, episode_number ASC
        """, (drama_id,)).fetchall()

        episodes = []

        for ep_id, season_num, ep_num, ep_name, ep_type in ep_rows:
            raw_sources = c.execute(src_query, (ep_id,)).fetchall()
            if not raw_sources:
                continue

            has_alt = any(
                row[2] and "ok.ru" not in row[2].lower() and "odnoklassniki" not in row[2].lower()
                and (row[3] or "").lower() not in ("ok.ru", "odnoklassniki")
                for row in raw_sources
            )

            seen_urls = set()
            processed = []

            for s_name, embed_id, direct_url, provider, site, fansub in raw_sources:
                if not direct_url or direct_url in seen_urls:
                    continue
                p_low = (provider or "").lower()
                u_low = direct_url.lower()

                if has_alt and (p_low in ("ok.ru", "odnoklassniki") or "ok.ru" in u_low or "odnoklassniki" in u_low):
                    continue

                seen_urls.add(direct_url)
                stype = classify_stream_type(provider, direct_url)
                prio = get_provider_priority(provider, direct_url, content_type)

                clean_name = s_name or provider or "Kaynak"
                is_native = (
                    stype in ("hls", "tau", "mp4")
                    or p_low in ("diziyou-hls", "hdfilm-hls", "asyawatch")
                    or "pichive" in u_low
                )
                clean_fansub = fansub or None

                if p_low == "asyawatch" or (site or "").lower() == "asyawatch" or "pichive" in u_low:
                    clean_name = "Orijinal"
                    clean_fansub = None
                elif p_low == "dizilla" or (site or "").lower() == "dizilla" or "dplayer" in u_low or "hotlinger" in u_low:
                    clean_name = "Dizilla"
                    clean_fansub = None
                elif is_native:
                    clean_name = "Orijinal"
                elif "dizikorea" in clean_name.lower() or "diziyou" in clean_name.lower():
                    clean_name = "Orijinal"

                if clean_fansub and clean_fansub.lower() in ("asyawatch", "dizilla", "webdrama", "koup", "varsayılan"):
                    clean_fansub = None

                is_hq = is_native or p_low in ("asyawatch", "dizilla") or "pichive" in u_low or "dplayer" in u_low
                processed.append({
                    "source_name": clean_name,
                    "embed_id": embed_id,
                    "direct_url": direct_url,
                    "provider": provider or "other",
                    "site": site or "webdrama",
                    "fansub": clean_fansub,
                    "stream_type": stype,
                    "quality_label": "1080p" if is_hq else "HD Embed",
                    "_prio": prio
                })

            processed.sort(key=lambda x: x["_prio"])
            processed = processed[:18]

            orig_count = 0
            for item in processed:
                item.pop("_prio", None)
                if item["source_name"].startswith("Orijinal"):
                    orig_count += 1
                    if orig_count > 1:
                        item["source_name"] = f"Orijinal {orig_count}"

            # Clean episode name
            raw_ep_name = ep_name or ""
            is_corrupted = not raw_ep_name or "\ufffd" in raw_ep_name or "B?l?m" in raw_ep_name or "?" in raw_ep_name
            cleaned_title = f"{ep_num or 1}. Bölüm" if is_corrupted else raw_ep_name

            episodes.append({
                "id": ep_id,
                "season_number": season_num or 1,
                "episode_number": ep_num or 1,
                "episode_name": cleaned_title,
                "episode_type": ep_type or "bolum",
                "status": "published",
                "scheduled_release_at": None,
                "translation_note": None,
                "react_fire": 0,
                "react_cry": 0,
                "react_shock": 0,
                "react_angry": 0,
                "sources": processed
            })
            total_sources += len(processed)

        if not episodes:
            continue

        bundle = {
            "mediaId": drama_id,
            "totalEpisodes": len(episodes),
            "episodes": episodes
        }

        out_file = OUT_DIR / f"{drama_id}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(bundle, f, ensure_ascii=False)

        count += 1
        if count % 2000 == 0:
            print(f"Exported {count:,} / {len(dramas):,} bundles...")

    print(f"\nDone! Exported {count:,} drama bundles ({total_sources:,} stream sources total) to {OUT_DIR}/")

if __name__ == "__main__":
    export_all()
