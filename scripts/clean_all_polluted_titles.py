import sqlite3
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

conn = sqlite3.connect(r'c:\Users\Cagan\Downloads\KoUp\webdrama_archive.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("""
    SELECT id, title, native_title
    FROM dramas
    WHERE title LIKE '%izle%' OR title LIKE '%Izle%' OR title LIKE '%İZLE%'
""")

rows = cur.fetchall()
print(f"Toplam incelenen başlık: {len(rows):,}")

def clean_title(title, orig_native):
    t = (title or "").strip()
    new_native = (orig_native or "").strip()
    
    # Pattern 1: Title has "izle - Original Title" or "izle- Original Title"
    m = re.search(r'^(.*?)\s+izle\s*[-–]\s*(.*)$', t, re.I)
    if m:
        t = m.group(1).strip()
        if not new_native or 'Man:' in new_native:
            new_native = m.group(2).strip()
        return t, new_native

    # Pattern 2: Title has "izle" glued to English capital letter: e.g. "Örümcek Adam: Eve Dönüş Yok izleSpider"
    m2 = re.search(r'^(.*?)\s*izle([A-Z0-9].*)$', t)
    if m2:
        clean_t = m2.group(1).strip()
        first_part_eng = m2.group(2).strip()
        if new_native:
            if re.match(r'^(Man|Woman|Girl|Boy|Part|Season)\b', new_native):
                new_native = f"{first_part_eng}-{new_native}".strip()
            else:
                new_native = f"{first_part_eng} {new_native}".strip()
        else:
            new_native = first_part_eng
        return clean_t, new_native

    # Pattern 3: Title has "izle(Year)" e.g. "Dirkie izle(1969)"
    m3 = re.search(r'^(.*?)\s*izle\s*(\(\d{4}\))$', t, re.I)
    if m3:
        return m3.group(1).strip(), new_native

    # Pattern 4: Title ends with "izle", "izle hd", "izle hd\d+", "film izle", "dizi izle"
    t = re.sub(r'\s+(film\s+izle|dizi\s+izle|hd\s+izle|izle\s+hd\d*|izle\s+full\s+hd|full\s+hd\s+izle|izle)\s*$', '', t, flags=re.I)
    
    # Pattern 5: Title has "izle" in the middle before parentheses: "X izle (2021)"
    m5 = re.search(r'^(.*?)\s+izle\s*(\(.*\))$', t, re.I)
    if m5:
        return f"{m5.group(1).strip()} {m5.group(2).strip()}", new_native

    return t.strip(), new_native

updates = []
for r in rows:
    old_t = r["title"]
    old_n = r["native_title"] or ""
    new_t, new_n = clean_title(old_t, old_n)
    if new_t != old_t or new_n != old_n:
        updates.append((new_t, new_n, r["id"]))

print(f"Güncellenecek başlık sayısı: {len(updates):,}")

cur.execute("BEGIN TRANSACTION;")
for new_t, new_n, did in updates:
    cur.execute("""
        UPDATE dramas
        SET title = ?, native_title = ?
        WHERE id = ?;
    """, (new_t, new_n, did))

conn.commit()
conn.close()

print(f"BAŞARILI: {len(updates):,} başlık temizlendi ve kaydedildi!")
