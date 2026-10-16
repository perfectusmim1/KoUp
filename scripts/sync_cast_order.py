import sqlite3
import json
import re

def clean_char_name(val):
    if not val:
        return None
    s = val.strip()
    if not s:
        return None
    lower = s.lower()
    if lower in ('başrol', 'unknown', 'kadro', 'oyuncu', 'actor', 'null', 'none', '-'):
        return None
    return s

def main():
    conn = sqlite3.connect('webdrama_archive.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT 
            da.drama_id, 
            da.actor_id, 
            da.character_name,
            row_number() OVER (PARTITION BY da.drama_id ORDER BY da.rowid ASC) as billing_order
        FROM drama_actors da
    ''')
    rows = cursor.fetchall()
    print(f"Total rows fetched from SQLite: {len(rows)}")

    # Group into batches of 3000
    batch_size = 3000
    batches = []
    current = []

    for r in rows:
        drama_id, actor_id, raw_char, order = r
        char_name = clean_char_name(raw_char)
        role_type = 'lead' if order <= 4 else 'support'
        current.append((drama_id, actor_id, order, role_type, char_name))
        if len(current) >= batch_size:
            batches.append(current)
            current = []
    if current:
        batches.append(current)

    print(f"Generated {len(batches)} batches of up to {batch_size} rows.")

    # Save SQL queries to scripts/cast_batches.json so they can be run
    sql_batches = []
    for b_idx, batch in enumerate(batches):
        vals = []
        for drama_id, actor_id, order, role_type, char_name in batch:
            if char_name is None:
                c_esc = "NULL"
            else:
                escaped = char_name.replace("'", "''")
                c_esc = f"'{escaped}'"
            vals.append(f"({drama_id}, {actor_id}, {order}, '{role_type}', {c_esc})")
        
        sql = f"""
UPDATE media_cast AS mc
SET 
  billing_order = v.billing_order::smallint,
  role_type = v.role_type::text,
  character_name = v.character_name::text
FROM (VALUES
  {', '.join(vals)}
) AS v(media_id, person_id, billing_order, role_type, character_name)
WHERE mc.media_id = v.media_id AND mc.person_id = v.person_id;
"""
        sql_batches.append(sql)

    with open('scripts/cast_batches.json', 'w', encoding='utf-8') as f:
        json.dump(sql_batches, f)
    print("Saved SQL batches to scripts/cast_batches.json")

if __name__ == '__main__':
    main()
