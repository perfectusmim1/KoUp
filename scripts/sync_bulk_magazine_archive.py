"""
KoUp Bulk Magazine & News Archive Synchronizer
- Scrapes past 10 pages of AsyaMag (50 posts/page = ~500 articles)
- Scrapes past 25 pages of KoreZin RSS (10 posts/page = ~250 articles)
- Upserts cleanly into Supabase public.magazine_posts
"""

import sys
import os
import re
import html
import time
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://aocvcotmikzlwbaezdpl.supabase.co")
SUPABASE_KEY = os.environ.get(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvY3Zjb3RtaWt6bHdiYWV6ZHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzk2NTEsImV4cCI6MjEwNzcxNTY1MX0.JDmNvA7OKvLjbXYl-yn6CSMdFFBpJ6EFIkTp_eg-qnk",
)
SYNC_SECRET = "koup_sync_secure_token_2026"

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

CAT_MAP = {
    2419: "Dedikodu",
    9: "Kore",
    20: "Dizi",
    10: "Çin",
    6: "BL GL",
    2249: "Japonya",
    2224: "Tayland",
    19: "K-Pop",
    11: "Film",
    1: "Genel",
}

def decode_html(str_val):
    if not str_val:
        return ""
    s = html.unescape(str_val)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def clean_html(raw_html):
    if not raw_html:
        return ""
    h = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", raw_html)
    h = re.sub(r"<script[\s\S]*?<\/script>", "", h, flags=re.I)
    h = re.sub(r"<ins[\s\S]*?<\/ins>", "", h, flags=re.I)
    h = re.sub(r"\(adsbygoogle\s*=\s*window\.adsbygoogle\s*\|\|\s*\[\]\)\.push\(\{.*?\}\);?", "", h, flags=re.I)
    return h.strip()

def call_upsert_post(payload):
    url = f"{SUPABASE_URL}/rest/v1/rpc/upsert_magazine_post"
    body = {
        "p_slug": payload["slug"],
        "p_title": payload["title"],
        "p_excerpt": payload.get("excerpt", ""),
        "p_content_html": payload.get("content_html", ""),
        "p_featured_image": payload.get("featured_image", ""),
        "p_categories": payload.get("categories", ["Magazin"]),
        "p_tags": payload.get("tags", []),
        "p_source_url": payload.get("source_url", ""),
        "p_published_at": payload.get("published_at"),
        "p_sync_secret": SYNC_SECRET,
    }
    try:
        r = requests.post(url, headers=HEADERS, json=body, timeout=15)
        if r.status_code in (200, 201):
            return True
        else:
            print(f"  [RPC Error] {payload['slug']}: {r.status_code} {r.text[:80]}")
    except Exception as e:
        print(f"  [RPC Ex] {payload['slug']}: {e}")
    return False

def sync_asyamag_pages(total_pages=10):
    print(f"\n==========================================")
    print(f"--- [1/2] Syncing AsyaMag Archive ({total_pages} Pages x 50 Posts) ---")
    print(f"==========================================")
    count = 0
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
        "Accept": "application/json",
    })

    for p in range(1, total_pages + 1):
        url = f"https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page=50&page={p}"
        try:
            r = sess.get(url, timeout=20)
            if r.status_code != 200:
                print(f"[AsyaMag] Page {p} returned status {r.status_code}")
                break
            posts = r.json()
            if not posts or not isinstance(posts, list):
                break

            page_added = 0
            for item in posts:
                slug = item.get("slug")
                if not slug:
                    continue
                title = decode_html(item.get("title", {}).get("rendered", ""))
                excerpt = decode_html(item.get("excerpt", {}).get("rendered", ""))
                content = clean_html(item.get("content", {}).get("rendered", ""))

                raw_cats = item.get("categories", [])
                cats = list(set([CAT_MAP.get(cid, "Magazin") for cid in raw_cats if isinstance(cid, int)]))
                if not cats:
                    cats = ["Magazin"]

                featured_img = ""
                emb = item.get("_embedded", {})
                if emb and "wp:featuredmedia" in emb and isinstance(emb["wp:featuredmedia"], list):
                    if len(emb["wp:featuredmedia"]) > 0:
                        featured_img = emb["wp:featuredmedia"][0].get("source_url", "")

                pub_date = item.get("date_gmt")
                if pub_date:
                    pub_date = f"{pub_date}Z"
                else:
                    pub_date = item.get("date")

                payload = {
                    "slug": slug,
                    "title": title,
                    "excerpt": excerpt,
                    "content_html": content,
                    "featured_image": featured_img,
                    "categories": cats,
                    "tags": [],
                    "source_url": item.get("link", f"https://asyamag.com/{slug}/"),
                    "published_at": pub_date,
                }
                if call_upsert_post(payload):
                    count += 1
                    page_added += 1

            print(f"  [AsyaMag Page {p}/{total_pages}] Synced {page_added} posts (Total: {count})")
            time.sleep(0.5)
        except Exception as e:
            print(f"[AsyaMag Page {p} Error]: {e}")

    print(f"AsyaMag sync completed: {count} posts successfully updated in Supabase!")
    return count

