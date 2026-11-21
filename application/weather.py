"""Rainfall and the combined rain + flood risk shown on the dashboard.

Weather comes from Open-Meteo (https://open-meteo.com/en/docs), a free, no-key forecast API. It is model data
(past days are archived model output, not rain-gauge readings), so the UI should say "model data".
Open-Meteo asks for attribution and is free for non-commercial use only; see https://open-meteo.com/en/licence.

Settings (environment variables / .env):
    OPEN_METEO_URL   forecast endpoint (default https://api.open-meteo.com/v1/forecast)

The rain classes and the risk table below are simple planning rules for this project, NOT official PAGASA warnings.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

OPEN_METEO_URL = os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
USER_AGENT = "BatangasHazardApp/1.0"
CACHE_SECONDS = 600          # weather changes slowly; also keeps us far below the free API's limits
PAST_DAYS, FORECAST_DAYS = 7, 7

# Hourly rainfall classes in mm per hour (modelled on PAGASA's rainfall intensity terms): (upper limit, key, label)
RAIN_CLASSES = [
    (0.1, "none", "No rain"),
    (2.5, "light", "Light rain"),
    (7.5, "moderate", "Moderate rain"),
    (15.0, "heavy", "Heavy rain"),
    (30.0, "intense", "Intense rain"),
    (float("inf"), "torrential", "Torrential rain"),
]
HEAVY_UP = {"heavy", "intense", "torrential"}
RISK_HEADLINES = {"high": "High risk · Prepare", "moderate": "Moderate risk · Stay alert",
                  "low": "Low risk · Stay informed"}

_cache = {}                   # (lat, lon rounded to 2 decimals) -> (time fetched, Open-Meteo JSON)
_lock = threading.Lock()


# ----------------------------------------------------------------------
# Open-Meteo
# ----------------------------------------------------------------------
def fetch_forecast(lat, lon):
    """Raw Open-Meteo JSON: hourly + daily precipitation for the past 7 and next 7 days. Cached for 10 minutes."""
    key = (round(lat, 2), round(lon, 2))
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
    # `precipitation` = rain + showers + snow. Tropical rain is mostly convective "showers", which the plain
    # `rain` variable leaves out, so `precipitation` is the right one for a rainfall total here.
    query = urllib.parse.urlencode({
        "latitude": key[0], "longitude": key[1], "timezone": "auto",
        "hourly": "precipitation", "daily": "precipitation_sum,weather_code",
        "past_days": PAST_DAYS, "forecast_days": FORECAST_DAYS, "current": "precipitation,temperature_2m"})
    req = urllib.request.Request(f"{OPEN_METEO_URL}?{query}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        raise RuntimeError(f"Could not reach the weather service ({exc}).") from exc
    if not isinstance(data, dict) or data.get("error"):
        raise RuntimeError(f"The weather service refused the request: {data.get('reason', 'unknown reason')}")
    with _lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[key] = (time.time(), data)
    return data


# ----------------------------------------------------------------------
# Rules
# ----------------------------------------------------------------------
def classify(mm_per_hour):
    """(key, label) of the rainfall class for an hourly amount in mm."""
    _, key, label = next(c for c in RAIN_CLASSES if mm_per_hour < c[0])
    return key, label


def assess_risk(flood_level, rain_class):
    """'high' / 'moderate' / 'low' from the mapped flood hazard (hazard.py) and the current rain class."""
    if (flood_level == "High" and rain_class in HEAVY_UP) or (flood_level == "Medium" and rain_class in {"intense", "torrential"}):
        return "high"
    if (flood_level in ("High", "Medium") and rain_class in {"moderate", "heavy"}) or rain_class in HEAVY_UP:
        return "moderate"
    return "low"


def _summary(level, flood_level, rain_label):
    flood = "no mapped flood hazard" if flood_level == "No mapped hazard" else f"{flood_level.lower()} flood hazard"
    return {
        "high": f"This area has {flood} and rainfall is {rain_label.lower()}. Get ready and monitor official advice.",
        "moderate": f"This area has {flood} and conditions are {rain_label.lower()}. Stay alert to changing conditions.",
        "low": f"No significant rain-related risk right now. This area has {flood}.",
    }[level]


def build_report(data, flood_level, evac_order):
    """Turn Open-Meteo JSON plus the flood level into the dashboard payload."""
    tz = timezone(timedelta(seconds=data.get("utc_offset_seconds", 0)))

    def parse(t):
        return datetime.fromisoformat(t).replace(tzinfo=tz)

    now = parse(data["current"]["time"])
    times = [parse(t) for t in data["hourly"]["time"]]
    mm = [v or 0.0 for v in data["hourly"]["precipitation"]]      # null (not yet forecast) counts as 0
    last = max((i for i, t in enumerate(times) if t <= now), default=0)
    window = mm[max(0, last - 2): last + 1]                       # each value is the rain of the hour before it
    peak = max(window, default=0.0)
    rain_key, rain_label = classify(peak)                         # class of the heaviest recent hour: errs on the safe side

    today = now.date()
    daily = []
    for d, total in zip(data["daily"]["time"], data["daily"]["precipitation_sum"]):
        day = datetime.fromisoformat(d).date()
        daily.append({"date": d, "mm": round(total or 0.0, 1),
                      "kind": "past" if day < today else "today" if day == today else "forecast"})

    level = assess_risk(flood_level, rain_key)
    flood_label = "No mapped flood hazard" if flood_level == "No mapped hazard" else f"{flood_level} susceptibility"
    return {
        "as_of": now.isoformat(),
        "rain": {"last_3h_mm": round(sum(window), 1), "peak_hour_mm": round(peak, 1), "class": rain_key,
                 "label": rain_label, "next_24h_mm": round(sum(mm[last + 1: last + 25]), 1)},
        "daily": daily,
        "risk": {"level": level, "headline": RISK_HEADLINES[level],
                 "summary": _summary(level, flood_level, rain_label),
                 "reasons": [{"factor": "flood", "label": flood_label}, {"factor": "rain", "label": rain_label}],
                 "note": "Planning aid combining mapped flood hazard and rainfall. It is not an official advisory "
                         "and does not issue evacuation orders."},
        "evac_order": evac_order,
        "source": {"name": "Open-Meteo", "url": "https://open-meteo.com/",
                   "note": "Model data, not rain-gauge readings."},
    }


# ----------------------------------------------------------------------
# Route
# ----------------------------------------------------------------------
def init_app(app, assess_fn, feed_fn):
    """assess_fn = hazard.assess, feed_fn = alerts.current_feed (passed in so this module stays independent)."""

    @app.get("/api/weather")
    def api_weather():
        try:
            lat, lon = float(request.args["lat"]), float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify(error="lat and lon are required numbers"), 400
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify(error="lat or lon is out of range"), 400
        try:
            data = fetch_forecast(lat, lon)
            flood = assess_fn(lat, lon, ["flood"])["results"][0]["level"]
            evac = any(a.get("evac_order") and not a.get("expired") for a in feed_fn())
            return jsonify(lat=lat, lon=lon, **build_report(data, flood, evac))
        except RuntimeError as exc:
            return jsonify(error=str(exc)), 502
        except (KeyError, ValueError, TypeError):
            return jsonify(error="The weather service returned data in an unexpected format."), 502
