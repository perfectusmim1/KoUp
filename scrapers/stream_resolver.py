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
            api_url = f"https://dtpasn.asia/player/index.php?data={video_hash}&do=getVideo"
            headers = {
                "User-Agent": COMMON_UA,
                "Origin": "https://dtpasn.asia",
                "Referer": f"https://dtpasn.asia/video/{video_hash}",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            }
            body = {"hash": video_hash, "r": "https://webdramaturkey2.com/"}
            r = session.post(api_url, headers=headers, data=body, timeout=8)
            if r.status_code == 200:
                data = r.json()
                secured_link = data.get("securedLink") or data.get("videoSource")
                if secured_link:
                    return {
                        "mode": "native_hls",
                        "stream_url": secured_link,
                        "type": "hls",
                        "provider": "wdt",
                        "headers": {"Referer": f"https://dtpasn.asia/video/{video_hash}", "Origin": "https://dtpasn.asia"},
                    }
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
    """Resolves DramaVadisi direct MP4 stream."""
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
                target = next((e for e in episodes if str(e.get("no") or e.get("episode_no")) == str(ep_no)), episodes[0] if episodes else None)
                if target and target.get("src"):
                    return {
                        "mode": "native_mp4",
                        "stream_url": target["src"],
                        "type": "mp4",
                        "provider": "dramavadisi",
                    }
        except Exception:
            pass
    return None


def resolve_shortizle(url: str, session: Optional[cfr.Session] = None) -> Optional[Dict[str, Any]]:
    """Resolves Shortİzle direct HLS stream."""
    session = session or _get_session()
    try:
        r = session.get(url, headers={"User-Agent": COMMON_UA, "Referer": "https://shortizle.com/"}, timeout=8)
        if r.status_code == 200:
            m_dp = re.search(r'data-page="([^"]+)"', r.text)
            if m_dp:
                un = m_dp.group(1).replace("&quot;", '"').replace("&amp;", "&")
                p = json.loads(un).get("props", {}).get("externalSources", {})
                cand = (p.get("altyazi") or []) + (p.get("dublaj") or [])
                if cand and cand[0].get("resolve_url"):
                    res_url = cand[0]["resolve_url"]
                    if not res_url.startswith("http"):
                        res_url = f"https://shortizle.com{res_url}"
                    r_res = session.get(res_url, headers={"User-Agent": COMMON_UA, "Referer": url, "X-Storage-Pilot": "1"}, timeout=8)
                    if r_res.status_code == 200:
                        rj = r_res.json()
                        stream_url = rj.get("url")
                        if stream_url:
                            return {
                                "mode": "native_hls",
                                "stream_url": stream_url if stream_url.startswith("http") else f"https://shortizle.com{stream_url}",
                                "type": "hls",
                                "provider": "shortizle",
                                "headers": {"Referer": "https://shortizle.com/", "Origin": "https://shortizle.com"},
                            }
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

    if p == "shortizle" or "shortizle" in low:
        res = resolve_shortizle(url)
        if res:
            return res

    if ".m3u8" in low:
        return {
            "mode": "native_hls",
            "stream_url": url,
            "type": "hls",
            "provider": provider or "direct_hls",
        }

    if ".mp4" in low:
        return {
            "mode": "native_mp4",
            "stream_url": url,
            "type": "mp4",
            "provider": provider or "direct_mp4",
        }

    return None
