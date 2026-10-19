#!/usr/bin/env python3
"""
Scans all JSON bundle files in r2_bundles/sources/ and cleans fansub and source_name
in-place to match the sanitized database values.
"""

import os
import sys
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from scrapers.clean_fansub import clean_fansub_name, clean_source_name

SOURCES_DIR = ROOT_DIR / "r2_bundles" / "sources"

def main():
    if not SOURCES_DIR.exists():
        print(f"{SOURCES_DIR} does not exist, skipping.")
        return

    files = list(SOURCES_DIR.glob("*.json"))
    print(f"Scanning {len(files)} bundle files in {SOURCES_DIR}...")

    modified_count = 0
    total_sources_modified = 0

    for i, file_path in enumerate(files):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        changed = False
        episodes = data.get("episodes", [])
        for ep in episodes:
            for s in ep.get("sources", []):
                old_f = s.get("fansub")
                new_f = clean_fansub_name(old_f)
                if old_f != new_f:
                    s["fansub"] = new_f
                    changed = True
                    total_sources_modified += 1

                old_name = s.get("source_name")
                if old_name and not old_name.startswith("Orijinal"):
                    new_name = clean_source_name(old_name)
                    if old_name != new_name:
                        s["source_name"] = new_name
                        changed = True

        if changed:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            modified_count += 1

        if (i + 1) % 5000 == 0:
            print(f"  Processed {i + 1}/{len(files)} files ({modified_count} updated)...")

    print(f"\nDone! {modified_count} bundle files updated ({total_sources_modified} source entries cleaned).")

if __name__ == "__main__":
    main()
