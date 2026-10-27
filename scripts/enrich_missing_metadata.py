#!/usr/bin/env python3
"""
KoUp Universal Metadata Retro-Enrichment Engine
- Scans webdrama_archive.db and Supabase for missing TMDB, IMDb, AniList, and MyDramaList IDs
- High-accuracy fuzzy & multi-language matching against:
    1. TMDB TV & Movie APIs (TMDB_API_KEY)
    2. AniList GraphQL API (ANIME)
    3. MyDramaList Search & Ratings (via curl_cffi chrome impersonation)
    4. Cinemeta IMDb authoritative ratings
- Enriches covers, backdrops, synopses, release years, countries, and cast
- Syncs updates to SQLite, Supabase public.media, and Cloudflare R2
"""

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher
import sqlite3

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    SUPABASE_URL,
    SUPABASE_KEY,
    sb_request,
    backup_db_to_r2,
)
from scrapers.translator import (
    TMDB_API_KEY,
    resolve_tmdb_metadata,
    sanitize_media_title,
    translate_to_turkish,
    get_real_imdb_rating,
    COUNTRY_CODE_TO_NAME,
)

DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")
ctx = ssl.create_default_context()

try:
    from curl_cffi import requests as cffi_requests
    from bs4 import BeautifulSoup
    HAVE_CURL_CFFI = True
except ImportError:
    HAVE_CURL_CFFI = False


def norm_title(s: str) -> str:
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"[\(\)\[\]\{\}\-_:;,\.!\?\'\"\+~`&*/\\]", " ", s)
    s = s.replace("ş", "s").replace("ı", "i").replace("ğ", "g").replace("ü", "u").replace("ö", "o").replace("ç", "c")
    s = s.replace("é", "e").replace("è", "e").replace("à", "a").replace("á", "a")
    return re.sub(r"\s+", " ", s).strip()


def title_sim(t1: str, t2: str) -> float:
    n1, n2 = norm_title(t1), norm_title(t2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0
    return SequenceMatcher(None, n1, n2).ratio()


# --- ANILIST DIRECT GRAPHQL ENRICHER ---

ANILIST_GQL = """
query ($search: String) {
  Page(page: 1, perPage: 8) {
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
      genres
    }
  }
}
"""


def search_anilist_robust(title: str, year: int = None) -> dict | None:
    clean_q = sanitize_media_title(title)
    if not clean_q:
        return None

    # Variants to try
    cands_queries = [clean_q]
    # Strip season or part if present
    sub_title = re.sub(r"\b(?:season\s*\d+|\d+\.\s*sezon|part\s*\d+|movie|film|ova|special)\b.*$", "", clean_q, flags=re.I).strip()
    if sub_title and len(sub_title) >= 3 and sub_title not in cands_queries:
        cands_queries.append(sub_title)
    if ":" in clean_q:
        p0 = clean_q.split(":", 1)[0].strip()
        if len(p0) >= 3 and p0 not in cands_queries:
            cands_queries.append(p0)
    if " - " in clean_q:
        p0 = clean_q.split(" - ", 1)[0].strip()
        if len(p0) >= 3 and p0 not in cands_queries:
            cands_queries.append(p0)

    for q in cands_queries[:3]:
        try:
            body = json.dumps({"query": ANILIST_GQL, "variables": {"search": q}}).encode("utf-8")
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=body,
                headers={"Content-Type": "application/json", "User-Agent": "KoUpMetadataEnricher/1.0"},
            )
            with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                media_list = data.get("data", {}).get("Page", {}).get("media") or []
        except Exception:
            continue

        best_cand = None
        best_score = 0.0

        for m in media_list:
            t_obj = m.get("title") or {}
            c_titles = [t_obj.get("romaji"), t_obj.get("english"), t_obj.get("native")] + (m.get("synonyms") or [])
            c_titles = [t for t in c_titles if t]
            sim = max((title_sim(clean_q, ct) for ct in c_titles), default=0.0)
            is_short = len(clean_q.split()) <= 2
            if (is_short and sim < 0.85) or (not is_short and sim < 0.70):
                continue

            c_yr = m.get("seasonYear") or (m.get("startDate") or {}).get("year")
            score = sim * 100.0

            if year and c_yr:
                ydiff = abs(int(c_yr) - int(year))
                if ydiff == 0:
                    score += 20.0
                elif ydiff == 1:
                    score += 10.0
                elif ydiff >= 3:
                    score -= 40.0

            if score > best_score:
                best_score = score
                best_cand = m

        if best_cand and best_score >= 80.0:
            desc = (best_cand.get("description") or "").strip()
            ov_tr = translate_to_turkish(desc) if len(desc) >= 20 else None
            c_yr = best_cand.get("seasonYear") or (best_cand.get("startDate") or {}).get("year") or year
            t_obj = best_cand.get("title") or {}
            cover = (best_cand.get("coverImage") or {}).get("extraLarge") or (best_cand.get("coverImage") or {}).get("large")
            banner = best_cand.get("bannerImage")
            avg_score = best_cand.get("averageScore")
            genres = best_cand.get("genres") or []

            return {
                "anilist_id": best_cand["id"],
                "anilist_url": best_cand.get("siteUrl") or f"https://anilist.co/anime/{best_cand['id']}",
                "original_title": t_obj.get("romaji") or t_obj.get("english") or t_obj.get("native"),
                "release_year": int(c_yr) if c_yr else year,
                "cover_image": cover,
                "backdrop_image": banner,
                "overview": ov_tr,
                "anilist_rating": int(avg_score) if avg_score else None,
                "genres": genres,
            }

    return None


