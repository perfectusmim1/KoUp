"""
Merges all duplicate actors in SQLite (webdrama_archive.db).
Re-points all drama_actors relations, merges metadata, cleans slugs, and removes duplicates.
Supports --db and --dry-run safely.
"""

import argparse
import os
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")

_TR_MAP = str.maketrans({
    "ı": "i", "İ": "i", "I": "i",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
})


def clean_slug(s):
    if not s:
        return ""
    s = s.lower().strip()
    if s.startswith("char-"):
        s = s[5:]
    s = re.sub(r"-\d+$", "", s).strip("-")
    return s


def compact_slug(s):
    if not s:
        return ""
    cs = clean_slug(s)
    cs = cs.translate(_TR_MAP).lower()
    cs = unicodedata.normalize("NFKD", cs).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", cs)


def norm_name(n):
    if not n:
        return ""
    s = str(n).translate(_TR_MAP).lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s)


def pick_best_slug(group):
    candidates = []
    for a in group:
        raw_slug = a[1] or ""
        cs = clean_slug(raw_slug)
        if cs:
            is_numbered = bool(re.search(r"-\d+$", raw_slug))
            is_char = raw_slug.startswith("char-")
            hyphens = cs.count("-")
            penalty = (100 if is_char else 0) + (50 if is_numbered else 0) + hyphens * 2 + len(cs) * 0.01
            candidates.append((penalty, cs, raw_slug))
    if not candidates:
        return ""
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def score_actor(a, drama_counts, best_slug=None):
    aid = a[0]
    slug = a[1] or ""
    image_url = a[5] or a[3]
    tmdb_id = a[13]
    bio = a[12]
    birth_date = a[8]

    score = drama_counts.get(aid, 0) * 10
    if best_slug and slug == best_slug:
        score += 800
    elif not re.search(r"-\d+$", slug) and not slug.startswith("char-"):
        score += 500
    if tmdb_id and tmdb_id > 0:
        score += 300
    if image_url and not str(image_url).endswith("/logo-dark.png"):
        score += 100
    if bio:
        score += 50
    if birth_date:
        score += 30
    score += max(0, 100000 - aid) * 0.0001
    return score


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


