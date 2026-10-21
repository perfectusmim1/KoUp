import sqlite3
import json
import re
import os
import sys
from collections import defaultdict
from difflib import SequenceMatcher

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    sb_request,
    _load_r2_creds,
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
    upload_to_r2,
)
from scripts.export_sources_bundles import export_all

def normalize_title(t):
    if not t:
        return ""
    t = str(t).lower()
    t = t.replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's').replace('ö', 'o').replace('ç', 'c')
    t = re.sub(r'[^a-z0-9]', '', t)
    return t

def get_clean_title(t):
    s = str(t or '').strip()
    s = re.sub(r'\s*\((19|20)\d\d\).*$', '', s)
    s = re.sub(r'\s+(?:20\d\d|kore|cin|japon|tayland|filipinler|asya|izle|hd|box|you|di|ad|ak|aw)$', '', s, flags=re.I)
    s = re.sub(r'-(?:izle|box|you|di|ad|ak|aw|hdf|hd|dizi|film|kore|cin|japon|tayland|20\d\d|-\d+)$', '', s, flags=re.I)
    return s.strip()

SEQUEL_SPECIAL_PATTERNS = [
    r'\b(?:season\s*\d+|\d+\.?\s*sezon|\d+(?:st|nd|rd|th)\s*season)\b',
    r'\b(?:part\s*\d+)\b',
    r'\b(?:specials?|recap|prologue|epilogue|extra\s*stage|side\s*[a-z]|final\s*series|final\s*season|kai)\b',
    r'\b(?:ova|oav|ona)\b',
    r'\b(?:movie|\bfilm\b)\b',
    r'\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b',
    r'\b(?:2nd|3rd|4th|5th)\b',
]

def extract_markers(title):
    t_clean = str(title or '').lower()
    t_no_year = re.sub(r'\b(19\d\d|20\d\d)\b', '', t_clean)
    markers = set()
    for p in SEQUEL_SPECIAL_PATTERNS:
        found = re.findall(p, t_no_year, re.I)
        for f in found:
            markers.add(f.strip().lower())
    for num in re.findall(r'\b\d{1,2}\b', t_no_year):
        markers.add(num.strip())
    return markers

def get_aliases(d):
    aliases = set()
    if d[9]: # native_title
        aliases.add(normalize_title(d[9]))
    dtags = d[10]
    if dtags:
        try:
            parsed = json.loads(dtags)
            if isinstance(parsed, list):
                for x in parsed:
                    norm_x = normalize_title(x)
                    if norm_x not in ('ilkask', 'arkadaslik', 'romantik', 'aksiyon', 'komedi', 'dram', 'fantastik', 'gizem', 'koredizisi', 'asya', 'diziizle'):
                        aliases.add(norm_x)
        except Exception:
            for x in str(dtags).split(','):
                norm_x = normalize_title(x)
                if norm_x not in ('ilkask', 'arkadaslik', 'romantik', 'aksiyon', 'komedi', 'dram', 'fantastik', 'gizem', 'koredizisi', 'asya', 'diziizle'):
                    aliases.add(norm_x)
    return {a for a in aliases if len(a) >= 4}

def years_compatible(y1, y2):
    if not y1 or not y2:
        return True
    try:
        y1_int = int(str(y1)[:4])
        y2_int = int(str(y2)[:4])
        if y1_int > 1900 and y2_int > 1900:
            return abs(y1_int - y2_int) <= 1
    except Exception:
        pass
    return True

