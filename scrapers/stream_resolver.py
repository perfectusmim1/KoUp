"""
KoUp Universal Stream Resolver
Resolves video provider embeds (Pilavyer, WDT, Dizipal, SezonlukDizi, RapidVid,
Dramavadisi, Shortizle, Dramabox, Koredizi) directly to raw HLS / MP4 media streams.
Bypasses X-Frame-Options and CSP iframe blocks so streams play natively in NetflixPlayer.
"""

import os
import re
import json
import base64
import hashlib
from typing import Dict, Any, Optional, List

try:
    from curl_cffi import requests as cfr
except ImportError:
    import requests as cfr

COMMON_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _get_session() -> cfr.Session:
    if hasattr(cfr, "Session"):
        try:
            return cfr.Session(impersonate="chrome124")
        except Exception:
            return cfr.Session()
    return cfr.Session()


def decode_rapidvid(enc_str: str) -> Optional[str]:
    """Decodes RapidVid reverse base64 + shift cipher."""
    try:
        rev = enc_str[::-1]
        t = base64.b64decode(rev).decode("latin1")
        k = "K9L"
        o = ""
        for i, char in enumerate(t):
            r = k[i % 3]
            n = ord(char) - ((ord(r) % 5) + 1)
            o += chr(n)
        return base64.b64decode(o).decode("latin1")
    except Exception:
        return None


def decrypt_dizipal(k: str, ciphertext_b64: str, iv_hex: str, salt_hex: str) -> Optional[str]:
    """Decrypts Dizipal PBKDF2 (SHA-512, 999 iter) + AES-256-CBC payload."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        salt_bytes = bytes.fromhex(salt_hex)
        iv_bytes = bytes.fromhex(iv_hex)
        cipher_bytes = base64.b64decode(ciphertext_b64.replace(r"\/", "/"))

        derived_key = hashlib.pbkdf2_hmac("sha512", k.encode("utf-8"), salt_bytes, 999, dklen=32)
        cipher = Cipher(algorithms.AES(derived_key), modes.CBC(iv_bytes))
        decryptor = cipher.decryptor()
        plain_padded = decryptor.update(cipher_bytes) + decryptor.finalize()
        pad_len = plain_padded[-1]
        if 1 <= pad_len <= 16:
            plain_padded = plain_padded[:-pad_len]
        return plain_padded.decode("utf-8", errors="ignore")
    except Exception:
        return None


def resolve_pilavyer(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves Pilavyer / Diziİzle HLS stream."""
    session = session or _get_session()
    pv_slug = None

    if url.startswith("pilavyer:"):
        pv_slug = url[len("pilavyer:"):]
    elif "pilavyerplay." in url.lower() and "s=" in url:
        m = re.search(r"[?&]s=([^&]+)", url)
        if m:
            pv_slug = m.group(1)
    elif "diziizle.wiki" in url.lower() or "diziizle.cafe" in url.lower():
        try:
            r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://diziizle.cafe/"}, timeout=8)
            if r.status_code == 200:
                m = re.search(r'data-pv=["\']([^"\']+)["\']', r.text) or re.search(r's\.php\?s=([^"\'\s&]+)', r.text)
                if m:
                    pv_slug = m.group(1)
        except Exception:
            pass

    if pv_slug:
        s_url = f"https://play2.pilavyerplay.top/assets/js/s.php?s={pv_slug}"
        try:
            r = session.get(s_url, headers={"User-Agent": COMMON_UA, "Referer": "https://diziizle.cafe/", "Origin": "https://diziizle.cafe"}, timeout=8)
            if r.status_code == 200:
                stream_url = None
                subtitles = []
                m_player = re.search(r"window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});", r.text)
                if m_player:
                    try:
                        p_obj = json.loads(m_player.group(1))
                        stream_url = p_obj.get("file") or p_obj.get("stream")
                        for t in p_obj.get("subtitles") or []:
                            if t.get("file"):
                                f_sub = t["file"]
                                sub_url = f_sub if f_sub.startswith("http") else f"https://play2.pilavyerplay.top{f_sub}"
                                subtitles.append({"label": t.get("label", "Türkçe"), "lang": "tr", "url": sub_url})
                    except Exception:
                        pass
                if not stream_url:
                    m_f = re.search(r'"file"\s*:\s*"([^"]+)"', r.text) or re.search(r'(/api/stream\.php\?[^"\']*)', r.text)
                    if m_f:
                        stream_url = m_f.group(1).replace(r"\/", "/")

                if stream_url:
                    if stream_url.startswith("/"):
                        stream_url = f"https://play2.pilavyerplay.top{stream_url}"
                    return {
                        "mode": "native_hls",
                        "stream_url": stream_url,
                        "type": "hls",
                        "provider": "pilavyer",
                        "headers": {"Referer": "https://diziizle.cafe/", "Origin": "https://diziizle.cafe"},
                        "subtitles": subtitles,
                    }
        except Exception:
            pass
    return None