def run_sqlite_actor_merge(db_path: str = None, dry_run: bool = False):
    target_db = db_path or os.environ.get("ARCHIVE_DB_PATH") or DB_PATH
    conn = sqlite3.connect(target_db, timeout=60.0)
    cur = conn.cursor()
    cur.execute("PRAGMA busy_timeout = 60000;")

    cur.execute("SELECT actor_id, COUNT(*) FROM drama_actors GROUP BY actor_id")
    drama_counts = dict(cur.fetchall())

    cur.execute(
        "SELECT id, slug, name, profile_url, mydramalist_url, image_url, created_at, "
        "gender, birth_date, death_date, place_of_birth, native_name, bio_tr, tmdb_id, anilist_id "
        "FROM actors"
    )
    actors = cur.fetchall()

    actor_ids = [a[0] for a in actors]
    uf = UnionFind(actor_ids)
    key_to_ids = defaultdict(list)

    for a in actors:
        aid = a[0]
        slug = a[1] or ""
        name = a[2] or ""
        tmdb_id = a[13]
        anilist_id = a[14]

        cs = clean_slug(slug)
        if cs and len(cs) >= 3:
            key_to_ids[f"cs:{cs}"].append(aid)

        cps = compact_slug(slug)
        if cps and len(cps) >= 4:
            key_to_ids[f"cps:{cps}"].append(aid)

        nn = norm_name(name)
        if nn and len(nn) >= 3:
            key_to_ids[f"nn:{nn}"].append(aid)

        if tmdb_id and tmdb_id > 0:
            key_to_ids[f"tmdb:{tmdb_id}"].append(aid)

        if anilist_id and anilist_id > 0:
            key_to_ids[f"anilist:{anilist_id}"].append(aid)

    for _, ids in key_to_ids.items():
        if len(ids) > 1:
            first = ids[0]
            for other in ids[1:]:
                uf.union(first, other)

    raw_clusters = defaultdict(list)
    for a in actors:
        raw_clusters[uf.find(a[0])].append(a)

    dup_groups = []
    for c in raw_clusters.values():
        if len(c) <= 1:
            continue
        tmdbs = {a[13] for a in c if a[13] and a[13] > 0}
        anils = {a[14] for a in c if a[14] and a[14] > 0}

        if len(tmdbs) > 1 or len(anils) > 1:
            if len(tmdbs) > 1:
                tmdb_sub = defaultdict(list)
                for a in c:
                    if a[13] and a[13] > 0:
                        tmdb_sub[a[13]].append(a)
                for sub in tmdb_sub.values():
                    if len(sub) > 1:
                        dup_groups.append(sub)
            elif len(anils) > 1:
                ani_sub = defaultdict(list)
                for a in c:
                    if a[14] and a[14] > 0:
                        ani_sub[a[14]].append(a)
                for sub in ani_sub.values():
                    if len(sub) > 1:
                        dup_groups.append(sub)
        elif tmdbs and anils:
            continue
        else:
            dup_groups.append(c)

    print(f"[SQLite] Toplam duplicate aktör grubu: {len(dup_groups)} (dry_run={dry_run})", flush=True)

    if dry_run:
        conn.close()
        return {"groups": len(dup_groups), "merged": sum(len(g) - 1 for g in dup_groups), "relinked": 0}

    total_merged = 0
    total_relinked = 0
    total_groups = len(dup_groups)

    for g_idx, group in enumerate(dup_groups, 1):
        desired_slug = pick_best_slug(group)
        sorted_actors = sorted(group, key=lambda a: score_actor(a, drama_counts, desired_slug), reverse=True)
        primary = sorted_actors[0]
        duplicates = sorted_actors[1:]

        p_id = primary[0]
        p_slug = primary[1]

        for dup in duplicates:
            d_id = dup[0]
            updates = []
            params = []
            col_map = [
                (5, "image_url"),
                (13, "tmdb_id"),
                (14, "anilist_id"),
                (7, "gender"),
                (8, "birth_date"),
                (9, "death_date"),
                (10, "place_of_birth"),
                (11, "native_name"),
                (12, "bio_tr"),
                (4, "mydramalist_url"),
                (3, "profile_url"),
            ]
            for idx_col, col_name in col_map:
                if not primary[idx_col] and dup[idx_col]:
                    updates.append(f"{col_name} = ?")
                    params.append(dup[idx_col])

            if updates:
                params.append(p_id)
                cur.execute(f"UPDATE actors SET {', '.join(updates)} WHERE id = ?", params)

            cur.execute("SELECT drama_id, character_name FROM drama_actors WHERE actor_id = ?", (d_id,))
            dup_dramas = cur.fetchall()
            for did, _ in dup_dramas:
                cur.execute("SELECT actor_id FROM drama_actors WHERE drama_id = ? AND actor_id = ?", (did, p_id))
                if cur.fetchone():
                    cur.execute("DELETE FROM drama_actors WHERE drama_id = ? AND actor_id = ?", (did, d_id))
                else:
                    cur.execute(
                        "UPDATE drama_actors SET actor_id = ? WHERE drama_id = ? AND actor_id = ?",
                        (p_id, did, d_id),
                    )
                    total_relinked += 1

            cur.execute("DELETE FROM actors WHERE id = ?", (d_id,))
            total_merged += 1

        if desired_slug and desired_slug != p_slug:
            cur.execute("SELECT id FROM actors WHERE slug = ? AND id != ?", (desired_slug, p_id))
            if not cur.fetchone():
                cur.execute("UPDATE actors SET slug = ? WHERE id = ?", (desired_slug, p_id))

        if g_idx % 50 == 0 or g_idx == total_groups:
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"[{ts}] [{g_idx}/{total_groups}] ({g_idx / total_groups * 100:.1f}%) - SQLite aktör birleştirme", flush=True)

    conn.commit()
    print(f"[SQLite] {total_merged} mükerrer aktör birleştirildi. {total_relinked} yapım ilişkisi aktarıldı.", flush=True)

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()
    return {"groups": len(dup_groups), "merged": total_merged, "relinked": total_relinked}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KoUp SQLite Actor Duplicate Merger")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite DB")
    parser.add_argument("--dry-run", action="store_true", help="Preview without mutating SQLite")
    args = parser.parse_args()
    run_sqlite_actor_merge(db_path=args.db, dry_run=args.dry_run)
    sys.exit(0)
