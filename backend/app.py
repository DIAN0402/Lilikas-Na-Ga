"""Lilikas Na Ga backend: a JSON API only. The website lives in ../frontend and calls this API over HTTP.

Run from the backend folder:   python app.py      ->  http://127.0.0.1:5000/api/health

Request flow:  browser (frontend/) --HTTP/JSON--> routes registered here --> business logic --> files in data/
"""
import settings

settings.load_env_file()   # must run before the modules below read their settings

import hmac
import os
import secrets

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import ai_client
import db
import alerts
import assist
import auth
import centers
import hazard
import overview
import routing
import weather

app = Flask(__name__, static_folder=None)
app.json.sort_keys = False
ADMIN_KEY = os.environ.get("ADMIN_KEY") or secrets.token_urlsafe(6)   # printed at startup if not set
ORIGINS = settings.cors_origins()


def need_admin():
    """True when the request does NOT carry the admin key (staff-only routes return 401 then)."""
    return not hmac.compare_digest(request.headers.get("X-Admin-Key", ""), ADMIN_KEY)


# ---- CORS: the frontend runs on its own origin (e.g. http://localhost:5173), so the browser needs these headers.
@app.after_request
def cors(resp):
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if origin and ("*" in ORIGINS or origin in ORIGINS):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Admin-Key"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


@app.before_request
def preflight():
    if request.method == "OPTIONS":
        return app.make_default_options_response()


@app.errorhandler(HTTPException)
def http_error(exc):
    """Every error is JSON, so the frontend can always show `error`."""
    return jsonify(error=exc.description or exc.name), exc.code


@app.errorhandler(Exception)
def server_error(exc):
    app.logger.exception(exc)
    return jsonify(error="Something went wrong on the server. Please try again."), 500


@app.get("/")
def root():
    return jsonify(name="Lilikas Na Ga API", health="/api/health",
                   note="This is the backend. Open the website from the frontend folder (see README).")


@app.get("/api/health")
def api_health():
    return jsonify(ok=True, ai=ai_client.describe(), database=db.describe()["kind"], alerts={"earthquakes": alerts.QUAKE_STATUS,
                                                             "storms": alerts.STORM_STATUS})


@app.get("/layers/<path:name>")
def layer(name):
    """Light map layers (GeoJSON) from the data folder, for the map on the website."""
    resp = send_from_directory(settings.LAYERS_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@app.get("/api/admin/check")
def api_admin_check():
    return (jsonify(ok=True), 200) if not need_admin() else (jsonify(error="wrong key"), 401)


# ---- each module registers its own /api routes
hazard.init_app(app)                                      # /api/assess, /api/locate
centers.init_app(app, need_admin)                         # /api/centers, /api/sim, admin edits
routing.init_app(app, centers.snapshot)                   # /api/route
alerts.init_app(app, need_admin)                          # /api/feed, staff alert posting
assist.init_app(app, need_admin, hazard.assess, alerts.current_feed, centers.snapshot)    # Lilikas Assist (AI)
overview.init_app(app, hazard.assess, alerts.current_feed, centers.snapshot)             # /api/overview
weather.init_app(app, hazard.assess, alerts.current_feed)                                 # /api/weather (Open-Meteo)
auth.init_app(app)                                        # /api/auth/*, /api/me/preferences (in memory, no DB yet)

if __name__ == "__main__":
    centers.start()
    alerts.start()
    ai = ai_client.describe()
    print("Lilikas Assist AI: " + (f"ON ({ai['model']} via {ai['base_url']})" if ai["enabled"]
                                   else "OFF, using simple rules (set AI_API_KEY in backend/.env to turn it on)"))
    print(f"Website origins allowed: {', '.join(ORIGINS)}")
    d = db.describe()
    print("Database: " + (f"Neon / PostgreSQL at {d['where']}" if d["kind"] == "postgresql" else f"SQLite file {d['where']}"))
    print(f"\nAPI: http://127.0.0.1:{os.environ.get('PORT', 5000)}/api/health   admin key: {ADMIN_KEY}\n")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)), debug=False)
