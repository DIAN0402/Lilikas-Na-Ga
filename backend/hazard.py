"""Hazard lookups: what flood / landslide / fault hazard is mapped at a point? (business logic + its two routes)"""
from flask import jsonify, request
from shapely.geometry import Point

import batangas_risk as br

BOUNDARY = br.load_boundary()


def assess(lat, lon, hazards=("flood", "landslide", "fault")):
    point = Point(lon, lat)
    return {
        "lat": lat, "lon": lon, "inside_city": bool(BOUNDARY.covers(point)),
        "results": [{"hazard": h, "name": r["name"], "level": r["level"], "lines": r["lines"]}
                    for h in hazards for r in [br.ASSESSORS[h](point, BOUNDARY)]],
    }


def suitability(a):
    levels = {r["hazard"]: r["level"] for r in a["results"]}
    if "High" in levels.values():
        return "Not recommended: high hazard mapped here"
    if {"Medium", "Moderate"} & set(levels.values()):
        return "Use with caution: moderate hazard mapped here"
    return "No high hazard mapped here"


def init_app(app):
    @app.get("/api/assess")
    def api_assess():
        try:
            lat, lon = float(request.args["lat"]), float(request.args["lon"])
        except (KeyError, ValueError):
            return jsonify(error="lat and lon are required numbers"), 400
        hz = [h for h in request.args.get("hazards", "flood,landslide,fault").split(",") if h in br.ASSESSORS]
        return jsonify(assess(lat, lon, hz or list(br.ASSESSORS)))

    @app.get("/api/locate")
    def api_locate():
        q = request.args.get("q", "").strip()
        if not q:
            return jsonify(error="q is required"), 400
        coords = br.parse_coordinates(q)
        if coords:
            return jsonify(lat=coords[0], lon=coords[1], label=f"{coords[0]:.5f}, {coords[1]:.5f}")
        try:
            found = br.geocode(q)
        except RuntimeError as exc:
            return jsonify(error=str(exc)), 502
        if not found:
            return jsonify(error="Place not found"), 404
        return jsonify(lat=found[0], lon=found[1], label=found[2])
