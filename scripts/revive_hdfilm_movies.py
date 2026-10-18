import sqlite3
import re
import json
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from curl_cffi import requests as cfr
from bs4 import BeautifulSoup

db_path = r'c:\Users\Cagan\Downloads\KoUp\webdrama_archive.db'
report_json = r'c:\Users\Cagan\Downloads\KoUp\scripts\reports\ayrintili_yapim_analizi_no_ddizi.json'

def fetch_with_retry(session, url, headers=None, max_retries=3, timeout=12):
    for attempt in range(max_retries):
        try:
            r = session.get(url, headers=headers, timeout=timeout)
            if r.status_code == 429:
                sleep_sec = 4 * (attempt + 1)
                time.sleep(sleep_sec)
                continue
            return r
        except Exception:
            if attempt == max_retries - 1:
                raise
            time.sleep(2)
    return None

def resolve_single_movie(movie):
    d_id = movie['id']
    ep_id = movie['ep_id']
    page_url = movie['url']
    title = movie['title']
    
    s = cfr.Session(impersonate="chrome")
    try:
        r_page = fetch_with_retry(s, page_url, timeout=15)
        if not r_page or r_page.status_code != 200:
            status = r_page.status_code if r_page else "No Response"
            return d_id, ep_id, title, None, f"HTTP {status}"
        
        soup = BeautifulSoup(r_page.text, "html.parser")
        video_buttons = soup.find_all(attrs={"data-video": True})
        
        close_id = None
        rapid_id = None
        for b in video_buttons:
            txt = b.get_text(strip=True).lower()
            vid = b.get("data-video")
            if "close" in txt and not close_id:
                close_id = vid
            elif "rapid" in txt and not rapid_id:
                rapid_id = vid
        
        # If no explicit close/rapid buttons, check default iframe
        default_iframe = soup.find("iframe")
        default_src = (default_iframe.get("data-src") or default_iframe.get("src") or "") if default_iframe else ""
        
        headers = {
            "Referer": page_url,
            "X-Requested-With": "fetch",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*"
        }
        
        close_embed_url = None
        rapid_embed_url = None
        master_hls_url = None
        
        # 1. Close resolution
        if close_id:
            res_c = fetch_with_retry(s, f"https://www.hdfilmcehennemi.nl/video/{close_id}/", headers=headers, timeout=10)
            if res_c and res_c.status_code == 200:
                try:
                    js_data = res_c.json()
                    c_soup = BeautifulSoup(js_data.get("data", {}).get("html", ""), "html.parser")
                    c_ifr = c_soup.find("iframe")
                    if c_ifr:
                        close_embed_url = c_ifr.get("data-src") or c_ifr.get("src")
                except Exception:
                    pass
        elif "hdfilmcehennemi.mobi/video/embed/" in default_src:
            close_embed_url = default_src

        # 2. Rapidrame resolution
        if rapid_id:
            res_r = fetch_with_retry(s, f"https://www.hdfilmcehennemi.nl/video/{rapid_id}/", headers=headers, timeout=10)
            if res_r and res_r.status_code == 200:
                try:
                    js_data = res_r.json()
                    r_soup = BeautifulSoup(js_data.get("data", {}).get("html", ""), "html.parser")
                    r_ifr = r_soup.find("iframe")
                    if r_ifr:
                        rapid_embed_url = r_ifr.get("data-src") or r_ifr.get("src")
                except Exception:
                    pass
        elif "rplayer" in default_src:
            rapid_embed_url = default_src

        # 3. Master HLS resolution via Close embed
        if close_embed_url:
            r_embed = fetch_with_retry(s, close_embed_url, headers={"Referer": "https://www.hdfilmcehennemi.nl/"}, timeout=10)
            if r_embed and r_embed.status_code == 200:
                emb_html = r_embed.text
                m_var = re.search(r'sources:\s*\[\{file:\s*(\w+)', emb_html)
                if m_var:
                    var_name = m_var.group(1)
                    emb_soup = BeautifulSoup(emb_html, "html.parser")
                    target_script = None
                    for sc in emb_soup.find_all("script"):
                        txt = sc.get_text()
                        if f"var {var_name}" in txt or f"{var_name} =" in txt:
                            target_script = txt
                            break
                    if target_script:
                        stub = "var document = { querySelector: () => null, addEventListener: () => {} };\nvar window = { location: { href: '' } };\n"
                        payload = stub + target_script + f'\nconsole.log("STREAM_URL:" + {var_name} + ":END_STREAM");'
                        try:
                            r_node = subprocess.run(["node", "-e", payload], capture_output=True, text=True, timeout=5)
                            m_url = re.search(r'STREAM_URL:(.+?):END_STREAM', r_node.stdout)
                            if m_url:
                                master_hls_url = m_url.group(1).strip()
                        except Exception:
                            pass

        collected_sources = []
        if master_hls_url:
            collected_sources.append(('HDFilm 1080p Dual', 'hd_close_master', master_hls_url, 'hdfilm-hls', 'hdfilm'))
        if close_embed_url:
            collected_sources.append(('Close Player', 'hd_close_embed', close_embed_url, 'hdfilm-close', 'hdfilm'))
        if rapid_embed_url:
            collected_sources.append(('Rapidrame', 'hd_rapid_embed', rapid_embed_url, 'rapidrame', 'hdfilm'))

        return d_id, ep_id, title, collected_sources, None
    except Exception as e:
        return d_id, ep_id, title, None, str(e)


