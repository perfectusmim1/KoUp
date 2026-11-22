#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/sync_cast_hierarchy.py

Full-Archive Cast Hierarchy & Backfill Engine (TMDB + AniList + MyDramaList):
- Fixes the legacy `limit=50` bug so ALL ~21.8k cast-populated series AND ~3.3k missing-cast
  series in Supabase/SQLite can be audited, repaired, and backfilled.
- Authentic billing rules:
  * AniList: role == 'MAIN' -> 'lead', 'SUPPORTING' -> 'support', ordered by ROLE/RELEVANCE.
  * TMDB: sorted by official `order` asc; top-billed (order < 4 and rank <= 4) -> 'lead',
    remaining cast (up to 20) -> 'support', ordered by billing_order = 1..N.
  * MyDramaList (/cast): 'Main Role' -> 'lead', 'Support Role' -> 'support', ordered 1..N
    (cleanly skips on Cloudflare challenge without any bypass).
- Supports --dry-run (default unless --apply), --apply, --db, --limit, --mode (all|fix|backfill).
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from difflib import SequenceMatcher

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from curl_cffi import requests as cfr
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

from bs4 import BeautifulSoup

_TR_MAP = str.maketrans({
    "ı": "i", "İ": "i", "I": "i",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
})

ANILIST_PAGE_QUERY = """
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      characters(sort: [ROLE, RELEVANCE, ID], perPage: 20) {
        edges {
          role
          node {
            id
            name { full userPreferred }
            image { large medium }
          }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            id
            name { full userPreferred }
            image { large medium }
          }
        }
      }
    }
  }
}
"""


def _progress(stage: str, current: int, total: int, detail: str = "") -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    pct = (current / total * 100.0) if total > 0 else 100.0
    print(f"[{ts}] [{current}/{total}] ({pct:.1f}%) - {stage}: {detail}", flush=True)


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for cand in (
        os.path.join(_ROOT, "koup-app", ".env.local"),
        os.path.join(os.path.dirname(_ROOT), "koup-app", ".env.local"),
    ):
        if os.path.exists(cand):
            try:
                with open(cand, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            env[k.strip()] = v.strip().strip('"').strip("'")
                break
            except Exception:
                pass
    return env


def _get_creds() -> tuple[str, str, str]:
    env = _load_env()
    sb_url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    sb_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or env.get("SUPABASE_SERVICE_ROLE_KEY")
        or env.get("SUPABASE_SECRET_KEY")
        or ""
    )
    tmdb_key = (
        os.environ.get("TMDB_API_KEY")
        or os.environ.get("NEXT_PUBLIC_TMDB_API_KEY")
        or env.get("TMDB_API_KEY")
        or env.get("NEXT_PUBLIC_TMDB_API_KEY")
        or ""
    )
    return sb_url, sb_key, tmdb_key


def sb_http(sb_url: str, sb_key: str, method: str, path: str, body=None, prefer: str = "return=representation"):
    url = f"{sb_url}{path}"
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as e:
        return {"_error": True, "status": e.code, "message": e.read().decode("utf-8", errors="ignore")}
    except Exception as e:
        return {"_error": True, "message": str(e)}


def fetch_all_pages(sb_url: str, sb_key: str, path_template: str, page_size: int = 1000) -> list[dict]:
    all_rows: list[dict] = []
    offset = 0
    while True:
        offsets = [offset + i * page_size for i in range(8)]
        batch_results = {}
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {
                pool.submit(sb_http, sb_url, sb_key, "GET", f"{path_template}&limit={page_size}&offset={off}"): off
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


def slugify(text: str) -> str:
    if not text:
        return "actor"
    s = str(text).translate(_TR_MAP).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "actor"


def clean_slug(slug: str) -> str:
    if not slug:
        return ""
    s = slug.lower().strip()
    if s.startswith("char-"):
        s = s[5:]
    return re.sub(r"-\d+$", "", s).strip("-")


def norm_name(text: str) -> str:
    if not text:
        return ""
    s = str(text).translate(_TR_MAP).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s)


def phonetic_cjk(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", str(text).lower()).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z]", "", s)
    for a, b in (
        ("yeo", "yo"), ("eo", "o"), ("eu", "u"), ("oo", "u"), ("ee", "i"), ("ae", "e"),
        ("oe", "o"), ("jae", "je"), ("jun", "cun"), ("joon", "cun"), ("sun", "sun"),
        ("soon", "sun"), ("shin", "sin"), ("shi", "si"), ("ji", "ci"), ("ch", "c"),
        ("ph", "p"), ("kh", "k"), ("th", "t"), ("k", "g"), ("t", "d"), ("p", "b"),
        ("r", "l"), ("y", "i"), ("w", "u"),
    ):
        s = s.replace(a, b)
    return re.sub(r"(.)\1+", r"\1", s)