# --- MYDRAMALIST SEARCH ENRICHER ---

COUNTRY_MDL_MAP = {
    "KR": "Korean",
    "CN": "Chinese",
    "JP": "Japanese",
    "TW": "Taiwanese",
    "TH": "Thai",
    "HK": "Hong Kong",
    "PH": "Filipino",
}


def search_mydramalist_robust(title: str, year: int = None, country: str = None) -> dict | None:
    if not HAVE_CURL_CFFI:
        return None

    clean_q = sanitize_media_title(title)
    if not clean_q:
        return None

    queries_to_try = [clean_q]
    if ":" in clean_q:
        p = clean_q.split(":", 1)[0].strip()
        if len(p) >= 3 and p not in queries_to_try:
            queries_to_try.append(p)
    if " - " in clean_q:
        p = clean_q.split(" - ", 1)[0].strip()
        if len(p) >= 3 and p not in queries_to_try:
            queries_to_try.append(p)

    target_country_label = COUNTRY_MDL_MAP.get((country or "").upper(), "")

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
    }

    for q in queries_to_try[:2]:
        try:
            url = f"https://mydramalist.com/search?q={urllib.parse.quote(q)}"
            r = cffi_requests.get(url, impersonate="chrome120", headers=headers, timeout=10)
            if r.status_code != 200:
                continue

            soup = BeautifulSoup(r.text, "html.parser")
            rows = soup.select("div.box-body .row")
            if not rows:
                continue

            best_match = None
            best_score = 0.0

            for row in rows[:6]:
                a_title = row.select_one("h6.text-primary a")
                if not a_title or not a_title.get("href"):
                    continue

                href = a_title["href"].strip()
                # Skip people or network links
                if href.startswith("/people/") or href.startswith("/network/"):
                    continue

                slug = href.lstrip("/")
                cand_title = a_title.get_text(strip=True)

                meta_el = row.select_one(".text-muted")
                meta_text = meta_el.get_text(strip=True) if meta_el else ""

                cand_year = None
                m_yr = re.search(r"\b(19\d{2}|20\d{2})\b", meta_text)
                if m_yr:
                    cand_year = int(m_yr.group(1))

                score_el = row.select_one(".p-l-xs.score, .score")
                cand_score = None
                if score_el:
                    s_str = score_el.get_text(strip=True)
                    try:
                        cand_score = round(float(s_str), 1)
                    except Exception:
                        pass

                sim = title_sim(clean_q, cand_title)
                is_short = len(clean_q.split()) <= 2
                if (is_short and sim < 0.85) or (not is_short and sim < 0.72):
                    continue

                score = sim * 100.0

                if target_country_label and target_country_label in meta_text:
                    score += 20.0
                elif target_country_label and not any(c in meta_text for c in COUNTRY_MDL_MAP.values()):
                    score -= 10.0

                if year and cand_year:
                    ydiff = abs(cand_year - int(year))
                    if ydiff == 0:
                        score += 20.0
                    elif ydiff == 1:
                        score += 10.0
                    elif ydiff >= 3:
                        score -= 50.0

                if score > best_score:
                    best_score = score
                    best_match = {
                        "mydramalist_url": f"https://mydramalist.com/{slug}",
                        "mdl_id": slug,
                        "mdl_rating": cand_score,
                        "release_year": cand_year,
                    }

            if best_match and best_score >= 85.0:
                return best_match

        except Exception:
            continue

    return None


