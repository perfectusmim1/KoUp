#!/usr/bin/env python3
"""
Exports all titles with sources from webdrama_archive.db into R2-ready JSON bundles:
  r2_bundles/sources/{mediaId}.json

This matches the exact schema expected by /api/sources/[mediaId] and Cloudflare R2 CDN.
"""

import os
import sys
import re
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
        p in ("diziyou-hls", "hdfilm-hls", "hdfilm-close", "close", "rapidrame", "asyawatch", "dizilla", "dbx", "dizibox", "morencius", "ev", "filemoon", "byse", "gdriveplayer", "gdplayer", "upns", "streamwish", "vidhide", "streamruby", "dzen")
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
        or "playmix.uno" in u
        or "rapidrame" in u
        or "/rplayer/" in u
        or "hdfilmcehennemi.mobi/video/embed/" in u
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

def get_provider_priority(provider: str, direct_url: str, content_type: str = "") -> float:
    p = (provider or "").lower().strip()
    u = (direct_url or "").lower().strip()

    # Tier 0 (En yüksek): pilavyer, diziizle, tau-video, morencius, ev
    if (
        p in ("pilavyer", "diziizle", "tau-video", "morencius", "ev")
        or "tau-video" in u
        or "morencius" in u
        or "pilavyer" in u
        or "diziizle" in u
    ):
        return 0.0

    # Tier 1: wdt, dtpasn, dramavadisi, shortizle, rapidrame, diziyou-hls, animelvl
    if (
        p in ("wdt", "dtpasn", "dramavadisi", "shortizle", "rapidrame", "diziyou-hls", "animelvl", "diziyou")
        or any(k in u for k in ("wdt", "dtpasn", "dramavadisi", "shortizle", "rapidrame", "storage.diziyou", "diziyou", "animelvl"))
    ):
        return 1.0

    # Tier 2: hdfilm-close, dizikorea, dizibox, dbx, dizilla, asyawatch, mailru, vk, okru, dramabox
    if (
        p in ("hdfilm-close", "dizikorea", "dizibox", "dbx", "dizilla", "asyawatch", "mailru", "mail.ru", "mail", "vk", "okru", "ok.ru", "odnoklassniki", "dramabox")
        or any(k in u for k in ("pichive", "dplayer", "molystream", "mail.ru", "vk.com", "ok.ru", "dramabox"))
    ):
        return 2.0

    # Tier 3: vidmoly, filemoon, byse, uqload, .m3u8
    if (
        p in ("vidmoly", "filemoon", "byse", "uqload")
        or any(k in u for k in ("vidmoly", "filemoon", "bysesukior", "bysedikamoum", "byse.", "uqload", ".m3u8"))
    ):
        return 3.0

    # Tier 9 (En düşük): turnstile_iframe, dplayer, pixel_turnstile, youtube
    if (
        p in ("turnstile_iframe", "dplayer", "pixel_turnstile", "youtube")
        or any(k in u for k in ("youtube.com", "youtu.be", "turnstile", "pixel_turnstile"))
    ):
        return 9.0

    return 5.0

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
          AND provider != 'pixeldrain'
          AND provider NOT LIKE '%sibnet%'
          AND provider NOT LIKE '%gdrive%'
          AND provider NOT LIKE '%google%'
          AND direct_url NOT LIKE '%sibnet.ru%'
          AND direct_url NOT LIKE '%sendvid%'
          AND direct_url NOT LIKE '%pixeldrain%'
          AND direct_url NOT LIKE '%drive.google.com%'
          AND direct_url NOT LIKE '%docs.google.com%'
          AND direct_url NOT LIKE '%4meplayer%'
          AND direct_url NOT LIKE '%p2pplay%'
          AND direct_url NOT LIKE '%rpmplay%'
          AND direct_url NOT LIKE '%uns.bio%'
          AND direct_url NOT LIKE '%playerdkorea.xyz%'
          AND direct_url NOT LIKE '%video.diziasya.com%'
          AND direct_url NOT LIKE '%asyaanim.upns.one%'
          AND direct_url NOT LIKE '%upns.one%'
          AND direct_url NOT LIKE '%upns.live%'
          AND direct_url NOT LIKE '%vidmoly.me%'
          AND direct_url NOT LIKE '%embed-7fm0wb9yzf4m.html%'
          AND direct_url NOT LIKE 'javascript:%'
          AND direct_url NOT LIKE '%void(0)%'
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
            is_pending = (src_status == "pending")
            raw_sources = [] if is_pending else c.execute(src_query, (ep_id,)).fetchall()
            if not raw_sources and not is_pending:
                continue

            seen_urls = set()
            processed = []

            for s_name, embed_id, direct_url, provider, site, fansub in raw_sources:
                if not direct_url:
                    continue
                direct_url = direct_url.strip()
                p_low = (provider or "").lower()
                u_low = direct_url.lower()

                if p_low == "rapidrame" or "hdfilmcehennemi.nl/rplayer/" in u_low or "/rplayer/" in u_low:
                    continue

                if "dbx.molystream.org/embed/" in u_low:
                    direct_url = re.sub(r'dbx\.molystream\.org/embed/(?!sheila/)', 'dbx.molystream.org/embed/sheila/', direct_url, flags=re.IGNORECASE)
                    u_low = direct_url.lower()

                if direct_url in seen_urls:
                    continue
                seen_urls.add(direct_url)
                stype = classify_stream_type(provider, direct_url)
                prio = get_provider_priority(provider, direct_url, content_type)

                clean_name = clean_source_name(s_name or provider or "Kaynak")
                is_native = (
                    stype in ("hls", "tau", "mp4")
                    or p_low in ("diziyou-hls", "hdfilm-hls", "asyawatch")
                    or "pichive" in u_low
                )

                if p_low in ("morencius", "ev") or "morencius" in u_low or clean_name.upper() in ("EV", "EV 1080P") or clean_name.upper().startswith("EV "):
                    display_name = "EV"
                    is_native = True
                elif p_low == "asyawatch" or (site or "").lower() == "asyawatch" or "pichive" in u_low or "molystream" in u_low:
                    display_name = "Orijinal"
                elif p_low == "dizilla" or (site or "").lower() == "dizilla" or "dplayer" in u_low or "hotlinger" in u_low:
                    display_name = "Dizilla"
                elif "diziyou" in p_low or "diziyou" in u_low:
                    if clean_name and ("altyaz" in clean_name.lower() or "dublaj" in clean_name.lower()):
                        display_name = clean_name
                    else:
                        display_name = "Orijinal (Altyazılı)"
                elif "dizikorea" in p_low or "dizikorea" in u_low or "hdfilm" in p_low:
                    display_name = "Orijinal"
                elif p_low == "tau-video" or "tau-video" in u_low:
                    display_name = "Tau Video"
                elif p_low == "vk" or "vk.com" in u_low:
                    display_name = "VK"
                elif p_low in ("mail.ru", "mail") or "mail.ru" in u_low:
                    display_name = "Mail.ru"
                elif p_low == "uqload" or "uqload" in u_low:
                    display_name = "Uqload"
                elif p_low == "voe" or "voe.sx" in u_low or "voe." in u_low:
                    display_name = "VOE"
                elif p_low in ("ok.ru", "odnoklassniki") or "ok.ru" in u_low:
                    display_name = "OK.ru"
                elif p_low == "filemoon" or "bysesukior" in u_low or "filemoon" in u_low:
                    display_name = "Filemoon"
                elif p_low == "streamwish" or "ghbrisk" in u_low or "streamwish" in u_low:
                    display_name = "Streamwish"
                elif p_low == "yourupload" or "yourupload" in u_low:
                    display_name = "YourUpload"
                elif p_low == "vidmoly" or "vidmoly" in u_low:
                    display_name = "Vidmoly"
                elif p_low == "dailymotion" or "dailymotion" in u_low:
                    display_name = "Dailymotion"
                elif p_low == "mp4upload" or "mp4upload" in u_low:
                    display_name = "Mp4Upload"
                elif p_low == "mega" or "mega.nz" in u_low:
                    display_name = "Mega"
                elif clean_name and clean_name.lower() not in ("kaynak", "other", "default", "varsayılan", "vip", "vi̇p"):
                    display_name = clean_name
                else:
                    display_name = provider.upper() if provider and provider != "other" else "Kaynak"

                is_hq = is_native or p_low in ("asyawatch", "dizilla") or "pichive" in u_low or "dplayer" in u_low
                processed.append({
                    "source_name": display_name,
                    "embed_id": embed_id,
                    "direct_url": direct_url,
                    "provider": provider or "other",
                    "site": site or "webdrama",
                    "fansub": None,
                    "stream_type": stype,
                    "quality_label": "1080p" if is_hq else "HD Embed",
                    "_prio": prio
                })

            processed.sort(key=lambda x: x["_prio"])

            # YouTube rule: If there is at least 1 playable non-youtube source, filter out (hide) youtube!
            # If YouTube is the ONLY source for this episode, keep it so user can click "YouTube'da Aç".
            non_yt = [
                s for s in processed
                if (s.get("provider") or "").lower() != "youtube"
                and "youtube.com" not in (s.get("direct_url") or "").lower()
                and "youtu.be" not in (s.get("direct_url") or "").lower()
            ]
            if non_yt:
                processed = non_yt

            processed = processed[:18]

            # Apply clean numbering per base name (e.g. "Tau Video", "Tau Video 2")
            for item in processed:
                item["source_name"] = re.sub(r'\s+\d+$', '', item["source_name"]).strip()

            counts = {}
            for item in processed:
                counts[item["source_name"]] = counts.get(item["source_name"], 0) + 1
            seen_counts = {}
            for item in processed:
                item.pop("_prio", None)
                base = item["source_name"]
                seen_counts[base] = seen_counts.get(base, 0) + 1
                if counts[base] > 1 and seen_counts[base] > 1:
                    item["source_name"] = f"{base} {seen_counts[base]}"

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