def fetch_tmdb_cast_single(tmdb_key: str, item: tuple) -> tuple[int, list[dict]]:
    mid, tid, ctype = item
    is_movie = ctype == "film"
    urls = (
        [f"https://api.themoviedb.org/3/movie/{tid}/credits?api_key={tmdb_key}"]
        if is_movie
        else [
            f"https://api.themoviedb.org/3/tv/{tid}/aggregate_credits?api_key={tmdb_key}",
            f"https://api.themoviedb.org/3/tv/{tid}/credits?api_key={tmdb_key}",
        ]
    )
    for url in urls:
        is_aggregate = "/aggregate_credits" in url
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "KoUp/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    raw_cast = (json.loads(resp.read().decode("utf-8"))).get("cast") or []
                    if raw_cast:
                        if is_aggregate:
                            raw_cast.sort(key=lambda x: (x.get("order", 999), -(x.get("total_episode_count") or 0)))
                            max_eps = max((c.get("total_episode_count") or 0) for c in raw_cast[:10]) or 1
                        else:
                            raw_cast.sort(key=lambda x: x.get("order", 999))
                            max_eps = 0

                        planned = []
                        for idx, c in enumerate(raw_cast[:20], 1):
                            name = c.get("name") or c.get("original_name") or ""
                            if not name:
                                continue
                            char = c.get("character") or ""
                            if not char and isinstance(c.get("roles"), list) and c["roles"]:
                                char = c["roles"][0].get("character") or ""
                            prof = c.get("profile_path")
                            img = f"https://image.tmdb.org/t/p/w500{prof}" if prof else None
                            ord_val = c.get("order", idx - 1)
                            if is_movie:
                                role = "lead" if (ord_val < 5 and idx <= 5) else "support"
                            elif is_aggregate:
                                ep_cnt = c.get("total_episode_count") or 0
                                role = "lead" if (idx <= 6 and (ord_val < 5 or (max_eps >= 4 and ep_cnt >= max_eps * 0.45))) else "support"
                            else:
                                role = "lead" if (ord_val < 5 and idx <= 5) else "support"
                            planned.append({
                                "name": name,
                                "slug": slugify(name),
                                "img_url": img,
                                "tmdb_id": c.get("id"),
                                "anilist_id": None,
                                "person_type": "actor",
                                "character_name": char,
                                "role_type": role,
                                "billing_order": idx,
                                "voice_actor_name": None,
                                "voice_actor_image": None,
                                "voice_actor_slug": None,
                            })
                        return mid, planned
        except Exception:
            continue
    return mid, []


def fetch_anilist_page_by_ids(aid_list: list[int]) -> dict[int, list[dict]]:
    if not aid_list:
        return {}
    req = urllib.request.Request(
        "https://graphql.anilist.co",
        data=json.dumps({"query": ANILIST_PAGE_QUERY, "variables": {"ids": aid_list}}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "KoUp/1.0"},
    )
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    media_list = ((payload.get("data") or {}).get("Page") or {}).get("media") or []
                    out = {}
                    for m in media_list:
                        if m and m.get("id"):
                            edges = ((m.get("characters") or {}).get("edges")) or []
                            if edges:
                                out[int(m["id"])] = edges
                    return out
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(max(int(e.headers.get("Retry-After", 4)), 3))
                continue
            time.sleep(1.5)
        except Exception:
            time.sleep(1.5)
    return {}


