import sqlite3
import requests
import json
import base64
import re
from bs4 import BeautifulSoup

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

print("Fetching AsyaWatch episodes for Reply 1988...")
asya_sources_by_ep = {}

for ep in range(1, 21):
    url = f"https://asyawatch.com/dizi/reply-1988/sezon-1/bolum-{ep}"
    try:
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code != 200 or '__NEXT_DATA__' not in r.text:
            print(f"  Ep {ep}: failed or not 200 ({r.status_code})")
            continue
        soup = BeautifulSoup(r.text, 'html.parser')
        s = soup.find('script', id='__NEXT_DATA__')
        if not s:
            continue
        data = json.loads(s.string)
        sec = data.get('props', {}).get('pageProps', {}).get('secureData')
        if not sec:
            continue
        dec = json.loads(base64.b64decode(sec).decode('utf-8'))
        sources = dec.get('RelatedResults', {}).get('getEpisodeSources', {}).get('result', [])
        
        extracted = []
        for src in sources:
            name = src.get('source_name', 'Asyawatch')
            content = src.get('source_content', '')
            # Extract src url
            m = re.search(r'src=["\']([^"\']+)["\']', content)
            direct_url = m.group(1) if m else content
            if direct_url.startswith('//'):
                direct_url = 'https:' + direct_url
            
            # Embed id
            m_v = re.search(r'v=([a-zA-Z0-9_-]+)', direct_url)
            embed_id = m_v.group(1) if m_v else f"aw_rep_{ep}"
            extracted.append({
                'source_name': f"Asyawatch (1080p)",
                'embed_id': embed_id,
                'direct_url': direct_url,
                'provider': 'asyawatch',
                'site': 'asyawatch',
                'fansub': 'AsyaWatch',
            })
        asya_sources_by_ep[ep] = extracted
        print(f"  Ep {ep}: found {len(extracted)} sources -> {[x['direct_url'] for x in extracted]}")
    except Exception as e:
        print(f"  Ep {ep} error: {e}")

# Now insert into SQLite for drama_id 601 and 29442
for did in [601, 29442]:
    print(f"\nUpdating drama_id {did} in SQLite...")
    # Fetch existing episodes
    eps = cur.execute("SELECT id, season_number, episode_number FROM episodes WHERE drama_id = ? ORDER BY episode_number", (did,)).fetchall()
    
    # Map episode_number -> id
    ep_map = {row[2]: row[0] for row in eps if row[1] == 1}
    
    # If any episode missing (e.g. 1..20), create it
    for ep_num in range(1, 21):
        if ep_num not in ep_map:
            cur.execute("""
                INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type)
                VALUES (?, 1, ?, ?, ?, 'bolum')
            """, (did, ep_num, f"{ep_num}. Bölüm", f"/seri/reply-izle/{ep_num}?season=1"))
            ep_map[ep_num] = cur.lastrowid
            print(f"  Created episode 1x{ep_num} (id={ep_map[ep_num]})")

    # For each episode, clean old dead OKRU sources and insert new AsyaWatch source
    for ep_num, src_list in asya_sources_by_ep.items():
        ep_id = ep_map.get(ep_num)
        if not ep_id:
            continue
        
        # Remove old okru / dead sources for this episode
        cur.execute("DELETE FROM episode_sources WHERE episode_id = ? AND (provider = 'ok.ru' OR direct_url LIKE '%ok.ru%')", (ep_id,))
        
        # Insert AsyaWatch sources if not existing
        for s in src_list:
            cur.execute("SELECT id FROM episode_sources WHERE episode_id = ? AND direct_url = ?", (ep_id, s['direct_url']))
            if not cur.fetchone():
                cur.execute("""
                    INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site, fansub)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (ep_id, s['source_name'], s['embed_id'], s['direct_url'], s['provider'], s['site'], s['fansub']))
                print(f"  Inserted source for ep {ep_num} into ep_id {ep_id}")

conn.commit()
cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
conn.close()
print("Finished syncing Reply 1988!")
