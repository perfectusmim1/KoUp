"""
DiziKorea Scraper (katalog + drama + bolum + kaynak)
Dogrudan provider URL'leri sayfada gomulu oldugu icin resolve gerekmez.
DB'deki mevcut kayitlarla birlesir (site='dizikorea').
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
import unicodedata
from bs4 import BeautifulSoup
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import safe_commit, done_urls, mark_done, _retry

BASE = 'https://dizikorea3.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

COUNTRY_MAP = {'Güney Kore': 'kr', 'Kore': 'kr', 'Çin': 'cn', 'Cin': 'cn',
               'Japonya': 'jp', 'Japon': 'jp', 'Tayland': 'th', 'Tayvan': 'tw'}

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', s.lower())

def clean_dk_title(txt):
    t = txt or ''
    t = re.sub(r'^(Devam Ediyor|Final|Yakında)', '', t)
    t = re.sub(r'★[\d.]+', '', t)
    t = re.sub(r'(19|20)\d\d.*$', '', t)
    t = re.sub(r'^\d+\s*', '', t).strip()
    return t

async def fetch(session, url, sem):
    async with sem:
        try:
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)) as r:
                if r.status == 200:
                    raw = await r.read()
                    return raw.decode('utf-8', errors='replace')
        except Exception:
            return None

def parse_drama(html, url, slug):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else slug
    badges = [b.get_text(strip=True) for b in soup.select('.meta-badge')]
    year, country, status, ep_info = '', '', '', ''
    for b in badges:
        if re.fullmatch(r'19\d\d|20\d\d', b):
            year = b
        elif b in COUNTRY_MAP:
            country = COUNTRY_MAP[b]
        elif 'Sezon' in b or 'Bölüm' in b:
            ep_info = b
        elif b in ('Devam Ediyor', 'Final'):
            status = b
    genres = [a.get_text(strip=True) for a in soup.select('.meta-badge a[href*="/tur/"]')]
    cover = None
    for img in soup.find_all('img'):
        src = img.get('src') or ''
        if '/uploads/series/' in src:
            cover = src if src.startswith('http') else BASE + src
            break
    overview = ''
    for scr in soup.find_all('script', type='application/ld+json'):
        try:
            ld = json.loads(scr.string or '{}')
            if isinstance(ld, dict) and ld.get('description'):
                overview = ld['description']
                break
        except Exception:
            pass
    episodes = []
    seen = set()
    for a in soup.find_all('a', href=True):
        h = a['href']
        if '/sezon-' not in h or '/bolum-' not in h:
            continue
        full = h if h.startswith('http') else BASE + h
        if full in seen:
            continue
        seen.add(full)
        ms = re.search(r'sezon-(\d+)', h)
        me = re.search(r'bolum-(\d+)', h)
        episodes.append({
            'season': int(ms.group(1)) if ms else 1,
            'number': int(me.group(1)) if me else 1,
            'name': f"{me.group(1)}. Bölüm" if me else a.get_text(strip=True)[:60],
            'url': full,
        })
    return {'slug': slug, 'title': title, 'year': year, 'country': country,
            'status': status, 'ep_info': ep_info, 'genres': genres,
            'cover': cover, 'overview': overview, 'episodes': episodes, 'url': url}

def parse_episode_sources(html):
    soup = BeautifulSoup(html, 'html.parser')
    tabs = [b.get_text(strip=True) for b in soup.select('button.player-tab')]
    divs = soup.select('div.player-source')
    out = []
    for i, div in enumerate(divs):
        fr = div.find('iframe')
        url = (fr.get('data-src') or fr.get('src')) if fr else None
        if not url:
            continue
        url = url if url.startswith('http') else 'https:' + url
        name = tabs[i] if i < len(tabs) else f'Kaynak {i+1}'
        out.append({'source_name': name, 'direct_url': url,
                    'provider': identify_provider(url)})
    return out

def merge_drama(conn, d):
    cur = conn.cursor()
    cur.execute("SELECT id, title, alt_sites FROM dramas WHERE content_type IN ('dizi','film','program')")
    best = None
    nk = norm(d['title'])
    for row in cur.fetchall():
        if norm(row['title']) == nk and len(nk) >= 4:
            best = row
            break
    if best:
        drama_id = best['id']
        try:
            sites = json.loads(best['alt_sites'] or '[]')
        except Exception:
            sites = []
        if 'dizikorea' not in sites:
            sites.append('dizikorea')
            cur.execute("UPDATE dramas SET alt_sites=? WHERE id=?", (json.dumps(sites), drama_id))
        return drama_id, False
    slug = d['slug']
    cur.execute("SELECT id FROM dramas WHERE slug=?", (slug,))
    if cur.fetchone():
        slug = slug + '-dk'
    cur.execute("""INSERT INTO dramas (slug, content_type, title, source_url, cover_image,
        country, country_name, release_year, episode_count, status_broadcast, overview, categories, tags, alt_sites)
        VALUES (?, 'dizi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)""",
        (slug, d['title'], d['url'], d['cover'], d['country'],
         {v: k for k, v in COUNTRY_MAP.items()}.get(d['country'], ''),
         d['year'], d['ep_info'], d['status'], d['overview'],
         json.dumps(d['genres'], ensure_ascii=False), json.dumps(['dizikorea'])))
    return cur.lastrowid, True

