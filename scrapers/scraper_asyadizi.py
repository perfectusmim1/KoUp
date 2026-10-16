"""
AsyaDizi Scraper: /dizi-arsivi/ (412 sayfa) -> drama -> bolumler -> vdo-src direkt.
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
from bs4 import BeautifulSoup
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done, load_done_urls, unique_slug, done_urls, _retry
from scraper_wp_sites import fetch, slug_meta, HEADERS

BASE = 'https://asyadizi.com'
SITE = 'asyadizi'

def parse_drama(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    slug = url.rstrip('/').split('/dizi/')[-1].strip('/')
    title, year, country = slug_meta(slug)
    og = {}
    for m in soup.find_all('meta'):
        if (m.get('property') or '').startswith('og:'):
            og[m['property']] = m.get('content')
    cover = og.get('og:image')
    overview = og.get('og:description', '')
    genres, actors = [], []
    for a in soup.select('a[href*="/tur/"], a[href*="/turler/"], a[rel="tag"]'):
        t = a.get_text(strip=True)
        if t and len(t) < 30 and t not in genres:
            genres.append(t)
    for el in soup.find_all(string=re.compile(r'Oyuncular')):
        box = el.parent.parent if el.parent else None
        if box:
            for a in box.find_all('a', href=True):
                if '/oyuncu' in a['href'] or '/actor' in a['href']:
                    actors.append(a.get_text(strip=True))
            if actors:
                break
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '-bolum' not in h or h in seen:
            continue
        seen.add(h)
        full = h if h.startswith('http') else BASE + h
        m = re.search(r'-(\d+)-bolum', h)
        num = int(m.group(1)) if m else 1
        ms = re.search(r'(\d+)\.\s*Sezon', a.get_text())
        txt = a.get_text(strip=True)[:60] or f'{num}. Bölüm'
        episodes.append({'season': 1, 'number': num, 'name': txt, 'url': full})
    return {'slug': slug, 'title': title, 'year': year, 'country': country,
            'cover': cover, 'overview': overview, 'genres': genres[:12],
            'actors': actors[:20], 'episodes': episodes, 'url': url}

def parse_video(html):
    soup = BeautifulSoup(html, 'html.parser')
    vdo = soup.find(attrs={'vdo-src': True})
    if vdo and vdo.get('vdo-src'):
        u = vdo['vdo-src']
        return 'OKRU', 'https:' + u if u.startswith('//') else u
    for fr in soup.find_all('iframe'):
        u = fr.get('src') or ''
        if u and 'videoembed' in u and 'youtube' not in u and 'vimeo' not in u:
            return 'Video', 'https:' + u if u.startswith('//') else u
    return None, None

async def crawl_catalog(sess, sem, max_pages=500):
    found = {}
    async def page(base, p):
        u = f'{BASE}/{base}/' if p == 1 else f'{BASE}/{base}/page/{p}/'
        html = await fetch(sess, u, sem)
        if not html:
            return []
        soup = BeautifulSoup(html, 'html.parser')
        out = []
        for a in soup.find_all('a', href=True):
            h = a['href'] or ''
            if re.match(r'(https://asyadizi\.com)?/dizi/[a-z0-9-]+/?$', h):
                full = h if h.startswith('http') else BASE + h
                out.append(full)
        return out
    for base in ['dizi-arsivi', 'film-arsivi']:
        empty = 0
        for p in range(1, max_pages + 1):
            chunk = await page(base, p)
            for x in chunk:
                found[x] = True
            print(f'asyadizi {base} sayfa {p}: +{len(chunk)} (toplam {len(found)})')
            if not chunk:
                empty += 1
                if empty >= 2:
                    break
            else:
                empty = 0
    return list(found.keys())

async def run(limit=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(24)
    connector = aiohttp.TCPConnector(limit=24, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = await crawl_catalog(sess, sem, max_pages=3 if limit else 500)
        print(f'asyadizi katalog: {len(urls)} dizi')
        done0 = load_done_urls(cur, SITE)
        urls = [u for u in urls if u not in done0]
        print(f'asyadizi kalan (islenmemis): {len(urls)}')
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
                        slug = unique_slug(cur, d['slug'] + '-ad')
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            country, release_year, overview, categories, tags, alt_sites)
                            VALUES (?, 'dizi', ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, d['title'], url, d['cover'], d['country'],
                             d['year'], d['overview'], json.dumps(d['genres'], ensure_ascii=False),
                             json.dumps([SITE])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, d['year'], None, None))
                        n_new += 1
                tag_site(cur, did, SITE)
                mark_done(cur, SITE, url)
                eps = d['episodes']
                if not eps and '/film' in url:
                    # film: sayfanin kendisi tek bolum
                    eps = [{'season': 1, 'number': 1, 'name': 'Film', 'url': url}]
                    _retry(cur.execute, "UPDATE dramas SET content_type='film' WHERE id=? AND content_type='dizi'", (did,))
                for ep in eps:
                    eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    n_ep += 1
                    jobs.append((eid, ep['url']))
            safe_commit(conn)
            if jobs:
                eids = list(set(j[0] for j in jobs))
                cur.execute(f"SELECT episode_id FROM episode_sources WHERE site LIKE '%asyadizi%' AND episode_id IN ({','.join('?'*len(eids))})", eids)
                havesrc = set(r[0] for r in cur.fetchall())
                jobs = [j for j in jobs if j[0] not in havesrc]
            res2 = await asyncio.gather(*[fetch(sess, u, sem) for _, u in jobs])
            for (eid, url), html in zip(jobs, res2):
                if not html:
                    continue
                name, direct = parse_video(html)
                if direct:
                    if add_source(cur, eid, name or 'Video', direct, identify_provider(direct), SITE):
                        n_src += 1
            safe_commit(conn)
            print(f'asyadizi {min(i+15, len(urls))}/{len(urls)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'asyadizi TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit))
