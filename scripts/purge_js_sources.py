import sqlite3
import sys
sys.path.append('.')
from scrapers.supabase_sync_helper import sync_drama_bundle_and_counts

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

# Find which dramas are affected by javascript:false;
cur.execute('''
    SELECT DISTINCT e.drama_id
    FROM episode_sources s
    JOIN episodes e ON e.id = s.episode_id
    WHERE s.direct_url LIKE '%javascript%' OR s.direct_url LIKE '%void(0)%'
''')
affected_dramas = [r[0] for r in cur.fetchall()]
print(f'Affected dramas by javascript sources ({len(affected_dramas)}): {affected_dramas}')

cur.execute("DELETE FROM episode_sources WHERE direct_url LIKE '%javascript%' OR direct_url LIKE '%void(0)%'")
deleted = cur.rowcount
conn.commit()
print(f'Deleted {deleted} invalid javascript: sources from SQLite!')

for d_id in affected_dramas:
    try:
        sync_drama_bundle_and_counts(conn, cur, d_id)
        print(f'Re-synced drama {d_id}')
    except Exception as e:
        print(f'Failed drama {d_id}: {e}')
