"""
WebDramaTurkey Arşiv Çıkarıcı & Veritabanı Yöneticisi (Resilient Async Scraper Engine)
Tüm dizi, film, anime ve program künyesi, açıklamaları, türleri, oyuncuları,
MyDramaList / AniList bağlantıları, bölüm isimleri ve video kaynaklarını SQLite'a kaydeder.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import re
import json
import time
import asyncio
import aiohttp
import sqlite3
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from curl_cffi import requests as cffi_requests
from database import get_connection, init_db, DB_PATH
from anilist_sync import search_anilist_with_cache, sync_all_webdrama_anime

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://webdramaturkey2.com/'
}

COUNTRY_MAP = {
    "kr": "Güney Kore",
    "cn": "Çin",
    "jp": "Japonya",
    "th": "Tayland",
    "tw": "Tayvan",
    "ph": "Filipinler",
    "hk": "Hong Kong",
    "us": "ABD"
}

MDL_CACHE = {}

def get_mdl_drama_link(title):
    """MyDramaList üzerinde drama/program arar ve linkini döndürür."""
    if not title:
        return None
    cache_key = title.strip().lower()
    if cache_key in MDL_CACHE:
        return MDL_CACHE[cache_key]

    try:
        url = f"https://mydramalist.com/search?q={cffi_requests.utils.quote(title)}"
        resp = cffi_requests.get(url, impersonate="chrome", timeout=8)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, 'html.parser')
            for h in soup.find_all('h6', class_='text-primary'):
                a = h.find('a')
                if a and a.get('href') and not a['href'].startswith('/people/'):
                    mdl_url = "https://mydramalist.com" + a['href']
                    MDL_CACHE[cache_key] = mdl_url
                    return mdl_url
    except Exception:
        pass

    MDL_CACHE[cache_key] = None
    return None

def fetch_sitemap_drama_urls(content_type=None):
    """sitemap.posts_1.xml dosyasından tüm URL'leri çeker, istenirse tür bazlı filtreler."""
    sitemap_url = "https://webdramaturkey2.com/sitemap.posts_1.xml"
    req = cffi_requests.get(sitemap_url, headers=HEADERS, timeout=15)
    root = ET.fromstring(req.content)
    urls = []
    for s in root:
        loc = s.find('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')
        if loc is not None and loc.text:
            u = loc.text.strip()
            if content_type:
                prefix = f"/{content_type}/"
                if prefix in u:
                    urls.append(u)
            else:
                urls.append(u)
    return urls

async def fetch_html_async(session, url, semaphore, max_retries=3):
    """Async URL getirme (Rate limit korumalı & Retry destekli)"""
    async with semaphore:
        for attempt in range(max_retries):
            try:
                async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status == 200:
                        # Site her zaman UTF-8 servis eder; charset tahminine
                        # bırakmadan ham baytı UTF-8 çöz (Türkçe karakter
                        # bozulmalarını önler).
                        raw = await resp.read()
                        return raw.decode('utf-8', errors='replace')
                    elif resp.status == 429:
                        await asyncio.sleep(2 * (attempt + 1))
            except Exception:
                await asyncio.sleep(1)
        return None

