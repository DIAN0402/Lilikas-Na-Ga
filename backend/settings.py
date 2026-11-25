"""The ONE place that knows where backend files live and how the backend is configured.

    backend/            Flask JSON API, business rules, outside-service clients (this folder)
    backend/data/       hazard maps, reference JSON and the database file (lilikas.db)
    frontend/           the website (separate folder, talks to this API over HTTP)

Application code must take file locations from here, never build its own paths.
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # backend/

DATA_DIR = ROOT / "data"
GEO_DIR = DATA_DIR / "geo"          # full-detail hazard maps (read-only source data)
LAYERS_DIR = DATA_DIR / "layers"    # light map layers built by build_layers.py
STORES_DIR = DATA_DIR / "stores"    # reference JSON (guides, starting centers) and old JSON stores to import
DB_PATH = DATA_DIR / "lilikas.db"   # the database (see db.py); DB_PATH in .env moves it

BOUNDARY_PATH = GEO_DIR / "batangas_city_boundary.geojson"
FLOOD_PATH = GEO_DIR / "batangas_city_flood_hazard.geojson"
LANDSLIDE_PATH = GEO_DIR / "batangas_city_landslide_hazard.geojson"
FAULT_PATH = GEO_DIR / "batangas_active_faults.geojson"

CENTERS_PATH = STORES_DIR / "evacuation_centers.json"   # starting list, copied into the database on first run
GUIDES_PATH = STORES_DIR / "guides.json"
ALERTS_PATH = STORES_DIR / "alerts.json"      # old store: imported into the database once, if present
REPORTS_PATH = STORES_DIR / "reports.json"    # old store: imported into the database once, if present


def load_env_file(path=ROOT / ".env"):
    """Read KEY=value lines from backend/.env. Real environment variables win over the file."""
    try:
        lines = path.read_text("utf-8-sig").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value[:1] in ("'", '"') and value[1:].find(value[0]) >= 0:     # quoted: keep everything inside the quotes
            value = value[1:1 + value[1:].find(value[0])]
        else:                                                          # unquoted: drop an inline " # comment"
            value = "" if value.startswith("#") else re.split(r"\s+#", value, maxsplit=1)[0].strip()
        os.environ.setdefault(key.strip(), value)


def cors_origins():
    """Which website origins may call this API from a browser. Comma-separated in CORS_ORIGINS; '*' allows any."""
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
