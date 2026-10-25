import json
import os
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.clean_and_heal_archive_ids import sync_drama_bundle_and_counts
from scrapers.supabase_sync_helper import _load_r2_creds, sb_request

DB_PATH = os.path.join(_ROOT, "webdrama_archive.db")

ANILIST_FIXES = [
    (6533, None, "2018"),     # Castlevania 2 (was 99148 Gin no Guardian 2)
    (7415, 2590, "2007"),     # Gift: Eternal Rainbow Special (was 129462 Heikousen)
    (7475, 99916, "2021"),    # Girls & Panzer: Saishuushou Part 3 (was 104722 Assassins Pride)
    (7477, 99917, "2023"),    # Girls & Panzer: Saishuushou Part 4 (was 104723 Okaasan Online)
    (7887, 166522, "2024"),   # Himesama "Goumon" no Jikan desu (was 1884 Hime-sama Goyoujin)
    (7888, 179795, "2026"),   # Himesama "Goumon" no Jikan desu 2 (was 20751 Mushishi Zoku Shou 2)
    (7917, None, "2026"),     # Hokuto no Ken: Kenougun Zako-tachi no Banka Part 2 (was 189513 Sousou no Frieren)
    (9693, None, "2025"),     # One Piece: Dr. Chopper no Bouken Karte (was 2222 Dr. Slump 1981)
    (11046, 2698, "1986"),    # The Choujo / Maris the Chojo (was 12401 The Gakuen Choujotai)
    (29978, 2994, "2007"),    # Death Note Relight 1: Visions of a God (was 1070 Love Get CHU)
    (31197, 178004, "2025"),  # Kimetsu no Yaiba Movie: Mugen Jou-hen (was 178005 Tamon-kun)
    (10893, 1371, "1999"),    # Taiho Shichau zo The Movie (was 4162 Special)
    (10894, 1372, "1996"),    # Taiho Shichau zo (TV) (was 4162 Special)
    (8550, 2927, "2007"),     # Kimikiss Pure Rouge TV (was 4205 Special)
    (7768, 4192, "2009"),     # Hayate no Gotoku 2nd Season TV (was 5521 OVA)
    (22375, 7338, "2010"),    # Darker than Black 2 OVA (was 6573 TV)
    (9462, 8246, "2010"),     # Naruto: Shippuuden Movie 4 - The Lost Tower (was 10589 Movie 5)
    (9018, 11977, "2012"),    # Mahou Shoujo Madoka Magica Movie 1 (was 11981 Movie 3)
    (23967, 20906, "2015"),   # Lupin 3. Sezon 4. Kisim / Part IV (was 13203 Mine Fujiko)
    (10945, 12445, "2012"),   # Tasogare Otome x Amnesia TV (was 14189 OVA)
    (30520, 15200, "2015"),   # Code Geass: Akito the Exiled 4 (was 15199 Akito 3)
    (29888, 98297, "2017"),   # Wake Up, Girls! Shin Shou (was 19023 S1)
    (30671, 170732, "2024"),  # DanMachi 5. Sezon (was 20920 S1)
    (7081, 20652, "2015"),    # Durarara!!x2 Shou TV (was 21068 Special)
    (7083, 20879, "2015"),    # Durarara!!x2 Ten TV (was 21331 Special)
    (6010, 21078, "2015"),    # Aoharu x Kikanjuu TV (was 21414 OVA)
    (7859, 20574, "2018"),    # High Score Girl TV (was 104307 OVA)
    (6362, 169755, "2024"),   # Boku no Hero Academia the Movie 4: You're Next (was 108553 Movie 2)
    (9743, 97668, "2019"),    # One Punch Man 2nd Season TV (was 108945 OVA)
    (29638, 110733, "2021"),  # Zombieland Saga 2. Sezon (was 103871 S1)
    (30617, 138516, "2023"),  # Ijiranaide, Nagatoro-san 2. Sezon (was 120697 S1)
    (8216, 155387, "2022"),   # JoJo Part 6: Stone Ocean Part 3 (was 146722 Part 2)
    (6212, 153160, "2022"),   # Bastard!! (ONA) Part 2 (was 159926 Season 2)
    (7036, None, "1993"),     # Dragon Ball Z: Zenbu Misemasu Toshi Wasure (22695 was MAL ID, not AniList ID)
    (30789, None, "2023"),    # Martial God Stream (Xian Wu Cangqiong) (was 137674 Xiuluo Wu Shen)
    (8833, None, "2011"),     # Last Exile: Ginyoku no Fam - Adjournment
    (23322, None, "2003"),    # Ikkitousen: Legendary Fighter
    (7105, None, "2005"),     # Eikoku Koi Monogatari Emma: Intermission
    (6588, None, "2003"),     # Chobits Recap
    (9847, None, "2001"),     # Otogi Story Tenshi no Shippo Specials
    (5856, None, "2005"),     # Air Recap
    (6079, None, "2006"),     # Aru Tabibito no Nikki Specials
    (5744, None, "2007"),     # 009-1: R&B
    (5920, None, "2005"),     # Amaenaide yo!!: Yasumanaide yo!!
    (7340, None, "2007"),     # Gakuen Utopia Manabi Straight! Special
    (7355, None, "1986"),     # Ganbare! Kickers Specials
    (8328, None, "2008"),     # Kamen no Maid Guy Special
    (9134, None, "2009"),     # Maria-sama ga Miteru 4th Specials
    (9734, None, "2010"),     # One Piece Recap
    (6156, None, "2009"),     # Bakemonogatari Recap
    (7288, None, "2009"),     # Fullmetal Alchemist: Brotherhood Specials
    (7712, None, "2009"),     # Hanasakeru Seishounen Recaps
    (8766, None, "2010"),     # Kuroshitsuji II Specials
    (9635, None, "2010"),     # Nurarihyon no Mago Recaps
    (9809, None, "2010"),     # Oreimo Specials
    (8046, None, "2011"),     # Ikoku Meiro no Croisee: Yune & Alice
    (10093, None, "2011"),    # R-15 OVA
    (11346, None, "2012"),    # Upotte!! OVA
    (9810, None, "2013"),     # Oreimo 2 Specials
    (8352, None, "2016"),     # Kamisama Hajimemashita Kako-hen
    (30134, None, "2015"),    # Code Geass: Boukoku no Akito 3 Picture Drama
    (6888, None, "2013"),     # Diabolik Lovers Recap
    (7565, None, "2014"),     # Grisaia no Kajitsu Specials
    (7218, None, "2014"),     # Fate/stay night: UBW Prologue
    (23692, None, "2015"),    # Shigatsu wa Kimi no Uso OVA
    (7375, None, "2014"),     # Gekkan Shoujo Nozaki-kun Specials
    (11738, None, "2014"),    # Yuuki Yuuna wa Yuusha de Aru: Hidamari
    (9015, None, "2015"),     # Mahou Shoujo Lyrical Nanoha ViVid: Special Program
    (7568, None, "2015"),     # Grisaia no Rakuen Specials
    (9748, None, "2015"),     # One Punch Man Specials
    (6917, None, "2016"),     # Dimension W Special
    (30546, None, "2016"),    # Akagami no Shirayukihime OVA
    (10136, None, "2020"),    # Re:Zero Shin Henshuu-ban (Director's Cut)
    (23667, None, "2017"),    # Amanchu! OVA
    (5864, None, "2017"),     # Ajin 2nd Season OVA
    (6895, None, "2017"),     # Dies Irae: Reimei
    (7069, None, "2019"),     # DanMachi II: Past & Future Recap
    (6433, None, "2016"),     # Buddy Go! 2
    (22514, None, "2017"),    # Kobayashi-san Chi no Maid Dragon Specials
    (29765, None, "2017"),    # Kishibe Rohan wa Ugokanai: Fugou Mura
    (31280, None, "2021"),    # Hitori no Shita 4.Sezon
    (6350, None, "2017"),     # Boku no Hero Academia 2nd Season: Hero Note
    (9580, None, "2017"),     # No Game No Life: Zero - Manner Movie
    (21714, None, "2018"),    # Grancrest Senki Tsuisou
    (7058, None, "2016"),     # Drifters: The Outlandish Knight
    (7334, None, "2018"),     # Gakuen Babysitters Special
    (31244, None, "2017"),    # Hitori no Shita Movie
    (31315, None, "2024"),    # Quanzhi Fashi VII
    (7782, None, "2017"),     # Heibai Wushang 2nd Season
    (9943, None, "2018"),     # Persona 5 the Animation TV Specials
    (31320, None, "2021"),    # Tong Ling Fei 2nd Season
    (7156, None, "2017"),     # Evil or Live Recap
    (6232, None, "2018"),     # Beatless Intermission
    (9805, None, "2019"),     # Ore ga Suki nano wa Imouto... Specials
    (6056, None, "2019"),     # Arifureta Recap
    (30904, None, "2018"),    # Ze Tian Ji 4.Sezon
    (30907, None, "2020"),    # Ze Tian Ji 5.Sezon
    (11601, None, "2018"),    # Yao Shen Ji 3rd Season
    (11602, None, "2020"),    # Yao Shen Ji 4th Season
    (31002, None, "2023"),    # Soul Land 2
    (8213, None, "2019"),     # JoJo Part 5 Recaps
    (9253, None, "2019"),     # Mini Toji: Kanami-Mihono no
    (11545, None, "2021"),    # Xue Ying Ling Zhu 3rd Season
    (9399, None, "2023"),     # Mushoku Tensei II: Shugo Jutsushi Fitz Episode 0
    (11569, None, "2021"),    # Yakusoku no Neverland: Michishirube Recap
    (9744, None, "2019"),     # One Punch Man 2nd Season Commemorative Special
    (31205, None, "2025"),    # Ling Long: Incarnation 2.Sezon
    (8374, None, "2019"),     # Kandagawa Jet Girls Recap
    (8166, None, "2021"),     # Jaku-Chara Tomozaki-kun Specials
    (11793, None, "2019"),    # Zhen Hun Jie: Bei Luo Shi Men Pian Part 1
    (30885, None, "2022"),    # Jing: Shuang Cheng 2.Sezon
    (11014, None, "2021"),    # Tensei shitara Slime Datta Ken 2nd Season: Kanwa - Veldora Nikki 2
    (8981, None, "2021"),     # Magia Record 2nd Season Recap
    (30209, None, "2024"),    # Boku no Hero Academia: Memories Recap
    (30853, None, "2022"),    # Yuan Long 3.Sezon
    (30727, None, "2022"),    # Shi Xian
    (11501, None, "2021"),    # Wonder Egg Priority Special
    (31307, None, "2024"),    # Shen Mu 3.Sezon
    (10252, None, "2021"),    # Saihate no Paladin: Michiyuki Recap
    (30881, None, "2022"),    # The Success Of Empyrean Xuan Emperor 3.Sezon
    (30960, None, "2023"),    # The Success Of Empyrean Xuan Emperor 4.Sezon
    (31024, None, "2024"),    # The Success Of Empyrean Xuan Emperor 5.Sezon
    (30946, None, "2023"),    # Shen Lan Qi Yu Wushuang Zhu 3.Sezon
    (10778, None, "2023"),    # Star Wars: Visions Season 2
    (30976, None, "2022"),    # I Have Refined Qi For 3000 Years! 2. Sezon
    (30631, None, "2024"),    # Train to the End of the World Recap
    (8572, None, "2024"),     # Kinnikuman Episode 0
    (7593, None, "2023"),     # Gundam Build Metaverse: GUNPLA-KUN!
    (30608, None, "2024"),    # T.P BON 2. Sezon
    (30984, None, "2023"),    # Hua Jianghu: Bu Liang Ren 6.Sezon
    (31184, None, "2024"),    # Hua Jianghu: Bu Liang Ren 7.Sezon
    (6799, None, "2024"),     # Dead Dead Demons Dededede Destruction Episode 0
    (31026, None, "2023"),    # Martial Universe 4.Sezon
    (31157, None, "2025"),    # Martial Universe 5.Sezon
]

