"""
WebDrama Arşiv Kaynak Çözücü (Direct Stream Resolver)
Tüm embed_id'leri doğrudan sağlayıcı URL'lerine (ok.ru, vidmoly, filemoon vb.)
çevirerek webdramaturkey köprüsünü tamamen ortadan kaldırır.
curl_cffi (Chrome TLS impersonation), bölüm Referer/çerezleri ve akıllı önceliklendirme ile çalışır.
"""

import sys, os
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import sys
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
import os
import re
import time
import sqlite3
import threading as _threading
from bs4 import BeautifulSoup
from curl_cffi import requests as cfr
from database import DB_PATH

_SESSIONS = {}
_SESSIONS_LOCK = _threading.Lock()

def _get_session():
    """Şerit başına kalıcı curl_cffi oturumu: çerezleri taşır, Chrome TLS taklidi yapar."""
    tid = _threading.get_ident()
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(tid)
    if s is None:
        s = cfr.Session(impersonate='chrome')
        s.headers.update({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        })
        with _SESSIONS_LOCK:
            _SESSIONS[tid] = s
    return s

def _reset_session():
    """Mevcut thread oturumunu kapatır ve temizler (cooldown sonrası temiz başlangıç)."""
    tid = _threading.get_ident()
    with _SESSIONS_LOCK:
        s = _SESSIONS.pop(tid, None)
    if s:
        try:
            s.close()
        except Exception:
            pass

def identify_provider(url):
    """Oynatıcı sağlayıcısını standartlaştırır (merge_turkanime ile aynı liste)."""
    if not url:
        return 'unknown'
    u = url.lower()
    if 'ok.ru' in u or 'odnoklassniki' in u:
        return 'ok.ru'
    if 'sibnet.ru' in u or 'sibnet' in u:
        return 'sibnet'
    if 'mail.ru' in u:
        return 'mail.ru'
    if 'mp4upload' in u:
        return 'mp4upload'
    if 'drive.google' in u or 'google.' in u:
        return 'gdrive'
    if 'vidmoly' in u:
        return 'vidmoly'
    if 'filemoon' in u or 'bysesukior' in u or 'bysedikamoum' in u:
        return 'filemoon'
    if 'playerdkorea' in u or 'pichive' in u:
        return 'playerdkorea'
    if 'abstream' in u:
        return 'abstream'
    if 'abyss' in u or 'short.icu' in u or 'abyssplayer' in u:
        return 'abyss'
    if 'playerp2p' in u or 'streamp2p' in u:
        return 'playerp2p'
    if 'upns' in u:
        return 'upns'
    if 'vk.com' in u or '/video_ext.php' in u:
        return 'vk'
    if 'voe.sx' in u or 'voe-network' in u:
        return 'voe'
    if 'dood' in u:
        return 'doodstream'
    if 'uqload' in u:
        return 'uqload'
    if 'sendvid' in u:
        return 'sendvid'
    if 'streamwish' in u or 'ghbrisk' in u or 'embedwish' in u:
        return 'streamwish'
    if 'streamvid' in u:
        return 'streamvid'
    if 'dailymotion' in u or 'dailym' in u:
        return 'dailymotion'
    if 'mega.nz' in u or 'mega.' in u:
        return 'mega'
    if 'yourupload' in u:
        return 'yourupload'
    if 'vidhide' in u:
        return 'vidhide'
    if 'cloudvideo' in u:
        return 'cloudvideo'
    if 'wolfstream' in u:
        return 'wolfstream'
    if 'vtube' in u:
        return 'vtube'
    if 'tubeload' in u:
        return 'tubeload'
    if 'savefileway' in u:
        return 'savefileway'
    if 'embedo' in u:
        return 'embedo'
    if 'embedgram' in u:
        return 'embedgram'
    if 'highload' in u:
        return 'highload'
    if 'mvidoo' in u:
        return 'mvidoo'
    if 'vudeo' in u or 'vudea' in u:
        return 'vudeo'
    if 'dzyedge' in u:
        return 'dzyedge'
    if 'uns.bio' in u:
        return 'diziasya'
    if 'rpmplay' in u:
        return 'rpmplay'
    if 'morencius' in u:
        return 'morencius'
    if 'luluvido' in u or 'luluvdo' in u:
        return 'luluvdo'
    if 'filelions' in u or 'filemoon' in u:
        return 'filemoon'
    if 'tau-video' in u or 'tauvideo' in u:
        return 'tau-video'
    if 'diziyou' in u or '.m3u8' in u:
        return 'diziyou-hls'
    return 'other'

