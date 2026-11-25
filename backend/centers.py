"""Evacuation centers: live capacity (simulated), admin edits, add/remove. Saved in the database (table `centers`);
data/stores/evacuation_centers.json is only the starting list copied in on the first run."""
import json, os, random, secrets, threading, time
from datetime import datetime

from flask import jsonify, request
from shapely.geometry import Point

import db
import hazard
from settings import CENTERS_PATH


def _write_all(con, rows):
    con.execute("DELETE FROM centers")
    con.executemany("INSERT INTO centers (id, position, data) VALUES (?, ?, ?)",
                    [(c["id"], i, db.dumps(c)) for i, c in enumerate(rows)])


def load_centers():
    """Centers from the database. First run (empty table): the starting list in evacuation_centers.json is copied in."""
    db.import_json_once("centers", CENTERS_PATH, _write_all)
    return [db.loads(r["data"], {}) for r in db.query("SELECT data FROM centers ORDER BY position")]


CENTERS = load_centers()
SIM_INTERVAL = float(os.environ.get("SIM_INTERVAL", 5))  # seconds between updates
LOCK = threading.Lock()
SIM = {"mode": "calm"}   # calm | storm | paused
LIVE = {c["id"]: {"occupied": c["occupied"], "status": c["status"], "updated": None} for c in CENTERS}
STATIC = {}              # hazard info per center, computed once (it never changes)
BY_ID = {c["id"]: c for c in CENTERS}
FACILITIES = ("Toilets", "Water", "Step-free entry")
STATUSES = ("open", "full", "closed", "unavailable")


def now():
    return datetime.now().strftime("%H:%M:%S")


def tick():
    """One simulation step: people arrive and leave. Closed/unavailable centers stay as they are."""
    bias = {"calm": (-4, 5), "storm": (0, 12)}.get(SIM["mode"])
    if bias is None:
        return
    with LOCK:
        for cid, st in LIVE.items():
            if st["status"] in ("closed", "unavailable") or BY_ID[cid].get("manual"):
                continue
            cap = BY_ID[cid]["capacity"]
            st["occupied"] = max(0, min(cap, st["occupied"] + random.randint(*bias)))
            st["status"] = "full" if st["occupied"] >= cap else "open"
            st["updated"] = now()


def sim_loop():
    while True:
        time.sleep(SIM_INTERVAL)
        tick()


def start():
    threading.Thread(target=sim_loop, daemon=True).start()


def save_centers():
    """Save current numbers in the database so admin edits survive a restart."""
    rows = [{**c, "occupied": LIVE[c["id"]]["occupied"], "status": LIVE[c["id"]]["status"]} for c in CENTERS]
    with db.tx() as con:
        _write_all(con, rows)


def snapshot():
    """Every center with its live numbers and hazard info (shared by /api/centers and the route planner)."""
    with LOCK:  # snapshot, so adding/removing a center mid-request can't break the loop
        snap = [(dict(c), dict(LIVE[c["id"]])) for c in CENTERS]
    out = []
    for c, live in snap:
        if c["id"] not in STATIC:
            a = hazard.assess(c["lat"], c["lon"])
            STATIC[c["id"]] = {"hazards": a["results"], "suitability": hazard.suitability(a)}
        out.append({**c, **STATIC[c["id"]], **live, "manual": bool(c.get("manual")), "sim_mode": SIM["mode"]})
    return out


def init_app(app, need_admin):
    @app.get("/api/centers")
    def api_centers():
        return jsonify(snapshot())

    @app.post("/api/centers/<cid>")
    def api_set_center(cid):
        """Admin: set capacity, occupied, status and/or manual (manual = simulator leaves it alone)."""
        if need_admin():
            return jsonify(error="unauthorized"), 401
        if cid not in LIVE:
            return jsonify(error="unknown center"), 404
        body = request.get_json(silent=True) or {}
        try:
            with LOCK:
                c, st = BY_ID[cid], LIVE[cid]
                if "capacity" in body:
                    cap = int(body["capacity"])
                    if not 0 <= cap <= 100000:
                        raise ValueError("capacity out of range")
                    c["capacity"] = cap
                if "occupied" in body:
                    st["occupied"] = int(body["occupied"])
                if body.get("status") in STATUSES:
                    st["status"] = body["status"]
                if "manual" in body:
                    c["manual"] = bool(body["manual"])
                st["occupied"] = max(0, min(c["capacity"], st["occupied"]))
                if st["status"] in ("open", "full"):   # keep open/full consistent with the numbers
                    st["status"] = "full" if st["occupied"] >= c["capacity"] else "open"
                st["updated"] = now()
                save_centers()
                return jsonify({**st, "capacity": c["capacity"], "manual": bool(c.get("manual"))})
        except (ValueError, TypeError) as exc:
            return jsonify(error=f"invalid value: {exc}"), 400

    @app.post("/api/admin/centers")
    def api_add_center():
        """Admin: add a new evacuation center. Needs name, lat, lon, capacity."""
        if need_admin():
            return jsonify(error="unauthorized"), 401
        b = request.get_json(silent=True) or {}
        if any(b.get(k) in (None, "") for k in ("name", "lat", "lon", "capacity")):
            return jsonify(error="name, latitude, longitude and capacity are required"), 400
        try:
            name = str(b["name"]).strip()
            lat, lon, cap = float(b["lat"]), float(b["lon"]), int(b["capacity"])
            occ = int(b.get("occupied") or 0)
        except (ValueError, TypeError):
            return jsonify(error="latitude, longitude, capacity and people must be numbers"), 400
        if not name or len(name) > 80:
            return jsonify(error="name is required (80 characters at most)"), 400
        if not 1 <= cap <= 100000:
            return jsonify(error="capacity must be between 1 and 100000"), 400
        if not hazard.BOUNDARY.covers(Point(lon, lat)):
            return jsonify(error="That location is outside Batangas City. Check the latitude and longitude."), 400
        occ = max(0, min(cap, occ))
        status = b.get("status") if b.get("status") in STATUSES else "open"
        if status in ("open", "full"):
            status = "full" if occ >= cap else "open"
        center = {"id": secrets.token_hex(3), "name": name, "lat": lat, "lon": lon, "status": status,
                  "capacity": cap, "occupied": occ,
                  "facilities": [f for f in (b.get("facilities") or []) if f in FACILITIES],
                  "contact": (str(b.get("contact") or "").strip()[:120] or None), "sample": False}
        with LOCK:
            CENTERS.append(center)
            BY_ID[center["id"]] = center
            LIVE[center["id"]] = {"occupied": occ, "status": status, "updated": now()}
            save_centers()
        return jsonify(center), 201

    @app.delete("/api/centers/<cid>")
    def api_delete_center(cid):
        """Admin: remove an evacuation center."""
        if need_admin():
            return jsonify(error="unauthorized"), 401
        with LOCK:
            center = BY_ID.pop(cid, None)
            if center is None:
                return jsonify(error="unknown center"), 404
            CENTERS.remove(center)
            LIVE.pop(cid, None)
            STATIC.pop(cid, None)
            save_centers()
        return jsonify(removed=cid)

    @app.route("/api/sim", methods=["GET", "POST"])
    def api_sim():
        """GET the simulation mode, or POST {"mode": "calm" | "storm" | "paused"}."""
        if request.method == "POST":
            if need_admin():
                return jsonify(error="unauthorized"), 401
            mode = (request.get_json(silent=True) or {}).get("mode")
            if mode not in ("calm", "storm", "paused"):
                return jsonify(error="mode must be calm, storm or paused"), 400
            SIM["mode"] = mode
        return jsonify(SIM)
