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


def fetch_tmdb_cast_single(tmdb_key: str, item: tuple) -> tuple[int, list[dict]]:
    mid, tid, ctype = item
    is_movie = ctype == "film"
    urls = (
        [f"https://api.themoviedb.org/3/movie/{tid}/credits?api_key={tmdb_key}"]
        if is_movie
        else [
            f"https://api.themoviedb.org/3/tv/{tid}/credits?api_key={tmdb_key}",
            f"https://api.themoviedb.org/3/tv/{tid}/aggregate_credits?api_key={tmdb_key}",
        ]
    )
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "KoUp/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                if resp.status == 200:
                    raw_cast = (json.loads(resp.read().decode("utf-8"))).get("cast") or []
                    if raw_cast:
                        raw_cast.sort(key=lambda x: x.get("order", 999))
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
                            role = "lead" if (ord_val < 4 and idx <= 4) else "support"
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

    new_people_map = {}
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
                or people_by_slug.get(pslug)
                or people_by_clean.get(cslug)
                or people_by_norm.get(nn)
            )
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
                or people_by_slug.get(pslug)
                or people_by_clean.get(cslug)
                or people_by_norm.get(nn)
            )
            if not pid or pid in seen_pids:
                continue
            seen_pids.add(pid)

            ex = ex_by_pid.get(pid)
            if ex:
                if ex.get("role_type") != item["role_type"] or ex.get("billing_order") != item["billing_order"]:
                    role_updates += 1
                    media_had_fix = True
                    if not dry_run:
                        # PK includes role_type, so delete old row if role_type changed
                        if ex.get("role_type") != item["role_type"]:
                            sb_http(
                                sb_url, sb_key, "DELETE",
                                f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{ex['role_type']}",
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
                            sb_http(
                                sb_url, sb_key, "PATCH",
                                f"/rest/v1/media_cast?media_id=eq.{mid}&person_id=eq.{pid}&role_type=eq.{ex['role_type']}",
                                {"billing_order": item["billing_order"]},
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


def main():
    parser = argparse.ArgumentParser(description="KoUp Full-Archive Cast Hierarchy & Backfill Sync")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB (for supplementary IDs)")
    parser.add_argument("--apply", action="store_true", help="Apply updates to Supabase (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Preview hierarchy fixes & backfills without writing")
    parser.add_argument("--mode", choices=["all", "fix", "backfill"], default="all", help="Scope: all, fix existing cast, or backfill missing")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of media per phase (0 = full archive)")
    parser.add_argument("--include-mdl", action="store_true", help="Also query MyDramaList /cast for Asian dramas lacking TMDB ID")
    args = parser.parse_args()

    is_apply = bool(args.apply and not args.dry_run)
    dry_run = not is_apply
    sb_url, sb_key, tmdb_key = _get_creds()
    if not sb_url or not sb_key:
        print("[ERROR] SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY bulunamadı!", flush=True)
        sys.exit(1)

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

    people_rows = fetch_all_pages(sb_url, sb_key, "/rest/v1/people?select=id,slug,name,tmdb_id,anilist_id&order=id.asc")
    people_idx = {"slug": {}, "clean": {}, "norm": {}, "tmdb": {}, "anilist": {}}
    for p in people_rows:
        pid = p.get("id")
        if not pid:
            continue
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

    # Identify hierarchy anomalies on already-populated media + missing-cast targets
    mismatched_media_ids = set()
    for mid, crows in existing_cast_by_media.items():
        leads = sum(1 for c in crows if c.get("role_type") == "lead")
        supps = sum(1 for c in crows if c.get("role_type") == "support")
        has_bad_order = any(
            (c.get("role_type") == "lead" and (c.get("billing_order") or 99) > 4 and len(crows) >= 5)
            or (c.get("role_type") == "support" and (c.get("billing_order") or 99) <= 2 and leads == 0)
            for c in crows
        )
        if (len(crows) >= 5 and leads > 4) or (len(crows) >= 2 and leads == 0) or (len(crows) >= 6 and supps == 0) or has_bad_order:
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
