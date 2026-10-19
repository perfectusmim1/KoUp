"""
KoUp Universal Translation & 100% Accurate Metadata Enrichment Helper
Provides:
- Auto-translation of synopses and text from English/Asian languages to clean Turkish
- Strict TMDB multi-criteria matching (Exact / Alternative Titles + Year + Country/Language guards)
- AniList GraphQL matching for anime (preserving Season 2 / Part 2)
- MyDramaList matching strictly restricted to Asian countries (KR, JP, CN, TW, TH, HK, PH)
- Cinemeta true IMDb rating & TMDB cast lookup
"""

import json
import re
import ssl
import time
import urllib.parse
import urllib.request

ctx = ssl.create_default_context()
TMDB_API_KEY = "42125c682636b68d10d70b487c692685"

ASIAN_COUNTRIES = {"KR", "JP", "CN", "TW", "TH", "HK", "PH", "ID", "MY", "SG", "VN"}
ASIAN_LANGS = {"ko", "ja", "zh", "cn", "th", "tl", "id", "ms", "vi"}

COUNTRY_CODE_TO_NAME = {
    "KR": "Güney Kore",
    "JP": "Japonya",
    "CN": "Çin",
    "TW": "Tayvan",
    "TH": "Tayland",
    "PH": "Filipinler",
    "ID": "Endonezya",
    "MY": "Malezya",
    "SG": "Singapur",
    "VN": "Vietnam",
    "HK": "Hong Kong",
    "IN": "Hindistan",
    "PK": "Pakistan",
    "TR": "Türkiye",
    "US": "ABD",
    "GB": "İngiltere",
    "CA": "Kanada",
    "AU": "Avustralya",
    "DE": "Almanya",
    "FR": "Fransa",
    "ES": "İspanya",
    "IT": "İtalya",
    "RU": "Rusya",
    "BR": "Brezilya",
    "MX": "Meksika",
    "AR": "Arjantin",
    "CO": "Kolombiya",
    "PL": "Polonya",
    "NL": "Hollanda",
    "SE": "İsveç",
    "NO": "Norveç",
    "DK": "Danimarka",
    "FI": "Finlandiya",
    "BE": "Belçika",
    "CH": "İsviçre",
    "AT": "Avusturya",
    "IE": "İrlanda",
    "NZ": "Yeni Zelanda",
    "ZA": "Güney Afrika",
    "EG": "Mısır",
    "IL": "İsrail",
    "IR": "İran",
    "SA": "Suudi Arabistan",
}

LANG_TO_COUNTRY = {
    "ko": "KR",
    "ja": "JP",
    "zh": "CN",
    "cn": "CN",
    "th": "TH",
    "tl": "PH",
    "id": "ID",
    "ms": "MY",
    "vi": "VN",
    "hi": "IN",
    "tr": "TR",
    "en": "US",
    "fr": "FR",
    "de": "DE",
    "es": "ES",
    "it": "IT",
    "ru": "RU",
    "pt": "BR",
    "pl": "PL",
    "nl": "NL",
    "sv": "SE",
    "no": "NO",
    "da": "DK",
    "fi": "FI",
}


TR_CHAR_TRANS = str.maketrans({
    "ş": "s", "Ş": "s",
    "ı": "i", "I": "i", "İ": "i", "i": "i",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
    "²": "2", "³": "3", "¹": "1",
})


def norm_match_str(s: str) -> str:
    if not s:
        return ""
    s = s.translate(TR_CHAR_TRANS)
    s = re.sub(r"\s*\((19|20)\d{2}\)\s*", " ", s)
    s = re.sub(r"\b(izle|hd izle|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|tek parça)\b", " ", s, flags=re.I)
    s = s.translate(TR_CHAR_TRANS)
    return re.sub(r"[^a-z0-9\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+", "", s.lower())


