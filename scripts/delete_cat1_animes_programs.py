import sqlite3
import json

conn = sqlite3.connect(r'c:\Users\Cagan\Downloads\KoUp\webdrama_archive.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

with open(r'c:\Users\Cagan\Downloads\KoUp\scripts\reports\ayrintili_yapim_analizi_no_ddizi.json', encoding='utf-8') as f:
    d = json.load(f)

cat1 = d['completely_dead']
animes = [x for x in cat1 if x['type'] == 'anime']
programs = [x for x in cat1 if x['type'] == 'program']

target_ids = [x['id'] for x in animes + programs]
print(f"Silinecek yapım sayısı: {len(target_ids)} ({len(animes)} Anime, {len(programs)} Program)")

cur.execute("BEGIN TRANSACTION;")

placeholders = ",".join("?" for _ in target_ids)

# 1. Delete episode sources
cur.execute(f"""
    DELETE FROM episode_sources 
    WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id IN ({placeholders}));
""", target_ids)
deleted_sources = cur.rowcount

# 2. Delete episodes
cur.execute(f"""
    DELETE FROM episodes WHERE drama_id IN ({placeholders});
""", target_ids)
deleted_episodes = cur.rowcount

# 3. Delete dramas
cur.execute(f"""
    DELETE FROM dramas WHERE id IN ({placeholders});
""", target_ids)
deleted_dramas = cur.rowcount

conn.commit()
conn.close()

print(f"BAŞARIYLA SİLİNDİ:")
print(f"  - {deleted_dramas} Yapım (16 Anime + 16 Program)")
print(f"  - {deleted_episodes} Bölüm")
print(f"  - {deleted_sources} Ölü Kaynak")
