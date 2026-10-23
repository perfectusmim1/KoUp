"""
Pending Sources Management Module for KoUp.

Handles detection, tagging, and reconciliation of episodes whose page exists
but has NO playable source yet ("yakında yüklenecek", "Bu bölümü sizler için hazırlıyoruz",
"Çeviri ve player linki eklendiğinde", empty player / zero extracted sources).
"""

import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any


# Standard list of Turkish and English phrases that indicate an episode has no playable source yet
PLACEHOLDER_PATTERNS = [
    "sizler için hazırlıyoruz",
    "sizler icin hazirliyoruz",
    "bu bölümü sizler için hazırlıyoruz",
    "bu bolumu sizler icin hazirliyoruz",
    "çeviri ve player linki eklendiğinde",
    "ceviri ve player linki eklendiginde",
    "çeviri ve player linki",
    "ceviri ve player linki",
    "player linki eklendiğinde",
    "player linki eklendiginde",
    "player linki eklen",
    "player linki",
    "video eklenecek",
    "video yuklenecek",
    "video yüklenecek",
    "video henüz eklenmedi",
    "video henuz eklenmedi",
    "kaynak eklenecek",
    "kaynak yuklenecek",
    "kaynak yüklenecek",
    "bölüm eklenmedi",
    "bolum eklenmedi",
    "bölüm henüz eklenmedi",
    "bolum henuz eklenmedi",
    "henüz eklenmedi",
    "henuz eklenmedi",
    "henüz yayınlanmadı",
    "henuz yayinlanmadi",
    "bölüm hazırlanıyor",
    "bolum hazirlaniyor",
    "hazırlanıyor",
    "hazirlaniyor",
    "çevirisi yapılıyor",
    "cevirisi yapiliyor",
    "çeviri aşamasında",
    "ceviri asamasinda",
    "altyazı hazırlanıyor",
    "altyazi hazirlaniyor",
    "player eklenecektir",
    "video bulunamadı",
    "video bulunamadi",
    "kaynak bulunamadı",
    "kaynak bulunamadi",
    "yakında eklenecek",
    "yakinda eklenecek",
    "yakında yüklenecek",
    "yakinda yuklenecek",
    "yakında yayınlanacak",
    "yakinda yayinlanacak",
    "yakında yayında",
    "yakinda yayinda",
    "yakinda",
    "yakında",
    "coming soon",
    "episode not available",
    "episode not released",
    "video will be added",
    "to be added",
    "translation in progress",
]

# High confidence multi-word phrases for direct substring search
_HIGH_CONFIDENCE_PHRASES = [
    "sizler için hazırlıyoruz",
    "sizler icin hazirliyoruz",
    "bu bölümü sizler için hazırlıyoruz",
    "bu bolumu sizler icin hazirliyoruz",
    "çeviri ve player linki",
    "ceviri ve player linki",
    "player linki eklen",
    "player linki eklendiginde",
    "player linki eklendiğinde",
    "video eklenecek",
    "video yuklenecek",
    "video yüklenecek",
    "video henüz eklenmedi",
    "video henuz eklenmedi",
    "kaynak eklenecek",
    "kaynak yuklenecek",
    "kaynak yüklenecek",
    "bölüm eklenmedi",
    "bolum eklenmedi",
    "bölüm henüz eklenmedi",
    "bolum henuz eklenmedi",
    "bölüm hazırlanıyor",
    "bolum hazirlaniyor",
    "çevirisi yapılıyor",
    "cevirisi yapiliyor",
    "çeviri aşamasında",
    "ceviri asamasinda",
    "altyazı hazırlanıyor",
    "altyazi hazirlaniyor",
    "player eklenecektir",
    "yakında eklenecek",
    "yakinda eklenecek",
    "yakında yüklenecek",
    "yakinda yuklenecek",
    "yakında yayınlanacak",
    "yakinda yayinlanacak",
    "yakında yayında",
    "yakinda yayinda",
    "episode not available",
    "episode not released",
    "video will be added",
    "to be added",
    "translation in progress",
]

