"""
AsyaWatch Scraper: NEXT_DATA (base64 secureData) icinden meta + bolum + kaynak.
Sitemap -> dizi/film sayfalari -> bolum sayfalari -> getEpisodeSources (direkt iframe).
Kopru yok, hizli cekilebilir.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
import sys
sys.stdout.reconfigure(encoding='utf-8')
import re
import json
import base64
import time
import asyncio
import aiohttp
import xml.etree.ElementTree as ET
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, done_urls, mark_done, _retry, unique_slug

BASE = 'https://asyawatch.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
CC = {'Kore': 'kr', 'Güney Kore': 'kr', 'Çin': 'cn', 'Cin': 'cn', 'Japonya': 'jp', 'Japon': 'jp',
      'Tayland': 'th', 'Tayvan': 'tw', 'ABD': 'us', 'Amerika': 'us', 'Japonya': 'jp'}

def nxdata(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None
    d = json.loads(m.group(1))
    return json.loads(base64.b64decode(d['props']['pageProps']['secureData']).decode('utf-8'))

async def fetch(session, url, sem):
    async with sem:
        await asyncio.sleep(0.4)
        try:
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=30)) as r:
                if r.status == 200:
                    raw = await r.read()
                    return raw.decode('utf-8', errors='replace')
                elif r.status == 429:
                    await asyncio.sleep(5)
        except Exception:
            return None

def parse_series(o):
    res = o['content']['result']['FindedResult']['result']
    rr = o.get('RelatedResults', {})
    title = res.get('original_title') or res.get('used_title') or ''
    native = res.get('culture_title', '')
    year = str(res.get('release_year') or '')
    imdb = res.get('imdb_id') or ''
    country = CC.get(res.get('country_name', ''), '')
    overview = res.get('description') or ''
    cover = res.get('poster_url') or res.get('face_url')
    genres = [g.get('name') for g in (rr.get('getSerieCategoriesById', {}) or {}).get('result', []) or [] if g.get('name')]
    casts = [c.get('name') for c in (rr.get('getSerieCastsById', {}) or {}).get('result', []) or [] if c.get('name')]
    related = []
    for g in (rr.get('getRelatedSeries', {}) or {}).get('result', []) or []:
        if g.get('used_slug'):
            related.append(g['used_slug'])
    seasons = []
    se = ((rr.get('getSerieSeasonAndEpisodes', {}) or {}).get('result')) or []
    for s in se:
        sno = s.get('season_no', 1)
        for e in s.get('episodes', []) or []:
            seasons.append({'season': sno, 'number': e.get('episode_no', 1),
                            'name': e.get('episode_text') or f"{e.get('episode_no')}. Bölüm",
                            'url': BASE + '/' + e['used_slug']})
    return {'title': title, 'native': native, 'year': year, 'imdb': imdb, 'country': country,
            'overview': overview, 'cover': cover, 'genres': genres, 'casts': casts, 'episodes': seasons,
            'related': related}

def parse_episode_sources(o):
    out = []
    srcs = (((o.get('RelatedResults', {}) or {}).get('getEpisodeSources', {}) or {}).get('result')) or []
    for s in srcs:
        name = s.get('source_name') or 'AW'
        for im in re.findall(r'<iframe[^>]+src="([^"]+)"', s.get('source_content') or ''):
            u = im if im.startswith('http') else 'https:' + im
            out.append({'source_name': name, 'direct_url': u, 'provider': identify_provider(u)})
    return out

async def run(limit=None, batch=15, only=None):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur)
    sem = asyncio.Semaphore(2)
    connector = aiohttp.TCPConnector(limit=2, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        # katalog: sitemap
        raw = await fetch(sess, BASE + '/sitemaps/sitemap-index.xml', sem)
        root = ET.fromstring(raw)
        files = [e.text.strip() for e in root.iter() if e.tag.endswith('loc')]
        series_urls = []
        ep_url_count = 0
        for f in files:
            x = await fetch(sess, f, sem)
            if not x:
                continue
            r2 = ET.fromstring(x)
            for e in r2.iter():
                if e.tag.endswith('loc') and e.text:
                    u = e.text.strip()
                    if '/dizi/' in u or '/film/' in u:
                        if '/sezon-' in u or '/bolum-' in u:
                            ep_url_count += 1
                            m = re.match(r'(https?://[^/]+/(?:dizi|film)/[^/]+)', u)
                            if m and m.group(1) not in series_urls:
                                series_urls.append(m.group(1))
                        else:
                            if u not in series_urls:
                                series_urls.append(u)
        print(f'AW katalog: {len(series_urls)} icerik ({ep_url_count} bolum URL tarandi)')
        if only:
            series_urls = [u for u in series_urls if only in u]
        if limit:
            series_urls = series_urls[:limit]
        n_new = n_match = n_ep = n_src = 0
        fails = {'fetch': 0, 'nonx': 0, 'parse': 0, 'notitle': 0}
        t0 = time.time()
        done = set()
        tries = {}
        frontier = list(series_urls)
        # kategori/ulke sayfalarindan tohumlar (sitemap disi kesif)
        for seed in [f'{BASE}/dizi-izle', f'{BASE}/dizi/tur/animasyon', f'{BASE}/dizi/ulke/kore',
                     f'{BASE}/dizi/ulke/cin', f'{BASE}/dizi/ulke/japon', f'{BASE}/filmler']:
            html = await fetch(sess, seed, sem)
            o = nxdata(html) if html else None
            if o:
                for it in o.get('listItems', []) or []:
                    u = BASE + '/' + it['used_slug'] if it.get('used_slug') else None
                    if u and u not in frontier:
                        frontier.append(u)
        print(f'AW baslangic: {len(frontier)} URL (sitemap+tohum)')
        done0 = done_urls(cur, 'asyawatch')
        frontier = [u for u in frontier if u not in done0]
        print(f'AW kalan (islenmemis): {len(frontier)}')
        while frontier:
            if limit and (n_new + n_match) >= limit:
                break
            chunk, frontier = frontier[:batch], frontier[batch:]
            chunk = [u for u in chunk if u not in done]
            if not chunk:
                continue
            res = await asyncio.gather(*[fetch(sess, u, sem) for u in chunk])
            jobs = []
            failed = []
            for url, html in zip(chunk, res):
                done.add(url)
                if not html:
                    fails['fetch'] += 1
                    failed.append(url)
                    continue
                o = nxdata(html)
                if not o:
                    fails['nonx'] += 1
                    failed.append(url)
                    continue
                try:
                    d = parse_series(o)
                except Exception:
                    fails['parse'] += 1
                    failed.append(url)
                    continue
                for rs in d.get('related', []):
                    ru = BASE + '/' + rs
                    if ru not in done and ru not in frontier:
                        frontier.append(ru)
                if not d['title']:
                    fails['notitle'] += 1
                    continue
                ctype = 'film' if '/film/' in url else 'dizi'
                did = None
                if d['imdb']:
                    cur.execute("SELECT id FROM dramas WHERE imdb_id=?", (d['imdb'],))
                    r0 = cur.fetchone()
                    if r0:
                        did = r0[0]
                if not did:
                    did = find_in_index(idx, d['title'], d['year'], url.split(BASE)[-1])
                if did:
                    n_match += 1
                    if d['imdb']:
                        _retry(cur.execute, "UPDATE dramas SET imdb_id=COALESCE(imdb_id, ?) WHERE id=?", (d['imdb'], did))
                else:
                    slug = unique_slug(cur, url.rstrip('/').split('/')[-1] + '-aw')
                    _retry(cur.execute, """INSERT INTO dramas (slug, content_type, title, native_title, source_url, imdb_id,
                        cover_image, country, release_year, overview, categories, tags, alt_sites)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
                        (slug, ctype, d['title'], d['native'], url, d['imdb'] or None, d['cover'],
                         d['country'], d['year'], d['overview'], json.dumps(d['genres'], ensure_ascii=False),
                         json.dumps(['asyawatch'])))
                    did = cur.lastrowid
                    n_new += 1
                tag_site(cur, did, 'asyawatch')
                for ep in d['episodes']:
                    eid, _ = match_or_create_episode(cur, did, ep['season'], ep['number'], ep['name'], ep['url'])
                    n_ep += 1
                    jobs.append((eid, ep['url']))
                mark_done(cur, 'asyawatch', url)
            safe_commit(conn)
            if jobs:
                eids = [j[0] for j in jobs]
                cur.execute(f"SELECT episode_id FROM episode_sources WHERE site LIKE '%asyawatch%' AND episode_id IN ({','.join('?'*len(eids))})", eids)
                havesrc = set(r[0] for r in cur.fetchall())
                jobs = [j for j in jobs if j[0] not in havesrc]
            for bi in range(0, len(jobs), 30):
                bj = jobs[bi:bi + 30]
                res2 = await asyncio.gather(*[fetch(sess, u, sem) for _, u in bj])
                for (eid, url), html in zip(bj, res2):
                    if not html:
                        continue
                    o = nxdata(html)
                    if not o:
                        continue
                    for s in parse_episode_sources(o):
                        if add_source(cur, eid, s['source_name'], s['direct_url'], s['provider'], 'asyawatch'):
                            n_src += 1
                safe_commit(conn)
                if len(jobs) > 30:
                    print(f"  AW bolum parcasi: {min(bi+30, len(jobs))}/{len(jobs)} (kaynak:{n_src})")
            for u in failed:
                tries[u] = tries.get(u, 0) + 1
                done.discard(u)
                if tries[u] < 3 and u not in frontier:
                    frontier.append(u)
            total = n_new + n_match
            print(f"AW islenen:{total} kuyruk:{len(frontier)} | yeni:{n_new} eslesen:{n_match} bolum:{n_ep} kaynak:{n_src} fail:{fails} ({time.time()-t0:.0f}sn)")
    conn.close()
    print(f"AW TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}")

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    asyncio.run(run(limit=a.limit, only=a.only))
