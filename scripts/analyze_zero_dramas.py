import json
import os
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

report_path = os.path.join(os.path.dirname(__file__), "reports", "source_audit_report.json")
with open(report_path, "r", encoding="utf-8") as f:
    data = json.load(f)

zero_dramas = data.get("zero_source_dramas", [])
print(f"Total zero-source dramas: {len(zero_dramas)}")

countries = Counter(d.get("country", "??") for d in zero_dramas)
types = Counter(d.get("type", "??") for d in zero_dramas)

print("\nBy Country (Top 10):")
for c, cnt in countries.most_common(10):
    print(f"  {c}: {cnt}")

print("\nBy Type:")
for t, cnt in types.most_common():
    print(f"  {t}: {cnt}")

print("\nTop 20 zero-source dramas by episode count:")
for d in zero_dramas[:20]:
    print(f"  ID: {d['id']:<6} | {d['title'][:35]:<35} | {d.get('year', ''):<4} | {d.get('country', '??'):<2} | {d.get('type', '??'):<7} | eps: {d.get('total_episodes')}")