_TR_MAP = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def page_is_placeholder(html: str) -> bool:
    """
    Detects if an HTML page corresponds to a placeholder episode with NO playable source yet.
    Checks for explicit Turkish and English announcement phrases and contextual player warnings.
    """
    if not html or not isinstance(html, str):
        return False

    html_lower = html.lower()
    norm_txt = unicodedata.normalize("NFKD", html_lower).encode("ascii", "ignore").decode()

    # 1. Check high confidence multi-word phrases
    for phrase in _HIGH_CONFIDENCE_PHRASES:
        if phrase in html_lower or phrase in norm_txt:
            return True

    # 2. Contextual regex: check if "yakında" / "hazırlanıyor" / "coming soon" is adjacent to episode/video/player keywords
    context_patterns = [
        r'(?:b[öo]l[üu]m|video|player|sezon|season|izle|dizi)[^\n<>]{0,60}(?:yak[ıi]nda|haz[ıi]rlan[ıi]yor|coming\s+soon|eklenecek|y[üu]klenecek)',
        r'(?:yak[ıi]nda|haz[ıi]rlan[ıi]yor|coming\s+soon)[^\n<>]{0,60}(?:b[öo]l[üu]m|video|player|sezon|season|eklen|y[üu]klen|yol|yay[ıi]n)',
        r'class=["\'][^"\']*(?:alert|notice|warning|player-holder|no-player)[^"\']*["\'][^>]*>[^<]*(?:yak[ıi]nda|haz[ıi]rlan|eklen)',
    ]
    for pat in context_patterns:
        if re.search(pat, html_lower, re.IGNORECASE):
            return True

    return False


def ensure_pending_columns(conn: sqlite3.Connection):
    """
    Ensures SQLite webdrama_archive.db episodes table has all pending-sources columns.
    Guarded by PRAGMA table_info to be completely idempotent.
    """
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(episodes)")
    cols = {row[1] for row in cur.fetchall()}
    changed = False

    if "source_status" not in cols:
        cur.execute("ALTER TABLE episodes ADD COLUMN source_status TEXT DEFAULT NULL")
        changed = True
    if "pending_since" not in cols:
        cur.execute("ALTER TABLE episodes ADD COLUMN pending_since TEXT DEFAULT NULL")
        changed = True
    if "last_source_check" not in cols:
        cur.execute("ALTER TABLE episodes ADD COLUMN last_source_check TEXT DEFAULT NULL")
        changed = True
    if "source_check_attempts" not in cols:
        cur.execute("ALTER TABLE episodes ADD COLUMN source_check_attempts INTEGER DEFAULT 0")
        changed = True

    cur.execute("CREATE INDEX IF NOT EXISTS idx_episodes_source_status ON episodes(source_status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_episodes_pending_recheck ON episodes(source_status, last_source_check)")

    if changed:
        conn.commit()


def mark_pending(cur: sqlite3.Cursor, episode_id: int, increment_attempts: bool = False):
    """Marks an episode as pending source in SQLite."""
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if increment_attempts:
        cur.execute(
            """
            UPDATE episodes
            SET source_status = 'pending',
                pending_since = COALESCE(pending_since, ?),
                last_source_check = ?,
                source_check_attempts = COALESCE(source_check_attempts, 0) + 1
            WHERE id = ?
            """,
            (now_str, now_str, episode_id),
        )
    else:
        cur.execute(
            """
            UPDATE episodes
            SET source_status = 'pending',
                pending_since = COALESCE(pending_since, ?),
                last_source_check = ?,
                source_check_attempts = COALESCE(source_check_attempts, 0)
            WHERE id = ?
            """,
            (now_str, now_str, episode_id),
        )


def clear_pending(cur: sqlite3.Cursor, episode_id: int):
    """Clears pending tag from an episode once playable sources appear."""
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    cur.execute(
        """
        UPDATE episodes
        SET source_status = NULL,
            pending_since = NULL,
            last_source_check = ?
        WHERE id = ?
        """,
        (now_str, episode_id),
    )


