"""
KoUp Scrapers Modülü
Tüm scraper motorları ve yardımcı betikleri bu dizinde yer alır.
"""
import sys
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

for p in (ROOT_DIR, CURRENT_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)