def fetch_mdl_cast_single(mdl_url: str) -> tuple[list[dict], bool]:
    """
    Fetches authentic Main Role / Support Role billing from MyDramaList /cast page.
    Returns (planned_cast, blocked_by_cf). Never bypasses Cloudflare/Turnstile.
    """
    if not HAS_CURL_CFFI or not mdl_url or "mydramalist.com/" not in mdl_url:
        return [], False
    cast_url = mdl_url.rstrip("/") + "/cast"
    try:
        r = cfr.get(cast_url, impersonate="chrome", timeout=10)
        txt = r.text or ""
        if r.status_code in (403, 429) or "just a moment" in txt.lower() or "cf-browser-verification" in txt.lower():
            return [], True
        if r.status_code != 200:
            return [], False
        soup = BeautifulSoup(txt, "html.parser")
        planned = []
        order = 0
        for h3 in soup.find_all(["h3", "h2"]):
            htxt = h3.get_text(" ", strip=True).lower()
            if "main role" in htxt:
                role = "lead"
            elif "support role" in htxt:
                role = "support"
            else:
                continue
            ul = h3.find_next_sibling("ul")
            if not ul:
                continue
            for li in ul.find_all("li", recursive=False):
                a_actor = li.find("a", href=re.compile(r"/people/"))
                if not a_actor:
                    continue
                name = a_actor.get_text(" ", strip=True)
                if not name:
                    continue
                img_el = li.find("img")
                img_url = img_el.get("data-src") or img_el.get("src") if img_el else None
                char_el = li.find("small")
                char_name = char_el.get_text(" ", strip=True) if char_el else ""
                order += 1
                planned.append({
                    "name": name,
                    "slug": slugify(name),
                    "img_url": img_url,
                    "tmdb_id": None,
                    "anilist_id": None,
                    "person_type": "actor",
                    "character_name": char_name,
                    "role_type": role,
                    "billing_order": order,
                    "voice_actor_name": None,
                    "voice_actor_image": None,
                    "voice_actor_slug": None,
                })
                if order >= 20:
                    break
        return planned, False
    except Exception:
        return [], False


