import sqlite3
import sys
import json
import time
from collections import defaultdict

sys.path.insert(0, r"c:\Users\Cagan\Downloads\KoUp")
from scripts.source_scanner_engine import analyze_source_deadness

in_json = r"c:\Users\Cagan\Downloads\KoUp\scripts\reports\ayrintili_yapim_analizi_no_ddizi.json"
with open(in_json, "r", encoding="utf-8") as f:
    data = json.load(f)

cat4_dramas = data["hanging_by_thread"]
cat4_drama_ids = [d["id"] for d in cat4_dramas]
print(f"Kategori 4: {len(cat4_drama_ids)} yapım işleme alınıyor...")

conn = sqlite3.connect(r"c:\Users\Cagan\Downloads\KoUp\webdrama_archive.db")
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Find dead sources for these dramas
placeholders = ",".join("?" for _ in cat4_drama_ids)
cur.execute(f"""
    SELECT e.id as ep_id, e.drama_id, es.id as src_id, es.direct_url, es.provider, es.site
    FROM episodes e
    JOIN episode_sources es ON es.episode_id = e.id
    WHERE e.drama_id IN ({placeholders})
      AND es.direct_url IS NOT NULL AND es.direct_url != '' AND es.direct_url != 'dead';
""", cat4_drama_ids)

rows = cur.fetchall()
ep_sources = defaultdict(list)
dead_src_ids = []

for r in rows:
    is_dead, reason = analyze_source_deadness(r["direct_url"], r["provider"] or "", r["site"] or "")
    src_id = r["src_id"]
    ep_id = r["ep_id"]
    ep_sources[ep_id].append(src_id)
    if is_dead:
        dead_src_ids.append(src_id)

print(f"Tespit edilen ölü kaynak: {len(dead_src_ids):,}")

# Safety verify
dead_set = set(dead_src_ids)
zero_left = [ep for ep, srcs in ep_sources.items() if len([s for s in srcs if s not in dead_set]) == 0]
if zero_left:
    print(f"HATA: {len(zero_left)} bölüm kaynaksız kalacak! İşlem iptal edildi.")
    conn.close()
    sys.exit(1)

print("Güvenlik onayı: 0 bölüm kaynaksız kalıyor. Silme işlemi başlatılıyor...")

t0 = time.time()
cur.execute("BEGIN TRANSACTION;")

# Chunked delete
chunk_size = 5000
total_deleted = 0
for i in range(0, len(dead_src_ids), chunk_size):
    chunk = dead_src_ids[i:i + chunk_size]
    ph = ",".join("?" for _ in chunk)
    cur.execute(f"DELETE FROM episode_sources WHERE id IN ({ph});", chunk)
    total_deleted += cur.rowcount

# Update dramas.sources_count for these 388 dramas
for did in cat4_drama_ids:
    cur.execute("""
        UPDATE dramas
        SET sources_count = (
            SELECT count(es.id)
            FROM episode_sources es
            JOIN episodes e ON e.id = es.episode_id
            WHERE e.drama_id = ?
              AND es.direct_url IS NOT NULL AND es.direct_url != '' AND es.direct_url != 'dead'
        )
        WHERE id = ?;
    """, (did, did))

conn.commit()
conn.close()
elapsed = time.time() - t0

print(f"BAŞARILI: {total_deleted:,} ölü kaynak silindi! ({elapsed:.2f} saniye)")

# Write audit log
report = {
    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    "dramas_processed": len(cat4_drama_ids),
    "deleted_sources_count": total_deleted,
    "status": "SUCCESS"
}
with open(r"c:\Users\Cagan\Downloads\KoUp\scripts\reports\kategori4_temizlik_raporu.json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
