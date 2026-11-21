# Lilikas Na Ga

A disaster-preparedness and evacuation helper for Batangas City. It shows a layered hazard map,
evacuation centers with live capacity, the best route to a center, rainfall risk, earthquake and
storm alerts, and an AI-assisted help panel.

> Hazard results, routes and alerts are planning aids, **not official advisories**. Follow PAGASA,
> PHIVOLCS and local officials.

## Run it

```bash
pip install -r application/requirements.txt
python application/app.py        # http://127.0.0.1:5000
```

The admin key is printed at startup. To set your own, create a `.env` file in the repo root:

```ini
ADMIN_KEY=choose-a-long-random-value
```

## Pages

| Page | What it does |
|---|---|
| `/hazard map & evacuation` | Full interactive hazard map, evacuation centers, route planner |
| `/overview` | Risk snapshot, rainfall outlook, and a small static hazard map |
| `/alerts` | Earthquake, storm and staff alerts |
| `/admin` | Staff tools: center capacity, alerts, reports |

## Project structure

```
presentation/static/   Tier 1  pages (HTML/JS/CSS)
application/           Tier 2  Flask API and business logic
data/                  Tier 3  hazard maps (geo/), light layers (layers/), app data (stores/)
```

| Module | Responsibility |
|---|---|
| `app.py` | Wires settings and registers every module's routes |
| `settings.py` | The only place that knows file locations; loads `.env` |
| `hazard.py` | Hazard levels at a point (`/api/assess`, `/api/locate`) |
| `centers.py` | Evacuation centers, simulated capacity, admin edits |
| `routing.py` | Best-center scoring and road routes |
| `weather.py` | Rainfall and combined rain + flood risk (`/api/weather`) |
| `alerts.py` | Earthquake, storm and staff alerts |
| `assist.py` | Lilikas Assist: guides, report drafting |
| `build_layers.py` | Rebuilds the light map layers in `data/layers/` |

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/assess?lat&lon` | Hazard levels at a point |
| `GET /api/locate?q=` | Place name or `"lat, lon"` to coordinates |
| `GET /api/centers` | Centers with live numbers and hazard suitability |
| `GET /api/route?lat&lon[&mode=walking\|driving][&to=<id>]` | Best center and road route |
| `GET /api/weather?lat&lon` | Rain and combined risk level |
| `GET /api/feed` | All alerts plus feed status |
| `GET/POST /api/sim` | Capacity simulator (`calm`, `storm`, `paused`) |

Staff routes need the `X-Admin-Key` header; see `application/*.py` for the full list.

## Rebuild the map layers

Run this after changing anything in `data/geo/`:

```bash
cd application && python build_layers.py
```

## Notes

- Center capacities are **simulated** and the starting records are **sample data**. Tick *Manual* in
  `/admin` to freeze a center's numbers.
- Optional settings: `BAGYO_API_KEY` (storm feed), `PHIVOLCS_API_URL`, `OSRM_WALKING_URL`,
  `DRIVE_KMH`, `SIM_INTERVAL`.
- Weather data comes from [Open-Meteo.com](https://open-meteo.com/) (model data, not rain gauges).
- Reports contain location and health details; add a consent notice before public use.
