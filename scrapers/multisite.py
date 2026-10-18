"""Cok siteli birlesim yardimcilari: eslestirme + kaynak numaralandirma + URL dedupe."""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
import re
import json
import time
import sqlite3
import unicodedata

def _retry(fn, *a, **k):
    import random
    for i in range(60):
        try:
            return fn(*a, **k)
        except sqlite3.OperationalError as e:
            if 'locked' not in str(e) or i == 59:
                raise
            time.sleep(1 + i * 0.5 + random.random() * 2)

TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")

def norm_title(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = s.translate(TR).lower()
    s = re.sub(r'\(.*?\)|\[.*?\]', '', s)
    return re.sub(r'[^a-z0-9]', '', s)

def slug_core(slug):
    s = (slug or '').lower()
    s = re.sub(r'-(izle|dq\d*)$', '', s)
    s = re.sub(r'-\d{4}-(kore|cin|japon|tayland|tayvan|asya)$', '', s)
    return re.sub(r'[^a-z0-9]', '', s)

def parse_season_number(text, default=1):
    """Baslik veya bolum adindan sezon numarasini cikarir (orn: '2. Sezon', 'Season 3', 'S02')."""
    if not text:
        return default
    m = re.search(r'(?:sezon|season|part|cour)\s*(\d{1,2})|(\d{1,2})\s*\.\s*sezon|\bS(\d{1,2})(?:E\d+|\b)', str(text), re.IGNORECASE)
    if m:
        for g in m.groups():
            if g and g.isdigit():
                val = int(g)
                if 1 <= val <= 30:
                    return val
    return default

def build_drama_index(cur, content_types=('dizi', 'film', 'program', 'anime')):
    """ Bellek ici indeks: {norm_title: [(id, year, mdl, al, content_type)]}, {mdl: id}, {al: id}, {slugcore: [(id, year, content_type)]}."""
    cur.execute("SELECT id, slug, title, release_year, mydramalist_url, anilist_url, content_type FROM dramas WHERE content_type IN ({})".format(
        ','.join('?' * len(content_types))), content_types)
    by_title, by_mdl, by_al, by_slug = {}, {}, {}, {}
    for did, slug, title, year, mdl, al, ctype in cur.fetchall():
        nt = norm_title(title)
        ct = (ctype or '').strip().lower()
        yr = (year or '').strip()
        if len(nt) >= 4:
            by_title.setdefault(nt, []).append((did, yr, mdl, al, ct))
        if mdl:
            by_mdl[mdl.strip()] = did
        if al:
            by_al[al.strip()] = did
        sc = slug_core(slug or '')
        if len(sc) >= 4:
            by_slug.setdefault(sc, []).append((did, yr, ct))
    return {'title': by_title, 'mdl': by_mdl, 'al': by_al, 'slug': by_slug}

def _years_compatible(y1, y2):
    if not y1 or not y2:
        return True
    try:
        return abs(int(str(y1)[:4]) - int(str(y2)[:4])) <= 1
    except Exception:
        return str(y1).strip() == str(y2).strip()

def find_in_index(idx, title, year=None, slug=None, content_type=None, mdl_url=None, anilist_url=None):
    if mdl_url and mdl_url.strip() in idx.get('mdl', {}):
        return idx['mdl'][mdl_url.strip()]
    if anilist_url and anilist_url.strip() in idx.get('al', {}):
        return idx['al'][anilist_url.strip()]

    target_ct = (content_type or '').strip().lower()
    nt = norm_title(title)
    if len(nt) >= 4 and nt in idx['title']:
        cands = idx['title'][nt]
        # Filter by content_type if specified (never mix anime and live-action dizi)
        if target_ct:
            matching_cands = [c for c in cands if not c[4] or c[4] == target_ct]
            if matching_cands:
                cands = matching_cands
            else:
                # If target is dizi and all candidates are anime, do NOT match!
                if target_ct in ('dizi', 'film') and all(c[4] == 'anime' for c in cands):
                    cands = []
                elif target_ct == 'anime' and all(c[4] in ('dizi', 'film') for c in cands):
                    cands = []

        if cands:
            if year:
                for did, y, _m, _a, _ct in cands:
                    if y == str(year):
                        return did
                for did, y, _m, _a, _ct in cands:
                    if _years_compatible(y, year):
                        return did
                return None
            return cands[0][0]

    if slug:
        sc = slug_core(slug)
        if len(sc) >= 4 and sc in idx['slug']:
            for item in idx['slug'][sc]:
                if isinstance(item, tuple):
                    did, y = item[0], item[1]
                    item_ct = item[2] if len(item) > 2 else None
                    if target_ct and item_ct and target_ct != item_ct:
                        continue
                    if _years_compatible(y, year):
                        return did
                else:
                    return item
    return None

def match_or_create_episode(cur, drama_id, season, number, name, url):
    def _op():
        cur.execute("SELECT id FROM episodes WHERE drama_id=? AND season_number=? AND episode_number=?",
                    (drama_id, season, number))
        r = cur.fetchone()
        if r:
            return r[0], False
        try:
            cur.execute("""INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
                VALUES (?, ?, ?, ?, ?, 1)""", (drama_id, season, number, name, url))
            return cur.lastrowid, True
        except sqlite3.IntegrityError:
            # Ayni URL baska drama/numarada kayitli (toplu bolum vb.): mevcut satiri kullan.
            cur.execute("SELECT id FROM episodes WHERE episode_url=?", (url,))
            r = cur.fetchone()
            if r:
                return r[0], False
            raise
    return _retry(_op)

def add_source(cur, episode_id, source_name, direct_url, provider, site, fansub=None, embed_id=None):
    """Ayni URL varsa site ekle; ayni provider farkli isimse numaralandir (VK, VK2)."""
    if not direct_url:
        return False
    def _op():
        cur.execute("SELECT id, site FROM episode_sources WHERE episode_id=? AND direct_url=?",
                    (episode_id, direct_url))
        r = cur.fetchone()
        if r:
            sites = (r[1] or '').split(',') if r[1] else []
            if site not in sites:
                sites.append(site)
                cur.execute("UPDATE episode_sources SET site=? WHERE id=?", (','.join(sites), r[0]))
            return False
        cur.execute("SELECT source_name FROM episode_sources WHERE episode_id=? AND provider=?",
                    (episode_id, provider))
        taken = [x[0] for x in cur.fetchall()]
        name = (source_name or provider).strip()
        if taken:
            base = re.sub(r'\s*\d+$', '', name)
            n = 2
            cand = f"{base} {n}" if base.upper() != (source_name or '').strip().upper() else f"{name} {n}"
            existing = set(taken)
            while cand in existing:
                n += 1
                cand = f"{base} {n}"
            # ilk kayit numarasz kalir, yeni gelen numaralanir
            if name in existing:
                name = cand
        import hashlib
        eid = embed_id or f"{site[:2]}_{hashlib.md5(direct_url.encode()).hexdigest()[:10]}"
        cur.execute("""INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site, fansub)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                direct_url=excluded.direct_url, provider=excluded.provider,
                source_name=excluded.source_name, fansub=COALESCE(excluded.fansub, episode_sources.fansub)""",
            (episode_id, name, eid, direct_url, provider, site, fansub))
        return True
    return _retry(_op)

def tag_site(cur, drama_id, site):
    cur.execute("SELECT alt_sites, source_url FROM dramas WHERE id=?", (drama_id,))
    r = cur.fetchone()
    try:
        sites = json.loads(r[0] or '[]') if r else []
    except Exception:
        sites = []
    if site not in sites:
        sites.append(site)
        _retry(cur.execute, "UPDATE dramas SET alt_sites=? WHERE id=?", (json.dumps(sites), drama_id))
    if r and r[1]:
        mark_done(cur, site, r[1])

def safe_commit(conn, tries=60):
    import random
    for i in range(tries):
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            if 'locked' not in str(e) or i == tries - 1:
                raise
            time.sleep(1 + i * 0.5 + random.random() * 2)

import os as _os

def load_done_urls(cur, site):
    """Daha once bu siteyle islenmis drama URL'leri (restart sonrasi atlama icin)."""
    cur.execute("SELECT source_url FROM dramas WHERE alt_sites LIKE ?", (f'%{site}%',))
    return set(r[0] for r in cur.fetchall())

def done_urls(cur, site):
    """site_done tablosundaki bitmis URL'ler (eslesenler dahil, kesin)."""
    try:
        cur.execute("SELECT url FROM site_done WHERE site=?", (site,))
        return set(r[0] for r in cur.fetchall())
    except Exception:
        return set()

def mark_done(cur, site, url):
    _retry(cur.execute, "INSERT OR IGNORE INTO site_done (site, url) VALUES (?, ?)", (site, url))

def unique_slug(cur, base):
    """Copismeyen slug uret: baz, baz-2, baz-3..."""
    slug = base
    n = 2
    while True:
        cur.execute("SELECT id FROM dramas WHERE slug=?", (slug,))
        if not cur.fetchone():
            return slug
        slug = f"{base}-{n}"
        n += 1
