"""
Akıllı Dizi & Film Eşleştirme Modülü (Matching Engine)
- ID eşleşmesi (TMDB, IMDb, AniList, MyDramaList)
- Tür uyumu (film vs dizi, anime vs live-action, mini/short drama vs normal dizi)
- Yapım yılı kontrolü (farklı yapımları kesin eleme)
- Bölüm sayısı uyumu ve ceza puanlaması
- Normalize başlık benzerliği (SequenceMatcher)
- Sınırda kalan şüpheli eşleşmeleri Supabase `match_review_queue` tablosuna kaydetme
"""

import re
import difflib
from datetime import datetime, timezone
from scrapers.multisite import norm_title

VALID_YEAR_MIN = 1970
VALID_YEAR_MAX = 2030


def _parse_year(val) -> int | None:
    if not val:
        return None
    try:
        s = str(val).strip()
        m = re.search(r'\b(19\d\d|20\d\d)\b', s)
        if m:
            yr = int(m.group(1))
            if VALID_YEAR_MIN <= yr <= VALID_YEAR_MAX:
                return yr
    except Exception:
        pass
    return None


def _is_movie(d: dict) -> bool:
    ctype = (d.get("content_type") or "").lower()
    title = (d.get("title") or "").lower()
    if ctype in ("film", "movie", "movies") or d.get("is_movie"):
        return True
    if "film:" in title or "movie" in title:
        return True
    return False


def _is_anime(d: dict) -> bool:
    ctype = (d.get("content_type") or "").lower()
    title = (d.get("title") or "").lower()
    if ctype == "anime" or d.get("is_anime"):
        return True
    if "anime" in title and "live action" not in title:
        return True
    return False


def _is_short_drama(d: dict) -> bool:
    ctype = (d.get("content_type") or "").lower()
    title = (d.get("title") or "").lower()
    if ctype in ("short_drama", "minidrama", "kisa_dizi") or d.get("is_short_drama"):
        return True
    if any(k in title for k in ("kısa drama", "kisa drama", "mini drama", "short drama")):
        return True
    return False


def score_series_match(local_drama: dict, remote_candidate: dict) -> tuple[float, list[str]]:
    """
    Computes confidence score and explanatory reasons for matching remote candidate with local drama.
    Returns (score: float, reasons: list[str]).
    """
    reasons = []

    # 1. Exact ID match (highest priority, 1.0)
    for id_key in ("tmdb_id", "imdb_id", "anilist_id", "mdl_id"):
        local_id = str(local_drama.get(id_key) or "").strip()
        remote_id = str(remote_candidate.get(id_key) or "").strip()
        if local_id and remote_id and local_id not in ("0", "None", "") and local_id == remote_id:
            reasons.append(f"id_exact:{id_key}")
            return 1.0, reasons

    # 2. Type mismatch check
    loc_mov = _is_movie(local_drama)
    rem_mov = _is_movie(remote_candidate)
    if loc_mov != rem_mov:
        reasons.append(f"type_mismatch:movie({loc_mov}!=rem:{rem_mov})")
        return 0.0, reasons

    loc_ani = _is_anime(local_drama)
    rem_ani = _is_anime(remote_candidate)
    if loc_ani != rem_ani:
        # If anime vs live action mismatch
        reasons.append(f"type_mismatch:anime({loc_ani}!=rem:{rem_ani})")
        return 0.0, reasons

    loc_short = _is_short_drama(local_drama)
    rem_short = _is_short_drama(remote_candidate)
    if loc_short != rem_short:
        reasons.append(f"type_mismatch:short_drama({loc_short}!=rem:{rem_short})")
        return 0.0, reasons

    # 3. Production year check
    loc_yr = _parse_year(local_drama.get("release_year") or local_drama.get("year"))
    rem_yr = _parse_year(remote_candidate.get("release_year") or remote_candidate.get("year"))

    if loc_yr and rem_yr:
        if abs(loc_yr - rem_yr) > 1:
            reasons.append(f"year_mismatch:{loc_yr}!={rem_yr}")
            return 0.0, reasons
        else:
            reasons.append(f"year_compatible:{loc_yr}~={rem_yr}")

    # 4. Title normalization & similarity
    local_titles = []
    for k in ("title", "original_title", "english_title", "native_title"):
        v = local_drama.get(k)
        if v:
            local_titles.append(str(v))
    alt_raw = local_drama.get("alt_titles") or local_drama.get("tags")
    if isinstance(alt_raw, list):
        local_titles.extend(str(t) for t in alt_raw)
    elif isinstance(alt_raw, str) and alt_raw.strip():
        try:
            import json
            parsed = json.loads(alt_raw)
            if isinstance(parsed, list):
                local_titles.extend(str(t) for t in parsed)
        except Exception:
            local_titles.extend(t.strip() for t in alt_raw.split(","))

    remote_titles = []
    for k in ("title", "original_title", "english_title", "name"):
        v = remote_candidate.get(k)
        if v:
            remote_titles.append(str(v))
    rem_slug = remote_candidate.get("slug")
    if rem_slug:
        remote_titles.append(str(rem_slug).replace("-", " "))

    best_title_ratio = 0.0
    matched_pair = ("", "")
    for lt in local_titles:
        n_lt = norm_title(lt)
        if not n_lt:
            continue
        for rt in remote_titles:
            n_rt = norm_title(rt)
            if not n_rt:
                continue
            if n_lt == n_rt:
                ratio = 1.0
            else:
                len_ratio = min(len(n_lt), len(n_rt)) / max(len(n_lt), len(n_rt))
                if len(n_lt) <= 7 and len_ratio < 0.85:
                    continue
                ratio = difflib.SequenceMatcher(None, n_lt, n_rt).ratio()
            if ratio > best_title_ratio:
                best_title_ratio = ratio
                matched_pair = (n_lt, n_rt)

    if best_title_ratio < 0.50:
        reasons.append(f"title_mismatch:{best_title_ratio:.2f}")
        return 0.0, reasons

    # Base score calculated from title match
    if best_title_ratio >= 0.99:
        score = 0.75
        reasons.append("title_exact")
        if loc_yr and rem_yr and abs(loc_yr - rem_yr) <= 1:
            score += 0.15  # Reaches 0.90
            reasons.append("title_and_year_aligned")
    else:
        score = best_title_ratio * 0.75
        reasons.append(f"title_partial:{best_title_ratio:.2f}")
        if loc_yr and rem_yr and abs(loc_yr - rem_yr) <= 1:
            score += 0.10
            reasons.append("year_aligned")

    # 5. Episode count compatibility
    loc_ep_count = local_drama.get("episode_count") or local_drama.get("episodes_total")
    rem_max_ep = remote_candidate.get("max_episode") or remote_candidate.get("remote_max_ep") or remote_candidate.get("episode_count")

    if loc_ep_count is not None and rem_max_ep is not None:
        try:
            loc_ep = int(loc_ep_count)
            rem_ep = int(rem_max_ep)
            if not loc_mov and loc_ep > 0 and rem_ep > 0:
                threshold = max(loc_ep * 1.5, loc_ep + 8)
                if rem_ep > threshold:
                    score -= 0.35
                    reasons.append(f"episode_count_mismatch:loc_{loc_ep}_vs_rem_{rem_ep}")
                elif abs(loc_ep - rem_ep) <= 2:
                    score = min(1.0, score + 0.10)
                    reasons.append(f"episode_count_compatible:loc_{loc_ep}_vs_rem_{rem_ep}")
        except Exception:
            pass

    score = max(0.0, min(1.0, round(score, 3)))
    return score, reasons