def has_id_or_country_conflict(d1, d2):
    c1 = (d1[12] or '').strip().upper()
    c2 = (d2[12] or '').strip().upper()
    if c1 and c2 and c1 != c2:
        return True, f"country_conflict:{c1}!={c2}"
        
    al1 = str(d1[6] or '').strip()
    al2 = str(d2[6] or '').strip()
    al_match = (al1 and al2 and al1 not in ('0', 'None', '') and al2 not in ('0', 'None', '') and al1 == al2)
    
    im1 = str(d1[7] or '').strip()
    im2 = str(d2[7] or '').strip()
    im_match = (im1 and im2 and im1.startswith('tt') and im2.startswith('tt') and im1 == im2)
    
    tm1 = str(d1[8] or '').strip()
    tm2 = str(d2[8] or '').strip()
    tm_match = (tm1 and tm2 and tm1 not in ('0', 'None', '') and tm2 not in ('0', 'None', '') and tm1 == tm2)
    
    if al_match or im_match or tm_match:
        return False, "ok_matched_id"
        
    if tm1 and tm2 and tm1 not in ('0', 'None', '') and tm2 not in ('0', 'None', '') and tm1 != tm2:
        return True, f"tmdb_conflict:{tm1}!={tm2}"
    if im1 and im2 and im1.startswith('tt') and im2.startswith('tt') and im1 != im2:
        return True, f"imdb_conflict:{im1}!={im2}"
    if al1 and al2 and al1 not in ('0', 'None', '') and al2 not in ('0', 'None', '') and al1 != al2:
        return True, f"anilist_conflict:{al1}!={al2}"
        
    return False, "ok"

def get_words(title):
    t_clean = re.sub(r'[\(\)\[\]\{\}\-_:;,\.!\?\'"\+]', ' ', str(title or '').lower())
    t_no_year = re.sub(r'\b(19\d\d|20\d\d)\b', '', t_clean)
    words = {w for w in t_no_year.split() if len(w) >= 3 and w not in ('the', 'and', 'for', 'with', 'from', 'izle', 'dizi', 'film', 'kore', 'cin', 'japon')}
    return words

def are_duplicates(d1, d2, drama_aliases):
    conflict, reason = has_id_or_country_conflict(d1, d2)
    if conflict:
        return False, reason

    ct1, ct2 = d1[3], d2[3]
    if (ct1 == 'film' and ct2 != 'film') or (ct2 == 'film' and ct1 != 'film'):
        if normalize_title(d1[1]) != normalize_title(d2[1]):
            return False, "film_mismatch"
            
    if not years_compatible(d1[4], d2[4]):
        return False, "year_mismatch"

    clean1 = normalize_title(get_clean_title(d1[1]))
    clean2 = normalize_title(get_clean_title(d2[1]))
    norm1 = normalize_title(d1[1])
    norm2 = normalize_title(d2[1])

    m1 = extract_markers(d1[1])
    m2 = extract_markers(d2[1])
    if m1 != m2:
        if clean1 not in drama_aliases[d2[0]] and clean2 not in drama_aliases[d1[0]]:
            return False, f"marker_mismatch:{m1}!={m2}"

    if (':' in d1[1]) != (':' in d2[1]):
        if clean1 != clean2 and clean1 not in drama_aliases[d2[0]] and clean2 not in drama_aliases[d1[0]]:
            return False, "colon_subtitle_mismatch"

    # 1. Exact clean title match
    if clean1 == clean2 and len(clean1) >= 4:
        return True, "exact_clean_title"
        
    # 2. Exact alias match (one's clean title or norm title is in the other's aliases)
    if clean1 in drama_aliases[d2[0]] or clean2 in drama_aliases[d1[0]]:
        return True, "alias_match"
    if norm1 in drama_aliases[d2[0]] or norm2 in drama_aliases[d1[0]]:
        return True, "alias_match"

    # 3. High title similarity - check word set containment
    w1 = get_words(d1[1])
    w2 = get_words(d2[1])
    sim = SequenceMatcher(None, norm1, norm2).ratio()
    if sim >= 0.88 and (w1 == w2 or (w1 and w2 and len(w1 ^ w2) == 0)):
        return True, f"sim_{sim:.2f}"

    return False, "no_match"

def delete_r2_bundle(drama_id: int):
    try:
        import boto3
        endpoint, access_key, secret_key, bucket = _load_r2_creds()
        if endpoint and access_key and secret_key and bucket:
            s3 = boto3.client(
                's3',
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name='auto'
            )
            s3.delete_object(Bucket=bucket, Key=f"sources/{drama_id}.json")
            print(f"    [R2] Deleted sources/{drama_id}.json", flush=True)
    except Exception as e:
        print(f"    [R2 Delete Error] sources/{drama_id}.json: {e}", flush=True)

