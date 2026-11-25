"""Weather module (/api/weather): rain classes, the rain + flood risk table, and the report built from Open-Meteo data.
No network: Open-Meteo is replaced by a fixed sample response."""
import pytest

import weather
from conftest import POBLACION


def sample(now="2026-07-20T14:00", recent=(0.0, 4.0, 9.0), next_hours=1.0):
    """Open-Meteo-shaped JSON: 7 past days + 7 forecast days, hourly rain, current hour = `now`."""
    days = [f"2026-07-{d:02d}" for d in range(13, 27)]
    times = [f"{d}T{h:02d}:00" for d in days for h in range(24)]
    mm = [0.0] * len(times)
    i = times.index(now)
    mm[i - 2:i + 1] = list(recent)
    for j in range(i + 1, i + 25):
        mm[j] = next_hours
    return {"utc_offset_seconds": 28800, "current": {"time": now, "precipitation": recent[-1], "temperature_2m": 28.0},
            "hourly": {"time": times, "precipitation": mm},
            "daily": {"time": days, "precipitation_sum": [float(n) for n in range(14)], "weather_code": [61] * 14}}


@pytest.mark.parametrize("mm,key", [(0.0, "none"), (1.0, "light"), (5.0, "moderate"), (10.0, "heavy"),
                                    (20.0, "intense"), (40.0, "torrential")])
def test_rain_classes(mm, key):
    assert weather.classify(mm)[0] == key


def test_risk_table():
    assert weather.assess_risk("High", "heavy") == "high"
    assert weather.assess_risk("Medium", "torrential") == "high"
    assert weather.assess_risk("Medium", "moderate") == "moderate"
    assert weather.assess_risk("No mapped hazard", "intense") == "moderate"
    assert weather.assess_risk("High", "none") == "low"


def test_report_from_open_meteo():
    r = weather.build_report(sample(), "High", False)
    assert r["rain"]["class"] == "heavy" and r["rain"]["peak_hour_mm"] == 9.0      # heaviest of the last 3 hours
    assert r["rain"]["last_3h_mm"] == 13.0 and r["rain"]["next_24h_mm"] == 24.0
    assert r["risk"]["level"] == "high" and r["evac_order"] is False
    kinds = [d["kind"] for d in r["daily"]]
    assert kinds.count("past") == 7 and kinds.count("today") == 1 and kinds.count("forecast") == 6
    assert r["source"]["name"] == "Open-Meteo"


def test_route_checks_coordinates(client):
    assert client.get("/api/weather").status_code == 400
    assert client.get("/api/weather?lat=95&lon=121").status_code == 400


def test_route_with_weather(client, monkeypatch):
    monkeypatch.setattr(weather, "fetch_forecast", lambda lat, lon: sample())
    d = client.get(f"/api/weather?lat={POBLACION[0]}&lon={POBLACION[1]}").get_json()
    assert d["rain"]["label"] == "Heavy rain" and len(d["daily"]) == 14
    assert d["risk"]["level"] in ("high", "moderate", "low")


def test_route_when_weather_service_is_down(client):
    r = client.get(f"/api/weather?lat={POBLACION[0]}&lon={POBLACION[1]}")
    assert r.status_code == 502 and "weather service" in r.get_json()["error"]
