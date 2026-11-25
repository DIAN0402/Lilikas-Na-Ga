"""The database (db.py): data survives a restart, old JSON stores are imported once, tokens are not stored in clear."""
import json

import alerts
import assist
import auth
import centers
import db
from conftest import POBLACION


def signup(client, contact="juan@example.com"):
    return client.post("/api/auth/signup", json={"name": "Juan Dela Cruz", "contact": contact,
                                                 "password": "secret123", "agree": True})


def test_tables_are_created_on_first_use():
    names = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"users", "sessions", "reports", "alerts", "centers"} <= names


def test_account_and_sign_in_survive_a_restart(client):
    token = signup(client).get_json()["token"]
    auth._attempts.clear()
    # a restart loses everything held in memory; the database file is all that is left
    assert db.one("SELECT name FROM users WHERE contact = ?", ("juan@example.com",))["name"] == "Juan Dela Cruz"
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200
    client.put("/api/me/preferences", headers=h, json={"checklist": ["water_food"], "lang": "fil"})
    prefs = json.loads(db.one("SELECT preferences FROM users")["preferences"])
    assert prefs["checklist"] == ["water_food"] and prefs["lang"] == "fil"
    assert client.post("/api/auth/login", json={"contact": "JUAN@example.com", "password": "secret123"}).status_code == 200


def test_passwords_and_tokens_are_not_stored_in_clear(client):
    token = signup(client).get_json()["token"]
    row = db.one("SELECT password FROM users")
    assert "secret123" not in row["password"]
    stored = [r["token_hash"] for r in db.query("SELECT token_hash FROM sessions")]
    assert token not in stored and len(stored) == 1


def test_logout_and_expired_sessions(client):
    token = signup(client).get_json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    client.post("/api/auth/logout", headers=h)
    assert client.get("/api/auth/me", headers=h).status_code == 401
    token = client.post("/api/auth/login", json={"contact": "juan@example.com", "password": "secret123"}).get_json()["token"]
    with db.tx() as con:
        con.execute("UPDATE sessions SET expires = 0")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_duplicate_account_is_refused(client):
    assert signup(client).status_code == 201
    assert signup(client).status_code == 409
    assert db.one("SELECT COUNT(*) AS n FROM users")["n"] == 1


def test_reports_are_saved_once_and_staff_can_update_them(client, admin):
    body = {"report_type": "flood", "water_level": "knee", "lat": POBLACION[0], "lon": POBLACION[1],
            "client_id": "offline-123", "quote": "Baha na po"}
    first = client.post("/api/assist/report", json=body)
    again = client.post("/api/assist/report", json=body)            # the offline retry
    assert first.status_code == 201 and again.status_code == 200 and again.get_json()["duplicate"] is True
    assert db.one("SELECT COUNT(*) AS n FROM reports")["n"] == 1
    rows = client.get("/api/admin/reports", headers=admin).get_json()["reports"]
    assert rows[0]["quote"] == "Baha na po" and rows[0]["status"] == "new"
    rid = rows[0]["id"]
    assert client.post(f"/api/admin/reports/{rid}", headers=admin, json={"status": "seen"}).get_json()["status"] == "seen"
    assert assist.list_reports()[0]["status"] == "seen"
    assert client.post("/api/admin/reports/nope", headers=admin, json={"status": "seen"}).status_code == 404


def test_staff_alerts_survive_a_restart(client, admin):
    r = client.post("/api/admin/alerts", headers=admin, json={"kind": "local", "title": "Road closed", "hours": 2})
    aid = r.get_json()["id"]
    alerts.ALERTS.clear()                                             # what a restart does to memory
    alerts._load()
    assert any(a["id"] == aid for a in alerts.ALERTS)
    assert client.delete(f"/api/admin/alerts/{aid}", headers=admin).status_code == 200
    alerts._load()
    assert not any(a["id"] == aid for a in alerts.ALERTS)


def test_center_edits_are_saved(client, admin):
    cid = centers.CENTERS[0]["id"]
    client.post(f"/api/centers/{cid}", headers=admin, json={"occupied": 7, "manual": True})
    saved = {c["id"]: c for c in centers.load_centers()}
    assert saved[cid]["occupied"] == 7 and saved[cid]["manual"] is True


def test_first_run_imports_starting_centers_and_old_json(tmp_path):
    db.use(tmp_path / "fresh.db")
    assert len(centers.load_centers()) == len(json.loads(centers.CENTERS_PATH.read_text("utf-8")))
    old = tmp_path / "reports.json"
    old.write_text(json.dumps([{"id": "r1", "client_id": "c1", "created": "2026-11-01T10:00:00+08:00",
                                "status": "seen", "report_type": "flood"}]), "utf-8")
    assert db.import_json_once("reports", old, lambda con, rows: [assist._insert_report(con, r) for r in rows]) == 1
    assert db.import_json_once("reports", old, lambda con, rows: None) == 0          # only once
    assert assist.find_report_by_client_id("c1")["status"] == "seen"
