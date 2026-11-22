"""
Evacuation routing for the hazard map.

Given a person's location, pick the best evacuation center and the road route to it.
"Best" is not just nearest. Each open center is scored in minutes (lower is better):

    score = travel time
          + crowding penalty   (centers that are nearly full)
          + center hazard      (high flood / landslide / fault mapped at the center)
          + route hazard       (share of the road that crosses mapped HIGH flood / landslide zones)

Closed, unavailable and full centers are never recommended.

Routes come from an OSRM server (free public demo server by default, no key needed):
    OSRM_WALKING_URL   default https://routing.openstreetmap.de/routed-foot
Drive and Walk draw the SAME route (the walking route). Walk shows the walking time from the server;
Drive shows an estimated driving time for the same distance at DRIVE_KMH (default 30 km/h, a cautious
speed for crowded evacuation roads). Set DRIVE_KMH to change it.
If the routing server cannot be reached, the app falls back to straight-line estimates and says so.
The public demo server is for light use. For heavy use, run your own OSRM and set the URL above.

This is a planning aid, not an official evacuation plan: roads can be flooded or blocked.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from flask import jsonify, request
from shapely.geometry import LineString, shape
from shapely.ops import unary_union

from geo import haversine_km
from settings import LAYERS_DIR

ROUTE_SERVER = os.environ.get("OSRM_WALKING_URL", "https://routing.openstreetmap.de/routed-foot").rstrip("/")
MODES = ("driving", "walking")
DRIVE_KMH = float(os.environ.get("DRIVE_KMH", 30))
FALLBACK_KMH = {"driving": DRIVE_KMH, "walking": 4.5}   # used only when no routing server answers
DETOUR = 1.4                                         # roads are longer than straight lines
HTTP_TIMEOUT = 8
CACHE_SECONDS = 120
MAX_POOL = 8                                         # centers compared per request
ROUTES_SHOWN = 3                                     # road geometries fetched per request
MAX_START_KM = 60                                    # refuse starting points farther than this from every center

_cache = {}
_cache_lock = threading.Lock()


# ----------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------
def _http_json(url):
    """GET a URL as JSON, with a short cache so repeated clicks don't hammer the public servers."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": "BatangasHazardApp/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    with _cache_lock:
        if len(_cache) > 300:
            _cache.clear()
        _cache[url] = (now, data)
    return data


def _coords(points):
    return ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)


# ----------------------------------------------------------------------
# Road routing (OSRM)
# ----------------------------------------------------------------------
def _minutes(profile, walk_minutes, km):
    """Walking: the server's time. Driving: the same distance at DRIVE_KMH."""
    return km / DRIVE_KMH * 60.0 if profile == "driving" else walk_minutes


def road_table(profile, origin, dests):
    """One request: travel time (min) and distance (km) from origin to every destination.
    Returns a list of (minutes, km) or None per destination. Raises on network failure."""
    pts = [origin] + [(c["lat"], c["lon"]) for c in dests]
    url = (f"{ROUTE_SERVER}/table/v1/foot/{_coords(pts)}"
           f"?sources=0&destinations={';'.join(str(i) for i in range(1, len(pts)))}&annotations=duration,distance")
    body = _http_json(url)
    if body.get("code") != "Ok":
        raise ValueError(body.get("message") or body.get("code") or "routing error")
    out = []
    for dur, dist in zip(body["durations"][0], body["distances"][0]):
        out.append((_minutes(profile, dur / 60.0, dist / 1000.0), dist / 1000.0)
                   if dur is not None and dist is not None else None)
    return out


def road_route(profile, origin, dest):
    """Road geometry [[lat, lon], ...] with (minutes, km). Raises on failure."""
    url = (f"{ROUTE_SERVER}/route/v1/foot/{_coords([origin, dest])}"
           "?overview=full&geometries=geojson&steps=false")
    body = _http_json(url)
    if body.get("code") != "Ok" or not body.get("routes"):
        raise ValueError(body.get("message") or body.get("code") or "no route")
    r = body["routes"][0]
    line = LineString(r["geometry"]["coordinates"]).simplify(2e-5, preserve_topology=False)
    km = r["distance"] / 1000.0
    return [[y, x] for x, y in line.coords], _minutes(profile, r["duration"] / 60.0, km), km


# ----------------------------------------------------------------------
# Hazard along the route (uses the light map layers, loaded once)
# ----------------------------------------------------------------------
@lru_cache(maxsize=None)
def _high_zone(name):
    """Union of the class-3 (HIGH) polygons of a light map layer, or None if the layer is missing."""
    try:
        data = json.loads((LAYERS_DIR / name).read_text("utf-8"))
    except (OSError, ValueError):
        return None
    geoms = [shape(f["geometry"]) for f in data["features"] if f["properties"].get("c") == 3]
    return unary_union(geoms) if geoms else None


