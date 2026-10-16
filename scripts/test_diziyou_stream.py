import requests
from bs4 import BeautifulSoup
import re

headers = {'User-Agent': 'Mozilla/5.0'}
r = requests.get('https://www.diziyou.one/dizi-arsivi/', headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')
links = ['https://www.diziyou.one/1899/']

print('Sample series from DiziYou:', links[:5])

if links:
    s_url = links[0]
    r_s = requests.get(s_url, headers=headers)
    s_soup = BeautifulSoup(r_s.text, 'html.parser')
    ep_links = [a['href'] for a in s_soup.find_all('a', href=True) if '-sezon-' in a['href'] and '-bolum' in a['href']]
    print('Sample ep links from', s_url, ':', ep_links[:3])
    if ep_links:
        r_ep = requests.get(ep_links[0], headers=headers)
        ep_soup = BeautifulSoup(r_ep.text, 'html.parser')
        for fr in ep_soup.find_all('iframe'):
            src = fr.get('src', '')
            print('DiziYou iframe:', src)
            if '/player/' in src:
                p_url = src if src.startswith('http') else 'https://www.diziyou.one' + src
                r_p = requests.get(p_url, headers={'Referer': ep_links[0]})
                m = re.findall(r'https?://[^"\'\s]+\.m3u8[^"\'\s]*', r_p.text)
                print('DiziYou m3u8 found:', m[:2])