def parse_drama_page(url, html):
    """Dizi/Film/Anime/Program sayfasının tüm alanlarını detaylıca ayrıştırır."""
    soup = BeautifulSoup(html, 'html.parser')

    # İçerik türünü URL'den tespit et
    if "/film/" in url:
        content_type = "film"
    elif "/anime/" in url:
        content_type = "anime"
    elif "/program/" in url:
        content_type = "program"
    else:
        content_type = "dizi"

    slug = url.rstrip('/').split('/')[-1]

    # Başlıklar
    title_el = soup.find('h1')
    title = title_el.get_text(strip=True) if title_el else slug.replace('-', ' ').title()
    orig_el = soup.find('h2')
    native_title = orig_el.get_text(strip=True) if orig_el else ""

    # Afiş Görseli CDN
    cover_div = soup.find('div', class_='media-cover')
    cover_image = cover_div.get('data-src') if cover_div else None

    # Ülke
    country_code = None
    country_flag = soup.find('span', class_=lambda c: c and 'flag-icon-' in c)
    if country_flag:
        for c in country_flag.get('class', []):
            if c.startswith('flag-icon-'):
                country_code = c.replace('flag-icon-', '')
                break
    country_name = COUNTRY_MAP.get(country_code, "")

    # Türler / Kategoriler
    categories = [a.get_text(strip=True) for a in soup.select('.categories a')]

    # Öznitelikler (Yıl, Bölüm sayısı, Durum vb.)
    meta_info = {}
    for attr_box in soup.find_all('div', class_='featured-attr'):
        key_el = attr_box.find('div', class_='attr')
        val_el = attr_box.find('div', class_='text')
        if key_el and val_el:
            meta_info[key_el.get_text(strip=True)] = val_el.get_text(strip=True)

    release_year = meta_info.get("Yayın yılı", "")
    episode_count = meta_info.get("Bölüm sayısı", "")
    status_broadcast = meta_info.get("Yayın durumu", "")
    status_translation = meta_info.get("Çeviri durumu", "")

    # Konu / Açıklama
    overview_el = soup.find('div', class_='text-content')
    overview = overview_el.get_text(strip=True) if overview_el else ""

    # Etiketler & Alternatif Adlar
    tags = [div.get_text(strip=True) for div in soup.select('.tags div')]

    # Oyuncular (Ad, Rol, Profil linki, Fotoğraf)
    actors = []
    seen_actor_urls = set()
    for a_tag in soup.find_all('a', class_='list-trailer'):
        if '/oyuncu/' not in a_tag.get('href', ''):
            continue
        actor_url = a_tag['href']
        if actor_url in seen_actor_urls:
            continue
        seen_actor_urls.add(actor_url)

        name_div = a_tag.find('div', class_='list-title')
        char_div = a_tag.find('div', class_='list-description')
        img_div = a_tag.find('div', class_='media')

        actor_name = name_div.get_text(strip=True) if name_div else a_tag.get_text(strip=True)
        char_name = char_div.get_text(strip=True) if char_div else ""
        actor_img = img_div.get('data-src') if img_div else None
        actor_slug = actor_url.rstrip('/').split('/')[-1]

        actors.append({
            "slug": actor_slug,
            "name": actor_name,
            "character_name": char_name,
            "profile_url": actor_url,
            "image_url": actor_img
        })

    # Bölümler ve Kaynaklar
    episodes = []
    ep_links = soup.find_all('a', href=lambda h: h and ('-bolum' in h))
    if ep_links:
        seen_ep_urls = set()
        for ep_a in ep_links:
            ep_url = ep_a['href']
            if ep_url in seen_ep_urls:
                continue
            seen_ep_urls.add(ep_url)
            # Bölüm adı iki ayrı div'dedir: .episode ("2. Bölüm") ve
            # .name ("Final" rozeti vb.). get_text() ikisini yapıştırıp
            # "2. BölümFinal" ürettiği için ayrı ayrı okunur.
            ep_block = ep_a.find('div', class_='episode')
            ep_suffix = ep_a.find('div', class_='name')
            ep_main = ep_block.get_text(strip=True) if ep_block else ""
            ep_extra = ep_suffix.get_text(strip=True) if ep_suffix else ""
            # "Tüm Bölümler" rozeti site navigasyonudur, bölüm adı değildir.
            if ep_extra.lower() in ("tüm bölümler", "tum bolumler"):
                ep_extra = ""
            if ep_main and ep_extra and ep_extra.lower() not in ep_main.lower():
                ep_name = f"{ep_main} {ep_extra}"
            else:
                ep_name = ep_main or ep_a.get_text(strip=True)

            season_num = 1
            m_s = re.search(r'(\d+)-sezon', ep_url)
            if m_s:
                season_num = int(m_s.group(1))

            ep_num = 1
            m_e = re.search(r'(\d+)-bolum', ep_url)
            if m_e:
                ep_num = int(m_e.group(1))

            ep_type = 'bolum'
            if 'ova' in ep_name.lower():
                ep_type = 'ova'
            elif 'special' in ep_name.lower():
                ep_type = 'special'

            episodes.append({
                "season_number": season_num,
                "episode_number": ep_num,
                "episode_name": ep_name,
                "episode_url": ep_url,
                "episode_type": ep_type,
                "sources": []
            })
    elif content_type == "film":
        movie_sources = []
        for btn in soup.find_all(attrs={'data-embed': True}):
            embed_id = btn.get('data-embed')
            if embed_id:
                s_name = btn.find('span', class_='name')
                s_name_txt = s_name.get_text(strip=True) if s_name else btn.get_text(strip=True)
                s_name_txt = s_name_txt.replace("Kaynak:", "").strip()
                movie_sources.append({
                    "source_name": s_name_txt,
                    "embed_id": embed_id,
                    "ajax_url": f"https://webdramaturkey2.com/ajax/embed (POST: id={embed_id})"
                })
        episodes.append({
            "season_number": 1,
            "episode_number": 1,
            "episode_name": "Film",
            "episode_url": url,
            "episode_type": "film",
            "sources": movie_sources
        })

    return {
        "slug": slug,
        "content_type": content_type,
        "title": title,
        "native_title": native_title,
        "source_url": url,
        "cover_image": cover_image,
        "country": country_code,
        "country_name": country_name,
        "release_year": release_year,
        "episode_count": episode_count,
        "status_broadcast": status_broadcast,
        "status_translation": status_translation,
        "overview": overview,
        "categories": json.dumps(categories, ensure_ascii=False),
        "tags": json.dumps(tags, ensure_ascii=False),
        "actors": actors,
        "episodes": episodes
    }

