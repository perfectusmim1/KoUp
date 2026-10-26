"""
Short Drama Scraper Package
Unified scraping, deduplication, and ingestion for mini/short dramas:
- KoreDizi (koredizi.com)
- Shortİzle (shortizle.com)
- DramaVadisi (dramavadisi.com)
- DramaBox (dramabox.com)
"""

from scrapers.shortdrama.koredizi import KoreDiziScraper
from scrapers.shortdrama.shortizle import ShortizleScraper
from scrapers.shortdrama.dramavadisi import DramaVadisiScraper
from scrapers.shortdrama.dramabox import DramaBoxScraper

__all__ = [
    "KoreDiziScraper",
    "ShortizleScraper",
    "DramaVadisiScraper",
    "DramaBoxScraper",
]
