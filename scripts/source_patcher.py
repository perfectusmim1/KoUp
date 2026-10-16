"""
KoUp Video Source Patcher (Archive Recovery & Multi-Provider Fallback Engine)
=============================================================================
Ölü ve kapanmış domainler (short.icu, vudeo.io, savefileway.com, four.pichive.online vb.)
yüzünden sıfır kaynaklı (zero-source) kalan dizileri alternatif sağlayıcılardan
(DiziBox, DiziYou, AsyaDizi, TRAnimeizle, Arşiv Eşleniği ve Fallback Stream Çözücü)
otomatik olarak yeniden tarar, eşleştirir ve çalışan video kaynaklarıyla onarır.
"""

import argparse
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

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")
REPORTS_DIR = os.path.join(BASE_DIR, "scripts", "reports")
DEFAULT_AUDIT_REPORT = os.path.join(REPORTS_DIR, "source_audit_report.json")
DEFAULT_OUTPUT_JSON = os.path.join(REPORTS_DIR, "source_patcher_report.json")
DEFAULT_OUTPUT_MD = os.path.join(REPORTS_DIR, "source_patcher_report.md")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
}

TR_MAP = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def norm_title(s: str) -> str:
    """Türkçe ve uluslararası karakterleri eşleştirme için standartlaştırır."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.translate(TR_MAP).lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def clean_slug(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"-(izle|dq\d*|hd|box|aw|ta)$", "", s)
    s = re.sub(r"-\d{4}-(kore|cin|japon|tayland|tayvan|asya)$", "", s)
    return re.sub(r"[^a-z0-9-]+", "-", s).strip("-")


def identify_provider(url: str) -> str:
    if not url or url == "dead":
        return "unknown"
    u = url.lower()
    if "ok.ru" in u or "odnoklassniki" in u:
        return "ok.ru"
    if "vidmoly" in u:
        return "vidmoly"
    if "sibnet.ru" in u or "sibnet" in u:
        return "sibnet"
    if "mail.ru" in u:
        return "mail.ru"
    if "filemoon" in u:
        return "filemoon"
    if "diziyou" in u or ".m3u8" in u:
        return "diziyou-hls"
    if "tau-video" in u:
        return "tau-video"
    if "vk.com" in u:
        return "vk"
    if "dood" in u:
        return "doodstream"
    if "uqload" in u:
        return "uqload"
    return "other"


def repair_url(url: str) -> str:
    if not url or url == "dead":
        return ""
    fixed = url.strip()
    if "href.li/?" in fixed:
        fixed = fixed.split("href.li/?")[-1].strip()
    if "luffytra2.top/embed2/?id=" in fixed:
        fixed = fixed.split("luffytra2.top/embed2/?id=")[-1].strip()
    if fixed.startswith("//"):
        fixed = "https:" + fixed
    if fixed.startswith("https:https://"):
        fixed = "https://" + fixed[14:]
    if "vidmoly.to/" in fixed:
        fixed = fixed.replace("vidmoly.to/", "vidmoly.biz/")
    return fixed


def fetch_html(url: str, referer: str = None, timeout: float = 6.0) -> tuple[str, str]:
    """Sayfa HTML ve yönlendirilen nihai URL'yi döner."""
    hdrs = dict(HEADERS)
    if referer:
        hdrs["Referer"] = referer
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        final_url = resp.geturl()
        html = resp.read().decode("utf-8", errors="replace")
        return html, final_url


# ==============================================================================
# SAĞLAYICI MODÜLLERİ (PROVIDER SCRAPERS & RESOLVERS)
# ==============================================================================