TRUE_DUPLICATE_PAIRS = [
    (30087, 7477),   # Girls und Panzer das Finale: Part IV
    (10082, 29482),  # Queen's Blade 2. Sezon
    (7457, 23494),   # Gintama Movie 1
    (9075, 30446),   # Major 3. Sezon
    (9528, 30502),   # New Prince of Tennis / The Prince of Tennis 2. Sezon
    (29932, 8259),   # K-Project / K
    (6271, 29910),   # Bishoujo Senshi Sailor Moon Crystal
    (7458, 7456),    # Gintama Movie 2
    (22058, 6359),   # Boku no Hero Academia Movie 1: Futari no Hero
    (7067, 31077),   # DanMachi II
    (8968, 29995),   # Made in Abyss Movie 2: Wandering Twilight
    (6387, 23285),   # Bokutachi wa Benkyou ga Dekinai OVA
    (8475, 30607),   # Kengan Ashura Part 2
    (1197, 10509),   # Link Click / Shiguang Daili Ren
    (6975, 30380),   # Douluo Dalu 3. Sezon
    (24121, 11175),  # Tonikaku Kawaii: Seifuku
    (8165, 30415),   # Jaku-Chara Tomozaki-kun 2nd Stage
    (6315, 24210),   # Bleach: Sennen Kessen-hen - Ketsubetsu-tan (Part 2)
    (6990, 24061),   # Dr. Stone: New World Part 2
    (9046, 22766),   # Mahoutsukai no Yome Season 2 Part 2
    (9398, 29434),   # Mushoku Tensei II Part 2
    (29793, 6003),   # Blue Exorcist 4. Sezon / Ao no Exorcist: Yuki no Hate-hen
    (6938, 30805),   # Dogulwang / Tomb Raider King
]


