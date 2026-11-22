"""Alerts for Batangas City: earthquakes (PHIVOLCS), storms (Bagyo Storms API) and rain/flood or local
alerts that staff post by hand. Everything is merged into one feed for the Alerts page.

Earthquakes come from the phivocs-api scraper service (https://github.com/ravvdevv/phivocs-api).
Storms come from the Bagyo Storms API (https://bagyo.io/developers).

Settings (environment variables / .env):
    BAGYO_API_KEY      free key from https://bagyo.io/developers (storm alerts are off without it)
    PHIVOLCS_API_URL   address of the phivocs-api service (default http://localhost:3000)
    ALERT_INTERVAL     seconds between earthquake checks (default 300)
    STORM_INTERVAL     seconds between storm checks (default 300; the free Bagyo key allows 1,000 requests/day)
    PH_MIN_MAG         minimum magnitude for a quake anywhere in the Philippines (default 4.0)

The alert rules below are simple planning rules for this project, NOT official PHIVOLCS/PAGASA forecasts.
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from flask import jsonify, request
from shapely.affinity import affine_transform
from shapely.geometry import Point, Polygon

import batangas_risk as br
from geo import haversine_km
from settings import ALERTS_PATH

PHT = timezone(timedelta(hours=8))   # PHIVOLCS times are Philippine Time
USER_AGENT = "BatangasHazardApp/1.0"
ACTIVE_HOURS = 24                    # earthquake alerts expire after this long
LOCK = threading.Lock()
ALERTS = []                          # earthquake + staff alerts, newest first (persisted to ALERTS_PATH)

LEVEL_LABELS = {"high": "HIGH · PREPARE", "advisory": "ADVISORY"}
EQ_STEPS = [
    {"title": "Drop, cover and hold on", "text": "If you feel shaking, protect your head and neck until it stops."},
    {"title": "Check for hazards", "text": "Once it stops, look for gas leaks, damage and fallen power lines."},
    {"title": "Expect aftershocks", "text": "Stay away from damaged buildings. Follow official instructions."},
]
STORM_STEPS = [
    {"title": "Follow PAGASA bulletins", "text": "Check pagasa.dost.gov.ph and local announcements for official warnings."},
    {"title": "Prepare your household", "text": "Charge phones, stock water and food, and secure loose items outside."},
    {"title": "Know your evacuation center", "text": "Find the nearest safe center on the hazard map and be ready to move early."},
]


# ======================================================================
# Earthquakes
# ======================================================================
QUAKE_URL = os.environ.get("PHIVOLCS_API_URL", "http://localhost:3000").rstrip("/")
QUAKE_POLL = float(os.environ.get("ALERT_INTERVAL", 300))
FETCH_COUNT = 30                       # how many recent quakes to read each time
# Alert near the city when a quake is within (max distance km, minimum magnitude) of the city boundary.
RULES = [(30, 3.0), (75, 4.0), (150, 5.0), (300, 6.0)]
NAMED_MIN_MAG = 2.5                    # a quake whose location text names Batangas alerts from this magnitude
PH_MIN_MAG = float(os.environ.get("PH_MIN_MAG", 4.0))   # anywhere in the Philippines
PH_BOX = (4.5, 21.5, 116.0, 128.0)     # south, north, west, east (rough Philippine area)
QUAKE_STATUS = {"last_ok": None, "last_error": None, "fetched": 0, "unreadable": 0}

_TIME_FORMATS = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d %B %Y - %I:%M %p", "%d %B %Y %I:%M %p",
                 "%d %b %Y - %I:%M %p", "%B %d, %Y %I:%M %p", "%d-%b-%Y %H:%M:%S"]


def severity(mag, dist_km):
    """'warning' for strong or close quakes, otherwise 'advisory'."""
    if (mag >= 5.0 and dist_km <= 75) or (mag >= 6.0 and dist_km <= 300) or (mag >= 4.5 and dist_km <= 20):
        return "warning"
    return "advisory"


def parse_number(value):
    m = re.search(r"-?\d+(?:\.\d+)?", str(value if value is not None else ""))
    return float(m.group(0)) if m else None


def parse_coord(value):
    """'10.50°N' -> 10.5, '125.20°E' -> 125.2, 'S'/'W' -> negative. None if unreadable."""
    if isinstance(value, (int, float)):
        return float(value)
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?", str(value or ""))
    if not m:
        return None
    x = float(m.group(1))
    return -abs(x) if (m.group(2) or "").upper() in ("S", "W") else x


def parse_time(q):
    """The quake's time (Philippine Time) from the feed's date/time fields. None if unreadable."""
    iso = q.get("datetime") or q.get("dateTime")
    if iso:
        try:
            t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            return t if t.tzinfo else t.replace(tzinfo=PHT)
        except ValueError:
            pass
    raw = re.sub(r"\s+", " ", f"{q.get('date', '')} {q.get('time', '')}".strip())
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=PHT)
        except ValueError:
            continue
    return None


def read_quake(q):
    """(lat, lon, magnitude, time) from one feed record, or None if any of them can't be read."""
    lat, lon = parse_coord(q.get("latitude")), parse_coord(q.get("longitude"))
    mag = q.get("magnitudeNumeric")
    mag = float(mag) if isinstance(mag, (int, float)) else parse_number(q.get("magnitude"))
    when = parse_time(q)
    return None if None in (lat, lon, mag, when) else (lat, lon, mag, when)


