"""
KoUp Targeted Source Restoration Script (repair_zero_source_dramas.py)
=====================================================================
Sıfır kaynaklı kalan 717 dizi ve anime için çalışan platformlardan
(WebDramaTurkey, DiziYou, DiziBox, AnimeciX, TrAnimeİzle ve Arşiv Kardeş Eşlenikleri)
canlı video embed'lerini (Vidmoly, Ok.ru, Sibnet, Doodstream, Mail.ru, DiziYou HLS, VK, Tau Video)
çeker, SQLite (webdrama_archive.db) ve Supabase (episodes.video_sources) ile senkronize eder.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from bs4 import BeautifulSoup

# Proje kök dizinini sys.path'e ekle
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

try:
    import requests
except ImportError:
    requests = None

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    AESGCM = None

# Windows Konsol UTF-8 Desteği
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")
REPORTS_DIR = os.path.join(BASE_DIR, "scripts", "reports")
DEFAULT_AUDIT_REPORT = os.path.join(REPORTS_DIR, "source_audit_report.json")
DEFAULT_OUTPUT_JSON = os.path.join(REPORTS_DIR, "source_repair_execution_report.json")
DEFAULT_OUTPUT_MD = os.path.join(REPORTS_DIR, "source_repair_execution_report.md")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY",
    os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
    ),
)

ANIMECIX_KEY = b"i4C7R2fXGocdYgFLzCbDlsJjukf8G58b"
AES_CIPHER = AESGCM(ANIMECIX_KEY) if AESGCM else None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
}

TR_MAP = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


# ==============================================================================
# YARDIMCI VE DÖNÜŞTÜRÜCÜ METOTLAR
# ==============================================================================

def norm_title(s: str) -> str:
    """Türkçe ve ASCII olmayan karakterleri standartlaştırır."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = s.translate(TR_MAP).lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def clean_slug(s: str) -> str:
    """Slug sonundaki izle, sezon, hd gibi gereksiz takıları temizler."""
    s = (s or "").lower()
    s = re.sub(r"-(izle|dq\d*|hd|box|aw|ta)$", "", s)
    s = re.sub(r"-\d{4}-(kore|cin|japon|tayland|tayvan|asya)$", "", s)
    return re.sub(r"[^a-z0-9-]+", "-", s).strip("-")


def repair_url(url: str) -> str:
    """Bozuk veya yönlendirmeli URL desenlerini çalışan temiz linke dönüştürür."""
    if not url or url == "dead":
        return ""
    fixed = url.strip()
    if "href.li/?" in fixed:
        fixed = fixed.split("href.li/?")[-1].strip()
    if "luffytra" in fixed and "embed2/?id=" in fixed:
        fixed = fixed.split("embed2/?id=")[-1].strip()
    if fixed.startswith("//"):
        fixed = "https:" + fixed
    if fixed.startswith("https:https://"):
        fixed = "https://" + fixed[14:]
    if "vidmoly.to/" in fixed:
        fixed = fixed.replace("vidmoly.to/", "vidmoly.biz/")
    return fixed


def identify_provider(url: str) -> str:
    """Video akış sağlayıcısını URL üzerinden sınıflandırır."""
    if not url or url == "dead":
        return "unknown"
    u = url.lower()
    if "ok.ru" in u or "odnoklassniki" in u:
        return "ok.ru"
    if "vidmoly" in u:
        return "vidmoly"
    if "sibnet.ru" in u or "sibnet" in u:
        return "sibnet"
    if "vk.com" in u or "vkontakte" in u:
        return "vk"
    if "mail.ru" in u:
        return "mail.ru"
    if "filemoon" in u:
        return "filemoon"
    if "storage.diziyou" in u or ".m3u8" in u:
        return "diziyou-hls"
    if "tau-video" in u:
        return "tau-video"
    if "dood" in u:
        return "doodstream"
    if "uqload" in u:
        return "uqload"
    if "dtpasn" in u:
        return "dtpasn"
    return "other"


def make_animecix_header(query_str: str) -> str:
    """AnimeciX API için AES-GCM 256 kimlik doğrulama başlığı üretir."""
    if not AES_CIPHER:
        return ""
    iv = os.urandom(12)
    plaintext = ("{version}" + query_str).encode("utf-8")
    ciphertext = AES_CIPHER.encrypt(iv, plaintext, None)
    ct_b64 = base64.b64encode(ciphertext).decode("ascii")
    iv_b64 = base64.b64encode(iv).decode("ascii")
    return f"{ct_b64}.{iv_b64}"


# ==============================================================================
# HTTP VE OTURUM YÖNETİMİ
# ==============================================================================

class HTTPClient:
    _cf_session = None
    _std_session = None

    @classmethod
    def get_cf_session(cls):
        if cls._cf_session is None and cfr:
            cls._cf_session = cfr.Session(impersonate="chrome")
        return cls._cf_session

    @classmethod
    def get_std_session(cls):
        if cls._std_session is None and requests:
            cls._std_session = requests.Session()
        return cls._std_session

    @classmethod
    def fetch_text(cls, url: str, referer: str = None, timeout: float = 12.0, use_cf: bool = False) -> tuple[str, str]:
        """Sayfa metnini ve yönlendirilen nihai URL'yi döner."""
        hdrs = dict(HEADERS)
        if referer:
            hdrs["Referer"] = referer

        if use_cf and cfr:
            sess = cls.get_cf_session()
            resp = sess.get(url, headers=hdrs, timeout=timeout)
            return resp.text, resp.url
        elif requests:
            sess = cls.get_std_session()
            resp = sess.get(url, headers=hdrs, timeout=timeout)
            return resp.text, resp.url
        else:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                final_url = resp.geturl()
                html = resp.read().decode("utf-8", errors="replace")
                return html, final_url


