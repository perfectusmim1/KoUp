"""
Dizifon + AsyaLuna scraper (ortak WP motoru).
Video: static direkt URL (DF: vdo-src, AL: iframe src). Kopru yok.
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
from multisite import norm_title, slug_core, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, mark_done

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
CC = {'kore': 'kr', 'cin': 'cn', 'japon': 'jp', 'tayland': 'th', 'tayvan': 'tw', 'korean': 'kr'}

def slug_meta(slug):
    m = re.search(r'-(\d{4})-(kore|cin|japon|tayland|tayvan)$', slug)
    if m:
        title = re.sub(r'-\d{4}-(kore|cin|japon|tayland|tayvan)$', '', slug).replace('-', ' ').title()
        return title, m.group(1), CC.get(m.group(2), '')
    return slug.replace('-', ' ').title(), '', ''

async def fetch(session, url, sem):
    async with sem:
        try:
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)) as r:
                if r.status == 200:
                    raw = await r.read()
                    return raw.decode('utf-8', errors='replace')
        except Exception:
            return None

SITES = {
    'dizifon': {
        'base': 'https://www.dizifon.cc',
        'catalog': ['https://www.dizifon.cc/tum-diziler/'],
        'cat_page': 'https://www.dizifon.cc/tum-diziler/page/{}/',
        'drama_pat': r'https://www\.dizifon\.cc/dizi/[a-z0-9-]+/?$',
        'ep_pat': r'/bolum/([a-z0-9-]+?)(?:-(\d+)-bolum/?)?$',
    },
    'asyaluna': {
        'base': 'https://asyaluna.com',
        'catalog': ['https://asyaluna.com/diziler/kore-dizileri/', 'https://asyaluna.com/diziler/cin-dizileri/',
                    'https://asyaluna.com/diziler/japon-dizileri/', 'https://asyaluna.com/diziler/tayland-dizileri/'],
        'cat_page_tpl': '{base}/diziler/{k}-dizileri/page/{p}/',
        'cat_page': None,
        'drama_pat': r'(https://asyaluna\.com)?/dizi/[a-z0-9-]+/?$',
        'ep_pat': r'/bolum/([a-z0-9-]+?)(?:-(\d+)(?:-\d+)?-bolum(?:-final)?/?)?$',
    },
}

def parse_drama_page(site, html, url):
    cfg = SITES[site]
    soup = BeautifulSoup(html, 'html.parser')
    slug = url.rstrip('/').split('/')[-2] if url.rstrip('/').endswith('/') is False else url.rstrip('/').split('/')[-1]
    slug = url.rstrip('/').split('/dizi/')[-1].strip('/')
    title, year, country = slug_meta(slug)
    og = {}
    for m in soup.find_all('meta'):
        if (m.get('property') or '').startswith('og:'):
            og[m['property']] = m.get('content')
    cover = og.get('og:image')
    overview = og.get('og:description', '')
    genres, actors = [], []
    for pat, dest in [('Tür', genres), ('Oyuncular', actors)]:
        for el in soup.find_all(string=re.compile(pat)):
            p = el.parent.get_text(strip=True) if el.parent else ''
            p = re.sub(rf'^{pat}\s*:?\s*', '', p)
            if len(p) < 200 and p:
                dest.extend([x.strip() for x in re.split(r'[,/]', p) if x.strip()])
            break
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/bolum/' not in h or h in seen:
            continue
        seen.add(h)
        full = h if h.startswith('http') else cfg['base'] + h
        m = re.search(r'-(\d+)(?:-\d+)?-bolum', h)
        num = int(m.group(1)) if m else 1
        txt = a.get_text(strip=True)[:60] or f'{num}. Bölüm'
        episodes.append({'season': 1, 'number': num, 'name': txt, 'url': full})
    return {'slug': slug, 'title': title, 'year': year, 'country': country,
            'cover': cover, 'overview': overview, 'genres': genres[:12],
            'actors': actors[:20], 'episodes': episodes, 'url': url}

def parse_episode_video(html):
    soup = BeautifulSoup(html, 'html.parser')
    vdo = soup.find(attrs={'vdo-src': True})
    if vdo and vdo.get('vdo-src'):
        u = vdo['vdo-src']
        return ('OKRU', 'https:' + u if u.startswith('//') else u)
    fr = soup.find('iframe', src=lambda s: s and ('videoembed' in s or 'embed' in s or 'player' in s or 'vid' in s))
    if fr and fr.get('src'):
        u = fr['src']
        u = 'https:' + u if u.startswith('//') else u
        return ('Video', u)
    for fr in soup.find_all('iframe'):
        u = fr.get('src') or ''
        if u and 'youtube' not in u and 'vimeo' not in u and 'googletag' not in u:
            return ('Video', 'https:' + u if u.startswith('//') else u)
    return (None, None)

async def crawl_catalog(sess, sem, site):
    cfg = SITES[site]
    found = {}
    async def page(u):
        html = await fetch(sess, u, sem)
        if not html:
            return []
        soup = BeautifulSoup(html, 'html.parser')
        out = []
        for a in soup.find_all('a', href=True):
            h = a['href']
            if re.match(cfg['drama_pat'], h):
                full = h if h.startswith('http') else cfg['base'] + h
                out.append(full)
        return out
    if cfg.get('cat_page_tpl'):
        for u in cfg['catalog']:
            m = re.search(r'/diziler/([a-z]+)-dizileri/', u)
            k = m.group(1) if m else ''
            empty_streak = 0
            for p in range(1, 200):
                pu = u if p == 1 else cfg['cat_page_tpl'].format(base=cfg['base'], k=k, p=p)
                chunk = await page(pu)
                for x in chunk:
                    found[x] = True
                print(f'{site} katalog {k} sayfa {p}: +{len(chunk)} (toplam {len(found)})')
                if not chunk:
                    empty_streak += 1
                    if empty_streak >= 2:
                        break
                else:
                    empty_streak = 0
    elif cfg['cat_page']:
        empty_streak = 0
        for p in range(1, 300):
            pu = cfg['catalog'][0] if p == 1 else cfg['cat_page'].format(p)
            chunk = await page(pu)
            for x in chunk:
                found[x] = True
            print(f'{site} katalog sayfa {p}: +{len(chunk)} (toplam {len(found)})')
            if not chunk:
                empty_streak += 1
                if empty_streak >= 2:
                    break
            else:
                empty_streak = 0
    else:
        for u in cfg['catalog']:
            for x in await page(u):
                found[x] = True
    return list(found.keys())

async def run(site, limit=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(14)
    connector = aiohttp.TCPConnector(limit=14, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        urls = await crawl_catalog(sess, sem, site)
        print(f'{site} katalog: {len(urls)} dizi')
        if limit:
            urls = urls[:limit]
        new_d = match_d = new_e = new_s = 0
        t0 = time.time()
        for i in range(0, len(urls), 15):
            chunk = urls[i:i + 15]
            res = await asyncio.gather(*[fetch(sess, u, sem) for u in chunk])
            jobs = []
            for url, html in zip(chunk, res):
                if not html:
                    continue
                d = parse_drama_page(site, html, url)
                cur.execute("SELECT id FROM dramas WHERE source_url=?", (url,))
                r0 = cur.fetchone()
                if r0:
                    did = r0[0]
                    match_d += 1
                    tag_site(cur, did, site)
                    mark_done(cur, site, url)
                    for ep in d['episodes']:
                        eid, is_new = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                        new_e += is_new
                        jobs.append((eid, ep['url']))
                    continue
                did = find_in_index(idx, d['title'], d['year'], d['slug'])
                if did:
                    match_d += 1
                else:
                    slug = f"{d['slug']}-{site[:2]}"
                    cur.execute("SELECT id FROM dramas WHERE slug=? OR source_url=?", (slug, url))
                    r = cur.fetchone()
                    if r:
                        did = r[0]
                        match_d += 1
                    else:
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
                            country, release_year, overview, categories, tags, alt_sites)
                            VALUES (?, 'dizi', ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
                            (slug, d['title'], url, d['cover'], d['country'],
                             d['year'], d['overview'], json.dumps(d['genres'], ensure_ascii=False),
                             json.dumps([site])))
                        did = cur.lastrowid
                        idx['title'].setdefault(norm_title(d['title']), []).append((did, d['year'], None, None))
                        new_d += 1
                tag_site(cur, did, site)
                mark_done(cur, site, url)
                for ep in d['episodes']:
                    eid, is_new = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    new_e += is_new
                    jobs.append((eid, ep['url']))
            safe_commit(conn)
            if jobs:
                eids = list(set(j[0] for j in jobs))
                cur.execute(f"SELECT episode_id FROM episode_sources WHERE site LIKE '%{site}%' AND episode_id IN ({','.join('?'*len(eids))})", eids)
                havesrc = set(r[0] for r in cur.fetchall())
                jobs = [j for j in jobs if j[0] not in havesrc]
            res2 = await asyncio.gather(*[fetch(sess, u, sem) for _, u in jobs])
            for (eid, url), html in zip(jobs, res2):
                if not html:
                    continue
                name, direct = parse_episode_video(html)
                if direct:
                    if add_source(cur, eid, name or 'Video', direct, identify_provider(direct), site):
                        new_s += 1
            safe_commit(conn)
            print(f'{site} {min(i+15, len(urls))}/{len(urls)} | drama yeni:{new_d} eslesen:{match_d} bolum-yeni:{new_e} kaynak:{new_s} ({time.time()-t0:.0f}sn)')
    conn.close()
    print(f'{site} TAMAM: drama yeni {new_d}, eslesen {match_d}, kaynak {new_s}')

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('site', choices=['dizifon', 'asyaluna'])
    ap.add_argument('--limit', type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(a.site, a.limit))
