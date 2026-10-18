import sqlite3
import re
import urllib.request
from bs4 import BeautifulSoup

def clean_ddizi_title(raw_title: str) -> str:
    if not raw_title:
        return ""
    t = raw_title.strip()
    t = re.sub(r'\|\s*(ddizi(\.tel)?|dizi\s*izle).*$', '', t, flags=re.I)
    t = re.sub(r'-\s*ddizi.*$', '', t, flags=re.I)
    channels = [
        r'trt\s*1', r'trt1', r'atv', r'kanal\s*d', r'star\s*tv', r'star',
        r'now\s*tv', r'now', r'fox\s*tv', r'fox', r'show\s*tv', r'show',
        r'tv\s*8', r'tv8', r'exxen', r'gain', r'blutv', r'tabii', r'puhutv', r'netflix'
    ]
    for ch in channels:
        t = re.sub(rf'\b{ch}\b\s*$', '', t, flags=re.I)
    patterns = [
        r'son\s*b[öo]l[üu]m\s*izle\s*(full)?',
        r'son\s*b[öo]l[üu]m',
        r't[üu]rk[çc]e\s*(altyaz[ıi]l[ıi]|dublaj(l[ıi])?)',
        r'full\s*hd\s*izle',
        r'hd\s*izle',
        r'tek\s*par[çc]a\s*izle',
        r'tek\s*par[çc]a',
        r'full\s*b[öo]l[üu]m',
        r'b[öo]l[üu]m\s*izle',
        r'\b\d+\s*\.\s*b[öo]l[üu]m\b',
        r'\b\d+\s*\.\s*sezon\b',
        r'\b(hd\d*|izle|full|seyret)\b',
        r'\b\d+\s*-\s*son\b',
    ]
    for p in patterns:
        t = re.sub(p, '', t, flags=re.I)
    t = re.sub(r'[\-_|:•]+$', '', t).strip()
    t = re.sub(r'^[\-_|:•]+', '', t).strip()
    t = re.sub(r'\s{2,}', ' ', t).strip()
    return t

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

c.execute("SELECT id, title, source_url FROM dramas WHERE alt_sites LIKE '%ddizi%'")
rows = c.fetchall()
repaired = 0

for did, title, url in rows:
    if '\ufffd' in title or '\ufffd' in (title or ''):
        print(f"Fixing {did}: {repr(title)} ({url})")
        if url and url.startswith('http'):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    raw = resp.read()
                    html = raw.decode('utf-8', errors='replace')
                    soup = BeautifulSoup(html, 'html.parser')
                    raw_t = ""
                    if soup.title and soup.title.string:
                        raw_t = soup.title.string
                    if not raw_t:
                        tc = soup.find('div', class_='title_con')
                        if tc:
                            raw_t = tc.get_text(strip=True)
                    new_title = clean_ddizi_title(raw_t)
                    if new_title and '\ufffd' not in new_title:
                        c.execute("UPDATE dramas SET title=?, country_name='Türkiye', overview=? WHERE id=?", (
                            new_title,
                            f"{new_title}, DDizi arşivi üzerinden sunulan yerli dizi ve yapımlardandır.",
                            did
                        ))
                        # also update episode names for this drama
                        c.execute("SELECT id, episode_number FROM episodes WHERE drama_id=?", (did,))
                        for eid, ep_num in c.fetchall():
                            c.execute("UPDATE episodes SET episode_name=? WHERE id=?", (f"{ep_num}. Bölüm", eid))
                        print(f"  -> Successfully updated to: {new_title}")
                        repaired += 1
            except Exception as e:
                print(f"  -> Error fetching {url}: {e}")

conn.commit()
conn.close()
print(f"Total repaired: {repaired}")