@lru_cache(maxsize=None)
def _boundary_km():
    """The city boundary in the local kilometre grid used by batangas_risk."""
    return affine_transform(br.load_boundary(), [
        br.KM_PER_DEG_LON, 0, 0, br.KM_PER_DEG_LAT, -br.LON0 * br.KM_PER_DEG_LON, -br.LAT0 * br.KM_PER_DEG_LAT])


def distance_km(lat, lon):
    """Distance from an epicenter to the Batangas City boundary (0 if inside)."""
    return _boundary_km().distance(Point(*br.to_km(lon, lat)))


def make_alert(q, parsed):
    """Turn one feed record into an alert dict, or None if it isn't relevant or is older than ACTIVE_HOURS."""
    lat, lon, mag, when = parsed
    if datetime.now(PHT) - when > timedelta(hours=ACTIVE_HOURS):
        return None
    dist = distance_km(lat, lon)
    location = str(q.get("location", "")).strip()
    needed = [m for d, m in RULES if dist <= d]
    if "batangas" in location.lower():
        needed.append(NAMED_MIN_MAG)
    near = bool(needed) and mag >= min(needed)            # matters for Batangas City itself
    in_ph = PH_BOX[0] <= lat <= PH_BOX[1] and PH_BOX[2] <= lon <= PH_BOX[3]
    if not near and not (in_ph and mag >= PH_MIN_MAG):
        return None
    key = f"{when.isoformat()}|{round(lat, 1)}|{round(lon, 1)}"
    return {"id": hashlib.sha1(key.encode()).hexdigest()[:10], "source": "PHIVOLCS", "kind": "earthquake",
            "magnitude": mag, "depth_km": parse_number(q.get("depth")), "location": location,
            "lat": lat, "lon": lon, "time": when.isoformat(), "distance_km": round(dist, 1),
            "severity": "warning" if (near and severity(mag, dist) == "warning") or (in_ph and mag >= 5.5) else "advisory",
            "near": near}


