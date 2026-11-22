"""Overview: one risk snapshot for a place (the "Magandang araw, Juan!" screen).

The level combines what is MAPPED at the place (flood / landslide susceptibility) with what is HAPPENING now
(rain in the last 3 hours, active advisories, a storm forecast to pass near). It is a planning aid, never an order.
Weather comes from Open-Meteo (free, no key).
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

import assist

PHT = timezone(timedelta(hours=8))

LEVELS = {
    "high": {"label": "High risk", "action": "Prepare",
             "text": "{why} mean you should get ready and monitor official advice."},
    "moderate": {"label": "Moderate risk", "action": "Stay alert",
                 "text": "{why} mean you should check your plan and watch for changes."},
    "low": {"label": "Low risk", "action": "Stay informed",
            "text": "No high hazard or heavy rain is detected right now. Keep your household plan up to date."},
}


def rainfall_week(lat, lon):
    """Daily rain (mm) for the last 7 days and the next 7 days. None if the weather service can't be reached."""
    def fetch():
        url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
            "latitude": f"{lat:.3f}", "longitude": f"{lon:.3f}", "daily": "precipitation_sum",
            "past_days": 7, "forecast_days": 7, "timezone": "Asia/Manila"})
        try:
            req = urllib.request.Request(url, headers={"User-Agent": assist.USER_AGENT})
            with urllib.request.urlopen(req, timeout=8) as resp:
                return parse_week(json.loads(resp.read().decode("utf-8")), datetime.now(PHT).date())
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError):
            return None
    return assist._cached(("week", round(lat, 2), round(lon, 2)), 1800, fetch)


def parse_week(body, today):
    days = []
    for d, mm in zip(body["daily"]["time"], body["daily"]["precipitation_sum"]):
        day = datetime.fromisoformat(d).date()
        days.append({"date": d, "mm": None if mm is None else round(float(mm), 1),
                     "kind": "forecast" if day > today else "observed"})
    return days


def score(sit, hazards):
    """('high' | 'moderate' | 'low', list of short factor labels) from the situation Assist already builds."""
    tags = sit["tags"]
    flood, slide = hazards.get("flood"), hazards.get("landslide")
    mapped_high = flood == "High" or slide == "High"
    mapped_mid = flood == "Medium" or slide in ("Moderate", "Medium")
    weather_now = bool({"rain_heavy", "rain_advisory", "storm_near"} & tags)
    factors = []
    if flood in ("High", "Medium"):
        factors.append(f"{flood} flood susceptibility")
    if slide in ("High", "Moderate"):
        factors.append(f"{slide} landslide susceptibility")
    if "rain_heavy" in tags:
        factors.append("Heavy rainfall")
    elif sit.get("rain_mm"):
        factors.append(f"{sit['rain_mm']:g} mm rain")
    if "rain_advisory" in tags:
        factors.append("Rainfall advisory")
    if "storm_near" in tags:
        factors.append("Storm nearby")
    if "quake_recent" in tags:
        factors.append("Recent earthquake")
    if (mapped_high and weather_now) or (mapped_mid and "storm_near" in tags and "rain_heavy" in tags):
        level = "high"
    elif mapped_high or weather_now or "quake_recent" in tags:
        level = "moderate"
    else:
        level = "low"
    return level, factors


def build(lat, lon, assess_fn, feed_fn, centers_fn):
    week_job = assist._POOL.submit(rainfall_week, lat, lon)          # runs while the situation is built
    sit = assist.build_situation(lat, lon, assess_fn, feed_fn, centers_fn)
    try:
        hazards = {r["hazard"]: r["level"] for r in assess_fn(lat, lon, ("flood", "landslide"))["results"]}
    except Exception:
        hazards = {}
    level, factors = score(sit, hazards)
    meta = LEVELS[level]
    why = " and ".join(f.lower() if i else f for i, f in enumerate(factors[:2])) or "Current conditions"
    try:
        feed = [a for a in feed_fn() if not a.get("expired")]
    except Exception:
        feed = []
    order = next((a for a in feed if a.get("evac_order")), None)
    top_alert = next((a for a in feed if a.get("near", True)), None)
    engine, guides, _, _ = assist.pick_guides(sit)
    return {
        "location": {"lat": lat, "lon": lon, "barangay": sit["barangay"],
                     "label": f"Brgy. {sit['barangay']}, Batangas City" if sit["barangay"] else "Batangas City"},
        "risk": {"level": level, "label": meta["label"], "action": meta["action"],
                 "title": f"{meta['label']} · {meta['action']}", "text": meta["text"].format(why=why),
                 "factors": factors, "susceptibility": hazards.get("flood") or "Not assessed",
                 "hazards": hazards},
        "rain": {"last_3h_mm": sit["rain_mm"], "heavy": "rain_heavy" in sit["tags"],
                 "heavy_mm": assist.RAIN_HEAVY_MM, "week": week_job.result()},
        "evacuation_order": {"active": bool(order), "title": order["title"] if order else None,
                             "source": order["source"] if order else None},
        "alert": top_alert and {k: top_alert.get(k) for k in ("id", "title", "level", "level_label", "source", "category")},
        "center": sit["center"],
        "evidence": sit["evidence"], "chips": sit["chips"],
        "assist": {"engine": engine, "guides": guides},
        "generated": datetime.now(PHT).isoformat(),
    }


def init_app(app, assess_fn, feed_fn, centers_fn):
    @app.get("/api/overview")
    def api_overview():
        try:
            lat, lon = float(request.args["lat"]), float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify(error="lat and lon are required numbers"), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify(error="lat or lon out of range"), 400
        return jsonify(build(lat, lon, assess_fn, feed_fn, centers_fn))
