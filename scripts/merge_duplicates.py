import sqlite3
import re
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from collections import defaultdict
from scrapers.supabase_sync_helper import sb_request, _load_r2_creds, sync_drama_bundle_and_counts

def normalize_title(t):
    if not t:
        return ""
    t = t.lower()
    t = t.replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's').replace('ö', 'o').replace('ç', 'c')
    t = re.sub(r'[^a-z0-9]', '', t)
    return t

def delete_r2_bundle(drama_id: int):
    try:
        import boto3
        endpoint, access_key, secret_key, bucket = _load_r2_creds()
        if endpoint and access_key and secret_key and bucket:
            s3 = boto3.client(
                's3',
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name='auto'
            )
            s3.delete_object(Bucket=bucket, Key=f"sources/{drama_id}.json")
            print(f"    [R2] Deleted sources/{drama_id}.json")
    except Exception as e:
        pass

def run_merge():
    conn = sqlite3.connect('webdrama_archive.db')
    cur = conn.cursor()

    dramas = cur.execute("""
        SELECT d.id, d.title, d.slug, d.content_type, d.release_year,
               (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count,
               (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON e.id = es.episode_id WHERE e.drama_id = d.id) as src_count
        FROM dramas d
    """).fetchall()

    title_map = defaultdict(list)
    for r in dramas:
        norm = normalize_title(r[1])
        if norm and len(norm) > 3:
            title_map[(norm, r[3], r[4] or 0)].append(r)

    norm_dups = {k: v for k, v in title_map.items() if len(v) > 1}
    print(f"Processing {len(norm_dups)} duplicate groups...")

    merged_count = 0

    for k, v in norm_dups.items():
        def score_drama(d):
            did, title, slug, c_type, year, ep_count, src_count = d
            score = src_count * 100 + ep_count * 10
            if any(slug.endswith(x) for x in ['-box', '-you', '-di', '-cin-di', '-kore-di', '-tayland-di', '-2']):
                score -= 50
            return score

        sorted_v = sorted(v, key=score_drama, reverse=True)
        primary = sorted_v[0]
        duplicates = sorted_v[1:]

        p_id = primary[0]
        print(f"\n--- Primary Drama: ID {p_id} ('{primary[1]}' - slug: '{primary[2]}') | eps: {primary[5]}, srcs: {primary[6]} ---")

        for dup in duplicates:
            d_id = dup[0]
            print(f"  Merging Duplicate ID {d_id} ('{dup[1]}' - slug: '{dup[2]}')...")

            dup_eps = cur.execute("SELECT id, season_number, episode_number, episode_name, episode_url FROM episodes WHERE drama_id = ?", (d_id,)).fetchall()
            for dep_id, s_num, e_num, ep_name, ep_url in dup_eps:
                p_ep = cur.execute("SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?", (p_id, s_num, e_num)).fetchone()
                if p_ep:
                    target_ep_id = p_ep[0]
                    dup_srcs = cur.execute("SELECT source_name, embed_id, direct_url, provider, fansub, site FROM episode_sources WHERE episode_id = ?", (dep_id,)).fetchall()
                    for s_name, embed_id, direct_url, provider, fansub, site in dup_srcs:
                        exists = cur.execute("SELECT id FROM episode_sources WHERE episode_id = ? AND embed_id = ?", (target_ep_id, embed_id)).fetchone()
                        if not exists:
                            cur.execute("""
                                INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                            """, (target_ep_id, s_name, embed_id, direct_url, provider, fansub, site))
                    cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (dep_id,))
                    cur.execute("DELETE FROM episodes WHERE id = ?", (dep_id,))
                else:
                    cur.execute("UPDATE episodes SET drama_id = ? WHERE id = ?", (p_id, dep_id))

            cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (d_id,))
            cur.execute("DELETE FROM episodes WHERE drama_id = ?", (d_id,))
            cur.execute("DELETE FROM dramas WHERE id = ?", (d_id,))
            conn.commit()

            # Supabase cleanup
            sb_request("DELETE", f"/rest/v1/episodes?media_id=eq.{d_id}")
            sb_request("DELETE", f"/rest/v1/media?id=eq.{d_id}")
            print(f"    [Supabase] Cleaned ID {d_id}")

            # R2 cleanup
            delete_r2_bundle(d_id)
            merged_count += 1

        # Re-sync primary drama bundle & counts to SQLite, R2, and Supabase
        sync_drama_bundle_and_counts(conn, cur, p_id)
        print(f"    [Primary Sync] Re-synced drama ID {p_id}")

    print(f"\nSuccessfully merged and purged {merged_count} duplicate series!")
    conn.close()

if __name__ == '__main__':
    run_merge()