def main():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    cur = conn.cursor()

    fixed_ids = []
    for did, new_al, new_yr in ANILIST_FIXES:
        row = cur.execute("SELECT id, title FROM dramas WHERE id=?", (did,)).fetchone()
        if not row:
            continue
        if new_yr:
            cur.execute("UPDATE dramas SET anilist_id=?, release_year=? WHERE id=?", (new_al, new_yr, did))
        else:
            cur.execute("UPDATE dramas SET anilist_id=? WHERE id=?", (new_al, did))
        fixed_ids.append((did, new_al, new_yr))

    conn.commit()
    print(f"[ID Onarımı] {len(fixed_ids)} anime kaydının anilist_id/release_year değeri düzeltildi.", flush=True)

    # Fetch any newly assigned AniList IDs into anilist_relations_cache if missing
    from scripts.fetch_franchise_metadata import fetch_anilist_relations
    fetch_anilist_relations(conn)

    endpoint, access_key, secret_key, bucket = _load_r2_creds()
    s3_client = None
    if endpoint and access_key and secret_key and bucket:
        try:
            import boto3
            from botocore.config import Config
            s3_client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name="auto",
                config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
            )
        except Exception:
            pass

    for p_id, d_id in TRUE_DUPLICATE_PAIRS:
        p_row = cur.execute("SELECT id, title, tags, alt_sites FROM dramas WHERE id=?", (p_id,)).fetchone()
        d_row = cur.execute("SELECT id, title, tags, alt_sites FROM dramas WHERE id=?", (d_id,)).fetchone()
        if not p_row or not d_row:
            continue

        dup_eps = cur.execute(
            "SELECT id, season_number, episode_number FROM episodes WHERE drama_id=?",
            (d_id,)
        ).fetchall()
        migrated_eps = 0
        migrated_srcs = 0
        for dep_id, s_num, e_num in dup_eps:
            p_ep = cur.execute(
                "SELECT id FROM episodes WHERE drama_id=? AND season_number=? AND episode_number=?",
                (p_id, s_num, e_num)
            ).fetchone()
            if p_ep:
                target_ep_id = p_ep[0]
                dup_srcs = cur.execute(
                    "SELECT source_name, embed_id, direct_url, provider, fansub, site FROM episode_sources WHERE episode_id=?",
                    (dep_id,)
                ).fetchall()
                for s_name, embed_id, direct_url, provider, fansub, site in dup_srcs:
                    exists = cur.execute(
                        "SELECT id FROM episode_sources WHERE episode_id=? AND (embed_id=? OR direct_url=?)",
                        (target_ep_id, embed_id or "__none__", direct_url or "__none__")
                    ).fetchone()
                    if not exists:
                        cur.execute("""
                            INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                        """, (target_ep_id, s_name, embed_id, direct_url, provider, fansub, site))
                        migrated_srcs += 1
                cur.execute("DELETE FROM episode_sources WHERE episode_id=?", (dep_id,))
                cur.execute("DELETE FROM episodes WHERE id=?", (dep_id,))
            else:
                cur.execute("UPDATE episodes SET drama_id=? WHERE id=?", (p_id, dep_id))
                migrated_eps += 1

        try:
            cur.execute("DELETE FROM series_automations WHERE media_id=?", (d_id,))
            cur.execute("DELETE FROM drama_actors WHERE drama_id=?", (d_id,))
        except Exception:
            pass
        cur.execute("DELETE FROM dramas WHERE id=?", (d_id,))
        conn.commit()

        try:
            sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{d_id}")
            sb_request("DELETE", f"/rest/v1/episodes?media_id=eq.{d_id}")
            sb_request("DELETE", f"/rest/v1/media?id=eq.{d_id}")
        except Exception:
            pass

        local_b = os.path.join(_ROOT, "r2_bundles", "sources", f"{d_id}.json")
        if os.path.exists(local_b):
            try:
                os.remove(local_b)
            except Exception:
                pass
        if s3_client and bucket:
            try:
                s3_client.delete_object(Bucket=bucket, Key=f"sources/{d_id}.json")
            except Exception:
                pass

        sync_drama_bundle_and_counts(conn, cur, p_id)
        print(f"  [MERGE] #{d_id} '{d_row[1]}' -> #{p_id} '{p_row[1]}' (+{migrated_eps} ep, +{migrated_srcs} src)", flush=True)

    for did, new_al, new_yr in fixed_ids:
        body = {"anilist_id": new_al}
        if new_yr and new_yr.isdigit():
            body["release_year"] = int(new_yr)
        try:
            sb_request("PATCH", f"/rest/v1/media?id=eq.{did}", body=body)
        except Exception:
            pass

    conn.close()
    print("[Tamamlandı] Tüm ek ID onarımları ve tekilleştirmeler eşitlendi!", flush=True)


if __name__ == "__main__":
    main()
