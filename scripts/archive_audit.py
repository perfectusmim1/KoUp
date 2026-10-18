"""
Archive Comprehensive Health Audit & Recoverability Analyzer
Scans webdrama_archive.db and analyzes:
1. Complete inventory (series, movies, anime, programs)
2. Episode & movie source coverage
3. Provider / site breakdown
4. Zero-source & broken-source analysis
5. Active scraper recoverability feasibility
"""

import os
import sys
import sqlite3
import json
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, 'webdrama_archive.db')

if not os.path.exists(DB_PATH):
    print(f"Error: {DB_PATH} not found.")
    sys.exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("="*70)
print("  KOUP COMPREHENSIVE ARCHIVE HEALTH & RECOVERY AUDIT")
print("="*70)

# 1. Total Media Breakdown
cur.execute("""
    SELECT content_type, count(*) as count,
           sum(case when sources_count > 0 then 1 else 0 end) as with_sources,
           sum(case when coalesce(sources_count, 0) = 0 then 1 else 0 end) as zero_sources
    FROM dramas
    GROUP BY content_type
""")
media_stats = cur.fetchall()

print("\n--- 1. Yapım Envanteri ve Kaynak Durumu (dramas tablosu) ---")
total_all = 0
total_with_src = 0
total_zero_src = 0

for row in media_stats:
    c_type = row['content_type'] or 'dizi'
    cnt = row['count']
    w_src = row['with_sources']
    z_src = row['zero_sources']
    total_all += cnt
    total_with_src += w_src
    total_zero_src += z_src
    pct = (w_src / cnt * 100) if cnt > 0 else 0
    print(f"  • {c_type.upper():<10}: {cnt:>6} toplam | {w_src:>6} kaynaklı ({pct:5.1f}%) | {z_src:>6} kaynaksız")

print(f"  -------------------------------------------------------------")
total_pct = (total_with_src / total_all * 100) if total_all > 0 else 0
print(f"  • TOPLAM    : {total_all:>6} toplam | {total_with_src:>6} kaynaklı ({total_pct:5.1f}%) | {total_zero_src:>6} kaynaksız")

# 2. Episode Coverage Analysis
cur.execute("SELECT count(*) FROM episodes")
total_episodes = cur.fetchone()[0]

cur.execute("""
    SELECT 
        count(distinct e.id) as eps_with_sources
    FROM episodes e
    JOIN episode_sources s ON e.id = s.episode_id
    WHERE s.direct_url IS NOT NULL 
      AND s.direct_url != 'dead' 
      AND s.direct_url != ''
      AND s.provider != 'dead'
""")
eps_with_sources = cur.fetchone()[0]
eps_without_sources = total_episodes - eps_with_sources

print("\n--- 2. Bölüm Kapsama Durumu (episodes tablosu) ---")
ep_pct = (eps_with_sources / total_episodes * 100) if total_episodes > 0 else 0
print(f"  • Toplam Bölüm        : {total_episodes:>7}")
print(f"  • Kaynaklı Bölüm      : {eps_with_sources:>7} ({ep_pct:.1f}%)")
print(f"  • Kaynaksız (0) Bölüm : {eps_without_sources:>7} ({100-ep_pct:.1f}%)")

# 3. Source Breakdown by Provider / Site
cur.execute("""
    SELECT site, count(*) as count
    FROM episode_sources
    WHERE direct_url IS NOT NULL AND direct_url != 'dead' AND direct_url != ''
    GROUP BY site
    ORDER BY count DESC
""")
site_stats = cur.fetchall()

print("\n--- 3. Kaynakların Sitelere Göre Dağılımı (episode_sources) ---")
total_sources_active = 0
for r in site_stats:
    site_name = r['site'] or 'Bilinmeyen'
    cnt = r['count']
    total_sources_active += cnt
    print(f"  • {site_name:<20}: {cnt:>7} aktif kaynak")