def fetch_quakes():
    """Ask the phivocs-api service for the most recent earthquakes. If it rejects the count (HTTP 400/404),
    retry with smaller counts and the alternate path."""
    last = None
    for count in dict.fromkeys([FETCH_COUNT, 20, 10]):
        for path in ("/recent", "/earthquakes/recent"):
            req = urllib.request.Request(f"{QUAKE_URL}{path}/{count}", headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                return body.get("data", []) if isinstance(body, dict) else body
            except urllib.error.HTTPError as exc:
                last = urllib.error.URLError(f"HTTP {exc.code} from {req.full_url}")
                if exc.code not in (400, 404):
                    raise last
    raise last


def refresh_quakes(quakes=None):
    """Read the feed and add any new relevant earthquakes. Returns how many were added."""
    try:
        quakes = fetch_quakes() if quakes is None else quakes
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        with LOCK:
            QUAKE_STATUS["last_error"] = f"Could not read the PHIVOLCS feed: {exc}"
        return 0
    parsed = [(q, read_quake(q)) for q in quakes]
    unreadable = sum(1 for _, p in parsed if p is None)
    added = 0
    with LOCK:
        QUAKE_STATUS.update(fetched=len(quakes), unreadable=unreadable, last_error=None,
                            last_ok=datetime.now(PHT).isoformat())
        if quakes and unreadable == len(quakes):
            QUAKE_STATUS["last_error"] = "Could not understand the feed's date, time or coordinates format."
        known = {a["id"]: a for a in ALERTS}
        for q, p in parsed:
            a = make_alert(q, p) if p else None
            if not a:
                continue
            if a["id"] in known:                                  # PHIVOLCS may revise the magnitude
                known[a["id"]].update(magnitude=a["magnitude"], severity=a["severity"])
            else:
                ALERTS.insert(0, a)
                added += 1
        ALERTS.sort(key=lambda a: a["time"], reverse=True)
        _save()
    return added


# ======================================================================
# Storms
# ======================================================================
BAGYO_URL = os.environ.get("BAGYO_API_URL", "https://bagyo.io").rstrip("/")
BAGYO_KEY = os.environ.get("BAGYO_API_KEY", "").strip()   # stays on the server, never sent to the browser
STORM_POLL = float(os.environ.get("STORM_INTERVAL", 300))
CITY = (13.7565, 121.0583)    # Batangas City centre, used for storm distances
WATCH_KM = 1000               # list a storm that is, or is forecast to come, within this distance
NEAR_KM = 500                 # forecast to pass this close = matters for Batangas City itself
HIGH_KM = 300                 # forecast to pass this close = HIGH
# Philippine Area of Responsibility (PAGASA's monitoring area), as lon/lat corners
PAR = Polygon([(120, 25), (135, 25), (135, 5), (115, 5), (115, 15), (120, 21)])
STORMS = []                   # storms worth showing, already analysed
STORM_STATUS = {"configured": bool(BAGYO_KEY), "last_ok": None, "last_error": None, "active": 0, "stale": False,
                "attribution": "Storm data from the Japan Meteorological Agency, Joint Typhoon Warning Center "
                               "and National Hurricane Center, via Bagyo (bagyo.io)."}


def _point(p):
    """(lat, lon, time) from a Bagyo fix or track point, or None if unreadable."""
    try:
        t = p.get("time")
        return float(p["lat"]), float(p["lon"]), (datetime.fromisoformat(t.replace("Z", "+00:00")) if t else None)
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def closest_approach(points):
    """Closest distance (km) to the city along the path, joining the points with straight lines.
    Returns (km, time)."""
    pts = [q for q in (_point(p) for p in points) if q]
    best = (float("inf"), None)
    for i, (la, lo, t) in enumerate(pts):
        d = haversine_km(la, lo, *CITY)
        if d < best[0]:
            best = (d, t)
        if i:
            pla, plo, pt = pts[i - 1]
            steps = max(1, int(haversine_km(pla, plo, la, lo) // 25))
            for k in range(1, steps):
                f = k / steps
                d = haversine_km(pla + (la - pla) * f, plo + (lo - plo) * f, *CITY)
                if d < best[0]:
                    best = (d, pt + (t - pt) * f if (t and pt) else None)
    return best


def make_storm(s):
    """Analyse one Bagyo storm. Returns an alert dict, or None if it is not relevant to Batangas."""
    cur = s.get("current") or {}
    here = _point(cur)
    if not here:
        return None
    track = [cur] + list(s.get("track") or [])
    now_km = haversine_km(here[0], here[1], *CITY)
    cpa_km, cpa_t = closest_approach(track)
    in_par_now = PAR.covers(Point(here[1], here[0]))
    enters_par = any(PAR.covers(Point(q[1], q[0])) for q in (_point(p) for p in track) if q)
    if not (in_par_now or enters_par or s.get("philippineName") or min(now_km, cpa_km) <= WATCH_KM):
        return None

    wind_kt = cur.get("windKt")
    strong = (wind_kt or 0) >= 64
    gale = cur.get("galeRadiusKm") or 0
    near = cpa_km <= NEAR_KM or bool(gale and cpa_km <= gale)
    high = (cpa_km <= HIGH_KM or (cpa_km <= 500 and strong) or bool(gale and cpa_km <= gale)
            or ((in_par_now or enters_par) and strong))

    name, local = s.get("name") or s.get("id"), s.get("philippineName")
    where = ("Inside" if in_par_now else "Forecast to enter" if enters_par else "Outside") + " the Philippine Area of Responsibility"
    when = f" around {cpa_t.astimezone(PHT).strftime('%d %b %H:%M')} PHT" if cpa_t else ""
    wind = f" Winds {wind_kt:g} kt ({s.get('agency', 'agency')} reading)" if wind_kt is not None else ""
    pres = f", {cur['pressureHpa']:g} hPa" if cur.get("pressureHpa") is not None else ""
    summary = (f"{where}. Now about {now_km:.0f} km from Batangas City.{wind}{pres}. "
               f"Forecast track comes within about {cpa_km:.0f} km of the city{when}. "
               "Forecast tracks can shift: follow PAGASA for official warnings.")
    try:
        issued = datetime.fromisoformat(str(s.get("updatedAt") or cur.get("time")).replace("Z", "+00:00")).astimezone(PHT)
    except ValueError:
        issued = datetime.now(PHT)
    level = "high" if high else "advisory"
    return {"id": "storm-" + str(s.get("id")), "category": "storm",
            "source": s.get("agencyName") or s.get("agency") or "Bagyo",
            "title": f"Tropical cyclone {name}" + (f" ({local})" if local else ""), "summary": summary,
            "area": f"Philippines ({where[0].lower() + where[1:]})", "near": near,
            "issued": issued.isoformat(), "expires": (issued + timedelta(hours=12)).isoformat(),
            "steps": STORM_STEPS, "evac_order": False, "level": level, "level_label": LEVEL_LABELS[level],
            "expired": False, "distance_km": round(now_km), "closest_km": round(cpa_km),
            "advisory_url": s.get("advisoryUrl"), "storm": {"lat": here[0], "lon": here[1], "wind_kt": wind_kt}}


def fetch_storms():
    req = urllib.request.Request(f"{BAGYO_URL}/v1/storms", headers={
        "X-API-Key": BAGYO_KEY, "Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def refresh_storms():
    """Read the Bagyo feed and rebuild the list of storms that matter for Batangas City."""
    if not BAGYO_KEY:
        STORM_STATUS["last_error"] = "No Bagyo API key set. Get a free key at bagyo.io/developers and put it in .env as BAGYO_API_KEY."
        return
    try:
        body = fetch_storms()
    except urllib.error.HTTPError as exc:
        msg = {401: "The Bagyo API key was rejected.", 429: "Bagyo rate limit reached; will retry."}.get(exc.code, f"HTTP {exc.code}")
        STORM_STATUS["last_error"] = f"Could not read the Bagyo storm feed: {msg}"
        return
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        STORM_STATUS["last_error"] = f"Could not read the Bagyo storm feed: {exc}"
        return
    data = body.get("data", []) if isinstance(body, dict) else body
    meta = body.get("meta", {}) if isinstance(body, dict) else {}
    found = [x for x in (make_storm(s) for s in data) if x]
    with LOCK:
        STORMS[:] = found
        STORM_STATUS.update(last_error=None, last_ok=datetime.now(PHT).isoformat(), active=len(data),
                            stale=bool(meta.get("stale")))
        if meta.get("attribution"):
            STORM_STATUS["attribution"] = meta["attribution"]


# ======================================================================
# Storage, the combined feed, background checks and routes
# ======================================================================
def _load():
    try:
        rows = json.loads(ALERTS_PATH.read_text("utf-8"))
        ALERTS[:] = [dict(a, kind=a.get("kind", "earthquake")) for a in rows if not a.get("test")]   # drop old test alerts
    except (OSError, ValueError):
        ALERTS.clear()


def _save():
    tmp = ALERTS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(ALERTS[:200], indent=1), "utf-8")
    tmp.replace(ALERTS_PATH)


def view(a):
    """Shape one stored alert (earthquake or staff-posted) for the Alerts page."""
    issued = datetime.fromisoformat(a["time"])
    if a["kind"] == "earthquake":
        depth = f", depth {a['depth_km']:g} km" if a.get("depth_km") is not None else ""
        v = {"category": "earthquake", "source": "PHIVOLCS", "title": f"Magnitude {a['magnitude']:.1f} earthquake",
             "summary": f"{a.get('location', '')}. Epicenter about {a.get('distance_km')} km from Batangas City{depth}. "
                        "See PHIVOLCS for the official report.",
             "expires": (issued + timedelta(hours=ACTIVE_HOURS)).isoformat(), "steps": EQ_STEPS,
             "evac_order": False, "level": "high" if a.get("severity") == "warning" else "advisory",
             "area": a.get("location") or "Philippines", "near": a.get("near", True),
             "advisory_url": "https://earthquake.phivolcs.dost.gov.ph/"}
    else:
        v = {"category": a["kind"], "source": a.get("source", ""), "title": a.get("title", ""),
             "summary": a.get("summary", ""), "expires": a["expires"], "steps": a.get("steps", []),
             "evac_order": bool(a.get("evac_order")), "level": a.get("level", "advisory"),
             "area": "Batangas City", "near": True, "advisory_url": None}
    v.update(id=a["id"], issued=a["time"], level_label=LEVEL_LABELS.get(v["level"], "ADVISORY"),
             expired=datetime.fromisoformat(v["expires"]) < datetime.now(PHT))
    return v


def current_feed():
    """Every alert shaped for display: active first, HIGH before advisory, then newest first."""
    with LOCK:
        items = [view(a) for a in ALERTS[:60]] + [dict(x) for x in STORMS]
    items.sort(key=lambda v: (v["expired"], v["level"] != "high", -datetime.fromisoformat(v["issued"]).timestamp()))
    return items


def _poll(refresh, seconds):
    while True:
        try:
            refresh()
        except Exception as exc:       # a bad feed must never kill the background thread
            print(f"Alert check failed ({refresh.__name__}): {exc}")
        time.sleep(seconds)


def start():
    """Start the background checkers (earthquakes and storms)."""
    threading.Thread(target=_poll, args=(refresh_quakes, QUAKE_POLL), daemon=True).start()
    threading.Thread(target=_poll, args=(refresh_storms, STORM_POLL), daemon=True).start()
    print(f"Earthquake alerts: checking {QUAKE_URL} every {QUAKE_POLL:.0f} s")
    print("Storm alerts: " + (f"checking {BAGYO_URL} every {STORM_POLL:.0f} s" if BAGYO_KEY
                              else "OFF (set BAGYO_API_KEY in .env to turn on)"))


def init_app(app, need_admin):
    """Register the alert routes. `need_admin()` is the app's key check."""
    _load()

    @app.get("/api/feed")
    def api_feed():
        return jsonify(alerts=current_feed(), status=QUAKE_STATUS, storm_status=STORM_STATUS)

    @app.post("/api/admin/alerts")
    def api_alert_create():
        """Staff post a rain/flood or local-government alert."""
        if need_admin():
            return jsonify(error="unauthorized"), 401
        b = request.get_json(silent=True) or {}
        kind, title = b.get("kind"), str(b.get("title", "")).strip()
        if kind not in ("rain_flood", "local"):
            return jsonify(error="kind must be rain_flood or local"), 400
        if not title or len(title) > 100:
            return jsonify(error="title is required (100 characters at most)"), 400
        try:
            hours = float(b.get("hours", 6))
        except (TypeError, ValueError):
            hours = -1
        if not 0.1 <= hours <= 168:
            return jsonify(error="hours must be a number from 0.1 to 168"), 400
        raw = b.get("steps") or []
        steps = []
        for line in (raw.splitlines() if isinstance(raw, str) else raw)[:3]:
            t, _, d = str(line).partition("|")        # "Title | detail"
            if t.strip():
                steps.append({"title": t.strip()[:60], "text": d.strip()[:160]})
        now = datetime.now(PHT)
        a = {"id": "m" + hashlib.sha1(str(time.time()).encode()).hexdigest()[:7], "kind": kind,
             "source": str(b.get("source") or ("PAGASA" if kind == "rain_flood" else "Local government"))[:60],
             "title": title, "summary": str(b.get("summary", "")).strip()[:400],
             "level": "high" if b.get("level") == "high" else "advisory", "steps": steps,
             "evac_order": bool(b.get("evac_order")),
             "time": now.isoformat(), "expires": (now + timedelta(hours=hours)).isoformat()}
        with LOCK:
            ALERTS.insert(0, a)
            _save()
        return jsonify(view(a)), 201

    @app.delete("/api/admin/alerts/<aid>")
    def api_alert_delete(aid):
        if need_admin():
            return jsonify(error="unauthorized"), 401
        with LOCK:
            before = len(ALERTS)
            ALERTS[:] = [a for a in ALERTS if a["id"] != aid]
            if len(ALERTS) == before:
                return jsonify(error="unknown alert"), 404
            _save()
        return jsonify(removed=aid)
