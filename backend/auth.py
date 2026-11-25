"""Accounts (optional sign-in) and saved preferences, kept in the database (db.py: users, sessions).

Passwords are stored as salted PBKDF2-SHA256 hashes, never as text. Sessions are random bearer tokens that the
website sends in the  Authorization: Bearer <token>  header; the database keeps only a SHA-256 hash of each token.
Accounts and sign-ins survive a server restart.
"""
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

import db

LOCK = threading.Lock()
_attempts = {}      # ip -> [timestamps] of failed log-ins (in memory on purpose: it only needs to last minutes)
PHT = timezone(timedelta(hours=8))

SESSION_HOURS = 12
REMEMBER_DAYS = 30
ALERT_TOPICS = ("rain_flood", "earthquake", "storm", "local")
CHECKLIST_IDS = ("water_food", "medicine", "power", "documents", "meeting_point", "official_advice")
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$", re.I)


def normalize_contact(raw):
    """An email (lower-case) or a Philippine mobile number as 09xxxxxxxxx. None if neither."""
    raw = str(raw or "").strip()
    if EMAIL.match(raw):
        return raw.lower()
    digits = re.sub(r"[\s\-()]", "", raw)
    if re.fullmatch(r"(\+?63|0)9\d{9}", digits):
        return "0" + digits[-10:]
    return None


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    return salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000).hex()


def check_password(password, stored):
    salt, _, digest = stored.partition("$")
    return hmac.compare_digest(hash_password(password, bytes.fromhex(salt)).partition("$")[2], digest)


def public(u):
    return {"id": u["id"], "name": u["name"], "contact": u["contact"], "first_name": u["name"].split()[0],
            "initials": "".join(p[0] for p in u["name"].split()[:2]).upper(), "preferences": u["preferences"]}


# ---- database access (the only place that knows the users / sessions tables)
def _row_to_user(row):
    return row and {"id": row["id"], "name": row["name"], "contact": row["contact"], "password": row["password"],
                    "preferences": db.loads(row["preferences"], {})}


def find_user(contact):
    return _row_to_user(db.one("SELECT * FROM users WHERE contact = ?", (contact,)))


def create_user(name, contact, password_hash, preferences):
    """The new user, or None if that email/number is already registered."""
    user = {"id": secrets.token_hex(6), "name": name, "contact": contact, "password": password_hash,
            "preferences": preferences}
    try:
        with db.tx() as con:
            con.execute("INSERT INTO users (id, contact, name, password, preferences, created) VALUES (?, ?, ?, ?, ?, ?)",
                        (user["id"], contact, name, password_hash, db.dumps(preferences), datetime.now(PHT).isoformat()))
    except db.IntegrityError:
        return None
    return user


def save_preferences(user_id, preferences):
    with db.tx() as con:
        con.execute("UPDATE users SET preferences = ? WHERE id = ?", (db.dumps(preferences), user_id))


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _bearer():
    auth = request.headers.get("Authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


def current_user():
    """The signed-in user for this request, or None (signing in is optional everywhere)."""
    token = _bearer()
    if not token:
        return None
    row = db.one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?",
                 (_token_hash(token), time.time()))
    return _row_to_user(row)


def _start_session(user, remember):
    token = secrets.token_urlsafe(32)
    ttl = REMEMBER_DAYS * 86400 if remember else SESSION_HOURS * 3600
    with db.tx() as con:
        con.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))       # tidy up old sign-ins
        con.execute("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)",
                    (_token_hash(token), user["id"], time.time() + ttl))
    return token, ttl


def _too_many_failures(ip, limit=8, window=900):
    now = time.time()
    with LOCK:
        recent = [t for t in _attempts.get(ip, []) if now - t < window]
        _attempts[ip] = recent
        return len(recent) >= limit


def _record_failure(ip):
    with LOCK:
        _attempts.setdefault(ip, []).append(time.time())


def clean_preferences(b, old):
    p = dict(old)
    if "barangay" in b:
        p["barangay"] = str(b.get("barangay") or "").strip()[:80] or None
    if "lat" in b and "lon" in b:
        try:
            lat, lon = float(b["lat"]), float(b["lon"])
            if 4 <= lat <= 22 and 116 <= lon <= 128:
                p["lat"], p["lon"] = round(lat, 5), round(lon, 5)
        except (TypeError, ValueError):
            pass
    if isinstance(b.get("alert_topics"), list):
        p["alert_topics"] = [t for t in ALERT_TOPICS if t in b["alert_topics"]]
    if isinstance(b.get("checklist"), list):
        p["checklist"] = [c for c in CHECKLIST_IDS if c in b["checklist"]]
    if b.get("lang") in ("en", "fil"):
        p["lang"] = b["lang"]
    return p


def init_app(app):
    @app.post("/api/auth/signup")
    def api_signup():
        b = request.get_json(silent=True) or {}
        name = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()
        contact = normalize_contact(b.get("contact"))
        password = str(b.get("password") or "")
        if not 2 <= len(name) <= 80:
            return jsonify(error="Enter your full name."), 400
        if not contact:
            return jsonify(error="Enter a valid email or mobile number (for example 0917 123 4567)."), 400
        if len(password) < 8:
            return jsonify(error="Use a password with at least 8 characters."), 400
        if not b.get("agree"):
            return jsonify(error="Please agree to the Terms and Privacy Policy."), 400
        prefs = clean_preferences(b, {"barangay": None, "alert_topics": ["rain_flood", "earthquake", "local"],
                                      "checklist": [], "lang": "en"})
        user = create_user(name, contact, hash_password(password), prefs)
        if not user:
            return jsonify(error="An account with this email or number already exists. Log in instead."), 409
        token, ttl = _start_session(user, bool(b.get("remember")))
        return jsonify(token=token, expires_in=ttl, user=public(user)), 201

    @app.post("/api/auth/login")
    def api_login():
        ip = request.remote_addr or "?"
        if _too_many_failures(ip):
            return jsonify(error="Too many tries. Wait 15 minutes, or continue as a guest."), 429
        b = request.get_json(silent=True) or {}
        contact = normalize_contact(b.get("contact"))
        user = find_user(contact) if contact else None
        if not user or not check_password(str(b.get("password") or ""), user["password"]):
            _record_failure(ip)
            return jsonify(error="That email/number and password do not match."), 401
        token, ttl = _start_session(user, bool(b.get("remember")))
        return jsonify(token=token, expires_in=ttl, user=public(user))

    @app.post("/api/auth/logout")
    def api_logout():
        token = _bearer()
        if token:
            with db.tx() as con:
                con.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        return jsonify(ok=True)

    @app.get("/api/auth/me")
    def api_me():
        user = current_user()
        return (jsonify(user=public(user)), 200) if user else (jsonify(error="not signed in"), 401)

    @app.put("/api/me/preferences")
    def api_preferences():
        user = current_user()
        if not user:
            return jsonify(error="not signed in"), 401
        user["preferences"] = clean_preferences(request.get_json(silent=True) or {}, user["preferences"])
        save_preferences(user["id"], user["preferences"])
        return jsonify(user=public(user))