print(f"  -------------------------------------------------------------")
print(f"  • TOPLAM AKTİF KAYNAK : {total_sources_active:>7}")

# 4. Stream Type / Protocol Health
cur.execute("""
    SELECT 
        case 
            when direct_url like '%.m3u8%' or direct_url like '%molystream%' or direct_url like '%playerdkorea%' or provider like '%hls%' or provider = 'dbx' then 'HLS (Native / 1080p)'
            when provider = 'tau-video' or direct_url like '%tau-video%' then 'Tau Video (Native)'
            when direct_url like '%.mp4%' then 'MP4 Direct'
            when provider in ('ok.ru', 'odnoklassniki', 'vk', 'dailymotion') then 'PostMessage Iframe'
            when provider in ('vidmoly', 'filemoon', 'sibnet') then 'Fast Embed'
            else 'Other / Embed'
        end as stream_class,
        count(*) as count
    FROM episode_sources
    WHERE direct_url IS NOT NULL AND direct_url != 'dead' AND direct_url != ''
    GROUP BY stream_class
    ORDER BY count DESC
""")
protocol_stats = cur.fetchall()

print("\n--- 4. Akış Protokolü Dağılımı ---")
for r in protocol_stats:
    print(f"  • {r['stream_class']:<24}: {r['count']:>7} kaynak")

# 5. Series Health Categories (Full, Partial, Zero)
cur.execute("""
    SELECT d.id, d.title, d.content_type, d.episode_count,
           count(distinct e.id) as total_eps,
           count(distinct case when s.id is not null then e.id end) as eps_with_src
    FROM dramas d
    LEFT JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources s ON e.id = s.episode_id 
         AND s.direct_url IS NOT NULL AND s.direct_url != 'dead' AND s.direct_url != ''
    WHERE d.content_type != 'film'
    GROUP BY d.id
""")
dramas_health = cur.fetchall()

full_count = 0
partial_count = 0
zero_count = 0
dead_zero_ep_count = 0

partial_samples = []
zero_samples = []

for d in dramas_health:
    t_eps = d['total_eps']
    w_src = d['eps_with_src']
    
    if t_eps == 0 or w_src == 0:
        zero_count += 1
        if len(zero_samples) < 10:
            zero_samples.append((d['id'], d['title'], d['content_type'], t_eps))
    elif w_src == t_eps:
        full_count += 1
    else:
        partial_count += 1
        if len(partial_samples) < 10:
            partial_samples.append((d['id'], d['title'], d['content_type'], w_src, t_eps))

print("\n--- 5. Dizi/Anime Sağlık Sınıflandırması ---")
print(f"  • Kategori A (Eksiksiz - Tüm Bölümleri Var) : {full_count:>6} seri")
print(f"  • Kategori B (Kısmi Eksik - Bazı Bölümler Var): {partial_count:>6} seri")
print(f"  • Kategori C (Komple Kaynaksız / Sıfır Kaynak) : {zero_count:>6} seri")

# 6. Movies Breakdown
cur.execute("""
    SELECT d.id, d.title,
           count(s.id) as src_count
    FROM dramas d
    LEFT JOIN episodes e ON d.id = e.drama_id
    LEFT JOIN episode_sources s ON e.id = s.episode_id 
         AND s.direct_url IS NOT NULL AND s.direct_url != 'dead' AND s.direct_url != ''
    WHERE d.content_type = 'film'
    GROUP BY d.id
""")
movies_health = cur.fetchall()

movies_with_src = sum(1 for m in movies_health if m['src_count'] > 0)
movies_zero_src = sum(1 for m in movies_health if m['src_count'] == 0)

print("\n--- 6. Film Sağlık Durumu ---")
print(f"  • Kaynaklı Filmler : {movies_with_src:>6}")
print(f"  • Kaynaksız Filmler: {movies_zero_src:>6}")

conn.close()
print("\n" + "="*70)