def score_drama(d):
    # d: id, title, slug, content_type, release_year, cover, al_id, imdb_id, tmdb_id, n_title, tags, alt_sites, ctry, ep_count, src_count
    score = d[14] * 100 + d[13] * 10
    if d[6]: score += 200 # anilist_id
    if d[8]: score += 100 # tmdb_id
    if d[7]: score += 100 # imdb_id
    if d[5] and d[5] != '/logo-dark.png': score += 50
    slug = d[2] or ""
    if any(slug.endswith(x) for x in ['-box', '-you', '-di', '-cin-di', '-kore-di', '-tayland-di', '-2', '-ad', '-ak', '-aw', '-ta']):
        score -= 150
    return score

def run_merge():
    db_path = os.path.join(_ROOT, 'webdrama_archive.db')
    conn = sqlite3.connect(db_path, timeout=60.0)
    conn.execute("PRAGMA busy_timeout = 60000;")
    cur = conn.cursor()

    print("[Merge Duplicates] Arşivdeki tüm seriler taranıyor...", flush=True)

    dramas = cur.execute("""
        SELECT d.id, d.title, d.slug, d.content_type, d.release_year, d.cover_image,
               d.anilist_id, d.imdb_id, d.tmdb_id, d.native_title, d.tags, d.alt_sites,
               d.country,
               (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count,
               (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) as src_count
        FROM dramas d
    """).fetchall()

    drama_dict = {d[0]: d for d in dramas}
    drama_aliases = {d[0]: get_aliases(d) for d in dramas}

    adj = defaultdict(set)
    by_al = defaultdict(list)
    by_tmdb = defaultdict(list)
    by_imdb = defaultdict(list)
    by_clean_title = defaultdict(list)

    for d in dramas:
        did = d[0]
        if d[6] and str(d[6]).isdigit() and int(d[6]) > 0:
            by_al[int(d[6])].append(did)
        if d[8] and str(d[8]).strip() not in ('0', 'None', ''):
            by_tmdb[str(d[8]).strip()].append(did)
        if d[7] and str(d[7]).startswith('tt'):
            by_imdb[str(d[7]).strip()].append(did)
        clean = normalize_title(get_clean_title(d[1]))
        if len(clean) >= 4:
            by_clean_title[clean].append(did)

    def evaluate_pool(pool):
        for key, ids in pool.items():
            if len(ids) > 1:
                for i in range(len(ids)):
                    for j in range(i + 1, len(ids)):
                        id1, id2 = ids[i], ids[j]
                        d1, d2 = drama_dict[id1], drama_dict[id2]
                        ok, _ = are_duplicates(d1, d2, drama_aliases)
                        if ok:
                            adj[id1].add(id2)
                            adj[id2].add(id1)

    evaluate_pool(by_al)
    evaluate_pool(by_tmdb)
    evaluate_pool(by_imdb)
    evaluate_pool(by_clean_title)

    for did1, aliases in drama_aliases.items():
        d1 = drama_dict[did1]
        for alias in aliases:
            if len(alias) >= 5 and alias in by_clean_title:
                for did2 in by_clean_title[alias]:
                    if did1 != did2 and did2 not in adj[did1]:
                        d2 = drama_dict[did2]
                        ok, _ = are_duplicates(d1, d2, drama_aliases)
                        if ok:
                            adj[did1].add(did2)
                            adj[did2].add(did1)

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
                for neighbor in adj[curr]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        q.append(neighbor)
            if len(comp) > 1:
                groups.append(comp)

    total_dups = sum(len(g) - 1 for g in groups)
    print(f"Toplam {len(groups)} adet duplicate kümesi ({total_dups} duplicate seri) tespit edildi.", flush=True)

    merged_count = 0
    migrated_sources_count = 0
    migrated_episodes_count = 0

    for idx, g in enumerate(groups, 1):
        sorted_dramas = sorted([drama_dict[did] for did in g], key=score_drama, reverse=True)
        primary = sorted_dramas[0]
        duplicates = sorted_dramas[1:]

        p_id = primary[0]
        p_title = primary[1]
        p_slug = primary[2]
        print(f"\n[{idx}/{len(groups)}] Ana Seri: #{p_id} '{p_title}' (slug: {p_slug}, eps: {primary[13]}, srcs: {primary[14]})", flush=True)

        # Collect merged alt_sites and tags
        p_alt_sites = set()
        if primary[11]:
            try:
                p_alt_sites.update(json.loads(primary[11]) if isinstance(primary[11], str) else primary[11])
            except Exception:
                p_alt_sites.update(s.strip() for s in str(primary[11]).split(',') if s.strip())

        p_tags = []
        if primary[10]:
            try:
                p_tags = json.loads(primary[10]) if isinstance(primary[10], str) else list(primary[10])
            except Exception:
                p_tags = [s.strip() for s in str(primary[10]).split(',') if s.strip()]

        for dup in duplicates:
            d_id = dup[0]
            d_title = dup[1]
            d_slug = dup[2]
            print(f"  --> Duplicate #{d_id} '{d_title}' (slug: {d_slug}, eps: {dup[13]}, srcs: {dup[14]}) birleştiriliyor...", flush=True)

            # Add title and tags to p_tags
            if d_title and d_title not in p_tags:
                p_tags.append(d_title)
            if dup[10]:
                try:
                    d_parsed_tags = json.loads(dup[10]) if isinstance(dup[10], str) else list(dup[10])
                except Exception:
                    d_parsed_tags = [s.strip() for s in str(dup[10]).split(',') if s.strip()]
                for t_item in d_parsed_tags:
                    if t_item and t_item not in p_tags:
                        p_tags.append(t_item)

            # Add alt_sites from duplicate
            if dup[11]:
                try:
                    p_alt_sites.update(json.loads(dup[11]) if isinstance(dup[11], str) else dup[11])
                except Exception:
                    p_alt_sites.update(s.strip() for s in str(dup[11]).split(',') if s.strip())

            # Backfill primary missing metadata from duplicate
            if not primary[9] and dup[9]: # native_title
                cur.execute("UPDATE dramas SET native_title = ? WHERE id = ?", (dup[9], p_id))
            if not primary[6] and dup[6]: # anilist_id
                cur.execute("UPDATE dramas SET anilist_id = ? WHERE id = ?", (dup[6], p_id))
            if not primary[7] and dup[7]: # imdb_id
                cur.execute("UPDATE dramas SET imdb_id = ? WHERE id = ?", (dup[7], p_id))
            if not primary[8] and dup[8]: # tmdb_id
                cur.execute("UPDATE dramas SET tmdb_id = ? WHERE id = ?", (dup[8], p_id))
            if (not primary[5] or primary[5] == '/logo-dark.png') and dup[5] and dup[5] != '/logo-dark.png':
                cur.execute("UPDATE dramas SET cover_image = ? WHERE id = ?", (dup[5], p_id))

            # Migrate / merge episodes
            dup_eps = cur.execute(
                "SELECT id, season_number, episode_number, episode_name, episode_url FROM episodes WHERE drama_id = ?",
                (d_id,)
            ).fetchall()

            for dep_id, s_num, e_num, ep_name, ep_url in dup_eps:
                p_ep = cur.execute(
                    "SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                    (p_id, s_num, e_num)
                ).fetchone()

                if p_ep:
                    target_ep_id = p_ep[0]
                    dup_srcs = cur.execute(
                        "SELECT source_name, embed_id, direct_url, provider, fansub, site FROM episode_sources WHERE episode_id = ?",
                        (dep_id,)
                    ).fetchall()

                    for s_name, embed_id, direct_url, provider, fansub, site in dup_srcs:
                        exists = cur.execute(
                            "SELECT id FROM episode_sources WHERE episode_id = ? AND (embed_id = ? OR direct_url = ?)",
                            (target_ep_id, embed_id or '__none__', direct_url or '__none__')
                        ).fetchone()

                        if not exists:
                            cur.execute("""
                                INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                            """, (target_ep_id, s_name, embed_id, direct_url, provider, fansub, site))
                            migrated_sources_count += 1

                    cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (dep_id,))
                    cur.execute("DELETE FROM episodes WHERE id = ?", (dep_id,))
                else:
                    cur.execute("UPDATE episodes SET drama_id = ? WHERE id = ?", (p_id, dep_id))
                    migrated_episodes_count += 1

            # Delete remaining duplicate records from SQLite
            try:
                cur.execute("UPDATE OR IGNORE drama_actors SET drama_id = ? WHERE drama_id = ?", (p_id, d_id))
                cur.execute("DELETE FROM drama_actors WHERE drama_id = ?", (d_id,))
            except Exception:
                pass
            try:
                cur.execute("DELETE FROM series_automations WHERE media_id = ?", (d_id,))
            except Exception:
                pass

            cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (d_id,))
            cur.execute("DELETE FROM episodes WHERE drama_id = ?", (d_id,))
            cur.execute("DELETE FROM dramas WHERE id = ?", (d_id,))
            conn.commit()

            # Clean from Supabase
            try:
                sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/episodes?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/media?id=eq.{d_id}")
                print(f"    [Supabase] Cleaned ID #{d_id}", flush=True)
            except Exception as e:
                print(f"    [Supabase Error] Clean ID #{d_id}: {e}", flush=True)

            # Clean duplicate bundle from Cloudflare R2
            delete_r2_bundle(d_id)
            merged_count += 1

        # Update primary drama tags and alt_sites
        final_alt_sites = json.dumps(sorted(list(p_alt_sites))) if p_alt_sites else None
        final_tags = json.dumps(p_tags, ensure_ascii=False) if p_tags else None
        cur.execute("UPDATE dramas SET alt_sites = ?, tags = ? WHERE id = ?", (final_alt_sites, final_tags, p_id))
        conn.commit()

        # Update aka_titles in Supabase so search finds primary under duplicate names
        try:
            sb_media = sb_request("GET", f"/rest/v1/media?id=eq.{p_id}&select=aka_titles")
            existing_aka = []
            if isinstance(sb_media, list) and sb_media and sb_media[0].get("aka_titles"):
                existing_aka = list(sb_media[0]["aka_titles"])
            for dup in duplicates:
                d_t = dup[1]
                if d_t and d_t not in existing_aka and d_t != p_title:
                    existing_aka.append(d_t)
            if existing_aka:
                sb_request("PATCH", f"/rest/v1/media?id=eq.{p_id}", body={"aka_titles": existing_aka})
                print(f"    [Supabase] Updated aka_titles with aliases for #{p_id}", flush=True)
        except Exception as e:
            print(f"    [Supabase aka_titles Error] #{p_id}: {e}", flush=True)

        # Re-sync primary bundle and counts to SQLite, R2, and Supabase
        sync_drama_bundle_and_counts(conn, cur, p_id)
        print(f"    [Primary Sync] Re-synced and uploaded bundle for #{p_id}", flush=True)

    print(f"\n=======================================================", flush=True)
    print(f"[SUCCESS] DUPLICATE MERGE TAMAMLANDI!", flush=True)
    print(f"Toplu Temizlenen Duplicate Seri Sayisi: {merged_count}", flush=True)
    print(f"Aktarilan/Birlestirilen Bolum Sayisi: {migrated_episodes_count}", flush=True)
    print(f"Aktarilan/Birlestirilen Kaynak Sayisi: {migrated_sources_count}", flush=True)
    print(f"=======================================================", flush=True)

    # SQLite WAL Checkpoint & Full R2 Backup (Rule 11)
    print("[R2 DB Backup] Yerel SQLite WAL checkpoint yapılıyor...", flush=True)
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()

    print("[R2 DB Backup] Güncel webdrama_archive.db Cloudflare R2'ye yedekleniyor...", flush=True)
    try:
        backup_db_to_r2()
        print("[R2 DB Backup] Veritabanı Cloudflare R2'ye başarıyla yüklendi (db/webdrama_archive.db).", flush=True)
    except Exception as e:
        print(f"[R2 DB Backup Hatası]: {e}", flush=True)

if __name__ == '__main__':
    run_merge()