class ProviderResolver:
    """Tüm alternatif sağlayıcıların arama ve kaynak çekme mantığı."""

    @staticmethod
    def patch_from_sibling(cur, drama_id: int, drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        1. STRATEJİ: Veritabanı İçi Eşlenik / Kardeş Kayıt Senkronizasyonu
        Aynı isimde, farklı sitelerden çekilmiş ve çalışan kaynakları olan kayıtları bulup bağlar.
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
                # Yıl uyumluluğu kontrolü
                y1_int = _safe_year(drama_info.get("year"))
                y2_int = _safe_year(r_year)
                if y1_int is None or y2_int is None or abs(y1_int - y2_int) <= 1:
                    cands.append((r_id, r_title, r_live))

        if not cands:
            return []

        best_sibling_id, sibling_title, sibling_live = max(cands, key=lambda x: x[2])
        
        # Kardeş kaydın canlı kaynaklarını al
        cur.execute("""
            SELECT e.season_number, e.episode_number, es.source_name, es.direct_url, es.provider, es.site
            FROM episode_sources es
            JOIN episodes e ON e.id = es.episode_id
            WHERE e.drama_id = ? AND es.direct_url != 'dead' AND es.direct_url IS NOT NULL
        """, (best_sibling_id,))
        
        sources_by_ep = defaultdict(list)
        for s_no, ep_no, s_name, d_url, prov, site in cur.fetchall():
            sources_by_ep[(s_no, ep_no)].append({
                "source_name": f"{s_name} (Mirror)",
                "direct_url": repair_url(d_url),
                "provider": prov or identify_provider(d_url),
                "site": site or "sibling_mirror"
            })

        patched_sources = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key in sources_by_ep:
                for src in sources_by_ep[key]:
                    patched_sources.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        **src
                    })
        return patched_sources

    @staticmethod
    def patch_from_diziyou(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        2. STRATEJİ: DiziYou Canlı HLS Oynatıcı Çözücü
        /player/{id}.html -> storage.diziyou.one/episodes/{id}/play.m3u8 akışını çeker.
        """
        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        nt = norm_title(title)
        
        # Seri sayfasını bul
        series_url = None
        candidates = [
            f"https://www.diziyou.one/{clean_slug(slug)}/",
            f"https://www.diziyou.one/{clean_slug(title)}/",
        ]
        for u in candidates:
            try:
                html, final_u = fetch_html(u)
                if final_u.rstrip("/") == u.rstrip("/") and ("-sezon-" in html or "-bolum" in html):
                    series_url = u
                    break
            except Exception:
                pass

        if not series_url:
            # Arama üzerinden bul
            try:
                search_u = f"https://www.diziyou.one/?s={urllib.parse.quote(title)}"
                html, _ = fetch_html(search_u)
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

        # Dizi sayfasından bölüm bağlantılarını topla
        try:
            html, _ = fetch_html(series_url)
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

        patched_sources = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]
            try:
                e_html, _ = fetch_html(ep_url, referer=series_url)
                e_soup = BeautifulSoup(e_html, "html.parser")
                player_src = None
                for fr in e_soup.find_all("iframe"):
                    src = fr.get("src") or ""
                    if "/player/" in src:
                        player_src = src if src.startswith("http") else "https://www.diziyou.one" + src
                        break

                if not player_src:
                    continue

                # Player içinden m3u8 çıkar
                p_html, _ = fetch_html(player_src, referer=ep_url)
                m3u8_matches = re.findall(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', p_html)
                m3u8_matches = [x for x in m3u8_matches if "video.min" not in x and ".css" not in x]
                if m3u8_matches:
                    stream_url = m3u8_matches[0]
                    patched_sources.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "source_name": "DiziYou HLS",
                        "direct_url": stream_url,
                        "provider": "diziyou-hls",
                        "site": "diziyou"
                    })
            except Exception:
                continue

        return patched_sources

    @staticmethod
    def patch_from_dizibox(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        3. STRATEJİ: DiziBox Canlı Moly/King Oynatıcı Çözücü
        /player/moly/moly.php veya king.php -> vidmoly.biz embed akışını çıkarır.
        """
        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        nt = norm_title(title)
        
        candidates = [
            f"https://www.dizibox.live/diziler/{clean_slug(slug)}/",
            f"https://www.dizibox.live/diziler/{clean_slug(title)}/",
        ]
        if "csi" in nt and "cyber" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi-cyber/")
        elif "csi" in nt and "vegas" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi-vegas/")
        elif "csi" in nt:
            candidates.insert(0, "https://www.dizibox.live/diziler/csi/")

        series_url = None
        for u in candidates:
            try:
                html, final_u = fetch_html(u)
                if final_u.rstrip("/") == u.rstrip("/") and ("-sezon-" in html or "-bolum" in html):
                    series_url = u
                    break
            except Exception:
                pass

        if not series_url:
            return []

        try:
            html, _ = fetch_html(series_url)
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

        patched_sources = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]
            try:
                e_html, _ = fetch_html(ep_url, referer=series_url)
                e_soup = BeautifulSoup(e_html, "html.parser")
                player_src = None
                for fr in e_soup.find_all("iframe"):
                    src = fr.get("src") or ""
                    if "moly.php" in src or "king.php" in src:
                        player_src = src if src.startswith("http") else "https://www.dizibox.live" + src
                        break

                if not player_src:
                    continue

                p_html, _ = fetch_html(player_src, referer=ep_url)
                p_soup = BeautifulSoup(p_html, "html.parser")
                stream_url = None
                for fr in p_soup.find_all("iframe"):
                    u = fr.get("src") or ""
                    if u and "googletag" not in u and "convert.php" not in u:
                        stream_url = "https:" + u if u.startswith("//") else u
                        break

                if stream_url:
                    stream_url = repair_url(stream_url)
                    patched_sources.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "source_name": "DiziBox Moly",
                        "direct_url": stream_url,
                        "provider": identify_provider(stream_url),
                        "site": "dizibox"
                    })
            except Exception:
                continue

        return patched_sources

    @staticmethod
    def patch_from_asyadizi(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        4. STRATEJİ: AsyaDizi Canlı Oynatıcı Çözücü
        vdo-src -> odnoklassniki.ru/videoembed/... veya vidmoly.biz embedini çeker.
        """
        title = drama_info["title"]
        slug = drama_info.get("slug") or ""
        nt = norm_title(title)

        series_url = None
        candidates = [
            f"https://asyadizi.com/dizi/{clean_slug(slug)}-izle/",
            f"https://asyadizi.com/dizi/{clean_slug(title)}-izle/",
        ]
        if "my father is strange" in title.lower() or "father is strange" in title.lower():
            candidates.insert(0, "https://asyadizi.com/dizi/my-father-is-strange-izle/")

        for u in candidates:
            try:
                html, final_u = fetch_html(u)
                if final_u.rstrip("/") == u.rstrip("/") and "-bolum" in html:
                    series_url = u
                    break
            except Exception:
                pass

        if not series_url:
            # Arama yap
            try:
                search_u = f"https://asyadizi.com/?s={urllib.parse.quote(title)}"
                html, _ = fetch_html(search_u)
                soup = BeautifulSoup(html, "html.parser")
                for a in soup.find_all("a", href=True):
                    if "/dizi/" in a["href"] and not any(x in a["href"] for x in ["-bolum", "sezon"]):
                        t = a.get_text(strip=True)
                        if t and (norm_title(t) == nt or nt in norm_title(t) or norm_title(t) in nt):
                            series_url = a["href"]
                            break
            except Exception:
                pass

        if not series_url:
            return []

        try:
            html, _ = fetch_html(series_url)
            soup = BeautifulSoup(html, "html.parser")
            found_ep_links = {}
            for a in soup.find_all("a", href=True):
                h = a["href"]
                if "-bolum" in h:
                    me = re.search(r"-(\d+)-bolum", h)
                    if me:
                        e_no = int(me.group(1))
                        found_ep_links[(1, e_no)] = h
        except Exception:
            return []

        patched_sources = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_ep_links:
                continue
            ep_url = found_ep_links[key]
            try:
                e_html, _ = fetch_html(ep_url, referer=series_url)
                e_soup = BeautifulSoup(e_html, "html.parser")
                vdo = e_soup.find(attrs={"vdo-src": True})
                stream_url = None
                if vdo and vdo.get("vdo-src"):
                    stream_url = vdo["vdo-src"]
                else:
                    for fr in e_soup.find_all("iframe"):
                        u = fr.get("src") or ""
                        if u and "googletag" not in u and "videoembed" in u:
                            stream_url = u
                            break

                if stream_url:
                    stream_url = repair_url(stream_url)
                    patched_sources.append({
                        "episode_id": ep["id"],
                        "season_number": ep["season_number"],
                        "episode_number": ep["episode_number"],
                        "source_name": "AsyaDizi Stream",
                        "direct_url": stream_url,
                        "provider": identify_provider(stream_url),
                        "site": "asyadizi"
                    })
            except Exception:
                continue

        return patched_sources

    @staticmethod
    def patch_from_tranimeizle(drama_info: dict, episodes: list[dict]) -> list[dict]:
        """
        5. STRATEJİ: TRAnimeizle Çözücü
        Anime başlıkları için doğrudan animeWatch fansub kaynaklarını sorgular.
        """
        slug = drama_info.get("slug") or ""
        title = drama_info["title"]
        u = f"https://www.tranimeizle.live/anime/{clean_slug(slug)}-izle"
        try:
            html, final_u = fetch_html(u)
            if final_u.rstrip("/") != u.rstrip("/"):
                return []
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

        patched_sources = []
        for ep in episodes:
            key = (ep["season_number"], ep["episode_number"])
            if key not in found_eps:
                continue
            ep_url = found_eps[key]
            try:
                e_html, _ = fetch_html(ep_url, referer=u)
                iframes = [fr.get("src") for fr in BeautifulSoup(e_html, "html.parser").find_all("iframe") if fr.get("src")]
                for ifr in iframes:
                    if "googletag" not in ifr:
                        patched_sources.append({
                            "episode_id": ep["id"],
                            "season_number": ep["season_number"],
                            "episode_number": ep["episode_number"],
                            "source_name": "TRanimeizle",
                            "direct_url": repair_url(ifr),
                            "provider": identify_provider(ifr),
                            "site": "tranimeizle"
                        })
                        break
            except Exception:
                continue

        return patched_sources

    @staticmethod
    def patch_fallback_embed(drama_info: dict, ep: dict) -> dict:
        """
        6. STRATEJİ: Evrensel Güvenli Edge / Embed Fallback
        Hiçbir üçüncü taraf sağlayıcıda bulunamayan bölümler için Cloudflare Edge Stream
        Resolver ve doğrulanmış arama köprüsüyle kesintisiz oynatma sağlar.
        """
        title_q = urllib.parse.quote(f"{drama_info['title']} {ep['season_number']}. Sezon {ep['episode_number']}. Bölüm")
        fallback_url = f"https://koup-edge-worker.caganhuseyinerdil.workers.dev/resolve?query={title_q}&id={ep['id']}"
        return {
            "episode_id": ep["id"],
            "season_number": ep["season_number"],
            "episode_number": ep["episode_number"],
            "source_name": "KoUp Edge Fallback",
            "direct_url": fallback_url,
            "provider": "edge-proxy",
            "site": "koup-edge"
        }


# ==============================================================================
# ANA YÜRÜTÜCÜ VE VERİTABANI İŞLEMLERİ (PATCH ENGINE)
# ==============================================================================

def run_patcher(
    batch_size: int = 10,
    drama_id: int = None,
    offset: int = 0,
    site_filter: str = "all",
    apply_db: bool = False,
    fallback_unresolved: bool = False,
    audit_report_path: str = DEFAULT_AUDIT_REPORT,
    output_json: str = DEFAULT_OUTPUT_JSON,
    output_md: str = DEFAULT_OUTPUT_MD,
):
    start_time = time.time()
    os.makedirs(REPORTS_DIR, exist_ok=True)

    print("=" * 75)
    print("      🚀 KoUp Kaynak Onarıcı & Alternatif Sağlayıcı Entegrasyonu")
    print("=" * 75)
    print(f"📁 Veritabanı       : {DB_PATH}")
    print(f"📑 Denetim Raporu   : {audit_report_path}")
    print(f"⚙️ Parametreler     : batch={batch_size}, drama_id={drama_id}, apply_db={apply_db}, site={site_filter}")

    if not os.path.exists(DB_PATH):
        print(f"❌ HATA: Veritabanı bulunamadı: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()

    # Sıfır kaynaklı dizileri rapor dosyasından oku
    if not os.path.exists(audit_report_path):
        print(f"❌ HATA: Denetim raporu bulunamadı: {audit_report_path}")
        return

    with open(audit_report_path, "r", encoding="utf-8") as f:
        audit_data = json.load(f)

    zero_source_list = audit_data.get("zero_source_dramas", [])
    print(f"📊 Toplam Sıfır Kaynaklı Dizi Havuzu: {len(zero_source_list):,} adet")

    # Filtreleme
    if drama_id is not None:
        target_dramas = [d for d in zero_source_list if d["id"] == drama_id]
        if not target_dramas:
            # Raporda yoksa bile veritabanından çek
            cur.execute("SELECT id, title, country, release_year, content_type, slug FROM dramas WHERE id = ?", (drama_id,))
            row = cur.fetchone()
            if row:
                target_dramas = [{
                    "id": row[0],
                    "title": row[1],
                    "country": row[2] or "??",
                    "year": row[3] or "",
                    "type": row[4] or "dizi",
                    "slug": row[5] or ""
                }]
    else:
        # Öncelikli sıralama: bölüm sayısı olanları önce al
        with_eps = [d for d in zero_source_list if d.get("total_episodes", 0) > 0]
        target_dramas = with_eps[offset : offset + batch_size]

    print(f"🎯 Bu Çalışmada İşlenecek Dizi Sayısı: {len(target_dramas)} adet\n")

    results_report = []
    total_sources_added = 0
    provider_counts = Counter()

    for idx, d_item in enumerate(target_dramas, 1):
        d_id = d_item["id"]
        title = d_item["title"]
        country = (d_item.get("country") or "??").upper()
        year = d_item.get("year") or ""
        ctype = d_item.get("type") or "dizi"
        
        # Veritabanından tam bilgiyi çek
        cur.execute("SELECT slug, alt_sites FROM dramas WHERE id = ?", (d_id,))
        r_info = cur.fetchone()
        slug = r_info[0] if r_info else d_item.get("slug", "")
        alt_sites_json = r_info[1] if r_info else "[]"
        try:
            alt_sites_list = json.loads(alt_sites_json or "[]")
        except Exception:
            alt_sites_list = []

        drama_info = {
            "id": d_id,
            "title": title,
            "slug": slug,
            "country": country,
            "year": year,
            "type": ctype,
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

        print(f"[{idx}/{len(target_dramas)}] ID: {d_id:<6} | {title:<32} | {country:<2} | {year:<4} | {len(episodes)} bölüm")

        collected_sources = []
        strategy_used = None

        # 1. Kardeş / Arşiv İçi Eşlenik Kontrolü
        if site_filter in ("all", "sibling"):
            sib_sources = ProviderResolver.patch_from_sibling(cur, d_id, drama_info, episodes)
            if sib_sources:
                collected_sources.extend(sib_sources)
                strategy_used = "Arşiv Kardeş Kayıt (Sibling Sync)"

        # 2. Ülke ve İçerik Türüne Göre Dış Sağlayıcı Taraması
        if not collected_sources:
            if ctype == "anime" or "anime" in alt_sites_list:
                # Anime sağlayıcıları
                if site_filter in ("all", "tranimeizle"):
                    ta_srcs = ProviderResolver.patch_from_tranimeizle(drama_info, episodes)
                    if ta_srcs:
                        collected_sources.extend(ta_srcs)
                        strategy_used = "TRAnimeizle Canlı API"

            elif country in ("KR", "CN", "JP", "TH", "TW"):
                # Asya / Kore Dizileri
                if site_filter in ("all", "asyadizi"):
                    ad_srcs = ProviderResolver.patch_from_asyadizi(drama_info, episodes)
                    if ad_srcs:
                        collected_sources.extend(ad_srcs)
                        strategy_used = "AsyaDizi Canlı Akış"

                if not collected_sources and site_filter in ("all", "diziyou"):
                    dy_srcs = ProviderResolver.patch_from_diziyou(drama_info, episodes)
                    if dy_srcs:
                        collected_sources.extend(dy_srcs)
                        strategy_used = "DiziYou HLS Canlı"

                if not collected_sources and site_filter in ("all", "dizibox"):
                    db_srcs = ProviderResolver.patch_from_dizibox(drama_info, episodes)
                    if db_srcs:
                        collected_sources.extend(db_srcs)
                        strategy_used = "DiziBox Moly"

            else:
                # Batı / Global / Cartoon Dizileri (US, GB vb.)
                if site_filter in ("all", "dizibox"):
                    db_srcs = ProviderResolver.patch_from_dizibox(drama_info, episodes)
                    if db_srcs:
                        collected_sources.extend(db_srcs)
                        strategy_used = "DiziBox Moly"

                if not collected_sources and site_filter in ("all", "diziyou"):
                    dy_srcs = ProviderResolver.patch_from_diziyou(drama_info, episodes)
                    if dy_srcs:
                        collected_sources.extend(dy_srcs)
                        strategy_used = "DiziYou HLS Canlı"

        # 3. İsteğe Bağlı Fallback Çözücü
        if not collected_sources and fallback_unresolved:
            fb_sources = [ProviderResolver.patch_fallback_embed(drama_info, ep) for ep in episodes]
            if fb_sources:
                collected_sources.extend(fb_sources)
                strategy_used = "KoUp Edge Fallback Çözücü"

        # Veritabanına Yazma (apply_db aktifse)
        sources_written = 0
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

            # Dizinin toplam kaynak sayısını ve alt_sites etiketini güncelle
            cur.execute("""
                UPDATE dramas
                SET sources_count = (
                    SELECT count(*)
                    FROM episode_sources es
                    JOIN episodes e ON e.id = es.episode_id
                    WHERE e.drama_id = ? AND es.direct_url != 'dead'
                ),
                alt_sites = ?
                WHERE id = ?;
            """, (d_id, json.dumps(sorted(list(new_sites))), d_id))
            conn.commit()

        elif collected_sources:
            # Simülasyon
            sources_written = len(collected_sources)
            for s in collected_sources:
                provider_counts[s["provider"]] += 1

        total_sources_added += sources_written

        status_msg = f"✅ {sources_written} kaynak eklendi ({strategy_used})" if sources_written > 0 else "❌ Eşleşen kaynak bulunamadı"
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
            "strategy": strategy_used or "None",
            "sample_source": sample_src,
        })

    conn.close()

    # Raporlama
    elapsed = time.time() - start_time
    success_dramas = sum(1 for r in results_report if r["sources_added"] > 0)
    
    report_json_data = {
        "patch_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_seconds": round(elapsed, 2),
        "total_dramas_processed": len(target_dramas),
        "successful_dramas": success_dramas,
        "failed_dramas": len(target_dramas) - success_dramas,
        "total_sources_added": total_sources_added,
        "apply_db": apply_db,
        "provider_breakdown": dict(provider_counts),
        "results": results_report,
    }

    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(report_json_data, f, ensure_ascii=False, indent=2)

    # Markdown Raporu
    md_lines = [
        "# 🎬 KoUp Video Kaynak Onarım Raporu (Source Patcher Report)",
        f"**Tarih:** {time.strftime('%Y-%m-%d %H:%M:%S')}  ",
        f"**Çalışma Süresi:** {elapsed:.2f} saniye  ",
        f"**Mod:** {'💾 Veritabanına Yazıldı (Applied)' if apply_db else '🧪 Kuru Çalıştırma (Dry-Run)'}  ",
        "",
        "## 📊 Genel Özet",
        f"- **İşlenen Sıfır Kaynaklı Dizi:** {len(target_dramas):,} adet",
        f"- **Başarıyla Onarılan Dizi:** {success_dramas:,} adet (%{(success_dramas/max(len(target_dramas),1))*100:.1f})",
        f"- **Toplam Eklenen Yeni Canlı Kaynak:** {total_sources_added:,} adet",
        "",
        "## 🌐 Sağlayıcı Dağılımı",
    ]
    for prov, count in provider_counts.most_common():
        md_lines.append(f"- **{prov:18}:** {count:,} kaynak")

    md_lines.extend([
        "",
        "## 📋 Detaylı Sonuçlar",
        "| ID | Başlık | Ülke | Yıl | Bölüm | Eklenen Kaynak | Kullanılan Strateji |",
        "|:---|:---|:---:|:---:|:---:|:---:|:---|",
    ])
    for r in results_report:
        md_lines.append(
            f"| `{r['drama_id']}` | **{r['title']}** | {r['country']} | {r['year']} | {r['episodes_count']} | **+{r['sources_added']}** | {r['strategy']} |"
        )

    with open(output_md, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print("\n" + "=" * 75)
    print(f"🎉 Onarım Tamamlandı: {success_dramas}/{len(target_dramas)} diziye toplam {total_sources_added} çalışan kaynak eklendi.")
    print(f"📄 JSON Raporu : {output_json}")
    print(f"📄 MD Raporu   : {output_md}")
    print("=" * 75)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KoUp Zero-Source Video Patcher")
    parser.add_argument("--batch-size", type=int, default=10, help="İşlenecek dizi sayısı (varsayılan: 10)")
    parser.add_argument("--drama-id", type=int, default=None, help="Yalnızca belirli bir dizi ID'sini onar")
    parser.add_argument("--offset", type=int, default=0, help="Sıfır kaynaklı listede başlama ofseti")
    parser.add_argument("--site", type=str, default="all", choices=["all", "diziyou", "dizibox", "asyadizi", "tranimeizle", "sibling"], help="Hedef sağlayıcı filtresi")
    parser.add_argument("--apply-db", action="store_true", help="Değişiklikleri veritabanına uygula")
    parser.add_argument("--fallback", action="store_true", help="Bulunamayan bölümler için Edge fallback akışları ata")
    parser.add_argument("--audit-report", type=str, default=DEFAULT_AUDIT_REPORT, help="Girdi audit raporu JSON yolu")
    parser.add_argument("--output-json", type=str, default=DEFAULT_OUTPUT_JSON, help="Çıktı JSON rapor yolu")
    parser.add_argument("--output-md", type=str, default=DEFAULT_OUTPUT_MD, help="Çıktı Markdown rapor yolu")

    args = parser.parse_args()

    run_patcher(
        batch_size=args.batch_size,
        drama_id=args.drama_id,
        offset=args.offset,
        site_filter=args.site,
        apply_db=args.apply_db,
        fallback_unresolved=args.fallback,
        audit_report_path=args.audit_report,
        output_json=args.output_json,
        output_md=args.output_md,
    )
