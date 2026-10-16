import os
import sys
import json
import time
import urllib.request
import urllib.parse
import sqlite3

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SUPABASE_URL = "https://aocvcotmikzlwbaezdpl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk"
TMDB_API_KEY = "4c092d2cfd6d9c0e3aa3dab12c7d4756"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")

def search_tmdb(query, content_type="dizi"):
    if not query or len(query.strip()) < 2:
        return None
    clean_q = query.strip()
    # Try TV first, then Movie, then multi
    endpoints = ["search/tv", "search/movie", "search/multi"] if content_type != "film" else ["search/movie", "search/tv", "search/multi"]
    for ep in endpoints:
        encoded = urllib.parse.quote_plus(clean_q)
        url = f"https://api.themoviedb.org/3/{ep}?query={encoded}&api_key={TMDB_API_KEY}&language=tr-TR"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = data.get("results", [])
                for r in results:
                    if r.get("poster_path") or r.get("backdrop_path"):
                        return r
        except Exception as e:
            pass
        time.sleep(0.05)
    return None

def main():
    print("🎬 KoUp Eksik Kapak ve Afiş Onarıcı Başlatılıyor...")

    # 1. Fetch series from Supabase with missing cover_image
    url = f"{SUPABASE_URL}/rest/v1/media?select=id,title,title_en,native_title,aka_titles,content_type,mydramalist_url,mdl_id,slug&or=(cover_image.is.null,cover_image.eq.)&order=id.asc"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    })

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            series_list = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"❌ Supabase'den seriler çekilemedi: {e}")
        return

    print(f"🔍 Kapağı eksik olan toplam {len(series_list)} seri bulundu.")

    fixed_count = 0
    conn = None
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
        except Exception:
            conn = None

    for idx, s in enumerate(series_list):
        sid = s["id"]
        title = s.get("title") or ""
        aka_titles = s.get("aka_titles") or []
        native_title = s.get("native_title") or ""
        title_en = s.get("title_en") or ""
        content_type = s.get("content_type") or "dizi"

        # Search candidates in priority
        candidates = [title]
        if title_en and title_en not in candidates:
            candidates.append(title_en)
        if aka_titles:
            for aka in aka_titles:
                if aka and aka not in candidates:
                    candidates.append(aka)
        if native_title and native_title not in candidates:
            candidates.append(native_title)

        tmdb_res = None
        for cand in candidates:
            tmdb_res = search_tmdb(cand, content_type)
            if tmdb_res:
                break

        if tmdb_res:
            poster_path = tmdb_res.get("poster_path")
            backdrop_path = tmdb_res.get("backdrop_path")
            tmdb_id = tmdb_res.get("id")

            poster_url = f"https://image.tmdb.org/t/p/w780{poster_path}" if poster_path else None
            backdrop_url = f"https://image.tmdb.org/t/p/original{backdrop_path}" if backdrop_path else (poster_url if poster_url else None)

            if not poster_url and backdrop_url:
                poster_url = backdrop_url

            if poster_url:
                rpc_body = {
                    "p_media_id": sid,
                    "p_cover_image": poster_url,
                    "p_backdrop_image": backdrop_url,
                    "p_tmdb_id": tmdb_id
                }

                # Call security definer RPC
                patch_url = f"{SUPABASE_URL}/rest/v1/rpc/patch_media_images"
                patch_req = urllib.request.Request(
                    patch_url,
                    data=json.dumps(rpc_body).encode("utf-8"),
                    headers={
                        "apikey": SUPABASE_KEY,
                        "Authorization": f"Bearer {SUPABASE_KEY}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )

                try:
                    with urllib.request.urlopen(patch_req, timeout=10) as presp:
                        fixed_count += 1
                        matched_name = tmdb_res.get("name") or tmdb_res.get("title") or title
                        print(f"  [{idx+1}/{len(series_list)}] ✅ Onarıldı: #{sid} {title} -> {matched_name} (TMDB ID: {tmdb_id})", flush=True)

                        # Also update local sqlite if available
                        if conn:
                            try:
                                conn.execute("""
                                    UPDATE dramas SET 
                                        cover_image = COALESCE(cover_image, ?),
                                        backdrop_image = COALESCE(backdrop_image, ?),
                                        tmdb_id = ?
                                    WHERE id = ?
                                """, (poster_url, backdrop_url, tmdb_id, sid))
                                conn.commit()
                            except Exception:
                                pass
                except Exception as pe:
                    print(f"  [{idx+1}/{len(series_list)}] ⚠️ Güncelleme hatası: {title} ({pe})")
            else:
                print(f"  [{idx+1}/{len(series_list)}] ℹ️ TMDB eşleşti ama afiş yok: {title}")
        else:
            print(f"  [{idx+1}/{len(series_list)}] ❌ Eşleşme bulunamadı: {title}")

    if conn:
        conn.close()

    print(f"\n🎉 Tamamlandı! {len(series_list)} seriden {fixed_count} tanesinin afiş ve kapak görselleri başarıyla onarıldı.")

if __name__ == "__main__":
    main()
