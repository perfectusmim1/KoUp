import urllib.request
import urllib.parse
import json
import sqlite3

remaining = [
    (15191, 'Chuang Asia Thailand', 'tv'),
    (17066, 'Womb Love', 'tv'),
    (24458, 'A Week Grace', 'tv'),
    (23323, 'Watashi no Shiawase na Katachi', 'anime'),
    (22766, 'Mahoutsukai no Yome', 'anime'),
    (28683, 'İllegal Hayatlar', 'movie'),
    (17371, 'Iron Family', 'tv'),
    (24306, 'Baki Hanma', 'anime'),
    (24452, 'The First Frost', 'tv'),
    (1, 'Failing in Love', 'tv'),
    (18482, 'Yabusaka dewa gozaimasen', 'tv'),
    (43470, 'Friends of the Wild', 'tv'),
    (43636, 'Johnny Test', 'tv'),
    (43681, 'Crisis', 'tv'),
    (44428, 'Criminal Code', 'tv'),
    (44451, 'The Curse', 'tv'),
    (44561, 'Feedback', 'tv'),
    (44604, 'Get Gotti', 'tv'),
    (45146, 'How to Become a Mob Boss', 'tv'),
    (45286, 'Sexy Beast', 'tv'),
    (45370, 'Suburræterna', 'tv'),
    (46118, 'Johnny Test', 'tv'),
    (23594, 'Link Click', 'anime'),
    (23082, 'Hakuouki', 'anime'),
    (21978, 'Toji no Miko', 'anime'),
    (21714, 'Record of Grancrest War', 'anime'),
    (16099, 'Unmei Keisatsu', 'tv'),
    (20392, '91 Days', 'anime'),
    (22375, 'Darker than Black', 'anime'),
    (15009, 'Burning Sun', 'movie'),
    (15104, 'Story of Kunning Palace', 'tv'),
    (15153, 'Be My Boyfriend', 'tv'),
    (15182, 'The Great Shaman Ga Doo Shim', 'tv'),
    (15258, 'Wave Makers', 'tv'),
    (24061, 'Dr. Stone', 'anime'),
    (24142, 'Tomb Raider The Legend of Lara Croft', 'tv'),
    (28641, 'Sinkhole', 'movie'),
    (42678, 'Build Up Vocal Boy Group Survivor', 'tv'),
    (43474, 'Ripley\'s Believe It or Not', 'tv'),
    (43477, 'Wicked Tuna', 'tv'),
    (43479, 'Toto', 'tv'),
    (43706, 'Ferhangi Seyler', 'movie'),
    (43707, 'Deve Kusu Kabaresi', 'movie'),
    (44274, 'Little House on the Prairie', 'tv'),
    (14988, 'Lovely Runner', 'tv'),
    (15287, 'tvN O\'PENing', 'tv'),
    (20872, 'Ronin Warriors', 'anime'),
    (18611, 'Brothels', 'tv')
]

api_key = '4c092d2cfd6d9c0e3aa3dab12c7d4756'
resolved = []

for mid, q, mediatype in remaining:
    url = f'https://api.themoviedb.org/3/search/multi?api_key={api_key}&query={urllib.parse.quote(q)}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            results = data.get('results', [])
            found = False
            for r in results:
                poster = r.get('poster_path')
                if poster:
                    img = f'https://image.tmdb.org/t/p/w500{poster}'
                    tmdb_id = r.get('id')
                    resolved.append((mid, img, tmdb_id))
                    t = r.get('name') or r.get('title')
                    print(f'OK {mid} {q} -> {t} ({img})')
                    found = True
                    break
            if not found:
                print(f'NO RESULT: {mid} {q}')
    except Exception as e:
        print(f'ERR {mid}: {e}')

print(f'\nTotal resolved: {len(resolved)} / {len(remaining)}')

# Write SQL file
with open('scripts/bulk_56.sql', 'w', encoding='utf-8') as f:
    f.write("UPDATE media AS m\nSET cover_image = v.cover_image,\n    tmdb_id = COALESCE(v.tmdb_id, m.tmdb_id)\nFROM (VALUES\n")
    lines = []
    for mid, img, tmdb_id in resolved:
        t_id = f"{tmdb_id}" if tmdb_id else "NULL::integer"
        lines.append(f"  ({mid}, '{img}', {t_id})")
    f.write(",\n".join(lines))
    f.write("\n) AS v(id, cover_image, tmdb_id)\nWHERE m.id = v.id;\n")

# Also update sqlite db
db_path = 'webdrama_archive.db'
conn = sqlite3.connect(db_path)
c = conn.cursor()
for mid, img, tmdb_id in resolved:
    c.execute("UPDATE media SET cover_image = ?, tmdb_id = COALESCE(?, tmdb_id) WHERE id = ?", (img, tmdb_id, mid))
conn.commit()
conn.close()
print("Updated local sqlite db as well.")
