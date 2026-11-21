#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/merge_all_duplicates.py

Unified Idempotent Archive Deduplication Engine (SQLite + Supabase + R2):
1. SQLite actors + drama_actors merge (delegates to merge_sqlite_actors.run_sqlite_actor_merge)
2. Supabase people merge (normalized name, clean slug, compact slug, tmdb_id, anilist_id)
   + media_cast duplicate (media_id, person_id) consolidation (keeps 'lead' & min billing_order)
3. SQLite dramas merge:
   - Candidate pools: (tmdb_id, movie|tv), anilist_id, mydramalist_url, normalized title+year, -N slug base
   - Strict season/OVA/ID guards: NEVER merges distinct seasons/OVAs or TV/movie TMDB ID collisions
     or conflicting TMDB/AniList/IMDb/MDL IDs
   - Migrates episodes, sources, drama_actors, franchise_items, series_automations
   - Optionally cleans Supabase & R2 bundles (--sync-remote)
4. SQLite episodes duplicate (drama_id, season_number, episode_number) merger
5. SQLite episode_sources normalized URL duplicate merger (http/https + trailing slash)
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from difflib import SequenceMatcher
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.merge_sqlite_actors import run_sqlite_actor_merge

_TR_MAP = str.maketrans({
    "ı": "i", "İ": "i", "I": "i",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
})

SEQUEL_SPECIAL_PATTERNS = [
    r"\b(?:season\s*\d+|\d+\.?\s*sezon|\d+(?:st|nd|rd|th)\s*season)\b",
    r"\b(?:part\s*\d+)\b",
    r"\b(?:specials?|recap|prologue|epilogue|extra\s*stage|side\s*[a-z]|final\s*series|final\s*season|kai)\b",
    r"\b(?:ova|oav|ona)\b",
    r"\b(?:movie|\bfilm\b)\b",
    r"\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b",
    r"\b(?:2nd|3rd|4th|5th)\b",
]


def _progress(stage: str, current: int, total: int, detail: str = "") -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    pct = (current / total * 100.0) if total > 0 else 100.0
    print(f"[{ts}] [{current}/{total}] ({pct:.1f}%) - {stage}: {detail}", flush=True)


def _resolve_db_path(cli_db: str | None) -> str:
    if cli_db:
        return cli_db
    return os.environ.get("ARCHIVE_DB_PATH") or os.path.join(_ROOT, "webdrama_archive.db")


def clean_slug(slug: str) -> str:
    if not slug:
        return "actor"
    s = slug.lower().strip()
    if s.startswith("char-"):
        s = s[5:]
    s = re.sub(r"-\d+$", "", s).strip("-")
    return s or "actor"


def compact_slug(slug: str) -> str:
    if not slug:
        return ""
    cs = clean_slug(slug).translate(_TR_MAP).lower()
    cs = unicodedata.normalize("NFKD", cs).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", cs)


def norm_name(text: str) -> str:
    if not text:
        return ""
    s = str(text).translate(_TR_MAP).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s)


def normalize_title(t: str) -> str:
    if not t:
        return ""
    s = str(t).translate(_TR_MAP).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s)


def get_clean_title(t: str) -> str:
    s = str(t or "").strip()
    s = re.sub(r"\s*\((19|20)\d\d\).*$", "", s)
    s = re.sub(r"\s+(?:20\d\d|kore|cin|japon|tayland|filipinler|asya|izle|hd|box|you|di|ad|ak|aw)$", "", s, flags=re.I)
    s = re.sub(r"-(?:izle|box|you|di|ad|ak|aw|hdf|hd|dizi|film|kore|cin|japon|tayland|20\d\d|-\d+)$", "", s, flags=re.I)
    return s.strip()


def extract_markers(title: str) -> set[str]:
    t_clean = str(title or "").lower()
    t_no_year = re.sub(r"\b(19\d\d|20\d\d)\b", "", t_clean)
    markers = set()
    for p in SEQUEL_SPECIAL_PATTERNS:
        for f in re.findall(p, t_no_year, re.I):
            markers.add(f.strip().lower())
    for num in re.findall(r"\b\d{1,2}\b", t_no_year):
        markers.add(num.strip())
    return markers


def extract_mdl_key(mdl_url: str | None) -> str:
    if not mdl_url:
        return ""
    m = re.search(r"mydramalist\.com/(\d+-[a-z0-9-]+)", str(mdl_url).lower())
    return m.group(1) if m else str(mdl_url).strip().lower()


def normalize_source_url(raw_url: str | None) -> str:
    u = (raw_url or "").strip()
    if not u:
        return ""
    if u.startswith("//"):
        u = "https:" + u
    if u.startswith("http://"):
        u = "https://" + u[7:]
    try:
        p = urlparse(u)
        if p.scheme in ("http", "https") and p.netloc:
            path = p.path.rstrip("/") or ""
            q = f"?{p.query}" if p.query else ""
            return f"https://{p.netloc.lower()}{path}{q}"
    except Exception:
        pass
    return u.rstrip("/").lower()


