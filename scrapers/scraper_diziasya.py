"""
DiziAsya Scraper: sitemap -> icerik -> bolumler -> sources JSON (9 kaynak/bolum, direkt URL).
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
import asyncio
import aiohttp
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done, done_urls
from scraper_wp_sites import fetch, HEADERS

BASE = 'https://diziasya.com'
SITE = 'diziasya'
CC = {'Kore': 'kr', 'Çin': 'cn', 'Cin': 'cn', 'Japon': 'jp', 'Japonya': 'jp', 'Tayland': 'th', 'Tayvan': 'tw', 'ABD': 'us'}

def unescape_sources_blob(t):
    out = []
    for key in ('"sources":', '\\"sources\\":'):
        start = 0
        while True:
            i = t.find(key, start)
            if i < 0:
                break
            j = i + len(key)
            while j < len(t) and t[j] in ' \t':
                j += 1
            if j >= len(t) or t[j] != '[':
                start = j
                continue
            try:
                arr, _ = json.JSONDecoder().raw_decode(t[j:].replace('\\"', '"'))
                if isinstance(arr, list):
                    out.extend(arr)
            except Exception:
                pass
            start = j + 1
            if out:
                break
        if out:
            break
    return [x for x in out if isinstance(x, dict)]

def parse_drama(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    title = (soup.find('h1').get_text(strip=True) if soup.find('h1') else '').replace(' izle', '').strip()
    slug = url.rstrip('/').split('/')[-1]
    if not title:
        title = slug.replace('-', ' ').title()
    year = ''
    my = re.search(r'(19|20)\d\d', title)
    if my:
        year = my.group(0)
    country = ''
    for c in ['Kore', 'Çin', 'Cin', 'Japon', 'Tayland', 'Tayvan']:
        if c in title:
            country = CC.get(c, '')
            break
    og = {}
    for mt in soup.find_all('meta'):
        if (mt.get('property') or '').startswith('og:'):
            og[mt['property']] = mt.get('content')
    cover = og.get('og:image')
    overview = og.get('og:description', '')
    genres = []
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '/tur/' in h or '/genre' in h:
            t = a.get_text(strip=True)
            if t and len(t) < 30 and t not in genres:
                genres.append(t)
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if ('/sezon-' not in h and '/bolum-' not in h) or h in seen:
            continue
        seen.add(h)
        full = h if h.startswith('http') else BASE + h
        ms = re.search(r'sezon-(\d+)', h)
        me = re.search(r'bolum-(\d+)', h)
        episodes.append({'season': int(ms.group(1)) if ms else 1,
                         'number': int(me.group(1)) if me else 1,
                         'name': a.get_text(strip=True)[:60] or f"{me.group(1) if me else 1}. Bölüm",
                         'url': full})
    return {'slug': slug, 'title': title, 'year': year, 'country': country,
            'cover': cover, 'overview': overview, 'genres': genres[:12], 'episodes': episodes, 'url': url}

async def sitemap_lists(sess, sem):
    raw = await fetch(sess, BASE + '/sitemap.xml', sem)
    root = ET.fromstring(raw)
    files = [e.text.strip() for e in root.iter() if e.tag.endswith('loc')]
    contents, episodes = [], []
    for f in files:
        if 'sitemap-contents' in f:
            # /sitemap-contents/1.xml -> kac tane? sirayla dene
            base = f.rsplit('/', 1)[0]
            i = 1
            while True:
                x = await fetch(sess, f'{base}/{i}.xml', sem)
                if not x:
                    break
                try:
                    r2 = ET.fromstring(x)
                except Exception:
                    break
                urls = [e.text.strip() for e in r2.iter() if e.tag.endswith('loc')]
                if not urls:
                    break
                contents.extend(urls)
                print(f'diziasya icerik {i}: +{len(urls)} (toplam {len(contents)})')
                i += 1
                if i > 60:
                    break
        elif 'sitemap-episodes' in f:
            x = await fetch(sess, f, sem)
            if x:
                try:
                    r2 = ET.fromstring(x)
                    urls = [e.text.strip() for e in r2.iter() if e.tag.endswith('loc')]
                    episodes.extend(urls)
                except Exception:
                    pass
    # bolum sayfalari da icerik kesfi icin kullanilabilir
    print(f'diziasya sitemap: {len(contents)} icerik, {len(episodes)} bolum URL')
    # film/anime/program listeleri (?page=N sayfali)
    for kind in ['filmler', 'animeler', 'programlar']:
        p = 1
        while p < 60:
            u = f'{BASE}/{kind}' if p == 1 else f'{BASE}/{kind}?page={p}'
            html = await fetch(sess, u, sem)
            if not html:
                break
            soup = BeautifulSoup(html, 'html.parser')
            found = 0
            for a in soup.find_all('a', href=True):
                h = a['href'] or ''
                if re.match(r'/(film|anime|program)/[a-z0-9-]+/?$', h):
                    full = BASE + h
                    if full not in contents:
                        contents.append(full)
                        found += 1
            print(f'diziasya {kind} sayfa {p}: +{found} (toplam {len(contents)})')
            if found == 0:
                break
            p += 1
    return contents

async def run(limit=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(8)
    connector = aiohttp.TCPConnector(limit=8, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = await sitemap_lists(sess, sem)
        if limit:
            urls = urls[:limit]
        print(f'diziasya hedef: {len(urls)} icerik')
        done0 = done_urls(cur, SITE)
        urls = [u for u in urls if u not in done0]
        print(f'diziasya kalan (islenmemis): {len(urls)}')
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
                ctype = 'film' if '/film/' in url else ('anime' if '/anime/' in url else ('program' if '/program/' in url else 'dizi'))
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
                        slug = d['slug'] + '-da'
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            country, release_year, overview, categories, tags, alt_sites)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, ctype, d['title'], url, d['cover'], d['country'],
                             d['year'], d['overview'], json.dumps(d['genres'], ensure_ascii=False),
                             json.dumps([SITE])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, d['year'], None, None))
                        n_new += 1
                tag_site(cur, did, SITE)
                mark_done(cur, SITE, url)
                for ep in d['episodes']:
                    eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    n_ep += 1
                    jobs.append((eid, ep['url']))
            safe_commit(conn)
            res2 = await asyncio.gather(*[fetch(sess, u, sem) for _, u in jobs])
            for (eid, url), html in zip(jobs, res2):
                if not html:
                    continue
                for s in unescape_sources_blob(html):
                    u = s.get('url') or ''
                    if not u:
                        continue
                    u = 'https:' + u if u.startswith('//') else u
                    if add_source(cur, eid, s.get('name') or 'DA', u, identify_provider(u), SITE):
                        n_src += 1
            safe_commit(conn)
            print(f'diziasya {min(i+15, len(urls))}/{len(urls)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'diziasya TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit))
