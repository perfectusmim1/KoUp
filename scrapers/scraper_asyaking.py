"""
AsyaKing Scraper: /dizi-arsivi/ -> /diziler/{slug}-izle/ -> /{slug}-N-bolum-izle/[/2/..] -> ok.ru direkt.
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
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done, load_done_urls, unique_slug, done_urls
from scraper_wp_sites import fetch

BASE = 'https://www.asyaking.net'
SITE = 'asyaking'

def parse_drama(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = re.sub(r'\s*Türkçe Altyazılı izle.*$', '', h1.get_text(strip=True)) if h1 else ''
    slug = url.rstrip('/').split('/diziler/')[-1].strip('/')
    base = re.sub(r'-izle$', '', slug)
    m = re.search(r'-(\d{4})$', base)
    year = m.group(1) if m else ''
    title = title or base.replace('-', ' ').title()
    cover = None
    og = soup.find('meta', attrs={'property': 'og:image'})
    if og and og.get('content'):
        cover = og['content']
    overview = ''
    mt = soup.find('meta', attrs={'name': 'description'})
    if mt:
        overview = mt.get('content', '')
    genres = []
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '/tur/' in h or '/turler/' in h:
            t = a.get_text(strip=True)
            if t and len(t) < 30 and t not in genres:
                genres.append(t)
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '-bolum-izle' not in h or h in seen:
            continue
        seen.add(h)
        full = h if h.startswith('http') else BASE + h
        me = re.search(r'-(\d+)-bolum-izle', h)
        num = int(me.group(1)) if me else 1
        episodes.append({'season': 1, 'number': num,
                         'name': a.get_text(strip=True)[:60] or f'{num}. Bölüm', 'url': full})
    return {'slug': base, 'title': title, 'year': year, 'cover': cover,
            'overview': overview, 'genres': genres[:12], 'episodes': episodes, 'url': url}

def parse_sources(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for fr in soup.find_all('iframe'):
        u = fr.get('data-src') or fr.get('src') or ''
        if 'videoembed' in u or 'embed' in u or 'player' in u or 'vid' in u:
            if 'facebook' in u or 'googletag' in u:
                continue
            out.append(('Kaynak', 'https:' + u if u.startswith('//') else u))
    alts = []
    box = soup.find('div', class_='sources')
    if box:
        for a in box.find_all('a', href=True):
            alts.append((a.get_text(strip=True) or 'Kaynak', a['href']))
    return out, alts

async def crawl_catalog(sess, sem):
    found = {}
    for p in range(1, 196):
        u = f'{BASE}/dizi-arsivi/' if p == 1 else f'{BASE}/dizi-arsivi/page/{p}/'
        html = None
        for _ in range(4):
            html = await fetch(sess, u, sem)
            if html:
                break
        if not html:
            print(f'asyaking katalog sayfa {p}: ERISIM YOK (atlandi)')
            continue
        soup = BeautifulSoup(html, 'html.parser')
        n = 0
        for a in soup.find_all('a', href=True):
            h = a['href'] or ''
            if re.match(r'(https://www\.asyaking\.net)?/diziler/[a-z0-9-]+/?$', h):
                full = h if h.startswith('http') else BASE + h
                if full not in found:
                    found[full] = True
                    n += 1
        print(f'asyaking katalog sayfa {p}: +{n} (toplam {len(found)})')
    return list(found.keys())

async def run(limit=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(8)
    connector = aiohttp.TCPConnector(limit=8, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = await crawl_catalog(sess, sem)
        print(f'asyaking katalog: {len(urls)}')
        done0 = load_done_urls(cur, SITE)
        urls = [u for u in urls if u not in done0]
        print(f'asyaking kalan: {len(urls)}')
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
                        slug = unique_slug(cur, d['slug'] + '-ak')
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            release_year, overview, categories, tags, alt_sites)
                            VALUES (?, 'dizi', ?, ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, d['title'], url, d['cover'], d['year'],
                             d['overview'], json.dumps(d['genres'], ensure_ascii=False), json.dumps([SITE])))
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
            altjobs = []
            for (eid, url), html in zip(jobs, res2):
                if not html:
                    continue
                srcs, alts = parse_sources(html)
                for name, direct in srcs:
                    if add_source(cur, eid, name, direct, identify_provider(direct), SITE):
                        n_src += 1
                for aname, ahref in alts:
                    full = ahref if ahref.startswith('http') else BASE + ahref
                    altjobs.append((eid, aname, full))
            res3 = await asyncio.gather(*[fetch(sess, u, sem) for _, _, u in altjobs])
            for (eid, aname, _), html in zip(altjobs, res3):
                if not html:
                    continue
                srcs, _ = parse_sources(html)
                for _, direct in srcs:
                    if add_source(cur, eid, aname, direct, identify_provider(direct), SITE):
                        n_src += 1
            safe_commit(conn)
            print(f'asyaking {min(i+15, len(urls))}/{len(urls)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'asyaking TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit))