class UnionFind:
    def __init__(self, elements):
        self.parent = {e: e for e in elements}
        self.rank = {e: 0 for e in elements}

    def find(self, item):
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]

    def union(self, item1, item2):
        root1 = self.find(item1)
        root2 = self.find(item2)
        if root1 != root2:
            if self.rank[root1] > self.rank[root2]:
                self.parent[root2] = root1
            else:
                self.parent[root1] = root2
                if self.rank[root1] == self.rank[root2]:
                    self.rank[root2] += 1


# =====================================================================
# PART A: SUPABASE PEOPLE + MEDIA_CAST PAIR MERGER
# =====================================================================

def pick_best_slug(group: list) -> str:
    candidates = []
    for p in group:
        raw_slug = p.get("slug") or ""
        cs = clean_slug(raw_slug)
        if cs and cs != "actor":
            is_numbered = bool(re.search(r"-\d+$", raw_slug))
            is_char = raw_slug.startswith("char-")
            hyphens = cs.count("-")
            penalty = (100 if is_char else 0) + (50 if is_numbered else 0) + hyphens * 2 + len(cs) * 0.01
            candidates.append((penalty, cs, raw_slug))
    if not candidates:
        return "actor"
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def score_person(p: dict, best_slug: str = None) -> float:
    score = (p.get("drama_count") or 0) * 10
    slug = p.get("slug") or ""
    is_numbered = bool(re.search(r"-\d+$", slug))
    is_char_slug = slug.startswith("char-")

    if best_slug and slug == best_slug:
        score += 800
    elif not is_numbered and not is_char_slug:
        score += 500
    if p.get("person_type") == "character" or p.get("anilist_id"):
        score += 1000
    if p.get("bio_tr") and len(p["bio_tr"]) > 40:
        score += 300
    if p.get("tmdb_id"):
        score += 200
    if p.get("native_name"):
        score += 100
    if p.get("race") or p.get("height") or p.get("blood_type"):
        score += 150
    if p.get("gender"):
        score += 50
    if p.get("image_url") and "default" not in p["image_url"]:
        score += 50
    if p.get("followers_count"):
        score += min(p["followers_count"], 100) * 0.5
    score += max(0, 250000 - (p.get("id") or 0)) * 0.0001
    return score


def _load_supabase_rows(path_prefix: str, page_size: int = 1000) -> list[dict]:
    from scrapers.supabase_sync_helper import sb_request

    all_rows: list[dict] = []
    offset = 0
    while True:
        offsets = [offset + i * page_size for i in range(8)]
        batch_results = {}
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {
                pool.submit(sb_request, "GET", f"{path_prefix}&limit={page_size}&offset={off}"): off
                for off in offsets
            }
            for fut in as_completed(futs):
                off = futs[fut]
                res = fut.result()
                batch_results[off] = res if isinstance(res, list) else []
        stop = False
        for off in offsets:
            rows = batch_results.get(off) or []
            all_rows.extend(rows)
            if len(rows) < page_size:
                stop = True
                break
        if stop:
            break
        offset += 8 * page_size
    return all_rows


