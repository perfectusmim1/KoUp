import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os, json, time, re, asyncio, aiohttp
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

db_path = os.path.join(_ROOT, "webdrama_archive.db")
BASE = "https://www.ddizi.tel"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
}

async def fetch_html(session, url, sem, referer=None):
    async with sem:
        h = dict(HEADERS)
        if referer:
            h['Referer'] = referer
        for _ in range(3):
            try:
                async with session.get(url, headers=h, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        raw = await resp.read()
                        return raw.decode('utf-8', errors='replace')
                    elif resp.status in (403, 429):
                        await asyncio.sleep(15)
            except Exception:
                await asyncio.sleep(0.5)
        return None

async def resolve_episode_yt(session, sem, ep_url):
    ep_html = await fetch_html(session, ep_url, sem)
    if not ep_html:
        return None
    
    # 1. Telif kontrolü
    yt_match = re.search(r'src=["\'](?:/player/telif/index\.php\?id=)?(https?://(?:www\.)?youtube\.com/watch\?v=[a-zA-Z0-9_\-]+|https?://youtu\.be/[a-zA-Z0-9_\-]+)["\']', ep_html)
    if yt_match:
        raw_yt = yt_match.group(1)
        v_id_match = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_\-]+)', raw_yt)
        if v_id_match:
            return v_id_match.group(1)

    # 2. JWPlayer oynatıcı kontrolü
    player_paths = re.findall(r'<iframe[^>]+src=["\'](/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
    if not player_paths:
        player_paths = re.findall(r'<iframe[^>]+src=["\'](https?://[^"\']*/player/oynat/[a-zA-Z0-9]+)["\']', ep_html)
    
    if player_paths:
        p_url = player_paths[0] if player_paths[0].startswith('http') else BASE + player_paths[0]
        p_html = await fetch_html(session, p_url, sem, referer=ep_url)
        if p_html:
            yt_thumb_match = re.search(r'https?://(?:i\d*\.)?ytimg\.com/vi/([a-zA-Z0-9_\-]+)/', p_html)
            if yt_thumb_match:
                return yt_thumb_match.group(1)

    return None

async def main():
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("""
        SELECT es.id, es.episode_id, e.episode_url, d.title, e.episode_number
        FROM episode_sources es
        JOIN episodes e ON es.episode_id = e.id
        JOIN dramas d ON e.drama_id = d.id
        WHERE es.direct_url LIKE '%googlevideo%' OR es.direct_url LIKE '%videoplayback%'
        ORDER BY es.id ASC
    """)
    rows = cur.fetchall()
    total = len(rows)
    print(f"🚀 Toplam {total} adet geçici GoogleVideo kaynağı kalıcı YouTube embed'ine dönüştürülüyor...")

    if total == 0:
        print("Tebrikler! Geçici GoogleVideo kaynağı bulunamadı, tüm kaynaklar kalıcı.")
        conn.close()
        return

    sem = asyncio.Semaphore(4)
    connector = aiohttp.TCPConnector(limit=6, ssl=False)
    
    fixed_count = 0
    t0 = time.time()

    async with aiohttp.ClientSession(connector=connector) as session:
        # Process in gentle batches of 8
        batch_size = 8
        for i in range(0, total, batch_size):
            batch = rows[i:i + batch_size]
            results = await asyncio.gather(*[
                resolve_episode_yt(session, sem, r[2]) for r in batch
            ])

            for (es_id, ep_id, ep_url, drama_title, ep_num), yt_id in zip(batch, results):
                if yt_id:
                    embed_url = f"https://www.youtube.com/embed/{yt_id}?autoplay=1&enablejsapi=1"
                    cur.execute("""
                        UPDATE episode_sources 
                        SET direct_url = ?, provider = 'youtube', source_name = 'YouTube HD'
                        WHERE id = ?
                    """, (embed_url, es_id))
                    fixed_count += 1
            
            conn.commit()
            elapsed = time.time() - t0
            progress = min(i + batch_size, total)
            rate = progress / max(1, elapsed)
            rem = int((total - progress) / max(0.1, rate))
            print(f"[{progress}/{total}] Yapıldı: {fixed_count} kaynak YouTube'a çevrildi | {elapsed:.1f}sn (Kalan: ~{rem}sn)", flush=True)
            await asyncio.sleep(0.3)

    conn.close()
    print(f"\n🎉 SQLite Dönüşümü Tamamlandı! Toplam {fixed_count}/{total} kaynak kalıcı YouTube HD olarak güncellendi.")

    # Otomatik Supabase Senkronizasyonu
    try:
        from scripts.sync_ddizi_to_supabase import sync_ddizi_media
        print("\n🔄 Supabase veritabanına senkronize ediliyor...", flush=True)
        sync_ddizi_media()
    except Exception as e:
        print(f"⚠️ Supabase senkronizasyon uyarısı: {e}")

if __name__ == '__main__':
    asyncio.run(main())
