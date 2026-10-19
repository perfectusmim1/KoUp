"""
DDizi Scraper: https://www.ddizi.tel/
- Arşiv: /eski.diziler (32 sayfa, 1000+ yerli ve klasik dizi)
- Yabancı Diziler: /yabanci-dizi-izle
- Güncel / Canlı: Ana sayfa ve /yeni-eklenenler8
- Oynatıcı & Kaynak: /player/oynat/{hash} -> doğrudan .m3u8 HLS ve Google CDN MP4 akışları
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import re
import json
import time
import asyncio
import aiohttp
import sqlite3
import unicodedata
from bs4 import BeautifulSoup
from database import get_connection, init_db
from multisite import (
    norm_title,
    build_drama_index,
    find_in_index,
    match_or_create_episode,
    add_source,
    tag_site,
    safe_commit,
    mark_done,
    load_done_urls,
    unique_slug,
    parse_season_and_episode,
    clean_episode_title,
    clean_scraped_slug,
)

BASE = 'https://www.ddizi.tel'
SITE = 'ddizi'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
}

MOJIBAKE_MAP = [
    ('\xc3\u2021', 'Ç'),   # Ã‡ -> Ç
    ('\xc3\u2013', 'Ö'),   # Ã– -> Ö
    ('\xc3\u0153', 'Ü'),   # Ãœ -> Ü
    ('\xc3\x9c', 'Ü'),     # Ãœ -> Ü
    ('\xc3\xa7', 'ç'),     # Ã§ -> ç
    ('\xc3\xb6', 'ö'),     # Ã¶ -> ö
    ('\xc3\xbc', 'ü'),     # Ã¼ -> ü
    ('\xc3\xa2', 'â'),     # Ã¢ -> â
    ('\xc3\xae', 'î'),     # Ã® -> î
    ('\xc3\xa9', 'é'),     # Ã© -> é
    
    ('\xc4\xb0', 'İ'),     # Ä° -> İ
    ('\xc4\xb1', 'ı'),     # Ä± -> ı
    ('\xc4\u017e', 'Ğ'),   # Äž -> Ğ
    ('\xc4\u017d', 'Ğ'),   # Äž -> Ğ
    ('\xc4\u0178', 'ğ'),   # ÄŸ -> ğ
    ('\xc4\u011f', 'ğ'),   # ÄŸ -> ğ
    
    ('\xc5\u017e', 'Ş'),   # Åž -> Ş
    ('\xc5\u017d', 'Ş'),   # Åž -> Ş
    ('\xc5\u0178', 'ş'),   # ÅŸ -> ş
    ('\xc5\ufffd', 'ş'),   # Å -> ş
    
    ('Â', ''),             # Â stray char
    ('\xc5', 'Ş'),         # Standalone Å
]

LOWERCASE_CONJUNCTIONS = {'ve', 'ile', 'de', 'da', 'ki', 'bu', 'bir', 'mi', 'mı', 'mu', 'mü', 'ama', 'fakat', 'ya', 'veya'}

def title_case_tr(s: str) -> str:
    words = s.split(' ')
    fixed_words = []
    for idx, w in enumerate(words):
        if not w:
            continue
        w_lower = w.lower()
        if idx > 0 and w_lower in LOWERCASE_CONJUNCTIONS:
            fixed_words.append(w_lower)
            continue
        first_char = w[0]
        rest = w[1:]
        if first_char == 'i':
            first_cap = 'İ'
        elif first_char == 'ı':
            first_cap = 'I'
        else:
            first_cap = first_char.upper()
        fixed_words.append(first_cap + rest)
    return ' '.join(fixed_words)

def clean_ddizi_title(raw_title: str) -> str:
    """Temiz dizi başlığı: mojibake hatalarını düzeltir, site ismi, kanal adı, 'izle', 'son bölüm', vb. çöpleri ayıklar."""
    if not raw_title:
        return ""
    t = raw_title.strip()

    # 1. Mojibake düzeltme
    for bad, good in MOJIBAKE_MAP:
        t = t.replace(bad, good)
    
    # Sitenin kendi eklediği ekleri temizle
    t = re.sub(r'\|\s*(ddizi(\.tel)?|dizi\s*izle).*$', '', t, flags=re.I)
    t = re.sub(r'-\s*ddizi.*$', '', t, flags=re.I)
    
    # Türk TV kanalları ekleri
    channels = [
        r'trt\s*1', r'trt1', r'atv', r'kanal\s*d', r'star\s*tv', r'star',
        r'now\s*tv', r'now', r'fox\s*tv', r'fox', r'show\s*tv', r'show',
        r'tv\s*8', r'tv8', r'exxen', r'gain', r'blutv', r'tabii', r'puhutv', r'netflix'
    ]
    for ch in channels:
        t = re.sub(rf'\b{ch}\b\s*$', '', t, flags=re.I)
    
    # İzleme ve bölüm kelimeleri
    patterns = [
        r'son\s*b[öo]l[üu]m\s*izle\s*(full)?',
        r'son\s*b[öo]l[üu]m',
        r't[üu]rk[çc]e\s*(altyaz[ıi]l[ıi]|dublaj(l[ıi])?)',
        r'full\s*hd\s*izle',
        r'hd\s*izle',
        r'tek\s*par[çc]a\s*izle',
        r'tek\s*par[çc]a',
        r'full\s*b[öo]l[üu]m',
        r'b[öo]l[üu]m\s*izle',
        r'\b\d+\s*\.\s*b[öo]l[üu]m\b',
        r'\b\d+\s*\.\s*sezon\b',
        r'\b(hd\d*|izle|full|seyret)\b',
        r'\b\d+\s*-\s*son\b',
    ]
    for p in patterns:
        t = re.sub(p, '', t, flags=re.I)
        
    # Typo düzeltmeleri
    t = re.sub(r'Asla Vazgeçmemm\b', 'Asla Vazgeçmem', t)

    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    t = re.sub(r'^[\-_|:•]+', '', t).strip()
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return title_case_tr(t)

def slugify(text: str) -> str:
    """Türkçe karakterleri güvenli ASCII slug'a dönüştürür ve SEO eklerini temizler."""
    clean_t = text or ""
    for bad, good in MOJIBAKE_MAP:
        clean_t = clean_t.replace(bad, good)
    tr_map = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = clean_t.translate(tr_map).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    cleaned = clean_scraped_slug(s)
    return cleaned or "dizi"

