#!/bin/bash
# Lilikas na ga? — start the backend API (port 5000) and the website (port 5173) together.
# Double-click this file in Finder, or run ./start.command. Press Ctrl+C in this window to stop both.
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then echo "Python 3 is not installed. Get it from https://www.python.org/downloads/"; read -r; exit 1; fi

# Backend: its own virtual environment, so nothing is installed system-wide
if [ ! -x backend/.venv/bin/python ]; then
  echo "First run: setting up the backend (one time)…"
  "$PY" -m venv backend/.venv || { echo "Could not create a virtual environment."; read -r; exit 1; }
fi
backend/.venv/bin/python -m pip install -q --disable-pip-version-check -r backend/requirements.txt || { echo "Could not install backend packages."; read -r; exit 1; }

# AI key: asked once and saved in backend/.env (that file is git-ignored, so the key never gets committed)
[ -f backend/.env ] || cp backend/.env.example backend/.env
if ! grep -Eq '^(AI_API_KEY|NVIDIA_API_KEY)=[^#[:space:]]{8,}' backend/.env; then
  echo
  echo "Lilikas Assist needs an AI key for translation and smart reports."
  echo "Get a free NVIDIA key at https://build.nvidia.com (it starts with nvapi-)."
  read -r -t 20 -p "Paste your key here (or press Enter to skip; skips by itself in 20 s): " KEY || { KEY=""; echo; echo "Skipped for now."; }
  if [ -n "$KEY" ]; then
    KEY="$KEY" backend/.venv/bin/python - <<'PY'
import os, re, pathlib
p = pathlib.Path("backend/.env"); s = p.read_text() if p.exists() else ""
line = "AI_API_KEY=" + os.environ["KEY"].strip()
s = re.sub(r"(?m)^AI_API_KEY=.*$", line, s) if re.search(r"(?m)^AI_API_KEY=", s) else s.rstrip() + "\n" + line + "\n"
p.write_text(s)
PY
    echo "Saved to backend/.env"
  fi
fi

# Logo, photos and screenshots exported from Figma: the newest ~/Downloads/lilikas-assets*.zip is unpacked into
# frontend/assets/img (files there are replaced). Single files named lilikas-*.jpg/svg in Downloads are copied too.
ZIP="$(ls -t "$HOME"/Downloads/lilikas-assets*.zip 2>/dev/null | head -1)"
if [ -n "$ZIP" ] && [ "$ZIP" -nt frontend/assets/img/.assets-stamp ]; then
  unzip -o -j -q "$ZIP" 'lilikas-assets/*' -d frontend/assets/img && touch frontend/assets/img/.assets-stamp \
    && echo "Unpacked $(basename "$ZIP") into frontend/assets/img"
fi
for f in "$HOME"/Downloads/lilikas-logo-*.svg "$HOME"/Downloads/lilikas-hazard-*.jpg "$HOME"/Downloads/lilikas-auth-*.jpg; do
  [ -f "$f" ] && [ ! -f "frontend/assets/img/$(basename "$f")" ] && cp "$f" frontend/assets/img/
done

# Free the ports if an earlier run is still holding them
for port in 5000 5173; do lsof -ti tcp:$port 2>/dev/null | xargs kill 2>/dev/null; done

(cd backend && exec .venv/bin/python app.py) &
BACK=$!
(cd frontend && exec "$PY" -m http.server 5173 --bind 127.0.0.1) >/dev/null 2>&1 &
FRONT=$!
trap 'echo; echo "Stopping…"; kill $BACK $FRONT 2>/dev/null; exit 0' INT TERM

# Wait until the backend answers (loading the hazard maps and connecting to the database takes a few seconds)
echo
printf "Starting the backend"
READY=""
for i in $(seq 1 60); do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:5000/api/health"; then READY=1; break; fi
  if ! kill -0 $BACK 2>/dev/null; then break; fi            # the backend stopped: its error is printed above
  printf "."; sleep 1
done
echo
if [ -z "$READY" ]; then
  echo "  The backend did not start. Look at the error above, fix it, then double-click start.command again."
  echo "  (Press Enter to close.)"; read -r; kill $BACK $FRONT 2>/dev/null; exit 1
fi
echo "Testing the AI…"
curl -s -m 40 "http://127.0.0.1:5000/api/assist/ai?check=1" | backend/.venv/bin/python -c "import json,sys
try:
    d=json.load(sys.stdin); c=d.get('check') or {}
    if not d.get('enabled'):
        print('  AI: OFF - no key yet. Add AI_API_KEY to backend/.env, then restart. Simple rules are used meanwhile.')
    elif c.get('ok'):
        print('  AI: WORKING (%s, %s ms)' % (d.get('model'), c.get('ms')))
    else:
        print('  AI: NOT WORKING - %s' % (c.get('error') or d.get('last_error') or 'no answer from the AI service'))
except Exception:
    print('  AI: could not check (the backend did not answer the AI test)')"
echo "  Website:  http://localhost:5173"
echo "  API:      http://127.0.0.1:5000/api/health"
echo "  Staff:    http://localhost:5173/admin.html   (admin key is printed above)"
echo "  Press Ctrl+C to stop."
open "http://localhost:5173"
wait