def parse_xml_tag(chunk, tag):
    m = re.search(rf"<{tag}[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/{tag}>", chunk, re.I)
    if not m:
        return ""
    return (m.group(1) if m.group(1) is not None else m.group(2) or "").strip()

def parse_all_xml_tags(chunk, tag):
    matches = re.finditer(rf"<{tag}[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/{tag}>", chunk, re.I)
    res = []
    for m in matches:
        v = (m.group(1) if m.group(1) is not None else m.group(2) or "").strip()
        if v:
            res.append(v)
    return res

def extract_image(chunk):
    m = re.search(r'<media:content[^>]+url=["\']([^"\']+)["\']', chunk, re.I)
    if m: return m.group(1)
    m = re.search(r'<enclosure[^>]+url=["\']([^"\']+)["\']', chunk, re.I)
    if m: return m.group(1)
    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', chunk, re.I)
    if m: return m.group(1)
    m = re.search(r'https?:\/\/[^"\'\s<>]+\/wp-content\/uploads\/[^"\'\s<>]+', chunk, re.I)
    if m: return m.group(0)
    return ""

def sync_korezin_pages(total_pages=25):
    print(f"\n==========================================")
    print(f"--- [2/2] Syncing KoreZin RSS Archive ({total_pages} Pages x 10 Posts) ---")
    print(f"==========================================")
    count = 0
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    })

    for p in range(1, total_pages + 1):
        url = f"https://www.korezin.com/feed/?paged={p}" if p > 1 else "https://www.korezin.com/feed/"
        try:
            r = sess.get(url, timeout=20)
            if r.status_code != 200:
                print(f"[KoreZin] Page {p} returned status {r.status_code}")
                break
            xml = r.text
            items = xml.split("<item>")[1:]
            if not items:
                break

            page_added = 0
            for item_chunk in items:
                idx = item_chunk.find("</item>")
                chunk = item_chunk[:idx] if idx != -1 else item_chunk

                raw_title = parse_xml_tag(chunk, "title")
                title = decode_html(raw_title)
                link = parse_xml_tag(chunk, "link")
                pub_date_raw = parse_xml_tag(chunk, "pubDate")
                raw_cats = parse_all_xml_tags(chunk, "category")
                content = clean_html(parse_xml_tag(chunk, "content:encoded") or parse_xml_tag(chunk, "description"))
                excerpt = decode_html(parse_xml_tag(chunk, "description") or content)[:250] + "..."
                featured_img = extract_image(chunk)

                clean_slug = link.rstrip("/").split("/")[-1] if link else ""
                if not clean_slug:
                    clean_slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
                slug = f"kz-{clean_slug}"

                cats = ["Kore", "Magazin"]
                for rc in raw_cats:
                    low = rc.lower()
                    if "k-pop" in low: cats.append("K-Pop")
                    if "dizi" in low: cats.append("Dizi")
                    if "film" in low: cats.append("Film")
                    if "dedikodu" in low or "netizen" in low: cats.append("Dedikodu")
                cats = list(set(cats))

                # parse RFC 822 date to ISO
                pub_iso = None
                try:
                    from email.utils import parsedate_to_datetime
                    if pub_date_raw:
                        pub_iso = parsedate_to_datetime(pub_date_raw).isoformat()
                except Exception:
                    pub_iso = None

                payload = {
                    "slug": slug,
                    "title": title,
                    "excerpt": excerpt,
                    "content_html": content,
                    "featured_image": featured_img,
                    "categories": cats,
                    "tags": raw_cats,
                    "source_url": link or f"https://www.korezin.com/{clean_slug}/",
                    "published_at": pub_iso,
                }
                if call_upsert_post(payload):
                    count += 1
                    page_added += 1

            print(f"  [KoreZin Page {p}/{total_pages}] Synced {page_added} posts (Total: {count})")
            time.sleep(0.5)
        except Exception as e:
            print(f"[KoreZin Page {p} Error]: {e}")

    print(f"KoreZin sync completed: {count} posts successfully updated in Supabase!")
    return count

if __name__ == "__main__":
    print("Starting Bulk Magazine Synchronization...")
    a_cnt = sync_asyamag_pages(10)
    k_cnt = sync_korezin_pages(25)
    print("\n==========================================")
    print(f"TOTAL MAGAZINE POSTS SYNCED: {a_cnt + k_cnt}")
    print("==========================================")