def route_exposure(geometry):
    """Share (0..1) of the route that lies inside mapped HIGH flood and HIGH landslide zones."""
    out = {"flood": 0.0, "landslide": 0.0}
    if len(geometry) < 2:
        return out
    line = LineString([(lon, lat) for lat, lon in geometry])
    total = line.length or 1e-9
    for key, layer in (("flood", "flood.json"), ("landslide", "landslide.json")):
        zone = _high_zone(layer)
        if zone is not None and zone.intersects(line):
            out[key] = min(1.0, line.intersection(zone).length / total)
    return out


# ----------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------
def spaces_left(c):
    return max(0, int(c["capacity"]) - int(c["occupied"]))


def available(c):
    return c.get("status") == "open" and spaces_left(c) > 0


def crowding_penalty(c):
    """0 min up to 60% full, rising to 12 min as the center approaches full."""
    ratio = c["occupied"] / c["capacity"] if c["capacity"] else 1.0
    return 0.0 if ratio <= 0.6 else min(12.0, (ratio - 0.6) / 0.4 * 12.0)


def center_hazard_penalty(c):
    levels = [h.get("level") for h in c.get("hazards", [])]
    return 12.0 * levels.count("High") + 4.0 * sum(1 for l in levels if l in ("Medium", "Moderate"))


def route_hazard_penalty(exposure):
    return 25.0 * exposure["flood"] + 25.0 * exposure["landslide"]


def estimate(profile, origin, c):
    km = haversine_km(origin[0], origin[1], c["lat"], c["lon"]) * DETOUR
    return km / FALLBACK_KMH[profile] * 60.0, km


def candidate_pool(origin, centers, forced=None, need=()):
    """Nearest available centers, plus any with lots of room nearby, plus the one the user picked.
    `need` = facilities the person asked for (for example Water); centers without them are skipped."""
    def line_km(c):
        return haversine_km(origin[0], origin[1], c["lat"], c["lon"])

    ok = [c for c in centers if available(c) and all(f in (c.get("facilities") or []) for f in need)]
    nearest = sorted(ok, key=line_km)[:6]
    roomy = sorted((c for c in ok if line_km(c) <= 10), key=lambda c: -spaces_left(c))[:2]
    pool = list({c["id"]: c for c in nearest + roomy}.values())[:MAX_POOL]
    if forced and forced["id"] not in {c["id"] for c in pool}:
        pool.append(forced)
    return pool


def describe(c, minutes, km, exposure, rank, pool_size, road, profile):
    reasons, warnings = [], []
    if rank == 0 and pool_size > 1:
        reasons.append(f"Best overall of {pool_size} centers with space")
    reasons.append(f"{minutes:.0f} min, {km:.1f} km" + ("" if road else " (estimate)"))
    if profile == "driving":
        reasons.append(f"Drive time is an estimate at {DRIVE_KMH:g} km/h along the walking route")
    pct = round(c["occupied"] / c["capacity"] * 100) if c["capacity"] else 100
    reasons.append(f"{spaces_left(c)} spaces left ({pct}% full)")
    if c.get("suitability"):
        text = c["suitability"].replace("mapped here", "mapped at this center")
        (warnings if text.startswith(("Not", "Use")) else reasons).append(text)
    if exposure["flood"] >= 0.05:
        warnings.append(f"About {exposure['flood'] * 100:.0f}% of this route crosses mapped high flood hazard")
    if exposure["landslide"] >= 0.05:
        warnings.append(f"About {exposure['landslide'] * 100:.0f}% of this route crosses mapped high landslide hazard")
    if c["status"] != "open":
        warnings.append("This center is not open right now")
    elif spaces_left(c) == 0:
        warnings.append("This center is full")
    return reasons, warnings


