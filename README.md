# Lilikas na ga? · Batangas City hazard map, alerts & evacuation

A location-based disaster preparedness, early-warning and evacuation assistance web app, built first for Batangas City.
Hazard map, evacuation-center capacity, best-route planner, earthquake/storm/rain alerts, a household preparedness
checklist and **Lilikas Assist**, an AI-assisted voice/text report panel.

The project is split into two independent parts:

```
Lilikas-Na-Ga/
├── backend/            Flask JSON API (Python) — no web pages
│   ├── app.py          entry point: CORS, health check, registers every module's routes
│   ├── settings.py     file locations + .env loader + allowed website origins
│   ├── ai_client.py    the AI model client (any OpenAI-compatible provider)
│   ├── assist.py       Lilikas Assist: guide picking, report drafting, explanations, citizen reports
│   ├── overview.py     the Overview risk snapshot (/api/overview)
│   ├── weather.py      rainfall outlook from Open-Meteo, free, no key (/api/weather)
│   ├── auth.py         optional accounts + saved preferences (stored in the database)
│   ├── db.py           the database: one SQLite file, tables created automatically
│   ├── hazard.py  batangas_risk.py  centers.py  routing.py  alerts.py  geo.py  build_layers.py
│   ├── data/           hazard maps (geo/), map layers (layers/), guides + starting centers (stores/), lilikas.db
│   ├── tests/          pytest suite (no network needed)
│   └── .env.example
└── frontend/           the website (plain HTML/CSS/JS, no build step)
    ├── index.html      public home        info.html        Overview/Map/Alerts/Preparedness info pages
    ├── login.html  signup.html
    ├── overview.html  map.html  alerts.html  preparedness.html
    ├── location.html  route.html  share.html  alert-preferences.html   consent / confirmation screens
    ├── methodology.html  admin.html (staff)
    ├── assets/css      theme.css (design tokens), app.css, pages.css, public.css
    ├── assets/js       config.js (API address), core.js, shell.js, assist.js, mapkit.js, pages/*.js
    ├── assets/img      logo + photos exported from Figma
    ├── assets/vendor   Leaflet 1.9.4 (bundled, so maps work without a CDN)
    └── sw.js           offline support for the website's own files
```

The UI follows the Figma file **“Lilikas na Ga?”** (Raleway + Lora, maroon/red/navy palette, dark sidebar app shell).

## Run it (two terminals)

**1. Backend API** — http://127.0.0.1:5000

```bash
cd backend
cp .env.example .env            # optional: add AI_API_KEY, BAGYO_API_KEY, ADMIN_KEY
pip install -r requirements.txt
python app.py                   # prints the admin key and whether the AI is on
```

**2. Frontend website** — http://localhost:5173

```bash
cd frontend
python -m http.server 5173      # any static server works (VS Code Live Server, npx serve, nginx…)
```

Open http://localhost:5173. The website calls the API at the address in `frontend/assets/js/config.js`
(`API_BASE`, default `http://127.0.0.1:5000`). If you serve the website from a different address, add it to
`CORS_ORIGINS` in `backend/.env`. You can also point one browser at another API with `?api=http://host:port`.

Staff page: http://localhost:5173/admin.html (use the admin key printed by the backend).

### Logo and photos
The logo and photos come from the Figma file. Put these files in `frontend/assets/img/`:
`lilikas-logo-horizontal.svg`, `lilikas-logo-stacked.svg`, `lilikas-hero-home.jpg`, `lilikas-hazard-flood.jpg`,
`lilikas-hazard-typhoon.jpg`, `lilikas-hazard-volcano.jpg`, `lilikas-auth-login.jpg`, `lilikas-auth-signup.jpg`.
Until they are there, a text logo badge and dark gradients are shown instead.

## Test it
```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q
```
Tests need no network, never write to `data/stores/`, and use a fresh temporary database (never `lilikas.db`).

## Lilikas Assist and the AI
`ai_client.py` talks to any OpenAI-compatible chat API. Set in `backend/.env`:

| Setting | Meaning |
|---|---|
| `AI_PROVIDER` | `nvidia` (default), `openai`, `groq`, `openrouter`, `anthropic`, `ollama` — picks the default address and model |
| `AI_API_KEY` | the provider's key (not needed for a local `ollama` / self-hosted server) |
| `AI_MODEL`, `AI_BASE_URL` | override the model or address |
| `ASSIST_AI=off` | rules only |

The old `NVIDIA_API_KEY` / `NIM_BASE_URL` / `NIM_MODEL` names still work.

What the AI may do, and the guard rails around it:
- **Order guides** from the fixed library in `data/stores/guides.json`. It never writes new steps. Unknown ids are dropped.
- **Fill in a report draft** from what the resident said (Filipino, English or Taglish). Every field is checked against fixed lists; emergency words are always caught by fixed rules.
- **Explain a risk level** in plain English or Filipino (`/api/assist/explain`). The text is rejected if it reads like an order or adds numbers that were not in the evidence.
- If the AI is off, has no key, or fails, simple rules do every job, so the app always works.