def reconcile_episode(
    cur: sqlite3.Cursor,
    episode_id: int,
    is_placeholder: bool = False,
    increment_attempt: bool = False,
) -> bool:
    """
    Sets pending if 0 active rows in episode_sources OR placeholder detected, else clears tag.
    Increments attempts if increment_attempt is True, and updates last_source_check.
    Returns True if episode is pending, False otherwise.
    """
    cur.execute(
        """
        SELECT COUNT(*) FROM episode_sources
        WHERE episode_id = ?
          AND direct_url IS NOT NULL
          AND direct_url != ''
          AND direct_url != 'dead'
          AND (provider IS NULL OR provider != 'dead')
        """,
        (episode_id,),
    )
    count = cur.fetchone()[0]

    if is_placeholder:
        # Placeholder sayfada gerçek video kaynağı olamaz; olası hayalet kaynakları temizle
        cur.execute("DELETE FROM episode_sources WHERE episode_id = ?", (episode_id,))
        mark_pending(cur, episode_id, increment_attempts=increment_attempt)
        return True
    elif count == 0:
        mark_pending(cur, episode_id, increment_attempts=increment_attempt)
        return True
    else:
        clear_pending(cur, episode_id)
        return False


def list_pending(
    conn: sqlite3.Connection,
    limit: int = 100,
    min_age_minutes: Optional[int] = None,
    drama_id: Optional[int] = None,
    max_attempts: Optional[int] = None,
    apply_backoff: bool = False,
    domain: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Loads pending episodes from SQLite ordered by oldest last_source_check (NULLs first).
    Supports min_age_minutes filter, drama_id filter, max_attempts ceiling, domain filter, and backoff filtering.
    """
    cur = conn.cursor()
    conditions = ["e.source_status = 'pending'"]
    params: List[Any] = []

    if domain:
        conditions.append("e.episode_url LIKE ?")
        params.append(f"%{domain}%")

    if drama_id is not None:
        conditions.append("e.drama_id = ?")
        params.append(drama_id)

    if max_attempts is not None:
        conditions.append("COALESCE(e.source_check_attempts, 0) < ?")
        params.append(max_attempts)

    if min_age_minutes is not None and min_age_minutes > 0:
        conditions.append(
            "(e.last_source_check IS NULL OR (strftime('%s', 'now') - strftime('%s', e.last_source_check)) >= ?)"
        )
        params.append(min_age_minutes * 60)
    elif apply_backoff:
        # Backoff: attempts < 6 -> 30min (1800s), attempts < 24 -> 3h (10800s), else 12h (43200s)
        conditions.append(
            """
            (
                e.last_source_check IS NULL
                OR (
                    strftime('%s', 'now') - strftime('%s', e.last_source_check) >= (
                        CASE
                            WHEN COALESCE(e.source_check_attempts, 0) < 6 THEN 1800
                            WHEN COALESCE(e.source_check_attempts, 0) < 24 THEN 10800
                            ELSE 43200
                        END
                    )
                )
            )
            """
        )

    where_clause = " AND ".join(conditions)
    sql = f"""
        SELECT e.id, e.drama_id, e.season_number, e.episode_number, e.episode_name, e.episode_url,
               e.source_status, e.pending_since, e.last_source_check, e.source_check_attempts,
               d.title AS drama_title, d.slug AS drama_slug, d.content_type
        FROM episodes e
        JOIN dramas d ON e.drama_id = d.id
        WHERE {where_clause}
        ORDER BY CASE
                    WHEN e.episode_url LIKE '%dizikorea%' OR e.episode_url LIKE '%asyawatch%' OR e.episode_url LIKE '%ddizi%' OR e.episode_url LIKE '%dizibox%' THEN 0
                    ELSE 1
                 END ASC,
                 CASE WHEN e.last_source_check IS NULL THEN 0 ELSE 1 END ASC,
                 e.last_source_check ASC,
                 e.id ASC
        LIMIT ?
    """
    params.append(limit)
    cur.execute(sql, params)

    columns = [desc[0] for desc in cur.description]
    results = [dict(zip(columns, row)) for row in cur.fetchall()]
    return results
