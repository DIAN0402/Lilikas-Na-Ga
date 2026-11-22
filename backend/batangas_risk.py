"""Hazard model for Batangas City: what flood / landslide / active-fault hazard is mapped at a point?

Each assessor takes a shapely Point (x=lon, y=lat) and the city boundary and returns
    {"name": str, "level": str, "lines": [str, ...]}

Notes on the data
-----------------
* The flood and landslide layers store the hazard class only as 1/2/3. The Low/Medium(Moderate)/High labels
  are assumed from the usual ascending order. Edit FLOOD_LABELS / LANDSLIDE_LABELS if the source says otherwise.
* The active-fault data was traced from the picture tiles of a KMZ (not vector lines), so distances are only
  accurate to about +/-50 m. FAULT_TIERS is a simple planning heuristic, not an official classification.
* Results are a planning reference, not a substitute for a site-specific geohazard assessment by
  PHIVOLCS, MGB or a licensed geologist/engineer.
"""
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache

from shapely import STRtree, points as shp_points
from shapely.geometry import Point, shape
from shapely.ops import unary_union

from settings import BOUNDARY_PATH, FLOOD_PATH, LANDSLIDE_PATH, FAULT_PATH

FLOOD_LABELS = {1: "Low", 2: "Medium", 3: "High"}
LANDSLIDE_LABELS = {1: "Low", 2: "Moderate", 3: "High"}

# (upper distance limit in km, tier name, advice). Checked in order.
FAULT_TIERS = [
    (1.0, "High",
     "Very close to a mapped active fault. Ground rupture and strong shaking are the main concern. "
     "Get a site-specific geohazard assessment before building, and follow PHIVOLCS guidance on keeping "
     "a no-build buffer along fault traces."),
    (5.0, "Moderate",
     "Within a few kilometres of a mapped active fault. Expect strong shaking in a large earthquake. "
     "Use earthquake-resistant design (National Structural Code of the Philippines)."),
    (15.0, "Low",
     "Some distance from the nearest mapped fault. Ground rupture is unlikely, but shaking from a large "
     "earthquake can still be felt strongly."),
    (float("inf"), "Very low",
     "Far from the mapped faults. Direct fault hazard is minimal, though earthquake shaking can still "
     "affect the area."),
]
FAULT_COVERAGE_KM = 30   # fault traces are only stored within this distance of the city boundary

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "BatangasCityRiskAssessment/1.0"

# Local flat-earth projection around Batangas City (error well under 1% here, far smaller than the fault map's
# own resolution). Also used by alerts.py to measure epicenter distances.
LAT0, LON0 = 13.69, 121.10
KM_PER_DEG_LAT = 110.57
KM_PER_DEG_LON = 111.32 * math.cos(math.radians(LAT0))


# ----------------------------------------------------------------------
# Data loading (each file is read once and kept in memory)
# ----------------------------------------------------------------------
@lru_cache(maxsize=None)
def load_boundary():
    data = json.loads(BOUNDARY_PATH.read_text("utf-8"))
    return unary_union([shape(f["geometry"]) for f in data["features"]])


@lru_cache(maxsize=None)
def load_zones(path, field):
    """List of (class_number, geometry) from a hazard file. `path` must be hashable (a Path)."""
    data = json.loads(path.read_text("utf-8"))
    return [(int(f["properties"][field]), shape(f["geometry"]))
            for f in data["features"] if f["properties"].get(field) is not None]


@lru_cache(maxsize=None)
def load_faults():
    """(search tree over all fault points in km, number of points inside the city, the points in km)."""
    data = json.loads(FAULT_PATH.read_text("utf-8"))
    groups = {f["properties"]["kind"]: f["geometry"]["coordinates"] for f in data["features"]}
    inside, nearby = groups.get("inside_city", []), groups.get("nearby_30km", [])
    xy = [to_km(lon, lat) for lon, lat in inside + nearby]
    if not xy:
        raise RuntimeError("No fault data found in the data file.")
    return STRtree(shp_points(xy)), len(inside), xy


# ----------------------------------------------------------------------
# Text input
# ----------------------------------------------------------------------
_NUMBER = r"[-+]?\d+(?:\.\d+)?"