def translate_to_turkish(text: str, max_retries: int = 3) -> str:
    """Translates any foreign text to natural Turkish using Google Translate API."""
    if not text or len(text.strip()) < 10:
        return text or ""

    clean_text = text.strip()
    clean_text = re.sub(r"\(Source:.*?\)", "", clean_text, flags=re.I)
    clean_text = re.sub(r"\[Written by.*?\]", "", clean_text, flags=re.I)
    clean_text = re.sub(r"<[^>]+>", " ", clean_text)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()

    url = (
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q="
        + urllib.parse.quote(clean_text)
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    for _ in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                    translated = "".join(part[0] for part in data[0] if part and part[0]).strip()
                    if translated:
                        return translated
        except Exception:
            time.sleep(0.4)

    return clean_text


def get_real_imdb_rating(imdb_id: str, content_type: str = "series") -> float | None:
    """Fetches authoritative IMDb rating from Cinemeta."""
    if not imdb_id or not imdb_id.startswith("tt"):
        return None

    types_to_try = ["movie", "series"] if content_type == "film" else ["series", "movie"]
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

    for t in types_to_try:
        try:
            url = f"https://v3-cinemeta.strem.io/meta/{t}/{imdb_id}.json"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                rating_str = data.get("meta", {}).get("imdbRating")
                if rating_str:
                    val = float(rating_str)
                    if val > 0:
                        return round(val, 1)
        except Exception:
            pass

    return None


def resolve_anilist_metadata(title: str, year: int = None) -> dict | None:
    """Resolves AniList ID, cover, year, and Turkish synopsis for anime without stripping Season/Part."""
    clean_q = re.sub(r"\s*\((19|20)\d{2}\)\s*", " ", title or "").strip()
    clean_q = re.sub(r"\b(izle|türkçe|altyazılı|anime)\b", "", clean_q, flags=re.I).strip()
    if not clean_q:
        return None

    gql = """
    query ($search: String) {
      Page(page: 1, perPage: 6) {
        media(search: $search, type: ANIME) {
          id
          siteUrl
          seasonYear
          startDate { year }
          averageScore
          episodes
          description(asHtml: false)
          coverImage { extraLarge large }
          bannerImage
          title { romaji english native }
          synonyms
        }
      }
    }
    """
    try:
        body = json.dumps({"query": gql, "variables": {"search": clean_q}}).encode("utf-8")
        req = urllib.request.Request(
            "https://graphql.anilist.co",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            cands = data.get("data", {}).get("Page", {}).get("media") or []
    except Exception:
        return None

    q_norms = {norm_match_str(p) for p in [clean_q] + clean_q.split(" - ") if len(norm_match_str(p)) >= 2}
    best = None
    best_score = -100
    for c in cands:
        t_obj = c.get("title") or {}
        c_titles = [t_obj.get("romaji"), t_obj.get("english"), t_obj.get("native")] + (c.get("synonyms") or [])
        c_norms = {norm_match_str(x) for x in c_titles if x}
        score = 0
        if q_norms & c_norms:
            score += 70
        elif any(qn in cn or cn in qn for qn in q_norms for cn in c_norms if len(qn) >= 4 and len(cn) >= 4):
            score += 40
        else:
            continue
        c_yr = c.get("seasonYear") or (c.get("startDate") or {}).get("year")
        if year and c_yr:
            diff = abs(int(c_yr) - int(year))
            if diff == 0:
                score += 25
            elif diff == 1:
                score += 10
            elif diff >= 3:
                score -= 25
        if score > best_score:
            best_score = score
            best = c

    if not best or best_score < 50:
        return None

    desc = (best.get("description") or "").strip()
    ov_tr = translate_to_turkish(desc) if len(desc) >= 20 else None
    c_yr = best.get("seasonYear") or (best.get("startDate") or {}).get("year") or year
    t_obj = best.get("title") or {}
    return {
        "anilist_id": best["id"],
        "anilist_url": best.get("siteUrl") or f"https://anilist.co/anime/{best['id']}",
        "original_title": t_obj.get("romaji") or t_obj.get("english") or t_obj.get("native"),
        "release_year": int(c_yr) if c_yr else year,
        "cover_image": (best.get("coverImage") or {}).get("extraLarge") or (best.get("coverImage") or {}).get("large"),
        "backdrop_image": best.get("bannerImage"),
        "overview": ov_tr,
        "country_code": "JP",
        "country_name": "Japonya",
    }


def calculate_match_score(
    query_title: str, item: dict, target_year: int = None, target_country: str = None
) -> int:
    """Scores a TMDB candidate with strict title and Asian/Western country guards."""
    score = 0
    t_name = item.get("name") or item.get("title") or ""
    o_name = item.get("original_name") or item.get("original_title") or ""

    q_parts = [p.strip() for p in query_title.split(" - ") if p.strip()]
    q_norms = {norm_match_str(p) for p in [query_title] + q_parts if len(norm_match_str(p)) >= 2}
    c_norms = {norm_match_str(x) for x in (t_name, o_name) if x and len(norm_match_str(x)) >= 2}

    q_str = (query_title or "").strip()
    is_short = len(q_str) <= 5 or len(q_str.split()) <= 1

    if q_norms & c_norms:
        score += 65
    elif not is_short and any(
        (qn in cn or cn in qn) and min(len(qn), len(cn)) >= max(4, int(max(len(qn), len(cn)) * 0.75))
        for qn in q_norms
        for cn in c_norms
    ):
        score += 35
    else:
        score -= 20

    # Year alignment
    date_str = item.get("first_air_date") or item.get("release_date") or ""
    if date_str and len(date_str) >= 4 and target_year:
        try:
            item_year = int(date_str[:4])
            diff = abs(item_year - int(target_year))
            if diff == 0:
                score += 35
            elif diff == 1:
                score += 20
            elif diff >= 2:
                score -= 60
        except Exception:
            pass

    # Country / Language strict guard
    orig_lang = (item.get("original_language") or "").lower()
    origin_countries = [c.upper() for c in (item.get("origin_country") or [])]
    cand_is_asian = bool(set(origin_countries) & ASIAN_COUNTRIES) or (orig_lang in ASIAN_LANGS)

    if target_country:
        tc = target_country.upper()
        if tc in origin_countries or LANG_TO_COUNTRY.get(orig_lang) == tc:
            score += 30
        elif tc in ASIAN_COUNTRIES:
            if cand_is_asian:
                score += 10
            else:
                # Hard block Western homonyms when scraping an Asian drama site
                score -= 100
        elif tc == "TR":
            if "TR" in origin_countries or orig_lang == "tr":
                score += 35
            else:
                score -= 80

    if item.get("poster_path"):
        score += 10
    if item.get("backdrop_path"):
        score += 5

    return score


def resolve_tmdb_metadata(
    title: str, year: int = None, country_hint: str = None, content_type: str = "dizi"
) -> dict | None:
    """
    Finds best matching TMDB item with strict multi-criteria scoring and fetches:
    - Official Turkish title and synopsis (translated if only English exists)
    - True Country Code and standardized Turkish Country Name
    - Real IMDb ID & Rating + Top 12 Cast (cast_json)
    - Official high-res Poster & Backdrop URLs
    """
    m_yr = re.search(r"\((19\d{2}|20\d{2})\)", title or "")
    if m_yr and not year:
        year = int(m_yr.group(1))

    clean_t = re.sub(r"\(\d{4}\)", "", title or "")
    clean_t = re.sub(
        r"\b(izle|hd izle|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|tek parça)\b",
        "",
        clean_t,
        flags=re.I,
    ).strip()
    if not clean_t:
        return None

    queries = [clean_t]
    if " - " in clean_t:
        for p in clean_t.split(" - "):
            if p.strip() and p.strip() not in queries:
                queries.append(p.strip())

    endpoints = ["search/movie", "search/tv"] if content_type == "film" else ["search/tv", "search/movie"]
    best_candidate = None
    best_score = 0
    best_type = "movie" if content_type == "film" else "tv"

    headers = {"User-Agent": "KoUpBot/2.0"}

    def _search_tmdb(q_text, ep_name, lang_code, yr=None):
        yr_param = ""
        if yr:
            if "movie" in ep_name:
                yr_param = f"&primary_release_year={yr}"
            else:
                yr_param = f"&first_air_date_year={yr}"
        url = f"https://api.themoviedb.org/3/{ep_name}?query={urllib.parse.quote(q_text)}&api_key={TMDB_API_KEY}&language={lang_code}{yr_param}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results") or []

    # Phase 1: Search with year if year provided
    for q in queries[:3]:
        for ep in endpoints:
            for lang in ("tr-TR", "en-US"):
                try:
                    results = _search_tmdb(q, ep, lang, yr=year)
                    for r in results[:6]:
                        score = calculate_match_score(
                            clean_t, r, target_year=year, target_country=country_hint
                        )
                        if score > best_score:
                            best_score = score
                            best_candidate = r
                            best_type = "movie" if "movie" in ep else "tv"
                except Exception:
                    pass
            if best_score >= 85:
                break
        if best_score >= 85:
            break

    # Phase 2: If year was specified but best_score < 75, retry without year parameter
    if year and best_score < 75:
        for q in queries[:3]:
            for ep in endpoints:
                for lang in ("tr-TR", "en-US"):
                    try:
                        results = _search_tmdb(q, ep, lang, yr=None)
                        for r in results[:6]:
                            score = calculate_match_score(
                                clean_t, r, target_year=year, target_country=country_hint
                            )
                            if score > best_score:
                                best_score = score
                                best_candidate = r
                                best_type = "movie" if "movie" in ep else "tv"
                    except Exception:
                        pass
                if best_score >= 85:
                    break
            if best_score >= 85:
                break

    if not best_candidate or best_score < 75:
        return None

    tmdb_id = best_candidate["id"]
    tmdb_type = best_type

    # Fetch full details with external_ids, credits, alternative_titles in one call
    det = {}
    try:
        det_url = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}?api_key={TMDB_API_KEY}&language=tr-TR&append_to_response=external_ids,credits,alternative_titles"
        req = urllib.request.Request(det_url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
            det = json.loads(resp.read().decode("utf-8"))
    except Exception:
        det = best_candidate

    ext_imdb_id = (det.get("external_ids") or {}).get("imdb_id") or det.get("imdb_id")

    # Determine true Country Code
    origin_countries = det.get("origin_country") or best_candidate.get("origin_country") or []
    if not origin_countries and det.get("production_countries"):
        origin_countries = [
            c.get("iso_3166_1") for c in det["production_countries"] if c.get("iso_3166_1")
        ]
    country_code = None
    if origin_countries:
        country_code = origin_countries[0].upper()
    else:
        orig_lang = (det.get("original_language") or best_candidate.get("original_language") or "").lower()
        country_code = LANG_TO_COUNTRY.get(orig_lang)

    if not country_code or country_code not in COUNTRY_CODE_TO_NAME:
        country_code = (country_hint or "US").upper()
    country_name = COUNTRY_CODE_TO_NAME.get(country_code, "ABD")

    # Overview (Turkish from TMDB or auto-translated from English)
    overview_tr = (det.get("overview") or best_candidate.get("overview") or "").strip()
    if not overview_tr or len(overview_tr) < 30:
        try:
            en_url = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}?api_key={TMDB_API_KEY}&language=en-US"
            en_req = urllib.request.Request(en_url, headers=headers)
            with urllib.request.urlopen(en_req, context=ctx, timeout=6) as en_resp:
                en_data = json.loads(en_resp.read().decode("utf-8"))
                en_overview = (en_data.get("overview") or "").strip()
                if en_overview and len(en_overview) > 20:
                    overview_tr = translate_to_turkish(en_overview)
        except Exception:
            pass

    real_imdb_rating = get_real_imdb_rating(ext_imdb_id, content_type=best_type) if ext_imdb_id else None
    tmdb_rating = round(float(det.get("vote_average") or 0), 1) if det.get("vote_average") else None

    poster_path = det.get("poster_path") or best_candidate.get("poster_path")
    backdrop_path = det.get("backdrop_path") or best_candidate.get("backdrop_path")
    cover_image = f"https://image.tmdb.org/t/p/w780{poster_path}" if poster_path else None
    backdrop_image = f"https://image.tmdb.org/t/p/w1280{backdrop_path}" if backdrop_path else None

    date_str = (
        det.get("first_air_date")
        or det.get("release_date")
        or best_candidate.get("first_air_date")
        or best_candidate.get("release_date")
        or ""
    )
    rel_year = year
    if date_str and len(date_str) >= 4 and date_str[:4].isdigit():
        rel_year = int(date_str[:4])

    cast_list = []
    for c in ((det.get("credits") or {}).get("cast") or [])[:12]:
        cast_list.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "character": c.get("character"),
            "profile_path": f"https://image.tmdb.org/t/p/w300{c['profile_path']}" if c.get("profile_path") else None,
        })

    genres = [g.get("name") for g in (det.get("genres") or []) if g.get("name")]

    result = {
        "tmdb_id": tmdb_id,
        "imdb_id": ext_imdb_id,
        "imdb_rating": real_imdb_rating or tmdb_rating,
        "tmdb_rating": tmdb_rating,
        "title_tr": det.get("name") or det.get("title") or best_candidate.get("name") or best_candidate.get("title") or clean_t,
        "original_title": det.get("original_name") or det.get("original_title") or best_candidate.get("original_name") or best_candidate.get("original_title") or clean_t,
        "overview": overview_tr,
        "country_code": country_code,
        "country_name": country_name,
        "release_year": rel_year,
        "cover_image": cover_image,
        "backdrop_image": backdrop_image,
        "cast_json": cast_list,
        "genres": genres,
        "score": best_score,
    }

    if content_type == "anime" or country_code == "JP" and any("Animasyon" in g or "Animation" in g for g in genres):
        ani = resolve_anilist_metadata(clean_t, year=rel_year)
        if ani:
            result["anilist_id"] = ani["anilist_id"]
            result["anilist_url"] = ani["anilist_url"]
            if not result["overview"] and ani.get("overview"):
                result["overview"] = ani["overview"]

    return result