def merge_single_group(group: list, existing_slugs_set: set, dry_run: bool = False):
    from scrapers.supabase_sync_helper import sb_request

    if len(group) <= 1:
        return None
    tmdbs = {p["tmdb_id"] for p in group if p.get("tmdb_id")}
    anils = {p["anilist_id"] for p in group if p.get("anilist_id")}
    if len(tmdbs) > 1 or len(anils) > 1 or (tmdbs and anils):
        return None

    desired_slug = pick_best_slug(group)
    sorted_group = sorted(group, key=lambda p: score_person(p, desired_slug), reverse=True)
    primary = sorted_group[0]
    duplicates = sorted_group[1:]
    p_id = primary["id"]

    if dry_run:
        return {
            "primary_id": p_id,
            "primary_name": primary["name"],
            "final_slug": desired_slug,
            "merged_ids": [d["id"] for d in duplicates],
            "drama_count": primary.get("drama_count") or 0,
        }

    patch_payload = {}
    is_char = any(
        p.get("person_type") == "character" or p.get("anilist_id") or (p.get("slug") or "").startswith("char-")
        for p in group
    )
    if is_char and primary.get("person_type") != "character":
        patch_payload["person_type"] = "character"

    for dup in duplicates:
        for k in [
            "anilist_id", "tmdb_id", "native_name", "gender", "race", "height",
            "blood_type", "birth_date", "death_date", "place_of_birth", "country_code",
            "mydramalist_url", "profile_url",
        ]:
            if not primary.get(k) and dup.get(k):
                patch_payload[k] = dup[k]
                primary[k] = dup[k]
        if (not primary.get("bio_tr") or len(primary.get("bio_tr") or "") < 30) and (
            dup.get("bio_tr") and len(dup.get("bio_tr") or "") >= 30
        ):
            patch_payload["bio_tr"] = dup["bio_tr"]
            primary["bio_tr"] = dup["bio_tr"]
        if (not primary.get("image_url") or "default" in (primary.get("image_url") or "")) and (
            dup.get("image_url") and "default" not in dup["image_url"]
        ):
            patch_payload["image_url"] = dup["image_url"]
            primary["image_url"] = dup["image_url"]
        if (dup.get("followers_count") or 0) > (primary.get("followers_count") or 0):
            patch_payload["followers_count"] = dup["followers_count"]
            primary["followers_count"] = dup["followers_count"]
        if (dup.get("favorites_count") or 0) > (primary.get("favorites_count") or 0):
            patch_payload["favorites_count"] = dup["favorites_count"]
            primary["favorites_count"] = dup["favorites_count"]

    combined_aliases = []
    for p in group:
        for a in (p.get("also_known_as") or []):
            if a and a not in combined_aliases:
                combined_aliases.append(a)
    if combined_aliases and combined_aliases != (primary.get("also_known_as") or []):
        patch_payload["also_known_as"] = combined_aliases

    for dup in duplicates:
        d_id = dup["id"]
        p_cast = sb_request("GET", f"/rest/v1/media_cast?person_id=eq.{p_id}&select=media_id,role_type,billing_order,character_name")
        p_by_media = {r["media_id"]: r for r in (p_cast if isinstance(p_cast, list) else [])}
        d_cast = sb_request("GET", f"/rest/v1/media_cast?person_id=eq.{d_id}&select=media_id,role_type,billing_order,character_name")
        if isinstance(d_cast, list):
            for r in d_cast:
                mid = r["media_id"]
                if mid in p_by_media:
                    ex = p_by_media[mid]
                    better_role = "lead" if (r.get("role_type") == "lead" or ex.get("role_type") == "lead") else ex.get("role_type")
                    min_order = min(r.get("billing_order") or 999, ex.get("billing_order") or 999)
                    if better_role != ex.get("role_type") or min_order < (ex.get("billing_order") or 999):
                        sb_request(
                            "PATCH",
                            f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{p_id}&role_type=eq.{ex['role_type']}",
                            body={
                                "role_type": better_role,
                                "billing_order": min_order if min_order < 999 else ex.get("billing_order"),
                                "character_name": ex.get("character_name") or r.get("character_name"),
                            },
                        )
                    sb_request(
                        "DELETE",
                        f"/rest/v1/media_cast?person_id=eq.{d_id}&media_id=eq.{mid}&role_type=eq.{r['role_type']}",
                    )
                else:
                    sb_request(
                        "PATCH",
                        f"/rest/v1/media_cast?person_id=eq.{d_id}&media_id=eq.{mid}&role_type=eq.{r['role_type']}",
                        body={"person_id": p_id},
                    )

        p_favs = sb_request("GET", f"/rest/v1/person_favorites?person_id=eq.{p_id}&select=user_id")
        p_users = {r["user_id"] for r in (p_favs if isinstance(p_favs, list) else [])}
        d_favs = sb_request("GET", f"/rest/v1/person_favorites?person_id=eq.{d_id}&select=user_id")
        if isinstance(d_favs, list):
            for r in d_favs:
                if r["user_id"] in p_users:
                    sb_request("DELETE", f"/rest/v1/person_favorites?person_id=eq.{d_id}&user_id=eq.{r['user_id']}")
            sb_request("PATCH", f"/rest/v1/person_favorites?person_id=eq.{d_id}", body={"person_id": p_id})

        sb_request("PATCH", f"/rest/v1/comments?person_id=eq.{d_id}", body={"person_id": p_id})
        sb_request("DELETE", f"/rest/v1/people?id=eq.{d_id}")
        if dup.get("slug") in existing_slugs_set:
            existing_slugs_set.discard(dup["slug"])

    total_cast = sb_request("GET", f"/rest/v1/media_cast?person_id=eq.{p_id}&select=media_id")
    distinct_mids = len({r["media_id"] for r in (total_cast if isinstance(total_cast, list) else [])})
    patch_payload["drama_count"] = distinct_mids

    if desired_slug and (desired_slug == primary["slug"] or desired_slug not in existing_slugs_set):
        patch_payload["slug"] = desired_slug
        existing_slugs_set.discard(primary["slug"])
        existing_slugs_set.add(desired_slug)

    if patch_payload:
        sb_request("PATCH", f"/rest/v1/people?id=eq.{p_id}", body=patch_payload)

    return {
        "primary_id": p_id,
        "primary_name": primary["name"],
        "final_slug": patch_payload.get("slug", primary["slug"]),
        "merged_ids": [d["id"] for d in duplicates],
        "drama_count": distinct_mids,
    }