On the website, Assist also works with no signal: reports are kept in an on-device outbox and sent (once, thanks to a `client_id`) when the connection returns, and the guide library is cached for the “Do this now” cards.

## API
| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Backend, AI and alert-feed status |
| `GET /api/overview?lat&lon` | Risk level, rainfall (3 h + 7-day history/forecast), evacuation order, top alert, picked guides |
| `GET /api/weather?lat&lon` | Rain class now (No rain → Torrential), heaviest recent hour, next-24 h total, 7 days back + 7 ahead (Open-Meteo model data, not official PAGASA warnings) |
| `GET /api/assess?lat&lon[&hazards=flood,landslide,fault]` | Hazard levels at a point |
| `GET /api/locate?q=` | Place name or `"lat, lon"` to coordinates |
| `GET /api/centers` | Centers with live numbers and hazard suitability |
| `GET /api/route?lat&lon[&mode=walking\|driving][&to=<id>][&need=Water,Toilets]` | Best center and road route |
| `GET /api/feed` | All alerts (earthquake, storm, staff) plus feed status |
| `GET /api/assist/context?lat&lon`, `GET /api/assist/guides` | Situation and safety guides |
| `POST /api/assist/draft-report`, `POST /api/assist/report`, `POST /api/assist/explain` | Draft, submit, explain |
| `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/me/preferences` | Optional accounts (Bearer token) |
| `GET /layers/<name>.json` | Light map layers for the website |
| Admin (header `X-Admin-Key`): `POST /api/centers/<id>`, `POST /api/admin/centers`, `DELETE /api/centers/<id>`, `POST /api/sim`, `POST /api/admin/alerts`, `DELETE /api/admin/alerts/<id>`, `GET /api/admin/reports`, `POST /api/admin/reports/<id>`, `GET /api/admin/assist/status`, `GET /api/admin/check` | Staff actions |

## Database
Same tables, two ways to run them:

- **Neon (shared, online PostgreSQL)** — used when `DATABASE_URL` is set in `backend/.env`. Everyone on the team and
  the live site see the same accounts, reports, alerts and centers. Get the address from the Neon console:
  project **lilikas-na-ga** → **Connect** → copy the connection string, then add one line to `backend/.env`:
  `DATABASE_URL=postgresql://…` (it contains a password: **never** put it in GitHub, the README or `.env.example`;
  send it to teammates privately).
- **SQLite (local file)** — used when `DATABASE_URL` is not set: `backend/data/lilikas.db`, created automatically.
  Handy for working offline. Tests always use a fresh temporary SQLite file, never Neon or `lilikas.db`.

The backend's first line on start says which one it is using (`Database: Neon / PostgreSQL at …` or
`Database: SQLite file …`), and `/api/health` shows `"database": "postgresql"` or `"sqlite"`.

| Table | What it holds |
|---|---|
| `users` | Accounts: name, email or mobile number, password **hash** (never the password), saved preferences |
| `sessions` | Sign-ins (only a hash of each token is stored) |
| `reports` | Reports sent through Lilikas Assist |
| `alerts` | Earthquake alerts picked up and alerts posted by staff |
| `centers` | Evacuation centers with their latest numbers |

- **First run on an empty database:** the starting centers in `data/stores/evacuation_centers.json` are copied in.
  Old `data/stores/reports.json` / `alerts.json` files, if any, are imported once (the files stay as a backup).
- **Personal data:** names, numbers, locations and health details. `lilikas.db` is git-ignored; keep the Neon
  password private, and give the Neon project only to people who need it.
- **Look inside:** Neon console → **Tables**; for SQLite, Android Studio's Database tool window or DB Browser for SQLite.
- **Start over (SQLite):** stop the backend and delete `backend/data/lilikas.db` (plus `-wal` / `-shm` next to it).
- All SQL is in `db.py` and small store functions in `auth.py`, `assist.py`, `alerts.py` and `centers.py`.

## How things work
See `frontend/methodology.html` (also linked in the app footer) for the hazard tiers, the Overview risk rule, the
route scoring, the alert sources and the privacy notes.

## Not done yet / before real use
- **Database care.** Neon's free plan has limits (storage, compute hours). Before real use: backups, a plan to delete old reports, and separate Neon branches for testing vs. the live site.
- Google / Facebook / Mobile OTP sign-in and password reset need those services; the buttons say so.
- Guides in `guides.json` are draft advice. Have the CDRRMO review them and set `"verified": true`.
- Evacuation centers are **sample data** and capacity is simulated (`centers.py`).
- Reports contain location and health details: add a consent notice, limit who can read them, delete old ones.
- The admin key is one shared key for demos. Use real staff accounts and HTTPS for anything public.
- Hazard results, routes and alerts are planning aids, not official advisories.
