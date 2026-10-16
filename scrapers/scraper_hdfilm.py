"""
HDFilmCehennemi Scraper: /tur/* + /yil/* + /category/* listeler -> dizi/film -> gateway HLS.
IMDb linkleri canonical eslesme icin kullanilir.
NOT: icerik sayfalari aiohttp'yi 403'ler -> curl_cffi zorunlu.
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
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from curl_cffi import requests as cfr
from database import get_connection, init_db
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done

BASE = 'https://www.hdfilmcehennemi.nl'
SITE = 'hdfilm'

_TLS = threading.local()

def sess():
    s = getattr(_TLS, 's', None)
    if s is None:
        s = cfr.Session(impersonate='chrome')
        _TLS.s = s
    return s

def fetch(url, referer=None):
    try:
        h = {'Referer': referer or BASE + '/'}
        r = sess().get(url, headers=h, timeout=20)
        if r.status_code == 200:
            return r.text
    except Exception:
        return None
    return None

LIST_PAGES = [
    'https://www.hdfilmcehennemi.nl/yabancidiziizle-5/',
    'https://www.hdfilmcehennemi.nl/category/film-izle-2/',
]

LIST_SKIP = ('/tur/', '/yil/', '/dil/', '/category/', '/film-robotu', '/film-istek',
             '/en-cok-', '/fragman', '/tavsiye', '/nette-ilk', 'yabancidiziizle')

def extract_links(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for a in soup.find_all('a', href=True):
        h = (a['href'] or '').split('?')[0]
        if any(x in h for x in LIST_SKIP):
            continue
        if '/dizi/' in h and h not in out:
            out.append(h if h.startswith('http') else BASE + h)
        elif re.match(r'https://www\.hdfilmcehennemi\.nl/[a-z0-9-]+/?$', h):
            full = h if h.startswith('http') else BASE + h
            if full not in out:
                out.append(full)
    return out

def parse_content(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else ''
    title = re.sub(r'\s*izle\s*(\(20\d\d\))?\s*$', '', title)
    orig, year = '', ''
    m = re.search(r'(.+?)\s*-\s*(.+)', title)
    if m:
        title, orig = m.group(1).strip(), m.group(2).strip()
    my = re.search(r'(19|20)\d\d', h1.get_text(strip=True) if h1 else '')
    if my:
        year = my.group(0)
    imdb = ''
    for a in soup.find_all('a', href=True):
        mm = re.search(r'imdb\.com/title/(tt\d+)', a['href'] or '')
        if mm:
            imdb = mm.group(1)
            break
    genres = [a.get_text(strip=True) for a in soup.select('a[href*="/tur/"]')][:10]
    cover = None
    for img in soup.find_all('img'):
        src = img.get('src') or img.get('data-src') or ''
        if '/images/list/' in src and 'base64' not in src:
            cover = src if src.startswith('http') else BASE + src
            break
    overview = ''
    mt = soup.find('meta', attrs={'name': 'description'})
    if mt:
        overview = mt.get('content', '')
    is_series = '/dizi/' in url
    episodes = []
    if is_series:
        seen = set()
        for a in soup.find_all('a', href=True):
            h = a['href'] or ''
            if ('/sezon-' not in h and '/bolum' not in h) or h in seen:
                continue
            seen.add(h)
            full = h if h.startswith('http') else BASE + h
            ms = re.search(r'sezon-(\d+)', h)
            me = re.search(r'bolum-(\d+)', h)
            episodes.append({'season': int(ms.group(1)) if ms else 1,
                             'number': int(me.group(1)) if me else 1,
                             'name': a.get_text(strip=True)[:60] or f"{me.group(1) if me else 1}. Bölüm",
                             'url': full})
    else:
        episodes = [{'season': 1, 'number': 1, 'name': 'Film', 'url': url}]
    return {'title': title or url.rstrip('/').split('/')[-1], 'orig': orig, 'year': year,
            'imdb': imdb, 'genres': genres, 'cover': cover, 'overview': overview,
            'episodes': episodes, 'url': url, 'is_series': is_series}

def parse_embeds(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for fr in soup.find_all('iframe'):
        u = fr.get('data-src') or fr.get('src') or ''
        if 'hdfilmcehennemi.mobi/video/embed/' in u:
            out.append(('Rapidrame', u))
    for b in soup.find_all(attrs={'data-video': True}):
        t = b.get_text(strip=True)
        if t and t.lower() != 'close':
            out.append((t, None))
    return out

def parse_gateway(html):
    m = re.findall(r'https?://[^"\'\s]*\.mp4/master\.txt[^"\'\s]*', html)
    if m:
        return m[0]
    m = re.findall(r'https?://[^"\'\s]*\.m3u8[^"\'\s]*', html)
    m = [x for x in m if '.css' not in x and '.js' not in x]
    return m[0] if m else None

def decode_gateway_js(html):
    """Obfuske edilmis jwplayer file degiskenini Node ile cozer."""
    import subprocess
    m = re.search(r'sources:\s*\[\{file:\s*(\w+)', html)
    if not m:
        return None
    var = m.group(1)
    scripts = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', html, re.S)
    cand = [s for s in scripts if '.split(' in s and var in s]
    if not cand:
        return None
    stub = "function jwplayer(){}; var $=function(){return{}}; var document={}; var window={}; var navigator={};\n"
    payload = stub + cand[0] + f'\nconsole.log("STREAM:" + {var} + ":END");'
    try:
        r = subprocess.run(['node', '-e', payload], capture_output=True, text=True, timeout=20)
        m2 = re.search(r'STREAM:(.*):END', (r.stdout or ''), re.S)
        if m2:
            return m2.group(1).strip()
    except Exception:
        pass
    return None

def crawl_lists():
    found = {}
    home = fetch(BASE + '/')
    seeds = list(LIST_PAGES)
    if home:
        soup = BeautifulSoup(home, 'html.parser')
        for a in soup.find_all('a', href=True):
            h = (a['href'] or '').split('?')[0]
            if re.match(r'https://www\.hdfilmcehennemi\.nl/(tur|yil|dil|category)/', h) and h not in seeds:
                seeds.append(h)
    print(f'hdfilm liste sayfasi: {len(seeds)}')
    for s in seeds:
        p = 1
        empty = 0
        while p < 120:
            u = s if p == 1 else s.rstrip('/') + f'/page/{p}/'
            html = fetch(u)
            if not html:
                empty += 1
                if empty >= 2:
                    break
                p += 1
                continue
            links = extract_links(html)
            new = [x for x in links if x not in found]
            for x in links:
                found[x] = True
            if not new:
                empty += 1
                if empty >= 2:
                    break
            else:
                empty = 0
            p += 1
        print(f'hdfilm {s.split(".nl/")[-1][:40]}: toplam {len(found)}')
    return list(found.keys())

def run(limit=None, workers=6):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    urls = crawl_lists()
    print(f'hdfilm katalog: {len(urls)}')
    if limit:
        urls = urls[:limit]
    st = {'new': 0, 'match': 0, 'ep': 0, 'src': 0}
    t0 = time.time()
    lock = threading.Lock()

    def process_content(url):
        html = fetch(url)
        if not html:
            return None
        d = parse_content(html, url)
        if not d['title']:
            return None
        return (url, d)

    def process_episode(job):
        eid, url = job
        html = fetch(url)
        if not html:
            return []
        out = []
        for name, emb in parse_embeds(html):
            if emb:
                g = fetch(emb, referer=url)
                if g:
                    m = parse_gateway(g) or decode_gateway_js(g)
                    if m:
                        out.append((eid, name, m))
        return out

    with ThreadPoolExecutor(max_workers=workers) as ex:
        total_chunks = (len(urls) + 14) // 15
        for ci in range(0, len(urls), 15):
            chunk = urls[ci:ci + 15]
            jobs = []
            for item in filter(None, ex.map(process_content, chunk)):
                url, d = item
                url = url.rstrip('/')
                with lock:
                    ctype = 'dizi' if d['is_series'] else 'film'
                    did = None
                    if d['imdb']:
                        cur.execute("SELECT id FROM dramas WHERE imdb_id=?", (d['imdb'],))
                        r0 = cur.fetchone()
                        if r0:
                            did = r0[0]
                    cur.execute("SELECT id FROM dramas WHERE source_url=?", (url,))
                    r1 = cur.fetchone()
                    if r1:
                        did = r1[0]
                        st['match'] += 1
                    elif not did:
                        did = find_in_index(idx, d['title'], d['year'], url.split(BASE)[-1])
                    if did:
                        st['match'] += 0 if r1 else 1
                    else:
                        base_slug = url.rstrip('/').split('/')[-1] + '-hf'
                        slug = base_slug
                        n = 2
                        cur.execute("SELECT id FROM dramas WHERE slug=?", (slug,))
                        while cur.fetchone():
                            slug = f"{base_slug}-{n}"
                            n += 1
                            cur.execute("SELECT id FROM dramas WHERE slug=?", (slug,))
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, native_title, source_url, imdb_id,
                            cover_image, release_year, overview, categories, tags, alt_sites)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, ctype, d['title'], d['orig'], url, d['imdb'] or None, d['cover'],
                             d['year'], d['overview'], json.dumps(d['genres'], ensure_ascii=False),
                             json.dumps([SITE])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, d['year'], None, None))
                        st['new'] += 1
                    if d['imdb']:
                        cur.execute("UPDATE dramas SET imdb_id=COALESCE(imdb_id, ?) WHERE id=?", (d['imdb'], did))
                    tag_site(cur, did, SITE)
                    mark_done(cur, SITE, url)
                    for ep in d['episodes']:
                        eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                        st['ep'] += 1
                        jobs.append((eid, ep['url']))
            safe_commit(conn)
            for eid, name, m in [x for sub in ex.map(process_episode, jobs) for x in sub]:
                with lock:
                    if add_source(cur, eid, name, m, 'hdfilm-hls', SITE):
                        st['src'] += 1
            safe_commit(conn)
            print(f'hdfilm {min(ci+15, len(urls))}/{len(urls)} | yeni:{st["new"]} eslesen:{st["match"]} bolum:{st["ep"]} kaynak:{st["src"]} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'hdfilm TAMAM: yeni {st["new"]}, eslesen {st["match"]}, kaynak {st["src"]}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    run(limit=a.limit)

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    run(limit=a.limit)