TMDB_API_KEY = "4c092d2cfd6d9c0e3aa3dab12c7d4756"

def fetch_tmdb_metadata(title: str):
    """TMDB API üzerinden 4K poster, 16:9 backdrop ve gerçek çıkış yılını çeker (Sadece TR yapımları)."""
    import urllib.parse, urllib.request
    try:
        clean_q = urllib.parse.quote(title)
        url = f"https://api.themoviedb.org/3/search/tv?query={clean_q}&language=tr-TR&api_key={TMDB_API_KEY}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            for top in results:
                origin_countries = [c.upper() for c in (top.get("origin_country") or [])]
                orig_lang = (top.get("original_language") or "").lower()
                if "TR" in origin_countries or orig_lang == "tr":
                    name = top.get("name") or top.get("original_name")
                    poster = top.get("poster_path")
                    backdrop = top.get("backdrop_path")
                    date = top.get("first_air_date")
                    year = date[:4] if date and len(date) >= 4 else None
                    overview = top.get("overview")
                    return {
                        "matched": True,
                        "title": name,
                        "year": year,
                        "poster": f"https://image.tmdb.org/t/p/original{poster}" if poster else None,
                        "backdrop": f"https://image.tmdb.org/t/p/original{backdrop}" if backdrop else None,
                        "overview": overview
                    }
    except Exception:
        pass
    return {"matched": False}

CATALOG_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ddizi_catalog.json")

