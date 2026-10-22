#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/purge_dead_sources_full.py

Phase 2: Full-scale asynchronous dead video source verifier & purger for webdrama_archive.db.
- Covers target providers: mp4upload, uqload, vidmoly/molystream, vk.com, upns, and broken/XFO-DENY URLs.
- Strict three-way classification: alive / dead / unknown (ONLY confirmed dead sources are ever deleted).
- Per-host concurrency throttling with realistic browser headers & Referer.
- Resumable URL classification checkpoint and full JSONL backup of deleted rows before deletion.
- Short write transactions (chunks of <= 500 IDs, commit each chunk, no VACUUM) safe for concurrent DB writers.
"""

import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from urllib.parse import urlparse

import aiohttp

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection

SCRATCH_DIR = r"C:\Users\Cagan\.gemini\antigravity\brain\f680d6a2-b722-434a-b62d-dcfbf2e65025\scratch\purge"
CHECKPOINT_FILE = os.path.join(SCRATCH_DIR, "url_checkpoint.jsonl")
BACKUP_FILE = os.path.join(SCRATCH_DIR, "deleted_sources_backup.jsonl")
AFFECTED_DRAMAS_FILE = os.path.join(SCRATCH_DIR, "affected_drama_ids.json")
SUMMARY_REPORT_FILE = os.path.join(SCRATCH_DIR, "purge_summary.json")

COMMON_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Dead domains explicitly rejected with 410 in koup-app/src/app/api/resolve-stream/route.ts
ROUTE_DEAD_DOMAINS = (
    "sibnet.ru",
    "video.sibnet.ru",
    "diziasya",
    "video.diziasya.com",
    "short.icu",
    "short.ink",
    "vudeo.io",
    "vudeo.co",
    "vudeo.net",
    "dood.watch",
    "dood.ws",
    "dood.so",
    "doodstream.com",
    "mvidoo.com",
    "savefileway.com",
    "tubeload.co",
    "embedo.co",
    "streamlare.com",
    "optraco.top",
    "abyssplayer.com",
    "uqload.to",
    "sendvid",
    "sendvid.com",
    "drive.google.com",
    "docs.google.com",
    "pixeldrain.com",
    "pixeldrain",
    "4meplayer",
    "uns.bio",
    "p2pplay",
    "rpmplay",
    "parklogic",
    "vtube.to",
    "highload.to",
    "vadshar.com",
    "viidshar.com",
    "segavid.com",
    "upload.do",
    "lylxan.com",
    "embedrise.com",
    "embedgram.com",
    "openload.co",
    "streamango.com",
    "rapidvideo.com",
    "estream.to",
    "vid.me",
    "cloudvideo.tv",
    "wolfstream.tv",
    "mystream.to",
    "vidmoly.me",
    "fembed.com",
    "feurl.com",
    "suzihaza.com",
    "gounlimited.to",
    "jetload.net",
    "supervideo.tv",
    "upstream.to",
    "mixdrop",
)

# Hosts confirmed to return X-Frame-Options: DENY/SAMEORIGIN (or 404/ad) with NO native resolver in route.ts
CONFIRMED_XFO_NO_RESOLVER_HOSTS = {
    "hxfile.co",
    "www.twine.fm",
    "twine.fm",
    "googleads.g.doubleclick.net",
    "cloud.mail.ru",
}

VK_MEDIA_RE = re.compile(
    r'"(?:hls|hls_ondemand|hls_fmp4|hls_live|url240|url360|url480|url720|url1080)"\s*:\s*"https?://',
    re.I,
)
VK_ERR_DIV_RE = re.compile(r'<div[^>]*id=["\']video_ext_msg["\'][^>]*>(.*?)</div>', re.I | re.S)


def is_malformed_url(raw_url: str) -> tuple[bool, str]:
    u = (raw_url or "").strip()
    if not u:
        return True, "empty_url"
    if u.startswith("javascript:") or "void(0)" in u or u.startswith("about:") or u == "#":
        return True, "javascript_or_dummy_url"
    if not (u.startswith("http://") or u.startswith("https://") or u.startswith("//")):
        return True, "invalid_scheme"
    if u.startswith("https://https:") or u.startswith("http://http") or u.startswith("https:///") or u.startswith("https:/v") or u.startswith("https:://"):
        return True, "corrupted_scheme_prefix"
    if u.startswith("https:Dialogue:") or "magnet:?" in u:
        return True, "non_http_payload_in_url"

    cu = ("https:" + u) if u.startswith("//") else u
    try:
        parsed = urlparse(cu)
        host = (parsed.netloc or "").lower()
    except Exception:
        return True, "urlparse_error"

    if not host or "." not in host or ":" in host or host.endswith(".") or host in ("vidmoly.netto", "vidmoly.n3t", "vidmoly.nwet"):
        return True, f"corrupted_host:{host}"

    low = u.lower()
    if low.endswith("/e/") or low.endswith("/embed/video/") or low.endswith("/embed/"):
        return True, "empty_embed_slug"

    # Mail.ru or Vidmoly URLs with raw unencoded release filenames instead of embed IDs
    if " " in u and ("vidmoly" in host or "mail.ru" in host):
        return True, "unencoded_filename_in_embed_url"

    return False, ""


def classify_target_group(row: tuple) -> str | None:
    """
    Assigns each row in episode_sources to one of our target groups, or None if not a target.
    row = (id, episode_id, drama_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site)
    """
    _, _, _, sname, _, aurl, durl, prov, _, _ = row
    p = (prov or "").strip().lower()
    u = (durl or "").strip()
    ulow = u.lower()
    slow = (sname or "").strip().lower()
    alow = (aurl or "").strip().lower()

    # 1. UPNS (69 rows: provider LIKE '%upns%' OR direct_url LIKE '%upns%')
    if "upns" in p or "upns" in ulow:
        return "upns"

    # 2. MP4Upload (~87,409 rows)
    if p == "mp4upload" or "mp4upload" in ulow:
        return "mp4upload"

    # 3. Uqload (~7,665 rows)
    if p == "uqload" or "uqload" in ulow:
        return "uqload"

    # 4. Vidmoly (~5,045 rows)
    if "vidmoly" in p or "vidmoly" in ulow or "vidmoly" in slow or "vidmoly" in alow:
        return "vidmoly"

    # 5. VK.com (~104 rows: 101 vk.com + 1 broken vk + 2 filemoon tagged vk)
    if p == "vk" or "vk.com" in ulow:
        return "vk.com"

    # 6. Broken/empty embed URLs, route.ts deadDomains, or X-Frame-Options: DENY hosts with no native resolver
    malformed, _ = is_malformed_url(u)
    if malformed:
        return "broken_or_deny"

    if p == "sibnet" or any(dd in ulow for dd in ROUTE_DEAD_DOMAINS):
        return "broken_or_deny"

    cu = ("https:" + u) if u.startswith("//") else u
    host = urlparse(cu).netloc.lower()
    if host in CONFIRMED_XFO_NO_RESOLVER_HOSTS:
        return "broken_or_deny"

    # Non-embed my.mail.ru pages (/video/_myvideo/*.html without /embed/) return X-Frame-Options: DENY and lack metadataUrl
    if "mail.ru" in host and "/embed/" not in ulow:
        return "broken_or_deny"

    # Non-embed Dailymotion watch links (dai.ly/* or dailymotion.com/video/* without /embed/) return X-Frame-Options: DENY
    if host == "dai.ly" or ("dailymotion.com" in host and "/video/" in ulow and "/embed/" not in ulow):
        return "broken_or_deny"

    return None


async def probe_mp4upload(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"

    embed_url = url.strip()
    if "/embed-" not in embed_url and "mp4upload.com/" in embed_url:
        m = re.search(r"mp4upload\.com/([a-zA-Z0-9]+)", embed_url)
        if m:
            embed_url = f"https://www.mp4upload.com/embed-{m.group(1)}.html"

    headers = {
        "User-Agent": COMMON_UA,
        "Referer": "https://www.mp4upload.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    for attempt in range(2):
        async with sem:
            try:
                async with session.get(
                    embed_url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10, connect=5),
                    allow_redirects=True,
                ) as resp:
                    st = resp.status
                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        if attempt == 0:
                            await asyncio.sleep(0.5)
                            continue
                        return "unknown", f"http_{st}"

                    body = await resp.text(errors="ignore")
                    blow = body.lower()
                    if "just a moment..." in blow or "cf-browser-verification" in blow:
                        return "unknown", "cloudflare_challenge"

                    if (
                        "file was deleted" in blow
                        or "file not found" in blow
                        or "document.fl.login" in blow
                        or "file is no longer available" in blow
                        or "video not found" in blow
                        or "no video found" in blow
                    ):
                        return "dead", "explicit_deleted_marker"

                    if "player.src" in blow or ".mp4" in blow:
                        return "alive", "mp4_stream_present"

                    return "unknown", f"unrecognized_body_len_{len(body)}"
            except Exception as e:
                if attempt == 0:
                    await asyncio.sleep(0.4)
                    continue
                return "unknown", f"err_{type(e).__name__}"
    return "unknown", "max_retries"


async def probe_uqload(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"

    u = url.strip()
    if "uqload.to" in u.lower():
        return "dead", "route_dead_domain:uqload.to"

    # Normalize mirror domains directly to uqload.vc to avoid 301 redirect overhead
    fetch_url = re.sub(r"//(?:www\.)?uqload\.(?:com|io|co|is|org)/", "//uqload.vc/", u, flags=re.I)
    headers = {
        "User-Agent": COMMON_UA,
        "Referer": "https://uqload.vc/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    for attempt in range(2):
        async with sem:
            try:
                async with session.get(
                    fetch_url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=12, connect=6),
                    allow_redirects=True,
                ) as resp:
                    st = resp.status
                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        if attempt == 0:
                            await asyncio.sleep(0.6)
                            continue
                        return "unknown", f"http_{st}"

                    body = await resp.text(errors="ignore")
                    blow = body.lower()
                    if "just a moment..." in blow or "cf-browser-verification" in blow:
                        return "unknown", "cloudflare_challenge"

                    if (
                        "file was deleted" in blow
                        or "file is no longer available" in blow
                        or "file was locked" in blow
                        or "video not found" in blow
                    ):
                        return "dead", "explicit_deleted_marker"

                    if "vplayer" in blow or "jwplayer" in blow or "eval(function" in blow or "sources:" in blow:
                        return "alive", "player_present"

                    return "unknown", f"unrecognized_body_len_{len(body)}"
            except Exception as e:
                if attempt == 0:
                    await asyncio.sleep(0.5)
                    continue
                return "unknown", f"err_{type(e).__name__}"
    return "unknown", "max_retries"


async def probe_vidmoly(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str, idx: int = 0) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"

    u = url.strip()
    ulow = u.lower()
    if "vidmoly.me" in ulow:
        return "dead", "route_dead_domain:vidmoly.me"

    # Some rows tagged provider='vidmoly' point to filemoon.sx or geo.dailymotion.com or storage.googleapis.com
    if "vidmoly" not in ulow and "molystream" not in ulow:
        return "alive", "non_vidmoly_host_kept"

    mirrors = ["vidmoly.biz", "vidmoly.org"]
    for attempt in range(3):
        mirror = mirrors[(idx + attempt) % len(mirrors)]
        fetch_url = re.sub(
            r"//(?:www\.)?vidmoly\.(?:biz|org|net|to)/",
            f"//{mirror}/",
            u,
            flags=re.I,
        )
        headers = {
            "User-Agent": COMMON_UA,
            "Referer": f"https://{mirror}/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        async with sem:
            await asyncio.sleep(0.06 if attempt == 0 else 0.25 * attempt)
            try:
                async with session.get(
                    fetch_url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10, connect=5),
                    allow_redirects=True,
                ) as resp:
                    st = resp.status
                    body = await resp.text(errors="ignore")
                    blow = body.lower()

                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        continue

                    if (
                        "no video found" in blow
                        or "this video not found" in blow
                        or "file was deleted" in blow
                        or "video not found" in blow
                        or "file not found" in blow
                        or "deleted by owner" in blow
                        or "404 not found" in blow
                        or '{"status":"error"}' in body
                    ):
                        return "dead", "explicit_deleted_marker"

                    if "sources:" in blow or ".m3u8" in blow or "jwplayer" in blow or "eval(function" in blow:
                        return "alive", "hls_stream_present"

                    return "unknown", f"unrecognized_body_len_{len(body)}"
            except Exception as e:
                if attempt == 2:
                    return "unknown", f"err_{type(e).__name__}"
    return "unknown", "http_503_or_rate_limited"


async def probe_vk(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"

    u = url.strip()
    if "vk.com" not in u.lower():
        return "alive", "non_vk_host_kept"

    headers = {
        "User-Agent": COMMON_UA,
        "Referer": "https://vk.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
    }

    for attempt in range(3):
        async with sem:
            await asyncio.sleep(0.35 if attempt == 0 else 1.0 * attempt)
            try:
                async with session.get(
                    u,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10, connect=5),
                    allow_redirects=True,
                ) as resp:
                    st = resp.status
                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        continue

                    body = await resp.text(errors="ignore")
                    unesc = body.replace("\\/", "/")
                    err_match = VK_ERR_DIV_RE.search(body)
                    if err_match or any(
                        m in body
                        for m in (
                            "This video has been removed",
                            "Video not found",
                            "Видеозапись удалена",
                            "Видео недоступно",
                            "Video dosyası bulunamadı",
                            "Video dosyas&#305; bulunamad&#305;",
                            "gizlilik ayarlar&#305;yla gizlenmi&#351;tir",
                        )
                    ):
                        return "dead", "explicit_vk_video_ext_msg_error"

                    if VK_MEDIA_RE.search(unesc):
                        return "alive", "vk_media_url_present"

                    # 22KB anti-bot/challenge page without video_ext_msg or media stream -> retry then unknown
                    continue
            except Exception as e:
                if attempt == 2:
                    return "unknown", f"err_{type(e).__name__}"
    return "unknown", "vk_challenge_or_unknown"


async def probe_broken_or_deny(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str, provider: str = "") -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"

    u = url.strip()
    ulow = u.lower()
    p = (provider or "").strip().lower()

    if p == "sibnet" or any(dd in ulow for dd in ROUTE_DEAD_DOMAINS):
        return "dead", "route_dead_domain"

    cu = ("https:" + u) if u.startswith("//") else u
    host = urlparse(cu).netloc.lower()

    if host in CONFIRMED_XFO_NO_RESOLVER_HOSTS:
        return "dead", f"xfo_deny_no_resolver:{host}"

    if "mail.ru" in host and "/embed/" not in ulow:
        return "dead", "mailru_non_embed_xfo_deny"

    # Dailymotion non-embed watch URLs (dai.ly or dailymotion.com/video/)
    if host == "dai.ly" or ("dailymotion.com" in host and "/video/" in ulow and "/embed/" not in ulow):
        m = re.search(r"(?:/video/|dai\.ly/)([a-zA-Z0-9]+)", u)
        if not m:
            return "dead", "dailymotion_invalid_watch_url"
        dm_id = m.group(1)
        async with sem:
            try:
                async with session.get(
                    f"https://www.dailymotion.com/player/metadata/video/{dm_id}",
                    headers={"User-Agent": COMMON_UA, "Referer": "https://www.dailymotion.com/"},
                    timeout=aiohttp.ClientTimeout(total=8),
                ) as resp:
                    if resp.status in (404, 410):
                        return "dead", f"dailymotion_http_{resp.status}"
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        if isinstance(data, dict) and data.get("error"):
                            return "dead", "dailymotion_metadata_error_and_xfo_deny"
                        if isinstance(data, dict) and data.get("qualities"):
                            return "alive", "dailymotion_resolvable"
                    return "unknown", f"dailymotion_http_{resp.status}"
            except Exception as e:
                return "unknown", f"err_{type(e).__name__}"

    return "unknown", "unclassified"


def load_checkpoint() -> dict[str, tuple[str, str]]:
    """Returns {raw_url_stripped: (status, reason)} for already-verified URLs."""
    cache: dict[str, tuple[str, str]] = {}
    if not os.path.exists(CHECKPOINT_FILE):
        return cache
    try:
        with open(CHECKPOINT_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                u = obj.get("url")
                st = obj.get("status")
                reason = obj.get("reason", "")
                if u is not None and st in ("alive", "dead"):
                    cache[u] = (st, reason)
    except Exception as e:
        print(f"[WARN] Checkpoint okuma uyarısı: {e}")
    return cache


async def run_pipeline(args):
    os.makedirs(SCRATCH_DIR, exist_ok=True)

    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM episode_sources")
    total_before = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM episodes WHERE source_status = 'pending'")
    pending_before = cur.fetchone()[0]

    print("=" * 72)
    print("=== KOUP PHASE 2: FULL DEAD VIDEO SOURCE PURGE ENGINE ===")
    print(f"Toplam başlangıç episode_sources: {total_before:,}")
    print(f"Başlangıç pending bölümler      : {pending_before:,}")
    mode_str = (
        f"CALIBRATION SAMPLE (--sample {args.sample})"
        if args.sample > 0
        else ("APPLY (CANLI SİLME AKTİF)" if args.apply else "DRY-RUN (SİLME YOK)")
    )
    print(f"Çalışma Modu                    : {mode_str}")
    print("=" * 72)

    cur.execute(
        """
        SELECT s.id, s.episode_id, e.drama_id, s.source_name, s.embed_id,
               s.ajax_embed_url, s.direct_url, s.provider, s.fansub, s.site
        FROM episode_sources s
        LEFT JOIN episodes e ON e.id = s.episode_id
        ORDER BY s.id ASC
        """
    )
    all_rows = cur.fetchall()
    conn.close()

    rows_by_group: dict[str, list[tuple]] = defaultdict(list)
    for r in all_rows:
        g = classify_target_group(r)
        if g:
            rows_by_group[g].append(r)

    group_order = ["upns", "mp4upload", "uqload", "vidmoly", "vk.com", "broken_or_deny"]
    print("\n[HEDEF KATEGORİ DAĞILIMI]")
    for g in group_order:
        rlist = rows_by_group.get(g, [])
        u_set = set((x[6] or "").strip() for x in rlist)
        print(f"  • {g:15s}: {len(rlist):7,d} kayıt ({len(u_set):7,d} tekil URL)")

    if args.sample > 0:
        for g in group_order:
            if len(rows_by_group[g]) > args.sample:
                step = max(1, len(rows_by_group[g]) // args.sample)
                rows_by_group[g] = [rows_by_group[g][i] for i in range(0, len(rows_by_group[g]), step)][: args.sample]
        print(f"\n[CALIBRATION] Her grup için en fazla {args.sample} örnek seçildi.")

    # Load checkpoint if not sampling and not --reset-checkpoint
    url_results: dict[str, tuple[str, str]] = {}
    if args.sample == 0 and not args.reset_checkpoint:
        url_results = load_checkpoint()
        if url_results:
            print(f"[CHECKPOINT] Önceki çalışmadan {len(url_results):,} doğrulanmış URL yüklendi.")

    # 1. Instant classification for upns (confirmed blocked X-Frame-Options: DENY / dead)
    for r in rows_by_group["upns"]:
        u = (r[6] or "").strip()
        url_results[u] = ("dead", "upns_confirmed_blocked_xfo_deny")

    # Prepare unique URLs to probe per network group
    to_probe: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for g in ["mp4upload", "uqload", "vidmoly", "vk.com", "broken_or_deny"]:
        seen_u = set()
        for r in rows_by_group[g]:
            u = (r[6] or "").strip()
            p = (r[7] or "").strip().lower()
            if u not in seen_u and u not in url_results:
                seen_u.add(u)
                to_probe[g].append((u, p))

    total_to_probe = sum(len(v) for v in to_probe.values())
    print(f"\n[AĞ TARAMASI] Doğrulanacak yeni tekil URL sayısı: {total_to_probe:,}")

    ckpt_lock = asyncio.Lock()
    ckpt_buffer: list[str] = []
    ckpt_fp = open(CHECKPOINT_FILE, "a", encoding="utf-8") if args.sample == 0 else None

    async def record_result(group: str, url: str, status: str, reason: str):
        url_results[url] = (status, reason)
        if ckpt_fp is not None and status in ("alive", "dead"):
            line = json.dumps({"group": group, "url": url, "status": status, "reason": reason}, ensure_ascii=False)
            async with ckpt_lock:
                ckpt_buffer.append(line)
                if len(ckpt_buffer) >= 500:
                    ckpt_fp.write("\n".join(ckpt_buffer) + "\n")
                    ckpt_fp.flush()
                    ckpt_buffer.clear()

    if total_to_probe > 0:
        t_start = time.time()
        # Independent per-host semaphores so no host is ever overwhelmed
        sem_mp4 = asyncio.Semaphore(args.mp4_concurrency)
        sem_uq = asyncio.Semaphore(args.uqload_concurrency)
        sem_vm = asyncio.Semaphore(args.vidmoly_concurrency)
        sem_vk = asyncio.Semaphore(2)
        sem_misc = asyncio.Semaphore(10)

        connector = aiohttp.TCPConnector(limit=120, limit_per_host=64, ssl=False, ttl_dns_cache=600)
        async with aiohttp.ClientSession(connector=connector) as session:
            progress = Counter()

            async def run_group(g: str, items: list[tuple[str, str]]):
                if not items:
                    return
                g_total = len(items)
                g_start = time.time()

                async def worker(idx: int, u: str, p: str):
                    if g == "mp4upload":
                        st, rsn = await probe_mp4upload(session, sem_mp4, u)
                    elif g == "uqload":
                        st, rsn = await probe_uqload(session, sem_uq, u)
                    elif g == "vidmoly":
                        st, rsn = await probe_vidmoly(session, sem_vm, u, idx)
                    elif g == "vk.com":
                        st, rsn = await probe_vk(session, sem_vk, u)
                    else:
                        st, rsn = await probe_broken_or_deny(session, sem_misc, u, p)

                    await record_result(g, u, st, rsn)
                    progress[g] += 1
                    done = progress[g]
                    step_log = 2500 if g == "mp4upload" else (1000 if g in ("uqload", "vidmoly") else 50)
                    if done % step_log == 0 or done == g_total:
                        el = max(0.001, time.time() - g_start)
                        rate = done / el
                        eta = (g_total - done) / rate if rate > 0 else 0
                        print(
                            f"  [{g:14s}] {done:6,d}/{g_total:6,d} ({done/g_total*100:5.1f}%) | "
                            f"{rate:5.1f} req/s | ETA: {int(eta//60)}m {int(eta%60)}s"
                        )

                # Dispatch in manageable chunks per group to keep event loop responsive
                chunk_sz = 2000 if g == "mp4upload" else 500
                for i in range(0, g_total, chunk_sz):
                    batch = items[i : i + chunk_sz]
                    await asyncio.gather(*(worker(i + j, u, p) for j, (u, p) in enumerate(batch)))

                # Pass 2 retry for any transient 503/unknowns in vidmoly or vk.com
                if g in ("vidmoly", "vk.com"):
                    retry_items = [(u, p) for (u, p) in items if url_results.get(u, ("", ""))[0] == "unknown"]
                    if retry_items:
                        print(f"  [{g:14s}] Pass 2 Retry: {len(retry_items)} belirsiz URL daha yavaş hızla tekrar deneniyor...")
                        sem_slow = asyncio.Semaphore(3 if g == "vidmoly" else 1)
                        for idx2, (u, p) in enumerate(retry_items):
                            if g == "vidmoly":
                                st, rsn = await probe_vidmoly(session, sem_slow, u, idx2 + 1)
                            else:
                                st, rsn = await probe_vk(session, sem_slow, u)
                            await record_result(g, u, st, rsn)

            await asyncio.gather(*(run_group(g, to_probe[g]) for g in ["mp4upload", "uqload", "vidmoly", "vk.com", "broken_or_deny"]))

        if ckpt_fp is not None:
            if ckpt_buffer:
                ckpt_fp.write("\n".join(ckpt_buffer) + "\n")
                ckpt_fp.flush()
                ckpt_buffer.clear()
            ckpt_fp.close()

        print(f"\n[AĞ TARAMASI TAMAMLANDI] Toplam süre: {time.time() - t_start:.1f}s")

    # Aggregate results per group
    breakdown: dict[str, dict[str, int]] = {}
    reasons_by_group: dict[str, Counter] = defaultdict(Counter)
    dead_rows: list[tuple] = []
    affected_dramas: set[int] = set()
    affected_episodes: set[int] = set()

    print("\n" + "=" * 72)
    print("=== SAĞLAYICI BAZLI ALIVE / DEAD / UNKNOWN RAPORU ===")
    print("=" * 72)

    for g in group_order:
        c = Counter()
        for r in rows_by_group[g]:
            sid, eid, did, sname, embed_id, aurl, durl, prov, fsub, site = r
            u = (durl or "").strip()
            st, rsn = url_results.get(u, ("unknown", "not_probed"))
            c[st] += 1
            reasons_by_group[g][f"{st}:{rsn}"] += 1
            if st == "dead":
                dead_rows.append((*r, g, rsn))
                if did is not None:
                    affected_dramas.add(int(did))
                if eid is not None:
                    affected_episodes.add(int(eid))

        tot_g = len(rows_by_group[g])
        breakdown[g] = {
            "total": tot_g,
            "alive": c["alive"],
            "dead": c["dead"],
            "unknown": c["unknown"],
            "reasons": dict(reasons_by_group[g]),
        }
        print(
            f"  • {g:15s} | Toplam: {tot_g:7,d} | "
            f"ALIVE: {c['alive']:7,d} | DEAD: {c['dead']:7,d} | UNKNOWN: {c['unknown']:7,d}"
        )
        for rk, rv in reasons_by_group[g].most_common(5):
            print(f"      - {rk}: {rv:,}")

    total_dead = len(dead_rows)
    total_alive = sum(b["alive"] for b in breakdown.values())
    total_unknown = sum(b["unknown"] for b in breakdown.values())
    print("-" * 72)
    print(
        f"  GENEL TOPLAM      | Taranan: {total_dead + total_alive + total_unknown:7,d} | "
        f"ALIVE: {total_alive:7,d} | DEAD: {total_dead:7,d} | UNKNOWN: {total_unknown:7,d}"
    )
    print(f"  Etkilenen Bölüm   : {len(affected_episodes):,}")
    print(f"  Etkilenen Yapım   : {len(affected_dramas):,}")
    print("=" * 72)

    if args.sample > 0 or not args.apply:
        print("\n[BİLGİ] Silme işlemi uygulanmadı (--apply parametresi verilmedi veya --sample modu).")
        return

    if not dead_rows:
        print("\n[BİLGİ] Silinecek doğrulanmış ölü kaynak bulunamadı.")
        return

    # Step 1: Backup all dead rows to JSONL before deleting
    print(f"\n[YEDEKLEME] Silinecek {len(dead_rows):,} kayıt {BACKUP_FILE} dosyasına yedekleniyor...")
    with open(BACKUP_FILE, "a", encoding="utf-8") as bf:
        ts_now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for dr in dead_rows:
            sid, eid, did, sname, embed_id, aurl, durl, prov, fsub, site, grp, rsn = dr
            rec = {
                "deleted_at": ts_now,
                "id": sid,
                "episode_id": eid,
                "drama_id": did,
                "source_name": sname,
                "embed_id": embed_id,
                "ajax_embed_url": aurl,
                "direct_url": durl,
                "provider": prov,
                "fansub": fsub,
                "site": site,
                "target_group": grp,
                "dead_reason": rsn,
            }
            bf.write(json.dumps(rec, ensure_ascii=False) + "\n")
        bf.flush()
    print("✓ JSONL yedekleme tamamlandı.")

    # Step 2: Delete dead sources in short chunks of <= 500 IDs, committing each chunk
    dead_ids = [dr[0] for dr in dead_rows]
    print(f"\n[SİLME] {len(dead_ids):,} doğrulanmış ölü kaynak <=500'lük parçalar halinde siliniyor...")
    conn = get_connection()
    cur = conn.cursor()

    deleted_count = 0
    for i in range(0, len(dead_ids), 500):
        chunk = dead_ids[i : i + 500]
        placeholders = ",".join("?" * len(chunk))
        for attempt in range(5):
            try:
                cur.execute(f"DELETE FROM episode_sources WHERE id IN ({placeholders})", chunk)
                deleted_count += cur.rowcount
                conn.commit()
                break
            except sqlite3.OperationalError as e:
                if attempt == 4:
                    raise
                time.sleep(0.3 * (attempt + 1))

    print(f"✓ {deleted_count:,} ölü kaynak episode_sources tablosundan silindi.")

    # Step 3: Check affected episodes that dropped to 0 sources -> set source_status = 'pending'
    ep_list = sorted(affected_episodes)
    dropped_to_zero_eps: list[int] = []
    for i in range(0, len(ep_list), 500):
        chunk = ep_list[i : i + 500]
        placeholders = ",".join("?" * len(chunk))
        cur.execute(
            f"""
            SELECT e.id
            FROM episodes e
            LEFT JOIN episode_sources es ON es.episode_id = e.id
            WHERE e.id IN ({placeholders})
            GROUP BY e.id
            HAVING COUNT(es.id) = 0
            """,
            chunk,
        )
        dropped_to_zero_eps.extend(r[0] for r in cur.fetchall())

    newly_pending_count = 0
    for i in range(0, len(dropped_to_zero_eps), 500):
        chunk = dropped_to_zero_eps[i : i + 500]
        placeholders = ",".join("?" * len(chunk))
        for attempt in range(5):
            try:
                cur.execute(
                    f"""
                    UPDATE episodes
                    SET source_status = 'pending',
                        pending_since = COALESCE(pending_since, CURRENT_TIMESTAMP),
                        last_source_check = CURRENT_TIMESTAMP
                    WHERE id IN ({placeholders})
                    """,
                    chunk,
                )
                newly_pending_count += cur.rowcount
                conn.commit()
                break
            except sqlite3.OperationalError:
                if attempt == 4:
                    raise
                time.sleep(0.3 * (attempt + 1))

    print(f"✓ 0 kaynağa düşen {len(dropped_to_zero_eps):,} bölüm 'pending' olarak işaretlendi.")

    # Step 4: Update dramas.sources_count for affected dramas in chunks of <= 500
    drama_list = sorted(affected_dramas)
    for i in range(0, len(drama_list), 500):
        chunk = drama_list[i : i + 500]
        placeholders = ",".join("?" * len(chunk))
        for attempt in range(5):
            try:
                cur.execute(
                    f"""
                    UPDATE dramas
                    SET sources_count = (
                        SELECT COUNT(*)
                        FROM episode_sources es
                        JOIN episodes e ON e.id = es.episode_id
                        WHERE e.drama_id = dramas.id
                    )
                    WHERE id IN ({placeholders})
                    """,
                    chunk,
                )
                conn.commit()
                break
            except sqlite3.OperationalError:
                if attempt == 4:
                    raise
                time.sleep(0.3 * (attempt + 1))

    print(f"✓ {len(drama_list):,} etkilenen yapımın dramas.sources_count değeri güncellendi.")

    cur.execute("SELECT COUNT(*) FROM episode_sources")
    total_after = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM episodes WHERE source_status = 'pending'")
    pending_after = cur.fetchone()[0]
    conn.close()

    # Save affected drama IDs and summary JSON
    existing_affected: set[int] = set()
    if os.path.exists(AFFECTED_DRAMAS_FILE):
        try:
            with open(AFFECTED_DRAMAS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    existing_affected.update(int(x) for x in data)
                elif isinstance(data, dict) and "affected_drama_ids" in data:
                    existing_affected.update(int(x) for x in data["affected_drama_ids"])
        except Exception:
            pass

    merged_affected = sorted(existing_affected | affected_dramas)
    with open(AFFECTED_DRAMAS_FILE, "w", encoding="utf-8") as f:
        json.dump(merged_affected, f, indent=2)

    summary_payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_sources_before": total_before,
        "total_sources_after": total_after,
        "deleted_sources_count": deleted_count,
        "pending_episodes_before": pending_before,
        "pending_episodes_after": pending_after,
        "episodes_dropped_to_zero_sources": len(dropped_to_zero_eps),
        "affected_dramas_count": len(merged_affected),
        "breakdown_by_provider": breakdown,
    }
    with open(SUMMARY_REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(summary_payload, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 72)
    print("=== PURGE TAMAMLANDI - ÖZET METRİKLER ===")
    print(f"  • Önceki Toplam Kaynak          : {total_before:,}")
    print(f"  • Sonraki Toplam Kaynak         : {total_after:,}")
    print(f"  • Silinen Doğrulanmış Ölü Kaynak: {deleted_count:,}")
    print(f"  • 0 Kaynağa Düşen Bölüm Sayısı  : {len(dropped_to_zero_eps):,}")
    print(f"  • Pending Bölüm (Önce -> Sonra) : {pending_before:,} -> {pending_after:,}")
    print(f"  • Etkilenen Yapım (drama_id)    : {len(merged_affected):,} -> {AFFECTED_DRAMAS_FILE}")
    print("=" * 72)


def main():
    parser = argparse.ArgumentParser(description="Full async dead video source purger for webdrama_archive.db")
    parser.add_argument("--sample", type=int, default=0, help="Calibration sample size per provider (0 = full dataset)")
    parser.add_argument("--apply", action="store_true", help="Apply deletions to SQLite database")
    parser.add_argument("--reset-checkpoint", action="store_true", help="Ignore existing URL checkpoint file")
    parser.add_argument("--mp4-concurrency", type=int, default=56, help="Max concurrent requests to mp4upload (default 56)")
    parser.add_argument("--uqload-concurrency", type=int, default=24, help="Max concurrent requests to uqload (default 24)")
    parser.add_argument("--vidmoly-concurrency", type=int, default=8, help="Max concurrent requests to vidmoly (default 8)")
    args = parser.parse_args()
    asyncio.run(run_pipeline(args))


if __name__ == "__main__":
    main()
