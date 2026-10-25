import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    sb_request,
    upload_to_r2,
    backup_db_to_r2,
)

DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")


def extract_mdl_slug(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"mydramalist\.com/(\d+-[a-z0-9-]+)", str(url).lower())
    if m:
        return m.group(1)
    m2 = re.search(r"^/?(\d+-[a-z0-9-]+)", str(url).lower().strip())
    return m2.group(1) if m2 else ""


def norm_title(s: str) -> str:
    if not s:
        return ""
    s = str(s).lower()
    s = s.replace("ı", "i").replace("ğ", "g").replace("ü", "u").replace("ş", "s").replace("ö", "o").replace("ç", "c")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def first_sig_word(title: str) -> str:
    n = norm_title(title)
    for w in n.split():
        if len(w) >= 3 and w not in ("the", "and", "shin", "new", "gekijouban", "movie", "film", "ova", "super"):
            return w
    return n.split()[0] if n.split() else ""


def extract_order_markers(title: str, slug: str):
    """
    Returns (season_num, part_num, movie_num, is_special, is_recap, is_movie_kw)
    for accurate chronological & watch-order sorting within a franchise.
    """
    t = f"{title or ''} {slug or ''}".lower()
    t = re.sub(r"\b(19\d\d|20\d\d)\b", "", t)
    t = re.sub(r"animecix-\d+", "", t)

    season_num = 1
    for m in re.finditer(r"(?:season|sezon)\s*0*(\d+)|0*(\d+)\.?\s*sezon|0*(\d+)(?:st|nd|rd|th)\s*season|\bs0*(\d+)\b", t):
        val = int(next(g for g in m.groups() if g is not None))
        if 1 <= val <= 30:
            season_num = max(season_num, val)

    roman_map = {"ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6}
    for m in re.finditer(r"\b(ii|iii|iv|v|vi)\b", t):
        season_num = max(season_num, roman_map[m.group(1)])

    clean_t = re.sub(r"[\(\[].*?[\)\]]", "", (title or "").lower()).strip()
    m_end = re.search(r"\s+(\d)$", clean_t)
    if m_end and 2 <= int(m_end.group(1)) <= 9:
        season_num = max(season_num, int(m_end.group(1)))

    part_num = 1
    for m in re.finditer(r"\b(?:part|kisim|cour)\s*0*(\d+)\b", t):
        val = int(m.group(1))
        if 1 <= val <= 10:
            part_num = max(part_num, val)

    movie_num = 0
    for m in re.finditer(r"\b(?:movie|film)\s*0*(\d+)\b", t):
        movie_num = int(m.group(1))

    is_recap = bool(re.search(r"\b(recap|summary|ozet|soshuhen|henshuu)\b", t))
    is_special = bool(re.search(r"\b(specials?|ova|oav|picture\s*drama|prologue|epilogue|episode\s*0|intermission|mini|chibi|sd)\b", t))
    is_movie_kw = bool(re.search(r"\b(movie|film|gekijouban)\b", t)) or movie_num > 0

    return season_num, part_num, movie_num, is_special, is_recap, is_movie_kw


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, x):
        if x not in self.parent:
            self.parent[x] = x
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if str(ra) < str(rb):
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


# Known multi-franchise crossover hubs on AniList that should attach as leaves
# to each parent franchise rather than merging different franchises together
CROSSOVER_ANILIST_IDS = {
    104454, 111428, 139518,  # Isekai Quartet 1, 2, Movie
    10012, 129870,           # Carnival Phantasm / Fate/Grand Carnival
    132638, 146350,          # Kaginado 1 & 2
    6115, 19511,             # Lupin III vs Detective Conan (Special & Movie)
    176287,                  # Hanma Baki vs. Kengan Ashura
    177778,                  # Ninja Batman tai Yakuza League
    17909,                   # Dream 9 Toriko & One Piece & Dragon Ball Z
    21195,                   # Cyborg 009 VS Devilman
}


