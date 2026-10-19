import requests
from bs4 import BeautifulSoup
import re

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'}
r = requests.get('https://dizikorea3.com/dizi/welcome-to-samdalri-izle-dq', headers=headers, timeout=10)
soup = BeautifulSoup(r.text, 'html.parser')

ep_links = []
for a in soup.find_all('a'):
    href = a.get('href', '')
    if 'welcome-to-samdalri-izle-dq' in href and 'bolum' in href:
        if href not in ep_links:
            ep_links.append(href)

print(f'Found {len(ep_links)} episodes on DiziKorea for Welcome to Samdalri:')
for l in ep_links[:5]:
    print(l)

# Check episode 1 sources
if ep_links:
    r_ep = requests.get(ep_links[0], headers=headers, timeout=10)
    soup_ep = BeautifulSoup(r_ep.text, 'html.parser')
    for ifr in soup_ep.find_all('iframe'):
        print('Iframe:', ifr.get('src'))
    # Check buttons/sources
    for b in soup_ep.find_all(['button', 'a', 'div']):
        for attr, val in b.attrs.items():
            if isinstance(val, str) and any(x in val.lower() for x in ['player', 'vidmoly', 'moly', 'ok.ru', 'embed', 'pichive']):
                print(f'Attr {b.name}[{attr}] = {val[:120]}')