def merge_episode(conn, drama_id, ep):
    cur = conn.cursor()
    cur.execute("SELECT id, episode_url FROM episodes WHERE drama_id=? AND season_number=? AND episode_number=?",
                (drama_id, ep['season'], ep['number']))
    row = cur.fetchone()
    if row:
        return row['id'], False
    try:
        cur.execute("""INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, sources_scraped)
            VALUES (?, ?, ?, ?, ?, 1)""",
            (drama_id, ep['season'], ep['number'], ep['name'], ep['url']))
        return cur.lastrowid, True
    except Exception:
        cur.execute("SELECT id FROM episodes WHERE episode_url=?", (ep['url'],))
        row = cur.fetchone()
        if row:
            return row['id'], False
        raise

def save_sources(conn, episode_id, ep_url, sources):
    import hashlib
    cur = conn.cursor()
    for i, s in enumerate(sources):
        embed_id = f"dk_{hashlib.md5(s['direct_url'].encode()).hexdigest()[:10]}"
        cur.execute("""INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
            VALUES (?, ?, ?, ?, ?, 'dizikorea')
            ON CONFLICT(episode_id, embed_id) DO UPDATE SET
                direct_url=excluded.direct_url, provider=excluded.provider, source_name=excluded.source_name""",
            (episode_id, s['source_name'], embed_id, s['direct_url'], s['provider']))
    cur.execute("UPDATE episodes SET sources_scraped=1 WHERE id=?", (episode_id,))

async def run(limit=None, batch=20):
    init_db()
    catalog = json.load(open('dk_catalog.json', encoding='utf-8'))
    slugs = list(catalog.keys())
    if limit:
        slugs = slugs[:limit]
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    sem = asyncio.Semaphore(10)
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    new_dramas = matched = new_eps = matched_eps = new_src = 0
    t0 = time.time()
    async with aiohttp.ClientSession(connector=connector) as sess:
        # Faz 1: drama sayfalari
        async def get_drama(slug):
            url = f'{BASE}/dizi/{slug}'
            html = await fetch(sess, url, sem)
            return slug, url, html
        for i in range(0, len(slugs), batch):
            chunk = slugs[i:i + batch]
            res = await asyncio.gather(*[get_drama(s) for s in chunk])
            ep_jobs = []
            for slug, url, html in res:
                if not html:
                    continue
                d = parse_drama(html, url, slug)
                drama_id, is_new = merge_drama(conn, d)
                new_dramas += is_new
                matched += (not is_new)
                for ep in d['episodes']:
                    ep_id, ep_new = merge_episode(conn, drama_id, ep)
                    new_eps += ep_new
                    matched_eps += (not ep_new)
                    ep_jobs.append((ep_id, ep['url']))
            conn.commit()
            # Faz 2: bolum kaynaklari (hemen, ayni baglanti)
            async def get_ep(job):
                ep_id, url = job
                html = await fetch(sess, url, sem)
                return ep_id, url, html
            res2 = await asyncio.gather(*[get_ep(j) for j in ep_jobs])
            for ep_id, url, html in res2:
                if not html:
                    continue
                srcs = parse_episode_sources(html)
                if srcs:
                    save_sources(conn, ep_id, url, srcs)
                    new_src += len(srcs)
            conn.commit()
            el = time.time() - t0
            print(f"DK {min(i+batch, len(slugs))}/{len(slugs)} drama | yeni:{new_dramas} eslesen:{matched} bolum(yeni/eslesen):{new_eps}/{matched_eps} kaynak:{new_src} ({el:.0f}sn)")
    conn.close()
    print(f"DK TAMAM: yeni drama {new_dramas}, eslesen {matched}, kaynak {new_src}")

