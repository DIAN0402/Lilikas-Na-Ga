"""The database. Two kinds, same tables, same code:

    Neon / PostgreSQL   when DATABASE_URL is set in backend/.env (one shared database for the whole team and the
                        live site; the address contains a password, so it lives ONLY in .env, never on GitHub)
    SQLite              otherwise: one local file, backend/data/lilikas.db, created automatically (tests always use
                        a fresh temporary SQLite file)

What lives here:
    users       accounts (password as a salted hash, never as text) and their saved preferences
    sessions    sign-in tokens (stored as a SHA-256 hash, so a copied database does not hand out live log-ins)
    reports     reports sent by residents through Lilikas Assist
    alerts      earthquake alerts that were picked up, and alerts posted by staff
    centers     evacuation centers with their latest numbers

The hazard maps (data/geo, data/layers) and the safety guides (data/stores/guides.json) stay as files: they are
reference data that people edit by hand, not data the app writes.

Settings (environment variables / backend/.env):
    DATABASE_URL   postgresql://user:password@host/dbname?sslmode=require   (Neon: project > Connect)
    DB_PATH        where the SQLite file lives when DATABASE_URL is not set (default backend/data/lilikas.db)

The data holds personal information (names, numbers, locations, health details in reports): the SQLite file is
git-ignored, and DATABASE_URL must never be committed or shared publicly.

Modules write plain SQL with ? placeholders that works on both kinds; this file adapts it for PostgreSQL.
"""
import json
import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import settings

try:                                    # only needed for Neon / PostgreSQL (pip install "psycopg[binary]")
    import psycopg
    from psycopg.rows import dict_row
except ImportError:                     # pragma: no cover - SQLite still works without it
    psycopg = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    contact     TEXT NOT NULL UNIQUE,          -- lower-case email or 09xxxxxxxxx
    name        TEXT NOT NULL,
    password    TEXT NOT NULL,                 -- salt$pbkdf2-sha256 (see auth.hash_password)
    preferences TEXT NOT NULL DEFAULT '{}',    -- JSON
    created     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires     DOUBLE PRECISION NOT NULL      -- unix time
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    client_id   TEXT UNIQUE,                   -- set by the browser so an offline retry is not saved twice
    created     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'new',   -- new | seen | resolved
    data        TEXT NOT NULL                  -- the full report as JSON
);
CREATE INDEX IF NOT EXISTS reports_created ON reports(created);
CREATE TABLE IF NOT EXISTS alerts (
    id          TEXT PRIMARY KEY,
    time        TEXT NOT NULL,
    data        TEXT NOT NULL                  -- the full alert as JSON
);
CREATE TABLE IF NOT EXISTS centers (
    id          TEXT PRIMARY KEY,
    position    INTEGER NOT NULL,              -- keeps the list in the order staff entered it
    data        TEXT NOT NULL                  -- the full center as JSON, with its latest occupied/status
);
"""

IntegrityError = (sqlite3.IntegrityError,) + ((psycopg.IntegrityError,) if psycopg else ())

_override = None             # set by use() (tests point this at a temporary SQLite file)
_ready = set()               # databases whose tables already exist
_lock = threading.Lock()
_local = threading.local()   # one PostgreSQL connection per server thread, reused between requests


# ----------------------------------------------------------------------
# Which database
# ----------------------------------------------------------------------
def url():
    """The PostgreSQL address, or '' to use SQLite. use() (tests) always means SQLite."""
    return "" if _override else os.environ.get("DATABASE_URL", "").strip()


def path():
    return Path(_override or os.environ.get("DB_PATH") or settings.DB_PATH)


def use(p):
    """Point the backend at another SQLite file (tests use a fresh temporary one)."""
    global _override
    _override = Path(p)


def describe():
    """For the startup line and /api/health. Never includes the password."""
    u = url()
    if not u:
        return {"kind": "sqlite", "where": str(path())}
    host = re.sub(r"^[a-z]+://([^@]*@)?", "", u).split("/")[0].split("?")[0]
    return {"kind": "postgresql", "where": host}


# ----------------------------------------------------------------------
# PostgreSQL: adapt the shared SQL
# ----------------------------------------------------------------------
def to_postgres(sql):
    """? placeholders become %s (psycopg's style). The SQL used in this project has no literal ? or % in it."""
    return sql.replace("%", "%%").replace("?", "%s")


class _PgCon:
    """Gives a psycopg connection the small sqlite3-style surface the modules use."""
    def __init__(self, con):
        self.con = con

    def execute(self, sql, args=()):
        return self.con.execute(to_postgres(sql), tuple(args))

    def executemany(self, sql, rows):
        cur = self.con.cursor()
        cur.executemany(to_postgres(sql), [tuple(r) for r in rows])
        return cur


def _pg_connect():
    if psycopg is None:
        raise RuntimeError('DATABASE_URL is set but the PostgreSQL driver is missing. Run: pip install "psycopg[binary]"')
    con = getattr(_local, "pg", None)
    if con is not None and not con.closed:
        if time.time() - getattr(_local, "used", 0) < 60:
            return con
        try:                                   # quiet for a while: Neon may have slept and dropped the connection
            con.execute("SELECT 1")
            con.commit()
            return con
        except Exception:
            try:
                con.close()
            except Exception:
                pass
    # prepare_threshold=None: Neon's pooled address (…-pooler…) does not keep prepared statements between queries
    con = psycopg.connect(url(), row_factory=dict_row, prepare_threshold=None, connect_timeout=10)
    key = ("pg", url())
    if key not in _ready:
        with _lock:
            if key not in _ready:
                with con.cursor() as cur:
                    for stmt in (s.strip() for s in re.sub(r"--[^\n]*", "", SCHEMA).split(";")):
                        if stmt:
                            cur.execute(stmt)
                con.commit()
                _ready.add(key)
    _local.pg = con
    return con


# ----------------------------------------------------------------------
# SQLite
# ----------------------------------------------------------------------
def _sqlite_connect():
    p = path()
    con = sqlite3.connect(p, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    if p not in _ready:
        with _lock:
            if p not in _ready:
                p.parent.mkdir(parents=True, exist_ok=True)
                con.execute("PRAGMA journal_mode = WAL")      # readers don't wait for the writer
                con.executescript(SCHEMA)
                con.commit()
                _ready.add(p)
    return con


# ----------------------------------------------------------------------
# What the modules use
# ----------------------------------------------------------------------
@contextmanager
def tx():
    """One transaction: everything inside is saved together, or nothing is if an error happens."""
    if url():
        con = _pg_connect()
        try:
            yield _PgCon(con)
            con.commit()
        except BaseException as exc:
            try:
                con.rollback()
            except Exception:
                pass
            if psycopg and isinstance(exc, psycopg.OperationalError):     # dropped connection: reconnect next time
                _local.pg = None
            raise
        finally:
            _local.used = time.time()
        return
    con = _sqlite_connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def query(sql, args=()):
    with tx() as con:
        return con.execute(sql, args).fetchall()


def one(sql, args=()):
    rows = query(sql, args)
    return rows[0] if rows else None


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def loads(text, default=None):
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def import_json_once(table, json_path, insert):
    """First run only: copy rows from an old data/stores/*.json file into an empty table.
    `insert(con, rows)` writes them. The JSON file is left in place (it is git-ignored) as a backup."""
    if one(f"SELECT 1 FROM {table} LIMIT 1"):
        return 0
    try:
        rows = json.loads(Path(json_path).read_text("utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(rows, list) or not rows:
        return 0
    with tx() as con:
        insert(con, rows)
    return len(rows)
