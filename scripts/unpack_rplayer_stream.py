from curl_cffi import requests
from bs4 import BeautifulSoup
import re
import subprocess
import json

s = requests.Session(impersonate="chrome120")
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.hdfilmcehennemi.nl/"
}

# 1. Load movie page
s.get("https://www.hdfilmcehennemi.nl/aska-dair/", headers=headers)

# 2. Load rplayer
r = s.get("https://www.hdfilmcehennemi.nl/rplayer/y8j9qbsik6u3/", headers={"Referer": "https://www.hdfilmcehennemi.nl/aska-dair/"})
soup = BeautifulSoup(r.text, "html.parser")
target_script = None
for sc in soup.find_all("script"):
    txt = sc.get_text()
    if "sources" in txt and "eval(function" in txt:
        target_script = txt
        break

if target_script:
    print("Found target script with eval!")
    stub = """
    var window = { lastCheckPoint: 0, location: { href: 'https://www.hdfilmcehennemi.nl/rplayer/y8j9qbsik6u3/' } };
    var document = { querySelector: () => null, addEventListener: () => {} };
    var jwplayer = function() {
        return {
            setup: function(cfg) {
                console.log("JW_CONFIG:" + JSON.stringify(cfg) + ":END_JW");
            },
            on: () => {},
            addButton: () => {},
            getContainer: () => ({ appendChild: () => {} })
        };
    };
    jwplayer.key = "test";
    """
    payload = stub + target_script
    res = subprocess.run(["node", "-e", payload], capture_output=True, text=True, timeout=5)
    print("Node stdout:", res.stdout[:500])
    print("Node stderr:", res.stderr[:500])
else:
    print("No script with eval found!")