def parse_film(html, url, slug):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True) if h1 else slug
    badges = [b.get_text(strip=True) for b in soup.select('.meta-badge')]
    year, country = '', ''
    for b in badges:
        if re.fullmatch(r'19\d\d|20\d\d', b):
            year = b
        elif b in COUNTRY_MAP:
            country = COUNTRY_MAP[b]
    genres = [a.get_text(strip=True) for a in soup.select('.meta-badge a[href*="/tur/"]')]
    cover = None
    for img in soup.find_all('img'):
        src = img.get('src') or ''
        if '/uploads/' in src and 'site' not in src and 'logo' not in src.lower():
            cover = src if src.startswith('http') else BASE + src
            break
    overview = ''
    for scr in soup.find_all('script', type='application/ld+json'):
        try:
            ld = json.loads(scr.string or '{}')
            if isinstance(ld, dict) and ld.get('description'):
                overview = ld['description']
                break
        except Exception:
            pass
    srcs = parse_episode_sources(html)
    return {'slug': slug, 'title': title, 'year': year, 'country': country,
            'genres': genres, 'cover': cover, 'overview': overview,
            'sources': srcs, 'url': url}

async def run_films(limit=None, batch=20):
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    sem = asyncio.Semaphore(10)
    connector = aiohttp.TCPConnector(limit=10, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as sess:
        slugs = []
        for p in range(1, 30):
            u = f'{BASE}/filmler' if p == 1 else f'{BASE}/filmler/sayfa/{p}/'
            html = await fetch(sess, u, sem)
            if not html:
                break
            soup = BeautifulSoup(html, 'html.parser')
            n = 0
            for a in soup.find_all('a', href=True):
                h = a['href'] or ''
                if re.match(r'(https://dizikorea3.com)?/film/[a-z0-9-]+/?$', h):
                    slug = h.split('/film/')[1].strip('/')
                    if slug not in slugs:
                        slugs.append(slug)
                        n += 1
            print(f'DK film sayfa {p}: +{n} (toplam {len(slugs)})')
            if n == 0:
                break
        done0 = done_urls(cur, 'dizikorea')
        films = [(s, f'{BASE}/film/{s}') for s in slugs if f'{BASE}/film/{s}' not in done0]
        print(f'DK film kalan: {len(films)}')
        if limit:
            films = films[:limit]
        n_new = n_match = n_src = 0
        t0 = time.time()
        for i in range(0, len(films), batch):
            chunk = films[i:i + batch]
            res = await asyncio.gather(*[fetch(sess, u, sem) for _, u in chunk])
            for (slug, url), html in zip(chunk, res):
                if not html:
                    continue
                f = parse_film(html, url, slug)
                drama_id, is_new = merge_drama(conn, {**f, 'ep_info': '', 'status': '', 'episodes': []})
                _retry(cur.execute, "UPDATE dramas SET content_type='film' WHERE id=?", (drama_id,))
                n_new += is_new
                n_match += (not is_new)
                cur.execute("SELECT id FROM episodes WHERE drama_id=? AND episode_type='film' LIMIT 1", (drama_id,))
                erow = cur.fetchone()
                if erow:
                    ep_id = erow[0]
                else:
                    _retry(cur.execute, """INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type, sources_scraped)
                        VALUES (?, 1, 1, 'Film', ?, 'film', 1)""", (drama_id, url))
                    ep_id = cur.lastrowid
                if f['sources']:
                    save_sources(conn, ep_id, url, f['sources'])
                    n_src += len(f['sources'])
                mark_done(cur, 'dizikorea', url)
            safe_commit(conn)
            print(f"DK-film {min(i+batch, len(films))}/{len(films)} | yeni:{n_new} eslesen:{n_match} kaynak:{n_src} ({time.time()-t0:.0f}sn)")
    conn.close()
    print(f"DK-film TAMAM: yeni {n_new}, eslesen {n_match}, kaynak {n_src}")

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--filmler', action='store_true')
    a = ap.parse_args()
    if a.filmler:
        asyncio.run(run_films(limit=a.limit))
    else:
        asyncio.run(run(limit=a.limit))