def dedupe_supabase_people_and_cast(dry_run: bool = False) -> dict:
    from scrapers.supabase_sync_helper import sb_request

    all_people = _load_supabase_rows(
        "/rest/v1/people?select=id,slug,name,native_name,person_type,country_code,image_url,profile_url,"
        "anilist_id,tmdb_id,bio_tr,birth_date,death_date,place_of_birth,favorites_count,followers_count,"
        "comments_count,drama_count,avg_rating,gender,also_known_as,blood_type,height,race&order=id.asc"
    )
    print(f"[Supabase People] Toplam {len(all_people):,} kayıt yüklendi.", flush=True)
    existing_slugs_set = {p["slug"] for p in all_people if p.get("slug")}

    uf = UnionFind([p["id"] for p in all_people])
    key_to_ids = defaultdict(list)
    for p in all_people:
        pid = p["id"]
        cs = clean_slug(p.get("slug") or "")
        if cs and cs != "actor" and len(cs) >= 3:
            key_to_ids[f"cs:{cs}"].append(pid)
        cps = compact_slug(p.get("slug") or "")
        if cps and cps != "actor" and len(cps) >= 4:
            key_to_ids[f"cps:{cps}"].append(pid)
        nn = norm_name(p.get("name") or "")
        if nn and len(nn) >= 3:
            key_to_ids[f"nn:{nn}"].append(pid)
        if p.get("tmdb_id"):
            key_to_ids[f"tmdb:{p['tmdb_id']}"].append(pid)
        if p.get("anilist_id"):
            key_to_ids[f"anilist:{p['anilist_id']}"].append(pid)

    for ids in key_to_ids.values():
        if len(ids) > 1:
            for other in ids[1:]:
                uf.union(ids[0], other)

    raw_clusters = defaultdict(list)
    for p in all_people:
        raw_clusters[uf.find(p["id"])].append(p)

    clusters = []
    for c in raw_clusters.values():
        if len(c) <= 1:
            continue
        tmdbs = {p["tmdb_id"] for p in c if p.get("tmdb_id")}
        anils = {p["anilist_id"] for p in c if p.get("anilist_id")}
        if len(tmdbs) > 1 or len(anils) > 1:
            if len(tmdbs) > 1:
                sub_map = defaultdict(list)
                for p in c:
                    if p.get("tmdb_id"):
                        sub_map[p["tmdb_id"]].append(p)
                clusters.extend(sub for sub in sub_map.values() if len(sub) > 1)
            elif len(anils) > 1:
                sub_map = defaultdict(list)
                for p in c:
                    if p.get("anilist_id"):
                        sub_map[p["anilist_id"]].append(p)
                clusters.extend(sub for sub in sub_map.values() if len(sub) > 1)
        elif not (tmdbs and anils):
            clusters.append(c)

    merged_groups = 0
    dups_removed = 0
    if clusters:
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = [pool.submit(merge_single_group, c, existing_slugs_set, dry_run) for c in clusters]
            for idx, fut in enumerate(as_completed(futs), 1):
                res = fut.result()
                if res:
                    merged_groups += 1
                    dups_removed += len(res["merged_ids"])
                if idx % 20 == 0 or idx == len(clusters):
                    _progress("Supabase people birleştirme", idx, len(clusters), f"{dups_removed} duplicate")

    # Deduplicate (media_id, person_id) pairs in media_cast
    all_cast = _load_supabase_rows(
        "/rest/v1/media_cast?select=media_id,person_id,role_type,billing_order,character_name&order=media_id.asc,person_id.asc"
    )
    by_pair = defaultdict(list)
    for row in all_cast:
        by_pair[(row["media_id"], row["person_id"])].append(row)
    dup_pairs = {k: v for k, v in by_pair.items() if len(v) > 1}
    cast_pairs_fixed = 0

    if not dry_run and dup_pairs:
        for (mid, pid), rows in dup_pairs.items():
            rows_sorted = sorted(rows, key=lambda r: (0 if r.get("role_type") == "lead" else 1, r.get("billing_order") or 999))
            keep = rows_sorted[0]
            min_order = min(r.get("billing_order") or 999 for r in rows)
            char_name = next((r.get("character_name") for r in rows_sorted if r.get("character_name")), None)
            if min_order < (keep.get("billing_order") or 999) or (char_name and not keep.get("character_name")):
                sb_request(
                    "PATCH",
                    f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{keep['role_type']}",
                    body={
                        "billing_order": min_order if min_order < 999 else keep.get("billing_order"),
                        "character_name": char_name,
                    },
                )
            for drop in rows_sorted[1:]:
                sb_request(
                    "DELETE",
                    f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{drop['role_type']}",
                )
            cast_pairs_fixed += 1

    print(
        f"[Supabase] People grupları: {len(clusters)} (silinecek/silinen: {dups_removed}), "
        f"mükerrer media_cast çifti: {len(dup_pairs)} (düzeltilen: {cast_pairs_fixed})",
        flush=True,
    )
    return {
        "people_groups": len(clusters),
        "people_removed": dups_removed,
        "dup_cast_pairs": len(dup_pairs),
        "cast_pairs_fixed": cast_pairs_fixed,
    }


