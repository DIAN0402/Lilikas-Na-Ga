# Lilikas Na Ga: Batangas City Hazard Map & Evacuation

Lilikas Na Ga is a location-based disaster preparedness, early-warning, and evacuation assistance web application designed initially for Batangas City.

Hazard map, evacuation-center capacity, best-route planner, earthquake/storm alerts and an AI-assisted
citizen report panel.

## Run it
```bash
cp .env.example .env                  # then add BAGYO_API_KEY / NVIDIA_API_KEY (both optional)
pip install -r application/requirements.txt
python application/app.py             # http://127.0.0.1:5000  (admin page: /admin, key printed in the terminal)
```
Set `ADMIN_KEY` in `.env` to choose your own admin key; otherwise a random one is printed at every start.

## Test it
```bash
pip install -r application/requirements.txt -r application/requirements-dev.txt
cd application
python app.py
```
Tests need no network and never write to `data/stores/`.

## Rebuild the light map layers (after changing `data/geo/*`)
```bash
cd application
python build_layers.py
```

## Backend modules (`application/`)
| Module | Responsibility |
|---|---|
| `app.py` | Wiring: loads `.env`, serves the pages, registers each module's routes |
| `settings.py` | The only place that knows file locations; `.env` loader |
| `geo.py` | Shared haversine distance |
| `batangas_risk.py` | Hazard model: flood / landslide zones, nearest active fault, coordinate parsing, geocoding |
| `hazard.py` | `assess()` / `suitability()` and the `/api/assess`, `/api/locate` routes |
| `centers.py` | Evacuation centers: live capacity (simulated), admin edit/add/remove, persistence |
| `routing.py` | Best-center scoring and road routes (OSRM) |
| `alerts.py` | PHIVOLCS earthquakes, Bagyo storms, staff-posted alerts, merged feed |
| `assist.py` | Lilikas Assist: guide picking, report drafting, citizen reports |
| `build_layers.py` | Offline script that builds `data/layers/` |

## API
| Endpoint | Purpose |
|---|---|
| `GET /api/assess?lat&lon[&hazards=flood,landslide,fault]` | Hazard levels at a point |
| `GET /api/locate?q=` | Place name or `"lat, lon"` to coordinates |
| `GET /api/centers` | Centers with live numbers and hazard suitability |
| `GET /api/route?lat&lon[&mode=walking\|driving][&to=<id>][&need=Water,Toilets]` | Best center and road route |
| `GET /api/feed` | All alerts (earthquake, storm, staff) plus feed status |
| `GET /api/assist/context?lat&lon`, `GET /api/assist/guides` | Situation and safety guides |
| `POST /api/assist/draft-report`, `POST /api/assist/report` | Draft and submit a citizen report |
| `GET/POST /api/sim` | Capacity simulator mode (`calm`, `storm`, `paused`); POST needs the admin key |
| Admin (header `X-Admin-Key`): `POST /api/centers/<id>`, `POST /api/admin/centers`, `DELETE /api/centers/<id>`, `POST /api/admin/alerts`, `DELETE /api/admin/alerts/<id>`, `GET /api/admin/reports`, `POST /api/admin/reports/<id>`, `GET /api/admin/assist/status`, `GET /api/admin/check` | Staff actions |

## How things work
- **Hazards:** flood and landslide classes come from the mapped zones at the point. Fault tier is the distance to the
  nearest mapped active fault (High under 1 km, Moderate under 5 km, Low under 15 km, otherwise Very low). The fault
  lines were traced from map images (about +/-50 m) and the tiers are a planning heuristic, not an official classification.
- **Capacity is simulated.** `centers.py` changes each open center's `occupied` number every few seconds so the live
  page can be demonstrated. Tick **Manual** on the admin page, or send real counts to `POST /api/centers/<id>`, to
  stop the simulator for a center. Starting data in `data/stores/evacuation_centers.json` is **sample data**.
- **Best route:** each open center is scored in minutes (lower is better): travel time + a penalty above 60% full
  (up to 12 min) + 12 min per HIGH and 4 min per MEDIUM hazard at the center + up to 25 min each for the share of the
  road crossing HIGH flood / landslide zones. Closed, unavailable and full centers are never recommended. Road
  geometry comes from the public OSRM walking server (`OSRM_WALKING_URL` to change); Drive reuses the walking route
  with a time estimated at `DRIVE_KMH` (default 30). If OSRM is unreachable the planner falls back to straight-line
  estimates and says so.
- **Alerts:** earthquakes from the phivocs-api service (`PHIVOLCS_API_URL`), storms from Bagyo (`BAGYO_API_KEY`).
  Each is checked every 5 minutes. A quake is shown if it is within 30 km at M3.0+, 75 km at M4.0+, 150 km at M5.0+,
  300 km at M6.0+ of the city boundary, names Batangas at M2.5+, or is M4.0+ anywhere in the Philippines. A storm is
  shown if it is in or forecast to enter the Philippine Area of Responsibility, has a PAGASA name, or is (forecast to
  be) within 1,000 km; it is HIGH when forecast within 300 km. These are planning rules, not official warnings.
  If a feed is down or unconfigured the page shows a notice instead of failing silently.
- **Lilikas Assist:** the AI (NVIDIA NIM) only *orders* guides from `data/stores/guides.json` and *fills in* a report
  draft; it never writes advice. Emergency words are caught by fixed rules. Without `NVIDIA_API_KEY` (or with
  `ASSIST_AI=off`) simple rules do the same job. Guides are marked `"verified": false` until the Batangas City
  disaster office reviews them.

## Before real use
- Guides in `guides.json` are draft advice. Have the CDRRMO review them and set `"verified": true`.
- Reports contain location and health details. Add a consent notice, limit who can read them, delete old ones
  (`data/stores/reports.json` is git-ignored).
- The admin key is a single shared key for demos. Use real staff accounts and HTTPS for anything public.
- Reports are limited to 6 per 10 minutes per IP address. Add stronger abuse protection before a public launch.
- Hazard results, routes and alerts are planning aids, not official advisories.
=======

