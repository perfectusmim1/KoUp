import sqlite3
import json
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import (
    sb_request,
    _load_r2_creds,
    sync_drama_bundle_and_counts,
    backup_db_to_r2,
)

# 1. Exact ID / Metadata Corrections
# Format: drama_id -> dict of column updates for SQLite (and Supabase where applicable)
ID_CORRECTIONS = {
    # Non-anime rows with bogus anilist_id
    31756: {"anilist_id": None, "anilist_url": None, "tmdb_id": 23682},  # Büyük Umutlar (1998)
    46315: {"anilist_id": None, "anilist_url": None},
    46317: {"anilist_id": None, "anilist_url": None},
    46319: {"anilist_id": None, "anilist_url": None},
    46321: {"anilist_id": None, "anilist_url": None},
    15517: {"anilist_id": None, "anilist_url": None},  # Solo Camping For Two (Live-Action J-drama)
    32456: {"content_type": "film", "anilist_id": None, "anilist_url": None, "tmdb_id": 38073, "imdb_id": "tt1414382"},  # Yine mi Sen? (You Again 2010)
    46318: {"content_type": "anime"},  # Magical Girl Raising Project: Restart
    31296: {"content_type": "anime"},  # Xian Jian Qi Xia Chuan San (asyaanimeleri donghua)

    # Dragon Ball fixes
    23828: {"anilist_id": 904, "anilist_url": "https://anilist.co/anime/904", "tmdb_id": 39106, "imdb_id": "tt0142235", "title": "Dragon Ball Z Movie 11: Super Senshi Gekiha!! Katsu no wa Ore da"},
    7032:  {"anilist_id": 986, "anilist_url": "https://anilist.co/anime/986"},
    7036:  {"anilist_id": 22695, "anilist_url": "https://anilist.co/anime/22695"},
    7029:  {"release_year": "2013"},  # Dragon Ball Z Movie 14: Kami to Kami (2013, not 1997)
    6998:  {"release_year": "2011"},  # Dragon Ball: Episode of Bardock (2011, not 2021)

    # Wrong AniList IDs on anime seasons/movies
    8020:  {"anilist_id": 87495, "anilist_url": "https://anilist.co/anime/87495"},   # IDOLiSH7
    10757: {"anilist_id": 3470, "anilist_url": "https://anilist.co/anime/3470", "release_year": "2008"},  # Special A
    29996: {"anilist_id": 4311, "anilist_url": "https://anilist.co/anime/4311", "release_year": "2008"},  # Death Note Relight 2
    24037: {"anilist_id": 108861, "anilist_url": "https://anilist.co/anime/108861"}, # Bokutachi wa Benkyou ga Dekinai OVA
    9650:  {"anilist_id": 10500, "anilist_url": "https://anilist.co/anime/10500", "tmdb_id": None, "imdb_id": None},  # Ojiisan no Lamp
    30137: {"anilist_id": None, "anilist_url": None},
    8538:  {"anilist_id": 21519, "anilist_url": "https://anilist.co/anime/21519"},   # Kimi no Na wa.
    10533: {"anilist_id": 6112, "anilist_url": "https://anilist.co/anime/6112"},     # Shin Koihime†Musou
    10970: {"anilist_id": 6444, "anilist_url": "https://anilist.co/anime/6444"},     # Tegamibachi
    29910: {"anilist_id": 14751, "anilist_url": "https://anilist.co/anime/14751", "title": "Bishoujo Senshi Sailor Moon Crystal"},
    6899:  {"anilist_id": 114811, "anilist_url": "https://anilist.co/anime/114811"}, # Digimon Adventure (2020)
    6875:  {"anilist_id": 171048, "anilist_url": "https://anilist.co/anime/171048"}, # Devil May Cry (2025)
    9455:  {"release_year": "2005"},                                                 # Naruto Movie 2
    9456:  {"anilist_id": 2144, "anilist_url": "https://anilist.co/anime/2144"},     # Naruto Movie 3
    8520:  {"anilist_id": 129874, "anilist_url": "https://anilist.co/anime/129874", "release_year": "2021"}, # Kimetsu no Yaiba: Mugen Ressha-hen (TV)
    31197: {"anilist_id": 178005, "anilist_url": "https://anilist.co/anime/178005", "release_year": "2025"}, # Kimetsu no Yaiba Movie: Mugen Jou-hen
    24210: {"anilist_id": 159322, "anilist_url": "https://anilist.co/anime/159322"}, # Bleach: Sennen Kessen-hen Part 2
    11030: {"anilist_id": 116743, "anilist_url": "https://anilist.co/anime/116743"}, # Tensura Nikki
    9286:  {"anilist_id": 116220, "anilist_url": "https://anilist.co/anime/116220"}, # Mo Dao Zu Shi Q
    9528:  {"anilist_id": 11371, "anilist_url": "https://anilist.co/anime/11371"},   # New Prince of Tennis
    1197:  {"anilist_id": 126403, "anilist_url": "https://anilist.co/anime/126403"}, # Link Click S1
    6041:  {"anilist_id": None, "anilist_url": None, "tmdb_id": 94605, "imdb_id": "tt11126994"}, # Arcane Season 2
    8248:  {"anilist_id": 636, "anilist_url": "https://anilist.co/anime/636", "release_year": "2004"}, # Juubee-chan 2
    6468:  {"anilist_id": 2684, "anilist_url": "https://anilist.co/anime/2684"},     # Buzzer Beater 2nd Season
    7475:  {"anilist_id": 104722, "anilist_url": "https://anilist.co/anime/104722"}, # Girls & Panzer: Saishuushou Part 3
    7477:  {"anilist_id": 104723, "anilist_url": "https://anilist.co/anime/104723"}, # Girls & Panzer: Saishuushou Part 4

    # Wrong TMDB / IMDb / MDL collisions
    25532: {"tmdb_id": 113268, "imdb_id": "tt13273826", "mydramalist_url": "https://mydramalist.com/62085-a-wonderful-rumor"}, # Gyeongiroun Somun (The Uncanny Counter)
    19869: {"tmdb_id": 124364, "imdb_id": "tt14518284", "mydramalist_url": "https://mydramalist.com/72855-i-know-but"},        # Algoissjiman (Nevertheless)
    24527: {"tmdb_id": 80963,  "imdb_id": "tt8487158"},   # Aneun Waipeu (Familiar Wife)
    26693: {"tmdb_id": 124365, "imdb_id": "tt14518332"},  # Raketsonyeondan (Racket Boys)
    26948: {"tmdb_id": 99494,  "imdb_id": "tt12268466"},  # Ssanggabpocha (Mystic Pop-up Bar)
    28001: {"tmdb_id": 103759},                           # Old School Intern
    7056:  {"tmdb_id": None, "imdb_id": None},            # Drifters (OVA)
    11049: {"tmdb_id": 230529, "imdb_id": "tt28349051"},  # The Fable (2024 Anime)
    11510: {"tmdb_id": None, "imdb_id": None},            # Working!!!: Lord of the Takanashi
    10557: {"tmdb_id": 1429, "imdb_id": "tt2560140"},     # Shingeki no Kyojin Season 3 Part 2
    10778: {"tmdb_id": 114478, "imdb_id": "tt13622982"},  # Star Wars: Visions Season 2
    9072:  {"tmdb_id": 39483, "imdb_id": "tt1337142"},    # Major Movie: Yuujou no Winning Shot
    10467: {"tmdb_id": 42705, "imdb_id": "tt1029248", "release_year": "2007"}, # Seto no Hanayome
    11231: {"imdb_id": "tt3919260", "release_year": "2014"}, # Trinity Seven
    34813: {"mydramalist_url": None},                     # The Legend Of Hei 2
}