# =====================================================================
# PART B: SQLITE DRAMAS, EPISODES & EPISODE_SOURCES DEDUPLICATION
# =====================================================================

def _has_id_or_country_conflict(d1, d2) -> tuple[bool, str]:
    c1 = (d1[12] or "").strip().upper()
    c2 = (d2[12] or "").strip().upper()
    if c1 and c2 and c1 != c2:
        return True, f"country_conflict:{c1}!={c2}"

    ct1, ct2 = (d1[3] or "").lower(), (d2[3] or "").lower()
    if (ct1 == "film") != (ct2 == "film"):
        return True, f"film_vs_series_conflict:{ct1}!={ct2}"
    if (ct1 == "anime") != (ct2 == "anime"):
        return True, f"anime_vs_live_conflict:{ct1}!={ct2}"

    al1, al2 = str(d1[6] or "").strip(), str(d2[6] or "").strip()
    if al1 and al2 and al1 not in ("0", "None", "") and al2 not in ("0", "None", "") and al1 != al2:
        return True, f"anilist_conflict:{al1}!={al2}"

    im1, im2 = str(d1[7] or "").strip(), str(d2[7] or "").strip()
    if im1.startswith("tt") and im2.startswith("tt") and im1 != im2:
        return True, f"imdb_conflict:{im1}!={im2}"

    tm1, tm2 = str(d1[8] or "").strip(), str(d2[8] or "").strip()
    if tm1 and tm2 and tm1 not in ("0", "None", "") and tm2 not in ("0", "None", "") and tm1 != tm2:
        return True, f"tmdb_conflict:{tm1}!={tm2}"

    mdl1, mdl2 = extract_mdl_key(d1[15]), extract_mdl_key(d2[15])
    if mdl1 and mdl2 and mdl1 != mdl2:
        return True, f"mdl_conflict:{mdl1}!={mdl2}"

    return False, "ok"


def _years_compatible(y1, y2) -> bool:
    if not y1 or not y2:
        return True
    try:
        yi1, yi2 = int(str(y1)[:4]), int(str(y2)[:4])
        if yi1 > 1900 and yi2 > 1900:
            return abs(yi1 - yi2) <= 1
    except Exception:
        pass
    return True


def _are_drama_duplicates(d1, d2) -> tuple[bool, str]:
    conflict, reason = _has_id_or_country_conflict(d1, d2)
    if conflict:
        return False, reason

    # Distinct season/OVA/special marker check ALWAYS applies (even if TMDB TV ID matches!)
    m1 = extract_markers(d1[1])
    m2 = extract_markers(d2[1])
    if m1 != m2:
        return False, f"season_or_special_marker_mismatch:{m1}!={m2}"

    if not _years_compatible(d1[4], d2[4]):
        return False, "year_mismatch"

    clean1 = normalize_title(get_clean_title(d1[1]))
    clean2 = normalize_title(get_clean_title(d2[1]))
    ct_kind = (d1[3] or "").lower()
    has_colon_diff = (":" in (d1[1] or "") or ":" in (d2[1] or "")) and clean1 != clean2

    # Exact external ID match (same movie/tv/anime kind, same season markers)
    al1, al2 = str(d1[6] or "").strip(), str(d2[6] or "").strip()
    if al1 and al1 not in ("0", "None", "") and al1 == al2:
        if ct_kind != "film" and has_colon_diff and SequenceMatcher(None, clean1, clean2).ratio() < 0.72:
            return False, "anilist_colon_subtitle_diff"
        return True, "anilist_match"

    im1, im2 = str(d1[7] or "").strip(), str(d2[7] or "").strip()
    if im1.startswith("tt") and im1 == im2:
        if ct_kind != "film" and has_colon_diff:
            return False, "imdb_colon_subtitle_diff"
        return True, "imdb_match"

    mdl1, mdl2 = extract_mdl_key(d1[15]), extract_mdl_key(d2[15])
    if mdl1 and mdl1 == mdl2:
        if ct_kind != "film" and has_colon_diff:
            return False, "mdl_colon_subtitle_diff"
        return True, "mdl_match"

    tm1, tm2 = str(d1[8] or "").strip(), str(d2[8] or "").strip()
    if tm1 and tm1 not in ("0", "None", "") and tm1 == tm2:
        # TMDB groups all seasons/OVAs of a TV show under one tv_id.
        # Do not merge distinct seasons/subtitled entries unless clean titles match closely!
        if ct_kind != "film" and has_colon_diff:
            return False, "tmdb_tv_colon_subtitle_diff"
        if clean1 == clean2 or SequenceMatcher(None, clean1, clean2).ratio() >= 0.72:
            return True, "tmdb_match"

    clean1 = normalize_title(get_clean_title(d1[1]))
    clean2 = normalize_title(get_clean_title(d2[1]))
    if (":" in (d1[1] or "")) != (":" in (d2[1] or "")) and clean1 != clean2:
        return False, "colon_subtitle_mismatch"
    if clean1 and clean1 == clean2 and len(clean1) >= 4:
        return True, "exact_clean_title"

    base_s1 = re.sub(r"-\d+$", "", (d1[2] or "").lower())
    base_s2 = re.sub(r"-\d+$", "", (d2[2] or "").lower())
    if base_s1 and base_s1 == base_s2 and len(base_s1) >= 4:
        sim = SequenceMatcher(None, clean1, clean2).ratio()
        if sim >= 0.85:
            return True, "base_slug_match"

    return False, "no_match"