def apply_cast_for_batch(
    sb_url: str,
    sb_key: str,
    planned_by_media: dict[int, list[dict]],
    existing_cast_by_media: dict[int, list[dict]],
    people_idx: dict,
    dry_run: bool = False,
) -> dict:
    people_by_slug = people_idx["slug"]
    people_by_clean = people_idx["clean"]
    people_by_norm = people_idx["norm"]
    people_by_tmdb = people_idx["tmdb"]
    people_by_anilist = people_idx["anilist"]
    people_by_id = people_idx.get("by_id") or {}

    def _find_existing_media_romanization_pid(mid_val: int, item_obj: dict) -> int | None:
        if (item_obj.get("person_type") or "actor") == "character" or not item_obj.get("tmdb_id"):
            return None
        pn_new = phonetic_cjk(item_obj["name"])
        if len(pn_new) < 5:
            return None
        toks_new = [norm_name(t) for t in re.split(r"[\s\-\.]+", item_obj["name"]) if len(norm_name(t)) >= 2]
        if not toks_new:
            return None
        for ex_row in existing_cast_by_media.get(mid_val, []):
            epid = ex_row.get("person_id")
            pobj = people_by_id.get(epid)
            if not pobj or pobj.get("tmdb_id") or pobj.get("person_type") == "character":
                continue
            pname = pobj.get("name") or ""
            pn_old = phonetic_cjk(pname)
            if not pn_old:
                continue
            toks_old = [norm_name(t) for t in re.split(r"[\s\-\.]+", pname) if len(norm_name(t)) >= 2]
            if not toks_old or phonetic_cjk(toks_old[0]) != phonetic_cjk(toks_new[0]):
                continue
            if SequenceMatcher(None, pn_new, pn_old).ratio() >= 0.92:
                return epid
        return None

    new_people_map = {}
    tmdb_backlink_patches = {}
    matched_romanization_pids = {}
    for mid, items in planned_by_media.items():
        for item in items:
            pslug = item["slug"]
            cslug = clean_slug(pslug)
            nn = norm_name(item["name"])
            tid = item.get("tmdb_id")
            aid = item.get("anilist_id")
            pid = (
                (people_by_anilist.get(int(aid)) if aid else None)
                or (people_by_tmdb.get(int(tid)) if tid else None)
                or matched_romanization_pids.get((mid, tid))
                or people_by_slug.get(pslug)
                or people_by_clean.get(cslug)
                or people_by_norm.get(nn)
            )
            if not pid:
                pid = _find_existing_media_romanization_pid(mid, item)
                if pid:
                    matched_romanization_pids[(mid, tid)] = pid
                    if tid and pid not in tmdb_backlink_patches:
                        tmdb_backlink_patches[pid] = int(tid)
                        people_by_tmdb[int(tid)] = pid
            target_slug = cslug or pslug
            if not pid and target_slug not in new_people_map:
                new_people_map[target_slug] = {
                    "name": item["name"],
                    "slug": target_slug,
                    "image_url": item["img_url"],
                    "tmdb_id": int(tid) if tid else None,
                    "anilist_id": int(aid) if aid else None,
                    "person_type": item.get("person_type") or "actor",
                }

    if tmdb_backlink_patches and not dry_run:
        for pid, tid_val in tmdb_backlink_patches.items():
            sb_http(sb_url, sb_key, "PATCH", f"/rest/v1/people?id=eq.{pid}", {"tmdb_id": tid_val})

    if new_people_map and not dry_run:
        new_list = list(new_people_map.values())
        for i in range(0, len(new_list), 250):
            chunk = new_list[i : i + 250]
            res = sb_http(
                sb_url, sb_key, "POST", "/rest/v1/people?on_conflict=slug",
                chunk, "resolution=merge-duplicates,return=representation",
            )
            if isinstance(res, list):
                for np in res:
                    npid = np.get("id")
                    nslug = np.get("slug")
                    if nslug and npid:
                        people_by_slug[nslug] = npid
                        cs = clean_slug(nslug)
                        if cs:
                            people_by_clean[cs] = npid
                    if np.get("name") and npid:
                        people_by_norm[norm_name(np["name"])] = npid
                    if np.get("tmdb_id") and npid:
                        people_by_tmdb[int(np["tmdb_id"])] = npid
                    if np.get("anilist_id") and npid:
                        people_by_anilist[int(np["anilist_id"])] = npid

    upsert_rows = []
    role_updates = 0
    backfilled_media = 0
    repaired_media = 0

    for mid, items in planned_by_media.items():
        ex_rows = existing_cast_by_media.get(mid, [])
        ex_by_pid = {r["person_id"]: r for r in ex_rows}
        ex_roles_by_pid = defaultdict(set)
        for r in ex_rows:
            if r.get("role_type"):
                ex_roles_by_pid[r["person_id"]].add(r["role_type"])
        if not ex_rows:
            backfilled_media += 1
        media_had_fix = False
        seen_pids = set()

        for item in items:
            pslug = item["slug"]
            cslug = clean_slug(pslug)
            nn = norm_name(item["name"])
            tid = item.get("tmdb_id")
            aid = item.get("anilist_id")
            pid = (
                (people_by_anilist.get(int(aid)) if aid else None)
                or (people_by_tmdb.get(int(tid)) if tid else None)
                or matched_romanization_pids.get((mid, tid))
                or people_by_slug.get(pslug)
                or people_by_clean.get(cslug)
                or people_by_norm.get(nn)
            )
            if not pid or pid in seen_pids:
                continue
            seen_pids.add(pid)

            ex = ex_by_pid.get(pid)
            if ex:
                needs_char_fill = bool(item["character_name"] and not ex.get("character_name"))
                if ex.get("role_type") != item["role_type"] or ex.get("billing_order") != item["billing_order"] or needs_char_fill:
                    role_updates += 1
                    media_had_fix = True
                    if not dry_run:
                        # PK includes role_type, so delete all rows for (media_id, person_id) when role_type changed
                        if ex.get("role_type") != item["role_type"]:
                            sb_http(
                                sb_url, sb_key, "DELETE",
                                f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}",
                            )
                            upsert_rows.append({
                                "media_id": mid,
                                "person_id": pid,
                                "character_name": item["character_name"] or ex.get("character_name"),
                                "role_type": item["role_type"],
                                "billing_order": item["billing_order"],
                                "voice_actor_name": item.get("voice_actor_name"),
                                "voice_actor_image": item.get("voice_actor_image"),
                                "voice_actor_slug": item.get("voice_actor_slug"),
                            })
                        else:
                            patch_body = {"billing_order": item["billing_order"]}
                            if needs_char_fill:
                                patch_body["character_name"] = item["character_name"]
                            sb_http(
                                sb_url, sb_key, "PATCH",
                                f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{ex['role_type']}",
                                patch_body,
                            )
            else:
                upsert_rows.append({
                    "media_id": mid,
                    "person_id": pid,
                    "character_name": item["character_name"],
                    "role_type": item["role_type"],
                    "billing_order": item["billing_order"],
                    "voice_actor_name": item.get("voice_actor_name"),
                    "voice_actor_image": item.get("voice_actor_image"),
                    "voice_actor_slug": item.get("voice_actor_slug"),
                })

        next_order = max((item.get("billing_order") or 0 for item in items), default=len(items)) + 1
        for ex in ex_rows:
            epid = ex["person_id"]
            if epid not in seen_pids and ex.get("role_type") == "lead":
                role_updates += 1
                media_had_fix = True
                if not dry_run:
                    sb_http(
                        sb_url, sb_key, "DELETE",
                        f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{epid}&role_type=eq.lead",
                    )
                    if "support" not in ex_roles_by_pid[epid]:
                        upsert_rows.append({
                            "media_id": mid,
                            "person_id": epid,
                            "character_name": ex.get("character_name"),
                            "role_type": "support",
                            "billing_order": next_order,
                            "voice_actor_name": ex.get("voice_actor_name"),
                            "voice_actor_image": ex.get("voice_actor_image"),
                            "voice_actor_slug": ex.get("voice_actor_slug"),
                        })
                        ex_roles_by_pid[epid].add("support")
                        next_order += 1

        if media_had_fix:
            repaired_media += 1

    if upsert_rows and not dry_run:
        for i in range(0, len(upsert_rows), 500):
            chunk = upsert_rows[i : i + 500]
            sb_http(
                sb_url, sb_key, "POST",
                "/rest/v1/media_cast?on_conflict=media_id,person_id,role_type",
                chunk, "resolution=merge-duplicates,return=minimal",
            )

    return {
        "new_people": len(new_people_map),
        "role_updates": role_updates,
        "upserted_cast": len(upsert_rows),
        "backfilled_media": backfilled_media,
        "repaired_media": repaired_media,
    }


