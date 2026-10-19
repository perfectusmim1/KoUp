"""
Sanitizes fansub and source names by stripping discord links, invite URLs,
website domains, social media handles, and advertisement noise.
"""

import re

def clean_fansub_name(text):
    if not text:
        return None
    s = str(text).strip()
    if not s:
        return None

    s_low = s.lower()
    
    # 0. Check known community / group discord links
    if 'discord.gg/somesub' in s_low or 'discord.com/invite/somesub' in s_low or 'somesub' in s_low:
        return "SomeSub"
    if 'discord.gg/culturesubs' in s_low or 'culturesubs' in s_low:
        return "CultureSubs"
    if 'discord.gg/leefansub' in s_low or 'leefansub' in s_low:
        return "LeeFansub"

    # 1. Remove URLs with http / https
    s = re.sub(r'https?://[^\s|]+', '', s, flags=re.I)
    
    # 2. Remove discord links / invites
    s = re.sub(r'(?:https?://)?(?:www\.)?discord(?:\.gg|app\.com/invite|\.com/invite|\.com|\.me|\.io)/[^\s|]+', '', s, flags=re.I)
    s = re.sub(r'\bdiscord\.gg/[^\s|]+', '', s, flags=re.I)
    s = re.sub(r'\bdiscord(?:\.gg)?\b', '', s, flags=re.I)
    
    # 3. Remove social media links
    s = re.sub(r'(?:https?://)?(?:www\.)?(?:instagram\.com|facebook\.com|fb\.com|twitter\.com|t\.me|tiktok\.com|youtube\.com)/[^\s|]+', '', s, flags=re.I)
    s = re.sub(r'\b(?:instagram|facebook|twitter|telegram|tiktok|youtube)\.com/[^\s|]+', '', s, flags=re.I)
    
    # 4. Remove www.* links
    s = re.sub(r'\bwww\.[^\s|]*', '', s, flags=re.I)
    
    # 5. Remove dangling http/https protocol tokens
    s = re.sub(r'\bhttps?[:/]*', '', s, flags=re.I)
    
    # 6. Remove standalone website domains (e.g. somename.blogspot.com, somename.com, etc.)
    s = re.sub(r'\b[a-zA-Z0-9\-_.]+\.(?:blogspot\.com(?:\.tr)?|com\.tr|net\.tr|org\.tr|com|org|net|tv|xyz|io|me|info|cc)\b[^\s|]*', '', s, flags=re.I)
    
    # 7. Remove social handles like @codeanimee or codeanimee
    s = re.sub(r'@\w+', '', s)
    s = re.sub(r'\bcodeanimee\b', '', s, flags=re.I)
    
    # 8. Remove ad phrases
    s = re.sub(r'(?:destek|bağış|katılmak|yardım|iletişim)\s+olmak\s+için\s*:\s*', '', s, flags=re.I)
    s = re.sub(r'(?:destek|bağış|katılmak|yardım|iletişim)\s+için\s*:\s*', '', s, flags=re.I)
    s = re.sub(r'(?:discord\s+sunucumuz|discord\s+adresimiz|discord\s+adresi|dc\s+adresi)\s*:\s*', '', s, flags=re.I)
    s = re.sub(r'\b(?:discord|instagram|facebook|twitter|telegram)\b', '', s, flags=re.I)
    s = re.sub(r'\bdc\s*:\s*[^\s|]+', '', s, flags=re.I)

    # 8. Clean role prefixes if they leave a name
    s = re.sub(r'^(?:çeviri|çevirmen|encoder|kodlayıcı|redaksiyon|redaktör|redakte|uploader|upload)\s*:\s*', '', s, flags=re.I)
    s = re.sub(r'\s*[|\-/•]\s*(?:çeviri|çevirmen|encoder|kodlayıcı|redaksiyon|redaktör|redakte|uploader|upload)\s*:\s*', ' - ', s, flags=re.I)

    # 9. Clean delimiters
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'^[\s|\-/•:;,~_]+|[\s|\-/•:;,~_]+$', '', s)
    s = re.sub(r'\s*[|\-/•]\s*([|\-/•]\s*)+', ' - ', s)
    s = re.sub(r'^[\s|\-/•:;,~_]+|[\s|\-/•:;,~_]+$', '', s)
    s = s.strip()
    
    # 10. Exclude internal tags
    if s.lower() in ('asyawatch', 'dizilla', 'webdrama', 'koup', 'varsayılan', 'varsayilan', 'orijinal', 'default'):
        return None
        
    # 11. Must contain at least one letter
    if not s or not re.search(r'[a-zA-ZğüşıöçĞÜŞİÖÇ]', s):
        return None
        
    return s


def clean_source_name(name):
    if not name:
        return "Kaynak"
    s = str(name).strip()
    if not s:
        return "Kaynak"

    s = re.sub(r'https?://\S+', '', s, flags=re.I)
    s = re.sub(r'(?:www\.)?discord(?:\.gg|app\.com|\.com|\.me)/[^\s|]+', '', s, flags=re.I)
    s = re.sub(r'\bwww\.[a-zA-Z0-9\-_.]+\.[a-zA-Z]{2,}[^\s|]*', '', s, flags=re.I)
    s = re.sub(r'\s+', ' ', s).strip()

    return s or "Kaynak"