# --- SUPABASE BULK PATCH ---

def patch_supabase_media_bulk(updates_list: list, max_workers: int = 8) -> int:
    """Updates public.media rows on Supabase via parallel PATCH requests."""
    if not SUPABASE_URL or not SUPABASE_KEY or not updates_list:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    def patch_single(item):
        p_id = item["id"]
        patch_payload = {k: v for k, v in item.items() if k != "id"}
        patch_url = f"{SUPABASE_URL}/rest/v1/media?id=eq.{p_id}"
        req = urllib.request.Request(
            patch_url, data=json.dumps(patch_payload).encode("utf-8"), headers=headers, method="PATCH"
        )
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=10) as p_resp:
                if p_resp.status in (200, 204):
                    return True
        except Exception:
            pass
        return False

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = executor.map(patch_single, updates_list)
        return sum(1 for r in results if r)


# --- MAIN ENRICHMENT PIPELINE ---

def run_enrichment(mode: str = "all", limit: int = None, dry_run: bool = False, workers: int = 4):
    t0 = time.time()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    stats = {
        "tmdb_dizi_film_matched": 0,
        "anilist_anime_matched": 0,
        "tmdb_anime_matched": 0,
        "mdl_matched": 0,
        "covers_healed": 0,
        "overviews_healed": 0,
        "sqlite_updated": 0,
        "supabase_synced": 0,
    }

    supabase_patches = []

    # -------------------------------------------------------------
    # 1. DIZI & FILM TMDB ENRICHMENT
    # -------------------------------------------------------------
    if mode in ("all", "tmdb"):
        cur.execute(
            """
            SELECT id, title, native_title, release_year, country, content_type, imdb_id, cover_image, backdrop_image, overview
            FROM dramas
            WHERE content_type IN ('dizi', 'film', 'program')
              AND (tmdb_id IS NULL OR tmdb_id = 0)
            ORDER BY id ASC
            """
        )
        dizi_film_rows = cur.fetchall()
        if limit:
            dizi_film_rows = dizi_film_rows[:limit]

        print(f"\n[PHASE 1] TMDB Dizi/Film Enrichment: {len(dizi_film_rows)} items to process...", flush=True)

        def process_dizi_film(row):
            d_id, title, native_t, rel_yr, country, ctype, imdb_id, cov, bdrop, ov = row
            yr = int(rel_yr) if (rel_yr and str(rel_yr).isdigit()) else None

            # 1. Try with title
            res = resolve_tmdb_metadata(
                title=title,
                year=yr,
                country_hint=country,
                content_type="film" if ctype == "film" else "dizi",
                imdb_id=imdb_id,
            )

            # 2. Try native_title if present and didn't match
            if not res and native_t and len(native_t) >= 2 and native_t != title:
                res = resolve_tmdb_metadata(
                    title=native_t,
                    year=yr,
                    country_hint=country,
                    content_type="film" if ctype == "film" else "dizi",
                )

            if not res:
                return None

            return (d_id, row, res)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(process_dizi_film, r) for r in dizi_film_rows]
            for f in as_completed(futures):
                item = f.result()
                if not item:
                    continue

                d_id, old_row, res = item
                _, old_t, _, old_yr, old_c, _, old_imdb, old_cov, old_bdrop, old_ov = old_row

                stats["tmdb_dizi_film_matched"] += 1
                tmdb_id = res.get("tmdb_id")
                new_imdb = res.get("imdb_id") or old_imdb
                new_cov = res.get("cover_image") or old_cov
                new_bdrop = res.get("backdrop_image") or old_bdrop
                new_ov = res.get("overview") or old_ov
                new_yr = res.get("release_year") or old_yr
                new_country = res.get("country_code") or old_c
                new_country_name = res.get("country_name") or COUNTRY_CODE_TO_NAME.get(new_country, "Güney Kore")
                now_iso = datetime.now(timezone.utc).isoformat()

                if not old_cov and new_cov:
                    stats["covers_healed"] += 1
                if not old_ov and new_ov:
                    stats["overviews_healed"] += 1

                print(f"  ✓ [TMDB MATCH #{d_id}] {old_t} -> TMDB {tmdb_id} | IMDb: {new_imdb} | Poster: {'✓' if new_cov else 'x'}", flush=True)

                if not dry_run:
                    cur.execute(
                        """
                        UPDATE dramas
                        SET tmdb_id = ?, imdb_id = ?, cover_image = ?, backdrop_image = ?,
                            overview = ?, country = ?, country_name = ?, release_year = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (tmdb_id, new_imdb, new_cov, new_bdrop, new_ov, new_country, new_country_name, new_yr, now_iso, d_id),
                    )
                    stats["sqlite_updated"] += 1

                    sb_patch = {
                        "id": d_id,
                        "tmdb_id": tmdb_id,
                        "imdb_id": new_imdb,
                        "cover_image": new_cov,
                        "backdrop_image": new_bdrop,
                        "overview": new_ov,
                        "country_code": new_country,
                        "country_name": new_country_name,
                        "release_year": int(new_yr) if (new_yr and str(new_yr).isdigit()) else None,
                        "updated_at": now_iso,
                    }
                    if res.get("tmdb_rating"):
                        sb_patch["site_rating"] = res["tmdb_rating"]
                    if res.get("imdb_rating"):
                        sb_patch["imdb_rating"] = res["imdb_rating"]
                    supabase_patches.append(sb_patch)

        if not dry_run:
            conn.commit()

    # -------------------------------------------------------------
    # 2. ANIME ANILIST ENRICHMENT
    # -------------------------------------------------------------
    if mode in ("all", "anilist"):
        cur.execute(
            """
            SELECT id, title, native_title, release_year, cover_image, backdrop_image, overview
            FROM dramas
            WHERE content_type = 'anime'
              AND (anilist_id IS NULL OR anilist_id = 0)
            ORDER BY id ASC
            """
        )
        anime_rows = cur.fetchall()
        if limit:
            anime_rows = anime_rows[:limit]

        print(f"\n[PHASE 2] AniList Anime Enrichment: {len(anime_rows)} items to process...", flush=True)

        def process_anime_anilist(row):
            d_id, title, native_t, rel_yr, cov, bdrop, ov = row
            yr = int(rel_yr) if (rel_yr and str(rel_yr).isdigit()) else None

            res = search_anilist_robust(title, yr)
            if not res and native_t and native_t != title:
                res = search_anilist_robust(native_t, yr)

            if not res:
                return None
            return (d_id, row, res)

        with ThreadPoolExecutor(max_workers=min(workers, 3)) as executor:
            futures = [executor.submit(process_anime_anilist, r) for r in anime_rows]
            for f in as_completed(futures):
                item = f.result()
                if not item:
                    continue

                d_id, old_row, res = item
                _, old_t, _, old_yr, old_cov, old_bdrop, old_ov = old_row

                stats["anilist_anime_matched"] += 1
                anilist_id = res["anilist_id"]
                anilist_url = res["anilist_url"]
                new_cov = res.get("cover_image") or old_cov
                new_bdrop = res.get("backdrop_image") or old_bdrop
                new_ov = res.get("overview") or old_ov
                new_yr = res.get("release_year") or old_yr
                now_iso = datetime.now(timezone.utc).isoformat()

                if not old_cov and new_cov:
                    stats["covers_healed"] += 1
                if not old_ov and new_ov:
                    stats["overviews_healed"] += 1

                print(f"  ✓ [ANILIST MATCH #{d_id}] {old_t} -> AniList #{anilist_id} ({anilist_url})", flush=True)

                if not dry_run:
                    cur.execute(
                        """
                        UPDATE dramas
                        SET anilist_id = ?, anilist_url = ?, cover_image = ?, backdrop_image = ?,
                            overview = ?, release_year = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (anilist_id, anilist_url, new_cov, new_bdrop, new_ov, new_yr, now_iso, d_id),
                    )
                    stats["sqlite_updated"] += 1

                    sb_patch = {
                        "id": d_id,
                        "anilist_id": anilist_id,
                        "anilist_url": anilist_url,
                        "cover_image": new_cov,
                        "backdrop_image": new_bdrop,
                        "overview": new_ov,
                        "release_year": int(new_yr) if (new_yr and str(new_yr).isdigit()) else None,
                        "updated_at": now_iso,
                    }
                    if res.get("anilist_rating"):
                        sb_patch["anilist_rating"] = res["anilist_rating"]
                    supabase_patches.append(sb_patch)

        if not dry_run:
            conn.commit()

    # -------------------------------------------------------------
    # 3. ANIME TMDB ENRICHMENT (For anime that also exist on TMDB)
    # -------------------------------------------------------------
    if mode in ("all", "anime_tmdb"):
        cur.execute(
            """
            SELECT id, title, native_title, release_year, imdb_id, cover_image, backdrop_image, overview
            FROM dramas
            WHERE content_type = 'anime'
              AND (tmdb_id IS NULL OR tmdb_id = 0)
            ORDER BY id ASC
            """
        )
        anime_tmdb_rows = cur.fetchall()
        if limit:
            anime_tmdb_rows = anime_tmdb_rows[:limit]

        print(f"\n[PHASE 3] Anime TMDB Enrichment: {len(anime_tmdb_rows)} items to process...", flush=True)

        def process_anime_tmdb(row):
            d_id, title, native_t, rel_yr, imdb_id, cov, bdrop, ov = row
            yr = int(rel_yr) if (rel_yr and str(rel_yr).isdigit()) else None

            res = resolve_tmdb_metadata(title=title, year=yr, country_hint="JP", content_type="dizi", imdb_id=imdb_id)
            if not res and native_t and native_t != title:
                res = resolve_tmdb_metadata(title=native_t, year=yr, country_hint="JP", content_type="dizi")
            if not res:
                res = resolve_tmdb_metadata(title=title, year=yr, country_hint="JP", content_type="film", imdb_id=imdb_id)

            if not res:
                return None
            return (d_id, row, res)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(process_anime_tmdb, r) for r in anime_tmdb_rows]
            for f in as_completed(futures):
                item = f.result()
                if not item:
                    continue

                d_id, old_row, res = item
                _, old_t, _, old_yr, old_imdb, old_cov, old_bdrop, old_ov = old_row

                stats["tmdb_anime_matched"] += 1
                tmdb_id = res.get("tmdb_id")
                new_imdb = res.get("imdb_id") or old_imdb
                new_bdrop = res.get("backdrop_image") or old_bdrop
                new_cov = res.get("cover_image") or old_cov
                now_iso = datetime.now(timezone.utc).isoformat()

                print(f"  ✓ [ANIME TMDB MATCH #{d_id}] {old_t} -> TMDB {tmdb_id} | IMDb: {new_imdb}", flush=True)

                if not dry_run:
                    cur.execute(
                        """
                        UPDATE dramas
                        SET tmdb_id = ?, imdb_id = ?, backdrop_image = COALESCE(backdrop_image, ?),
                            cover_image = COALESCE(cover_image, ?), updated_at = ?
                        WHERE id = ?
                        """,
                        (tmdb_id, new_imdb, new_bdrop, new_cov, now_iso, d_id),
                    )
                    stats["sqlite_updated"] += 1

                    sb_patch = {
                        "id": d_id,
                        "tmdb_id": tmdb_id,
                        "imdb_id": new_imdb,
                        "updated_at": now_iso,
                    }
                    if new_bdrop:
                        sb_patch["backdrop_image"] = new_bdrop
                    if res.get("imdb_rating"):
                        sb_patch["imdb_rating"] = res["imdb_rating"]
                    supabase_patches.append(sb_patch)

        if not dry_run:
            conn.commit()

    # -------------------------------------------------------------
    # 4. ASIAN LIVE-ACTION MYDRAMALIST ENRICHMENT
    # -------------------------------------------------------------
    if mode in ("all", "mdl") and HAVE_CURL_CFFI:
        cur.execute(
            """
            SELECT id, title, native_title, release_year, country
            FROM dramas
            WHERE content_type IN ('dizi', 'film')
              AND (country IN ('KR', 'JP', 'CN', 'TW', 'TH', 'HK', 'PH') OR country_name LIKE '%Kore%' OR country_name LIKE '%Çin%' OR country_name LIKE '%Japon%')
              AND (mydramalist_url IS NULL OR mydramalist_url = '')
              AND (genres IS NULL OR (genres NOT LIKE '%anime%' AND genres NOT LIKE '%animasyon%'))
              AND title NOT LIKE 'Gekijouban%'
            ORDER BY id ASC
            """
        )
        mdl_rows = cur.fetchall()
        if limit:
            mdl_rows = mdl_rows[:limit]

        print(f"\n[PHASE 4] Asian Drama MyDramaList Enrichment: {len(mdl_rows)} items to process...", flush=True)

        def process_mdl(row):
            d_id, title, native_t, rel_yr, country = row
            yr = int(rel_yr) if (rel_yr and str(rel_yr).isdigit()) else None

            res = search_mydramalist_robust(title, yr, country)
            if not res and native_t and native_t != title:
                res = search_mydramalist_robust(native_t, yr, country)

            if not res:
                return None
            return (d_id, row, res)

        with ThreadPoolExecutor(max_workers=min(workers, 3)) as executor:
            futures = [executor.submit(process_mdl, r) for r in mdl_rows]
            for f in as_completed(futures):
                item = f.result()
                if not item:
                    continue

                d_id, old_row, res = item
                _, old_t, _, _, _ = old_row

                stats["mdl_matched"] += 1
                mdl_url = res["mydramalist_url"]
                mdl_id = res["mdl_id"]
                mdl_rating = res.get("mdl_rating")
                now_iso = datetime.now(timezone.utc).isoformat()

                print(f"  ✓ [MDL MATCH #{d_id}] {old_t} -> {mdl_url} (Score: {mdl_rating})", flush=True)

                if not dry_run:
                    cur.execute(
                        """
                        UPDATE dramas
                        SET mydramalist_url = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (mdl_url, now_iso, d_id),
                    )
                    stats["sqlite_updated"] += 1

                    sb_patch = {
                        "id": d_id,
                        "mydramalist_url": mdl_url,
                        "mdl_id": mdl_id,
                        "updated_at": now_iso,
                    }
                    if mdl_rating:
                        sb_patch["mdl_rating"] = mdl_rating
                    supabase_patches.append(sb_patch)

        if not dry_run:
            conn.commit()

    # -------------------------------------------------------------
    # 5. HEAL COVERS (If any items still lack covers)
    # -------------------------------------------------------------
    if mode in ("all", "covers"):
        cur.execute(
            """
            SELECT id, title, release_year, content_type, source_url
            FROM dramas
            WHERE cover_image IS NULL OR cover_image = ''
            """
        )
        empty_cov_rows = cur.fetchall()
        if empty_cov_rows:
            print(f"\n[PHASE 5] Healing {len(empty_cov_rows)} items missing covers...", flush=True)
            for row in empty_cov_rows:
                d_id, title, yr, ctype, src_url = row
                yr_val = int(yr) if (yr and str(yr).isdigit()) else None
                cov = None
                res = resolve_tmdb_metadata(title, yr_val, content_type="film" if ctype == "film" else "dizi")
                if res and res.get("cover_image"):
                    cov = res["cover_image"]
                elif src_url:
                    try:
                        req = urllib.request.Request(src_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, context=ctx, timeout=6) as s_resp:
                            html = s_resp.read().decode("utf-8", "ignore")
                            m_img = re.search(r'property=["\']og:image["\']\s+content=["\']([^"\']+)["\']', html)
                            if not m_img:
                                m_img = re.search(r'content=["\']([^"\']+)["\']\s+property=["\']og:image["\']', html)
                            if m_img:
                                cov = m_img.group(1).strip()
                    except Exception:
                        pass

                if not cov:
                    cov = "/logo-dark.png"

                stats["covers_healed"] += 1
                print(f"  ✓ [COVER HEALED #{d_id}] -> {cov}", flush=True)
                if not dry_run:
                    cur.execute("UPDATE dramas SET cover_image = ? WHERE id = ?", (cov, d_id))
                    supabase_patches.append({"id": d_id, "cover_image": cov})
            if not dry_run:
                conn.commit()

    # -------------------------------------------------------------
    # 6. SYNC TO SUPABASE & R2
    # -------------------------------------------------------------
    if not dry_run and supabase_patches:
        print(f"\n[SYNC] Syncing {len(supabase_patches)} updated entries to Supabase public.media...", flush=True)
        synced_count = patch_supabase_media_bulk(supabase_patches)
        stats["supabase_synced"] = synced_count
        print(f"[SYNC] Successfully updated {synced_count}/{len(supabase_patches)} rows in Supabase.", flush=True)

        print("[SYNC] Checkpointing SQLite WAL and uploading backup to Cloudflare R2...", flush=True)
        try:
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.commit()
            r2_ok = backup_db_to_r2()
            print(f"[SYNC] Cloudflare R2 backup status: {'OK' if r2_ok else 'FAILED/SKIPPED'}", flush=True)
        except Exception as e:
            print(f"[SYNC] Cloudflare R2 backup error: {e}", flush=True)

    conn.close()
    elapsed = time.time() - t0

    print("\n" + "=" * 55, flush=True)
    print("METADATA ENRICHMENT SUMMARY", flush=True)
    print("=" * 55, flush=True)
    print(f"Elapsed Time:                {elapsed:.1f}s")
    print(f"Dizi & Film TMDB Matched:    {stats['tmdb_dizi_film_matched']}")
    print(f"Anime AniList Matched:       {stats['anilist_anime_matched']}")
    print(f"Anime TMDB Matched:          {stats['tmdb_anime_matched']}")
    print(f"Asian Drama MDL Matched:     {stats['mdl_matched']}")
    print(f"Covers Healed:               {stats['covers_healed']}")
    print(f"Overviews Healed:            {stats['overviews_healed']}")
    print(f"SQLite Records Updated:      {stats['sqlite_updated']}")
    print(f"Supabase Records Synced:     {stats['supabase_synced']}")
    print("=" * 55 + "\n", flush=True)

    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Retroactively enrich missing TMDB, IMDb, AniList, and MDL metadata.")
    parser.add_argument("--mode", choices=["all", "tmdb", "anilist", "mdl", "anime_tmdb", "covers"], default="all")
    parser.add_argument("--limit", type=int, default=None, help="Max items per phase")
    parser.add_argument("--dry-run", action="store_true", help="Search without updating database")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent workers")
    args = parser.parse_args()

    run_enrichment(mode=args.mode, limit=args.limit, dry_run=args.dry_run, workers=args.workers)
