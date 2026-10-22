#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/live_multi_search.py

Performs lightning-fast concurrent search across:
1. KoUp Local Catalog (SQLite dramas table)
2. AsyaWatch (asyawatch.com)
3. DiziFon (dizifon.cc)
4. DiziKorea (dizikorea3.com)
5. AnimeciX (animecix.tv)
6. DiziBox (dizibox.live)

Returns structured JSON output with all discovered matches and exact site slugs.
"""

import sys
import os
import re
import json
import base64
import urllib.parse
import urllib.request
import ssl
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from database import get_connection

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}


def search_local_catalog(q: str):
    conn = get_connection()
    c = conn.cursor()
    pat = f"%{q}%"
    rows = c.execute("""
        SELECT d.id, d.title, d.slug, d.cover_image, d.content_type, d.status_broadcast,
               d.episode_count, d.sources_count, d.release_year,
               sa.is_active as is_automated, sa.connected_sites, sa.site_slugs
        FROM dramas d
        LEFT JOIN series_automations sa ON d.id = sa.media_id
        WHERE d.title LIKE ? OR d.slug LIKE ?
        ORDER BY CASE WHEN d.title LIKE ? THEN 0 ELSE 1 END, d.id DESC
        LIMIT 10
    """, (pat, pat, f"{q}%")).fetchall()
    conn.close()

    results = []
    for r in rows:
        results.append({
            "id": r[0],
            "title": r[1],
            "slug": r[2],
            "cover_image": r[3],
            "content_type": r[4],
            "status_broadcast": r[5],
            "episode_count": r[6],
            "sources_count": r[7],
            "release_year": r[8],
            "is_automated": bool(r[9]),
            "connected_sites": json.loads(r[10]) if r[10] else [],
            "site_slugs": json.loads(r[11]) if r[11] else {},
        })
    return results


def clean_display_title(raw: str) -> str:
    if not raw:
        return ''
    t = re.sub(r'★\s*[\d.]+\s*', '', raw)
    t = re.sub(r'\d+\.\s*(Sezon|Bölüm).*$', '', t, flags=re.I)
    t = re.sub(r'\b(izle|hdfilmcehennemi|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|kore dizisi|kore|japon|tayland|çin|cin|d1|altyazı|dublaj|\d+\s*saat\s*önce|\d+\s*gün\s*önce)\b', '', t, flags=re.I)
    t = re.sub(r'\b(19\d\d|20\d\d)\b', '', t)
    t = re.sub(r'[\-_|:•]+$', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def query_matches(q: str, slug: str, title: str) -> bool:
    q_words = [w.lower() for w in re.findall(r'[a-zA-Z0-9]+', q) if len(w) >= 2]
    if not q_words:
        return True
    target = f"{slug.lower()} {title.lower()}"
    return all(w in target for w in q_words) or any(w in target for w in q_words if len(w) >= 4)


def search_asyawatch(q: str):
    url = f"https://asyawatch.com/api/bg/searchContent?searchterm={urllib.parse.quote(q)}"
    req = urllib.request.Request(
        url,
        data=b"",
        headers={'Referer': 'https://asyawatch.com/', 'Origin': 'https://asyawatch.com', **HEADERS},
        method="POST",
    )
    results = []
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            data = json.loads(r.read().decode('utf-8', errors='ignore'))
            s_raw = data.get('response', '')
            if s_raw:
                dec = json.loads(base64.b64decode(s_raw).decode('utf-8', errors='ignore'))
                seen = set()
                for itm in dec.get('result', []):
                    used_slug = (itm.get('used_slug') or '').strip('/')
                    if not used_slug.startswith('dizi/'):
                        continue
                    slug = used_slug.split('dizi/')[-1].strip('/')
                    if not slug or slug in seen:
                        continue
                    raw_title = itm.get('object_name') or ''
                    clean_t = clean_display_title(raw_title) or slug.replace('-', ' ').title()
                    if not query_matches(q, slug, clean_t):
                        continue
                    seen.add(slug)
                    results.append({
                        "site": "asyawatch",
                        "site_name": "AsyaWatch",
                        "badge": "1080p HLS",
                        "title": clean_t,
                        "slug": slug,
                        "url": f"https://asyawatch.com/dizi/{slug}",
                        "cover_image": itm.get('object_poster_url'),
                    })
                    if len(results) >= 6:
                        break
    except Exception:
        pass
    return results


def search_dizifon(q: str):
    url = f"https://www.dizifon.cc/?s={urllib.parse.quote(q)}"
    req = urllib.request.Request(url, headers=HEADERS)
    results = []
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(html, 'html.parser')
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('-izle' in h or '-cin' in h or '-kore' in h or '-japon' in h or '-tayland' in h):
                    slug = h.split('/dizi/')[-1].strip('/')
                    if slug and slug not in seen:
                        raw_title = a.get_text(strip=True) or ''
                        clean_t = clean_display_title(raw_title) or slug.replace('-', ' ').title()
                        if not query_matches(q, slug, clean_t):
                            continue
                        seen.add(slug)
                        results.append({
                            "site": "dizifon",
                            "site_name": "DiziFon",
                            "badge": "OK.ru / Vidmoly",
                            "title": clean_t,
                            "slug": slug,
                            "url": h,
                            "cover_image": None,
                        })
                        if len(results) >= 6:
                            break
    except Exception:
        pass
    return results


def search_dizikorea(q: str):
    url = f"https://dizikorea3.com/?s={urllib.parse.quote(q)}"
    req = urllib.request.Request(url, headers={'Referer': 'https://dizikorea3.com/', **HEADERS})
    results = []
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as r:
            html = r.read().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(html, 'html.parser')
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if '/dizi/' in h and ('-izle' in h or '-dq' in h):
                    slug = h.split('/dizi/')[-1].strip('/')
                    if not slug or slug in seen:
                        continue
                    raw_title = a.get_text(strip=True) or ''
                    clean_t = clean_display_title(raw_title) or slug.replace('-', ' ').title()
                    if not query_matches(q, slug, clean_t):
                        continue
                    seen.add(slug)
                    results.append({
                        "site": "dizikorea",
                        "site_name": "DiziKorea",
                        "badge": "PlayerDKorea",
                        "title": clean_t,
                        "slug": slug,
                        "url": h,
                        "cover_image": None,
                    })
                    if len(results) >= 6:
                        break
    except Exception:
        pass
    return results


def search_animecix(q: str):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        ANIMECIX_KEY = b'i4C7R2fXGocdYgFLzCbDlsJjukf8G58b'
        aes = AESGCM(ANIMECIX_KEY)
        iv = os.urandom(12)
        qs = f"query={urllib.parse.quote(q)}&onlyStreamable=true&page=1&perPage=6"
        plaintext = ('{version}' + qs).encode('utf-8')
        ct = aes.encrypt(iv, plaintext, None)
        h_val = f"{base64.b64encode(ct).decode('ascii')}.{base64.b64encode(iv).decode('ascii')}"

        url = f"https://animecix.tv/secure/titles?{qs}"
        req = urllib.request.Request(url, headers={
            'X-E-H': h_val,
            'Accept': 'application/json',
            'User-Agent': HEADERS['User-Agent']
        })
        with urllib.request.urlopen(req, context=ctx, timeout=6) as r:
            data = json.loads(r.read().decode('utf-8'))
            items = data.get('pagination', {}).get('data', [])
            results = []
            for item in items:
                results.append({
                    "site": "animecix",
                    "site_name": "AnimeciX",
                    "badge": "Tau-Video Native",
                    "title": item.get('name') or item.get('name_english'),
                    "slug": str(item.get('id')),
                    "url": f"https://animecix.tv/titles/{item.get('id')}",
                    "cover_image": item.get('poster'),
                })
            return results
    except Exception:
        return []


def search_dizibox(q: str):
    url = f"https://www.dizibox.live/?s={urllib.parse.quote(q)}"
    req = urllib.request.Request(url, headers={'Referer': 'https://www.dizibox.live/', **HEADERS})
    results = []
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=6) as r:
            html = r.read().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(html, 'html.parser')
            seen = set()
            for a in soup.find_all('a', href=True):
                h = a['href']
                if 'dizibox.live/' in h and not '/bolum/' in h and not '/sezon-' in h and not '?s=' in h:
                    slug = h.replace('https://www.dizibox.live/', '').strip('/')
                    if slug and slug not in seen and not any(skip in slug for skip in ['diziler', 'kategori', 'page', 'iletisim', 'dmca', 'takvim']):
                        seen.add(slug)
                        results.append({
                            "site": "dizibox",
                            "site_name": "DiziBox",
                            "badge": "DBX Pro 1080p",
                            "title": a.get_text(strip=True) or slug.replace('-', ' ').title(),
                            "slug": slug,
                            "url": h,
                            "cover_image": None,
                        })
                        if len(results) >= 6:
                            break
    except Exception:
        pass
    return results


def multi_search(q: str):
    q = q.strip()
    if not q:
        return {"catalog": [], "live_sites": []}

    local_results = search_local_catalog(q)

    live_results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        f_asya = executor.submit(search_asyawatch, q)
        f_dfon = executor.submit(search_dizifon, q)
        f_dkorea = executor.submit(search_dizikorea, q)
        f_anime = executor.submit(search_animecix, q)
        f_dbox = executor.submit(search_dizibox, q)

        for f in [f_asya, f_dfon, f_dkorea, f_anime, f_dbox]:
            try:
                res = f.result()
                if res:
                    live_results.extend(res)
            except Exception:
                pass

    return {
        "query": q,
        "catalog": local_results,
        "live_sites": live_results
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Query required"}))
        return
    query = sys.argv[1]
    data = multi_search(query)
    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