def rebalance_cast_anomalies(sb_url: str, sb_key: str, dry_run: bool = False) -> dict:
    """Normalizes remaining lead/support role ratios and billing_order across Supabase media_cast."""
    print(f"=== KoUp Global Cast Anomaly Rebalance ({'DRY-RUN' if dry_run else 'APPLY'}) ===", flush=True)
    media_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/media?select=id,content_type&order=id.asc")
    media_type_map = {int(r["id"]): (r.get("content_type") or "").lower() for r in media_rows}

    cast_rows = fetch_all_pages(
        sb_url, sb_key,
        "/rest/v1/media_cast?select=media_id,person_id,role_type,billing_order,character_name,voice_actor_name,voice_actor_image,voice_actor_slug&order=media_id.asc,billing_order.asc.nullslast,person_id.asc",
    )
    by_media = defaultdict(list)
    for r in cast_rows:
        by_media[int(r["media_id"])].append(r)

    deletes: list[tuple[int, int, str]] = []
    upserts: list[dict] = []
    rebalanced_media = 0
    role_changes = 0
    order_changes = 0
    deduped_rows = 0

    for mid, raw_rows in by_media.items():
        ctype = media_type_map.get(mid, "")
        # Dedupe identical (media_id, person_id) rows with distinct role_types before assigning dense ranks
        best_by_pid: dict[int, dict] = {}
        raw_sorted = sorted(
            raw_rows,
            key=lambda r: (
                0 if r.get("role_type") == "lead" else 1,
                r["billing_order"] if r.get("billing_order") is not None else 999999,
                int(r["person_id"]),
            ),
        )
        rows = []
        for r in raw_sorted:
            pid = int(r["person_id"])
            if pid in best_by_pid:
                deletes.append((mid, pid, str(r.get("role_type") or "support")))
                deduped_rows += 1
                continue
            best_by_pid[pid] = r
            rows.append(r)

        if not rows:
            continue

        leads = sum(1 for r in rows if r.get("role_type") == "lead")
        orders = [r.get("billing_order") for r in rows]
        has_null = any(o is None for o in orders)
        has_dup = len(set(o for o in orders if o is not None)) < sum(1 for o in orders if o is not None)
        has_lead_gt4 = any(r.get("role_type") == "lead" and (r.get("billing_order") or 999999) > 4 for r in rows)

        if ctype != "anime":
            needs_fix = (leads > 6) or (leads == 0)
            recompute_roles = (leads > 6) or (leads == 0)
        else:
            needs_fix = (leads == 0) or has_null or has_dup or (leads > 8)
            recompute_roles = (leads == 0) or (leads > 8)

        if not needs_fix:
            continue

        rebalanced_media += 1
        n_rows = len(rows)
        lead_cap = min(4, n_rows)

        for rank, r in enumerate(rows, 1):
            old_role = r.get("role_type") or "support"
            old_order = r.get("billing_order")
            new_role = ("lead" if rank <= lead_cap else "support") if recompute_roles else old_role
            if new_role == old_role and old_order == rank:
                continue
            if new_role != old_role:
                role_changes += 1
                deletes.append((mid, int(r["person_id"]), old_role))
            else:
                order_changes += 1
            upserts.append({
                "media_id": mid,
                "person_id": int(r["person_id"]),
                "character_name": r.get("character_name"),
                "role_type": new_role,
                "billing_order": rank,
                "voice_actor_name": r.get("voice_actor_name"),
                "voice_actor_image": r.get("voice_actor_image"),
                "voice_actor_slug": r.get("voice_actor_slug"),
            })

    print(
        f"Hedeflenen anomali yapım: {rebalanced_media:,} | Rol değişimi: {role_changes:,} | Sıra düzeltmesi: {order_changes:,} | Tekilleştirilen PK çakışması: {deduped_rows:,}",
        flush=True,
    )

    if not dry_run:
        if deletes:
            def _del_one(item):
                mid, pid, rtype = item
                return sb_http(
                    sb_url, sb_key, "DELETE",
                    f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{rtype}",
                )

            with ThreadPoolExecutor(max_workers=12) as pool:
                futs = [pool.submit(_del_one, d) for d in deletes]
                for idx, fut in enumerate(as_completed(futs), 1):
                    res = fut.result()
                    if isinstance(res, dict) and res.get("_error"):
                        print(f"[REBALANCE_DEL_ERR] {res}", flush=True)
                    if idx % 1000 == 0 or idx == len(deletes):
                        _progress("Rebalance DELETE", idx, len(deletes))

        if upserts:
            for i in range(0, len(upserts), 500):
                chunk = upserts[i : i + 500]
                res = sb_http(
                    sb_url, sb_key, "POST",
                    "/rest/v1/media_cast?on_conflict=media_id,person_id,role_type",
                    chunk, "resolution=merge-duplicates,return=minimal",
                )
                if isinstance(res, dict) and res.get("_error"):
                    print(f"[REBALANCE_UPSERT_ERR] {res}", flush=True)
                done = min(i + 500, len(upserts))
                if done % 2000 == 0 or done == len(upserts):
                    _progress("Rebalance UPSERT", done, len(upserts))

    summary = {
        "ok": True,
        "dryRun": dry_run,
        "rebalancedMedia": rebalanced_media,
        "roleChanges": role_changes,
        "orderChanges": order_changes,
        "dedupedRows": deduped_rows,
        "deletes": len(deletes),
        "upserts": len(upserts),
    }
    print(f"__RESULT__ {json.dumps(summary, ensure_ascii=False)}", flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description="KoUp Full-Archive Cast Hierarchy & Backfill Sync")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB (for supplementary IDs)")
    parser.add_argument("--apply", action="store_true", help="Apply updates to Supabase (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Preview hierarchy fixes & backfills without writing")
    parser.add_argument("--mode", choices=["all", "fix", "backfill"], default="all", help="Scope: all, fix existing cast, or backfill missing")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of media per phase (0 = full archive)")
    parser.add_argument("--include-mdl", action="store_true", help="Also query MyDramaList /cast for Asian dramas lacking TMDB ID")
    parser.add_argument("--refresh-tv-leads", type=int, default=0, help="Also refresh top N most-viewed TV series and under-leaded TV shows via aggregate_credits")
    parser.add_argument("--rebalance-anomalies", action="store_true", help="Rebalance remaining lead/support role ratios and billing_order across Supabase media_cast")
    args = parser.parse_args()

    is_apply = bool(args.apply and not args.dry_run)
    dry_run = not is_apply
    sb_url, sb_key, tmdb_key = _get_creds()
    if not sb_url or not sb_key:
        print("[ERROR] SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY bulunamadı!", flush=True)
        sys.exit(1)

    if args.rebalance_anomalies:
        rebalance_cast_anomalies(sb_url, sb_key, dry_run=dry_run)
        sys.exit(0)

    db_path = args.db or os.environ.get("ARCHIVE_DB_PATH") or os.path.join(_ROOT, "webdrama_archive.db")
    sqlite_meta = {}
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path, timeout=30.0)
        for row in conn.execute("SELECT id, anilist_id, tmdb_id, content_type, mydramalist_url FROM dramas"):
            sqlite_meta[row[0]] = row[1:]
        conn.close()

    print(f"=== KoUp Full Cast Hierarchy & Backfill ({'DRY-RUN' if dry_run else 'APPLY'} | mode={args.mode}) ===", flush=True)

    cast_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/media_cast?select=media_id,person_id,role_type,billing_order,character_name&order=media_id.asc,person_id.asc")
    existing_cast_by_media = defaultdict(list)
    for r in cast_rows:
        existing_cast_by_media[int(r["media_id"])].append(r)

    people_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/people?select=id,slug,name,tmdb_id,anilist_id,person_type&order=id.asc")
    people_idx = {"slug": {}, "clean": {}, "norm": {}, "tmdb": {}, "anilist": {}, "by_id": {}}
    for p in people_rows:
        pid = p.get("id")
        if not pid:
            continue
        people_idx["by_id"][pid] = p
        if p.get("slug"):
            people_idx["slug"][p["slug"]] = pid
            cs = clean_slug(p["slug"])
            if cs and cs not in people_idx["clean"]:
                people_idx["clean"][cs] = pid
        if p.get("name"):
            nn = norm_name(p["name"])
            if nn and nn not in people_idx["norm"]:
                people_idx["norm"][nn] = pid
        if p.get("tmdb_id"):
            people_idx["tmdb"][int(p["tmdb_id"])] = pid
        if p.get("anilist_id"):
            people_idx["anilist"][int(p["anilist_id"])] = pid

    sb_media = fetch_all_pages(sb_url, sb_key, "/rest/v1/media?select=id,title,content_type,tmdb_id,anilist_id,mydramalist_url&order=views_total.desc")
    print(f"Yüklendi -> media: {len(sb_media):,} | cast'li yapım: {len(existing_cast_by_media):,} | people: {len(people_rows):,}", flush=True)

    ctype_by_mid = {int(m["id"]): (m.get("content_type") or "").lower() for m in sb_media}
    top_dizi_refresh_ids = set()
    if args.refresh_tv_leads > 0:
        dizi_seen = 0
        for m in sb_media:
            if (m.get("content_type") or "").lower() == "dizi":
                mid_i = int(m["id"])
                tid_i = m.get("tmdb_id") or (sqlite_meta.get(mid_i, (None, None))[1])
                if tid_i and int(tid_i) > 0:
                    top_dizi_refresh_ids.add(mid_i)
                    dizi_seen += 1
                    if dizi_seen >= args.refresh_tv_leads:
                        break

    # Identify hierarchy anomalies on already-populated media + missing-cast targets
    mismatched_media_ids = set()
    for mid, crows in existing_cast_by_media.items():
        m_ctype = ctype_by_mid.get(mid, "")
        max_leads = 6 if m_ctype != "film" else 5
        leads = sum(1 for c in crows if c.get("role_type") == "lead")
        supps = sum(1 for c in crows if c.get("role_type") == "support")
        has_bad_order = any(
            (c.get("role_type") == "lead" and (c.get("billing_order") or 99) > max_leads and len(crows) >= 6)
            or (c.get("role_type") == "support" and (c.get("billing_order") or 99) <= 2 and leads == 0)
            for c in crows
        )
        under_leaded_tv = (m_ctype == "dizi" and args.refresh_tv_leads > 0 and len(crows) >= 5 and leads < 4)
        in_top_tv_refresh = (mid in top_dizi_refresh_ids)
        if (
            (len(crows) >= (max_leads + 1) and leads > max_leads)
            or (len(crows) >= 2 and leads == 0)
            or (len(crows) >= 7 and supps == 0)
            or has_bad_order
            or under_leaded_tv
            or in_top_tv_refresh
        ):
            mismatched_media_ids.add(mid)

    print(f"Hiyerarşi anomalisi tespit edilen kadrolu yapım sayısı: {len(mismatched_media_ids):,}", flush=True)

    anilist_targets = defaultdict(list)
    tmdb_targets = []
    mdl_targets = []

    for m in sb_media:
        mid = int(m["id"])
        has_cast = mid in existing_cast_by_media
        if args.mode == "backfill" and has_cast:
            continue
        if args.mode == "fix" and not has_cast:
            continue
        # When mode=all, process all missing-cast media AND all cast-populated media (or anomalous ones first)
        ctype = m.get("content_type") or ""
        tid = m.get("tmdb_id")
        aid = m.get("anilist_id")
        mdl = m.get("mydramalist_url")
        if mid in sqlite_meta:
            s_aid, s_tid, s_ct, s_mdl = sqlite_meta[mid]
            aid = aid or s_aid
            tid = tid or s_tid
            ctype = ctype or (s_ct or "")
            mdl = mdl or s_mdl

        if ctype == "anime" and aid and int(aid) > 0:
            if not has_cast or mid in mismatched_media_ids:
                anilist_targets[int(aid)].append(mid)
        elif tid and int(tid) > 0:
            if not has_cast or mid in mismatched_media_ids:
                tmdb_targets.append((mid, int(tid), ctype))
        elif mdl and args.include_mdl and (not has_cast or mid in mismatched_media_ids):
            mdl_targets.append((mid, mdl))

    if args.limit > 0:
        tmdb_targets = tmdb_targets[: args.limit]
        mdl_targets = mdl_targets[: args.limit]
        limited_aids = sorted(anilist_targets.keys())[: args.limit]
        anilist_targets = {k: anilist_targets[k] for k in limited_aids}

    print(
        f"Hedefler -> AniList: {sum(len(v) for v in anilist_targets.values()):,} yapım ({len(anilist_targets)} ID) | "
        f"TMDB: {len(tmdb_targets):,} | MDL: {len(mdl_targets):,}",
        flush=True,
    )

    totals = defaultdict(int)

    # Phase 1: AniList
    unique_aids = sorted(anilist_targets.keys())
    for i in range(0, len(unique_aids), 50):
        batch = unique_aids[i : i + 50]
        edges_by_aid = fetch_anilist_page_by_ids(batch)
        planned_by_media = {}
        for aid, edges in edges_by_aid.items():
            planned = []
            for c_idx, edge in enumerate(edges, 1):
                node = edge.get("node") or {}
                vas = edge.get("voiceActors") or []
                va = vas[0] if vas else {}
                cname = (node.get("name") or {}).get("full") or (node.get("name") or {}).get("userPreferred") or ""
                if not cname:
                    continue
                vname = (va.get("name") or {}).get("full") or (va.get("name") or {}).get("userPreferred") or ""
                planned.append({
                    "name": cname,
                    "slug": slugify(cname),
                    "img_url": (node.get("image") or {}).get("large") or (node.get("image") or {}).get("medium"),
                    "tmdb_id": None,
                    "anilist_id": int(node["id"]) if node.get("id") else None,
                    "person_type": "character",
                    "character_name": f"Seslendiren: {vname}" if vname else cname,
                    "role_type": "lead" if edge.get("role") == "MAIN" else "support",
                    "billing_order": c_idx,
                    "voice_actor_name": vname or None,
                    "voice_actor_image": (va.get("image") or {}).get("large"),
                    "voice_actor_slug": slugify(vname) if vname else None,
                })
            if planned:
                for mid in anilist_targets[aid]:
                    planned_by_media[mid] = planned
        if planned_by_media:
            res = apply_cast_for_batch(sb_url, sb_key, planned_by_media, existing_cast_by_media, people_idx, dry_run=dry_run)
            for k, v in res.items():
                totals[k] += v
        done = min(i + 50, len(unique_aids))
        if done % 200 == 0 or done == len(unique_aids):
            _progress("AniList cast sync", done, len(unique_aids), f"repaired={totals['repaired_media']} backfilled={totals['backfilled_media']}")
        time.sleep(0.5)

    # Phase 2: TMDB
    if tmdb_targets and tmdb_key:
        for i in range(0, len(tmdb_targets), 200):
            chunk = tmdb_targets[i : i + 200]
            planned_by_media = {}
            with ThreadPoolExecutor(max_workers=25) as pool:
                for fut in as_completed([pool.submit(fetch_tmdb_cast_single, tmdb_key, item) for item in chunk]):
                    mid, planned = fut.result()
                    if planned:
                        planned_by_media[mid] = planned
            if planned_by_media:
                res = apply_cast_for_batch(sb_url, sb_key, planned_by_media, existing_cast_by_media, people_idx, dry_run=dry_run)
                for k, v in res.items():
                    totals[k] += v
            done = min(i + 200, len(tmdb_targets))
            _progress("TMDB cast sync", done, len(tmdb_targets), f"repaired={totals['repaired_media']} backfilled={totals['backfilled_media']}")

    # Phase 3: MDL (cleanly aborts if Cloudflare challenge triggers)
    if mdl_targets:
        planned_mdl = {}
        for idx, (mid, mdl_url) in enumerate(mdl_targets, 1):
            planned, cf_blocked = fetch_mdl_cast_single(mdl_url)
            if cf_blocked:
                print(f"[MDL] Cloudflare engeli algılandı -> MDL aşaması güvenle atlanıyor ({idx}/{len(mdl_targets)}).", flush=True)
                break
            if planned:
                planned_mdl[mid] = planned
            if idx % 25 == 0 or idx == len(mdl_targets):
                _progress("MDL cast sync", idx, len(mdl_targets), f"matched={len(planned_mdl)}")
            time.sleep(0.6)
        if planned_mdl:
            res = apply_cast_for_batch(sb_url, sb_key, planned_mdl, existing_cast_by_media, people_idx, dry_run=dry_run)
            for k, v in res.items():
                totals[k] += v

    print(
        f"\n[TAMAMLANDI] ({'DRY-RUN' if dry_run else 'APPLY'}) -> {json.dumps(dict(totals), ensure_ascii=False)}",
        flush=True,
    )
    print(f"__RESULT__ {json.dumps({'ok': True, 'dryRun': dry_run, 'mismatchedDetected': len(mismatched_media_ids), **dict(totals)}, ensure_ascii=False)}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
