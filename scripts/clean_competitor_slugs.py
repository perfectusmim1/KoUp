import json
import os
import re
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request

DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")


def clean_slug(s: str) -> str:
    if not s:
        return ""
    s = str(s).strip()
    s = re.sub(r"-animecix-\d+", "", s, flags=re.I)
    s = re.sub(r"-animecix\b", "", s, flags=re.I)
    s = re.sub(r"-asyaanimeleri\b", "", s, flags=re.I)
    s = re.sub(r"-{2,}", "-", s)
    return s.strip("-")


def main():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    cur = conn.cursor()

    rows = cur.execute("""
        SELECT id, slug, title
        FROM dramas
        WHERE slug LIKE '%animecix%' OR slug LIKE '%asyaanimeleri%'
    """).fetchall()

    print(f"Toplam {len(rows)} yapımdaki rakip site uzantıları temizleniyor...", flush=True)

    updates = []
    for did, slug, title in rows:
        cs = clean_slug(slug)
        # Avoid collision
        existing = cur.execute("SELECT id FROM dramas WHERE slug=? AND id != ?", (cs, did)).fetchone()
        final_slug = f"{cs}-{did}" if existing else cs
        updates.append((final_slug, slug, did))

    # Apply to SQLite
    cur.executemany("UPDATE dramas SET slug = ? WHERE id = ?", [(u[0], u[2]) for u in updates])
    conn.commit()
    print(f"[SQLite] {len(updates)} yapımın slug değeri güncellendi.", flush=True)

    # Sync to Supabase in chunks
    print("[Supabase] media tablosu güncelleniyor (slug + aka_titles koruması)...", flush=True)
    sb_errors = 0
    for final_slug, old_slug, did in updates:
        try:
            # Fetch existing aka_titles
            media_row = sb_request("GET", f"/rest/v1/media?id=eq.{did}&select=aka_titles")
            existing_aka = []
            if isinstance(media_row, list) and media_row and media_row[0].get("aka_titles"):
                existing_aka = list(media_row[0]["aka_titles"])
            if old_slug not in existing_aka:
                existing_aka.append(old_slug)

            sb_request("PATCH", f"/rest/v1/media?id=eq.{did}", body={
                "slug": final_slug,
                "aka_titles": existing_aka,
            })
        except Exception as e:
            sb_errors += 1
            if sb_errors < 5:
                print(f"  [Supabase Warning] #{did}: {e}", flush=True)

    print(f"[Supabase] Güncelleme tamamlandı (Hatalar: {sb_errors}).", flush=True)

    # Update local R2 bundles if they exist
    r2_sources_dir = os.path.join(_ROOT, "r2_bundles", "sources")
    if os.path.exists(r2_sources_dir):
        b_count = 0
        for final_slug, old_slug, did in updates:
            b_path = os.path.join(r2_sources_dir, f"{did}.json")
            if os.path.exists(b_path):
                try:
                    with open(b_path, "r", encoding="utf-8") as f:
                        bundle = json.load(f)
                    if "drama" in bundle:
                        bundle["drama"]["slug"] = final_slug
                    with open(b_path, "w", encoding="utf-8") as f:
                        json.dump(bundle, f, ensure_ascii=False, separators=(",", ":"))
                    b_count += 1
                except Exception:
                    pass
        print(f"[R2 Bundles] {b_count} yerel bundle dosyası yeni slug ile güncellendi.", flush=True)

    conn.close()
    print("[Başarılı] Tüm rakip site slugları temizlendi!", flush=True)


if __name__ == "__main__":
    main()