def enqueue_match_review(
    site: str,
    remote_candidate: dict,
    local_drama: dict,
    score: float,
    reasons: list[str],
) -> bool:
    """
    Submits a borderline/suspicious match (0.55 <= score < 0.80) to Supabase `match_review_queue`.
    Never raises an exception; fails silently to preserve the scraping workflow.
    """
    if not (0.55 <= score < 0.80):
        return False

    try:
        from scrapers.supabase_sync_helper import sb_request

        remote_yr = _parse_year(remote_candidate.get("release_year") or remote_candidate.get("year"))
        local_yr = _parse_year(local_drama.get("release_year") or local_drama.get("year"))

        rem_ep = remote_candidate.get("max_episode") or remote_candidate.get("episode_count")
        try:
            rem_ep = int(rem_ep) if rem_ep is not None else None
        except Exception:
            rem_ep = None

        cand_did = local_drama.get("id")
        try:
            cand_did = int(cand_did) if cand_did is not None else None
        except Exception:
            cand_did = None

        payload_obj = {
            "remote": remote_candidate,
            "local": {
                "id": cand_did,
                "title": local_drama.get("title"),
                "slug": local_drama.get("slug"),
                "year": local_yr,
                "episode_count": local_drama.get("episode_count"),
            },
        }

        row = {
            "site": str(site or "unknown"),
            "remote_title": str(remote_candidate.get("title") or remote_candidate.get("name") or "Unknown"),
            "remote_url": str(remote_candidate.get("url") or remote_candidate.get("source_url") or ""),
            "remote_year": remote_yr,
            "remote_episode_count": rem_ep,
            "candidate_drama_id": cand_did,
            "candidate_title": str(local_drama.get("title") or ""),
            "candidate_year": local_yr,
            "score": float(score),
            "reasons": reasons,
            "payload": payload_obj,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        res = sb_request(
            "POST",
            "/rest/v1/match_review_queue",
            body=row,
            prefer="return=minimal",
        )
        if isinstance(res, dict) and res.get("_error"):
            return False
        return True
    except Exception:
        return False
