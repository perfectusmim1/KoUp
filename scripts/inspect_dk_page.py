import requests
import re
from bs4 import BeautifulSoup

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'}
r = requests.get('https://dizikorea3.com/dizi/welcome-to-samdalri-izle-dq/sezon-1/bolum-1', headers=headers)
html = r.text

print(f"Status: {r.status_code}, Length: {len(html)}")

# Find any iframes or players
soup = BeautifulSoup(html, 'html.parser')
for tag in soup.find_all(['iframe', 'video', 'source', 'div']):
    for attr in ['src', 'data-src', 'data-embed', 'data-url']:
        val = tag.get(attr)
        if val:
            print(f"Tag {tag.name}[{attr}] = {val}")

# Check all scripts
for s in soup.find_all('script'):
    stext = s.string or s.text or ''
    if any(k in stext.lower() for k in ['vidmoly', 'playerdkorea', 'ok.ru', 'ajax', 'action', 'nonce', 'embed']):
        print("Script snippet:")
        print(stext[:300].strip())
        print("...")