# 2. Verified True Duplicate Pairs/Groups -> (primary_id, [duplicate_ids])
# Every group here has been verified to be the exact same work/season/movie.
VERIFIED_MERGE_GROUPS = [
    # Dragon Ball duplicates
    (7018,  [22348]),  # Dragon Ball Z Movie 03
    (7028,  [22356]),  # Dragon Ball Z Movie 13
    (7011,  [42085]),  # Dragon Ball Super: Broly

    # 25 Cross-type (Anime + Film) identical anime movies sharing (tmdb_id, imdb_id)
    (9259,  [42252]),  # Mirai no Mirai
    (10005, [42099]),  # Pokemon Movie 21
    (9444,  [42212]),  # Nanatsu no Taizai Movie: Tenkuu no Torawarebito
    (8552,  [36287]),  # Kimitachi wa Dou Ikiru ka / The Boy and the Heron
    (7511,  [42171]),  # Godzilla 3: Hoshi wo Kuu Mono
    (9723,  [40556]),  # One Piece Movie 14: Stampede
    (10991, [41296]),  # Tenki no Ko / Weathering With You
    (10006, [40389]),  # Pokemon Movie 22: Mewtwo Evolution
    (8340,  [38767]),  # Kamiarizuki no Kodomo / Child of Kamiari Month
    (8223,  [39427]),  # Josee to Tora to Sakana-tachi
    (10007, [39904]),  # Pokemon Movie 23: Koko
    (6361,  [38891]),  # Boku no Hero Academia the Movie 3: World Heroes' Mission
    (6284,  [36296]),  # Black Clover: Mahou Tei no Ken
    (9443,  [39147]),  # Nanatsu no Taizai Movie 2: Cursed by Light
    (5908,  [36080]),  # Alice to Therese no Maboroshi Koujou
    (5940,  [36943]),  # Ame wo Tsugeru Hyouryuu Danchi / Drifting Home
    (11594, [36622]),  # Yaneura no Rudger / The Imaginary
    (10860, [37397]),  # Suzume no Tojimari
    (9335,  [35240]),  # Mononoke Movie: Karakasa
    (9436,  [37308]),  # Nanatsu no Taizai: Ensa no Edinburgh Part 1
    (9437,  [36395]),  # Nanatsu no Taizai: Ensa no Edinburgh Part 2
    (6549,  [34338]),  # Chainsaw Man Movie: Reze-hen
    (10828, [35834]),  # Suki demo Kirai na Amanojaku / My Oni Girl
    (7732,  [35793]),  # Hanma Baki vs. Kengan Ashura
    (9560,  [34408]),  # Ninja Batman tai Yakuza League

    # Verified Anime + Anime / Anime + Dizi duplicates
    (8067,  [29926]),  # Initial D First Stage
    (9024,  [30066]),  # Mahou Shoujo Pretty Sammy (1996) / Magical Project S
    (7371,  [29736]),  # Gedo Senki
    (7989,  [29940]),  # Hyakka Ryouran: Samurai Girls
    (8401,  [30061]),  # Kara no Kyoukai 1
    (8402,  [30121]),  # Kara no Kyoukai 2
    (8404,  [30078]),  # Kara no Kyoukai 4
    (8405,  [30051]),  # Kara no Kyoukai 5
    (7150,  [29936]),  # Evangelion Movie 1: Jo / 1.0
    (7151,  [23509]),  # Evangelion Movie 2: Ha / 2.0
    (10479, [30400]),  # Shakugan no Shana II
    (10986, [22917]),  # Tengen Toppa Gurren Lagann Movie 2
    (10791, [24237]),  # Steins;Gate Movie: Fuka Ryouiki no Déjà vu
    (11622, [30150]),  # Yichang Shengwu Jianwenlu / Journal of the Mysterious Creatures
    (10644, [19279, 26922]),  # Shuumatsu no Walküre / Record of Ragnarok
    (6211,  [24688]),  # Bastard!! Ankoku no Hakaishin (ONA)
    (8219,  [18722]),  # JoJo no Kimyou na Bouken (TV)
    (10258, [26951]),  # Saiki Kusuo no Ψ-nan (TV)
    (10257, [26950]),  # Saiki Kusuo no Ψ-nan: Shidou-hen
    (7901,  [33650]),  # Hisone to Maso-tan / Dragon Pilot
    (10543, [22024]),  # Shinchou Yuusha
    (6040,  [19866]),  # Arcane Season 1
    (11624, [16112]),  # Yingxiong Zai Lin / Hero Return
    (8628,  [24316]),  # Koi to Producer: EVOL×LOVE
    (9899,  [33361]),  # Pacific Rim: The Black
    (8688,  [25914]),  # Kotarou wa Hitorigurashi
    (9331,  [20019]),  # Mononogatari
    (7877,  [29454]),  # Hikari no Ou / The Fire Hunter
    (6347,  [33177]),  # Boku no Daemon / My Daemon
    (8195,  [20027]),  # Jijou wo Shiranai Tenkousei ga Guigui Kuru / My Clueless First Friend
    (7224,  [15197]),  # Fermat no Ryouri
    (9202,  [33294]),  # Meitantei Conan: Zero no Tea Time
    (7519,  [25529]),  # Gokushufudou
    (11224, [23402]),  # Trickster
    (8858,  [30304]),  # Ling Qi / Spirit Pact
    (10499, [27551]),  # Shi Xiong / Zombie Brother
    (7372,  [29976]),  # Gegege no Kitarou (2018)
    (6885,  [28013]),  # Di Wang Gong Lue / The Emperor's Strategy
    (6627,  [11526]),  # Cike Wu Liuqi / Scissor Seven
    (8806,  [33539]),  # Kyouryuu Shoujo Gauko / Dino Girl Gauko
    (6734,  [27565]),  # Da Wang Bu Gaoxing / The Furious Yama
    (11444, [30702]),  # Wan Sheng Jie 2
    (11084, [30773]),  # Tian Mei De Yao Hen / Sweet Bite Marks
    (10378, [29689]),  # Seirei Gensouki 2
    (31035, [31270]),  # The Age of Cosmos Exploration / Da Yuzhou Shidai
    (9773,  [26439]),  # Onmyouji
    (31331, [31027]),  # Lian Qi Shi Wan Nian / One Hundred Thousand Layers of Body Refining
    (10238, [23532]),  # S-Rank Monster no Behemoth / Beheneko
    (10492, [29722]),  # Shangri-La Frontier 2nd Season
    (9667,  [42905]),  # Omagoto / Roll Over and Die
    (17686, [8735]),   # The All-Devouring Whale: Homecoming / Kun Tun Tianxia
    (8118,  [30487]),  # Isekai Nonbiri Nouka 2
    (30793, [31065]),  # Qi Refining for 3000 Years

    # Verified Dizi / Film duplicates (English vs Native vs Turkish titles)
    (69,    [15153]),  # Be My Boyfriend
    (23570, [124]),    # Who Stole My Kiss / Who Kissed Me
    (233,   [24675]),  # A Business Proposal
    (341,   [25905]),  # Big Bet / Kajino
    (432,   [20441]),  # Star Struck
    (534,   [24728]),  # Vagabond / Baegabondeu
    (15219, [668]),    # Weak Hero Class 1
    (744,   [19496]),  # Cheer Up
    (869,   [28913]),  # Ishiko and Haneo
    (1094,  [30588]),  # High School Return of a Gangster
    (1129,  [26942]),  # It's Okay to Not Be Okay / Saikojiman Gwaenchanha
    (1423,  [30554]),  # Kimi to Yukite Saku / With You I Bloom
    (2027,  [20875]),  # Why R U?
    (28393, [33291]),  # 3 Tonelada$
    (33030, [18807, 26350]), # No One Saw Us Leave / Nadie nos vio partir / Gittiğimizi Kimse Görmedi
    (15328, [15263]),  # Marry Me Mary
    (15325, [15295]),  # Marrying A Millionaire
    (33677, [28383]),  # 13 Reasons Why / Ölmek İçin On Üç Sebep
    (33509, [27634]),  # The Dark Crystal: Age of Resistance
    (19402, [33635]),  # Narcos: Mexico
    (33542, [25541]),  # Glow Up
    (33552, [24976]),  # Criminal UK
    (33550, [24977]),  # Criminal Spain
    (33530, [24978]),  # Criminal France
    (24802, [24622]),  # Bäckström
    (33500, [25668]),  # History 101
    (33366, [26453]),  # One of Us Is Lying
    (17824, [46293]),  # Dark Matter
    (19203, [17787]),  # Bambai Meri Jaan / Sevgilim Bombay
    (15202, [20219]),  # The Perfect Deal
    (15302, [19538]),  # Can We Be Strangers / Strangers Again
    (21459, [28823]),  # On A Starry Night / Hoshi Furu Yoru Ni
    (33176, [19269]),  # A Girl and an Astronaut
    (33170, [19268]),  # Luden / The Pimp
    (22668, [29208]),  # Hello Beautiful Life / May All Your Wishes Come True
    (33179, [19242]),  # The Gryphon / Grifon
    (23165, [28788]),  # Mr Tsukuyomis Forbidden Midnight Snack
    (18696, [32905]),  # Stranger Things: Tales from '85
    (18930, [25731]),  # The Leopard / Il Gattopardo
    (21697, [21889]),  # Stay With Me (2023)
    (33149, [19802]),  # Absolute Beginners / İlk Aşk İlk Film
    (19207, [33182]),  # Perşembe Dulları / Thursdays Widows
    (33186, [19199]),  # Pact of Silence / Sessizlik Andı
    (22365, [21927]),  # Fearless
    (19995, [20799]),  # Islands (2024)
    (24397, [20897]),  # Love On a Shoestring
    (25971, [18405]),  # Love Is Blind: Germany
    (27168, [19032]),  # The Office (2024)
    (18785, [25241]),  # The Crystal Cuckoo / El cuco de cristal
    (18661, [32575]),  # Cape Fear
    (18964, [19767]),  # Public Disorder / ACAB
    (25938, [32835]),  # L’Été 36 / Summer 36
    (2152,  [15616]),  # Avenues of the Diamond
    (2293,  [32958]),  # Watashi no Otto to Kekkon Shite / Marry My Husband Japan
    (18650, [32915]),  # Brazil '70: The Third Star
    (32861, [25342]),  # Wrath - Furia (2026)
    (25046, [18649]),  # Due spicci / My 2 Cents
    (2786,  [15313]),  # My Husband Is a Mafia Boss
    (40969, [38306]),  # The Translators
    (40328, [41033]),  # Windstorm 4
    (39824, [40124]),  # Sniper: Assassin's End
    (42311, [39381]),  # The Vanished / Kaybolan
    (37581, [37280]),  # Beast (2022)
    (36860, [17162]),  # The Wandering Earth II
    (41106, [28674]),  # EXIT / Eksiteu
    (35918, [28085]),  # Smugglers
    (18973, [25485]),  # The Breakthrough / Genombrottet
    (32839, [14889]),  # The Perfect Lie / De Eetclub
    (33805, [25709]),  # Marvel’s Hulk and the Agents of S.M.A.S.H
    (33773, [28426]),  # Trapped / Ófærð
    (33731, [28394]),  # 3%
    (33589, [26594]),  # The Hook Up Plan / Plan Coeur
    (23767, [23038]),  # Game Rak Ao Keun
    (24104, [21689]),  # Love Is Phantom
    (24364, [15090]),  # Ai Chans Secret / Himitsu No Ai Chan
    (24170, [23332]),  # Hitman In Love / Boku No Satsui Ga Koi Wo Shita
    (33414, [25299]),  # Elite Short Stories: Samuel Omar
    (24495, [21613]),  # These Black Black Eyes / Yeh Kaali Kaali Ankhein
    (22895, [28883]),  # Daughter Back Return Of The Heiress
    (26241, [33313]),  # Mr Good: Cop or Crook?
    (23976, [20015]),  # Love Starts From Marriage (S1)
    (19311, [33241]),  # The Watcher / Gözcü
    (27220, [33139]),  # The Railway Men: The Untold Story of Bhopal 1984
    (15106, [19977]),  # Numbers (2023)
    (20117, [29096]),  # First Kisses / First 33 Kisses
    (33004, [18914]),  # 7 Bears / Yedi Ayıcık
    (33011, [18954]),  # Shafted / Erkek Adamlar
    (18689, [25943]),  # The House of the Spirits / La Casa de los Espíritus
    (19023, [33036]),  # Children of the Church Steps
    (2601,  [15314]),  # Spring Fever (2026)
    (26778, [18871]),  # Saare Jahan Se Accha
    (32611, [18525]),  # Nemesis (2026)
]