# ==============================================================================
# HEDEF SAĞLAYICI ÇÖZÜCÜLERİ
# ==============================================================================

class RestorationResolvers:

    @staticmethod
    def resolve_sibling(cur, drama_id: int, drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        1. STRATEJİ: Arşiv İçi Kardeş Kayıt Eşleştirmesi
        Aynı yapımın başka bir sağlayıcıdan çekilmiş ve çalışan kaynağı olan kaydını eşler.
        """
        nt = norm_title(drama_info["title"])
        if len(nt) < 3:
            return []

        cur.execute("""
            SELECT d.id, d.title, d.release_year, count(es.id) as live_count
            FROM dramas d
            JOIN episodes e ON e.drama_id = d.id
            JOIN episode_sources es ON es.episode_id = e.id
            WHERE d.id != ? AND es.direct_url != 'dead' AND es.direct_url IS NOT NULL
            GROUP BY d.id
            HAVING live_count > 0;
        """, (drama_id,))

        def _safe_year(val):
            if not val:
                return None
            m = re.search(r"\b(19|20)\d\d\b", str(val))
            return int(m.group(0)) if m else None

        cands = []
        for r_id, r_title, r_year, r_live in cur.fetchall():
            if norm_title(r_title) == nt:
                y1 = _safe_year(drama_info.get("year"))
                y2 = _safe_year(r_year)
                if y1 is None or y2 is None or abs(y1 - y2) <= 1:
                    cands.append((r_id, r_title, r_live))

        if not cands:
            return []

        best_sibling_id, _, _ = max(cands, key=lambda x: x[2])

        cur.execute("""
            SELECT e.season_number, e.episode_number, es.source_name, es.direct_url, es.provider, es.site
            FROM episode_sources es
            JOIN episodes e ON e.id = es.episode_id
            WHERE e.drama_id = ? AND es.direct_url != 'dead' AND es.direct_url IS NOT NULL
        """, (best_sibling_id,))

        sources_by_ep = defaultdict(list)
        for s_no, ep_no, s_name, d_url, prov, site in cur.fetchall():
            repaired = repair_url(d_url)
            if repaired:
                sources_by_ep[(s_no, ep_no)].append({
                    "source_name": f"{s_name} (Kardeş Ayna)",
                    "direct_url": repaired,
                    "provider": prov or identify_provider(repaired),
                    "site": site or "sibling"
                })

        patched = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key in sources_by_ep:
                for src in sources_by_ep[key]:
                    patched.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "episode_name": ep["name"],
                        **src
                    })
        return patched

    @staticmethod
    def resolve_webdramaturkey(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        2. STRATEJİ: WebDramaTurkey Canlı Akış Çözücü
        https://webdramaturkey2.com/dizi/{slug} -> /1-sezon/1-bolum -> ajax/embed -> Vidmoly / VK / OK.ru
        """
        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        source_url = drama_info.get("source_url") or ""

        target_series_url = None
        if "webdramaturkey" in source_url:
            target_series_url = source_url
        else:
            candidates = [
                f"https://webdramaturkey2.com/dizi/{clean_slug(slug)}",
                f"https://webdramaturkey2.com/dizi/{clean_slug(title)}",
                f"https://webdramaturkey2.com/film/{clean_slug(slug)}",
                f"https://webdramaturkey2.com/film/{clean_slug(title)}",
            ]
            for u in candidates:
                try:
                    html, final_u = HTTPClient.fetch_text(u, timeout=8.0)
                    if "-bolum" in html or "data-embed" in html:
                        target_series_url = final_u
                        break
                except Exception:
                    pass

        if not target_series_url:
            try:
                search_u = f"https://webdramaturkey2.com/?s={urllib.parse.quote(title)}"
                html, _ = HTTPClient.fetch_text(search_u, timeout=8.0)
                soup = BeautifulSoup(html, "html.parser")
                nt = norm_title(title)
                for a in soup.find_all("a", href=True):
                    h = a["href"]
                    if "/dizi/" in h or "/film/" in h:
                        t = a.get_text(strip=True)
                        if t and (norm_title(t) == nt or nt in norm_title(t)):
                            target_series_url = h
                            break
            except Exception:
                pass

        if not target_series_url:
            return []

        try:
            html, _ = HTTPClient.fetch_text(target_series_url, timeout=10.0)
            soup = BeautifulSoup(html, "html.parser")
            found_ep_links = {}
            for a in soup.find_all("a", href=lambda h: h and "-bolum" in h):
                h = a["href"]
                full_h = h if h.startswith("http") else "https://webdramaturkey2.com" + h
                ms = re.search(r"(\d+)-sezon", full_h)
                me = re.search(r"(\d+)-bolum", full_h)
                s_no = int(ms.group(1)) if ms else 1
                e_no = int(me.group(1)) if me else 1
                found_ep_links[(s_no, e_no)] = full_h
            
            # Eğer film ise ve bölüm linki yoksa, sayfanın kendisini 1. sezon 1. bölüm yap
            if not found_ep_links and ("data-embed" in html or "/film/" in target_series_url):
                found_ep_links[(1, 1)] = target_series_url
        except Exception:
            return []

        if not found_ep_links:
            return []

        sess = HTTPClient.get_cf_session() or HTTPClient.get_std_session()
        patched = []

        # Her dizi için ilk 15 bölümü işle
        for ep in episodes[:15]:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]

            try:
                ep_html, _ = HTTPClient.fetch_text(ep_url, referer=target_series_url, timeout=10.0)
                ep_soup = BeautifulSoup(ep_html, "html.parser")
                btns = ep_soup.find_all("button", class_=lambda c: c and "dropdown-source" in c)
                if not btns:
                    btns = ep_soup.find_all(attrs={"data-embed": True})

                sources_found_this_ep = 0
                for b in btns:
                    eid = b.get("data-embed")
                    if not eid:
                        continue
                    s_name_el = b.find("span", class_="name")
                    s_name = s_name_el.get_text(strip=True) if s_name_el else b.get_text(strip=True)
                    s_name = s_name.replace("Kaynak:", "").strip()

                    post_headers = {
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": ep_url,
                        "Origin": "https://webdramaturkey2.com"
                    }
                    if not sess:
                        continue
                    resp = sess.post("https://webdramaturkey2.com/ajax/embed", data={"id": str(eid)}, headers=post_headers, timeout=8)
                    text = resp.text

                    if "embed-lock" in text or "Hata" in text or "Bulunamadı" in text or "Spam" in text:
                        continue

                    m_src = re.search(r'src=["\']([^"\']+)["\']', text)
                    if not m_src:
                        continue
                    v_url = m_src.group(1).strip()
                    if v_url.startswith("/"):
                        v_url = "https://webdramaturkey2.com" + v_url

                    v_resp = sess.get(v_url, headers={"Referer": ep_url}, timeout=8)
                    v_soup = BeautifulSoup(v_resp.text, "html.parser")
                    ifr = v_soup.find("iframe", id="main-iframe") or v_soup.find("iframe")
                    real_stream = ifr.get("src").strip() if ifr and ifr.get("src") else None

                    if real_stream:
                        if "bulgu.net/ok/e/" in real_stream:
                            try:
                                b_resp = sess.get(real_stream, headers={"Referer": ep_url}, timeout=8)
                                qm = re.search(r"/ok/redirect\?v=([a-zA-Z0-9]+)", b_resp.text)
                                if qm:
                                    redir_url = f"https://bulgu.net/ok/redirect?v={qm.group(1)}"
                                    r_resp = sess.get(redir_url, headers={"Referer": "https://bulgu.net/"}, allow_redirects=False, timeout=8)
                                    loc = r_resp.headers.get("Location", "")
                                    id_m = re.search(r"id=(\d+)", loc)
                                    if id_m:
                                        real_stream = f"https://ok.ru/videoembed/{id_m.group(1)}"
                            except Exception:
                                pass

                        real_stream = repair_url(real_stream)
                        prov = identify_provider(real_stream)
                        if prov != "unknown" and "dead" not in real_stream:
                            patched.append({
                                "episode_id": ep["id"],
                                "season_number": ep["season_number"],
                                "episode_number": ep["episode_number"],
                                "episode_name": ep["name"],
                                "source_name": s_name or f"WDT {prov.title()}",
                                "direct_url": real_stream,
                                "provider": prov,
                                "site": "webdramaturkey"
                            })
                            sources_found_this_ep += 1
                            if sources_found_this_ep >= 2:
                                break
            except Exception:
                continue

        return patched

    @staticmethod
    def resolve_diziyou(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        3. STRATEJİ: DiziYou Canlı HLS Oynatıcı Çözücü
        /player/{id}.html -> storage.diziyou.one/episodes/{id}/play.m3u8 akışını çeker.
        """
        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        nt = norm_title(title)

        series_url = None
        candidates = [
            f"https://www.diziyou.one/{clean_slug(slug)}/",
            f"https://www.diziyou.one/{clean_slug(title)}/",
        ]
        for u in candidates:
            try:
                html, final_u = HTTPClient.fetch_text(u, timeout=7.0)
                if final_u.rstrip("/") == u.rstrip("/") and ("-sezon-" in html or "-bolum" in html):
                    series_url = u
                    break
            except Exception:
                pass

        if not series_url:
            try:
                search_u = f"https://www.diziyou.one/?s={urllib.parse.quote(title)}"
                html, _ = HTTPClient.fetch_text(search_u, timeout=7.0)
                soup = BeautifulSoup(html, "html.parser")
                inc = soup.find("div", class_="incontent")
                if inc:
                    for a in inc.find_all("a", href=True):
                        h = a["href"]
                        if not any(x in h for x in ["-bolum", "-sezon", "/tur/", "/kategori/"]):
                            t = a.get_text(strip=True)
                            if t and (norm_title(t) == nt or nt in norm_title(t)):
                                series_url = h
                                break
            except Exception:
                pass

        if not series_url:
            return []

        try:
            html, _ = HTTPClient.fetch_text(series_url, timeout=8.0)
            soup = BeautifulSoup(html, "html.parser")
            found_ep_links = {}
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if "-bolum" in h:
                    ms = re.search(r"-(\d+)-sezon-", h)
                    me = re.search(r"-(\d+)-bolum", h)
                    s_no = int(ms.group(1)) if ms else 1
                    e_no = int(me.group(1)) if me else 1
                    found_ep_links[(s_no, e_no)] = h
        except Exception:
            return []

        patched = []
        for ep in episodes[:15]:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]
            try:
                e_html, _ = HTTPClient.fetch_text(ep_url, referer=series_url, timeout=8.0)
                e_soup = BeautifulSoup(e_html, "html.parser")
                player_src = None
                for fr in e_soup.find_all("iframe"):
                    src = fr.get("src") or ""
                    if "/player/" in src:
                        player_src = src if src.startswith("http") else "https://www.diziyou.one" + src
                        break

                if not player_src:
                    continue

                p_html, _ = HTTPClient.fetch_text(player_src, referer=ep_url, timeout=8.0)
                m3u8_matches = re.findall(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', p_html)
                m3u8_matches = [x for x in m3u8_matches if "video.min" not in x and ".css" not in x]
                if m3u8_matches:
                    stream_url = m3u8_matches[0]
                    patched.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "episode_name": ep["name"],
                        "source_name": "DiziYou HLS",
                        "direct_url": stream_url,
                        "provider": "diziyou-hls",
                        "site": "diziyou"
                    })
            except Exception:
                continue

        return patched

    @staticmethod
    def resolve_dizibox(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        4. STRATEJİ: DiziBox Canlı Moly/King Oynatıcı Çözücü
        /player/moly/moly.php -> vidmoly.biz embed akışını çıkarır.
        """
        if not cfr:
            return []

        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        nt = norm_title(title)
        sess = HTTPClient.get_cf_session()

        candidates = [
            f"https://www.dizibox.live/diziler/{clean_slug(slug)}/",
            f"https://www.dizibox.live/diziler/{clean_slug(title)}/",
        ]
        if "csi" in nt and "cyber" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi-cyber/")
        elif "csi" in nt and "vegas" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi-vegas-hd/")
        elif "csi" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi/")

        series_url = None
        for u in candidates:
            try:
                r = sess.get(u, timeout=10)
                if r.status_code == 200 and ("-sezon-" in r.text or "-bolum" in r.text) and "Sayfa Bulunamadı" not in r.text:
                    series_url = u
                    break
            except Exception:
                pass

        if not series_url:
            return []

        try:
            r = sess.get(series_url, timeout=10)
            soup = BeautifulSoup(r.text, "html.parser")
            found_ep_links = {}
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if "-bolum" in h:
                    ms = re.search(r"(\d+)-sezon", h)
                    me = re.search(r"(\d+)-bolum", h)
                    s_no = int(ms.group(1)) if ms else 1
                    e_no = int(me.group(1)) if me else 1
                    found_ep_links[(s_no, e_no)] = h
        except Exception:
            return []

        patched = []
        for ep in episodes[:15]:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]
            try:
                r_ep = sess.get(ep_url, timeout=10)
                s_ep = BeautifulSoup(r_ep.text, "html.parser")
                player_src = None
                for fr in s_ep.find_all("iframe"):
                    src = fr.get("src") or ""
                    if "moly.php" in src or "king.php" in src:
                        player_src = src if src.startswith("http") else "https://www.dizibox.live" + src
                        break

                if not player_src:
                    continue

                r_p = sess.get(player_src, headers={"Referer": ep_url}, timeout=10)
                s_p = BeautifulSoup(r_p.text, "html.parser")
                stream_url = None
                for fr in s_p.find_all("iframe"):
                    u = fr.get("src") or ""
                    if u and "googletag" not in u and "convert.php" not in u:
                        stream_url = "https:" + u if u.startswith("//") else u
                        break

                if stream_url:
                    stream_url = repair_url(stream_url)
                    prov = identify_provider(stream_url)
                    patched.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "episode_name": ep["name"],
                        "source_name": "DiziBox Vidmoly",
                        "direct_url": stream_url,
                        "provider": prov,
                        "site": "dizibox"
                    })
            except Exception:
                continue

        return patched

    @staticmethod
    def resolve_animecix(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        5. STRATEJİ: AnimeciX Canlı API Çözücü
        /secure/titles?query=... -> /secure/videos?titleId=... -> Tau Video / Sibnet / Ok.ru akışlarını bağlar.
        """
        if not AES_CIPHER or not cfr:
            return []

        title = drama_info["title"]
        nt = norm_title(title)
        sess = HTTPClient.get_cf_session()

        search_terms = [title]
        if ":" in title:
            prefix_t = title.split(":")[0].strip()
            if prefix_t and prefix_t not in search_terms:
                search_terms.append(prefix_t)
        if " - " in title:
            hyphen_t = re.sub(r"\s*-\s*.*$", "", title).strip()
            if hyphen_t and hyphen_t not in search_terms:
                search_terms.append(hyphen_t)
        clean_movie_t = re.sub(r"\b(Movie\s*\d*|Specials?|OVA|Season\s*\d*|Part\s*\d*)\b", "", title, flags=re.I).strip()
        if clean_movie_t and clean_movie_t not in search_terms:
            search_terms.append(clean_movie_t)
        clean_t = re.sub(r"[\(\)\[\]\:\-\_]", " ", title).strip()
        if clean_t and clean_t not in search_terms:
            search_terms.append(clean_t)

        target_year = str(drama_info.get("year") or "").strip()

        matched_item = None
        for term in search_terms:
            qs = f"query={urllib.parse.quote(term)}&onlyStreamable=true"
            try:
                h = make_animecix_header(qs)
                r = sess.get(f"https://animecix.tv/secure/titles?{qs}", headers={"X-E-H": h, "Accept": "application/json"}, timeout=10)
                if r.status_code == 200:
                    data = r.json().get("pagination", {}).get("data", [])
                    for itm in data:
                        it_norm = norm_title(itm.get("name") or "")
                        it_en = norm_title(itm.get("name_english") or "")
                        it_rom = norm_title(itm.get("name_romanji") or "")
                        it_year = str(itm.get("year") or "").strip()

                        year_match = True
                        if target_year.isdigit() and it_year.isdigit():
                            year_match = abs(int(target_year) - int(it_year)) <= 1

                        clean_norm = norm_title(clean_movie_t)
                        clean_hyphen_t = re.sub(r"\s*-\s*[a-zA-Z0-9\s]+$", "", clean_movie_t).strip()
                        hyphen_norm = norm_title(clean_hyphen_t)

                        exact_m = (nt == it_norm or nt == it_en or nt == it_rom)
                        clean_m = (clean_norm and clean_norm == it_norm and year_match) or (hyphen_norm and hyphen_norm == it_norm and year_match)
                        sub_m = ((nt in it_norm or it_norm in nt) and len(it_norm) >= 8 and year_match)

                        if exact_m or clean_m or sub_m:
                            matched_item = itm
                            break
                if matched_item:
                    break
            except Exception:
                continue

        if not matched_item:
            return []

        title_id = matched_item["id"]
        qs_v = f"titleId={title_id}&page=1&perPage=100"
        try:
            h = make_animecix_header(qs_v)
            r = sess.get(f"https://animecix.tv/secure/videos?{qs_v}", headers={"X-E-H": h, "Accept": "application/json"}, timeout=12)
            if r.status_code != 200:
                return []
            videos = r.json().get("pagination", {}).get("data", [])
        except Exception:
            return []

        videos_by_ep = defaultdict(list)
        for v in videos:
            if v.get("category") == "trailer":
                continue
            s_num = v.get("season_num") or 1
            try:
                e_num = int(v.get("episode_num") or 1)
            except Exception:
                e_num = 1
            v_url = v.get("url") or ""
            if v_url:
                videos_by_ep[(s_num, e_num)].append(v)

        patched = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            alt_key = (1, ep["episode_number"])
            v_list = videos_by_ep.get(key) or videos_by_ep.get(alt_key)
            if not v_list and len(episodes) == 1 and (1, 1) in videos_by_ep:
                # Tek bölümlük film veya OVA
                v_list = videos_by_ep[(1, 1)]

            if not v_list:
                continue

            for v in v_list[:2]:
                d_url = repair_url(v.get("url") or "")
                if d_url:
                    s_name = v.get("name") or "Tau Video"
                    prov = identify_provider(d_url)
                    patched.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "episode_name": ep["name"],
                        "source_name": f"AnimeciX {s_name}",
                        "direct_url": d_url,
                        "provider": prov,
                        "site": "animecix"
                    })

        return patched

    @staticmethod
    def resolve_tranimeizle(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        6. STRATEJİ: TRAnimeİzle Çözücü
        /anime/{slug}-izle -> bölüm linkleri -> iframe embed
        """
        slug = drama_info.get("slug") or ""
        title = drama_info["title"]
        candidates = [
            f"https://www.tranimeizle.live/anime/{clean_slug(slug)}-izle",
            f"https://www.tranimeizle.live/anime/{clean_slug(title)}-izle",
        ]
        u = None
        for cand in candidates:
            try:
                html, final_u = HTTPClient.fetch_text(cand, timeout=8.0)
                if final_u.rstrip("/") == cand.rstrip("/") and "episodeBtn" in html:
                    u = cand
                    break
            except Exception:
                pass

        if not u:
            return []

        try:
            html, _ = HTTPClient.fetch_text(u, timeout=8.0)
            soup = BeautifulSoup(html, "html.parser")
            found_eps = {}
            for li in soup.select("li.episodeBtn"):
                sl = li.get("data-slug")
                if sl:
                    me = re.search(r"-(\d+)-bolum-izle", sl)
                    if me:
                        found_eps[(1, int(me.group(1)))] = f"https://www.tranimeizle.live/{sl}"
        except Exception:
            return []

        patched = []
        for ep in episodes[:15]:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_eps:
                continue
            ep_url = found_eps[key]
            try:
                e_html, _ = HTTPClient.fetch_text(ep_url, referer=u, timeout=8.0)
                iframes = [fr.get("src") for fr in BeautifulSoup(e_html, "html.parser").find_all("iframe") if fr.get("src")]
                for ifr in iframes:
                    if ifr and "googletag" not in ifr:
                        d_url = repair_url(ifr)
                        prov = identify_provider(d_url)
                        patched.append({
                            "episode_id": ep["id"],
                            "season_number": ep["season_number"],
                            "episode_number": ep["episode_number"],
                            "episode_name": ep["name"],
                            "source_name": "TRAnimeizle",
                            "direct_url": d_url,
                            "provider": prov,
                            "site": "tranimeizle"
                        })
                        break
            except Exception:
                continue

        return patched


# ==============================================================================
# SUPABASE SENKRONİZASYON MOTORU
# ==============================================================================

def sync_episodes_to_supabase(repaired_episodes: list[dict]) -> int:
    """
    Onarılan bölümleri ve video_sources dizisini Supabase episodes tablosuna upsert eder.
    rpc/sync_repaired_episode_sources çağrısıyla media tablosunu da otomatik günceller.
    """
    if not repaired_episodes or not requests:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }

    # Bölümlere göre grupla
    ep_grouped = defaultdict(lambda: {"video_sources": []})
    for r in repaired_episodes:
        key = (r["media_id"], r["season_number"], r["episode_number"])
        ep_grouped[key]["media_id"] = r["media_id"]
        ep_grouped[key]["season_number"] = r["season_number"]
        ep_grouped[key]["episode_number"] = r["episode_number"]
        ep_grouped[key]["episode_name"] = r.get("episode_name") or f"{r['episode_number']}. Bölüm"
        ep_grouped[key]["episode_type"] = "bolum"

        s_obj = {
            "source_name": r["source_name"],
            "provider": r["provider"],
            "direct_url": r["direct_url"],
            "embed_id": r["embed_id"],
            "site": r["site"],
            "fansub": None,
            "stream_type": "hls" if ".m3u8" in r["direct_url"] else "locked_iframe",
            "quality_label": "1080p"
        }
        ep_grouped[key]["video_sources"].append(s_obj)

    payload_rows = list(ep_grouped.values())

    total_synced = 0
    batch_size = 50
    for i in range(0, len(payload_rows), batch_size):
        chunk = payload_rows[i:i + batch_size]
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/sync_repaired_episode_sources",
                headers=headers,
                json={"p_episodes": chunk},
                timeout=20
            )
            if resp.status_code == 200:
                count = int(resp.text or len(chunk))
                total_synced += count
            else:
                print(f"   ⚠️ Supabase RPC Uyarı: {resp.status_code} {resp.text[:120]}")
        except Exception as e:
            print(f"   ⚠️ Supabase RPC Bağlantı Hatası: {e}")

    return total_synced


