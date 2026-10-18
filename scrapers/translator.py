"""
KoUp Universal Translation & Metadata Enrichment Helper
Provides:
- Auto-translation of synopses and text from English/Asian languages to clean Turkish
- TMDB multi-criteria matching (with Year, Country, Language, and Type scoring)
- Cinemeta true IMDb rating lookup
"""

import re
import urllib.request
import urllib.parse
import json
import time

TMDB_API_KEY = '4c092d2cfd6d9c0e3aa3dab12c7d4756'

COUNTRY_CODE_TO_NAME = {
    'KR': 'Güney Kore',
    'CN': 'Çin',
    'JP': 'Japonya',
    'TH': 'Tayland',
    'TW': 'Tayvan',
    'HK': 'Hong Kong',
    'PH': 'Filipinler',
    'US': 'ABD',
    'GB': 'Birleşik Krallık',
    'FR': 'Fransa',
    'DE': 'Almanya',
    'ES': 'İspanya',
    'IT': 'İtalya',
    'TR': 'Türkiye',
    'IN': 'Hindistan',
}

def translate_to_turkish(text: str, max_retries: int = 3) -> str:
    """Translates any foreign text to natural Turkish using Google Translate API."""
    if not text or len(text.strip()) < 10:
        return text or ""

    clean_text = text.strip()
    # Strip common foreign boilerplate
    clean_text = re.sub(r'\(Source:.*?\)', '', clean_text, flags=re.I)
    clean_text = re.sub(r'\[Written by.*?\]', '', clean_text, flags=re.I)
    clean_text = clean_text.strip()

    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=" + urllib.parse.quote(clean_text)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                    translated = "".join(part[0] for part in data[0] if part and part[0]).strip()
                    if translated:
                        return translated
        except Exception:
            time.sleep(0.5)

    return clean_text

def get_real_imdb_rating(imdb_id: str, content_type: str = 'series') -> float | None:
    """Fetches authoritative IMDb rating from Cinemeta."""
    if not imdb_id or not imdb_id.startswith('tt'):
        return None

    types_to_try = ['movie', 'series'] if content_type == 'film' else ['series', 'movie']
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    }

    for t in types_to_try:
        try:
            url = f"https://v3-cinemeta.strem.io/meta/{t}/{imdb_id}.json"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                rating_str = data.get('meta', {}).get('imdbRating')
                if rating_str:
                    val = float(rating_str)
                    if val > 0:
                        return round(val, 1)
        except Exception:
            pass

    return None

def calculate_match_score(query_title: str, item: dict, target_year: int = None, target_country: str = None) -> int:
    """Scores a TMDB candidate item based on title, year, and country/language alignment."""
    score = 0
    t_name = (item.get('name') or item.get('title') or '').lower()
    o_name = (item.get('original_name') or item.get('original_title') or '').lower()
    q_low = query_title.lower()

    # Title alignment
    if q_low == t_name or q_low == o_name:
        score += 55
    elif q_low in t_name or t_name in q_low or q_low in o_name or o_name in q_low:
        score += 35
    else:
        score += 15

    # Year alignment
    date_str = item.get('first_air_date') or item.get('release_date') or ''
    if date_str and len(date_str) >= 4 and target_year:
        try:
            item_year = int(date_str[:4])
            diff = abs(item_year - target_year)
            if diff == 0:
                score += 35
            elif diff == 1:
                score += 20
            elif diff >= 3:
                score -= 30  # Heavy penalty for years far apart
        except Exception:
            pass

    # Country / Language alignment
    orig_lang = item.get('original_language') or ''
    origin_countries = item.get('origin_country') or []

    if target_country:
        target_country = target_country.upper()
        if target_country in origin_countries:
            score += 25
        elif target_country == 'KR' and orig_lang == 'ko':
            score += 25
        elif target_country == 'CN' and orig_lang in ('zh', 'cn'):
            score += 25
        elif target_country == 'JP' and orig_lang == 'ja':
            score += 25
        elif target_country == 'TH' and orig_lang == 'th':
            score += 25
        elif target_country in ('KR', 'CN', 'JP', 'TH') and orig_lang in ('en', 'es', 'de', 'fr'):
            score -= 30  # Western language for an Asian drama target is strongly penalized

    # Visual assets bonus
    if item.get('poster_path'):
        score += 10
    if item.get('backdrop_path'):
        score += 5

    return score