def save_drama_to_db(conn, drama_data):
    """Ayrıştırılan yapım ve bağlı verileri SQLite veritabanına kaydeder."""
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO dramas (
        slug, content_type, title, native_title, source_url, mydramalist_url, anilist_url, anilist_id,
        cover_image, country, country_name, release_year, episode_count,
        status_broadcast, status_translation, overview, categories, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_url) DO UPDATE SET
        content_type=excluded.content_type,
        title=excluded.title,
        native_title=COALESCE(NULLIF(excluded.native_title, ''), dramas.native_title),
        mydramalist_url=COALESCE(excluded.mydramalist_url, dramas.mydramalist_url),
        cover_image=COALESCE(NULLIF(excluded.cover_image, ''), dramas.cover_image),
        country=excluded.country,
        country_name=excluded.country_name,
        release_year=excluded.release_year,
        episode_count=excluded.episode_count,
        status_broadcast=excluded.status_broadcast,
        status_translation=excluded.status_translation,
        overview=COALESCE(NULLIF(excluded.overview, ''), dramas.overview),
        categories=excluded.categories,
        tags=excluded.tags,
        anilist_url=COALESCE(excluded.anilist_url, dramas.anilist_url),
        anilist_id=COALESCE(excluded.anilist_id, dramas.anilist_id),
        updated_at=CURRENT_TIMESTAMP
    """, (
        drama_data["slug"],
        drama_data["content_type"],
        drama_data["title"],
        drama_data["native_title"],
        drama_data["source_url"],
        drama_data.get("mydramalist_url"),
        drama_data.get("anilist_url"),
        drama_data.get("anilist_id"),
        drama_data["cover_image"],
        drama_data["country"],
        drama_data["country_name"],
        drama_data["release_year"],
        drama_data["episode_count"],
        drama_data["status_broadcast"],
        drama_data["status_translation"],
        drama_data["overview"],
        drama_data["categories"],
        drama_data["tags"]
    ))

    cursor.execute("SELECT id FROM dramas WHERE source_url = ?", (drama_data["source_url"],))
    drama_id = cursor.fetchone()[0]

    # Oyuncular
    for act in drama_data["actors"]:
        cursor.execute("""
        INSERT INTO actors (slug, name, profile_url, image_url)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_url) DO UPDATE SET
            image_url=COALESCE(excluded.image_url, actors.image_url),
            name=excluded.name
        """, (act["slug"], act["name"], act["profile_url"], act.get("image_url")))

        cursor.execute("SELECT id FROM actors WHERE profile_url = ?", (act["profile_url"],))
        act_row = cursor.fetchone()
        if act_row:
            actor_id = act_row[0]
            cursor.execute("""
            INSERT INTO drama_actors (drama_id, actor_id, character_name)
            VALUES (?, ?, ?)
            ON CONFLICT(drama_id, actor_id) DO UPDATE SET
                character_name=excluded.character_name
            """, (drama_id, actor_id, act.get("character_name", "")))

    # Bölümler
    for ep in drama_data["episodes"]:
        cursor.execute("""
        INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_url) DO UPDATE SET
            season_number=excluded.season_number,
            episode_number=excluded.episode_number,
            episode_name=excluded.episode_name,
            episode_type=excluded.episode_type
        """, (
            drama_id,
            ep["season_number"],
            ep["episode_number"],
            ep["episode_name"],
            ep["episode_url"],
            ep.get("episode_type", "bolum")
        ))

        # Film ise veya kaynakları varsa kaydet
        if ep.get("sources"):
            cursor.execute("SELECT id FROM episodes WHERE episode_url = ?", (ep["episode_url"],))
            ep_row = cursor.fetchone()
            if ep_row:
                ep_id = ep_row[0]
                save_episode_sources_to_db(conn, ep_id, ep["sources"])

    conn.commit()
    return drama_id

def parse_episode_sources(html):
    """Bölüm sayfasındaki video kaynak butonlarını ayrıştırır."""
    soup = BeautifulSoup(html, 'html.parser')
    sources = []
    seen_embeds = set()
    btn_sources = soup.find_all('button', class_=lambda c: c and 'dropdown-source' in c)
    for btn in btn_sources:
        name_el = btn.find('span', class_='name')
        name = name_el.get_text(strip=True) if name_el else btn.get_text(strip=True)
        name = name.replace("Kaynak:", "").strip()
        embed_id = btn.get('data-embed')
        # Not: WebDrama bölüm sayfalarında fansub bilgisi YOKTUR (sadece
        # "Türkçe Altyazı" dil etiketi var). fansub yalnızca TurkAnime
        # birleştirmesinden gelen anime kaynaklarında mevcuttur; bu yüzden
        # burada None bırakılır ve export'taki null değer doğrudur.
        if embed_id and embed_id not in seen_embeds:
            seen_embeds.add(embed_id)
            sources.append({
                "source_name": name,
                "embed_id": embed_id,
                "ajax_url": f"https://webdramaturkey2.com/ajax/embed (POST: id={embed_id})",
                "fansub": None
            })
    return sources

def save_episode_sources_to_db(conn, episode_id, sources):
    """Bölümün video kaynaklarını SQLite'a kaydeder."""
    cursor = conn.cursor()
    for s in sources:
        cursor.execute("""
        INSERT INTO episode_sources (episode_id, source_name, embed_id, ajax_embed_url, direct_url, provider, fansub)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id, embed_id) DO UPDATE SET
            source_name=excluded.source_name,
            ajax_embed_url=COALESCE(excluded.ajax_embed_url, episode_sources.ajax_embed_url),
            direct_url=COALESCE(excluded.direct_url, episode_sources.direct_url),
            provider=COALESCE(excluded.provider, episode_sources.provider),
            fansub=COALESCE(excluded.fansub, episode_sources.fansub)
        """, (
            episode_id,
            s["source_name"],
            s["embed_id"],
            s.get("ajax_url") or f"https://webdramaturkey2.com/ajax/embed (POST: id={s['embed_id']})",
            s.get("direct_url"),
            s.get("provider"),
            s.get("fansub")
        ))
    
    cursor.execute("UPDATE episodes SET sources_scraped = 1 WHERE id = ?", (episode_id,))
    conn.commit()