# ==============================================================================
# ANA YÜRÜTÜCÜ (MAIN RESTORATION RUNNER)
# ==============================================================================

def run_restoration(
    batch_size: int = 15,
    drama_id: int = None,
    offset: int = 0,
    site_filter: str = "all",
    apply_db: bool = True,
    sync_supabase: bool = True,
    audit_report_path: str = DEFAULT_AUDIT_REPORT,
    output_json: str = DEFAULT_OUTPUT_JSON,
    output_md: str = DEFAULT_OUTPUT_MD,
):
    start_time = time.time()
    os.makedirs(REPORTS_DIR, exist_ok=True)

    print("=" * 78)
    print("      🛠️ KoUp Hedefe Yönelik Sıfır Kaynaklı Dizi Onarım Motoru")
    print("=" * 78)
    print(f"📁 SQLite DB        : {DB_PATH}")
    print(f"📑 Girdi Raporu     : {audit_report_path}")
    print(f"⚙️ Parametreler     : batch={batch_size}, drama_id={drama_id}, apply_db={apply_db}, sync_sb={sync_supabase}, site={site_filter}")

    if not os.path.exists(DB_PATH):
        print(f"❌ HATA: SQLite veritabanı bulunamadı: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()

    if not os.path.exists(audit_report_path):
        print(f"❌ HATA: Denetim raporu bulunamadı: {audit_report_path}")
        return

    with open(audit_report_path, "r", encoding="utf-8") as f:
        audit_data = json.load(f)

    zero_list = audit_data.get("zero_source_dramas", [])
    print(f"📊 Sıfır Kaynaklı Toplam Havuz: {len(zero_list):,} adet dizi")

    # Filtreleme
    if drama_id is not None:
        target_dramas = [d for d in zero_list if d["id"] == drama_id]
        if not target_dramas:
            cur.execute("SELECT id, title, country, release_year, content_type, slug, source_url FROM dramas WHERE id = ?", (drama_id,))
            r = cur.fetchone()
            if r:
                target_dramas = [{
                    "id": r[0], "title": r[1], "country": r[2] or "??", "year": r[3] or "",
                    "type": r[4] or "dizi", "slug": r[5] or "", "source_url": r[6] or ""
                }]
    else:
        # Öncelikli sıralama: bölüm sayısı > 0 olanları al
        with_eps = [d for d in zero_list if d.get("total_episodes", 0) > 0]
        target_dramas = with_eps[offset : offset + batch_size]

    print(f"🎯 Bu İşlemde Taranacak Dizi Sayısı: {len(target_dramas)} adet\n")

    results_report = []
    total_sources_added = 0
    total_episodes_synced_sb = 0
    provider_counts = Counter()

    for idx, d_item in enumerate(target_dramas, 1):
        d_id = d_item["id"]
        title = d_item["title"]
        country = (d_item.get("country") or "??").upper()
        year = d_item.get("year") or ""
        ctype = d_item.get("type") or "dizi"

        cur.execute("SELECT slug, source_url, alt_sites, anilist_id, imdb_id FROM dramas WHERE id = ?", (d_id,))
        r_info = cur.fetchone()
        slug = r_info[0] if r_info else d_item.get("slug", "")
        source_url = r_info[1] if r_info else d_item.get("source_url", "")
        alt_sites_json = r_info[2] if r_info else "[]"
        anilist_id = r_info[3] if r_info else None
        imdb_id = r_info[4] if r_info else None

        try:
            alt_sites_list = json.loads(alt_sites_json or "[]")
        except Exception:
            alt_sites_list = []

        drama_info = {
            "id": d_id,
            "title": title,
            "slug": slug,
            "source_url": source_url,
            "country": country,
            "year": year,
            "type": ctype,
            "anilist_id": anilist_id,
            "imdb_id": imdb_id,
            "alt_sites": alt_sites_list
        }

        # Bölümleri çek
        cur.execute("""
            SELECT id, season_number, episode_number, episode_name, episode_url
            FROM episodes
            WHERE drama_id = ?
            ORDER BY season_number ASC, episode_number ASC;
        """, (d_id,))
        episodes = [
            {"id": row[0], "season_number": row[1], "episode_number": row[2], "name": row[3], "url": row[4]}
            for row in cur.fetchall()
        ]

        print(f"[{idx}/{len(target_dramas)}] ID: {d_id:<6} | {title[:32]:<32} | {country:<2} | {year:<4} | {len(episodes)} bölüm")

        collected_sources = []
        strategy_used = None

        # 1. Kardeş / Arşiv İçi Eşlenik
        if site_filter in ("all", "sibling"):
            sib_sources = RestorationResolvers.resolve_sibling(cur, d_id, drama_info, episodes)
            if sib_sources:
                collected_sources.extend(sib_sources)
                strategy_used = "Arşiv Kardeş Kayıt (Sibling Sync)"

        # 2. Anime Sağlayıcıları
        if not collected_sources and (ctype == "anime" or country == "JP"):
            if site_filter in ("all", "animecix"):
                ac_sources = RestorationResolvers.resolve_animecix(drama_info, episodes)
                if ac_sources:
                    collected_sources.extend(ac_sources)
                    strategy_used = "AnimeciX Canlı API"

            if not collected_sources and site_filter in ("all", "tranimeizle"):
                ta_sources = RestorationResolvers.resolve_tranimeizle(drama_info, episodes)
                if ta_sources:
                    collected_sources.extend(ta_sources)
                    strategy_used = "TRAnimeizle Canlı Akış"

        # 3. K-Drama / Asya Sağlayıcıları (WebDramaTurkey)
        if not collected_sources and country in ("KR", "CN", "TH", "TW", "HK", "PH"):
            if site_filter in ("all", "webdramaturkey"):
                wdt_sources = RestorationResolvers.resolve_webdramaturkey(drama_info, episodes)
                if wdt_sources:
                    collected_sources.extend(wdt_sources)
                    strategy_used = "WebDramaTurkey Canlı Akış"

            if not collected_sources and site_filter in ("all", "diziyou"):
                dy_sources = RestorationResolvers.resolve_diziyou(drama_info, episodes)
                if dy_sources:
                    collected_sources.extend(dy_sources)
                    strategy_used = "DiziYou HLS Canlı"

        # 4. Batı / Global / Cartoon Sağlayıcıları (DiziBox, DiziYou)
        if not collected_sources:
            if site_filter in ("all", "dizibox"):
                db_sources = RestorationResolvers.resolve_dizibox(drama_info, episodes)
                if db_sources:
                    collected_sources.extend(db_sources)
                    strategy_used = "DiziBox Vidmoly/Moly"

            if not collected_sources and site_filter in ("all", "diziyou"):
                dy_sources = RestorationResolvers.resolve_diziyou(drama_info, episodes)
                if dy_sources:
                    collected_sources.extend(dy_sources)
                    strategy_used = "DiziYou HLS Canlı"

        # SQLite Veritabanına Yazma
        sources_written = 0
        repaired_for_supabase = []

        if collected_sources and apply_db:
            new_sites = set(alt_sites_list)
            for s in collected_sources:
                ep_id = s["episode_id"]
                s_name = s["source_name"]
                d_url = s["direct_url"]
                prov = s["provider"]
                site = s["site"]
                new_sites.add(site)

                embed_id = f"p_{site[:2]}_{hashlib.md5(d_url.encode()).hexdigest()[:10]}"
                cur.execute("""
                    INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                        direct_url = excluded.direct_url,
                        provider = excluded.provider,
                        source_name = excluded.source_name,
                        site = excluded.site;
                """, (ep_id, s_name, embed_id, d_url, prov, site))
                sources_written += 1
                provider_counts[prov] += 1

                repaired_for_supabase.append({
                    "media_id": d_id,
                    "season_number": s["season_number"],
                    "episode_number": s["episode_number"],
                    "episode_name": s.get("episode_name") or f"{s['episode_number']}. Bölüm",
                    "source_name": s_name,
                    "provider": prov,
                    "direct_url": d_url,
                    "embed_id": embed_id,
                    "site": site
                })

            # Dizinin toplam kaynak sayısını ve alt_sites etiketini güncelle
            cur.execute("""
                UPDATE dramas
                SET sources_count = (
                    SELECT count(*)
                    FROM episode_sources es
                    JOIN episodes e ON e.id = es.episode_id
                    WHERE e.drama_id = ? AND es.direct_url != 'dead' AND es.direct_url IS NOT NULL
                ),
                alt_sites = ?
                WHERE id = ?;
            """, (d_id, json.dumps(sorted(list(new_sites))), d_id))
            conn.commit()

        elif collected_sources:
            # Kuru çalıştırma
            sources_written = len(collected_sources)
            for s in collected_sources:
                provider_counts[s["provider"]] += 1

        total_sources_added += sources_written

        # Supabase Senkronizasyonu
        sb_synced_this = 0
        if repaired_for_supabase and sync_supabase:
            sb_synced_this = sync_episodes_to_supabase(repaired_for_supabase)
            total_episodes_synced_sb += sb_synced_this

        status_msg = f"✅ {sources_written} canlı kaynak eklendi ({strategy_used})" if sources_written > 0 else "❌ Eşleşen kaynak bulunamadı"
        if sb_synced_this > 0:
            status_msg += f" | Supabase: +{sb_synced_this} bölüm"
        print(f"   ↳ {status_msg}")

        sample_src = collected_sources[0]["direct_url"] if collected_sources else None
        results_report.append({
            "drama_id": d_id,
            "title": title,
            "country": country,
            "year": year,
            "type": ctype,
            "episodes_count": len(episodes),
            "sources_added": sources_written,
            "supabase_synced": sb_synced_this,
            "strategy": strategy_used or "None",
            "sample_source": sample_src,
        })

    conn.close()

    elapsed = time.time() - start_time
    success_dramas = sum(1 for r in results_report if r["sources_added"] > 0)

    # JSON Raporu
    report_json_data = {
        "execution_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_seconds": round(elapsed, 2),
        "total_dramas_processed": len(target_dramas),
        "successful_dramas": success_dramas,
        "failed_dramas": len(target_dramas) - success_dramas,
        "total_sources_added": total_sources_added,
        "total_episodes_synced_supabase": total_episodes_synced_sb,
        "apply_db": apply_db,
        "sync_supabase": sync_supabase,
        "provider_breakdown": dict(provider_counts),
        "results": results_report,
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(report_json_data, f, ensure_ascii=False, indent=2)

    # Markdown Raporu
    md_lines = [
        "# 🚀 KoUp Sıfır Kaynaklı Dizi Onarım Raporu (Zero-Source Restoration Report)",
        f"**Tarih:** {time.strftime('%Y-%m-%d %H:%M:%S')}  ",
        f"**İşlem Süresi:** {elapsed:.2f} saniye  ",
        f"**Veritabanı Durumu:** {'💾 SQLite Uygulandı' if apply_db else '🧪 Dry-Run'}  ",
        f"**Supabase Senkronizasyonu:** {'☁️ Başarılı' if sync_supabase else 'Kapalı'}  ",
        "",
        "## 📊 Özet Metrikler",
        f"- **İncelenen Dizi Sayısı:** {len(target_dramas):,} adet",
        f"- **Başarıyla Onarılan Dizi:** {success_dramas:,} adet (%{(success_dramas/max(len(target_dramas),1))*100:.1f})",
        f"- **SQLite'a Eklenen Canlı Kaynak:** {total_sources_added:,} adet",
        f"- **Supabase'e Aktarılan Bölüm:** {total_episodes_synced_sb:,} adet",
        "",
        "## 🌐 Sağlayıcı ve Akış Dağılımı",
    ]
    for prov, count in provider_counts.most_common():
        md_lines.append(f"- **{prov:18}:** {count:,} kaynak")

    md_lines.extend([
        "",
        "## 📋 Detaylı Onarım Tablosu",
        "| ID | Başlık | Ülke | Yıl | Bölüm | Eklenen Kaynak | Supabase | Kullanılan Strateji |",
        "|:---|:---|:---:|:---:|:---:|:---:|:---:|:---|",
    ])
    for r in results_report:
        md_lines.append(
            f"| `{r['drama_id']}` | **{r['title']}** | {r['country']} | {r['year']} | {r['episodes_count']} | **+{r['sources_added']}** | {'✅' if r['supabase_synced'] > 0 else '—'} | {r['strategy']} |"
        )

    with open(output_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print("\n" + "=" * 78)
    print(f"🎉 Onarım Tamamlandı: {success_dramas}/{len(target_dramas)} dizi başarıyla onarıldı!")
    print(f"📊 Toplam Eklenen Kaynak : {total_sources_added} adet")
    print(f"☁️ Supabase Senkronize   : {total_episodes_synced_sb} bölüm")
    print(f"📄 JSON Raporu          : {output_json}")
    print(f"📄 Markdown Raporu      : {output_md}")
    print("=" * 78)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KoUp Zero-Source Video Restoration Script")
    parser.add_argument("--batch-size", type=int, default=15, help="İşlenecek dizi sayısı (varsayılan: 15)")
    parser.add_argument("--drama-id", type=int, default=None, help="Yalnızca belirli bir dizi ID'sini onar")
    parser.add_argument("--offset", type=int, default=0, help="Sıfır kaynaklı listede başlama ofseti")
    parser.add_argument("--site", type=str, default="all", choices=["all", "webdramaturkey", "diziyou", "dizibox", "animecix", "tranimeizle", "sibling"], help="Hedef sağlayıcı filtresi")
    parser.add_argument("--no-db", action="store_true", help="SQLite veritabanına yazmayı devre dışı bırak (kuru çalıştırma)")
    parser.add_argument("--no-supabase", action="store_true", help="Supabase senkronizasyonunu devre dışı bırak")
    parser.add_argument("--audit-report", type=str, default=DEFAULT_AUDIT_REPORT, help="Girdi audit raporu JSON yolu")
    parser.add_argument("--output-json", type=str, default=DEFAULT_OUTPUT_JSON, help="Çıktı JSON rapor yolu")
    parser.add_argument("--output-md", type=str, default=DEFAULT_OUTPUT_MD, help="Çıktı Markdown rapor yolu")

    args = parser.parse_args()

    run_restoration(
        batch_size=args.batch_size,
        drama_id=args.drama_id,
        offset=args.offset,
        site_filter=args.site,
        apply_db=not args.no_db,
        sync_supabase=not args.no_supabase,
        audit_report_path=args.audit_report,
        output_json=args.output_json,
        output_md=args.output_md,
    )