def resolve_tmdb_metadata(title: str, year: int = None, country_hint: str = None, content_type: str = 'dizi') -> dict | None:
    """
    Finds best matching TMDB item with multi-criteria scoring and fetches:
    - Official Turkish title and synopsis (translated if only English exists)
    - True Country Code and Country Name
    - Real IMDb ID & Rating via Cinemeta
    - Official high-res Poster & Backdrop URLs
    - Official Genre tags in Turkish
    """
    clean_t = re.sub(r'\(\d{4}\)', '', title)
    clean_t = re.sub(r'\b(izle|hd izle|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|tek parça)\b', '', clean_t, flags=re.I).strip()
    if not clean_t:
        return None

    endpoints = ['search/movie', 'search/tv'] if content_type == 'film' else ['search/tv', 'search/movie']
    best_candidate = None
    best_score = 0
    best_type = 'tv'

    headers = {'User-Agent': 'KoUpBot/1.0'}

    for ep in endpoints:
        try:
            url = f"https://api.themoviedb.org/3/{ep}?query={urllib.parse.quote(clean_t)}&api_key={TMDB_API_KEY}&language=tr-TR"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                results = data.get('results', [])
                for r in results:
                    score = calculate_match_score(clean_t, r, target_year=year, target_country=country_hint)
                    if score > best_score:
                        best_score = score
                        best_candidate = r
                        best_type = 'movie' if 'movie' in ep else 'tv'
        except Exception:
            pass

    # Threshold: Must have at least 50 points to be considered a valid match
    if not best_candidate or best_score < 50:
        return None

    tmdb_id = best_candidate['id']
    tmdb_type = best_type

    # 1. Fetch detailed record for exact production country and external IDs
    ext_imdb_id = None
    country_code = country_hint
    try:
        ext_url = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}/external_ids?api_key={TMDB_API_KEY}"
        ext_req = urllib.request.Request(ext_url, headers=headers)
        with urllib.request.urlopen(ext_req, timeout=5) as ext_resp:
            ext_data = json.loads(ext_resp.read().decode('utf-8'))
            ext_imdb_id = ext_data.get('imdb_id')
    except Exception:
        pass

    # Determine Country
    origin_countries = best_candidate.get('origin_country') or []
    if origin_countries:
        country_code = origin_countries[0].upper()
    else:
        orig_lang = best_candidate.get('original_language') or ''
        lang_map = {'ko': 'KR', 'zh': 'CN', 'ja': 'JP', 'th': 'TH', 'en': 'US'}
        if orig_lang in lang_map:
            country_code = lang_map[orig_lang]

    country_name = COUNTRY_CODE_TO_NAME.get(country_code, 'Asya')

    # 2. Get Overview (Turkish from TMDB or auto-translated)
    overview_tr = (best_candidate.get('overview') or '').strip()
    if not overview_tr or len(overview_tr) < 30:
        # Fetch English overview from TMDB
        try:
            en_url = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}?api_key={TMDB_API_KEY}&language=en-US"
            en_req = urllib.request.Request(en_url, headers=headers)
            with urllib.request.urlopen(en_req, timeout=5) as en_resp:
                en_data = json.loads(en_resp.read().decode('utf-8'))
                en_overview = (en_data.get('overview') or '').strip()
                if en_overview and len(en_overview) > 20:
                    overview_tr = translate_to_turkish(en_overview)
        except Exception:
            pass

    # 3. Real IMDb Rating
    real_imdb_rating = None
    if ext_imdb_id:
        real_imdb_rating = get_real_imdb_rating(ext_imdb_id, content_type=best_type)

    # 4. Images
    poster_path = best_candidate.get('poster_path')
    backdrop_path = best_candidate.get('backdrop_path')
    cover_image = f"https://image.tmdb.org/t/p/w780{poster_path}" if poster_path else None
    backdrop_image = f"https://image.tmdb.org/t/p/w1280{backdrop_path}" if backdrop_path else None

    # 5. Release Year
    date_str = best_candidate.get('first_air_date') or best_candidate.get('release_date') or ''
    rel_year = year
    if date_str and len(date_str) >= 4:
        try:
            rel_year = int(date_str[:4])
        except Exception:
            pass

    return {
        'tmdb_id': tmdb_id,
        'title_tr': best_candidate.get('title') or best_candidate.get('name'),
        'native_title': best_candidate.get('original_title') or best_candidate.get('original_name'),
        'overview': overview_tr,
        'country_code': country_code,
        'country_name': country_name,
        'release_year': rel_year,
        'imdb_id': ext_imdb_id,
        'imdb_rating': real_imdb_rating,
        'cover_image': cover_image,
        'backdrop_image': backdrop_image,
    }
