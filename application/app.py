"""Entry point and wiring. Run from the repo root:  python application/app.py  ->  http://127.0.0.1:5000

Request flow:  browser (presentation/) -> routes in this tier -> business logic -> files in data/
"""
import settings

settings.load_env_file()   # must run before the modules below read their settings

import hmac
import os
import secrets

from flask import Flask, jsonify, request, send_from_directory

import alerts
import assist
import centers
import hazard
import routing
import weather

app = Flask(__name__, static_folder=str(settings.STATIC_DIR), static_url_path="")
ADMIN_KEY = os.environ.get("ADMIN_KEY") or secrets.token_urlsafe(6)   # printed at startup if not set


def need_admin():
    return not hmac.compare_digest(request.headers.get("X-Admin-Key", ""), ADMIN_KEY)


# ---- Tier 1 hand-off: serve the pages, and the light map layers that live in the data tier
@app.get("/")
def index():
    return send_from_directory(settings.STATIC_DIR, "index.html")


@app.get("/overview")
def overview_page():
    return send_from_directory(settings.STATIC_DIR, "overview.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(settings.STATIC_DIR, "admin.html")


@app.get("/layers/<path:name>")
def layer(name):
    return send_from_directory(settings.LAYERS_DIR, name)


@app.get("/api/admin/check")
def api_admin_check():
    return (jsonify(ok=True), 200) if not need_admin() else (jsonify(error="wrong key"), 401)


# ---- Tier 2 modules register their own /api routes
hazard.init_app(app)                                      # /api/assess, /api/locate
centers.init_app(app, need_admin)                         # /api/centers, /api/sim, admin edits
routing.init_app(app, centers.snapshot)                   # /api/route
alerts.init_app(app, need_admin)                          # /alerts page, /api/feed, staff alert posting
weather.init_app(app, hazard.assess, alerts.current_feed)   # /api/weather (rainfall + combined risk)
assist.init_app(app, need_admin, hazard.assess, alerts.current_feed, centers.snapshot)   # Lilikas Assist

if __name__ == "__main__":
    centers.start()
    alerts.start()
    print("Lilikas Assist: " + (f"AI on ({assist.NIM_MODEL} via {assist.NIM_BASE})" if assist.ai_enabled()
                                else "AI off, using simple rules (set NVIDIA_API_KEY in .env to turn the AI on)"))
    print(f"\nAdmin page: http://127.0.0.1:5000/admin   key: {ADMIN_KEY}\n")
    app.run(debug=False)