async def run_archive_pipeline(limit=None, batch_size=25, content_type=None, fetch_episode_sources=False, resolve_actors=True, refresh=False):
    """Tüm arşivi sırayla ve güvenli şekilde indiren ana akış."""
    init_db()
    conn = get_connection()
    cursor = conn.cursor()

    print("=" * 60)
    print("🚀 WebDramaTurkey Arşivleme Süreci Başlatılıyor...")
    print("=" * 60)

    cursor.execute("SELECT source_url, mydramalist_url, anilist_url FROM dramas")
    existing_rows = {row[0]: {"mydramalist_url": row[1], "anilist_url": row[2]} for row in cursor.fetchall()}
    print(f"📦 Veritabanında kayıtlı mevcut yapım sayısı: {len(existing_rows)}")

    print("📡 Sitemap taranıyor...")
    all_urls = fetch_sitemap_drama_urls(content_type=content_type)
    print(f"🎯 Sitemap'te {len(all_urls)} yapım URL'si bulundu (Filtre: {content_type or 'hepsi'}).")

    if refresh:
        # Baştan tazeleme: mevcut kayıtlar da yeniden çekilip güncellenir
        # (karakter adları, bölüm isimleri, eksik alanlar düzelir).
        urls_to_scrape = all_urls
    else:
        urls_to_scrape = [u for u in all_urls if u not in existing_rows]
    if limit:
        urls_to_scrape = urls_to_scrape[:limit]

    print(f"⚡ Taranacak yapım sayısı: {len(urls_to_scrape)} (refresh={refresh})")

    semaphore = asyncio.Semaphore(12)
    connector = aiohttp.TCPConnector(limit=25, ssl=False)

    total_scraped = len(existing_rows)
    start_time = time.time()

    async with aiohttp.ClientSession(connector=connector) as session:
        for i in range(0, len(urls_to_scrape), batch_size):
            chunk = urls_to_scrape[i:i + batch_size]
            tasks = [fetch_html_async(session, u, semaphore) for u in chunk]
            html_results = await asyncio.gather(*tasks)

            for url, html in zip(chunk, html_results):
                if not html:
                    continue
                try:
                    drama_data = parse_drama_page(url, html)
                    # Anime ise AniList, dizi/film/program ise MyDramaList eşleştir
                    # (zaten eşleşmiş kayıtları tekrar sorgulama).
                    already = existing_rows.get(url, {})
                    if drama_data["content_type"] == "anime":
                        if not already.get("anilist_url"):
                            al = search_anilist_with_cache(drama_data["title"], drama_data["slug"])
                            if al:
                                drama_data["anilist_url"] = al.get("siteUrl")
                                drama_data["anilist_id"] = al.get("id")
                                if not drama_data.get("native_title") and al.get("title", {}).get("native"):
                                    drama_data["native_title"] = al["title"]["native"]
                    else:
                        if not already.get("mydramalist_url"):
                            drama_data["mydramalist_url"] = get_mdl_drama_link(drama_data["title"])

                    save_drama_to_db(conn, drama_data)
                    total_scraped += 1
                except Exception as e:
                    print(f"Hata ({url}): {e}")

            elapsed = time.time() - start_time
            rate = (i + len(chunk)) / elapsed if elapsed > 0 else 0
            print(f"✅ İlerleme: {total_scraped} / {len(all_urls)} yapım tamamlandı. ({rate:.1f} kayıt/sn)")

    print("\n🎉 Yapım künyesi ve bölüm listeleri taraması tamamlandı!")
    conn.close()

    if fetch_episode_sources:
        print("\n🎬 Bölüm video oynatıcı kaynakları taranıyor...")
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, episode_url FROM episodes WHERE sources_scraped = 0")
        unscraped_eps = cursor.fetchall()
        print(f"Toplam kaynak taranacak bölüm: {len(unscraped_eps)}")

        # İlk oturum connector'ı kapattığı için ikinci faza yeni connector gerekir.
        connector2 = aiohttp.TCPConnector(limit=25, ssl=False)
        async with aiohttp.ClientSession(connector=connector2) as session:
            for i in range(0, len(unscraped_eps), batch_size):
                chunk = unscraped_eps[i:i + batch_size]
                tasks = [fetch_html_async(session, ep["episode_url"], semaphore) for ep in chunk]
                html_results = await asyncio.gather(*tasks)

                for ep, html in zip(chunk, html_results):
                    if not html:
                        continue
                    sources = parse_episode_sources(html)
                    save_episode_sources_to_db(conn, ep["id"], sources)

                print(f"🎥 Bölüm kaynakları: {min(i + batch_size, len(unscraped_eps))} / {len(unscraped_eps)} bölüm işlendi.")
        conn.close()

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="WebDrama & Anime Arşiv Motoru")
    parser.add_argument("--type", choices=["all", "dizi", "film", "anime", "program"], default=None, help="Taranacak içerik türü")
    parser.add_argument("--limit", type=int, default=None, help="Taranacak maksimum kayıt sayısı")
    parser.add_argument("--sources", action="store_true", help="Bölüm video kaynaklarını da tara")
    parser.add_argument("--refresh", action="store_true", help="Mevcut kayıtları da baştan çekip güncelle")
    parser.add_argument("--sync-anilist", action="store_true", help="Tüm animeleri AniList ile senkronize et")
    args = parser.parse_args()

    if args.sync_anilist:
        sync_all_webdrama_anime()
    else:
        asyncio.run(run_archive_pipeline(limit=args.limit, content_type=args.type, fetch_episode_sources=args.sources, refresh=args.refresh))
