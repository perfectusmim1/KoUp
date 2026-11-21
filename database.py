import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webdrama_archive.db")


def get_db_path() -> str:
    """Resolve active SQLite DB path, honoring ARCHIVE_DB_PATH / KOUP_DB_PATH overrides for safe test isolation."""
    return os.environ.get("ARCHIVE_DB_PATH") or os.environ.get("KOUP_DB_PATH") or DB_PATH


def row_to_dict(cur, row) -> dict:
    """Safely convert a sqlite3 tuple, sqlite3.Row, or dict cursor row into a Python dict."""
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    if isinstance(row, sqlite3.Row):
        return dict(row)
    if cur is not None and getattr(cur, "description", None):
        cols = [col[0] for col in cur.description]
        return dict(zip(cols, row))
    raise TypeError(f"Cannot convert row of type {type(row).__name__} to dict without cursor description")


def get_connection(use_row_factory: bool = True):
    conn = sqlite3.connect(get_db_path(), timeout=120.0)
    if use_row_factory:
        conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=120000;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA cache_size=-64000;")
    return conn

def init_db():
    conn = get_connection()
    try:
        from scrapers.pending_sources import ensure_pending_columns
        ensure_pending_columns(conn)
    finally:
        conn.close()

