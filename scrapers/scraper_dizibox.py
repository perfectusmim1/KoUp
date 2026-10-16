"""
DiziBox Scraper: /dizi-arsivi/ (321 sayfa) -> /diziler/{slug}/ -> bolumler -> king.php -> molystream.
Video cozumu oturum+Referer ister -> curl_cffi.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
import sys
sys.stdout.reconfigure(encoding='utf-8')
import re
import json
import time
import threading
import asyncio
import aiohttp
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from curl_cffi import requests as cfr
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, done_urls, mark_done, unique_slug
from scraper_wp_sites import fetch

BASE = 'https://www.dizibox.live'
SITE = 'dizibox'

_TLS = threading.local()

def vsess():
    s = getattr(_TLS, 's', None)
    if s is None:
        s = cfr.Session(impersonate='chrome')
        _TLS.s = s
    return s

def _call(fn, timeout=30):
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(max_workers=1) as x:
        f = x.submit(fn)
        try:
            return f.result(timeout=timeout)
        except Exception:
            return None

def resolve_episode(ep_url):
    """Bolum sayfasi -> king.php -> molystream embed (oturumlu)."""
    try:
        s = vsess()
        r = _call(lambda: s.get(ep_url, timeout=20))
        if r is None or r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, 'html.parser')
        king = None
        for fr in soup.find_all('iframe'):
            u = fr.get('src') or ''
            if 'king.php' in u:
                king = u if u.startswith('http') else BASE + u
                break
        if not king:
            return None
        time.sleep(0.5)
        g = _call(lambda: s.get(king, headers={'Referer': ep_url}, timeout=20))
        if g is None or g.status_code != 200:
            return None
        if 'birazdan aktif' in g.text:
            return None
        soup2 = BeautifulSoup(g.text, 'html.parser')
        for fr in soup2.find_all('iframe'):
            u = fr.get('src') or ''
            if u and 'convert.php' not in u and 'googletag' not in u:
                return 'https:' + u if u.startswith('//') else u
    except Exception:
        return None
    return None

def parse_drama(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else url.rstrip('/').split('/')[-1]
    slug = url.rstrip('/').split('/')[-1]
    cover = None
    og = soup.find('meta', attrs={'property': 'og:image'})
    if og and og.get('content'):
        cover = og['content']
    year = ''
    my = re.search(r'(19|20)\d\d', soup.get_text()[:2000])
    if my:
        year = my.group(0)
    genres = []
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '/tur/' in h:
            t = a.get_text(strip=True)
            if t and len(t) < 30 and t not in genres:
                genres.append(t)
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if ('-sezon-' not in h or '-bolum' not in h) or h in seen:
            continue
        if h.startswith('/'):
            h = BASE + h
        if 'dizibox.live' not in h:
            continue
        seen.add(h)
        ms = re.search(r'-(\d+)-sezon-', h)
        me = re.search(r'-(\d+)-bolum', h)
        txt = a.get_text(strip=True)[:80]
        episodes.append({'season': int(ms.group(1)) if ms else 1,
                         'number': int(me.group(1)) if me else 1,
                         'name': txt or f"{me.group(1) if me else 1}. Bölüm",
                         'url': h})
    return {'slug': slug, 'title': title, 'year': year, 'cover': cover,
            'genres': genres[:10], 'episodes': episodes, 'url': url}

def parse_episode_king(html):
    soup = BeautifulSoup(html, 'html.parser')
    for fr in soup.find_all('iframe'):
        u = fr.get('src') or ''
        if 'king.php' in u:
            return u if u.startswith('http') else BASE + u
    return None

def parse_king(html):
    soup = BeautifulSoup(html, 'html.parser')
    for fr in soup.find_all('iframe'):
        u = fr.get('src') or ''
        if u and 'convert.php' not in u and 'googletag' not in u:
            return u if u.startswith('http') else 'https:' + u if u.startswith('//') else u
    return None

async def run(limit=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(8)
    connector = aiohttp.TCPConnector(limit=8, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = []
        empty = 0
        for p in range(1, 400):
            u = BASE + '/dizi-arsivi/' if p == 1 else BASE + f'/dizi-arsivi/page/{p}/'
            html = None
            for _ in range(3):
                html = await fetch(sess, u, sem)
                if html:
                    break
            if not html:
                empty += 1
                if empty >= 2:
                    break
                continue
            soup = BeautifulSoup(html, 'html.parser')
            found = 0
            for a in soup.find_all('a', href=True):
                h = a['href'] or ''
                if re.match(r'(https://www\.dizibox\.live)?/diziler/[a-z0-9-]+/?$', h):
                    full = h if h.startswith('http') else BASE + h
                    if full not in urls:
                        urls.append(full)
                        found += 1
            print(f'dizibox katalog sayfa {p}: +{found} (toplam {len(urls)})')
            if not found:
                empty += 1
                if empty >= 2:
                    break
            else:
                empty = 0
        print(f'dizibox katalog: {len(urls)}')
        done0 = done_urls(cur, SITE)
        urls = [u for u in urls if u not in done0]
        print(f'dizibox kalan: {len(urls)}')
        if limit:
            urls = urls[:limit]
        n_new = n_match = n_ep = n_src = 0
        t0 = time.time()
        for i in range(0, len(urls), 15):
            chunk = urls[i:i + 15]
            res = await asyncio.gather(*[fetch(sess, u, sem) for u in chunk])
            jobs = []
            for url, html in zip(chunk, res):
                if not html:
                    continue
                d = parse_drama(html, url)
                if not d['title']:
                    continue
                cur.execute("SELECT id FROM dramas WHERE source_url=?", (url,))
                r0 = cur.fetchone()
                if r0:
                    did = r0[0]
                    n_match += 1
                else:
                    did = find_in_index(idx, d['title'], d['year'], d['slug'])
                    if did:
                        n_match += 1
                    else:
                        slug = unique_slug(cur, d['slug'] + '-box')
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            release_year, categories, tags, alt_sites)
                            VALUES (?, 'dizi', ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, d['title'], url, d['cover'], d['year'],
                             json.dumps(d['genres'], ensure_ascii=False), json.dumps([SITE])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, d['year'], None, None))
                        n_new += 1
                tag_site(cur, did, SITE)
                for ep in d['episodes']:
                    eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    n_ep += 1
                    jobs.append((eid, ep['url']))
                mark_done(cur, SITE, url)
            safe_commit(conn)
            with ThreadPoolExecutor(max_workers=8) as ex:
                eids = [j[0] for j in jobs]
                eurls = [j[1] for j in jobs]
                for eid, m in zip(eids, ex.map(resolve_episode, eurls)):
                    if m and add_source(cur, eid, 'Moly', m, identify_provider(m), SITE):
                        n_src += 1
            safe_commit(conn)
            print(f'dizibox {min(i+15, len(urls))}/{len(urls)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'dizibox TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit))