def main():
    with open(report_json, 'r', encoding='utf-8') as f:
        data = json.load(f)

    cat1 = data['completely_dead']
    film_ids = [x['id'] for x in cat1 if x['type'] == 'film']

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Find already revived movies so we don't duplicate work
    cur.execute("""
        SELECT DISTINCT e.drama_id 
        FROM episodes e 
        JOIN episode_sources es ON es.episode_id = e.id 
        WHERE es.source_name IN ('Close Player', 'HDFilm 1080p Dual')
    """)
    already_revived = set(r[0] for r in cur.fetchall())

    placeholders = ','.join('?' for _ in film_ids)
    cur.execute(f"""
        SELECT d.id, d.title, d.slug, d.source_url, e.id as ep_id
        FROM dramas d
        JOIN episodes e ON e.drama_id = d.id
        WHERE d.id IN ({placeholders})
        GROUP BY d.id;
    """, film_ids)

    movies = []
    for r in cur.fetchall():
        d_id = r['id']
        if d_id in already_revived:
            continue
        s_url = r['source_url'] or ''
        slug = r['slug'] or ''
        if 'hdfilmcehennemi' in s_url or slug.endswith('-hf'):
            clean_slug = slug[:-3] if slug.endswith('-hf') else slug
            target_url = s_url if ('hdfilmcehennemi' in s_url) else f"https://www.hdfilmcehennemi.nl/{clean_slug}/"
            if not target_url.endswith('/'):
                target_url += '/'
            movies.append({
                'id': d_id,
                'title': r['title'],
                'ep_id': r['ep_id'],
                'url': target_url
            })

    print(f"Daha önce canlandırılan HDFilm filmleri: {len(already_revived)}")
    print(f"Kalan taranacak HDFilm filmi: {len(movies)}")

    if not movies:
        print("Taranacak yeni film kalmadı!")
        conn.close()
        return

    success_count = 0
    failed_count = 0
    t0 = time.time()

    # Use 2 workers to avoid 429 rate limiting
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(resolve_single_movie, m) for m in movies]
        for fut in as_completed(futures):
            d_id, ep_id, title, srcs, err = fut.result()
            time.sleep(0.3)
            if srcs and len(srcs) > 0:
                success_count += 1
                cur.execute("DELETE FROM episode_sources WHERE episode_id = ?;", (ep_id,))
                for sname, eid, durl, prov, site in srcs:
                    cur.execute("""
                        INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site)
                        VALUES (?, ?, ?, ?, ?, ?);
                    """, (ep_id, sname, eid, durl, prov, site))
                cur.execute("UPDATE dramas SET sources_count = ? WHERE id = ?;", (len(srcs), d_id))
                conn.commit()
                print(f"[CANLI] ID: {d_id} | {title[:30]} | {len(srcs)} kaynak eklendi!")
            else:
                failed_count += 1
                print(f"[BAŞARISIZ] ID: {d_id} | {title[:30]} | Sebep: {err}")

    conn.close()
    elapsed = time.time() - t0
    print(f"\nİkinci Tur Tamamlandı:")
    print(f"  - Başarıyla Canlandırılan: {success_count}")
    print(f"  - Alınamayan / Sayfası Silinmiş Olan: {failed_count}")
    print(f"  - Süre: {elapsed:.2f} saniye")

if __name__ == '__main__':
    main()