def resolve_dtpasn_wdt(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves WDT / KoreDizi dtpasn.asia HLS stream."""
    session = session or _get_session()
    video_hash = None

    if "dtpasn.asia" in url.lower():
        m = re.search(r"/video/([a-zA-Z0-9]+)", url) or re.search(r"[?&]data=([a-zA-Z0-9]+)", url)
        if m:
            video_hash = m.group(1)
    elif url.startswith("wdt:") or "webdramaturkey" in url.lower():
        embed_id = url.split(":")[-1] if url.startswith("wdt:") else ""
        if embed_id:
            try:
                r = session.post("https://webdramaturkey2.com/ajax/embed", data={"id": embed_id}, headers={"User-Agent": COMMON_UA, "Referer": "https://webdramaturkey2.com/"}, timeout=8)
                if r.status_code == 200:
                    m_v = re.search(r"video\.php\?hash=([a-zA-Z0-9]+)", r.text)
                    if m_v:
                        r2 = session.get(f"https://webdramaturkey2.com/video.php?hash={m_v.group(1)}", headers={"User-Agent": COMMON_UA, "Referer": "https://webdramaturkey2.com/"}, timeout=8)
                        m_dt = re.search(r"dtpasn\.asia/video/([a-zA-Z0-9]+)", r2.text)
                        if m_dt:
                            video_hash = m_dt.group(1)
            except Exception:
                pass

    if video_hash:
        try:
            low_in = url.lower()
            if "#r=wdt" in low_in or "webdramaturkey" in low_in or url.startswith("wdt:"):
                ref_site = "https://webdramaturkey2.com/"
            elif "dizikorea" in low_in:
                ref_site = "https://dizikorea3.com/"
            else:
                ref_site = "https://koredizi.com/"

            # Step 1: GET /video/{hash} to capture fireplayer_player PHP session cookie
            try:
                session.get(
                    f"https://dtpasn.asia/video/{video_hash}",
                    headers={"User-Agent": COMMON_UA, "Referer": ref_site},
                    timeout=8,
                )
            except Exception:
                pass

            # Step 2: POST getVideo with session cookie
            api_url = f"https://dtpasn.asia/player/index.php?data={video_hash}&do=getVideo"
            headers = {
                "User-Agent": COMMON_UA,
                "Origin": "https://dtpasn.asia",
                "Referer": f"https://dtpasn.asia/video/{video_hash}",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            }
            body = {"hash": video_hash, "r": ref_site}
            r = session.post(api_url, headers=headers, data=body, timeout=8)
            if r.status_code == 200:
                data = r.json()
                candidates = []
                for link in (data.get("securedLink"), data.get("videoSource")):
                    if link and link not in candidates:
                        candidates.append(link)
                ref_candidates = [
                    f"https://dtpasn.asia/video/{video_hash}",
                    ref_site,
                    "https://koredizi.com/",
                    "https://dizikorea3.com/",
                    "https://webdramaturkey2.com/",
                ]
                for cand_link in candidates:
                    for cand_ref in ref_candidates:
                        try:
                            pr = session.get(
                                cand_link,
                                headers={"User-Agent": COMMON_UA, "Referer": cand_ref},
                                timeout=6,
                            )
                            txt = pr.text or ""
                            if (
                                pr.status_code == 200
                                and "security error" not in txt.lower()
                                and ("#EXTM3U" in txt or "#EXTINF" in txt)
                            ):
                                return {
                                    "mode": "native_hls",
                                    "stream_url": cand_link,
                                    "type": "hls",
                                    "provider": "dtpasn" if "dtpasn.asia" in low_in else "wdt",
                                    "headers": {
                                        "Referer": cand_ref,
                                        "Origin": "https://dtpasn.asia",
                                    },
                                    "cookies": dict(session.cookies) if hasattr(session, "cookies") else {},
                                }
                        except Exception:
                            continue
        except Exception:
            pass
    return None


def resolve_rapidvid(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves RapidVid / Turbo / s6.cdnimage HLS stream."""
    session = session or _get_session()
    try:
        r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://rapidvid.net/"}, timeout=8)
        if r.status_code == 200:
            m_av = re.search(r'(?:av|_)\s*\(\s*["\']([A-Za-z0-9+/=]{20,})["\']\s*\)', r.text)
            hls_url = None
            if m_av:
                hls_url = decode_rapidvid(m_av.group(1))
            if not hls_url:
                m_tele = re.search(r'"h264"\s*:\s*"([^"]+)"', r.text)
                if m_tele:
                    hls_url = m_tele.group(1).replace(r"\/", "/")

            if hls_url:
                subtitles = []
                m_tr = re.search(r'jwSetup\.tracks\s*=\s*(\[[^\]]+\])', r.text)
                if m_tr:
                    try:
                        raw_tracks = json.loads(m_tr.group(1).replace(r"\/", "/"))
                        for t in raw_tracks:
                            if t.get("file"):
                                subtitles.append({"label": t.get("label", "Altyazı"), "url": t["file"]})
                    except Exception:
                        pass
                return {
                    "mode": "native_hls",
                    "stream_url": hls_url,
                    "type": "hls",
                    "provider": "rapidvid",
                    "headers": {"Referer": "https://rapidvid.net/", "Origin": "https://rapidvid.net"},
                    "subtitles": subtitles,
                }
    except Exception:
        pass
    return None


def resolve_dizipal(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves Dizipal / DPlayer HLS stream."""
    session = session or _get_session()
    if "dplayer82.site/master.m3u8" in url.lower():
        return {
            "mode": "native_hls",
            "stream_url": url,
            "type": "hls",
            "provider": "dizipal",
            "headers": {"Referer": "https://sn.dplayer82.site/", "Origin": "https://sn.dplayer82.site"},
        }
    if "dizipal" in url.lower():
        try:
            r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://dizipal1592.com/"}, timeout=8)
            if r.status_code == 200:
                chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', r.text)
                blob = "".join(chunks).replace('\\"', '"').replace('\\\\', '\\') if chunks else r.text
                mk = re.search(r'"k":"([^"]+)"', blob)
                mc = re.search(r'"ciphertext":"([^"]+)"', blob)
                miv = re.search(r'"iv":"([^"]+)"', blob)
                ms = re.search(r'"salt":"([^"]+)"', blob)
                if mk and mc and miv and ms:
                    dec = decrypt_dizipal(mk.group(1), mc.group(1), miv.group(1), ms.group(1))
                    if dec:
                        dp_url = dec if dec.startswith("http") else f"https:{dec}"
                        dp_r = session.get(dp_url, headers={"User-Agent": COMMON_UA, "Referer": url}, timeout=8)
                        if dp_r.status_code == 200:
                            m_open = re.search(r"openPlayer\(['\"]([^'\"]+)['\"]", dp_r.text)
                            if m_open:
                                s2_url = f"https://sn.dplayer82.site/source2.php?v={m_open.group(1)}"
                                s2_r = session.get(s2_url, headers={"User-Agent": COMMON_UA, "Referer": dp_url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
                                if s2_r.status_code == 200:
                                    raw_f = s2_r.json().get("playlist", [{}])[0].get("sources", [{}])[0].get("file", "")
                                    if raw_f:
                                        master = raw_f.replace("m.php", "master.m3u8")
                                        return {
                                            "mode": "native_hls",
                                            "stream_url": master,
                                            "type": "hls",
                                            "provider": "dizipal",
                                            "headers": {"Referer": "https://sn.dplayer82.site/", "Origin": "https://sn.dplayer82.site"},
                                        }
        except Exception:
            pass
    return None


def resolve_sezonlukdizi(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves SezonlukDizi embed player to raw stream."""
    session = session or _get_session()
    try:
        r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://sezonlukdizi.cc/"}, timeout=8)
        if r.status_code == 200:
            m = re.search(r'\bvar\s+bid\s*=\s*["\']?(\d+)', r.text) or re.search(r'data-id=["\'](\d+)', r.text)
            if m:
                bid = m.group(1)
                r_alt = session.post("https://sezonlukdizi.cc/ajax/dataAlternatif22.asp", data={"bid": bid, "dil": 1}, headers={"User-Agent": COMMON_UA, "Referer": url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
                if r_alt.status_code == 200:
                    items = r_alt.json().get("data") or []
                    for item in items:
                        alt_id = item.get("id")
                        if not alt_id:
                            continue
                        r_emb = session.post("https://sezonlukdizi.cc/ajax/dataEmbed22.asp", data={"id": alt_id}, headers={"User-Agent": COMMON_UA, "Referer": url, "X-Requested-With": "XMLHttpRequest"}, timeout=8)
                        if r_emb.status_code == 200:
                            m_ifr = re.search(r'<iframe[^\>]+src=["\']([^"\']+)["\']', r_emb.text, re.I)
                            if m_ifr:
                                emb = m_ifr.group(1).strip()
                                if not emb.startswith("http"):
                                    emb = f"https:{emb}" if emb.startswith("//") else f"https://sezonlukdizi.cc{emb}"
                                sub_res = resolve_stream(emb)
                                if sub_res:
                                    return sub_res
    except Exception:
        pass
    return None


def resolve_dramavadisi(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves DramaVadisi direct MP4/HLS stream with absolute redirect resolution."""
    session = session or _get_session()
    series_id = None
    ep_no = "1"
    if url.startswith("dramavadisi:"):
        parts = url[len("dramavadisi:"):].split(":")
        series_id = parts[0]
        ep_no = parts[1] if len(parts) > 1 else "1"
    elif "/api/series/" in url:
        m = re.search(r"/api/series/(\d+)/watch", url)
        if m:
            series_id = m.group(1)
    elif "dramavadisi.com" in url:
        m = re.search(r"(\d+)-bolum", url)
        if m:
            ep_no = m.group(1)
        try:
            r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://dramavadisi.com/"}, timeout=8)
            if r.status_code == 200:
                m_s = re.search(r'"series(?:_id)?"\s*:\s*(\d+)', r.text) or re.search(r'/api/series/(\d+)/watch', r.text)
                if m_s:
                    series_id = m_s.group(1)
        except Exception:
            pass

    if series_id:
        try:
            w_url = f"https://dramavadisi.com/api/series/{series_id}/watch"
            r = session.get(w_url, headers={"User-Agent": COMMON_UA, "Referer": "https://dramavadisi.com/"}, timeout=8)
            if r.status_code == 200:
                data = r.json()
                episodes = data.get("episodes") if isinstance(data, dict) else (data if isinstance(data, list) else [])
                target = next(
                    (e for e in episodes if str(e.get("no") or e.get("episode_no") or "") == str(ep_no)),
                    None,
                )
                if not target:
                    target = next((e for e in episodes if str(e.get("id") or "") == str(ep_no)), None)
                if not target and str(ep_no).isdigit():
                    idx = int(ep_no) - 1
                    if 0 <= idx < len(episodes):
                        target = episodes[idx]
                if not target and (not ep_no or str(ep_no) == "1") and episodes:
                    target = episodes[0]

                if target and target.get("src"):
                    raw_src = str(target["src"])
                    play_url = raw_src if raw_src.startswith("http") else f"https://dramavadisi.com{raw_src if raw_src.startswith('/') else '/' + raw_src}"
                    r_media = session.get(
                        play_url,
                        headers={"User-Agent": COMMON_UA, "Referer": "https://dramavadisi.com/", "Range": "bytes=0-1023"},
                        allow_redirects=True,
                        timeout=10,
                    )
                    if r_media.status_code in (200, 206):
                        final_url = str(r_media.url)
                        ct = (r_media.headers.get("content-type") or "").lower()
                        is_hls = ".m3u8" in final_url.lower() or str(target.get("type") or "").lower() == "m3u8" or "mpegurl" in ct
                        subtitles = []
                        sub_base = target.get("subBase")
                        for lang_code in target.get("subs") or []:
                            code = str(lang_code).strip()
                            if sub_base and code:
                                sb_abs = sub_base if str(sub_base).startswith("http") else f"https://dramavadisi.com{sub_base if str(sub_base).startswith('/') else '/' + str(sub_base)}"
                                sub_url = f"{sb_abs.rstrip('/')}/{code}.vtt"
                                subtitles.append({
                                    "label": "Türkçe" if code.lower() == "tr" else code.upper(),
                                    "lang": code.lower(),
                                    "url": sub_url,
                                })
                        return {
                            "mode": "native_hls" if is_hls else "native_mp4",
                            "stream_url": final_url,
                            "type": "hls" if is_hls else "mp4",
                            "provider": "dramavadisi",
                            "headers": {"Referer": "https://dramavadisi.com/"},
                            "acao": r_media.headers.get("access-control-allow-origin"),
                            "subtitles": subtitles,
                        }
        except Exception:
            pass
    return None


def resolve_dramabox(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves DramaBox direct MP4 stream matching by chapterId first, then numeric index."""
    session = session or _get_session()
    target_page_url = url
    target_chapter_id: Optional[str] = None
    target_chapter_index: Optional[str] = None

    if url.startswith("dramabox:"):
        parts = url[len("dramabox:"):].split(":")
        book_id = parts[0] if parts else ""
        ch_token = parts[1] if len(parts) > 1 else "1"
        target_chapter_id = ch_token
        target_chapter_index = ch_token
        target_page_url = f"https://www.dramabox.com/tr/video/{book_id}_play/{ch_token}_Episode-1"
    else:
        m = re.search(r"/([a-zA-Z0-9]+)_Episode-(\d+)", url, re.I)
        if m:
            target_chapter_id = m.group(1)
            target_chapter_index = m.group(2)

    try:
        r = session.get(target_page_url, headers={"User-Agent": COMMON_UA, "Referer": "https://www.dramabox.com/tr"}, timeout=10)
        if r.status_code != 200:
            return None
        m_nd = re.search(r'<script id="__NEXT_DATA__" type="application/json">([\s\S]*?)</script>', r.text)
        chapter_list = []
        current_chapter = None
        if m_nd:
            pp = json.loads(m_nd.group(1)).get("props", {}).get("pageProps", {})
            chapter_list = pp.get("chapterList") or pp.get("videoInfo", {}).get("chapterList") or pp.get("bookInfo", {}).get("chapterList") or []
            current_chapter = pp.get("currentChapter") or pp.get("chapterInfo")

        target = None
        if target_chapter_id:
            target = next((c for c in chapter_list if str(c.get("id") or c.get("chapterId") or "") == str(target_chapter_id)), None)
        if not target and target_chapter_index:
            idx_int = int(target_chapter_index) if str(target_chapter_index).isdigit() else None
            for c in chapter_list:
                if str(c.get("chapterNo") or c.get("chapterIndex") or "") == str(target_chapter_index):
                    target = c
                    break
                if idx_int is not None and c.get("index") is not None:
                    if int(c["index"]) + 1 == idx_int or int(c["index"]) == idx_int:
                        target = c
                        break
        if not target and current_chapter:
            if not target_chapter_id or str(current_chapter.get("id") or current_chapter.get("chapterId") or "") == str(target_chapter_id):
                target = current_chapter
        if not target and target_chapter_index and str(target_chapter_index).isdigit():
            idx = int(target_chapter_index) - 1
            if 0 <= idx < len(chapter_list):
                target = chapter_list[idx]

        if target and (target.get("unlock") is False or target.get("isLocked")):
            return None
        mp4_url = (target or {}).get("mp4") or (target or {}).get("videoUrl") or (target or {}).get("url")
        if mp4_url:
            return {
                "mode": "native_mp4",
                "stream_url": mp4_url,
                "type": "mp4",
                "provider": "dramabox",
                "headers": {"Referer": "https://www.dramabox.com/"},
            }
    except Exception:
        pass
    return None


def resolve_vidmoly(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves Vidmoly embed pages to raw HLS .m3u8 streams and subtitles."""
    session = session or _get_session()
    try:
        norm = re.sub(r"^http://", "https://", url.strip(), flags=re.I)
        norm = re.sub(r"embed-embed\.html-", "embed-", norm, flags=re.I)
        norm = re.sub(r"//(?:www\.)?vidmoly\.(?:to|net|me)/", "//vidmoly.biz/", norm, flags=re.I)
        norm = re.sub(r"//(?:www\.)?vidmolynet/", "//vidmoly.biz/", norm, flags=re.I)
        from urllib.parse import urlparse
        p = urlparse(norm)
        vm_ref = f"{p.scheme}://{p.netloc}/"
        r = session.get(norm, headers={"User-Agent": COMMON_UA, "Referer": vm_ref}, timeout=8)
        if r.status_code in (404, 410):
            return None
        low = r.text.lower()
        if any(m in low for m in ("no video found", "this video not found", "file was deleted", "video not found", "deleted by owner", "file not found")):
            return None
        m = re.search(r'sources\s*:\s*\[\s*\{\s*file\s*:\s*["\'](https?://[^"\']+\.m3u8[^"\']*)["\']', r.text, re.I) or re.search(r'file\s*:\s*["\'](https?://[^"\']+\.m3u8[^"\']*)["\']', r.text, re.I)
        if m:
            sub_m = re.search(r'https?://srt\.vidmoly\.[a-z]+/srt/[^"\'\s]+\.vtt', r.text, re.I)
            subs = [{"label": "Türkçe", "lang": "tr", "url": sub_m.group(0)}] if sub_m else []
            return {
                "mode": "native_hls",
                "stream_url": m.group(1),
                "type": "hls",
                "provider": "vidmoly",
                "headers": {"Referer": vm_ref, "Origin": vm_ref.rstrip("/")},
                "subtitles": subs,
            }
    except Exception:
        pass
    return None


def resolve_shortizle(url: str, session: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """Resolves Shortİzle direct HLS stream."""
    try:
        import requests
        session = session or requests.Session()
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        watch_url = ""
        if "watch" in qs:
            w_val = qs["watch"][0]
            watch_url = w_val if w_val.startswith("http") else f"https://shortizle.com{w_val if w_val.startswith('/') else '/' + w_val}"
        elif parsed.path.startswith("/watch/"):
            watch_url = f"https://shortizle.com{parsed.path}"
        elif parsed.path.startswith("/embed/"):
            watch_url = f"https://shortizle.com{re.sub(r'^/embed/', '/watch/', parsed.path, flags=re.I)}"

        if not watch_url:
            return None

        target_id = None
        m_id = re.search(r"/media/[^/]+/(\d+)", parsed.path)
        if m_id:
            target_id = int(m_id.group(1))
        requested_kind = (qs.get("kind", [""])[0] or "").lower()

        def _abs_sub(raw_sub: Optional[str]) -> Optional[str]:
            if not raw_sub:
                return None
            return raw_sub if raw_sub.startswith("http") else f"https://shortizle.com{raw_sub if raw_sub.startswith('/') else '/' + raw_sub}"

        r = session.get(watch_url, headers={"User-Agent": COMMON_UA, "Referer": "https://shortizle.com/"}, timeout=8)
        if r.status_code == 200:
            m_dp = (
                re.search(r'<script[^>]*data-page=["\']app["\'][^>]*>({.+?})</script>', r.text, re.DOTALL | re.I)
                or re.search(r'data-page="(\{.+?\})"', r.text)
            )
            if m_dp:
                un = m_dp.group(1).replace("&quot;", '"').replace("&amp;", "&").replace("&#039;", "'")
                p = json.loads(un).get("props", {}).get("externalSources", {})
                candidates = []
                if requested_kind and requested_kind in p:
                    candidates.extend(p[requested_kind])
                for k, v in p.items():
                    if k != requested_kind and isinstance(v, list):
                        candidates.extend(v)

                matched = None
                if target_id:
                    for c in candidates:
                        if c.get("id") == target_id:
                            matched = c
                            break
                eval_list = [matched] if matched else []
                for c in candidates:
                    if c not in eval_list:
                        eval_list.append(c)

                for cand in eval_list:
                    if not cand:
                        continue
                    sub_url = _abs_sub(cand.get("subtitle_url"))

                    direct_stream = cand.get("url") or ""
                    if direct_stream and (".m3u8" in direct_stream or ".mp4" in direct_stream):
                        return {
                            "mode": "native_hls" if ".m3u8" in direct_stream else "native_mp4",
                            "stream_url": direct_stream,
                            "type": "hls" if ".m3u8" in direct_stream else "mp4",
                            "subtitle_url": sub_url,
                            "provider": "shortizle",
                            "headers": {"Referer": "https://shortizle.com/", "Origin": "https://shortizle.com"},
                        }

                    res_url = cand.get("resolve_url")
                    if res_url:
                        if not res_url.startswith("http"):
                            res_url = f"https://shortizle.com{res_url}"
                        try:
                            r_res = session.get(
                                res_url,
                                headers={
                                    "User-Agent": COMMON_UA,
                                    "Referer": watch_url,
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Accept": "application/json, text/plain, */*",
                                },
                                timeout=8,
                            )
                            if r_res.status_code == 200:
                                rj = r_res.json()
                                stream_url = None
                                gb = rj.get("gateway_bootstrap")
                                if isinstance(gb, dict) and gb.get("url") and gb.get("token"):
                                    r_auth = session.post(
                                        gb["url"],
                                        json={"token": gb["token"]},
                                        headers={
                                            "User-Agent": COMMON_UA,
                                            "Origin": "https://shortizle.com",
                                            "Referer": "https://shortizle.com/",
                                            "Accept": "application/json",
                                        },
                                        timeout=6,
                                    )
                                    if r_auth.status_code == 200:
                                        stream_url = r_auth.json().get("url")
                                elif rj.get("url"):
                                    stream_url = rj["url"]
                                    if not stream_url.startswith("http"):
                                        stream_url = f"https://shortizle.com{stream_url}"

                                if stream_url:
                                    is_hls = (
                                        "m3u8" in stream_url.lower()
                                        or "stream.shortizle.com/v1/" in stream_url.lower()
                                        or str(cand.get("type") or "").lower() == "hls"
                                        or str(rj.get("type") or "").lower() == "hls"
                                    )
                                    res_cookies = {}
                                    if hasattr(session, "cookies"):
                                        for ck, cv in session.cookies.items():
                                            if "shortizle_media" in ck:
                                                res_cookies[ck] = cv
                                    return {
                                        "mode": "native_hls" if is_hls else "native_mp4",
                                        "stream_url": stream_url,
                                        "type": "hls" if is_hls else "mp4",
                                        "subtitle_url": sub_url or _abs_sub(rj.get("subtitle_url")),
                                        "provider": "shortizle",
                                        "headers": {"Referer": "https://shortizle.com/", "Origin": "https://shortizle.com"},
                                        "cookies": res_cookies,
                                    }
                        except Exception:
                            pass

                    if direct_stream and "vidmoly" in direct_stream.lower():
                        vm_res = resolve_vidmoly(direct_stream)
                        if vm_res:
                            if sub_url and not vm_res.get("subtitles"):
                                vm_res["subtitle_url"] = sub_url
                            return vm_res
    except Exception:
        pass
    return None


def resolve_stream(url: str, provider: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Universal stream resolver entry point.
    Returns normalized stream dictionary or None.
    """
    if not url:
        return None

    low = url.lower()
    p = (provider or "").lower()

    if p == "pilavyer" or "pilavyer" in low or "diziizle" in low:
        res = resolve_pilavyer(url)
        if res:
            return res

    if p == "wdt" or p == "koredizi" or "dtpasn" in low or "webdramaturkey" in low:
        res = resolve_dtpasn_wdt(url)
        if res:
            return res

    if p == "rapidvid" or "rapidvid" in low or "cdnimage" in low or "turbo.imgz.me" in low:
        res = resolve_rapidvid(url)
        if res:
            return res

    if p == "dizipal" or "dizipal" in low or "dplayer82.site" in low:
        res = resolve_dizipal(url)
        if res:
            return res

    if p == "sezonlukdizi" or "sezonlukdizi" in low:
        res = resolve_sezonlukdizi(url)
        if res:
            return res

    if p == "dramavadisi" or "dramavadisi" in low:
        res = resolve_dramavadisi(url)
        if res:
            return res

    if p == "dramabox" or "dramabox" in low:
        res = resolve_dramabox(url)
        if res:
            return res

    if p == "shortizle" or "shortizle" in low:
        res = resolve_shortizle(url)
        if res:
            return res

    if "vidmoly" in p or "vidmoly" in low:
        res = resolve_vidmoly(url)
        if res:
            return res

    if ".m3u8" in low:
        headers = {"Referer": "https://shortizle.com/"} if ("b-cdn.net" in low or "mybigdramapool" in low) else None
        payload: Dict[str, Any] = {
            "mode": "native_hls",
            "stream_url": url,
            "type": "hls",
            "provider": provider or "direct_hls",
        }
        if headers:
            payload["headers"] = headers
        return payload

    if ".mp4" in low:
        return {
            "mode": "native_mp4",
            "stream_url": url,
            "type": "mp4",
            "provider": provider or "direct_mp4",
        }

    return None