def run_step1():
    db_path = os.path.join(_ROOT, "webdrama_archive.db")
    conn = sqlite3.connect(db_path, timeout=60)
    cur = conn.cursor()

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
        except Exception as e:
            print(f"[R2 Init Warning] {e}", flush=True)

    def delete_r2_bundle(drama_id):
        local_bundle = os.path.join(_ROOT, "r2_bundles", "sources", f"{drama_id}.json")
        if os.path.exists(local_bundle):
            try:
                os.remove(local_bundle)
            except Exception:
                pass
        if s3_client and bucket:
            try:
                s3_client.delete_object(Bucket=bucket, Key=f"sources/{drama_id}.json")
            except Exception as e:
                print(f"    [R2 Error] Delete sources/{drama_id}.json: {e}", flush=True)

    print("=== ADIM 1A: Hatalı ID ve Yıl Düzeltmeleri Uygulanıyor ===", flush=True)
    fixed_count = 0
    for did, updates in ID_CORRECTIONS.items():
        row = cur.execute("SELECT id, title FROM dramas WHERE id = ?", (did,)).fetchone()
        if not row:
            continue
        set_clauses = []
        vals = []
        sb_body = {}
        for col, val in updates.items():
            set_clauses.append(f"{col} = ?")
            vals.append(val)
            if col == "release_year":
                sb_body[col] = int(val) if val and str(val).isdigit() else None
            else:
                sb_body[col] = val
        vals.append(did)
        cur.execute(f"UPDATE dramas SET {', '.join(set_clauses)} WHERE id = ?", vals)
        conn.commit()
        try:
            sb_request("PATCH", f"/rest/v1/media?id=eq.{did}", body=sb_body)
        except Exception as e:
            print(f"  [SB Warning] #{did}: {e}", flush=True)
        fixed_count += 1
        print(f"  [Fixed] #{did} '{row[1]}': {updates}", flush=True)

    print(f"\nToplam {fixed_count} kaydın ID/Yıl/Tür bilgisi düzeltildi.\n", flush=True)

    print("=== ADIM 1B: Doğrulanmış Mükerrer (Kopya) Kayıtlar Birleştiriliyor ===", flush=True)
    merged_count = 0
    migrated_eps = 0
    migrated_srcs = 0

    for p_id, dup_ids in VERIFIED_MERGE_GROUPS:
        p_row = cur.execute("""
            SELECT id, title, slug, content_type, release_year, cover_image,
                   anilist_id, imdb_id, tmdb_id, native_title, tags, alt_sites, country
            FROM dramas WHERE id = ?
        """, (p_id,)).fetchone()
        if not p_row:
            continue

        p_title = p_row[1]
        p_tags = []
        if p_row[10]:
            try:
                p_tags = json.loads(p_row[10]) if isinstance(p_row[10], str) else list(p_row[10])
            except Exception:
                p_tags = [s.strip() for s in str(p_row[10]).split(",") if s.strip()]

        p_alt_sites = set()
        if p_row[11]:
            try:
                p_alt_sites.update(json.loads(p_row[11]) if isinstance(p_row[11], str) else p_row[11])
            except Exception:
                p_alt_sites.update(s.strip() for s in str(p_row[11]).split(",") if s.strip())

        dup_titles_added = []
        any_merged = False

        for d_id in dup_ids:
            d_row = cur.execute("""
                SELECT id, title, slug, content_type, release_year, cover_image,
                       anilist_id, imdb_id, tmdb_id, native_title, tags, alt_sites, country
                FROM dramas WHERE id = ?
            """, (d_id,)).fetchone()
            if not d_row:
                continue

            any_merged = True
            d_title = d_row[1]
            print(f"  [Merge] #{d_id} '{d_title}' --> Primary #{p_id} '{p_title}'", flush=True)

            if d_title and d_title not in p_tags and d_title != p_title:
                p_tags.append(d_title)
                dup_titles_added.append(d_title)

            if d_row[10]:
                try:
                    d_tags = json.loads(d_row[10]) if isinstance(d_row[10], str) else list(d_row[10])
                except Exception:
                    d_tags = [s.strip() for s in str(d_row[10]).split(",") if s.strip()]
                for t_item in d_tags:
                    if t_item and t_item not in p_tags:
                        p_tags.append(t_item)

            if d_row[11]:
                try:
                    p_alt_sites.update(json.loads(d_row[11]) if isinstance(d_row[11], str) else d_row[11])
                except Exception:
                    p_alt_sites.update(s.strip() for s in str(d_row[11]).split(",") if s.strip())

            # Backfill missing IDs on primary
            if not p_row[9] and d_row[9]:
                cur.execute("UPDATE dramas SET native_title = ? WHERE id = ?", (d_row[9], p_id))
            if not p_row[6] and d_row[6]:
                cur.execute("UPDATE dramas SET anilist_id = ? WHERE id = ?", (d_row[6], p_id))
            if not p_row[7] and d_row[7]:
                cur.execute("UPDATE dramas SET imdb_id = ? WHERE id = ?", (d_row[7], p_id))
            if not p_row[8] and d_row[8]:
                cur.execute("UPDATE dramas SET tmdb_id = ? WHERE id = ?", (d_row[8], p_id))
            if (not p_row[5] or p_row[5] == "/logo-dark.png") and d_row[5] and d_row[5] != "/logo-dark.png":
                cur.execute("UPDATE dramas SET cover_image = ? WHERE id = ?", (d_row[5], p_id))

            # Migrate episodes & sources
            dup_eps = cur.execute(
                "SELECT id, season_number, episode_number, episode_name, episode_url FROM episodes WHERE drama_id = ?",
                (d_id,)
            ).fetchall()

            for dep_id, s_num, e_num, ep_name, ep_url in dup_eps:
                p_ep = cur.execute(
                    "SELECT id FROM episodes WHERE drama_id = ? AND season_number = ? AND episode_number = ?",
                    (p_id, s_num, e_num)
                ).fetchone()

                if p_ep:
                    target_ep_id = p_ep[0]
                    dup_srcs = cur.execute(
                        "SELECT source_name, embed_id, direct_url, provider, fansub, site FROM episode_sources WHERE episode_id = ?",
                        (dep_id,)
                    ).fetchall()
                    for s_name, embed_id, direct_url, provider, fansub, site in dup_srcs:
                        exists = cur.execute(
                            "SELECT id FROM episode_sources WHERE episode_id = ? AND (embed_id = ? OR direct_url = ?)",
                            (target_ep_id, embed_id or "__none__", direct_url or "__none__")
                        ).fetchone()
                        if not exists:
                            cur.execute("""
                                INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, fansub, site, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                            """, (target_ep_id, s_name, embed_id, direct_url, provider, fansub, site))
                            migrated_srcs += 1
                    cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (dep_id,))
                    cur.execute("DELETE FROM episodes WHERE id = ?", (dep_id,))
                else:
                    cur.execute("UPDATE episodes SET drama_id = ? WHERE id = ?", (p_id, dep_id))
                    migrated_eps += 1

            try:
                cur.execute("UPDATE OR IGNORE drama_actors SET drama_id = ? WHERE drama_id = ?", (p_id, d_id))
                cur.execute("DELETE FROM drama_actors WHERE drama_id = ?", (d_id,))
            except Exception:
                pass
            try:
                cur.execute("DELETE FROM series_automations WHERE media_id = ?", (d_id,))
            except Exception:
                pass

            cur.execute("DELETE FROM episode_sources WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)", (d_id,))
            cur.execute("DELETE FROM episodes WHERE drama_id = ?", (d_id,))
            cur.execute("DELETE FROM dramas WHERE id = ?", (d_id,))
            conn.commit()

            try:
                sb_request("DELETE", f"/rest/v1/series_automations?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/episodes?media_id=eq.{d_id}")
                sb_request("DELETE", f"/rest/v1/media?id=eq.{d_id}")
            except Exception as e:
                print(f"    [SB Clean Warning] #{d_id}: {e}", flush=True)

            delete_r2_bundle(d_id)
            merged_count += 1

        if any_merged:
            final_alt_sites = json.dumps(sorted(list(p_alt_sites))) if p_alt_sites else None
            final_tags = json.dumps(p_tags, ensure_ascii=False) if p_tags else None
            cur.execute("UPDATE dramas SET alt_sites = ?, tags = ? WHERE id = ?", (final_alt_sites, final_tags, p_id))
            conn.commit()

            if dup_titles_added:
                try:
                    sb_media = sb_request("GET", f"/rest/v1/media?id=eq.{p_id}&select=aka_titles")
                    existing_aka = []
                    if isinstance(sb_media, list) and sb_media and sb_media[0].get("aka_titles"):
                        existing_aka = list(sb_media[0]["aka_titles"])
                    for dt in dup_titles_added:
                        if dt not in existing_aka and dt != p_title:
                            existing_aka.append(dt)
                    if existing_aka:
                        sb_request("PATCH", f"/rest/v1/media?id=eq.{p_id}", body={"aka_titles": existing_aka})
                except Exception:
                    pass

            sync_drama_bundle_and_counts(conn, cur, p_id)

    print(f"\nToplam {merged_count} kopya kayıt birleştirildi ({migrated_eps} bölüm, {migrated_srcs} kaynak aktarıldı).", flush=True)

    print("[WAL Checkpoint] SQLite WAL checkpoint yapılıyor...", flush=True)
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    conn.commit()
    conn.close()

    print("[R2 Backup] webdrama_archive.db Cloudflare R2'ye yedekleniyor...", flush=True)
    try:
        backup_db_to_r2()
        print("[R2 Backup] Tamamlandı.", flush=True)
    except Exception as e:
        print(f"[R2 Backup Warning] {e}", flush=True)


if __name__ == "__main__":
    run_step1()