async def fetch_html(session, url, sem, referer=None):
    """DDizi sayfalarını UTF-8 destekli, zaman aşımı ve LiteSpeed korumalı çeker."""
    async with sem:
        headers = dict(HEADERS)
        if referer:
            headers['Referer'] = referer
        for attempt in range(3):
            try:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                    if resp.status == 200:
                        raw = await resp.read()
                        return raw.decode('utf-8', errors='replace')
                    elif resp.status in (404, 410):
                        return None
                    elif resp.status in (403, 429):
                        wait_sec = 60 * (attempt + 1)
                        print(f"⚠️ DDizi LiteSpeed koruması ({resp.status}) - IP soğuması için {wait_sec}sn sessiz bekleniyor...", flush=True)
                        await asyncio.sleep(wait_sec)
            except Exception:
                await asyncio.sleep(1)
        return None

async def crawl_catalog(session, sem, mode="all", refresh=False):
    """
    DDizi üzerindeki tüm yapımların URL listesini ve katalog başlıklarını toplar.
    Önceden taranıp kaydedilmiş ddizi_catalog.json varsa 0 saniyede doğrudan okur.
    mode='daily': Yalnızca ana sayfa ve yeni eklenenler (~50 güncel dizi)
    mode='all': Eski dizi arşivi (32 sayfa), yabancı diziler ve güncel diziler (1029 dizi)
    """
    if not refresh and mode == "all" and os.path.exists(CATALOG_CACHE_FILE):
        try:
            with open(CATALOG_CACHE_FILE, 'r', encoding='utf-8') as f:
                cached = json.load(f)
                if len(cached) >= 100:
                    print(f"📦 Yerel DDizi katalog önbelleği yüklendi ({len(cached)} yapım, 0 HTTP isteği).")
                    return cached
        except Exception:
            pass

    found = {}
    
    # 1. Güncel diziler & Ana Sayfa
    print("📡 DDizi ana sayfa ve güncel yapımlar taranıyor...")
    for u in [f"{BASE}/", f"{BASE}/yeni-eklenenler8"]:
        html = await fetch_html(session, u, sem)
        if html:
            soup = BeautifulSoup(html, 'html.parser')
            for a in soup.find_all('a', href=True):
                h = a['href']
                t = a.get_text(strip=True)
                if '/diziler/' in h and t and len(t) > 1:
                    full_url = h if h.startswith('http') else BASE + h
                    if full_url not in found:
                        found[full_url] = clean_ddizi_title(t)
                        
    print(f"✅ Güncel sayfadan {len(found)} yapım bulundu.")
    if mode == "daily":
        return found

    # 2. Yabancı Diziler
    print("📡 DDizi yabancı diziler taranıyor...")
    y_html = await fetch_html(session, f"{BASE}/yabanci-dizi-izle", sem)
    if y_html:
        soup = BeautifulSoup(y_html, 'html.parser')
        for a in soup.find_all('a', href=True):
            h = a['href']
            t = a.get_text(strip=True)
            if '/diziler/' in h and t and len(t) > 1:
                full_url = h if h.startswith('http') else BASE + h
                if full_url not in found:
                    found[full_url] = clean_ddizi_title(t)

    # 3. Eski Dizi Arşivi (32 sayfa)
    print("📡 DDizi 32 sayfalık dev dizi arşivi taranıyor...")
    for p in range(1, 35):
        cat_url = f"{BASE}/eski.diziler/{p}" if p > 1 else f"{BASE}/eski.diziler"
        html = await fetch_html(session, cat_url, sem)
        if not html:
            break
        soup = BeautifulSoup(html, 'html.parser')
        page_items = {}
        for a in soup.find_all('a', href=True):
            h = a['href']
            t = a.get_text(strip=True)
            if '/diziler/' in h and t and len(t) > 1:
                full_url = h if h.startswith('http') else BASE + h
                if full_url not in found:
                    cleaned_t = clean_ddizi_title(t)
                    found[full_url] = cleaned_t
                    page_items[full_url] = cleaned_t
        print(f"  Sayfa {p}: +{len(page_items)} yeni dizi (Toplam: {len(found)})")
        if not page_items and p > 31:
            break

    print(f"🎉 DDizi toplam {len(found)} yapım başarıyla kataloglandı!")
    return found

