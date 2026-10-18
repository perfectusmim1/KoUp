import sqlite3
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

db_path = "webdrama_archive.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("Analyzing webdrama_archive.db after HDFilmcehennemi completion...")

# Total titles
cur.execute("SELECT count(*) FROM dramas")
total_titles = cur.fetchone()[0]

# Total episodes
cur.execute("SELECT count(*) FROM episodes")
total_episodes = cur.fetchone()[0]

# Total sources
cur.execute("SELECT count(*) FROM episode_sources")
total_sources = cur.fetchone()[0]

# Sources by provider/site
cur.execute("""
    SELECT 
        CASE 
            WHEN site = 'hdfilmcehennemi' OR provider LIKE '%hdfilm%' THEN 'HDFilmcehennemi'
            WHEN site = 'turkanime' OR provider LIKE '%turkanime%' THEN 'TurkAnime'
            WHEN site = 'animecix' OR provider LIKE '%animecix%' OR provider LIKE '%tau%' THEN 'AnimeciX'
            WHEN site = 'asyaanimeleri' OR provider LIKE '%asyaanimeleri%' THEN 'AsyaAnimeleri'
            WHEN site = 'dizibox' OR provider LIKE '%dizibox%' THEN 'DiziBOX'
            WHEN site = 'dizikorea' OR provider LIKE '%dizikorea%' THEN 'DiziKorea'
            WHEN site = 'asyadizi' OR provider LIKE '%asyadizi%' THEN 'AsyaDizi'
            WHEN site = 'ddizi' OR provider LIKE '%ddizi%' THEN 'Ddizi'
            WHEN site = 'diziyou' OR provider LIKE '%diziyou%' THEN 'DiziYou'
            ELSE coalesce(site, provider, 'Diğer')
        END as prov_group,
        count(*) 
    FROM episode_sources 
    GROUP BY 1 
    ORDER BY 2 DESC
""")
sources_by_provider = cur.fetchall()

# Breakdown by content_type
cur.execute("SELECT coalesce(content_type, 'dizi'), count(*) FROM dramas GROUP BY 1")
type_counts = dict(cur.fetchall())

# Movies analysis
cur.execute("""
    SELECT d.id, d.title, d.release_year, count(es.id) as src_count
    FROM dramas d
    LEFT JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources es ON e.id = es.episode_id
    WHERE d.content_type = 'film' OR d.categories LIKE '%Film%' OR d.categories LIKE '%Movie%'
    GROUP BY d.id
""")
movie_rows = cur.fetchall()
total_movies = len(movie_rows)
movies_with_sources = sum(1 for r in movie_rows if r[3] > 0)
movies_zero_sources = sum(1 for r in movie_rows if r[3] == 0)

# Series analysis (titles that are not films)
cur.execute("""
    SELECT d.id, d.title, d.release_year, count(DISTINCT e.id) as ep_count, count(es.id) as src_count
    FROM dramas d
    LEFT JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources es ON e.id = es.episode_id
    WHERE NOT (d.content_type = 'film' OR d.categories LIKE '%Film%' OR d.categories LIKE '%Movie%')
    GROUP BY d.id
""")
series_rows = cur.fetchall()
total_series = len(series_rows)

series_zero_sources = [r for r in series_rows if r[4] == 0]
series_with_sources = [r for r in series_rows if r[4] > 0]

# Episode level check: how many episodes exist with 0 sources?
cur.execute("""
    SELECT count(e.id)
    FROM episodes e
    LEFT JOIN episode_sources es ON e.id = es.episode_id
    WHERE es.id IS NULL
""")
zero_source_episodes_count = cur.fetchone()[0]

# Check partial missing episodes in series with sources
# (Series where some episodes have sources, but at least 1 episode has 0 sources)
cur.execute("""
    SELECT d.id, d.title, 
           count(DISTINCT e.id) as total_eps,
           count(DISTINCT CASE WHEN es.id IS NULL THEN e.id END) as zero_src_eps,
           count(DISTINCT CASE WHEN es.id IS NOT NULL THEN e.id END) as with_src_eps
    FROM dramas d
    JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources es ON e.id = es.episode_id
    WHERE NOT (d.content_type = 'film' OR d.categories LIKE '%Film%' OR d.categories LIKE '%Movie%')
    GROUP BY d.id
    HAVING total_eps > 0 AND zero_src_eps > 0 AND with_src_eps > 0
""")
partial_missing_series = cur.fetchall()

