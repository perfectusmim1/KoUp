import sqlite3
import json

conn = sqlite3.connect('webdrama_archive.db')
cur = conn.cursor()

cur.execute("""
    SELECT id, slug, title, cover_image, overview, categories, tags, alt_sites
    FROM dramas
    WHERE alt_sites LIKE '%ddizi%'
""")
rows = cur.fetchall()

sql_statements = []
for r in rows:
    did, slug, title, cover, overview, cats_raw, tags_raw, alts_raw = r
    try:
        cats = json.loads(cats_raw or '[]')
    except:
        cats = ["Yerli Dizi", "Dram"]
    try:
        tags = json.loads(tags_raw or '[]')
    except:
        tags = ["DDizi", "Yerli Dizi"]
    try:
        alts = json.loads(alts_raw or '[]')
    except:
        alts = ["ddizi"]

    safe_title = title.replace("'", "''")
    safe_slug = (slug or f"dizi-{did}").replace("'", "''")
    safe_cover = (cover or 'https://www.ddizi.tel/images/logo.png').replace("'", "''")
    safe_overview = (overview or f"{title}, yerli dizi ve yapımlar kategorisinde yer alan yapımdır.").replace("'", "''")
    
    # Format Postgres text arrays
    cats_pg = "ARRAY[" + ",".join(f"'{c.replace("'", "''")}'" for c in cats) + "]"
    tags_pg = "ARRAY[" + ",".join(f"'{t.replace("'", "''")}'" for t in tags) + "]"
    alts_pg = "ARRAY[" + ",".join(f"'{a.replace("'", "''")}'" for a in alts) + "]"
    
    cur.execute("SELECT COUNT(*) FROM episodes WHERE drama_id=?", (did,))
    ep_count = cur.fetchone()[0] or 1

    sql = f"""
    INSERT INTO public.media (
        id, slug, content_type, country_code, country_name,
        title, title_tr, title_en, overview, release_year,
        episode_count, duration_minutes, status_broadcast, status_translation,
        cover_image, backdrop_image, categories, tags, alt_sites,
        views_total, search_text, is_featured
    ) VALUES (
        {did}, '{safe_slug}', 'dizi', 'TR', 'Türkiye',
        '{safe_title}', '{safe_title}', '{safe_title}', '{safe_overview}', 2026,
        {ep_count}, 120, 'Devam Ediyor', 'Orijinal Türkçe',
        '{safe_cover}', '{safe_cover}', {cats_pg}, {tags_pg}, {alts_pg},
        450, '{safe_title.lower()} {safe_slug} yerli dizi turkce ddizi', false
    ) ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        slug = EXCLUDED.slug,
        cover_image = EXCLUDED.cover_image,
        backdrop_image = EXCLUDED.backdrop_image,
        overview = EXCLUDED.overview,
        episode_count = EXCLUDED.episode_count,
        categories = EXCLUDED.categories,
        tags = EXCLUDED.tags,
        alt_sites = EXCLUDED.alt_sites;
    """
    sql_statements.append(sql.strip())

with open('scripts/ddizi_sync.sql', 'w', encoding='utf-8') as f:
    f.write("\n".join(sql_statements))

print(f"Generated SQL for {len(sql_statements)} media items.")
