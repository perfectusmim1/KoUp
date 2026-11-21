#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/purge_dead_sources_full.py

Full-scale asynchronous dead video source verifier & purger for webdrama_archive.db.
- Strict three-way classification: alive / dead / unknown (ONLY confirmed dead rows are deleted).
- Preserves ALL live working providers & custom schemes:
  * dramavadisi:, dramabox:, wdt:, pilavyer: (custom schemes)
  * tau-video.xyz/embed/... (200 OK)
  * vz-*.b-cdn.net/.../playlist.m3u8 (200 OK w/ Referer: https://shortizle.com/)
  * shortizle.com/media/... & /embed/... & /hk/...
  * www.hdfilmcehennemi.nl/rplayer/... (200 OK via TLS chrome)
  * hdfilmcehennemi.mobi/video/embed/... (CF WAF 403 -> treated as unknown, never blindly purged)
- Targets genuinely dead/404/deleted/expired-token/XFO-DENY sources across:
  upns (incl. dplayer82.site), rapidrame_hls2 (expired ?t= tokens), uqload, vidmoly,
  mp4upload, vk.com, filemoon, mail.ru (non-embed or 404/empty meta), ok.ru (deleted/404),
  tau_ephemeral (*.cfd/*.asia mp4), dtpasn_dup & playerdkorea.xyz ('security error' / duplicated hash),
  and malformed / ROUTE_DEAD_DOMAINS / CONFIRMED_XFO_NO_RESOLVER_HOSTS.
- Concurrent worker pools with per-host semaphores, --resume checkpointing, JSONL backup,
  live progress output, and exact deletion counts per provider.
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
from datetime import datetime
from urllib.parse import urlparse

import aiohttp

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

COMMON_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

SAFE_CUSTOM_SCHEMES = ("dramavadisi:", "dramabox:", "wdt:", "pilavyer:")

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
    "sendvid.com",
    "drive.google.com",
    "docs.google.com",
    "4meplayer",
    "uns.bio",
    "p2pplay",
    "rpmplay",
    "rpmvid.com",
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
    "streammango.com",
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
    "pixeldrain.com",
)

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


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _resolve_db_path(cli_db: str | None) -> str:
    if cli_db:
        return cli_db
    return os.environ.get("ARCHIVE_DB_PATH") or os.path.join(_ROOT, "webdrama_archive.db")


def is_malformed_url(raw_url: str) -> tuple[bool, str]:
    u = (raw_url or "").strip()
    if not u:
        return True, "empty_url"
    if any(u.lower().startswith(s) for s in SAFE_CUSTOM_SCHEMES):
        return False, ""
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

    if " " in u and ("vidmoly" in host or "mail.ru" in host):
        return True, "unencoded_filename_in_embed_url"

    return False, ""


def classify_target_group(row: tuple, dup_dtpasn_keys: set[tuple[int, str]] | None = None) -> str | None:
    """
    Assigns each row in episode_sources to a target verification group, or None to keep untouched.
    row = (id, episode_id, drama_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site)
    """
    _, _, did, sname, _, aurl, durl, prov, _, _ = row
    p = (prov or "").strip().lower()
    u = (durl or "").strip()
    ulow = u.lower()
    slow = (sname or "").strip().lower()
    alow = (aurl or "").strip().lower()

    # Preserve safe custom schemes & known live CDN/embed hosts
    if any(ulow.startswith(s) for s in SAFE_CUSTOM_SCHEMES):
        return None
    if "b-cdn.net" in ulow or "shortizle.com" in ulow or "tau-video.xyz" in ulow or "hdfilmcehennemi.nl/rplayer/" in ulow:
        return None

    # 1. UPNS & dplayer82.site
    if "upns" in p or "upns" in ulow or "dplayer82.site" in ulow:
        return "upns"

    # 2. Rapidrame expired signed /hls2/ tokens (NOT /rplayer/)
    if "/hls2/" in ulow and "rapidrame.com" in ulow:
        return "rapidrame_hls2"

    # 3. dtpasn.asia & playerdkorea.xyz
    if "playerdkorea.xyz" in ulow:
        return "playerdkorea"
    if "dtpasn.asia" in ulow:
        if dup_dtpasn_keys and did is not None and (int(did), u) in dup_dtpasn_keys:
            return "dtpasn_dup"
        return "dtpasn"

    # 4. Ephemeral tau-video CDN MP4s (*.cfd/*.asia)
    if (p == "tau-video" or "tau-video" in ulow) and "tau-video.xyz" not in ulow:
        return "tau_ephemeral"

    # 5. MP4Upload
    if p == "mp4upload" or "mp4upload" in ulow:
        return "mp4upload"

    # 6. Uqload
    if p == "uqload" or "uqload" in ulow:
        return "uqload"

    # 7. Vidmoly
    if "vidmoly" in p or "vidmoly" in ulow or "vidmoly" in slow or "vidmoly" in alow:
        if "filemoon" not in ulow and "dailymotion" not in ulow and "molystream" not in ulow:
            return "vidmoly"

    # 8. Filemoon (excluding molystream/anizm proxies)
    if ("filemoon" in p or "filemoon." in ulow or "bysedikamoum.com" in ulow) and "molystream" not in ulow:
        return "filemoon"

    # 9. VK.com
    if p == "vk" or "vk.com" in ulow:
        return "vk.com"

    # 10. Mail.ru
    if "mail.ru" in ulow or p in ("mail.ru", "mailru"):
        return "mail.ru"

    # 11. OK.ru (direct ok.ru/odnoklassniki.ru only, skip anizm CF wrapper)
    if ("ok.ru" in ulow or "odnoklassniki.ru" in ulow) and "anizm.net" not in ulow:
        return "ok.ru"

    # 12. Broken/malformed, dead domains, or XFO-DENY
    malformed, _ = is_malformed_url(u)
    if malformed:
        return "broken_or_deny"

    if p in ("sibnet", "sendvid", "pixeldrain") or any(dd in ulow for dd in ROUTE_DEAD_DOMAINS):
        return "broken_or_deny"

    cu = ("https:" + u) if u.startswith("//") else u
    host = urlparse(cu).netloc.lower()
    if host in CONFIRMED_XFO_NO_RESOLVER_HOSTS:
        return "broken_or_deny"
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
    headers = {"User-Agent": COMMON_UA, "Referer": "https://www.mp4upload.com/"}
    for attempt in range(2):
        async with sem:
            try:
                async with session.get(embed_url, headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                    st = resp.status
                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        if attempt == 0:
                            await asyncio.sleep(0.5)
                            continue
                        return "unknown", f"http_{st}"
                    blow = (await resp.text(errors="ignore")).lower()
                    if "just a moment..." in blow or "cf-browser-verification" in blow:
                        return "unknown", "cloudflare_challenge"
                    if any(k in blow for k in ("file was deleted", "file not found", "document.fl.login", "file is no longer available", "video not found", "no video found")):
                        return "dead", "explicit_deleted_marker"
                    if "player.src" in blow or ".mp4" in blow or "rapids" in blow:
                        return "alive", "mp4_stream_present"
                    return "unknown", f"unrecognized_len_{len(blow)}"
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
    fetch_url = re.sub(r"//(?:www\.)?uqload\.(?:com|io|co|is|org)/", "//uqload.vc/", u, flags=re.I)
    headers = {"User-Agent": COMMON_UA, "Referer": "https://uqload.vc/"}
    for attempt in range(2):
        async with sem:
            try:
                async with session.get(fetch_url, headers=headers, timeout=aiohttp.ClientTimeout(total=12, connect=6), allow_redirects=True) as resp:
                    st = resp.status
                    if st in (404, 410):
                        return "dead", f"http_{st}"
                    if st in (403, 429) or st >= 500:
                        if attempt == 0:
                            await asyncio.sleep(0.6)
                            continue
                        return "unknown", f"http_{st}"
                    blow = (await resp.text(errors="ignore")).lower()
                    if "just a moment..." in blow or "cf-browser-verification" in blow:
                        return "unknown", "cloudflare_challenge"
                    if any(k in blow for k in ("file was deleted", "file is no longer available", "file was locked", "video not found")):
                        return "dead", "explicit_deleted_marker"
                    if "vplayer" in blow or "jwplayer" in blow or "eval(function" in blow or "sources:" in blow:
                        return "alive", "player_present"
                    return "unknown", f"unrecognized_len_{len(blow)}"
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
    if "vidmoly.me" in u.lower():
        return "dead", "route_dead_domain:vidmoly.me"
    if "vidmoly" not in u.lower():
        return "alive", "non_vidmoly_host_kept"
    mirrors = ["vidmoly.biz", "vidmoly.org"]
    saw_404_status = None
    for attempt in range(2):
        mirror = mirrors[(idx + attempt) % len(mirrors)]
        fetch_url = re.sub(r"//(?:www\.)?vidmoly\.(?:biz|org|net|to)/", f"//{mirror}/", u, flags=re.I)
        headers = {"User-Agent": COMMON_UA, "Referer": f"https://{mirror}/"}
        if attempt > 0:
            await asyncio.sleep(0.5)
        async with sem:
            await asyncio.sleep(0.05)
            try:
                async with session.get(fetch_url, headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                    st = resp.status
                    body = await resp.text(errors="ignore")
                    blow = body.lower()
                    if st in (404, 410):
                        saw_404_status = st
                        continue
                    if st in (403, 429) or st >= 500:
                        continue
                    if st == 200 and any(
                        k in blow
                        for k in (
                            "no video found", "this video not found", "file was deleted",
                            "video not found", "file not found", "deleted by owner",
                            "404 not found", '{"status":"error"}',
                        )
                    ):
                        return "dead", "explicit_deleted_marker"
                    if "sources:" in blow or ".m3u8" in blow or "jwplayer" in blow or "eval(function" in blow:
                        return "alive", "hls_stream_present"
                    return "unknown", f"unrecognized_len_{len(body)}"
            except Exception as e:
                if attempt == 1 and saw_404_status is None:
                    return "unknown", f"err_{type(e).__name__}"
    if saw_404_status is not None:
        return "unknown", f"vidmoly_http_{saw_404_status}_unconfirmed"
    return "unknown", "http_503_or_rate_limited"


async def probe_filemoon(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"
    headers = {"User-Agent": COMMON_UA, "Referer": "https://filemoon.sx/"}
    async with sem:
        try:
            async with session.get(url.strip(), headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                if resp.status in (404, 410):
                    return "dead", f"http_{resp.status}"
                if resp.status in (403, 429) or resp.status >= 500:
                    return "unknown", f"http_{resp.status}"
                blow = (await resp.text(errors="ignore")).lower()
                if any(k in blow for k in ("file was deleted", "file is no longer available", "file not found", "page not found", "video was deleted")):
                    return "dead", "explicit_deleted_marker"
                if "embed" in blow or "jwplayer" in blow or "eval(" in blow or "iframe" in blow:
                    return "alive", "filemoon_embed_ok"
                return "unknown", f"unrecognized_len_{len(blow)}"
        except Exception as e:
            return "unknown", f"err_{type(e).__name__}"


async def probe_mailru(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"
    u = url.strip()
    cu = ("https:" + u) if u.startswith("//") else u
    if "/embed/" not in cu.lower():
        return "dead", "mailru_non_embed_xfo_deny"
    headers = {"User-Agent": COMMON_UA, "Referer": "https://my.mail.ru/"}
    for attempt in range(2):
        if attempt > 0:
            await asyncio.sleep(0.5)
        async with sem:
            try:
                async with session.get(cu, headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                    if resp.status in (404, 410):
                        if attempt == 0:
                            continue
                        return "dead", f"http_{resp.status}"
                    if resp.status != 200:
                        return "unknown", f"http_{resp.status}"
                    body = await resp.text(errors="ignore")
                    blow = body.lower()
                    if "video not found" in blow or "видео не найдено" in blow or "видео удалено" in blow:
                        return "dead", "mailru_deleted_marker"
                    m = re.search(r'metadataUrl"\s*:\s*"([^"]+)"', body)
                    if not m:
                        if "flashvars" in blow:
                            return "alive", "mailru_flashvars_present"
                        return "unknown", "mailru_no_metadata_url_or_challenge"
                    mu = m.group(1)
                    if mu.startswith("//"):
                        mu = "https:" + mu
                    elif mu.startswith("/"):
                        mu = "https://my.mail.ru" + mu
                    async with session.get(mu, headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as mr:
                        if mr.status in (404, 410):
                            return "dead", f"mailru_meta_{mr.status}"
                        if mr.status == 200:
                            data = await mr.json(content_type=None)
                            vids = data.get("videos") if isinstance(data, dict) else None
                            if isinstance(vids, list) and len(vids) > 0:
                                return "alive", "mailru_videos_ok"
                            return "dead", "mailru_empty_videos"
                        return "unknown", f"mailru_meta_{mr.status}"
            except Exception as e:
                return "unknown", f"err_{type(e).__name__}"
    return "unknown", "max_retries"


async def probe_okru(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"
    headers = {"User-Agent": COMMON_UA, "Referer": "https://ok.ru/"}
    for attempt in range(2):
        if attempt > 0:
            await asyncio.sleep(0.5)
        async with sem:
            try:
                async with session.get(url.strip(), headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                    if resp.status in (404, 410):
                        if attempt == 0:
                            continue
                        return "dead", f"http_{resp.status}"
                    if resp.status in (403, 429) or resp.status >= 500:
                        return "unknown", f"http_{resp.status}"
                    body = await resp.text(errors="ignore")
                    blow = body.lower()
                    if any(k in blow for k in ("video has been blocked", "video has not been found", "this video has been deleted", "copyrighted", "видео недоступно", "видео удалено")):
                        return "dead", "okru_deleted_marker"
                    if "data-options" in blow or "flashvars" in blow:
                        return "alive", "okru_metadata_ok"
                    return "unknown", f"unrecognized_len_{len(body)}"
            except Exception as e:
                return "unknown", f"err_{type(e).__name__}"
    return "unknown", "max_retries"


async def probe_vk(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"
    u = url.strip()
    if "vk.com" not in u.lower():
        return "alive", "non_vk_host_kept"
    headers = {"User-Agent": COMMON_UA, "Referer": "https://vk.com/", "Accept-Language": "en-US,en;q=0.9,tr;q=0.8"}
    for attempt in range(3):
        async with sem:
            await asyncio.sleep(0.35 if attempt == 0 else 1.0 * attempt)
            try:
                async with session.get(u, headers=headers, timeout=aiohttp.ClientTimeout(total=10, connect=5), allow_redirects=True) as resp:
                    if resp.status in (404, 410):
                        return "dead", f"http_{resp.status}"
                    if resp.status in (403, 429) or resp.status >= 500:
                        continue
                    body = await resp.text(errors="ignore")
                    unesc = body.replace("\\/", "/")
                    if VK_ERR_DIV_RE.search(body) or any(
                        m in body
                        for m in ("This video has been removed", "Video not found", "Видеозапись удалена", "Видео недоступно", "Video dosyası bulunamadı")
                    ):
                        return "dead", "explicit_vk_video_ext_msg_error"
                    if VK_MEDIA_RE.search(unesc):
                        return "alive", "vk_media_url_present"
                    continue
            except Exception as e:
                if attempt == 2:
                    return "unknown", f"err_{type(e).__name__}"
    return "unknown", "vk_challenge_or_unknown"


async def probe_upns_or_rapidrame_hls2(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str, group: str) -> tuple[str, str]:
    headers = {"User-Agent": COMMON_UA}
    if group == "rapidrame_hls2":
        headers["Referer"] = "https://www.hdfilmcehennemi.nl/"
    async with sem:
        try:
            async with session.get(url.strip(), headers=headers, timeout=aiohttp.ClientTimeout(total=8, connect=4), allow_redirects=True) as resp:
                body = await resp.text(errors="ignore")
                if resp.status in (404, 410):
                    return "dead", f"{group}_http_{resp.status}"
                if group == "rapidrame_hls2" and resp.status == 403 and len(body) < 512:
                    return "dead", "rapidrame_expired_token_403"
                if resp.status == 200 and "#extm3u" in body.lower():
                    return "alive", "hls_ok"
                if group == "upns" and ("not found" in body.lower() or len(body) == 0):
                    return "dead", f"upns_empty_or_404_{resp.status}"
                return "unknown", f"http_{resp.status}"
        except Exception as e:
            return "unknown", f"err_{type(e).__name__}"


async def probe_dtpasn_or_playerdkorea(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str, group: str) -> tuple[str, str]:
    if group == "dtpasn_dup":
        return "dead", "identical_dtpasn_hash_across_episodes"
    parsed = urlparse(url.strip())
    host = parsed.netloc.lower()
    vid = parsed.path.rstrip("/").split("/")[-1]
    if not vid:
        return "dead", "missing_video_id"
    api_url = f"https://{host}/player/index.php?data={vid}&do=getVideo"
    headers = {"User-Agent": COMMON_UA, "Referer": url.strip(), "Origin": f"https://{host}", "X-Requested-With": "XMLHttpRequest"}
    async with sem:
        try:
            async with session.post(api_url, headers=headers, timeout=aiohttp.ClientTimeout(total=8, connect=4)) as resp:
                if resp.status in (404, 410):
                    return "dead", f"http_{resp.status}"
                if resp.status != 200:
                    return "unknown", f"http_{resp.status}"
                data = await resp.json(content_type=None)
                sec = data.get("securedLink") if isinstance(data, dict) else None
                if not sec:
                    return "dead", "no_secured_link"
                async with session.get(sec, headers={"User-Agent": COMMON_UA, "Referer": f"https://{host}/", "Origin": f"https://{host}"}, timeout=aiohttp.ClientTimeout(total=6, connect=4)) as r2:
                    txt = await r2.text(errors="ignore")
                    if "security error" in txt.lower():
                        return "dead", "security_error_html"
                    if "#extm3u" in txt.lower():
                        return "alive", "hls_ok"
                    return "dead", f"invalid_master_http_{r2.status}"
        except asyncio.TimeoutError:
            return "dead", "cdn_timeout"
        except Exception as e:
            return "unknown", f"err_{type(e).__name__}"


async def probe_tau_ephemeral(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> tuple[str, str]:
    async with sem:
        try:
            async with session.head(url.strip(), headers={"User-Agent": COMMON_UA, "Referer": "https://tau-video.xyz/"}, timeout=aiohttp.ClientTimeout(total=6, connect=3), allow_redirects=True) as resp:
                if resp.status in (404, 410):
                    return "dead", f"http_{resp.status}"
                if resp.status in (200, 206):
                    return "alive", "mp4_ok"
                return "unknown", f"http_{resp.status}"
        except (asyncio.TimeoutError, aiohttp.ClientConnectorError):
            return "dead", "ephemeral_cdn_unreachable"
        except Exception as e:
            return "unknown", f"err_{type(e).__name__}"


async def probe_broken_or_deny(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str, provider: str = "") -> tuple[str, str]:
    mal, reason = is_malformed_url(url)
    if mal:
        return "dead", f"malformed:{reason}"
    u = url.strip()
    ulow = u.lower()
    p = (provider or "").strip().lower()
    if p in ("sibnet", "sendvid", "pixeldrain") or any(dd in ulow for dd in ROUTE_DEAD_DOMAINS):
        return "dead", "route_dead_domain"
    cu = ("https:" + u) if u.startswith("//") else u
    host = urlparse(cu).netloc.lower()
    if host in CONFIRMED_XFO_NO_RESOLVER_HOSTS:
        return "dead", f"xfo_deny_no_resolver:{host}"
    if host == "dai.ly" or ("dailymotion.com" in host and "/video/" in ulow and "/embed/" not in ulow):
        m = re.search(r"(?:/video/|dai\.ly/)([a-zA-Z0-9]+)", u)
        if not m:
            return "dead", "dailymotion_invalid_watch_url"
        async with sem:
            try:
                async with session.get(f"https://www.dailymotion.com/player/metadata/video/{m.group(1)}", headers={"User-Agent": COMMON_UA, "Referer": "https://www.dailymotion.com/"}, timeout=aiohttp.ClientTimeout(total=8)) as resp:
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


def load_checkpoint(ckpt_file: str) -> dict[str, tuple[str, str]]:
    cache: dict[str, tuple[str, str]] = {}
    if not os.path.exists(ckpt_file):
        return cache
    try:
        with open(ckpt_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                u, st, reason = obj.get("url"), obj.get("status"), obj.get("reason", "")
                if u is not None and st in ("alive", "dead"):
                    cache[u] = (st, reason)
    except Exception as e:
        print(f"[WARN] Checkpoint okuma uyarısı: {e}")
    return cache


async def run_pipeline(args):
    scratch_dir = args.scratch_dir or os.path.join(_ROOT, "scratch", "purge")
    os.makedirs(scratch_dir, exist_ok=True)
    ckpt_file = os.path.join(scratch_dir, "url_checkpoint.jsonl")
    backup_file = os.path.join(scratch_dir, "deleted_sources_backup.jsonl")
    affected_file = os.path.join(scratch_dir, "affected_drama_ids.json")
    summary_file = os.path.join(scratch_dir, "purge_summary.json")

    db_path = _resolve_db_path(args.db)
    conn = sqlite3.connect(db_path, timeout=120.0)
    conn.execute("PRAGMA busy_timeout = 120000;")
    cur = conn.cursor()

    total_before = cur.execute("SELECT COUNT(*) FROM episode_sources").fetchone()[0]
    pending_before = cur.execute("SELECT COUNT(*) FROM episodes WHERE source_status = 'pending'").fetchone()[0]

    # Precompute dtpasn.asia URLs shared across >= 3 episodes of the same drama
    dup_dtpasn_keys = {
        (int(r[0]), r[1])
        for r in cur.execute(
            """
            SELECT e.drama_id, es.direct_url
            FROM episode_sources es
            JOIN episodes e ON e.id = es.episode_id
            WHERE es.direct_url LIKE '%dtpasn.asia%'
            GROUP BY e.drama_id, es.direct_url
            HAVING COUNT(DISTINCT e.id) >= 3
            """
        ).fetchall()
    }

    print("=" * 72)
    print(f"=== KOUP GLOBAL DEAD VIDEO SOURCE PURGE ({db_path}) ===")
    print(f"Toplam başlangıç episode_sources: {total_before:,} | pending: {pending_before:,}")
    mode_str = (
        f"CALIBRATION SAMPLE (--sample {args.sample})"
        if args.sample > 0
        else ("APPLY (CANLI SİLME AKTİF)" if (args.apply and not args.dry_run) else "DRY-RUN (SİLME YOK)")
    )
    print(f"Çalışma Modu: {mode_str} | Shared dtpasn.asia grupları: {len(dup_dtpasn_keys)}")
    print("=" * 72)

    all_rows = cur.execute(
        """
        SELECT s.id, s.episode_id, e.drama_id, s.source_name, s.embed_id,
               s.ajax_embed_url, s.direct_url, s.provider, s.fansub, s.site
        FROM episode_sources s
        LEFT JOIN episodes e ON e.id = s.episode_id
        ORDER BY s.id ASC
        """
    ).fetchall()
    conn.close()

    allowed_groups = (
        {x.strip() for x in args.providers.split(",") if x.strip()}
        if args.providers
        else None
    )

    rows_by_group: dict[str, list[tuple]] = defaultdict(list)
    for r in all_rows:
        g = classify_target_group(r, dup_dtpasn_keys)
        if g and (allowed_groups is None or g in allowed_groups):
            rows_by_group[g].append(r)

    group_order = [
        "upns",
        "rapidrame_hls2",
        "playerdkorea",
        "dtpasn_dup",
        "dtpasn",
        "tau_ephemeral",
        "mp4upload",
        "uqload",
        "vidmoly",
        "filemoon",
        "vk.com",
        "mail.ru",
        "ok.ru",
        "broken_or_deny",
    ]
    print("\n[HEDEF KATEGORİ DAĞILIMI]")
    for g in group_order:
        rlist = rows_by_group.get(g, [])
        if not rlist:
            continue
        u_set = {(x[6] or "").strip() for x in rlist}
        print(f"  • {g:16s}: {len(rlist):7,d} kayıt ({len(u_set):7,d} tekil URL)")

    if args.sample > 0:
        for g in group_order:
            if len(rows_by_group[g]) > args.sample:
                step = max(1, len(rows_by_group[g]) // args.sample)
                rows_by_group[g] = [rows_by_group[g][i] for i in range(0, len(rows_by_group[g]), step)][: args.sample]

    url_results: dict[str, tuple[str, str]] = {}
    use_resume = args.resume and not args.reset_checkpoint and args.sample == 0
    if use_resume:
        url_results = load_checkpoint(ckpt_file)
        if url_results:
            print(f"[RESUME] Checkpoint'ten {len(url_results):,} doğrulanmış URL yüklendi.")

    to_probe: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for g in group_order:
        seen_u = set()
        for r in rows_by_group[g]:
            u = (r[6] or "").strip()
            p = (r[7] or "").strip().lower()
            if g == "dtpasn_dup":
                url_results[u] = ("dead", "identical_dtpasn_hash_across_episodes")
                continue
            if u not in seen_u and u not in url_results:
                seen_u.add(u)
                to_probe[g].append((u, p))

    total_to_probe = sum(len(v) for v in to_probe.values())
    print(f"\n[AĞ TARAMASI] Doğrulanacak yeni tekil URL sayısı: {total_to_probe:,}")

    ckpt_lock = asyncio.Lock()
    ckpt_buffer: list[str] = []
    ckpt_fp = open(ckpt_file, "a", encoding="utf-8") if args.sample == 0 else None

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
        sems = {
            "mp4upload": asyncio.Semaphore(args.mp4_concurrency),
            "uqload": asyncio.Semaphore(args.uqload_concurrency),
            "vidmoly": asyncio.Semaphore(args.vidmoly_concurrency),
            "filemoon": asyncio.Semaphore(args.filemoon_concurrency),
            "mail.ru": asyncio.Semaphore(args.mailru_concurrency),
            "ok.ru": asyncio.Semaphore(args.okru_concurrency),
            "vk.com": asyncio.Semaphore(2),
            "default": asyncio.Semaphore(12),
        }

        connector = aiohttp.TCPConnector(limit=120, limit_per_host=48, ssl=False, ttl_dns_cache=600)
        async with aiohttp.ClientSession(connector=connector) as session:
            progress = Counter()

            async def run_group(g: str, items: list[tuple[str, str]]):
                if not items:
                    return
                g_total = len(items)
                sem = sems.get(g, sems["default"])

                async def worker(idx: int, u: str, p: str):
                    if g == "mp4upload":
                        st, rsn = await probe_mp4upload(session, sem, u)
                    elif g == "uqload":
                        st, rsn = await probe_uqload(session, sem, u)
                    elif g == "vidmoly":
                        st, rsn = await probe_vidmoly(session, sem, u, idx)
                    elif g == "filemoon":
                        st, rsn = await probe_filemoon(session, sem, u)
                    elif g == "mail.ru":
                        st, rsn = await probe_mailru(session, sem, u)
                    elif g == "ok.ru":
                        st, rsn = await probe_okru(session, sem, u)
                    elif g == "vk.com":
                        st, rsn = await probe_vk(session, sem, u)
                    elif g in ("upns", "rapidrame_hls2"):
                        st, rsn = await probe_upns_or_rapidrame_hls2(session, sem, u, g)
                    elif g in ("playerdkorea", "dtpasn", "dtpasn_dup"):
                        st, rsn = await probe_dtpasn_or_playerdkorea(session, sem, u, g)
                    elif g == "tau_ephemeral":
                        st, rsn = await probe_tau_ephemeral(session, sem, u)
                    else:
                        st, rsn = await probe_broken_or_deny(session, sem, u, p)

                    await record_result(g, u, st, rsn)
                    progress[g] += 1
                    done = progress[g]
                    step_log = max(1, min(2000, g_total // 10 or 1))
                    if done % step_log == 0 or done == g_total:
                        print(f"[{_ts()}] [{done:,}/{g_total:,}] ({done/g_total*100:.1f}%) - {g}", flush=True)

                chunk_sz = 1000
                for i in range(0, g_total, chunk_sz):
                    await asyncio.gather(*(worker(i + j, u, p) for j, (u, p) in enumerate(items[i : i + chunk_sz])))

            await asyncio.gather(*(run_group(g, to_probe[g]) for g in group_order if to_probe[g]))

        if ckpt_fp is not None:
            if ckpt_buffer:
                ckpt_fp.write("\n".join(ckpt_buffer) + "\n")
                ckpt_fp.flush()
            ckpt_fp.close()

        print(f"\n[AĞ TARAMASI TAMAMLANDI] Toplam süre: {time.time() - t_start:.1f}s")

    breakdown: dict[str, dict] = {}
    reasons_by_group: dict[str, Counter] = defaultdict(Counter)
    dead_rows: list[tuple] = []
    affected_dramas: set[int] = set()
    affected_episodes: set[int] = set()

    print("\n" + "=" * 72)
    print("=== SAĞLAYICI BAZLI ALIVE / DEAD / UNKNOWN RAPORU ===")
    print("=" * 72)

    active_live_guards = {"vidmoly", "mail.ru", "ok.ru", "uqload", "mp4upload", "filemoon", "vk.com"}
    for g in group_order:
        if not rows_by_group.get(g):
            continue
        c = Counter()
        group_dead: list[tuple] = []
        group_dramas: set[int] = set()
        group_episodes: set[int] = set()
        for r in rows_by_group[g]:
            sid, eid, did, *_ = r
            u = (r[6] or "").strip()
            st, rsn = url_results.get(u, ("unknown", "not_probed"))
            c[st] += 1
            reasons_by_group[g][f"{st}:{rsn}"] += 1
            if st == "dead":
                group_dead.append((*r, g, rsn))
                if did is not None:
                    group_dramas.add(int(did))
                if eid is not None:
                    group_episodes.add(int(eid))

        tot_g = len(rows_by_group[g])
        breakdown[g] = {"total": tot_g, "alive": c["alive"], "dead": c["dead"], "unknown": c["unknown"], "reasons": dict(reasons_by_group[g])}
        print(f"  • {g:16s} | Toplam: {tot_g:7,d} | ALIVE: {c['alive']:7,d} | DEAD: {c['dead']:7,d} | UNKNOWN: {c['unknown']:7,d}")
        if g in active_live_guards and tot_g >= 200 and (c["dead"] / tot_g) > 0.50:
            print(f"[SAFETY_GUARD] {g}: {c['dead']:,}/{tot_g:,} ({c['dead']/tot_g*100:.1f}%) DEAD oranı %50 sınırını aştı -> toplu silme engellendi!")
            breakdown[g]["safety_guard_skipped"] = True
            continue
        dead_rows.extend(group_dead)
        affected_dramas.update(group_dramas)
        affected_episodes.update(group_episodes)

    is_apply = bool(args.apply and not args.dry_run and args.sample == 0)
    if not is_apply:
        print(f"\n[DRY-RUN/SAMPLE] Silme uygulanmadı. Tespit edilen DEAD satır: {len(dead_rows):,}")
        print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': True, 'deadCount': len(dead_rows), 'breakdown': {k: {kk: vv for kk, vv in v.items() if kk != 'reasons'} for k, v in breakdown.items()}}, ensure_ascii=False)}", flush=True)
        return

    if not dead_rows:
        print("\n[BİLGİ] Silinecek doğrulanmış ölü kaynak bulunamadı.")
        return

    with open(backup_file, "a", encoding="utf-8") as bf:
        ts_now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for dr in dead_rows:
            sid, eid, did, sname, embed_id, aurl, durl, prov, fsub, site, grp, rsn = dr
            bf.write(
                json.dumps(
                    {
                        "deleted_at": ts_now, "id": sid, "episode_id": eid, "drama_id": did,
                        "source_name": sname, "embed_id": embed_id, "direct_url": durl,
                        "provider": prov, "target_group": grp, "dead_reason": rsn,
                    },
                    ensure_ascii=False,
                ) + "\n"
            )

    conn = sqlite3.connect(db_path, timeout=120.0)
    conn.execute("PRAGMA busy_timeout = 120000;")
    cur = conn.cursor()

    dead_ids = [dr[0] for dr in dead_rows]
    deleted_count = 0
    for i in range(0, len(dead_ids), 500):
        chunk = dead_ids[i : i + 500]
        ph = ",".join("?" * len(chunk))
        cur.execute(f"DELETE FROM episode_sources WHERE id IN ({ph})", chunk)
        deleted_count += cur.rowcount
        conn.commit()

    ep_list = sorted(affected_episodes)
    dropped_to_zero: list[int] = []
    for i in range(0, len(ep_list), 500):
        chunk = ep_list[i : i + 500]
        ph = ",".join("?" * len(chunk))
        cur.execute(
            f"SELECT e.id FROM episodes e LEFT JOIN episode_sources es ON es.episode_id = e.id "
            f"WHERE e.id IN ({ph}) GROUP BY e.id HAVING COUNT(es.id) = 0",
            chunk,
        )
        dropped_to_zero.extend(r[0] for r in cur.fetchall())

    for i in range(0, len(dropped_to_zero), 500):
        chunk = dropped_to_zero[i : i + 500]
        ph = ",".join("?" * len(chunk))
        cur.execute(
            f"UPDATE episodes SET source_status = 'pending', pending_since = COALESCE(pending_since, CURRENT_TIMESTAMP), "
            f"last_source_check = CURRENT_TIMESTAMP WHERE id IN ({ph})",
            chunk,
        )
        conn.commit()

    drama_list = sorted(affected_dramas)
    for i in range(0, len(drama_list), 500):
        chunk = drama_list[i : i + 500]
        ph = ",".join("?" * len(chunk))
        cur.execute(
            f"""
            UPDATE dramas
            SET sources_count = (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = dramas.id),
                episodes_available = (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = dramas.id AND EXISTS(SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id))
            WHERE id IN ({ph})
            """,
            chunk,
        )
        conn.commit()

    if args.sync_remote and drama_list:
        from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

        for idx, did in enumerate(drama_list, 1):
            try:
                sync_drama_bundle_and_counts(conn, cur, did)
            except Exception as e:
                print(f"[SYNC_ERR] drama #{did}: {e}")
            if idx % 25 == 0 or idx == len(drama_list):
                print(f"[{_ts()}] [{idx}/{len(drama_list)}] ({idx/len(drama_list)*100:.1f}%) - R2/Supabase senkronu", flush=True)

    conn.close()

    with open(affected_file, "w", encoding="utf-8") as f:
        json.dump(drama_list, f, indent=2)

    summary_payload = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_sources_before": total_before,
        "deleted_sources_count": deleted_count,
        "episodes_dropped_to_zero_sources": len(dropped_to_zero),
        "affected_dramas_count": len(drama_list),
        "breakdown_by_provider": breakdown,
    }
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(summary_payload, f, ensure_ascii=False, indent=2)

    print(f"✓ Silinen: {deleted_count:,} | 0 kaynağa düşen bölüm: {len(dropped_to_zero):,} | Etkilenen yapım: {len(drama_list):,}")
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': False, 'deletedCount': deleted_count, 'droppedToZero': len(dropped_to_zero), 'affectedDramas': len(drama_list)}, ensure_ascii=False)}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Full async dead video source purger for webdrama_archive.db")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--scratch-dir", type=str, default=None, help="Directory for checkpoints and backups")
    parser.add_argument("--sample", type=int, default=0, help="Calibration sample size per provider (0 = full dataset)")
    parser.add_argument("--apply", action="store_true", help="Apply deletions to SQLite database")
    parser.add_argument("--dry-run", action="store_true", help="Preview dead sources without deleting")
    parser.add_argument("--resume", action="store_true", default=True, help="Resume from URL checkpoint (default True)")
    parser.add_argument("--reset-checkpoint", action="store_true", help="Ignore existing URL checkpoint file")
    parser.add_argument("--sync-remote", action="store_true", help="Rebuild R2 bundles & Supabase counts for affected dramas")
    parser.add_argument("--providers", type=str, default=None, help="Comma-separated target groups to check")
    parser.add_argument("--mp4-concurrency", type=int, default=40)
    parser.add_argument("--uqload-concurrency", type=int, default=20)
    parser.add_argument("--vidmoly-concurrency", type=int, default=8)
    parser.add_argument("--filemoon-concurrency", type=int, default=20)
    parser.add_argument("--mailru-concurrency", type=int, default=24)
    parser.add_argument("--okru-concurrency", type=int, default=24)
    args = parser.parse_args()
    asyncio.run(run_pipeline(args))
    sys.exit(0)


if __name__ == "__main__":
    main()
