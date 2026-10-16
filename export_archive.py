"""
KoUp Arşiv Dışa Aktarıcı (archive.json & eksikler.json)
Bu betik tamamen bağımsızdır; harici kütüphane veya paket gerektirmez.
webdrama_archive.db dosyasının yanına koyup 'python export_archive.py' diyerek çalıştırabilirsiniz.
"""
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")

def export_all():
    if not os.path.exists(DB_PATH):
        print(f"❌ HATA: '{DB_PATH}' bulunamadı! Lütfen webdrama_archive.db dosyasını bu betiğin yanına koyun.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    archive_file = os.path.join(BASE_DIR, "archive.json")
    eksikler_file = os.path.join(BASE_DIR, "eksikler.json")

    print("=" * 60)
    print("📦 ARCHIVE.JSON EXPORT BAŞLATILIYOR...")
    print("=" * 60)
    cur.execute("SELECT * FROM dramas ORDER BY id ASC")
    dramas = cur.fetchall()
    print(f"Toplam {len(dramas)} içerik işleniyor...")

    archive_list = []
    eksikler_list = []

    for idx, d in enumerate(dramas, 1):
        d_dict = dict(d)
        d_id = d_dict["id"]

        for f in ["categories", "tags", "alt_sites"]:
            try:
                d_dict[f] = json.loads(d_dict[f] or "[]")
            except Exception:
                d_dict[f] = []

        # Oyuncular
        cur.execute("""
            SELECT a.name, a.slug, a.profile_url, a.mydramalist_url, a.image_url, da.character_name
            FROM drama_actors da
            JOIN actors a ON a.id = da.actor_id
            WHERE da.drama_id = ?
        """, (d_id,))
        d_dict["actors"] = [dict(r) for r in cur.fetchall()]

        # Bölümler
        cur.execute("""
            SELECT id, season_number, episode_number, episode_name, episode_url, episode_type
            FROM episodes
            WHERE drama_id = ?
            ORDER BY season_number, episode_number
        """, (d_id,))
        episodes = []
        drama_missing_eps = []

        ctype = (d_dict.get("content_type") or "dizi").lower()
        if ctype == 'anime':
            order_clause = """
                ORDER BY 
                    CASE 
                        WHEN LOWER(provider) = 'tau-video' THEN 1
                        WHEN LOWER(provider) IN ('diziyou-hls', 'diziyou', 'hdfilm-hls') THEN 2
                        WHEN LOWER(provider) IN ('ok.ru', 'odnoklassniki', 'mail.ru', 'mail', 'vk', 'mega', 'dailymotion') THEN 3
                        WHEN LOWER(provider) IN ('vidmoly', 'filemoon', 'yourupload') THEN 4
                        WHEN LOWER(provider) IN ('sendvid', 'uqload', 'mp4upload', 'animpow', 'doodstream', 'voe', 'vudeo', 'mvidoo', 'savefileway', 'tubeload', 'embedo', 'clone') THEN 5
                        WHEN LOWER(provider) IN ('gdrive', 'googledrive') OR direct_url LIKE '%drive.google.com%' THEN 6
                        WHEN LOWER(provider) = 'sibnet' OR direct_url LIKE '%sibnet.ru%' THEN 7
                        ELSE 5
                    END ASC, id ASC
            """
        else:
            order_clause = """
                ORDER BY 
                    CASE 
                        WHEN LOWER(provider) IN ('diziyou-hls', 'diziyou', 'hdfilm-hls') THEN 1
                        WHEN LOWER(provider) = 'tau-video' THEN 2
                        WHEN LOWER(provider) IN ('ok.ru', 'odnoklassniki', 'mail.ru', 'mail', 'vk', 'mega', 'dailymotion') THEN 3
                        WHEN LOWER(provider) IN ('vidmoly', 'filemoon', 'yourupload', 'playerdkorea') THEN 4
                        WHEN LOWER(provider) IN ('sendvid', 'uqload', 'mp4upload', 'animpow', 'doodstream', 'voe', 'vudeo', 'mvidoo', 'savefileway', 'tubeload', 'embedo', 'clone') THEN 5
                        WHEN LOWER(provider) IN ('gdrive', 'googledrive') OR direct_url LIKE '%drive.google.com%' THEN 6
                        WHEN LOWER(provider) = 'sibnet' OR direct_url LIKE '%sibnet.ru%' THEN 7
                        ELSE 5
                    END ASC, id ASC
            """

        for ep in cur.fetchall():
            ep_dict = dict(ep)
            ep_id = ep_dict["id"]

            cur.execute(f"""
                SELECT source_name, embed_id, direct_url, provider, site, fansub
                FROM episode_sources
                WHERE episode_id = ? AND direct_url IS NOT NULL AND direct_url != 'dead'
                {order_clause}
            """, (ep_id,))
            sources = [dict(s) for s in cur.fetchall()]
            ep_dict["sources"] = sources
            episodes.append(ep_dict)

            if len(sources) == 0:
                drama_missing_eps.append({
                    "season": ep_dict["season_number"],
                    "number": ep_dict["episode_number"],
                    "name": ep_dict["episode_name"],
                    "url": ep_dict["episode_url"]
                })

        d_dict["episodes"] = episodes
        has_any_source = any(len(ep.get("sources", [])) > 0 for ep in episodes)

        if has_any_source:
            archive_list.append(d_dict)

        if len(episodes) == 0 or drama_missing_eps:
            eksikler_list.append({
                "drama_id": d_id,
                "title": d_dict["title"],
                "content_type": d_dict["content_type"],
                "source_url": d_dict["source_url"],
                "alt_sites": d_dict["alt_sites"],
                "missing_episodes_count": len(drama_missing_eps) if drama_missing_eps else 0,
                "total_episodes_count": len(episodes),
                "is_unreleased_or_empty": len(episodes) == 0,
                "missing_episodes": drama_missing_eps[:20]
            })

        if idx % 2000 == 0:
            print(f"  İşlenen: {idx}/{len(dramas)} içerik...")

    conn.close()

    print(f"💾 archive.json yazılıyor ({len(archive_list)} yapım)...")
    with open(archive_file, "w", encoding="utf-8") as f:
        json.dump(archive_list, f, ensure_ascii=False, indent=2)
    size_mb = os.path.getsize(archive_file) / (1024 * 1024)
    print(f"✅ archive.json tamamlandı! ({size_mb:.1f} MB)")

    print(f"💾 eksikler.json yazılıyor ({len(eksikler_list)} eksik içerikli yapım)...")
    with open(eksikler_file, "w", encoding="utf-8") as f:
        json.dump({
            "total_dramas": len(dramas),
            "dramas_with_missing_sources": len(eksikler_list),
            "missing_items": eksikler_list
        }, f, ensure_ascii=False, indent=2)
    print("✅ eksikler.json tamamlandı!")

if __name__ == '__main__':
    export_all()