def parse_drama_page(html, url, default_title=""):
    """Dizi sayfasını, afişini, konusunu ve tüm sayfalardaki bölümlerini çıkarır."""
    soup = BeautifulSoup(html, 'html.parser')
    
    # Başlık
    title = default_title
    if not title:
        if soup.title and soup.title.string:
            title = clean_ddizi_title(soup.title.string)
    if not title:
        tc = soup.find('div', class_='title_con')
        if tc:
            title = clean_ddizi_title(tc.get_text(strip=True))
    if not title:
        title = url.rstrip('/').split('/')[-1].replace('-', ' ').title()

    # Afiş / Kapak Görseli
    cover_image = None
    for img in soup.find_all('img'):
        src = img.get('data-src') or img.get('src') or ''
        if 'diziresimleri' in src:
            cover_image = src if src.startswith('http') else BASE + src
            break

    # Sayfalandırma (Bazı diziler 20+ sayfaya yayılmıştır, örn: Gönül Dağı 24 sayfa)
    pages = set([url])
    content_div = soup.find('div', class_='content_') or soup

    # Dizi ID deseni (örn: /diziler/1808/)
    m_base = re.search(r'/diziler/(\d+)/', url)
    dizi_pattern = m_base.group(0) if m_base else None

    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/sayfa-' in h or '/sayfa/' in h:
            if not dizi_pattern or dizi_pattern in h:
                full_p = h if h.startswith('http') else BASE + h
                pages.add(full_p)

    # Ek olarak sayfa desenini yakala (sayfa-1 .. sayfa-N)
    found_nums = [int(n) for n in re.findall(r'/sayfa-(\d+)', html)]
    if found_nums:
        max_p = min(max(found_nums), 40)
        clean_u = url.rstrip('/')
        for p_i in range(1, max_p + 1):
            pages.add(f"{clean_u}/sayfa-{p_i}")

    # Bölüm bağlantıları: Sadece içerik alanındaki dizi kartlarından al (sağ sidebar karışmasın)
    episodes = []
    seen_urls = set()
    cards = content_div.find_all('div', class_='dizi-boxpost-cat')
    link_elements = [c.find('a', href=True) for c in cards] if cards else content_div.find_all('a', href=True)

    for a in link_elements:
        if not a:
            continue
        h = a.get('href', '')
        txt = a.get_text(strip=True)
        if '/izle/' in h and ('bölüm' in txt.lower() or 'bolum' in txt.lower() or 'bolum' in h.lower() or 'bölüm' in h.lower()):
            full_ep = h if h.startswith('http') else BASE + h
            if full_ep in seen_urls:
                continue
            seen_urls.add(full_ep)

            # Sezon ve Bölüm Numarası Ayıklama
            season, ep_num = parse_season_and_episode(full_ep, txt)

            episodes.append({
                'season': season,
                'number': ep_num,
                'name': clean_episode_title(txt, season, ep_num),
                'url': full_ep
            })

    return {
        'title': title,
        'slug': slugify(title),
        'cover_image': cover_image,
        'pages': list(pages),
        'episodes': episodes,
        'url': url
    }

