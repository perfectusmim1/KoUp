"""
Clean messy episode names in webdrama_archive.db
Standardizes 'Detective Conan 1160. Bölüm İzle07 Eki' into 'Bölüm 1160'
"""

import os
import sqlite3

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

conn = sqlite3.connect(DB_PATH, timeout=60.0)
cur = conn.cursor()

print("Cleaning messy episode names in webdrama_archive.db...")
cur.execute("""
    UPDATE episodes
    SET episode_name = 'Bölüm ' || episode_number
    WHERE episode_name LIKE '%izle%'
       OR episode_name LIKE '%İzle%'
       OR episode_name LIKE '%Eki%'
       OR episode_name LIKE '%Kas%'
       OR episode_name LIKE '%Oca%'
       OR episode_name LIKE '%Şub%'
       OR episode_name LIKE '%Mar%'
       OR episode_name LIKE '%Nis%'
       OR episode_name LIKE '%May%'
       OR episode_name LIKE '%Haz%'
       OR episode_name LIKE '%Tem%'
       OR episode_name LIKE '%Ağu%'
       OR episode_name LIKE '%Eyl%'
       OR episode_name LIKE '%Bölüm%'
""")

count = cur.rowcount
conn.commit()
conn.close()

print(f"Successfully cleaned {count} episode names in webdrama_archive.db!")
