"""
TRAnimeizle Scraper: iconCaptcha otomatik cozumu + API zinciri.
Akis: sitemap -> anime -> bolumler -> fansubSources -> sourcePlayer -> direkt iframe.
Tek serit, yavas tempo (captcha duvarli site).
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
import sys
sys.stdout.reconfigure(encoding='utf-8')
import re
import io
import json
import time
import xml.etree.ElementTree as ET
from curl_cffi import requests as cfr
from bs4 import BeautifulSoup
from PIL import Image
from database import get_connection, init_db
from resolve_sources import identify_provider
from multisite import norm_title, build_drama_index, find_in_index, match_or_create_episode, add_source, tag_site, safe_commit, load_done_urls, mark_done
from anilist_sync import search_anilist_with_cache

BASE = 'https://www.tranimeizle.live'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

class TASession:
    def __init__(self):
        self.s = cfr.Session(impersonate='chrome')
        self.solved = False

    @staticmethod
    def _call(fn, timeout=25):
        """Ag takilmasina karsi sert duvar saati (curl timeout'u atlatabilen stall'lar icin)."""
        import concurrent.futures as cf
        with cf.ThreadPoolExecutor(max_workers=1) as x:
            f = x.submit(fn)
            try:
                return f.result(timeout=timeout)
            except Exception:
                return None

    def get(self, url):
        r = self._call(lambda: self.s.get(url, timeout=15))
        if r is None:
            raise TimeoutError(f'GET timeout: {url}')
        if 'captcha-holder' in r.text and 'api/CaptchaChallenge' in r.text:
            self.solve()
            r = self._call(lambda: self.s.get(url, timeout=15))
            if r is None:
                raise TimeoutError(f'GET timeout: {url}')
        return r

    def api_post(self, url, payload=None, as_json=False):
        if as_json:
            return self._call(lambda: self.s.post(url, json=payload, timeout=12))
        return self._call(lambda: self.s.post(url, data=payload, timeout=12))

    def solve(self):
        s = self.s
        C = TASession._call
        C(lambda: s.get(BASE + '/', timeout=12))
        r = C(lambda: s.post(BASE + '/api/Captcha/', data={'cID': 0, 'rT': 1, 'tM': 'dark'}, timeout=12))
        if r is None:
            raise TimeoutError('captcha challenge timeout')
        hs = r.json()
        imgs = []
        for h in hs:
            ri = C(lambda: s.get(f'{BASE}/api/Captcha/?cid=0&hash={h}', timeout=12))
            if ri is None:
                raise TimeoutError('captcha icon timeout')
            im = Image.open(io.BytesIO(ri.content)).convert('RGB').resize((32, 32))
            imgs.append((h, list(im.getdata())))
        def dist(a, b):
            return sum(abs(x - y) for p1, p2 in zip(a, b) for x, y in zip(p1, p2))
        sc = [sum(dist(imgs[i][1], imgs[j][1]) for j in range(len(imgs)) if j != i) for i in range(len(imgs))]
        odd = max(range(len(sc)), key=lambda i: sc[i])
        C(lambda: s.post(BASE + '/api/Captcha/', data={'cID': 0, 'pC': hs[odd], 'rT': 2}, timeout=12))
        self.solved = True
        time.sleep(1)

def sitemap_urls(delay=1.0):
    # Sitemap herkese acik statik dosya: ayri, iz birakmayan oturumla cekilir.
    tmp = cfr.Session(impersonate='chrome')
    idx = tmp.get(BASE + '/sitemap.xml', timeout=15).text
    root = ET.fromstring(idx)
    locs = [e.text.strip() for e in root.iter() if e.tag.endswith('loc')]
    out = {'anime': [], 'episode': []}
    for u in locs:
        time.sleep(delay)
        try:
            x = tmp.get(u, timeout=15).text
            r2 = ET.fromstring(x)
            urls = [e.text.strip() for e in r2.iter() if e.tag.endswith('loc')]
            if 'episode' in u:
                out['episode'].extend(urls)
            else:
                out['anime'].extend(urls)
        except Exception as e:
            print('sitemap hata:', u, e)
    return out

def parse_anime(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.find('h1')
    title = h1.get_text(strip=True).replace(' İzle', '') if h1 else url.rstrip('/').split('/')[-1]
    slug = url.rstrip('/').split('/')[-1].replace('-izle', '')
    jp, genres, cover, year, fansubs = '', [], None, '', []
    for dt in soup.find_all('dt'):
        t = dt.get_text(strip=True)
        if re.search(r'[\u3040-\u30ff\u4e00-\u9faf]', t) and len(t) < 60 and not jp:
            jp = t
    for a in soup.select('a.genre'):
        genres.append(a.get_text(strip=True))
    img = soup.find('img', class_='img-responsive')
    if img and img.get('src'):
        cover = img['src']
    m = re.search(r'(19|20)\d\d', soup.get_text())
    eps = []
    for li in soup.select('li.episodeBtn'):
        sl = li.get('data-slug')
        if not sl:
            continue
        me = re.search(r'-(\d+)-bolum-izle', sl)
        num = int(me.group(1)) if me else 1
        eps.append({'number': num, 'name': li.get_text(strip=True)[:60], 'url': BASE + '/' + sl})
    for a in soup.select('.fansubSelector'):
        fansubs.append({'fid': a.get('data-fid'), 'name': a.get_text(strip=True)})
    return {'slug': slug, 'title': title, 'native': jp, 'genres': genres, 'cover': cover,
            'year': m.group(0) if m else '', 'episodes': eps, 'fansubs': fansubs, 'url': url}

def run(limit=None, delay=1.2, workers=3):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    init_db()
    conn = get_connection()
    conn.execute("PRAGMA busy_timeout=30000;")
    cur = conn.cursor()
    idx = build_drama_index(cur, ('anime',))
    sm = sitemap_urls()
    print(f"TA sitemap: {len(sm['anime'])} anime, {len(sm['episode'])} bolum")
    anime_urls = sm['anime']
    done0 = load_done_urls(cur, 'tranimeizle')
    anime_urls = [u for u in anime_urls if u not in done0]
    print(f"TA kalan (islenmemis): {len(anime_urls)} anime")
    if limit:
        anime_urls = anime_urls[:limit]
    st = {'new': 0, 'match': 0, 'ep': 0, 'src': 0, 'done': 0}
    lock = threading.Lock()
    tls = threading.local()

    def wsess():
        s = getattr(tls, 's', None)
        if s is None:
            s = TASession()
            s.solve()
            tls.s = s
        return s

    def wdb():
        c = getattr(tls, 'c', None)
        if c is None:
            from database import DB_PATH
            import sqlite3
            c = sqlite3.connect(DB_PATH, timeout=60)
            c.execute("PRAGMA journal_mode=WAL;")
            c.execute("PRAGMA busy_timeout=30000;")
            tls.c = c
            tls.cu = c.cursor()
        return tls.c, tls.cu

    def one(url):
        sess = wsess()
        conn, cur = wdb()
        try:
            time.sleep(delay)
            html = sess.get(url).text
            if 'captcha-holder' in html:
                sess.solve()
                html = sess.get(url).text
                if 'captcha-holder' in html:
                    return
            a = parse_anime(html, url)
            with lock:
                did = find_in_index(idx, a['title'], a['year'], a['slug'])
                if did:
                    st['match'] += 1
                else:
                    al = search_anilist_with_cache(a['title'], a['slug'])
                    al_url = al.get('siteUrl') if al else None
                    al_id = al.get('id') if al else None
                    if al_url:
                        cur.execute("SELECT id FROM dramas WHERE anilist_url=?", (al_url,))
                        r = cur.fetchone()
                        if r:
                            did = r[0]
                            st['match'] += 1
                        else:
                            did = None
                    if not did:
                        slug = a['slug'] if not cur.execute("SELECT id FROM dramas WHERE slug=?", (a['slug'],)).fetchone() else a['slug'] + '-ta'
                        cur.execute("""INSERT INTO dramas (slug, content_type, title, native_title, source_url,
                            anilist_url, anilist_id, cover_image, country, country_name, release_year,
                            overview, categories, tags, alt_sites)
                            VALUES (?, 'anime', ?, ?, ?, ?, ?, ?, 'jp', 'Japonya', ?, '', ?, '[]', ?)""",
                            (slug, a['title'], a['native'], url, al_url, al_id, a['cover'],
                             a['year'], json.dumps(a['genres'], ensure_ascii=False), json.dumps(['tranimeizle'])))
                        did = cur.lastrowid
                        st['new'] += 1
                tag_site(cur, did, 'tranimeizle')
                mark_done(cur, 'tranimeizle', url)
                safe_commit(conn)
                eps = []
                for ep in a['episodes']:
                    eid, _ = match_or_create_episode(cur, did, 1, ep['number'], ep['name'], ep['url'])
                    st['ep'] += 1
                    eps.append((eid, ep))
                safe_commit(conn)
            for eid, ep in eps:
                time.sleep(delay)
                try:
                    ehtml = sess.get(ep['url']).text
                except Exception:
                    continue
                m = re.search(r'animeWatch\.initialize\((\d+),\s*(\d+),\s*(\d+),\s*"([^"]*)"', ehtml)
                fids = re.findall(r'data-fid="(\d+)"', ehtml)
                combos = [(m.group(2), m.group(3), m.group(4))] if m else []
                for fid in fids:
                    if not any(c[1] == fid for c in combos):
                        combos.append((None, fid, ''))
                for EpId, fid, fname in combos:
                    if not EpId and not m:
                        continue
                    EpId = EpId or m.group(2)
                    try:
                        time.sleep(0.5)
                        fs = sess.api_post(BASE + '/api/fansubSources', {'EpisodeId': int(EpId), 'FansubId': int(fid)}, as_json=True)
                        if fs is None:
                            continue
                        vids = re.findall(r'data-id="(\d+)"', fs.text)
                        for vid in vids:
                            time.sleep(0.5)
                            sp = sess.api_post(f'{BASE}/api/sourcePlayer/{vid}')
                            if sp is None:
                                continue
                            try:
                                im = re.search(r'<iframe[^>]+src="([^"]+)"', sp.json().get('source', ''))
                            except Exception:
                                im = None
                            if im:
                                u = im.group(1)
                                u = 'https:' + u if u.startswith('//') else u
                                notes = ''
                                try:
                                    notes = sp.json().get('contributerNotes', '')
                                except Exception:
                                    pass
                                with lock:
                                    if add_source(cur, eid, fname or 'TA', u, identify_provider(u), 'tranimeizle', notes or None, embed_id=f'ta_{vid}'):
                                        st['src'] += 1
                                    safe_commit(conn)
                    except Exception:
                        continue
            with lock:
                st['done'] += 1
                if st['done'] % 10 == 0:
                    print(f"TA {st['done']}/{len(anime_urls)} | yeni:{st['new']} eslesen:{st['match']} bolum:{st['ep']} kaynak:{st['src']}")
        except Exception as e:
            print('TA hata:', url, repr(e)[:100])

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, anime_urls))
    print(f"TA TAMAM: yeni {st['new']}, eslesen {st['match']}, kaynak {st['src']} ({time.time()-t0:.0f}sn)")

if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=None)
    ap.add_argument('--delay', type=float, default=1.2)
    ap.add_argument('--workers', type=int, default=3)
    a = ap.parse_args()
    run(limit=a.limit, delay=a.delay, workers=a.workers)
