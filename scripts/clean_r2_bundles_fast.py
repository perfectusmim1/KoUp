#!/usr/bin/env python3
"""
Fast multi-threaded scanner to clean fansub and source_name in r2_bundles/sources/*.json
"""

import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from scrapers.clean_fansub import clean_fansub_name, clean_source_name

SOURCES_DIR = os.path.join(ROOT_DIR, "r2_bundles", "sources")

def process_file(entry_path):
    try:
        with open(entry_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    changed = False
    episodes = data.get("episodes", [])
    for ep in episodes:
        for s in ep.get("sources", []):
            old_f = s.get("fansub")
            new_f = clean_fansub_name(old_f)
            if old_f != new_f:
                s["fansub"] = new_f
                changed = True

            old_name = s.get("source_name")
            if old_name and not old_name.startswith("Orijinal"):
                new_name = clean_source_name(old_name)
                if old_name != new_name:
                    s["source_name"] = new_name
                    changed = True

    if changed:
        with open(entry_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return 1
    return 0

def main():
    if not os.path.exists(SOURCES_DIR):
        print("sources dir not found")
        return

    entries = [os.path.join(SOURCES_DIR, f) for f in os.listdir(SOURCES_DIR) if f.endswith(".json")]
    print(f"Found {len(entries)} files. Processing with 32 workers...")

    updated = 0
    with ThreadPoolExecutor(max_workers=32) as executor:
        for res in executor.map(process_file, entries, chunksize=100):
            updated += res

    print(f"Done! {updated} bundle files updated.")

if __name__ == "__main__":
    main()
