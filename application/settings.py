"""The ONE place that knows where each tier lives on disk.

    presentation/   Tier 1  pages and browser code (HTML/JS/CSS)
    application/    Tier 2  Flask API, business rules, outside-service clients
    data/           Tier 3  hazard maps and the JSON files the app reads and writes

Application code must take file locations from here, never build its own paths.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Tier 1
STATIC_DIR = ROOT / "presentation" / "static"

# Tier 3
DATA_DIR = ROOT / "data"
GEO_DIR = DATA_DIR / "geo"          # full-detail hazard maps (read-only source data)
LAYERS_DIR = DATA_DIR / "layers"    # light map layers built by build_layers.py
STORES_DIR = DATA_DIR / "stores"    # JSON the app reads and writes while running

BOUNDARY_PATH = GEO_DIR / "batangas_city_boundary.geojson"
FLOOD_PATH = GEO_DIR / "batangas_city_flood_hazard.geojson"
LANDSLIDE_PATH = GEO_DIR / "batangas_city_landslide_hazard.geojson"
FAULT_PATH = GEO_DIR / "batangas_active_faults.geojson"

CENTERS_PATH = STORES_DIR / "evacuation_centers.json"
GUIDES_PATH = STORES_DIR / "guides.json"
ALERTS_PATH = STORES_DIR / "alerts.json"
REPORTS_PATH = STORES_DIR / "reports.json"


def load_env_file(path=ROOT / ".env"):
    """Read KEY=value lines from .env at the repo root. Real environment variables win over the file."""
    try:
        lines = path.read_text("utf-8-sig").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
