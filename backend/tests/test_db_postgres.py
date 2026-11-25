"""The Neon / PostgreSQL code path in db.py, without a network: a stand-in psycopg driver records the SQL the backend
sends (it must use %s placeholders, as psycopg does) and runs it on SQLite underneath."""
import sqlite3

import pytest

import db
from conftest import POBLACION


class FakeCursor:
    def __init__(self, real, log):
        self.real, self.log = real, log
        self.rowcount = -1

    def execute(self, sql, args=()):
        self.log.append(sql)
        assert "?" not in sql, "PostgreSQL SQL must use %s placeholders"
        cur = self.real.execute(sql.replace("%s", "?").replace("%%", "%"), args)
        self.rowcount, self._cur = cur.rowcount, cur
        return self

    def executemany(self, sql, rows):
        self.log.append(sql)
        assert "?" not in sql
        self.real.executemany(sql.replace("%s", "?"), rows)
        return self

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    def fetchone(self):
        r = self._cur.fetchone()
        return dict(r) if r else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConnection:
    closed = False

    def __init__(self, path, log):
        self.real = sqlite3.connect(path)
        self.real.row_factory = sqlite3.Row
        self.log = log

    def cursor(self):
        return FakeCursor(self.real, self.log)

    def execute(self, sql, args=()):
        return FakeCursor(self.real, self.log).execute(sql, args)

    def commit(self):
        self.real.commit()

    def rollback(self):
        self.real.rollback()

    def close(self):
        self.closed = True


class FakePsycopg:
    IntegrityError = sqlite3.IntegrityError
    OperationalError = sqlite3.OperationalError

    def __init__(self, path):
        self.path, self.log, self.connects = path, [], []

    def connect(self, url, **kw):
        self.connects.append((url, kw))
        return FakeConnection(self.path, self.log)


@pytest.fixture
def neon(monkeypatch, tmp_path):
    fake = FakePsycopg(tmp_path / "pg.db")
    monkeypatch.setattr(db, "psycopg", fake)
    monkeypatch.setattr(db, "dict_row", object(), raising=False)
    monkeypatch.setattr(db, "IntegrityError", (sqlite3.IntegrityError,))
    monkeypatch.setattr(db, "_override", None)
    monkeypatch.setattr(db, "_local", type(db._local)())
    monkeypatch.setenv("DATABASE_URL", "postgresql://neondb_owner:SECRET@ep-test-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require")
    return fake


def test_describe_hides_the_password(neon):
    d = db.describe()
    assert d == {"kind": "postgresql", "where": "ep-test-pooler.ap-southeast-1.aws.neon.tech"}
    assert "SECRET" not in str(d)


def test_placeholders_are_converted():
    assert db.to_postgres("SELECT * FROM users WHERE contact = ? AND id = ?") == \
        "SELECT * FROM users WHERE contact = %s AND id = %s"


def test_full_app_flow_on_the_postgres_path(neon, client, admin):
    r = client.post("/api/auth/signup", json={"name": "Ana Reyes", "contact": "ana@example.com",
                                              "password": "secret123", "agree": True})
    assert r.status_code == 201
    assert client.post("/api/auth/signup", json={"name": "Ana", "contact": "ana@example.com",
                                                 "password": "secret123", "agree": True}).status_code == 409
    tok = r.get_json()["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    body = {"report_type": "flood", "lat": POBLACION[0], "lon": POBLACION[1], "client_id": "x1"}
    assert client.post("/api/assist/report", json=body).status_code == 201
    assert client.post("/api/assist/report", json=body).get_json()["duplicate"] is True
    rid = client.get("/api/admin/reports", headers=admin).get_json()["reports"][0]["id"]
    assert client.post(f"/api/admin/reports/{rid}", headers=admin, json={"status": "resolved"}).status_code == 200
    a = client.post("/api/admin/alerts", headers=admin, json={"kind": "local", "title": "Road closed"})
    assert a.status_code == 201
    # one connection reused (no reconnect per query), created without prepared statements (needed for Neon's pooler)
    assert len(neon.connects) == 1 and neon.connects[0][1]["prepare_threshold"] is None
    assert any("CREATE TABLE IF NOT EXISTS users" in s for s in neon.log)