def _score_drama(d) -> float:
    # d: id(0), title(1), slug(2), content_type(3), release_year(4), cover(5), al_id(6), imdb_id(7),
    #    tmdb_id(8), native_title(9), tags(10), alt_sites(11), country(12), ep_cnt(13), src_cnt(14), mdl_url(15)
    score = d[14] * 100 + d[13] * 10
    if d[6]:
        score += 200
    if d[8]:
        score += 150
    if d[7]:
        score += 100
    if d[15]:
        score += 100
    if d[5] and d[5] != "/logo-dark.png":
        score += 50
    slug = d[2] or ""
    if re.search(r"-\d+$", slug) or any(slug.endswith(x) for x in ("-box", "-you", "-di", "-ad", "-ak", "-aw", "-hdf")):
        score -= 150
    score += max(0, 100000 - d[0]) * 0.0001
    return score


def dedupe_sqlite_dramas(conn: sqlite3.Connection, cur: sqlite3.Cursor, dry_run: bool = False, sync_remote: bool = False) -> dict:
    dramas = cur.execute(
        """
        SELECT d.id, d.title, d.slug, d.content_type, d.release_year, d.cover_image,
               d.anilist_id, d.imdb_id, d.tmdb_id, d.native_title, d.tags, d.alt_sites,
               d.country,
               (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) AS ep_count,
               (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) AS src_count,
               d.mydramalist_url
        FROM dramas d
        """
    ).fetchall()

    drama_dict = {d[0]: d for d in dramas}
    by_al = defaultdict(list)
    by_tmdb = defaultdict(list)
    by_imdb = defaultdict(list)
    by_mdl = defaultdict(list)
    by_title = defaultdict(list)
    by_slug_base = defaultdict(list)

    for d in dramas:
        did = d[0]
        if d[6] and str(d[6]).isdigit() and int(d[6]) > 0:
            by_al[int(d[6])].append(did)
        if d[8] and str(d[8]).strip() not in ("0", "None", ""):
            kind = "film" if (d[3] or "").lower() == "film" else "tv"
            by_tmdb[(str(d[8]).strip(), kind)].append(did)
        if d[7] and str(d[7]).startswith("tt"):
            by_imdb[str(d[7]).strip()].append(did)
        mk = extract_mdl_key(d[15])
        if mk:
            by_mdl[mk].append(did)
        ct = normalize_title(get_clean_title(d[1]))
        if len(ct) >= 4:
            by_title[ct].append(did)
        sb = re.sub(r"-\d+$", "", (d[2] or "").lower())
        if len(sb) >= 4:
            by_slug_base[sb].append(did)

    adj = defaultdict(set)
    for pool in (by_al, by_tmdb, by_imdb, by_mdl, by_title, by_slug_base):
        for ids in pool.values():
            if len(ids) > 1:
                for i in range(len(ids)):
                    for j in range(i + 1, len(ids)):
                        id1, id2 = ids[i], ids[j]
                        if id2 not in adj[id1]:
                            ok, _ = _are_drama_duplicates(drama_dict[id1], drama_dict[id2])
                            if ok:
                                adj[id1].add(id2)
                                adj[id2].add(id1)

    visited = set()
    groups = []
    for did in adj:
        if did not in visited:
            comp = []
            q = [did]
            visited.add(did)
            while q:
                curr = q.pop()
                comp.append(curr)
                for nb in adj[curr]:
                    if nb not in visited:
                        visited.add(nb)
                        q.append(nb)
            if len(comp) > 1:
                groups.append(comp)

    total_dups = sum(len(g) - 1 for g in groups)
    print(f"[SQLite Dramas] {len(groups)} duplicate grubu ({total_dups} fazla yapım) tespit edildi.", flush=True)

    if dry_run:
        for idx, g in enumerate(groups[:15], 1):
            sd = sorted([drama_dict[did] for did in g], key=_score_drama, reverse=True)
            print(f"  [DRY-RUN {idx}] Ana: #{sd[0][0]} '{sd[0][1]}' <- {[f'#{x[0]} {x[1]}' for x in sd[1:]]}", flush=True)
        return {"groups": len(groups), "merged": total_dups, "migrated_eps": 0, "migrated_srcs": 0}

    merged_count = 0
    migrated_eps = 0
    migrated_srcs = 0

    for idx, g in enumerate(groups, 1):
        sd = sorted([drama_dict[did] for did in g], key=_score_drama, reverse=True)
        primary = sd[0]
        p_id = primary[0]
        duplicates = sd[1:]

        for dup in duplicates:
            d_id = dup[0]
            if not primary[9] and dup[9]:
                cur.execute("UPDATE dramas SET native_title = ? WHERE id = ?", (dup[9], p_id))
            if not primary[6] and dup[6]:
                cur.execute("UPDATE dramas SET anilist_id = ? WHERE id = ?", (dup[6], p_id))
            if not primary[7] and dup[7]:
                cur.execute("UPDATE dramas SET imdb_id = ? WHERE id = ?", (dup[7], p_id))
            if not primary[8] and dup[8]:
                cur.execute("UPDATE dramas SET tmdb_id = ? WHERE id = ?", (dup[8], p_id))
            if not primary[15] and dup[15]:
                cur.execute("UPDATE dramas SET mydramalist_url = ? WHERE id = ?", (dup[15], p_id))
            if (not primary[5] or primary[5] == "/logo-dark.png") and dup[5] and dup[5] != "/logo-dark.png":
                cur.execute("UPDATE dramas SET cover_image = ? WHERE id = ?", (dup[5], p_id))

            dup_eps = cur.execute(
                "SELECT id, season_number, episode_number FROM episodes WHERE drama_id = ?", (d_id,)
            ).fetchall()
            for dep_id, s_num, e_num in dup_eps:
                p_ep = cur.execute(
                    "SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                    (p_id, s_num, e_num),
                ).fetchone()
                if p_ep:
                    target_ep = p_ep[0]
                    for sname, emb, aurl, durl, prov, fansub, site in cur.execute(
                        "SELECT source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site "
                        "FROM episode_sources WHERE episode_id = ?",
                        (dep_id,),
                    ).fetchall():
                        exists = cur.execute(
                            "SELECT id FROM episode_sources WHERE episode_id = ? AND (embed_id = ? OR (direct_url IS NOT NULL AND direct_url = ?))",
                            (target_ep, emb or "__none__", durl or "__none__"),
                        ).fetchone()
                        if not exists:
                            cur.execute(
                                "INSERT INTO episode_sources (episode_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site, created_at) "
                                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                                (target_ep, sname, emb, aurl, durl, prov, fansub, site),
                            )
                            migrated_srcs += 1
                    cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (dep_id,))
                    cur.execute("DELETE FROM episodes WHERE id = ?", (dep_id,))
                else:
                    cur.execute("UPDATE episodes SET drama_id = ? WHERE id = ?", (p_id, dep_id))
                    migrated_eps += 1

            try:
                cur.execute("UPDATE OR IGNORE drama_actors SET drama_id = ? WHERE drama_id = ?", (p_id, d_id))
                cur.execute("DELETE FROM drama_actors WHERE drama_id = ?", (d_id,))
                cur.execute("DELETE FROM series_automations WHERE media_id = ?", (d_id,))
            except Exception:
                pass
            cur.execute("DELETE FROM dramas WHERE id = ?", (d_id,))
            merged_count += 1

            if sync_remote:
                from scrapers.supabase_sync_helper import sb_request

                sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/episodes?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/media?id=eq.{d_id}")

        cur.execute(
            """
            UPDATE dramas
            SET episodes_available = (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = ? AND EXISTS(SELECT 1 FROM episode_sources es WHERE es.episode_id = e.id)),
                sources_count = (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (p_id, p_id, p_id),
        )
        conn.commit()
        if sync_remote:
            from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

            sync_drama_bundle_and_counts(conn, cur, p_id)
        if idx % 20 == 0 or idx == len(groups):
            _progress("SQLite drama birleştirme", idx, len(groups), f"silinen={merged_count}")

    return {
        "groups": len(groups),
        "merged": merged_count,
        "migrated_eps": migrated_eps,
        "migrated_srcs": migrated_srcs,
    }


def dedupe_sqlite_episodes_and_sources(conn: sqlite3.Connection, cur: sqlite3.Cursor, dry_run: bool = False) -> dict:
    # 1. Duplicate (drama_id, season_number, episode_number)
    dup_ep_groups = cur.execute(
        """
        SELECT drama_id, season_number, episode_number, COUNT(*) as c
        FROM episodes
        GROUP BY drama_id, season_number, episode_number
        HAVING c > 1
        """
    ).fetchall()

    ep_dups_removed = 0
    for did, snum, enum, _ in dup_ep_groups:
        rows = cur.execute(
            """
            SELECT e.id, e.episode_url,
                   (SELECT COUNT(*) FROM episode_sources es WHERE es.episode_id = e.id) AS src_cnt
            FROM episodes e
            WHERE e.drama_id = ? AND e.season_number = ? AND e.episode_number = ?
            ORDER BY src_cnt DESC, CASE WHEN e.episode_url LIKE 'pending://%' THEN 1 ELSE 0 END ASC, e.id ASC
            """,
            (did, snum, enum),
        ).fetchall()
        primary_ep = rows[0][0]
        for dup_ep, _, _ in rows[1:]:
            if not dry_run:
                for sname, emb, aurl, durl, prov, fansub, site in cur.execute(
                    "SELECT source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site "
                    "FROM episode_sources WHERE episode_id = ?",
                    (dup_ep,),
                ).fetchall():
                    exists = cur.execute(
                        "SELECT id FROM episode_sources WHERE episode_id = ? AND (embed_id = ? OR (direct_url IS NOT NULL AND direct_url = ?))",
                        (primary_ep, emb or "__none__", durl or "__none__"),
                    ).fetchone()
                    if not exists:
                        cur.execute(
                            "INSERT INTO episode_sources (episode_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub, site, created_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                            (primary_ep, sname, emb, aurl, durl, prov, fansub, site),
                        )
                cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (dup_ep,))
                cur.execute("DELETE FROM episodes WHERE id = ?", (dup_ep,))
            ep_dups_removed += 1

    # 2. Normalized duplicate episode_sources (same episode_id + normalized direct_url)
    rows = cur.execute(
        "SELECT id, episode_id, direct_url, provider, source_name FROM episode_sources WHERE direct_url IS NOT NULL AND direct_url != '' ORDER BY id ASC"
    ).fetchall()
    seen_norm = {}
    dup_source_ids = []
    for sid, eid, durl, prov, sname in rows:
        nu = normalize_source_url(durl)
        if not nu:
            continue
        key = (eid, nu)
        if key not in seen_norm:
            seen_norm[key] = (sid, durl)
        else:
            # Prefer https over http if both exist
            prev_sid, prev_url = seen_norm[key]
            if prev_url.startswith("http://") and durl.startswith("https://"):
                dup_source_ids.append(prev_sid)
                seen_norm[key] = (sid, durl)
            else:
                dup_source_ids.append(sid)

    if not dry_run and dup_source_ids:
        for i in range(0, len(dup_source_ids), 500):
            chunk = dup_source_ids[i : i + 500]
            ph = ",".join("?" * len(chunk))
            cur.execute(f"DELETE FROM episode_sources WHERE id IN ({ph})", chunk)
        conn.commit()
    elif not dry_run and ep_dups_removed:
        conn.commit()

    print(
        f"[SQLite Ep/Src] Duplicate bölüm grupları: {len(dup_ep_groups)} (silinen satır: {ep_dups_removed}) | "
        f"Normalize duplicate kaynaklar: {len(dup_source_ids):,}",
        flush=True,
    )
    return {
        "dup_episode_groups": len(dup_ep_groups),
        "dup_episodes_removed": ep_dups_removed,
        "dup_sources_removed": len(dup_source_ids),
    }


def main():
    parser = argparse.ArgumentParser(description="KoUp Unified Idempotent Duplicate Merger")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--apply", action="store_true", help="Apply merges (default is dry-run unless --apply)")
    parser.add_argument("--dry-run", action="store_true", help="Preview duplicates without mutating DBs")
    parser.add_argument("--sync-remote", action="store_true", help="Include Supabase & R2 sync (requires --apply)")
    parser.add_argument("--scope", choices=["all", "actors", "dramas", "episodes"], default="all")
    args = parser.parse_args()

    is_apply = bool(args.apply and not args.dry_run)
    dry_run = not is_apply
    db_path = _resolve_db_path(args.db)

    print(f"=== KoUp Unified Duplicate Merger ({'DRY-RUN' if dry_run else 'APPLY'}) | Scope: {args.scope} ===", flush=True)
    summary = {}

    if args.scope in ("all", "actors"):
        summary["sqlite_actors"] = run_sqlite_actor_merge(db_path=db_path, dry_run=dry_run)
        if args.sync_remote or dry_run:
            try:
                summary["supabase_people"] = dedupe_supabase_people_and_cast(dry_run=dry_run)
            except Exception as e:
                print(f"[Supabase People Uyarısı] {e}", flush=True)

    if args.scope in ("all", "dramas", "episodes"):
        conn = sqlite3.connect(db_path, timeout=60.0)
        conn.execute("PRAGMA busy_timeout = 60000;")
        cur = conn.cursor()

        if args.scope in ("all", "dramas"):
            summary["sqlite_dramas"] = dedupe_sqlite_dramas(conn, cur, dry_run=dry_run, sync_remote=(args.sync_remote and not dry_run))

        if args.scope in ("all", "episodes"):
            summary["sqlite_ep_src"] = dedupe_sqlite_episodes_and_sources(conn, cur, dry_run=dry_run)

        if not dry_run:
            cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.commit()
        conn.close()

    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': dry_run, **summary}, ensure_ascii=False)}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