def resolve_tau_video_mp4(embed_url, session=None):
    """Tau-Video embed URL'sinden (tau-video.xyz/embed/{key}) dogrudan 1080p/720p MP4 akislarini cikarir."""
    if not embed_url or 'tau-video' not in embed_url.lower():
        return None
    m = re.search(r'tau-video\.xyz/(?:embed/|api/video/)?([a-zA-Z0-9_-]{16,64})', embed_url, re.IGNORECASE)
    if not m:
        return None
    vid_key = m.group(1)
    s = session or _get_session()
    try:
        resp = s.get(
            f"https://tau-video.xyz/api/video/{vid_key}",
            headers={'Referer': f"https://tau-video.xyz/embed/{vid_key}", 'Accept': 'application/json'},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            urls = data.get('urls') or []
            if urls:
                # 1080p > 720p > 480p siralamasi
                urls_sorted = sorted(urls, key=lambda x: x.get('size', 0), reverse=True)
                return {
                    'best_url': urls_sorted[0].get('url'),
                    'qualities': [{'label': u.get('label', '720p'), 'url': u.get('url')} for u in urls_sorted if u.get('url')]
                }
    except Exception:
        pass
    return None

def _spam_wait_seconds(text):
    """Spam duvarındaki 'X dakika / saniye sonra' süresini saniyeye çevirir (+30 sn tampon)."""
    if not text:
        return 660
    m_min = re.search(r'(\d+)\s*dakika', text, re.IGNORECASE)
    if m_min:
        return int(m_min.group(1)) * 60 + 30
    m_sec = re.search(r'(\d+)\s*saniye', text, re.IGNORECASE)
    if m_sec:
        return int(m_sec.group(1)) + 15
    return 660

def resolve_single_embed(embed_id, episode_url=None, session=None):
    """
    webdramaturkey2 embed_id -> Doğrudan Sağlayıcı URL'si
    curl_cffi.Session ve bölüm Referer/çerezleri taklit ederek çalışır.
    Dönen değerler: (direct_url, provider, status, wait_seconds)
    status: 'ok', 'cooldown', 'dead', 'error'
    'error' = geçici hata (sonraki çalıştırmada tekrar denenecek);
    'dead'  = sitenin açıkça kapalı/hatalı işaretlediği kaynak.
    """
    if session is None:
        session = _get_session()

    try:
        # 1. Bölüm sayfasını ziyaret et (oturum çerezleri ve Referer için)
        if episode_url:
            last_url = getattr(session, '_last_episode_url', None)
            if last_url != episode_url:
                try:
                    session.get(
                        episode_url,
                        headers={'Referer': 'https://webdramaturkey2.com/'},
                        timeout=15
                    )
                    session._last_episode_url = episode_url
                except Exception:
                    pass

        # 2. ajax/embed POST isteği
        post_headers = {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': episode_url or 'https://webdramaturkey2.com/',
            'Origin': 'https://webdramaturkey2.com'
        }

        resp = session.post(
            'https://webdramaturkey2.com/ajax/embed',
            data={'id': str(embed_id)},
            headers=post_headers,
            timeout=12
        )

        raw_bytes = resp.content
        try:
            text = raw_bytes.decode('iso-8859-9')
        except Exception:
            text = raw_bytes.decode('utf-8', errors='replace')

        # ÖNCELİK 1: Spam / Cooldown kontrolü (embed-lock kontrolünden önce yapılmalı!)
        is_spam = (
            "Spam" in text or
            "çok fazla istek" in text or
            "cok fazla istek" in text or
            "dakika sonra" in text or
            "saniye sonra" in text
        )
        if is_spam:
            wait_s = _spam_wait_seconds(text)
            return None, None, 'cooldown', wait_s

        # ÖNCELİK 2: Açıkça ölü / kilitli kaynaklar
        if "embed-lock" in text:
            return None, None, 'dead', 0

        if "Hata" in text or "Bulunamadı" in text or "bulunamadı" in text:
            return None, None, 'dead', 0

        m = re.search(r'src=["\']([^"\']+)["\']', text)
        if not m:
            return None, None, 'error', 0

        video_php_url = m.group(1).strip()
        if video_php_url.startswith('/'):
            video_php_url = 'https://webdramaturkey2.com' + video_php_url

        # 3. video.php GET isteği
        try:
            v_resp = session.get(
                video_php_url,
                headers={'Referer': episode_url or 'https://webdramaturkey2.com/'},
                timeout=12
            )
            v_raw = v_resp.content
            try:
                v_text = v_raw.decode('iso-8859-9')
            except Exception:
                v_text = v_raw.decode('utf-8', errors='replace')
        except Exception:
            return None, None, 'error', 0

        if "Spam" in v_text and ("dakika sonra" in v_text or "saniye sonra" in v_text or "fazla istek" in v_text):
            return None, None, 'cooldown', _spam_wait_seconds(v_text)

        if not v_text or len(v_text) < 300:
            return None, None, 'error', 0

        soup = BeautifulSoup(v_text, 'html.parser')
        iframe = soup.find('iframe', id='main-iframe') or soup.find('iframe')
        real_url = None
        if iframe and iframe.get('src'):
            real_url = iframe.get('src').strip()
        else:
            im = re.search(r'<iframe[^>]+src=["\']([^"\']+)["\']', v_text)
            if im:
                real_url = im.group(1).strip()

        if not real_url:
            return None, None, 'dead', 0

        # 4. Odnoklassniki / Bulgu.net tünelini resmi ok.ru linkine çevir
        if 'bulgu.net/ok/e/' in real_url:
            try:
                b_resp = session.get(real_url, headers={'Referer': episode_url or 'https://webdramaturkey2.com/'}, timeout=10)
                qm = re.search(r'/ok/redirect\?v=([a-zA-Z0-9]+)', b_resp.text)
                if qm:
                    redir_url = f"https://bulgu.net/ok/redirect?v={qm.group(1)}"
                    r_resp = session.get(
                        redir_url,
                        headers={'Referer': 'https://bulgu.net/'},
                        allow_redirects=False,
                        timeout=10
                    )
                    loc = r_resp.headers.get('Location', '')
                    id_m = re.search(r'id=(\d+)', loc)
                    if id_m:
                        real_url = f"https://ok.ru/videoembed/{id_m.group(1)}"
            except Exception:
                pass

        provider = identify_provider(real_url)
        return real_url, provider, 'ok', 0

    except Exception:
        return None, None, 'error', 0

def run_resolver(delay=5.0, max_items=None, retry_dead=False, workers=1, priority_mode=True):
    """
    Tüm çözülmemiş kaynakları güvenli bir şekilde tek tek veya şeritli çözer.
    priority_mode=True: Her bölüm için WDT > VK > Odnoklassniki > Moly öncelikli tek bir çalışan
    kaynak çözer; böylece 178K istek yerine sadece ~31K istekte tüm arşiv izlenebilir hale gelir.
    """
    from concurrent.futures import ThreadPoolExecutor
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    if priority_mode:
        print("🎯 [Öncelik Modu Aktif]: WDT > VK > Odnoklassniki > Moly sıralamasıyla")
        print("   Her bölüm için en kaliteli İLK çalışan kaynak çözülecek, gereksiz yedek aynalar atlanacak.")
        query = """
            WITH UnresolvedEpisodes AS (
                SELECT id, episode_url FROM episodes 
                WHERE id NOT IN (
                    SELECT DISTINCT episode_id FROM episode_sources 
                    WHERE direct_url IS NOT NULL AND direct_url != 'dead'
                )
                AND id IN (
                    SELECT DISTINCT episode_id FROM episode_sources
                )
            ),
            RankedSources AS (
                SELECT 
                    s.id,
                    s.episode_id,
                    s.source_name,
                    s.embed_id,
                    ue.episode_url,
                    ROW_NUMBER() OVER (
                        PARTITION BY s.episode_id 
                        ORDER BY 
                            CASE 
                                WHEN UPPER(s.source_name) LIKE '%WDT%' THEN 1
                                WHEN UPPER(s.source_name) LIKE '%VK%' THEN 2
                                WHEN UPPER(s.source_name) LIKE '%ODNOK%' OR UPPER(s.source_name) LIKE '%OKRU%' THEN 3
                                WHEN UPPER(s.source_name) LIKE '%MOLY%' THEN 4
                                WHEN UPPER(s.source_name) LIKE '%MOON%' THEN 5
                                WHEN UPPER(s.source_name) LIKE '%UPN%' THEN 6
                                WHEN UPPER(s.source_name) LIKE '%ABYSS%' THEN 7
                                WHEN UPPER(s.source_name) LIKE '%ABSTREAM%' THEN 8
                                ELSE 9
                            END ASC,
                            s.id ASC
                    ) as rank
                FROM episode_sources s
                JOIN UnresolvedEpisodes ue ON s.episode_id = ue.id
                WHERE s.direct_url IS NULL
            )
            SELECT s.id, s.embed_id, s.source_name, s.episode_url, s.episode_id, s.rank
            FROM RankedSources s
            ORDER BY s.episode_id ASC, s.rank ASC
        """
    else:
        print("📋 [Tam Liste Modu]: Tüm alternatif aynalar tek tek çözülüyor...")
        if retry_dead:
            query = """
                SELECT s.id, s.embed_id, s.source_name, e.episode_url, s.episode_id, 1 as rank
                FROM episode_sources s 
                JOIN episodes e ON s.episode_id = e.id 
                WHERE s.direct_url IS NULL OR s.direct_url = 'dead' 
                ORDER BY s.episode_id ASC, s.id ASC
            """
        else:
            query = """
                SELECT s.id, s.embed_id, s.source_name, e.episode_url, s.episode_id, 1 as rank
                FROM episode_sources s 
                JOIN episodes e ON s.episode_id = e.id 
                WHERE s.direct_url IS NULL 
                ORDER BY s.episode_id ASC, s.id ASC
            """

    if max_items:
        query += f" LIMIT {max_items}"
    c.execute(query)
    sources = c.fetchall()
    conn.close()

    total = len(sources)
    if total == 0:
        print("✅ Tüm bölümler zaten doğrudan oynatılabilir kaynaklara sahip!")
        return

    print(f"🎬 Kuyrukta {total} aday kaynak bulundu.")
    print(f"⏱️ İstek aralığı: {delay}s | Şerit sayısı: {workers} | Motor: curl_cffi (Chrome)")
    print("=" * 60)

    counters = {"success": 0, "dead": 0, "done": 0, "skipped": 0}
    solved_episodes = set()
    lock = _threading.Lock()
    shared_pause_until = {"ts": 0.0}

    def wait_if_paused():
        last_reported = 0
        while True:
            with lock:
                remaining = shared_pause_until["ts"] - time.time()
            if remaining <= 0:
                return
            if time.time() - last_reported >= 60:
                mins = int(remaining // 60)
                secs = int(remaining % 60)
                print(f"⏳ Bekleniyor... Kalan ban süresi: {mins} dk {secs} sn")
                last_reported = time.time()
            time.sleep(min(remaining, 5))

    def worker(stripes, stripe_idx):
        w_conn = sqlite3.connect(DB_PATH, timeout=60)
        w_conn.execute("PRAGMA journal_mode=WAL;")
        w_cur = w_conn.cursor()
        session = _get_session()
        idx = stripe_idx
        while idx < total:
            s_id, embed_id, source_name, episode_url, ep_id, rank = sources[idx]

            # Eğer bu bölüm için zaten çalışan bir kaynak çözülmüşse yedekleri atla
            if priority_mode:
                with lock:
                    if ep_id in solved_episodes:
                        counters["skipped"] += 1
                        idx += stripes
                        continue

            wait_if_paused()

            direct_url, provider, status, wait_s = resolve_single_embed(
                embed_id, episode_url=episode_url, session=session
            )

            if status == 'cooldown':
                with lock:
                    shared_pause_until["ts"] = max(
                        shared_pause_until["ts"], time.time() + wait_s)
                    mins = wait_s // 60
                    secs = wait_s % 60
                    print(f"\n⏳ [Şerit {stripe_idx}] Spam koruması: {wait_s} sn ({mins} dk {secs} sn) TÜM şeritler duraklatıldı.")
                _reset_session()
                session = _get_session()
                continue  # Aynı öğeyi tekrar dene (duraklama bitince)

            if status == 'ok' and direct_url:
                w_cur.execute("""
                    UPDATE episode_sources
                    SET direct_url = ?, provider = ?
                    WHERE id = ?
                """, (direct_url, provider, s_id))
                w_cur.connection.commit()
                with lock:
                    counters["success"] += 1
                    if priority_mode:
                        solved_episodes.add(ep_id)
                    n_suc = counters["success"]
                    print(f"[{n_suc}] ✅ Bölüm #{ep_id} -> {source_name} ({provider}) çözüldü.")
            elif status == 'dead':
                w_cur.execute("""
                    UPDATE episode_sources
                    SET direct_url = 'dead', provider = 'dead'
                    WHERE id = ?
                """, (s_id,))
                w_cur.connection.commit()
                with lock:
                    counters["dead"] += 1
                    print(f"⚠️ ID {s_id} ({source_name}) kapalı/ölü. Varsa sonraki alternatif tercih denenecek.")
            elif status == 'error':
                pass

            with lock:
                counters["done"] += 1
                n = counters["done"]
            if n % 50 == 0:
                with lock:
                    print(f"📊 İlerleme: {counters['success']} bölüm tamamlandı, {counters['dead']} ölü kaynak, {counters['skipped']} ayna atlandı.")

            idx += stripes
            time.sleep(delay)

        w_conn.close()

    if workers < 2:
        worker(1, 0)
    else:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(lambda i: worker(workers, i), range(workers)))

    print("=" * 60)
    print(f"🎉 İşlem Tamamlandı! Başarıyla Çözülen Bölüm: {counters['success']}, Kapanmış/Ölü: {counters['dead']}, Atlanan Ayna: {counters['skipped']}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="WebDrama Doğrudan Kaynak Çözücü (curl_cffi & Akıllı Öncelik)")
    parser.add_argument("--delay", type=float, default=5.0, help="İstekler arası bekleme süresi (varsayılan: 5.0s)")
    parser.add_argument("--limit", type=int, default=None, help="İşlenecek maksimum kaynak sayısı")
    parser.add_argument("--retry-dead", action="store_true", help="Daha önce ölü işaretlenen kaynakları tekrar dene")
    parser.add_argument("--workers", type=int, default=1, help="Paralel şerit sayısı (varsayılan: 1)")
    parser.add_argument("--all-sources", action="store_true", help="Öncelikli mod yerine tüm alternatif aynaları tek tek çöz (178K kuyruk)")
    args = parser.parse_args()

    run_resolver(
        delay=args.delay,
        max_items=args.limit,
        retry_dead=args.retry_dead,
        workers=args.workers,
        priority_mode=not args.all_sources
    )
