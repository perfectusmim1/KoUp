import json
import os
import re
import sqlite3
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scrapers.supabase_sync_helper import sb_request

ANILIST_CHARACTERS_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    characters(sort: [ROLE, RELEVANCE, ID], perPage: 25) {
      edges {
        role
        node {
          id
          name { full userPreferred }
          image { large medium }
        }
        voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
          id
          name { full userPreferred }
          image { large medium }
        }
      }
    }
  }
}
"""

def slugify(text: str) -> str:
    s = text.lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"\s+", "-", s).strip("-")
    return s or "actor"

def fetch_characters_for_anime(anilist_id: int):
    req = urllib.request.Request(
        "https://graphql.anilist.co",
        data=json.dumps({"query": ANILIST_CHARACTERS_QUERY, "variables": {"id": anilist_id}}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "KoUp/1.0"}
    )
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    edges = data.get("data", {}).get("Media", {}).get("characters", {}).get("edges", [])
                    return edges
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3)
                continue
            break
        except Exception:
            time.sleep(1)
            continue
    return []

def main():
    conn = sqlite3.connect("webdrama_archive.db")
    cur = conn.cursor()

    # Prioritize popular anime and series that users frequently visit
    # Including Dragon Ball Super: Beerus (30138), Dragon Ball series, One Piece, etc.
    top_anime = cur.execute("""
        SELECT id, title, anilist_id
        FROM dramas
        WHERE content_type = 'anime' AND anilist_id IS NOT NULL AND anilist_id > 0
        ORDER BY
            CASE WHEN id = 30138 THEN 0
                 WHEN title LIKE '%Dragon Ball%' THEN 1
                 WHEN title LIKE '%One Piece%' THEN 2
                 WHEN title LIKE '%Naruto%' THEN 3
                 WHEN title LIKE '%Bleach%' THEN 4
                 ELSE 5 END,
            sources_count DESC
        LIMIT 60
    """).fetchall()

    print(f"Top {len(top_anime)} anime için AniList karakterleri çekiliyor...", flush=True)

    total_cast_added = 0
    for idx, (did, title, aid) in enumerate(top_anime, 1):
        # Check if already has cast in Supabase
        existing = sb_request("GET", f"/rest/v1/media_cast?media_id=eq.{did}&select=person_id&limit=1")
        if isinstance(existing, list) and len(existing) > 0:
            continue

        edges = fetch_characters_for_anime(aid)
        if not edges:
            continue

        cast_entries = []
        for c_idx, edge in enumerate(edges, 1):
            node = edge.get("node") or {}
            vas = edge.get("voiceActors") or []
            va = vas[0] if vas else {}

            char_name = node.get("name", {}).get("full") or node.get("name", {}).get("userPreferred") or ""
            va_name = va.get("name", {}).get("full") or va.get("name", {}).get("userPreferred") or ""
            role_type = "lead" if edge.get("role") == "MAIN" else "support"
            img_url = node.get("image", {}).get("large") or node.get("image", {}).get("medium") or va.get("image", {}).get("large")

            actor_display_name = char_name
            person_slug = slugify(actor_display_name)

            # Check if person already exists in Supabase
            p_res = sb_request("GET", f"/rest/v1/people?slug=eq.{person_slug}&select=id&limit=1")
            person_id = None
            if isinstance(p_res, list) and len(p_res) > 0:
                person_id = p_res[0]["id"]
            else:
                p_create = sb_request("POST", "/rest/v1/people", body={
                    "name": actor_display_name,
                    "slug": person_slug,
                    "image_url": img_url,
                    "person_type": "actor",
                }, prefer="return=representation")
                if isinstance(p_create, list) and len(p_create) > 0:
                    person_id = p_create[0]["id"]

            va_img = va.get("image", {}).get("large") or va.get("image", {}).get("medium")
            va_slug = slugify(va_name) if va_name else None

            if person_id:
                cast_entries.append({
                    "media_id": did,
                    "person_id": person_id,
                    "character_name": f"Seslendiren: {va_name}" if va_name else char_name,
                    "role_type": role_type,
                    "billing_order": c_idx,
                    "voice_actor_name": va_name or None,
                    "voice_actor_image": va_img,
                    "voice_actor_slug": va_slug,
                })

        if cast_entries:
            sb_request("DELETE", f"/rest/v1/media_cast?media_id=eq.{did}")
            res = sb_request("POST", "/rest/v1/media_cast", body=cast_entries)
            if not isinstance(res, dict) or not res.get("_error"):
                total_cast_added += len(cast_entries)
                print(f"  [{idx}/{len(top_anime)}] #{did} '{title}' -> +{len(cast_entries)} karakter/oyuncu eklendi.", flush=True)
            else:
                print(f"  [{idx}/{len(top_anime)}] #{did} '{title}' -> HATA: {res}", flush=True)

        time.sleep(0.4)

    print(f"\n[Başarılı] Toplam {total_cast_added} karakter/oyuncu kaydı Supabase'e işlendi!", flush=True)


if __name__ == "__main__":
    main()