def build_graph(sync_cloud: bool = True):
    conn = sqlite3.connect(DB_PATH, timeout=60)
    cur = conn.cursor()

    # 1. Load caches
    al_cache = {}
    for row in cur.execute("""
        SELECT anilist_id, format, start_year, start_month, episodes, romaji_title, english_title, relations_json
        FROM anilist_relations_cache
    """).fetchall():
        aid, fmt, sy, sm, eps, rom, eng, rjson = row
        try:
            edges = json.loads(rjson) if rjson else []
        except Exception:
            edges = []
        al_cache[aid] = {
            "format": fmt,
            "year": sy,
            "month": sm or 1,
            "episodes": eps,
            "romaji": rom or "",
            "english": eng or "",
            "edges": edges,
        }

    tmdb_cols = {}
    for row in cur.execute("""
        SELECT tmdb_id, collection_id, collection_name, release_date, original_title
        FROM tmdb_movie_collections
    """).fetchall():
        tid, cid, cname, rdate, otitle = row
        tmdb_cols[tid] = {
            "collection_id": cid,
            "collection_name": cname,
            "release_date": rdate or "",
            "original_title": otitle or "",
        }

    mdl_cache = {}
    for row in cur.execute("""
        SELECT mdl_slug, mdl_url, relations_json
        FROM mdl_relations_cache
    """).fetchall():
        mslug, murl, rjson = row
        try:
            rels = json.loads(rjson) if rjson else []
        except Exception:
            rels = []
        mdl_cache[mslug] = rels

    # 2. Load all archive dramas
    dramas = {}
    al_to_dramas = defaultdict(list)
    mdl_to_dramas = defaultdict(list)
    tmdb_to_dramas = defaultdict(list)
    imdb_to_dramas = defaultdict(list)
    title_country_to_dramas = defaultdict(list)

    all_rows = cur.execute("""
        SELECT id, slug, title, native_title, content_type, release_year,
               episode_count, episodes_available, sources_count, cover_image,
               anilist_id, tmdb_id, imdb_id, mydramalist_url, country
        FROM dramas
    """).fetchall()

    year_heals = []

    for r in all_rows:
        (
            did, slug, title, nat, ctype, ryear,
            ep_cnt, eps_avail, srcs_cnt, cover,
            al_id, tmdb_id, imdb_id, mdl_url, country
        ) = r

        # Check if release_year is bogus ('1999' on asyaanimeleri or missing) and can be healed from official cache
        yr_int = int(str(ryear)[:4]) if ryear and str(ryear)[:4].isdigit() else None
        if al_id and al_id in al_cache and al_cache[al_id]["year"]:
            al_yr = al_cache[al_id]["year"]
            # If year is missing or scraper placeholder 1999 (when AniList says != 1999)
            if (not yr_int or (yr_int == 1999 and al_yr != 1999 and "asyaanimeleri" in (slug or ""))):
                yr_int = al_yr
                year_heals.append((str(al_yr), did))
        elif ctype == "film" and tmdb_id and tmdb_id in tmdb_cols:
            rdate = tmdb_cols[tmdb_id]["release_date"]
            if rdate and len(rdate) >= 4 and rdate[:4].isdigit():
                tm_yr = int(rdate[:4])
                if not yr_int:
                    yr_int = tm_yr
                    year_heals.append((str(tm_yr), did))

        mdl_slug = extract_mdl_slug(mdl_url)

        d_obj = {
            "id": did,
            "slug": slug,
            "title": title,
            "native_title": nat,
            "content_type": ctype,
            "release_year": yr_int or 2020,
            "episode_count": eps_avail or ep_cnt or 1,
            "sources_count": srcs_cnt or 0,
            "cover_image": cover or "/logo-dark.png",
            "anilist_id": al_id,
            "tmdb_id": tmdb_id,
            "imdb_id": imdb_id,
            "mdl_slug": mdl_slug,
            "country": (country or "").upper(),
        }
        dramas[did] = d_obj

        if al_id and al_id > 0:
            al_to_dramas[al_id].append(did)
        if mdl_slug:
            mdl_to_dramas[mdl_slug].append(did)
        if tmdb_id and tmdb_id > 0:
            tmdb_to_dramas[(ctype, tmdb_id)].append(did)
            tmdb_to_dramas[("ANY", tmdb_id)].append(did)
        if imdb_id and len(str(imdb_id)) > 2:
            imdb_to_dramas[str(imdb_id)].append(did)
        nt = norm_title(title)
        if nt:
            title_country_to_dramas[(nt, (country or "").upper())].append(did)
            title_country_to_dramas[(nt, "ANY")].append(did)

    if year_heals:
        print(f"[Yıl Onarımı] {len(year_heals)} yapımın eksik/1999 yayın yılı resmi veriden güncelleniyor...", flush=True)
        cur.executemany("UPDATE dramas SET release_year = ? WHERE id = ?", year_heals)
        conn.commit()
        if sync_cloud:
            for y_str, did in year_heals[:100]:
                try:
                    sb_request("PATCH", f"/rest/v1/media?id=eq.{did}", body={"release_year": int(y_str)})
                except Exception:
                    pass

    # 3. Build Franchise Union-Find on Drama IDs
    uf = UnionFind()
    # Track directed PREQUEL -> SEQUEL edges between drama_ids for watch-order topological sorting
    prequel_to_sequel = defaultdict(set)
    # Track explicit relation types on drama_ids (e.g. SPIN_OFF, SIDE_STORY, ALTERNATIVE, SUMMARY)
    drama_rel_hints = defaultdict(set)
    # Track crossover leaves: crossover_drama_id -> set of target_drama_ids it attaches to
    crossover_attachments = defaultdict(set)

    # --- LAYER A: ANILIST OFFICIAL RELATIONS GRAPH ---
    # First build core spine on AniList IDs using PREQUEL / SEQUEL / SUMMARY / COMPILATION / CONTAINS
    al_core_uf = UnionFind()
    ALLOWED_AL_RELS = {
        "PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY",
        "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS"
    }

    for aid, info in al_cache.items():
        if aid in CROSSOVER_ANILIST_IDS:
            continue
        w1 = first_sig_word(info["romaji"] or info["english"])
        for edge in info["edges"]:
            rel = edge.get("relationType")
            tid = edge.get("id")
            if not tid or tid in CROSSOVER_ANILIST_IDS or rel not in ALLOWED_AL_RELS:
                continue
            if rel in ("PREQUEL", "SEQUEL", "SUMMARY", "COMPILATION", "CONTAINS"):
                al_core_uf.union(aid, tid)
            else:
                # PARENT / SIDE_STORY / SPIN_OFF / ALTERNATIVE:
                # If they share first significant word, union into core immediately
                t_rom = edge.get("romaji") or edge.get("english") or ""
                w2 = first_sig_word(t_rom)
                if w1 and w2 and w1 == w2:
                    al_core_uf.union(aid, tid)

    # Now check remaining PARENT / SIDE_STORY / SPIN_OFF / ALTERNATIVE edges:
    # For each secondary component, check how many distinct core root titles it connects to.
    sec_to_core_roots = defaultdict(set)
    sec_edges = []
    for aid, info in al_cache.items():
        for edge in info["edges"]:
            rel = edge.get("relationType")
            tid = edge.get("id")
            if not tid or rel not in ALLOWED_AL_RELS:
                continue
            r_a = al_core_uf.find(aid)
            r_t = al_core_uf.find(tid)
            if r_a != r_t:
                sec_edges.append((aid, tid, rel))
                # If aid is a spin-off/side-story/crossover pointing to PARENT tid:
                if rel in ("PARENT", "ALTERNATIVE", "SPIN_OFF", "SIDE_STORY", "CHARACTER", "OTHER"):
                    sec_to_core_roots[r_a].add(r_t)

    # Identify dynamic crossover nodes (any node/chain in CROSSOVER_ANILIST_IDS or connecting >2 unrelated big franchises)
    dynamic_crossovers = set(CROSSOVER_ANILIST_IDS)
    for aid, info in al_cache.items():
        parent_roots = set()
        for edge in info["edges"]:
            if edge.get("relationType") in ("PARENT", "CHARACTER", "SPIN_OFF", "ALTERNATIVE"):
                tid = edge.get("id")
                if tid and tid in al_cache:
                    w_parent = first_sig_word(al_cache[tid]["romaji"] or al_cache[tid]["english"])
                    w_self = first_sig_word(info["romaji"] or info["english"])
                    if w_parent and w_parent != w_self:
                        parent_roots.add(w_parent)
        # If a single anime connects to >= 2 DIFFERENT parent title roots that don't match its own title (e.g. Lupin vs Conan, Baki vs Kengan, Isekai Quartet)
        if len(parent_roots) >= 2:
            dynamic_crossovers.add(aid)

    # Union all non-crossover ALLOWED_AL_RELS on al_uf
    al_uf = UnionFind()
    for aid, info in al_cache.items():
        if aid in dynamic_crossovers:
            continue
        for edge in info["edges"]:
            rel = edge.get("relationType")
            tid = edge.get("id")
            if not tid or tid in dynamic_crossovers or rel not in ALLOWED_AL_RELS:
                continue
            al_uf.union(aid, tid)

            # Record directed PREQUEL/SEQUEL and relation hints on archive dramas
            src_dids = al_to_dramas.get(aid, [])
            dst_dids = al_to_dramas.get(tid, [])
            if rel == "SEQUEL":
                for s_d in src_dids:
                    for d_d in dst_dids:
                        if s_d != d_d:
                            prequel_to_sequel[s_d].add(d_d)
                            drama_rel_hints[d_d].add("SEQUEL")
            elif rel == "PREQUEL":
                for s_d in src_dids:
                    for d_d in dst_dids:
                        if s_d != d_d:
                            prequel_to_sequel[d_d].add(s_d)
                            drama_rel_hints[s_d].add("SEQUEL")
            elif rel in ("SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION"):
                for d_d in dst_dids:
                    drama_rel_hints[d_d].add(rel)

    # Group archive dramas that share an AniList component (or share the same anilist_id)
    al_comp_to_dramas = defaultdict(list)
    for aid, dids in al_to_dramas.items():
        if aid in dynamic_crossovers:
            # Attach crossover drama(s) as leaf to each connected parent franchise in archive
            info = al_cache.get(aid)
            if info:
                for edge in info["edges"]:
                    tid = edge.get("id")
                    if tid and tid in al_to_dramas:
                        for c_did in dids:
                            for p_did in al_to_dramas[tid]:
                                crossover_attachments[c_did].add(p_did)
                                drama_rel_hints[c_did].add("SPIN_OFF")
            continue
        comp_root = al_uf.find(aid)
        al_comp_to_dramas[comp_root].extend(dids)

    for comp_root, dids in al_comp_to_dramas.items():
        if len(dids) > 1:
            first_d = dids[0]
            for d in dids[1:]:
                uf.union(first_d, d)

    # --- LAYER B: TMDB MOVIE COLLECTIONS ---
    col_to_dramas = defaultdict(list)
    for did, d in dramas.items():
        if d["content_type"] == "film" and d["tmdb_id"] and d["tmdb_id"] in tmdb_cols:
            cid = tmdb_cols[d["tmdb_id"]]["collection_id"]
            if cid:
                col_to_dramas[cid].append(did)

    for cid, dids in col_to_dramas.items():
        if len(dids) > 1:
            first_d = dids[0]
            for d in dids[1:]:
                uf.union(first_d, d)

    # --- LAYER C: MYDRAMALIST (MDL) OFFICIAL RELATED CONTENT ---
    ALLOWED_MDL_KEYWORDS = (
        "sequel", "prequel", "spinoff", "spin-off", "side story",
        "parent story", "compilation", "special", "same setting",
        "shared universe", "adaptation", "remake"
    )
    for src_slug, rels in mdl_cache.items():
        src_dids = mdl_to_dramas.get(src_slug, [])
        if not src_dids:
            continue
        for rel_item in rels:
            rel_txt = (rel_item.get("relation") or "").lower()
            if not any(k in rel_txt for k in ALLOWED_MDL_KEYWORDS):
                continue
            target_slug = rel_item.get("slug")
            target_title = norm_title(rel_item.get("title") or "")
            dst_dids = list(mdl_to_dramas.get(target_slug, []))
            if not dst_dids and target_title and len(target_title) >= 5:
                dst_dids = list(title_country_to_dramas.get((target_title, "ANY"), []))

            for s_d in src_dids:
                for d_d in dst_dids:
                    if s_d != d_d:
                        uf.union(s_d, d_d)
                        if "sequel" in rel_txt:
                            prequel_to_sequel[s_d].add(d_d)
                            drama_rel_hints[d_d].add("SEQUEL")
                        elif "prequel" in rel_txt:
                            prequel_to_sequel[d_d].add(s_d)
                            drama_rel_hints[s_d].add("SEQUEL")
                        elif "spinoff" in rel_txt or "spin-off" in rel_txt or "side story" in rel_txt:
                            drama_rel_hints[d_d].add("SPIN_OFF")
                        elif "remake" in rel_txt or "adaptation" in rel_txt:
                            drama_rel_hints[d_d].add("ALTERNATIVE")
                        elif "special" in rel_txt or "compilation" in rel_txt:
                            drama_rel_hints[d_d].add("SUMMARY")

    # --- LAYER D: SHARED TMDB_ID / IMDB_ID (Multi-Season TV Shows) & STRICT SEASON/PREFIX LINKER ---
    for (ctype, tid), dids in tmdb_to_dramas.items():
        if ctype != "ANY" and len(dids) > 1:
            # Verify they share at least 1 word or native title to prevent any residual wrong tmdb_id collision
            w0 = first_sig_word(dramas[dids[0]]["title"])
            for d in dids[1:]:
                wd = first_sig_word(dramas[d]["title"])
                if w0 and wd and (w0 == wd or dramas[dids[0]]["imdb_id"] == dramas[d]["imdb_id"]):
                    uf.union(dids[0], d)

    # Strict Base-Title Season/Sequel/Prefix Linker
    # Matches "<Base Title> 2. Sezon / Season 2 / Part 2 / II / Specials / Movie / : <Subtitle>" to "<Base Title>"
    GENERIC_BASE_TITLES = {
        "love", "hero", "heroes", "monster", "monsters", "secret", "secrets",
        "revenge", "destiny", "youth", "shadow", "shadows", "angel", "angels",
        "devil", "doctor", "doctors", "police", "family", "friends", "school",
        "kingdom", "princess", "prince", "queen", "king", "legend", "stranger",
        "strangers", "missing", "wanted", "signal", "tunnel", "voice", "black",
        "white", "red", "blue", "dark", "light", "time", "life", "world",
        "dream", "dreams", "heart", "hearts", "kiss", "promise", "flower",
        "flowers", "island", "islands", "hotel", "hospital", "prison", "lawyer",
        "prosecutor", "detective", "partner", "partners", "neighbors", "witch",
        "ghost", "vampire", "zombie", "dragon", "tiger", "wolf", "master",
    }

    for did, d in dramas.items():
        raw_t = d["title"] or ""
        # Check explicit Season / Part / Specials / Movie suffix
        base_t = re.sub(
            r"\s*(?:[:\-–]\s*)?(?:\b(?:season|sezon)\s*\d+|\b\d+\.?\s*sezon|\b\d+(?:st|nd|rd|th)\s*season|\bpart\s*\d+|\b\d+\.?\s*kisim|\bspecials?\b|\bova\b|\bona\b|\brecap\b|\bmovie\b.*|\bfilm\b.*|\b(?:ii|iii|iv|v)\b|\b[2-9]\b)\s*$",
            "",
            raw_t,
            flags=re.I,
        ).strip()
        norm_base = norm_title(base_t)
        if norm_base and norm_base != norm_title(raw_t) and len(norm_base) >= 5:
            # Find matching base drama in same country & content_type
            cands = title_country_to_dramas.get((norm_base, d["country"]), [])
            if not cands and d["content_type"] == "anime":
                cands = title_country_to_dramas.get((norm_base, "ANY"), [])
            for cid in cands:
                if cid != did and dramas[cid]["content_type"] == d["content_type"]:
                    uf.union(did, cid)

        # Also for long multi-word anime titles with colon e.g. "Dragon Ball: Nihon Ijin Taisho..."
        if d["content_type"] == "anime" and ":" in raw_t:
            prefix = raw_t.split(":", 1)[0].strip()
            norm_pref = norm_title(prefix)
            if len(norm_pref) >= 8 and norm_pref not in GENERIC_BASE_TITLES:
                cands = title_country_to_dramas.get((norm_pref, "ANY"), [])
                for cid in cands:
                    if cid != did and dramas[cid]["content_type"] == "anime":
                        uf.union(did, cid)

    # 4. Collect Connected Components with >= 2 Archive Items
    comp_members = defaultdict(set)
    for did in dramas:
        root = uf.find(did)
        comp_members[root].add(did)

    # Also add crossover attachments (e.g. Isekai Quartet, Baki vs Kengan, Lupin vs Conan) into each target component
    for cross_did, target_dids in crossover_attachments.items():
        for td in target_dids:
            t_root = uf.find(td)
            if len(comp_members[t_root]) >= 1:
                comp_members[t_root].add(cross_did)

    multi_comps = {root: sorted(mems) for root, mems in comp_members.items() if len(mems) >= 2}
    print(f"[Franchise Graph] Toplam {len(multi_comps)} seri ailesi (toplam {sum(len(v) for v in multi_comps.values())} bağlantılı yapım) oluşturuldu.", flush=True)

    # 5. Classify & Order Items Inside Each Franchise
    franchises_output = {}
    media_to_franchise = {}
    sqlite_rows = []

    for root_id, member_ids in multi_comps.items():
        franchise_key = f"fr_{root_id}"
        items_main = []
        items_side = []

        # Determine if an anime movie is a canon sequel (has both incoming PREQUEL and/or outgoing SEQUEL to a TV series)
        canon_movies = set()
        for mid in member_ids:
            m_obj = dramas[mid]
            al_id = m_obj["anilist_id"]
            al_info = al_cache.get(al_id) if al_id else None
            if al_info and al_info["format"] == "MOVIE":
                # Check if any edge is PREQUEL or SEQUEL (not SIDE_STORY / ALTERNATIVE)
                has_seq_preq = any(e.get("relationType") in ("PREQUEL", "SEQUEL") for e in al_info["edges"])
                if has_seq_preq:
                    canon_movies.add(mid)

        for mid in member_ids:
            m = dramas[mid]
            al_id = m["anilist_id"]
            al_info = al_cache.get(al_id) if al_id else None
            s_num, p_num, m_num, is_spec, is_recap, is_mov_kw = extract_order_markers(m["title"], m["slug"])
            hints = drama_rel_hints.get(mid, set())

            fmt = (al_info["format"] if al_info and al_info["format"] else "").upper()
            al_year = al_info["year"] if al_info and al_info["year"] else m["release_year"]
            al_month = al_info["month"] if al_info and al_info["month"] else 6

            # For TMDB movies, get exact year/month if available
            if m["content_type"] == "film" and m["tmdb_id"] and m["tmdb_id"] in tmdb_cols:
                rdate = tmdb_cols[m["tmdb_id"]]["release_date"]
                if len(rdate) >= 7 and rdate[:4].isdigit() and rdate[5:7].isdigit():
                    al_year = int(rdate[:4])
                    al_month = int(rdate[5:7])

            # Decide category ('main' vs 'side') and Turkish role_label
            category = "main"
            role_label = "Ana Seri"

            if mid in crossover_attachments:
                category = "side"
                role_label = "Özel (Crossover)"
            elif m["content_type"] == "anime":
                if is_recap or "SUMMARY" in hints or "COMPILATION" in hints:
                    category = "side"
                    role_label = "Özet (Recap)"
                elif fmt == "SPECIAL" or is_spec:
                    category = "side"
                    role_label = "Özel Bölüm"
                elif fmt == "OVA":
                    category = "side"
                    role_label = "OVA"
                elif fmt == "MOVIE" or is_mov_kw:
                    if mid in canon_movies and "SIDE_STORY" not in hints and "ALTERNATIVE" not in hints:
                        category = "main"
                        role_label = "Ana Hikaye Filmi"
                    else:
                        category = "side"
                        role_label = f"{m_num}. Film" if m_num > 0 else "Film"
                elif "SPIN_OFF" in hints or "SIDE_STORY" in hints:
                    category = "side"
                    role_label = "Yan Hikaye (Spin-off)"
                elif "ALTERNATIVE" in hints:
                    category = "main"
                    role_label = "Alternatif / Yeniden Yapım"
                else:
                    category = "main"
                    role_label = f"{s_num}. Sezon" if s_num > 1 else "Ana Seri"
            elif m["content_type"] == "film":
                category = "main"
                role_label = "Film"
            else:
                # dizi / program
                if is_spec or "SUMMARY" in hints:
                    category = "side"
                    role_label = "Özel Bölüm"
                elif "SPIN_OFF" in hints:
                    category = "side"
                    role_label = "Yan Dizi (Spin-off)"
                elif "ALTERNATIVE" in hints:
                    category = "side"
                    role_label = "Uyarlama / Remake"
                else:
                    category = "main"
                    role_label = f"{s_num}. Sezon" if s_num > 1 else "Ana Dizi"

            sort_key = (
                al_year or 2020,
                al_month or 6,
                s_num,
                p_num,
                m_num,
                0 if not is_spec else 1,
                mid,
            )

            entry = {
                "id": mid,
                "slug": m["slug"],
                "title": m["title"],
                "release_year": al_year or m["release_year"],
                "content_type": m["content_type"],
                "episode_count": m["episode_count"],
                "cover_image": m["cover_image"],
                "category": category,
                "role_label": role_label,
                "format": fmt or m["content_type"].upper(),
                "_sort_key": sort_key,
            }

            if category == "main":
                items_main.append(entry)
            else:
                items_side.append(entry)

        # If all items ended up in 'side' (e.g. a 2-OVA or 2-Movie franchise), promote them to 'main'
        if not items_main and items_side:
            for it in items_side:
                it["category"] = "main"
            items_main = items_side
            items_side = []

        items_main.sort(key=lambda x: x["_sort_key"])
        items_side.sort(key=lambda x: x["_sort_key"])

        # Number sequential main items nicely if they are generic 'Ana Seri' / 'Ana Dizi' / 'Film'
        for idx, it in enumerate(items_main, 1):
            it["watch_order"] = idx
            if it["content_type"] == "film" and len(items_main) > 1:
                it["role_label"] = f"{idx}. Film"
            elif idx == 1 and it["role_label"] in ("Ana Seri", "Ana Dizi") and len(items_main) > 1:
                it["role_label"] = "1. Sezon / Başlangıç"
            elif idx > 1 and it["role_label"] in ("Ana Seri", "Ana Dizi"):
                it["role_label"] = f"{idx}. Sıra / Devam"
            del it["_sort_key"]

        for idx, it in enumerate(items_side, 1):
            it["watch_order"] = len(items_main) + idx
            del it["_sort_key"]

        all_ordered = items_main + items_side
        franchise_title = items_main[0]["title"] if items_main else all_ordered[0]["title"]
        # Use TMDB collection name if available for film franchises
        if all_ordered[0]["content_type"] == "film":
            first_tid = dramas[all_ordered[0]["id"]]["tmdb_id"]
            if first_tid and first_tid in tmdb_cols and tmdb_cols[first_tid]["collection_name"]:
                franchise_title = re.sub(r"\s*Koleksiyonu\s*$", "", tmdb_cols[first_tid]["collection_name"], flags=re.I).strip()

        franchises_output[franchise_key] = {
            "franchise_id": franchise_key,
            "title": franchise_title,
            "items": all_ordered,
        }

        for it in all_ordered:
            if it["id"] not in crossover_attachments:
                media_to_franchise[str(it["id"])] = franchise_key
            else:
                # Crossover can belong to multiple franchises; store list or primary
                media_to_franchise[str(it["id"])] = franchise_key
            sqlite_rows.append((
                it["id"],
                franchise_key,
                franchise_title,
                it["category"],
                it["role_label"],
                it["watch_order"],
                it["format"],
                it["release_year"],
            ))

    # 6. Save to SQLite table `franchise_items`
    cur.execute("DROP TABLE IF EXISTS franchise_items")
    cur.execute("""
        CREATE TABLE franchise_items (
            media_id INTEGER,
            franchise_id TEXT,
            franchise_title TEXT,
            category TEXT,
            role_label TEXT,
            watch_order INTEGER,
            format TEXT,
            release_year INTEGER,
            PRIMARY KEY (media_id, franchise_id)
        )
    """)
    cur.execute("CREATE INDEX idx_franchise_items_fid ON franchise_items(franchise_id)")
    cur.execute("CREATE INDEX idx_franchise_items_mid ON franchise_items(media_id)")
    cur.executemany("""
        INSERT OR REPLACE INTO franchise_items
        (media_id, franchise_id, franchise_title, category, role_label, watch_order, format, release_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, sqlite_rows)
    conn.commit()

    # 7. Write JSON bundle for Next.js SSR (`koup-app/src/data/franchise_graph.json`) and R2 (`r2_bundles/franchise_graph.json`)
    graph_payload = {
        "media_to_franchise": media_to_franchise,
        "franchises": franchises_output,
    }

    app_data_dir = os.path.join(_ROOT, "koup-app", "src", "data")
    os.makedirs(app_data_dir, exist_ok=True)
    app_json_path = os.path.join(app_data_dir, "franchise_graph.json")
    with open(app_json_path, "w", encoding="utf-8") as f:
        json.dump(graph_payload, f, ensure_ascii=False, separators=(",", ":"))

    r2_json_path = os.path.join(_ROOT, "r2_bundles", "franchise_graph.json")
    os.makedirs(os.path.dirname(r2_json_path), exist_ok=True)
    with open(r2_json_path, "w", encoding="utf-8") as f:
        json.dump(graph_payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(app_json_path) / 1024
    print(f"[JSON Bundle] {app_json_path} yazıldı ({size_kb:.1f} KB).", flush=True)

    # Print sample Dragon Ball franchise to verify!
    db_fid = media_to_franchise.get("6997")
    if db_fid and db_fid in franchises_output:
        db_fr = franchises_output[db_fid]
        print(f"\n=== ÖRNEK DOĞRULAMA: {db_fr['title']} ({len(db_fr['items'])} yapım) ===", flush=True)
        for it in db_fr["items"]:
            print(f"  [{it['category'].upper()}] #{it['watch_order']:02d} ({it['release_year']}) [{it['role_label']}] {it['title']} (slug={it['slug']})", flush=True)

    if sync_cloud:
        print("\n[Cloudflare R2] franchise_graph.json ve webdrama_archive.db yükleniyor...", flush=True)
        upload_to_r2(r2_json_path, "bundles/franchise_graph.json")
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        conn.commit()
        conn.close()
        backup_db_to_r2()
        print("[Cloudflare R2] Senkronizasyon tamamlandı!", flush=True)
    else:
        conn.close()


if __name__ == "__main__":
    build_graph(sync_cloud=True)
