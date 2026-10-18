import sys
import json
import re
from curl_cffi import requests
from bs4 import BeautifulSoup

def scrape_mdl_dramalist(target):
    target = target.strip()
    if target.startswith('http://') or target.startswith('https://'):
        url = target
        if '/profile/' in url:
            url = url.replace('/profile/', '/dramalist/')
    else:
        # Strip leading slashes or @
        clean_target = target.lstrip('@/').strip()
        url = f'https://mydramalist.com/dramalist/{clean_target}'
    
    headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
    }
    
    try:
        r = requests.get(url, impersonate='chrome120', headers=headers, timeout=12)
    except Exception as e:
        return {'success': False, 'error': f'Bağlantı hatası: {str(e)}'}
    
    if r.status_code == 404:
        return {'success': False, 'error': 'MyDramaList profili bulunamadı veya liste gizli (Private/Members Only).'}
    
    if r.status_code != 200:
        return {'success': False, 'error': f'MDL sunucusu {r.status_code} yanıtı verdi.'}
    
    soup = BeautifulSoup(r.text, 'html.parser')
    
    # Check if page is challenge
    if 'Enable JavaScript and cookies to continue' in r.text:
        return {'success': False, 'error': 'MyDramaList Cloudflare doğrulaması aşılamadı.'}
    
    entries = []
    
    # 1. Look for classic/v2 table rows
    rows = soup.find_all('tr')
    for row in rows:
        a_title = row.find('a', href=re.compile(r'^/\d+-[a-z0-9-]+'))
        if not a_title:
            continue
        
        href = a_title.get('href', '').strip()
        slug = href.lstrip('/')
        title = a_title.get_text(strip=True)
        
        # Determine status from table section or row classes/text
        row_text = row.get_text(' ', strip=True).lower()
        status = 'completed'
        if 'watching' in row_text or 'currently' in row_text:
            status = 'watching'
        elif 'plan to watch' in row_text or 'plan_to_watch' in row_text:
            status = 'plan_to_watch'
        elif 'on hold' in row_text or 'paused' in row_text:
            status = 'on_hold'
        elif 'dropped' in row_text:
            status = 'dropped'
        elif 'completed' in row_text:
            status = 'completed'
            
        # Score parsing
        score = 9
        score_td = row.find('td', class_='score') or row.find('span', class_='score')
        if score_td:
            try:
                score = float(score_td.get_text(strip=True))
            except:
                pass
        else:
            # Try finding score in text like 10.0 or 10
            score_m = re.search(r'\b(10(?:\.0)?|[1-9](?:\.[0-9])?)\b', row.get_text(' ', strip=True))
            if score_m:
                try:
                    score = float(score_m.group(1))
                except:
                    pass
                    
        # Episode progress parsing (e.g. 16/16 or 5/11)
        progress = 16
        ep_m = re.search(r'(\d+)\s*/\s*(\d+)', row.get_text(' ', strip=True))
        if ep_m:
            try:
                progress = int(ep_m.group(1))
            except:
                pass
                
        entries.append({
            'mdl_id': slug,
            'title': title,
            'status': status,
            'score': round(score),
            'progress': progress
        })
        
    return {
        'success': True,
        'url': url,
        'totalFound': len(entries),
        'entries': entries
    }

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else 'kristina'
    res = scrape_mdl_dramalist(target)
    print(json.dumps(res, ensure_ascii=False))
