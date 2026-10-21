"""Cok siteli birlesim yardimcilari: eslestirme + kaynak numaralandirma + URL dedupe."""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
import re
import json
import time
import sqlite3
from datetime import datetime
import unicodedata

try:
    from clean_fansub import clean_fansub_name, clean_source_name
except ImportError:
    from scrapers.clean_fansub import clean_fansub_name, clean_source_name

def _retry(fn, *a, **k):
    import random
    for i in range(60):
        try:
            return fn(*a, **k)
        except sqlite3.OperationalError as e:
            if 'locked' not in str(e) or i == 59:
                raise
            time.sleep(1 + i * 0.5 + random.random() * 2)

TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")

def norm_title(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = s.translate(TR).lower()
    s = re.sub(r'\(.*?\)|\[.*?\]', '', s)
    return re.sub(r'[^a-z0-9]', '', s)

def clean_scraped_slug(raw_slug: str) -> str:
    """Canonical slug cleaner helper that strips SEO/scraper suffixes:
    -izle, -hdf, -hdfc, -hf, -hd-film-izle, -film-izle, -filmi-izle,
    -dizi-izle, -dizi, -bolum, -sezon, and repeated -hdf-\\d+ tails
    while preserving legitimate numbers in titles.
    """
    if not raw_slug:
        return ""
    slug = str(raw_slug).strip().lower()
    # Strip URL protocol/domain if full URL was passed
    slug = re.sub(r"^https?://[^/]+/", "", slug)
    slug = slug.strip("/")
    if "/" in slug:
        slug = slug.split("/")[-1]
    # Remove HTML extensions or query parameters
    slug = re.sub(r"\.[a-zA-Z0-9]+$", "", slug)
    slug = re.sub(r"[?#].*$", "", slug)
    # Convert underscores/spaces to hyphens
    slug = re.sub(r"[\s_]+", "-", slug)
    # Remove characters that aren't lowercase alphanumeric or hyphens
    slug = re.sub(r"[^a-z0-9\-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")

    # Patterns to strip from the tail iteratively
    strip_patterns = [
        r"-(?:hd-film-izle|filmi-izle|film-izle|dizi-izle)$",
        r"-(?:hdfc|hdf|hf)-\d+$",
        r"-hdf-\d+$",
        r"-(?:hdfc|hdf|hf)$",
        r"-(?:izle|dizi|bolum|sezon)$",
        r"-(?:full-hd|1080p|720p|tek-parca)$",
    ]

    prev = None
    while prev != slug:
        prev = slug
        for pat in strip_patterns:
            slug = re.sub(pat, "", slug)
        slug = re.sub(r"-+", "-", slug).strip("-")

    if not slug and prev:
        return prev
    return slug

def slug_core(slug):
    s = clean_scraped_slug(slug)
    s = re.sub(r'-(izle|dq\d*)$', '', s)
    s = re.sub(r'-\d{4}-(kore|cin|japon|tayland|tayvan|asya)$', '', s)
    return re.sub(r'[^a-z0-9]', '', s)

def parse_season_number(text, default=1):
    """Baslik veya bolum adindan sezon numarasini cikarir (orn: '2. Sezon', 'Season 3', 'S02')."""
    if not text:
        return default
    m = re.search(r'(?:sezon|season|part|cour)\s*(\d{1,2})|(\d{1,2})\s*\.\s*sezon|\bS(\d{1,2})(?:E\d+|\b)', str(text), re.IGNORECASE)
    if m:
        for g in m.groups():
            if g and g.isdigit():
                val = int(g)
                if 1 <= val <= 30:
                    return val
    return default

def clean_episode_title(name: str, season: int = 1, number: int = 1) -> str:
    """
    Standardizes polluted episode names:
    - Strips dates: '07 Eki', '15 Mart 2021', '1 Ocak', etc.
    - Strips scraper noise: 'izle', 'dizi izle', 'film izle', '1080p', 'full hd', 'tek parça', etc.
    - Strips redundant '1. Sezon 2. Bölüm' or 'Bölüm 2' prefixes if followed by a real episode title.
    - Returns clean title or standard 'Bölüm X' / 'S. Sezon E. Bölüm'.
    """
    if not name:
        return f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
    s = str(name).strip()

    # Normalize mojibake
    if any(c in s for c in ('Ã', 'Ä', 'Å', '')):
        try:
            s = s.encode('latin-1').decode('utf-8')
        except Exception:
            pass

    # Remove Turkish/English dates
    s = re.sub(r'\s*\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b(?:\s+\d{4})?', '', s, flags=re.I)
    s = re.sub(r'\s*\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b', '', s)
    s = re.sub(r'\s*\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b', '', s)

    # Remove scraper noise
    s = re.sub(r'\s*(?:izle|dizi\s*izle|film\s*izle|tek\s*par[çc]a|full\s*hd|1080p|720p|hd|t[üu]rk[çc]e\s*dublaj(?:l[ıi])?|t[üu]rk[çc]e\s*altyaz[ıi]l[ıi]).*$', '', s, flags=re.I)

    # Strip quotes
    s = s.strip("\"'“”«»` ")

    # Strip redundant leading season/episode prefix, e.g. "1. Sezon 2. Bölüm", "S1:B2", "2. Bölüm"
    sub_title = re.sub(r'^(?:\d+\s*\.?\s*Sezon\s*)?(?:\d+\s*\.?\s*B[öo]l[üu]m\s*[-:•]?\s*)', '', s, flags=re.I).strip()
    sub_title = re.sub(r'^(?:Season\s*\d+\s*)?(?:Episode\s*\d+\s*[-:•]?\s*)', '', sub_title, flags=re.I).strip()
    sub_title = re.sub(r'^S\d+[:\s]*B\d+\s*[-:•]?\s*', '', sub_title, flags=re.I).strip()
    sub_title = re.sub(r'^[-:•|~–—\s]+|[-:•|~–—\s]+$', '', sub_title).strip()

    # Handle parentheses like (Tremor)
    m_paren = re.match(r'^\(([^)]+)\)$', sub_title)
    if m_paren:
        sub_title = m_paren.group(1).strip()

    # If there is a meaningful episode subtitle
    if sub_title and not re.match(r'^(?:b[öo]l[üu]m|episode|part)\s*\d*$', sub_title, re.I) and sub_title != str(number):
        if re.search(r'\b\d+\.?\s*b[öo]l[üu]m\b', sub_title, re.I):
            return f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"
        return sub_title

    return f"Bölüm {number}" if season == 1 else f"{season}. Sezon {number}. Bölüm"

def parse_season_and_episode(url: str = "", text: str = "") -> tuple:
    """
    Robustly parses (season_number, episode_number) from a URL and/or anchor text.
    Handles:
    - Standard patterns: /sezon-2/bolum-3, 2-sezon-3-bolum, S02E03, 2. Sezon 3. Bölüm
    - Range / batch patterns: 11-22. Bölüm, 1-6-bolum (returns starting episode 11 or 1, not jumping to 22 or 6!)
    - Trailing episode patterns: -bolum-5, /bolum-5.html
    - Rejects false matches from title digits like Apartment 404 or years (2024).
    """
    u = (url or '').lower().strip()
    t = (text or '').lower().strip()
    combined = f"{u} {t}"

    season = 1
    episode = 1

    # 1. Detect Season
    s_m = re.search(r'(?:^|[^\d])(\d{1,2})\s*\.?\s*sezon\b', combined) or \
          re.search(r'/sezon-(\d{1,2})/', u) or \
          re.search(r'[-_/]s(\d{1,2})[-_/e]', u) or \
          re.search(r'\bseason\s*(\d{1,2})\b', combined) or \
          re.search(r'-(\d{1,2})-sezon-', u)
    if s_m:
        try:
            parsed_s = int(s_m.group(1))
            if 1 <= parsed_s <= 50:
                season = parsed_s
        except Exception:
            pass

    # 2. Detect Range / Batch Releases: e.g. "11-22-bolum", "11-22. Bölüm", "1-6. Bölümler"
    range_m = re.search(r'(?:^|[^\d])(\d{1,3})\s*[-–]\s*(\d{1,3})\s*(?:\.|\s*[-_])?\s*b[öo]l[üu]m', combined) or \
              re.search(r'[-_/](\d{1,3})[-_](\d{1,3})[-_]bolum', u)
    if range_m:
        start_ep = int(range_m.group(1))
        end_ep = int(range_m.group(2))
        if 1 <= start_ep < end_ep and (end_ep - start_ep) <= 40:
            return season, start_ep

    # 3. Detect Explicit Episode (URL has strict priority over HTML text to avoid concatenated badge digits)
    e_m = re.search(r'/bolum-(\d{1,4})(?:[^\d]|$)', u) or \
          re.search(r'[-_/]bolum[-_/](\d{1,4})(?:[^\d]|$)', u) or \
          re.search(r'[-_/](\d{1,4})-bolum(?:[^\d]|$)', u) or \
          re.search(r'[-_/]e(\d{1,4})(?:[^\d]|$)', u) or \
          re.search(r'(?:^|[^\d])(\d{1,4})\s*\.\s*b[öo]l[üu]m', t) or \
          re.search(r'\bepisode\s*(\d{1,4})\b', combined)

    if e_m:
        try:
            parsed_e = int(e_m.group(1))
            if 1 <= parsed_e <= 2500:
                episode = parsed_e
        except Exception:
            pass
    else:
        fallback_m = re.search(r'bolum.*?(\d{1,3})(?:\.html|\b|$)', u)
        if fallback_m:
            try:
                episode = int(fallback_m.group(1))
            except Exception:
                pass

    return season, episode

def build_drama_index(cur, content_types=('dizi', 'film', 'program', 'anime')):
    """ Bellek ici kapsamli indeks: basliklar, alternatif basliklar (tags), native_title, AniList, TMDb, IMDb ve sluglar."""
    cur.execute("""
        SELECT id, slug, title, release_year, mydramalist_url, anilist_url, content_type,
               native_title, tags, anilist_id, imdb_id, tmdb_id
        FROM dramas
        WHERE content_type IN ({})
    """.format(','.join('?' * len(content_types))), content_types)
    
    by_title, by_mdl, by_al, by_slug = {}, {}, {}, {}
    by_al_id, by_imdb_id, by_tmdb_id = {}, {}, {}

    GENRE_TAGS_IGNORE = {'ilkask', 'arkadaslik', 'romantik', 'aksiyon', 'komedi', 'dram', 'fantastik', 'gizem', 'koredizisi', 'asya', 'diziizle', 'dizi', 'film', 'anime'}

    for r in cur.fetchall():
        did, slug, title, year, mdl, al, ctype, n_title, tags_raw, al_id, imdb_id, tmdb_id = r
        ct = (ctype or '').strip().lower()
        yr = (year or '').strip()
        cand_tuple = (did, yr, mdl, al, ct)

        # 1. Index canonical title
        nt = norm_title(title)
        if len(nt) >= 4:
            by_title.setdefault(nt, []).append(cand_tuple)

        # 2. Index native_title (e.g. Japanese/Korean original title)
        if n_title:
            n_nt = norm_title(n_title)
            if len(n_nt) >= 4 and n_nt != nt:
                by_title.setdefault(n_nt, []).append(cand_tuple)

        # 3. Index alternative titles from tags
        if tags_raw:
            try:
                parsed = json.loads(tags_raw) if isinstance(tags_raw, str) else tags_raw
                if isinstance(parsed, list):
                    for alt in parsed:
                        alt_nt = norm_title(str(alt))
                        if len(alt_nt) >= 4 and alt_nt not in GENRE_TAGS_IGNORE:
                            by_title.setdefault(alt_nt, []).append(cand_tuple)
            except Exception:
                for alt in str(tags_raw).split(','):
                    alt_nt = norm_title(alt.strip())
                    if len(alt_nt) >= 4 and alt_nt not in GENRE_TAGS_IGNORE:
                        by_title.setdefault(alt_nt, []).append(cand_tuple)

        # 4. Index external IDs
        if al_id and str(al_id).strip() not in ('0', 'None', ''):
            by_al_id[str(al_id).strip()] = did
        if imdb_id and str(imdb_id).strip().startswith('tt'):
            by_imdb_id[str(imdb_id).strip()] = did
        if tmdb_id and str(tmdb_id).strip() not in ('0', 'None', ''):
            by_tmdb_id.setdefault(str(tmdb_id).strip(), []).append(cand_tuple)

        # 5. Index URLs and slug
        if mdl:
            by_mdl[mdl.strip()] = did
        if al:
            by_al[al.strip()] = did
        sc = slug_core(slug or '')
        if len(sc) >= 4:
            by_slug.setdefault(sc, []).append((did, yr, ct))

    return {
        'title': by_title,
        'mdl': by_mdl,
        'al': by_al,
        'slug': by_slug,
        'al_id': by_al_id,
        'imdb_id': by_imdb_id,
        'tmdb_id': by_tmdb_id,
    }

def _years_compatible(y1, y2):
    if not y1 or not y2:
        return True
    try:
        return abs(int(str(y1)[:4]) - int(str(y2)[:4])) <= 1
    except Exception:
        return str(y1).strip() == str(y2).strip()

def find_in_index(idx, title, year=None, slug=None, content_type=None, mdl_url=None, anilist_url=None, anilist_id=None, imdb_id=None, tmdb_id=None):
    # 1. External ID matches have highest priority
    if anilist_id and str(anilist_id).strip() in idx.get('al_id', {}):
        return idx['al_id'][str(anilist_id).strip()]
    if imdb_id and str(imdb_id).strip() in idx.get('imdb_id', {}):
        return idx['imdb_id'][str(imdb_id).strip()]
    if tmdb_id and str(tmdb_id).strip() in idx.get('tmdb_id', {}):
        cands = idx['tmdb_id'][str(tmdb_id).strip()]
        if year:
            for did, y, _m, _a, _ct in cands:
                if _years_compatible(y, year):
                    return did
        elif cands:
            return cands[0][0]

    if mdl_url and mdl_url.strip() in idx.get('mdl', {}):
        return idx['mdl'][mdl_url.strip()]
    if anilist_url and anilist_url.strip() in idx.get('al', {}):
        return idx['al'][anilist_url.strip()]

    target_ct = (content_type or '').strip().lower()
    nt = norm_title(title)
    if len(nt) >= 4 and nt in idx['title']:
        cands = idx['title'][nt]
        # Prefer exact content_type match if available, but allow anime/dizi overlap
        if target_ct:
            matching_cands = [c for c in cands if not c[4] or c[4] == target_ct]
            if matching_cands:
                cands = matching_cands
            elif target_ct in ('dizi', 'anime'):
                # Allow cross-match between dizi and anime (scrapers often label anime as dizi)
                cross_cands = [c for c in cands if c[4] in ('dizi', 'anime')]
                if cross_cands:
                    cands = cross_cands

        if cands:
            if year:
                for did, y, _m, _a, _ct in cands:
                    if y == str(year):
                        return did
                for did, y, _m, _a, _ct in cands:
                    if _years_compatible(y, year):
                        return did
                return cands[0][0]
            return cands[0][0]

    if slug:
        sc = slug_core(slug)
        if len(sc) >= 4 and sc in idx['slug']:
            for item in idx['slug'][sc]:
                if isinstance(item, tuple):
                    did, y = item[0], item[1]
                    item_ct = item[2] if len(item) > 2 else None
                    if target_ct and item_ct and target_ct != item_ct:
                        # Allow cross-match between anime and dizi
                        if not (target_ct in ('dizi', 'anime') and item_ct in ('dizi', 'anime')):
                            continue
                    if _years_compatible(y, year):
                        return did
                else:
                    return item
    return None


_RECENT_ADDED_EPISODES = []
_RECENT_ADDED_SOURCES = []
_DRAMA_META_CACHE = {}

def get_drama_meta(cur, drama_id):
    if not drama_id:
        return ("", "", "")
    if drama_id in _DRAMA_META_CACHE:
        return _DRAMA_META_CACHE[drama_id]
    try:
        cur.execute("SELECT title, slug, cover_image FROM dramas WHERE id=?", (drama_id,))
        r = cur.fetchone()
        if r:
            _DRAMA_META_CACHE[drama_id] = (r[0] or "", r[1] or "", r[2] or "")
            return _DRAMA_META_CACHE[drama_id]
    except Exception:
        pass
    return ("", "", "")

def pop_recent_added_episodes():
    global _RECENT_ADDED_EPISODES
    items = list(_RECENT_ADDED_EPISODES)
    _RECENT_ADDED_EPISODES = []
    return items

def pop_recent_added_sources():
    global _RECENT_ADDED_SOURCES
    items = list(_RECENT_ADDED_SOURCES)
    _RECENT_ADDED_SOURCES = []
    return items

def match_or_create_episode(cur, drama_id, season, number, name, url):
    season = max(1, int(season or 1))
    number = max(1, int(number or 1))
    clean_name = clean_episode_title(name, season, number)

    def _op():
        cur.execute("SELECT id, episode_name FROM episodes WHERE drama_id=? AND season_number=? AND episode_number=?",
                    (drama_id, season, number))
        r = cur.fetchone()
        if r:
            old_name = r[1] or ""
            # Auto-heal existing messy episode names in archive
            if any(bad in old_name.lower() for bad in ("izle", "eki", "kas", "oca", "şub", "mar", "nis", "may", "haz", "tem", "ağu", "eyl", "1080p", "full hd")):
                cur.execute("UPDATE episodes SET episode_name=? WHERE id=?", (clean_name, r[0]))
            return r[0], False
        try:
            cur.execute("""INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                VALUES (?, ?, ?, ?, ?, 1)""", (drama_id, season, number, clean_name, url))
            new_ep_id = cur.lastrowid
            d_title, d_slug, d_cover = get_drama_meta(cur, drama_id)
            _RECENT_ADDED_EPISODES.append({
                "id": new_ep_id,
                "drama_id": drama_id,
                "drama_title": d_title,
                "drama_slug": d_slug,
                "cover_image": d_cover,
                "season_number": season,
                "episode_number": number,
                "episode_name": clean_name,
                "episode_url": url,
                "added_at": datetime.now().isoformat(),
            })
            return new_ep_id, True
        except sqlite3.IntegrityError:
            # Ayni URL baska drama/numarada kayitli (toplu bolum vb.): mevcut satiri kullan.
            cur.execute("SELECT id FROM episodes WHERE episode_url=?", (url,))
            r = cur.fetchone()
            if r:
                return r[0], False
            raise
    return _retry(_op)

def add_source(cur, episode_id, source_name, direct_url, provider, site, fansub=None, embed_id=None):
    """Ayni URL varsa site ekle; ayni provider farkli isimse numaralandir (VK, VK2)."""
    if not direct_url:
        return False
    fansub = clean_fansub_name(fansub)
    source_name = clean_source_name(source_name)
    u_low = direct_url.lower()
    p_low = (provider or '').lower()
    n_low = (source_name or '').lower()
    if (
        p_low in ('sibnet', 'sendvid', 'dead', 'googledrive', 'pixeldrain', '4meplayer', 'uns.bio', 'p2pplay', 'rpmplay', 'asyaanim', 'upns', 'playerdkorea')
        or 'sibnet' in n_low
        or 'pixeldrain' in n_low
        or 'asyaanim' in n_low
        or 'upns' in n_low
        or 'playerdkorea' in n_low
        or any(dead in u_low for dead in (
            'sibnet.ru', 'sendvid', 'drive.google.com', 'docs.google.com',
            'short.icu', 'short.ink', 'vudeo.', 'dood',
            'pixeldrain.com', 'pixeldrain', '4meplayer', 'uns.bio', 'p2pplay',
            'rpmplay', 'video.diziasya.com', 'asyaanim.upns.one', 'upns.one', 'upns.live',
            'playerdkorea.xyz', 'playerdkorea'
        ))
        or u_low.endswith('/e/')
        or u_low.endswith('/embed/video/')
    ):
        return False
    def _op():
        cur.execute("SELECT id, site FROM episode_sources WHERE episode_id=? AND direct_url=?",
                    (episode_id, direct_url))
        r = cur.fetchone()
        if r:
            sites = (r[1] or '').split(',') if r[1] else []
            if site not in sites:
                sites.append(site)
                cur.execute("UPDATE episode_sources SET site=? WHERE id=?", (','.join(sites), r[0]))
            return False
        cur.execute("SELECT source_name FROM episode_sources WHERE episode_id=? AND provider=?",
                    (episode_id, provider))
        taken = [x[0] for x in cur.fetchall()]
        name = (source_name or provider).strip()
        if taken:
            base = re.sub(r'\s*\d+$', '', name)
            n = 2
            cand = f"{base} {n}" if base.upper() != (source_name or '').strip().upper() else f"{name} {n}"
            existing = set(taken)
            while cand in existing:
                n += 1
                cand = f"{base} {n}"
            # ilk kayit numarasz kalir, yeni gelen numaralanir
            if name in existing:
                name = cand
        import hashlib
        eid = embed_id or f"{site[:2]}_{hashlib.md5(direct_url.encode()).hexdigest()[:10]}"
        cur.execute("""INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site, fansub)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                direct_url=excluded.direct_url, provider=excluded.provider,
                source_name=excluded.source_name, fansub=COALESCE(excluded.fansub, episode_sources.fansub)""",
            (episode_id, name, eid, direct_url, provider, site, fansub))
        new_src_id = cur.lastrowid
        try:
            cur.execute("SELECT drama_id, season_number, episode_number, episode_name FROM episodes WHERE id=?", (episode_id,))
            ep_row = cur.fetchone()
            if ep_row:
                d_id, s_num, ep_num, ep_name = ep_row
                d_title, d_slug, d_cover = get_drama_meta(cur, d_id)
                _RECENT_ADDED_SOURCES.append({
                    "id": new_src_id,
                    "episode_id": episode_id,
                    "drama_id": d_id,
                    "drama_title": d_title,
                    "drama_slug": d_slug,
                    "season_number": s_num,
                    "episode_number": ep_num,
                    "episode_name": ep_name,
                    "source_name": name,
                    "provider": provider,
                    "site": site,
                    "direct_url": direct_url,
                    "fansub": fansub,
                    "added_at": datetime.now().isoformat(),
                })
        except Exception:
            pass
        return True
    return _retry(_op)

def tag_site(cur, drama_id, site):
    cur.execute("SELECT alt_sites, source_url FROM dramas WHERE id=?", (drama_id,))
    r = cur.fetchone()
    try:
        sites = json.loads(r[0] or '[]') if r else []
    except Exception:
        sites = []
    if site not in sites:
        sites.append(site)
        _retry(cur.execute, "UPDATE dramas SET alt_sites=? WHERE id=?", (json.dumps(sites), drama_id))
    if r and r[1]:
        mark_done(cur, site, r[1])

def safe_commit(conn, tries=60):
    import random
    for i in range(tries):
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            if 'locked' not in str(e) or i == tries - 1:
                raise
            time.sleep(1 + i * 0.5 + random.random() * 2)

import os as _os

def load_done_urls(cur, site):
    """Daha once bu siteyle islenmis drama URL'leri (restart sonrasi atlama icin)."""
    cur.execute("SELECT source_url FROM dramas WHERE alt_sites LIKE ?", (f'%{site}%',))
    return set(r[0] for r in cur.fetchall())

def done_urls(cur, site):
    """site_done tablosundaki bitmis URL'ler (eslesenler dahil, kesin)."""
    try:
        cur.execute("SELECT url FROM site_done WHERE site=?", (site,))
        return set(r[0] for r in cur.fetchall())
    except Exception:
        return set()

def mark_done(cur, site, url):
    _retry(cur.execute, "INSERT OR IGNORE INTO site_done (site, url) VALUES (?, ?)", (site, url))

def unique_slug(cur, base):
    """Copismeyen slug uret: baz, baz-2, baz-3..."""
    slug = clean_scraped_slug(base) or "yapim"
    cand = slug
    n = 2
    while True:
        cur.execute("SELECT id FROM dramas WHERE slug=?", (cand,))
        if not cur.fetchone():
            return cand
        cand = f"{slug}-{n}"
        n += 1
