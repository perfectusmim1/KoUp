"""
DiziYou Scraper: /dizi-arsivi/ (119 sayfa) -> /{slug}/ -> /{slug}-S-sezon-B-bolum/ -> player m3u8.
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
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done, load_done_urls
from scraper_wp_sites import fetch

BASE = 'https://www.diziyou.one'
SITE = 'diziyou'

def parse_drama(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else url.rstrip('/').split('/')[-1]
    slug = url.rstrip('/').split('/')[-1]
    cover = None
    for img in soup.find_all('img'):
        src = img.get('src') or ''
        if 'posters' in src:
            cover = src if src.startswith('http') else BASE + src
            break
    overview = ''
    m = soup.find('meta', attrs={'name': 'description'})
    if m:
        overview = m.get('content', '')
    genres = []
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '/tur/' in h or '/kategori/' in h:
            t = a.get_text(strip=True)
            if t and len(t) < 30 and t not in genres:
                genres.append(t)
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href'] or ''
        if '-sezon-' not in h or '-bolum' not in h or h in seen:
            continue
        seen.add(h)
        full = h if h.startswith('http') else BASE + h
        ms = re.search(r'-(\d+)-sezon-', h)
        me = re.search(r'-(\d+)-bolum', h)
        txt = a.get_text(strip=True)[:80]
        name = txt or f"{me.group(1) if me else 1}. Bölüm"
        episodes.append({'season': int(ms.group(1)) if ms else 1,
                         'number': int(me.group(1)) if me else 1,
                         'name': name, 'url': full})
    return {'slug': slug, 'title': title, 'cover': cover, 'overview': overview,
            'genres': genres[:12], 'episodes': episodes, 'url': url}

def parse_video(html):
    soup = BeautifulSoup(html, 'html.parser')
    for fr in soup.find_all('iframe'):
        u = fr.get('src') or ''
        if '/player/' in u:
            return u if u.startswith('http') else BASE + u
    return None

def parse_player(html):
    m = re.findall(r'https?://storage\.diziyou\.one/episodes/\d+/play\.m3u8', html)
    if m:
        return m[0]
    m = re.findall(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', html)
    m = [x for x in m if 'video.min' not in x and '.css' not in x]
    return m[0] if m else None

async def crawl_catalog(sess, sem):
    found = {}
    async def page(p):
        u = f'{BASE}/dizi-arsivi/' if p == 1 else f'{BASE}/dizi-arsivi/page/{p}/'
        html = await fetch(sess, u, sem)
        if not html:
            return []
        soup = BeautifulSoup(html, 'html.parser')
        out = []
        for img in soup.find_all('img'):
            a = img.find_parent('a', href=True)
            if a and re.match(r'https://www\.diziyou\.one/[a-z0-9-]+/?$', a['href'] or ''):
                out.append(a['href'])
        return out
    empty = 0
    for p in range(1, 200):
        chunk = []
        for attempt in range(4):
            chunk = await page(p)
            if chunk:
                break
        for x in chunk:
            found[x] = True
        print(f'diziyou katalog sayfa {p}: +{len(chunk)} (toplam {len(found)})')
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
    sem = asyncio.Semaphore(8)
    connector = aiohttp.TCPConnector(limit=8, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = await crawl_catalog(sess, sem)
        print(f'diziyou katalog: {len(urls)}')
        done0 = load_done_urls(cur, SITE)
        urls = [u for u in urls if u not in done0]
        print(f'diziyou kalan (islenmemis): {len(urls)}')
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
                    did = find_in_index(idx, d['title'], None, d['slug'])
                    if did:
                        n_match += 1
                    else:
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            overview, categories, tags, alt_sites)
                            VALUES (?, 'dizi', ?, ?, ?, ?, ?, '[]', ?)""",
                            (d['slug'] + '-you', d['title'], url, d['cover'],
                             d['overview'], json.dumps(d['genres'], ensure_ascii=False), json.dumps([SITE])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, '', None, None))
                        n_new += 1
                tag_site(cur, did, SITE)
                mark_done(cur, SITE, url)
                for ep in d['episodes']:
                    eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    n_ep += 1
                    jobs.append((eid, ep['url']))
            safe_commit(conn)
            res2 = await asyncio.gather(*[fetch(sess, u, sem) for _, u in jobs])
            pj = []
            for (eid, url), html in zip(jobs, res2):
                if not html:
                    continue
                pj.append((eid, parse_video(html)))
            res3 = await asyncio.gather(*[fetch(sess, u, sem) if u else None for _, u in pj])
            for (eid, _), html in zip(pj, res3):
                if not html:
                    continue
                m = parse_player(html)
                if m and add_source(cur, eid, 'DiziYou', m, 'diziyou-hls', SITE):
                    n_src += 1
            safe_commit(conn)
            print(f'diziyou {min(i+15, len(urls))}/{len(urls)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'diziyou TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit))
