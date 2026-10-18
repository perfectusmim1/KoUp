import requests
import re
from bs4 import BeautifulSoup

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
r = requests.get('https://asyawatch.com/dizi/reply-1988/sezon-1/bolum-1', headers=headers)
html = r.text
print('HTML length:', len(html))

# Look for iframe
matches = re.findall(r'https?://[^\s"\'<>]+(?:pichive|iframe\.php|four\.)[^\s"\'<>]*', html)
print('Direct pichive matches:', matches)

# Check script tags
soup = BeautifulSoup(html, 'html.parser')
for sc in soup.find_all('script'):
    txt = sc.get_text()
    if 'iframe' in txt.lower() or 'pichive' in txt.lower() or 'player' in txt.lower():
        lines = [l.strip() for l in txt.splitlines() if any(k in l.lower() for k in ['iframe', 'pichive', 'src', 'openplayer', 'source'])]
        if lines:
            print('Script lines:', lines[:5])
