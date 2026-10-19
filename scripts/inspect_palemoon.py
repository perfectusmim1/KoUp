import requests
import re
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings()

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'}
url = 'https://dizikorea3.com/dizi/pale-moon-izle-dq/sezon-1/bolum-1'
r = requests.get(url, verify=False, headers=headers)
html = r.text

print(f"Status: {r.status_code}, Length: {len(html)}")
soup = BeautifulSoup(html, 'html.parser')
iframes = [ifr.get('src') for ifr in soup.find_all('iframe') if ifr.get('src')]
print("Iframes found:", iframes)

# Check all data-embed, data-src, etc.
for tag in soup.find_all(True):
    for attr, val in tag.attrs.items():
        if isinstance(val, str) and any(x in val.lower() for x in ['player', 'embed', 'video', 'moly', 'ok.ru', 'pichive']):
            print(f"Attr {tag.name}[{attr}] = {val[:100]}")
