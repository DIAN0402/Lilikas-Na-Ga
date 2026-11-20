"""Makes the light map layers (data/layers/*.json) from the full hazard data in data/geo/.

Run from application/ after changing anything in data/geo/:   python build_layers.py
"""
import json

import shapely
from shapely.geometry import MultiPolygon, mapping, shape

from settings import GEO_DIR, LAYERS_DIR


def read(path):
    return json.loads(path.read_text("utf-8"))


def write(path, data):
    path.write_text(json.dumps(data, separators=(",", ":")), "utf-8")


def poly_layer(src, field, out, tol=0.0003, min_area=2e-7):
    """Simplified hazard polygons keeping only the class number (as "c")."""
    feats = []
    for f in read(src)["features"]:
        g = shape(f["geometry"]).simplify(tol, preserve_topology=True)
        polys = [p for p in shapely.get_parts(g) if p.geom_type == "Polygon" and p.area >= min_area]
        g = shapely.set_precision(MultiPolygon(polys), 1e-5)
        feats.append({"type": "Feature", "properties": {"c": int(f["properties"][field])}, "geometry": mapping(g)})
    write(out, {"type": "FeatureCollection", "features": feats})


def main():
    poly_layer(GEO_DIR / "batangas_city_flood_hazard.geojson", "Var", LAYERS_DIR / "flood.json")
    poly_layer(GEO_DIR / "batangas_city_landslide_hazard.geojson", "LH", LAYERS_DIR / "landslide.json")
    boundary = shape(read(GEO_DIR / "batangas_city_boundary.geojson")["features"][0]["geometry"])
    boundary = shapely.set_precision(boundary.simplify(0.0003), 1e-5)
    write(LAYERS_DIR / "boundary.json", {"type": "Feature", "properties": {}, "geometry": mapping(boundary)})
    write(LAYERS_DIR / "faults.json", read(GEO_DIR / "batangas_active_faults.geojson"))


if __name__ == "__main__":
    main()