def parse_coordinates(text):
    """Read '13.7565, 121.0583', '13.7565 121.0583' or '13.7565N 121.0583E'. Returns (lat, lon) or None
    when the text is not a coordinate pair (so it can be treated as a place name). Swapped values are fixed."""
    cleaned = text.strip().replace("\u00b0", " ")
    m = re.fullmatch(rf"\s*({_NUMBER})\s*([NSns])?\s*[,;\s]\s*({_NUMBER})\s*([EWew])?\s*", cleaned)
    if not m:
        return None
    first, ns, second, ew = m.groups()
    lat, lon = float(first), float(second)
    if ns and ns.lower() == "s":
        lat = -abs(lat)
    if ew and ew.lower() == "w":
        lon = -abs(lon)
    if abs(lat) > 90 and abs(lon) <= 90:   # entered as lon, lat
        lat, lon = lon, lat
    if abs(lat) > 90 or abs(lon) > 180:
        return None
    return lat, lon


def geocode(query, timeout=10):
    """Place name -> (lat, lon, display name) via OpenStreetMap Nominatim. None if not found."""
    biased = query if "batangas" in query.lower() else f"{query}, Batangas City, Batangas, Philippines"
    params = {"q": biased, "format": "json", "limit": 1, "countrycodes": "ph"}
    req = urllib.request.Request(f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            results = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Could not reach the geocoding service ({exc}).") from exc
    if not results:
        return None
    top = results[0]
    return float(top["lat"]), float(top["lon"]), top.get("display_name", biased)


# ----------------------------------------------------------------------
# Hazard assessments
# ----------------------------------------------------------------------
def _assess_zone(name, path, field, labels, point):
    matched = [lvl for lvl, geom in load_zones(path, field) if geom.covers(point)]
    level = labels.get(max(matched), f"Unknown ({max(matched)})") if matched else "No mapped hazard"
    text = level if matched else "No mapped hazard (outside mapped hazard zones)"
    return {"name": name, "level": level, "lines": [f"{name} risk: {text}"]}


def assess_flood(point, boundary):
    return _assess_zone("Flood", FLOOD_PATH, "Var", FLOOD_LABELS, point)


def assess_landslide(point, boundary):
    return _assess_zone("Landslide", LANDSLIDE_PATH, "LH", LANDSLIDE_LABELS, point)


def to_km(lon, lat):
    return (lon - LON0) * KM_PER_DEG_LON, (lat - LAT0) * KM_PER_DEG_LAT


def compass(dx, dy):
    names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    angle = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    return names[int((angle + 22.5) // 45) % 8]


def assess_fault(point, boundary):
    # The fault data only reaches FAULT_COVERAGE_KM from the city (1 degree is about 111 km).
    if boundary.distance(point) * 111.0 > FAULT_COVERAGE_KM:
        return {"name": "Active fault", "level": "Not assessed", "lines": [
            "Active fault risk: Not assessed",
            f"  This point is more than {FAULT_COVERAGE_KM:.0f} km from Batangas City, "
            "beyond the area covered by the fault data."]}

    tree, n_inside, xy = load_faults()
    px, py = to_km(point.x, point.y)
    idx = int(tree.nearest(Point(px, py)))
    fx, fy = xy[idx]
    dist_km = math.hypot(fx - px, fy - py)
    tier, advice = next((t, a) for limit, t, a in FAULT_TIERS if dist_km <= limit)
    dist_txt = f"{dist_km * 1000:.0f} m" if dist_km < 1 else f"{dist_km:.1f} km"
    where = "inside Batangas City" if idx < n_inside else "outside the city boundary"
    return {"name": "Active fault", "level": tier, "lines": [
        f"Active fault risk: {tier}",
        f"  Nearest mapped active fault: {dist_txt} to the {compass(fx - px, fy - py)} ({where})",
        f"  {advice}",
        "  (Distance accurate to about +/-50 m; the tier is a proximity heuristic, not an official classification.)"]}


ASSESSORS = {"flood": assess_flood, "landslide": assess_landslide, "fault": assess_fault}
