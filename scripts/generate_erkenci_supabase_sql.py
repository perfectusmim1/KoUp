import sqlite3
import json

conn = sqlite3.connect('webdrama_archive.db')
c = conn.cursor()

c.execute("""
    SELECT e.season_number, e.episode_number, e.episode_name, es.source_name, es.direct_url, es.provider, es.site
    FROM episodes e
    JOIN episode_sources es ON e.id = es.episode_id
    WHERE e.drama_id = 31860
    ORDER BY e.episode_number ASC
""")
rows = c.fetchall()
print(f"Total sources found: {len(rows)}")

sql_statements = []
for r in rows:
    season, ep_num, ep_name, sname, durl, prov, site = r
    source_obj = [{
        "source_name": sname or "DDizi HLS",
        "embed_id": durl,
        "direct_url": durl,
        "provider": prov or "ddizi",
        "site": site or "ddizi",
        "stream_type": "hls",
        "quality_label": "1080p Doğrudan Akış"
    }]
    src_json = json.dumps(source_obj, ensure_ascii=False).replace("'", "''")
    clean_ep_name = f"Bölüm {ep_num}"
    sql_statements.append(f"UPDATE episodes SET episode_name = '{clean_ep_name}', video_sources = '{src_json}'::jsonb WHERE media_id = 31860 AND episode_number = {ep_num};")

with open('scripts/update_erkenci_supabase.sql', 'w', encoding='utf-8') as f:
    f.write("\n".join(sql_statements))

print("Wrote update_erkenci_supabase.sql with", len(sql_statements), "statements.")