# Zero sources breakdown by release year / category
cur.execute("""
    SELECT d.id, d.title, d.release_year, d.categories, d.content_type
    FROM dramas d
    LEFT JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources es ON e.id = es.episode_id
    GROUP BY d.id
    HAVING count(es.id) = 0
""")
zero_src_all = cur.fetchall()

def parse_year(val):
    if not val:
        return 0
    try:
        return int(str(val).strip()[:4])
    except:
        return 0

upcoming_count = sum(1 for r in zero_src_all if parse_year(r[2]) >= 2025)
turkish_count = sum(1 for r in zero_src_all if r[3] and ('Türk' in r[3] or 'Yerli' in r[3]))
korean_count = sum(1 for r in zero_src_all if r[3] and ('Kore' in r[3] or 'Web Drama' in r[3]))
other_count = len(zero_src_all) - upcoming_count - turkish_count - korean_count

# Multi-source vs Single-source across all titles with sources
cur.execute("""
    SELECT d.id, count(es.id) as src_cnt
    FROM dramas d
    JOIN episodes e ON d.id = e.drama_id
    JOIN episode_sources es ON e.id = es.episode_id
    GROUP BY d.id
""")
src_distribution = cur.fetchall()
titles_multi_source = sum(1 for r in src_distribution if r[1] >= 2)
titles_single_source = sum(1 for r in src_distribution if r[1] == 1)

print("=" * 65)
print("AUDIT RESULTS: POST-HDFILMCEHENNEMI ARCHIVE AUDIT")
print("=" * 65)
print(f"Toplam Yapım (Titles):            {total_titles:,}")
print(f"Toplam Bölüm (Episodes):          {total_episodes:,}")
print(f"Toplam Video Kaynağı (Sources):   {total_sources:,}")
print(f"0 Kaynaklı Bölüm Sayısı:          {zero_source_episodes_count:,}")
print("-" * 65)
print("İÇERİK TÜRÜ DETAYI:")
print(f"  Filmler (Movies):               {total_movies:,} (Kaynaklı: {movies_with_sources:,} | Sıfır: {movies_zero_sources})")
print(f"  Diziler & Animeler (Series):    {total_series:,} (Kaynaklı: {len(series_with_sources):,} | Sıfır: {len(series_zero_sources):,})")
print(f"  Kısmi Eksik Bölümlü Diziler:    {len(partial_missing_series):,}")
print("-" * 65)
print("4 KATEGORİ DAĞILIMI (Tüm Yapımlar):")
print(f"  Kategori 1: Çoklu Kaynaklı Yapımlar (2+ Kaynak):  {titles_multi_source:,}")
print(f"  Kategori 2: Tek Kaynaklı Yapımlar (1 Kaynak):      {titles_single_source:,}")
print(f"  Kategori 3: Kısmen Eksik Bölümlü Seriler:          {len(partial_missing_series):,}")
print(f"  Kategori 4: Komple 0 Kaynaklı / Bozuk Yapımlar:    {len(zero_src_all):,}")
print(f"     -> 2025-2026 Gelecek/Vizyona Girecek Projeler:  {upcoming_count:,}")
print(f"     -> Eski Yerli / Türk Dizileri:                  {turkish_count:,}")
print(f"     -> Kore Mini Web Dramaları:                     {korean_count:,}")
print(f"     -> Diğer / İptal Edilen / TV Showları:          {other_count:,}")
print("-" * 65)
print("KAYNAKLARIN SAĞLAYICI DAĞILIMI (Top Providers):")
for prov, cnt in sources_by_provider:
    print(f"  {prov:20s}: {cnt:>10,}")
print("=" * 65)

# Also output partial missing series names if any
if partial_missing_series:
    print("\nKısmen Eksik Bölümlü Seriler:")
    for s in partial_missing_series[:10]:
        print(f"  - ID: {s[0]} | {s[1]} (Toplam {s[2]} bölümden {s[3]} tanesi 0 kaynak)")
