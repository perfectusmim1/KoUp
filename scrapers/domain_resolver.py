"""
Auto domain resolver and health checker for dynamic streaming sites.
Detects domain rotations (301/302 redirects, banner announcements, gateways, sequential numbers)
and updates Supabase scraper_configs and local cache.
"""

import json
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

try:
    from curl_cffi import requests as cfr
except ImportError:
    cfr = None

import requests
from scrapers.supabase_sync_helper import sb_request

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CACHE_PATH = os.path.join(_ROOT, "data", "domains_cache.json")


def _read_local_cache() -> dict:
    if os.path.exists(_CACHE_PATH):
        try:
            with open(_CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _write_local_cache(cache: dict):
    try:
        os.makedirs(os.path.dirname(_CACHE_PATH), exist_ok=True)
        with open(_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _fetch_url(url: str, method: str = "GET", timeout: int = 8, allow_redirects: bool = True):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
    if cfr:
        try:
            if method.upper() == "HEAD":
                return cfr.head(url, headers=headers, impersonate="chrome", timeout=timeout, allow_redirects=allow_redirects)
            return cfr.get(url, headers=headers, impersonate="chrome", timeout=timeout, allow_redirects=allow_redirects)
        except Exception:
            pass
    try:
        if method.upper() == "HEAD":
            return requests.head(url, headers=headers, timeout=timeout, allow_redirects=allow_redirects)
        return requests.get(url, headers=headers, timeout=timeout, allow_redirects=allow_redirects)
    except Exception:
        return None


def _check_domain_alive(url: str, timeout: int = 8) -> tuple[bool, str, str]:
    """Returns (is_alive, final_url, html_text)."""
    resp = _fetch_url(url, method="GET", timeout=timeout, allow_redirects=True)
    if resp and resp.status_code in (200, 206, 301, 302, 307, 308):
        final_url = str(resp.url or url).rstrip("/")
        # Extract base origin
        parsed = urlparse(final_url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        text = resp.text if hasattr(resp, "text") else ""
        return True, origin, text
    return False, url, ""


def update_site_domain_in_db(site_id: str, old_url: str, new_url: str):
    """Updates Supabase scraper_configs and logs domain change."""
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "base_url": new_url,
        "site_url": new_url,
        "last_ok_at": now_iso,
        "last_status": "healthy",
    }
    try:
        sb_request("PATCH", f"/rest/v1/scraper_configs?id=eq.{site_id}", body=payload)
    except Exception as e:
        print(f"[DOMAIN RESOLVER DB ERROR] {site_id}: {e}", flush=True)

    cache = _read_local_cache()
    entry = cache.get(site_id, {})
    entry["base_url"] = new_url
    entry["site_url"] = new_url
    entry["last_ok_at"] = now_iso
    cache[site_id] = entry
    _write_local_cache(cache)

    if old_url != new_url:
        print(f"[DOMAIN GÜNCELLENDİ] {site_id}: {old_url} -> {new_url}", flush=True)


def get_site_base_url(site_id: str, default_url: str) -> str:
    """
    Returns the currently active base_url for a site.
    Validates current base_url, follows redirects, tests gateways or sequential numbers.
    """
    default_url = default_url.rstrip("/")
    cache = _read_local_cache()
    cached_cfg = cache.get(site_id, {})

    base_url = cached_cfg.get("base_url") or default_url
    domain_strategy = cached_cfg.get("domain_strategy", "static")
    gateway_url = cached_cfg.get("gateway_url")

    # 1. Fetch remote config from Supabase if possible
    try:
        remote_res = sb_request("GET", f"/rest/v1/scraper_configs?id=eq.{site_id}&select=base_url,site_url,domain_strategy,gateway_url")
        if isinstance(remote_res, list) and len(remote_res) > 0:
            cfg = remote_res[0]
            base_url = (cfg.get("base_url") or cfg.get("site_url") or base_url).rstrip("/")
            domain_strategy = cfg.get("domain_strategy") or domain_strategy
            gateway_url = cfg.get("gateway_url") or gateway_url
            cache[site_id] = {
                "base_url": base_url,
                "site_url": base_url,
                "domain_strategy": domain_strategy,
                "gateway_url": gateway_url,
            }
            _write_local_cache(cache)
    except Exception:
        pass

    initial_url = base_url

    # 2. Test current base_url health
    alive, final_url, html_text = _check_domain_alive(base_url, timeout=8)
    if alive:
        if final_url != base_url:
            update_site_domain_in_db(site_id, base_url, final_url)
            return final_url

        # Check for banner announcements (e.g. "Sonraki adresimiz dizipal1592.com")
        if html_text:
            m_banner = re.search(r"(?:sonraki\s+(?:adresimiz|giriş|site)|yeni\s+adresimiz)[^<]{0,100}?([a-z0-9\-]+\.[a-z]{2,10})", html_text, re.IGNORECASE)
            if m_banner:
                cand_domain = m_banner.group(1).lower()
                parsed_base = urlparse(base_url)
                if cand_domain not in parsed_base.netloc:
                    cand_url = f"{parsed_base.scheme}://{cand_domain}"
                    c_alive, c_final, _ = _check_domain_alive(cand_url, timeout=5)
                    if c_alive:
                        update_site_domain_in_db(site_id, base_url, c_final)
                        return c_final

        # Still healthy
        return base_url

    # 3. Current domain failed -> Try gateway_url if present
    if gateway_url:
        gw_alive, gw_final, _ = _check_domain_alive(gateway_url, timeout=8)
        if gw_alive and gw_final != gateway_url:
            update_site_domain_in_db(site_id, base_url, gw_final)
            return gw_final

    # 4. Try sequential_number strategy if configured
    if domain_strategy == "sequential_number":
        # Look for digits inside domain (e.g. dizipal1591.com -> 1591)
        parsed = urlparse(base_url)
        match = re.search(r"(\d{2,6})", parsed.netloc)
        if match:
            curr_num = int(match.group(1))
            prefix = parsed.netloc[:match.start(1)]
            suffix = parsed.netloc[match.end(1):]
            scheme = parsed.scheme or "https"
            # Try next 15 sequential numbers
            for n in range(curr_num + 1, curr_num + 16):
                cand_host = f"{prefix}{n}{suffix}"
                cand_url = f"{scheme}://{cand_host}"
                c_alive, c_final, _ = _check_domain_alive(cand_url, timeout=5)
                if c_alive:
                    update_site_domain_in_db(site_id, base_url, c_final)
                    return c_final

    # Fallback to default_url or initial_url
    return initial_url or default_url
