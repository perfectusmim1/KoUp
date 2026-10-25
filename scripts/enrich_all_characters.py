"""
Enrich all anime characters in Supabase with AniList metadata:
- also_known_as (including alternative names, nicknames, and spoiler aliases)
- native_name (Japanese kanji/katakana/hiragana)
- gender (Erkek / Kadın)
- blood_type
- race (e.g. Saiyan, Shinigami, Human, etc.)
- height (e.g. 175 cm)
- birth_date / age / birth_year
- clean bio_tr (stripping raw attribute key-values from the front of the bio)
"""

import os
import sys
import json
import re
import time
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request

def clean_bio_text(old_bio: str) -> str:
    if not old_bio:
        return ""
    # Strip prefixes like "Irk: Boy: 175 cm ... Doğum Yılı: ... "
    cleaned = re.sub(
        r'^(?:(?:Irk|Boy|Doğum Yılı|Doğum Tarihi|Yaş|Cinsiyet|Kan Grubu):[^\n.]*[\n.]?\s*)+',
        '',
        old_bio,
        flags=re.IGNORECASE
    ).strip()
    return cleaned if cleaned else old_bio

def parse_anilist_char(char):
    c_id = char.get("id")
    name = char.get("name") or {}
    alt = name.get("alternative") or []
    alt_spoiler = name.get("alternativeSpoiler") or []

    aliases = []
    for a in (alt + alt_spoiler):
        if a and isinstance(a, str) and a.strip() and a.strip() not in aliases:
            aliases.append(a.strip())

    native_name = name.get("native") or ""
    desc = char.get("description") or ""

    race = None
    height = None
    birth_year = None

    m_race = re.search(r'(?:__|[*]{1,2})?Race:(?:__|[*]{1,2})?\s*(?:~!)?(.*?)(?:!~)?(?:\n|$)', desc, re.IGNORECASE)
    if m_race:
        r_val = m_race.group(1).strip().strip('~!').strip('__').strip('*').strip()
        if r_val:
            race = r_val

    m_height = re.search(r'(?:__|[*]{1,2})?Height:(?:__|[*]{1,2})?\s*(.*?)(?:\n|$)', desc, re.IGNORECASE)
    if m_height:
        h_val = m_height.group(1).strip().strip('__').strip('*').strip()
        if h_val:
            height = h_val

    m_birth = re.search(r'(?:__|[*]{1,2})?Birth Year:(?:__|[*]{1,2})?\s*(.*?)(?:\n|$)', desc, re.IGNORECASE)
    if m_birth:
        b_val = m_birth.group(1).strip().strip('__').strip('*').strip()
        if b_val:
            birth_year = b_val

    gender_raw = (char.get("gender") or "").lower()
    gender_tr = "Erkek" if "male" in gender_raw and "female" not in gender_raw else ("Kadın" if "female" in gender_raw else char.get("gender"))

    dob = char.get("dateOfBirth") or {}
    dob_str = None
    if dob.get("year") and dob.get("month") and dob.get("day"):
        dob_str = f"{dob['year']}-{str(dob['month']).padStart(2, '0') if hasattr(str(dob['month']), 'padStart') else str(dob['month']).zfill(2)}-{str(dob['day']).zfill(2)}"
    elif birth_year:
        dob_str = birth_year
    elif char.get("age"):
        dob_str = f"{char['age']} Yaşında"

    return {
        "anilist_id": c_id,
        "native_name": native_name,
        "aliases": aliases,
        "gender": gender_tr,
        "blood_type": char.get("bloodType"),
        "race": race,
        "height": height,
        "birth_date": dob_str,
    }

def main():
    print("--- AniList Karakter Zenginleştirme Başlatılıyor ---")
    # Fetch all characters from Supabase
    limit = 1000
    chars = sb_request("GET", f"/rest/v1/people?person_type=eq.character&anilist_id=not.is.null&select=id,name,anilist_id,also_known_as,native_name,gender,blood_type,race,height,birth_date,bio_tr&limit={limit}")
    if not chars:
        print("Karakter bulunamadı.")
        return

    print(f"Toplam {len(chars)} adet karakter bulundu.")

    # Group into batches of 25
    batch_size = 25
    total_updated = 0

    for i in range(0, len(chars), batch_size):
        chunk = chars[i:i + batch_size]
        # Build GraphQL multi-query
        query_parts = []
        for idx, c in enumerate(chunk):
            query_parts.append(f"""
            c{idx}: Character(id: {c['anilist_id']}) {{
                id
                name {{ full native alternative alternativeSpoiler }}
                gender
                bloodType
                dateOfBirth {{ year month day }}
                age
                description
            }}
            """)

        full_query = "query {\n" + "\n".join(query_parts) + "\n}"
        try:
            r = requests.post(
                "https://graphql.anilist.co",
                json={"query": full_query},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=12
            )
            if r.status_code == 200:
                res_data = r.json().get("data") or {}
                for idx, c in enumerate(chunk):
                    raw_char = res_data.get(f"c{idx}")
                    if not raw_char:
                        continue
                    parsed = parse_anilist_char(raw_char)

                    # Prepare patch
                    patch = {}
                    if parsed["native_name"] and parsed["native_name"] != c.get("native_name"):
                        patch["native_name"] = parsed["native_name"]

                    # Combine existing aliases with new ones
                    existing_aliases = c.get("also_known_as") or []
                    all_aliases = list(dict.fromkeys(existing_aliases + parsed["aliases"]))
                    if all_aliases and all_aliases != existing_aliases:
                        patch["also_known_as"] = all_aliases

                    if parsed["gender"] and parsed["gender"] != c.get("gender"):
                        patch["gender"] = parsed["gender"]

                    if parsed["blood_type"] and parsed["blood_type"] != c.get("blood_type"):
                        patch["blood_type"] = parsed["blood_type"]

                    if parsed["race"] and parsed["race"] != c.get("race"):
                        patch["race"] = parsed["race"]

                    if parsed["height"] and parsed["height"] != c.get("height"):
                        patch["height"] = parsed["height"]

                    if parsed["birth_date"] and not c.get("birth_date"):
                        patch["birth_date"] = parsed["birth_date"]

                    # Clean bio if needed
                    old_bio = c.get("bio_tr") or ""
                    cleaned_bio = clean_bio_text(old_bio)
                    if cleaned_bio != old_bio:
                        patch["bio_tr"] = cleaned_bio

                    if patch:
                        sb_request("PATCH", f"/rest/v1/people?id=eq.{c['id']}", body=patch)
                        total_updated += 1

                print(f"[{i + len(chunk)}/{len(chars)}] işlendi. Güncellenen: {total_updated}")
            elif r.status_code == 429:
                print("AniList rate limit hit, 60s bekleniyor...")
                time.sleep(60)
            else:
                print(f"AniList query hatası: {r.status_code}")
        except Exception as e:
            print(f"Hata: {e}")

        time.sleep(0.8) # Respect rate limits

    print(f"--- Tamamlandı! Toplam güncellenen karakter sayısı: {total_updated} ---")

if __name__ == "__main__":
    main()