async def extract_stream_source(session, ep_url, drama_url, sem):
    """
    DDizi bölüm sayfasından akış veya oynatıcı iframe'ini çeker:
    1. /player/telif/index.php?id=https://www.youtube.com/... -> YouTube Resmi Yayın
    2. /player/oynat/{hash} -> JWPlayer HLS (.m3u8) veya Google CDN .mp4
    """
    ep_html = await fetch_html(session, ep_url, sem, referer=drama_url)
    if not ep_html:
        return None

    # 1. YouTube Telif / Resmi Kanal embed kontrolü (Kanal D, TRT vb. resmi yayınlar)
    yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
    if yt_match:
        raw_yt = yt_match.group(1)
        v_id_match = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
        if v_id_match:
            v_id = v_id_match.group(1)
            embed_url = f"https://www.youtube.com/embed/{v_id}?autoplay=1&enablejsapi=1"
            return {
                'direct_url': embed_url,
                'stream_type': 'youtube',
                'provider': 'youtube',
                'source_name': 'YouTube HD'
            }

    # 2. DDizi Native JWPlayer Oynatıcı tespiti (/player/oynat/{hash})
    player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
    if not player_paths:
        player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
    
    if player_paths:
        player_url = player_paths[0] if player_paths[0].startswith('http') else BASE + player_paths[0]
        p_html = await fetch_html(session, player_url, sem, referer=ep_url)
        if p_html:
            # ÖNCELİK 1: YouTube video tespiti (image posterından veya player kodundan)
            # DDizi JWPlayer içinde redirector.googlevideo.com CDN geçici tokenı kullanır, ancak poster olarak
            # daima kalıcı YouTube ID'sini içerir: https://i.ytimg.com/vi/{ID}/hqdefault.jpg
            # Geçici ve saatlik ömrü olan Google CDN URL'si yerine KALICI YouTube embed'i kaydedilir:
            yt_thumb_match = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
            if yt_thumb_match:
                yt_id = yt_thumb_match.group(1)
                return {
                    'direct_url': f"https://www.youtube.com/embed/{yt_id}?autoplay=1&enablejsapi=1",
                    'stream_type': 'youtube',
                    'provider': 'youtube',
                    'source_name': 'YouTube HD'
                }

            # ÖNCELİK 2: Kalıcı Twitter Amplify / DDizi HLS .m3u8 akışları
            m3u8_matches = re.findall(r'file:\s*["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
            if not m3u8_matches:
                m3u8_matches = re.findall(r'["\'](https?:\\?/\\?/[^"\']+\.m3u8[^"\']*)["\']', p_html)
            for raw_m3u8 in m3u8_matches:
                clean_m3u8 = raw_m3u8.replace('\\/', '/')
                if clean_m3u8.startswith('http'):
                    return {
                        'direct_url': clean_m3u8,
                        'stream_type': 'hls',
                        'provider': 'ddizi',
                        'source_name': 'DDizi HLS'
                    }

            # ÖNCELİK 3: Kalıcı doğrudan MP4 dosyaları (videoplayback / googlevideo geçici URL'leri HARİÇ)
            raw_files = re.findall(r'file:\s*["\']([^"\']+)["\']', p_html)
            for raw_f in raw_files:
                clean_url = raw_f.replace('\\/', '/')
                if clean_url.startswith('http') and 'videoplayback' not in clean_url and 'googlevideo' not in clean_url and '.mp4' in clean_url:
                    return {
                        'direct_url': clean_url,
                        'stream_type': 'mp4',
                        'provider': 'ddizi',
                        'source_name': 'DDizi HD'
                    }

    return None

async def run(limit=None, mode="all", episodes_limit=None, target_url=None, force=False, workers=3):
    """DDizi tüm yapımları ve bölümleri SQLite veritabanına aktaran ana çalıştırma motoru."""
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    cur = conn.cursor()
    
    print("🚀 DDizi Arşiv Motoru Başlatılıyor...")
    idx = build_drama_index(cur, content_types=('dizi', 'film', 'program', 'anime'))
    
    sem = asyncio.Semaphore(4)
    connector = aiohttp.TCPConnector(limit=6, ssl=False)
    
    async with aiohttp.ClientSession(connector=connector) as session:
        if target_url:
            catalog = {target_url: clean_ddizi_title(target_url.rstrip('/').split('/')[-1])}
            pending_urls = [target_url]
        else:
            catalog = await crawl_catalog(session, sem, mode=mode)
            all_urls = list(catalog.keys())
            done0 = load_done_urls(cur, SITE) if not force else set()
            pending_urls = [u for u in all_urls if u not in done0]
        
        print(f"📊 Toplam taranacak yeni/işlenmemiş yapım sayısı: {len(pending_urls)}")
        if limit:
            pending_urls = pending_urls[:limit]
            print(f"🎯 Limit uygulandı: İlk {len(pending_urls)} yapım taranıyor.")

        worker_count = workers or 2
        queue = asyncio.Queue()
        for idx_num, drama_url in enumerate(pending_urls, 1):
            queue.put_nowait((idx_num, drama_url))

        db_lock = asyncio.Lock()
        completed_count = 0
        n_new = 0
        n_matched = 0
        n_episodes = 0
        n_sources = 0
        t0 = time.time()

        async def worker(wid):
            nonlocal completed_count, n_new, n_matched, n_episodes, n_sources
            while not queue.empty():
                try:
                    i, drama_url = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

                t_drama = time.time()
                cat_title = catalog.get(drama_url, "")
                try:
                    html = await fetch_html(session, drama_url, sem)
                    if not html:
                        continue

                    drama_data = parse_drama_page(html, drama_url, default_title=cat_title)
                    title = drama_data['title']
                    slug = drama_data['slug']
                    cover = drama_data['cover_image']

                    # Ek sayfalar varsa o sayfalardaki bölümleri de eksiksiz topla
                    all_episodes = list(drama_data['episodes'])
                    extra_pages = sorted(list(set(
                        p for p in drama_data['pages']
                        if p.rstrip('/') != drama_url.rstrip('/') and not p.endswith('/sayfa-0')
                    )))
                    if extra_pages:
                        sub_res = []
                        for ep_k in range(0, len(extra_pages), 3):
                            p_chunk = extra_pages[ep_k:ep_k + 3]
                            c_res = await asyncio.gather(*[fetch_html(session, p, sem, referer=drama_url) for p in p_chunk])
                            sub_res.extend(c_res)
                            if ep_k + 3 < len(extra_pages):
                                await asyncio.sleep(0.3)
                        for sub_html in sub_res:
                            if sub_html:
                                sub_data = parse_drama_page(sub_html, drama_url, default_title=title)
                                for sep in sub_data['episodes']:
                                    if sep['url'] not in [x['url'] for x in all_episodes]:
                                        all_episodes.append(sep)

                    # Bölüm numarasına göre sırala
                    all_episodes.sort(key=lambda x: (x.get('season', 1), x.get('number', 1)))

                    # Bölüm limit filtresi
                    if episodes_limit:
                        all_episodes = all_episodes[:episodes_limit]

                    # DB Kayıt (Dizi & Bölüm Kimlikleri)
                    ep_jobs = []
                    async with db_lock:
                        cur.execute("SELECT id FROM dramas WHERE source_url=?", (drama_url,))
                        r0 = cur.fetchone()
                        if r0:
                            did = r0[0]
                            n_matched += 1
                        else:
                            clean_s = clean_scraped_slug(slug)
                            did = find_in_index(idx, title, None, clean_s)
                            if did:
                                n_matched += 1
                            else:
                                safe_s = unique_slug(cur, clean_s)
                                tmdb = fetch_tmdb_metadata(title)
                                ins_title = tmdb.get("title") or title
                                ins_cover = tmdb.get("poster") or cover
                                ins_backdrop = tmdb.get("backdrop") or ins_cover
                                ins_year = tmdb.get("year")
                                ins_overview = tmdb.get("overview") or f"{ins_title}, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır."

                                cur.execute("""INSERT INTO dramas (slug, content_type, country, country_name, title, source_url, cover_image,
                                    backdrop_image, release_year, overview, categories, tags, alt_sites)
                                    VALUES (?, 'dizi', 'TR', 'Türkiye', ?, ?, ?, ?, ?, ?, ?, '["DDizi", "Yerli Dizi"]', ?)""",
                                    (safe_s, ins_title, drama_url, ins_cover, ins_backdrop, ins_year, ins_overview,
                                     json.dumps(["Yerli Dizi", "Dram"], ensure_ascii=False),
                                     json.dumps([SITE])))
                                did = cur.lastrowid
                                idx['title'].setdefault(norm_title(ins_title), []).append((did, '', None, None))
                                n_new += 1

                        tag_site(cur, did, SITE)
                        mark_done(cur, SITE, drama_url)

                        for ep in all_episodes:
                            eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                            n_episodes += 1
                            cur.execute("SELECT id FROM episode_sources WHERE episode_id=? AND provider=?", (eid, 'ddizi'))
                            if not cur.fetchone():
                                ep_jobs.append((eid, ep['url']))

                        cur.execute("UPDATE dramas SET episode_count=? WHERE id=?", (len(all_episodes), did))
                        safe_commit(conn)

                    # Akışları çek (db_lock dışında, koruma tetiklemeyen nazik paralel istekler)
                    resolved_streams = []
                    chunk_size = 3
                    for k in range(0, len(ep_jobs), chunk_size):
                        ep_chunk = ep_jobs[k:k + chunk_size]
                        stream_res = await asyncio.gather(*[
                            extract_stream_source(session, u, drama_url, sem) for _, u in ep_chunk
                        ])
                        for (eid, _), s_info in zip(ep_chunk, stream_res):
                            if s_info:
                                resolved_streams.append((eid, s_info))
                        if k + chunk_size < len(ep_jobs):
                            await asyncio.sleep(0.35)

                    # Akışları DB'ye kaydet
                    async with db_lock:
                        added_s = 0
                        for eid, s_info in resolved_streams:
                            if add_source(cur, eid, s_info['source_name'], s_info['direct_url'], s_info['provider'], SITE):
                                added_s += 1
                        n_sources += added_s
                        safe_commit(conn)

                        completed_count += 1
                        dt_drama = time.time() - t_drama
                        total_elapsed = time.time() - t0
                        avg_per_drama = total_elapsed / max(1, completed_count)
                        rem_dramas = len(pending_urls) - completed_count
                        eta_sec = int(avg_per_drama * rem_dramas / worker_count)
                        eta_min = eta_sec // 60
                        print(f"[{completed_count}/{len(pending_urls)}] {title} | Bölüm: {len(all_episodes)} | Yeni: {added_s} | {dt_drama:.1f}sn | Kalan: ~{eta_min}dk ({total_elapsed/60:.1f}dk geçti) [W{wid}]", flush=True)

                except Exception as ex:
                    print(f"⚠️ Hata [{drama_url}]: {ex}", flush=True)
                finally:
                    queue.task_done()

        # Paralel İşçileri Çalıştır
        actual_workers = min(worker_count, len(pending_urls)) if pending_urls else 1
        print(f"⚡ {actual_workers} Paralel İşçi ile tarama başlatıldı...")
        await asyncio.gather(*[worker(w) for w in range(actual_workers)])

    conn.close()
    print(f"\n✨ DDizi İşlemi Tamamlandı! Yeni Dizi: {n_new}, Eşleşen: {n_matched}, Kaydedilen Bölüm: {n_episodes}, Yeni Kaynak: {n_sources}", flush=True)

    # Otomatik Supabase Senkronizasyonu
    try:
        from scripts.sync_ddizi_to_supabase import sync_ddizi_media
        print("🔄 Supabase senkronizasyonu başlatılıyor...", flush=True)
        sync_ddizi_media()
    except Exception as e:
        print(f"⚠️ Supabase senkronizasyon uyarısı: {e}", flush=True)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="DDizi Scraper Engine")
    parser.add_argument('--limit', type=int, default=None, help="Maksimum taranacak dizi sayısı")
    parser.add_argument('--mode', choices=['all', 'daily'], default='all', help="Tarama modu (all: tüm arşiv, daily: güncel)")
    parser.add_argument('--workers', type=int, default=3, help="Paralel işçi sayısı (varsayılan: 3)")
    parser.add_argument('--episodes-limit', type=int, default=None, help="Dizi başına taranacak maksimum bölüm sayısı")
    parser.add_argument('--url', type=str, default=None, help="Tek bir dizi URL'si tara (örn: https://www.ddizi.tel/diziler/2167/daha-17-son-bolum-izle)")
    parser.add_argument('--force', action='store_true', help="Daha önce işlenmiş olanları atlama, yeniden tara ve eksik bölümleri tamamla")
    args = parser.parse_args()

    asyncio.run(run(limit=args.limit, mode=args.mode, episodes_limit=args.episodes_limit, target_url=args.url, force=args.force, workers=args.workers))
