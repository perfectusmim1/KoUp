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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scrapers.clean_fansub import clean_fansub_name, clean_source_name

DB_PATH = Path(os.environ.get("ARCHIVE_DB_PATH", "webdrama_archive.db"))
OUT_DIR = Path("r2_bundles/sources")

def classify_stream_type(provider: str, direct_url: str) -> str:
    p = (provider or "").lower()
    u = (direct_url or "").lower()
    if (
        p in ("diziyou-hls", "hdfilm-hls", "asyawatch", "dizilla", "dbx", "dizibox", "morencius", "ev", "filemoon", "byse", "gdriveplayer", "gdplayer", "upns", "streamwish", "vidhide", "streamruby", "dzen")
        or "pichive" in u
        or "dplayer" in u
        or "hotlinger" in u
        or "molystream" in u
        or "morencius" in u
        or "filemoon" in u
        or "bysesukior" in u
        or "bysedikamoum" in u
        or "gdriveplayer" in u
        or "gdplayer" in u
        or "upns" in u
        or "streamwish" in u
        or "ghbrisk" in u
        or "dhtpre" in u
        or "streamruby" in u
        or "dzen.ru" in u
        or "luluvdo" in u
        or "lulustream" in u
        or ".m3u8" in u
        or "master.txt" in u
    ):
        return "hls"
    if u.endswith(".mp4") or ".mp4?" in u or "ddizi.tel/player/mp4" in u or p in ("mail.ru", "mail", "mp4upload") or "my.mail.ru" in u or "mp4upload" in u or "yadi.sk" in u or "disk.yandex" in u:
        return "mp4"
    if (
        p in ("uqload", "voe", "vk", "ok.ru", "odnoklassniki")
        or "uqload." in u
        or "voe.sx" in u
        or "voe." in u
        or "vk.com" in u
        or "ok.ru" in u
    ):
        return "hls"
    if p == "tau-video" or "tau-video.xyz" in u:
        return "tau"
    if p in ("dailymotion",) or "dailymotion.com" in u or "dai.ly" in u:
        return "hls"
    return "locked_iframe"

def get_provider_priority(provider: str, direct_url: str, content_type: str) -> int:
    p = (provider or "").lower()
    u = (direct_url or "").lower()

    if p == "tau-video" or "tau-video" in u:
        return 0
    if p in ("rapidrame", "diziyou-hls") or "rplayer" in u or "storage.diziyou" in u:
        return 1
    if p in ("hdfilm-close", "dizikorea", "dizibox", "dbx", "dizilla", "asyawatch") or "pichive" in u or "dplayer" in u:
        return 2
    if p in ("vidmoly", "uqload") or "vidmoly" in u or "uqload" in u:
        return 3
    if p in ("ok.ru", "odnoklassniki", "mail.ru", "mail", "vk", "dailymotion"):
        return 4
    if ".m3u8" in u:
        return 5
    if p in ("mp4upload", "voe", "filemoon"):
        return 6
    return 8

def export_all(drama_id: int = None):
    if not DB_PATH.exists():
        print(f"Error: {DB_PATH} not found.")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if drama_id:
        print(f"Fetching drama #{drama_id}...")
        dramas = c.execute("""
            SELECT DISTINCT d.id, d.title, d.content_type
            FROM dramas d
            WHERE d.id = ?
        """, (drama_id,)).fetchall()
    else:
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
              AND s.provider != 'sibnet'
              AND s.direct_url NOT LIKE '%sibnet.ru%'
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
          AND provider != 'sibnet'
          AND provider != 'sendvid'
          AND provider NOT LIKE '%sibnet%'
          AND provider NOT LIKE '%gdrive%'
          AND provider NOT LIKE '%google%'
          AND direct_url NOT LIKE '%sibnet.ru%'
          AND direct_url NOT LIKE '%sendvid%'
          AND direct_url NOT LIKE '%drive.google.com%'
          AND direct_url NOT LIKE '%docs.google.com%'
          AND direct_url NOT LIKE '%4meplayer%'
          AND direct_url NOT LIKE '%p2pplay%'
          AND direct_url NOT LIKE '%rpmplay%'
          AND direct_url NOT LIKE '%uns.bio%'
          AND direct_url NOT LIKE '%playerdkorea.xyz%'
          AND direct_url NOT LIKE '%video.diziasya.com%'
          AND direct_url NOT LIKE '%asyaanim.upns.one%'
          AND direct_url NOT LIKE '%embed-7fm0wb9yzf4m.html%'
    """

    count = 0
    total_sources = 0

    for drama_id, drama_title, content_type in dramas:
        content_type = (content_type or "dizi").lower()

        ep_rows = c.execute("""
            SELECT id, season_number, episode_number, episode_name, episode_type, source_status
            FROM episodes
            WHERE drama_id = ?
            ORDER BY season_number ASC, episode_number ASC
        """, (drama_id,)).fetchall()

        episodes = []

        for ep_id, season_num, ep_num, ep_name, ep_type, src_status in ep_rows:
            raw_sources = c.execute(src_query, (ep_id,)).fetchall()
            is_pending = (src_status == "pending")
            if not raw_sources and not is_pending:
                continue

            seen_urls = set()
            processed = []

            for s_name, embed_id, direct_url, provider, site, fansub in raw_sources:
                if not direct_url or direct_url in seen_urls:
                    continue
                p_low = (provider or "").lower()
                u_low = direct_url.lower()

                seen_urls.add(direct_url)
                stype = classify_stream_type(provider, direct_url)
                prio = get_provider_priority(provider, direct_url, content_type)

                clean_name = clean_source_name(s_name or provider or "Kaynak")
                is_native = (
                    stype in ("hls", "tau", "mp4")
                    or p_low in ("diziyou-hls", "hdfilm-hls", "asyawatch")
                    or "pichive" in u_low
                )
                clean_fansub = clean_fansub_name(fansub)

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
            cleaned_title = f"{ep_num if ep_num is not None else 1}. Bölüm" if is_corrupted else raw_ep_name

            ep_dict = {
                "id": ep_id,
                "season_number": season_num if season_num is not None else 1,
                "episode_number": ep_num if ep_num is not None else 1,
                "episode_name": cleaned_title,
                "episode_type": ep_type or "bolum",
                "status": "pending_source" if is_pending else "published",
                "scheduled_release_at": None,
                "translation_note": None,
                "react_fire": 0,
                "react_cry": 0,
                "react_shock": 0,
                "react_angry": 0,
                "sources": processed
            }
            if is_pending:
                ep_dict["pending"] = True
            episodes.append(ep_dict)
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
    import argparse
    parser = argparse.ArgumentParser(description="Export source bundles to JSON")
    parser.add_argument("--drama-id", type=int, default=None, help="Export single drama ID")
    args = parser.parse_args()
    export_all(drama_id=args.drama_id)