def plan(origin, profile, centers, forced_id=None, need=()):
    """Rank centers for a starting point. `centers` are dicts with live status, capacity, occupied, hazards."""
    by_id = {c["id"]: c for c in centers}
    forced = by_id.get(forced_id) if forced_id else None
    if forced_id and not forced:
        return {"error": "unknown center"}
    nearest_any = min((haversine_km(origin[0], origin[1], c["lat"], c["lon"]) for c in centers), default=None)
    if nearest_any is None:
        return {"routes": [], "message": "There are no evacuation centers on record."}
    if nearest_any > MAX_START_KM:
        return {"error": "That location is too far from every evacuation center to plan a route."}

    pool = candidate_pool(origin, centers, forced, need)
    if not pool:
        msg = ("No open evacuation center with space has all of the facilities you selected. Clear a filter to see more."
               if need else "No evacuation center is open with space right now. "
                            "Call local officials or 911 and check the Alerts page.")
        return {"routes": [], "considered": [], "message": msg}

    road = True
    try:
        table = road_table(profile, origin, pool)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError, KeyError):
        table, road = [None] * len(pool), False
    rows = []
    for c, t in zip(pool, table):
        if t is None:                      # unreachable by road, or no routing server: use a straight-line estimate
            if road:
                continue
            t = estimate(profile, origin, c)
        rows.append({"c": c, "minutes": t[0], "km": t[1],
                     "pre": t[0] + crowding_penalty(c) + center_hazard_penalty(c)})
    if not rows:
        return {"routes": [], "message": "No road route was found from this location to an open center."}
    rows.sort(key=lambda r: r["pre"])

    # Fetch road geometry for the best few (and the one the user picked), then re-score with route hazards.
    top = rows[:ROUTES_SHOWN]
    if forced and forced["id"] not in {r["c"]["id"] for r in top}:
        top += [r for r in rows if r["c"]["id"] == forced["id"]]

    def fetch(r):
        c = r["c"]
        if road:
            try:
                geom, minutes, km = road_route(profile, origin, (c["lat"], c["lon"]))
                return r, geom, minutes, km, "road"
            except (urllib.error.URLError, TimeoutError, ValueError, OSError, KeyError):
                pass
        return r, [list(origin), [c["lat"], c["lon"]]], r["minutes"], r["km"], "line"

    with ThreadPoolExecutor(max_workers=3) as pool_ex:
        fetched = list(pool_ex.map(fetch, top))

    results = []
    for r, geom, minutes, km, kind in fetched:
        c = r["c"]
        exposure = route_exposure(geom) if kind == "road" else {"flood": 0.0, "landslide": 0.0}
        score = minutes + crowding_penalty(c) + center_hazard_penalty(c) + route_hazard_penalty(exposure)
        results.append({"c": c, "geom": geom, "minutes": minutes, "km": km, "kind": kind,
                        "exposure": exposure, "score": score})
    results.sort(key=lambda r: r["score"])

    out = []
    for i, r in enumerate(results):
        c = r["c"]
        reasons, warnings = describe(c, r["minutes"], r["km"], r["exposure"], i, len(rows), r["kind"] == "road", profile)
        out.append({
            "center": {k: c.get(k) for k in ("id", "name", "lat", "lon", "status", "capacity", "occupied",
                                             "facilities", "suitability", "contact")} | {"spaces": spaces_left(c)},
            "duration_min": round(r["minutes"], 1), "distance_km": round(r["km"], 2),
            "geometry": r["geom"], "geometry_type": r["kind"], "score": round(r["score"], 1),
            "route_exposure": {k: round(v, 3) for k, v in r["exposure"].items()},
            "recommended": i == 0 and available(c), "reasons": reasons, "warnings": warnings})
    considered = [{"id": r["c"]["id"], "duration_min": round(r["minutes"], 1), "distance_km": round(r["km"], 2),
                   "score": round(r["pre"], 1)} for r in rows]
    best = next((o for o in out if o["recommended"]), None)
    return {"mode": profile, "origin": {"lat": origin[0], "lon": origin[1]},
            "source": "road" if road else "estimate",
            "note": None if road else "The road-routing service could not be reached, so times and distances are "
                                      "straight-line estimates. Roads may be longer.",
            "routes": out, "recommended_id": best["center"]["id"] if best else None,
            "selected_id": forced_id or (best["center"]["id"] if best else None),
            "considered": considered}


def init_app(app, get_centers):
    """Register /api/route. `get_centers()` returns the current centers with live status and hazards."""

    @app.get("/api/route")
    def api_route():
        try:
            lat, lon = float(request.args["lat"]), float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify(error="lat and lon are required numbers"), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify(error="lat or lon out of range"), 400
        mode = request.args.get("mode", "driving")
        if mode not in MODES:
            return jsonify(error="mode must be driving or walking"), 400
        need = tuple(f for f in request.args.get("need", "").split(",") if f.strip())
        result = plan((lat, lon), mode, get_centers(), request.args.get("to") or None, need)
        if result.get("error"):
            return jsonify(error=result["error"]), 404 if result["error"] == "unknown center" else 422
        return jsonify(result)
