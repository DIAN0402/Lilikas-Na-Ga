"""Shared test setup: no network, and nothing is written to data/stores/."""
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ai_client  # noqa: E402
import alerts  # noqa: E402
import app as app_module  # noqa: E402
import assist  # noqa: E402
import centers  # noqa: E402
import overview  # noqa: E402
import routing  # noqa: E402

POBLACION = (13.7565, 121.0583)


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    def no_network(url):
        raise urllib.error.URLError("offline in tests")
    monkeypatch.setattr(routing, "_http_json", no_network)
    monkeypatch.setattr(assist, "rain_last_3h", lambda lat, lon: 35.0)
    monkeypatch.setattr(assist, "place_name", lambda lat, lon: "Poblacion")
    monkeypatch.setattr(overview, "rainfall_week", lambda lat, lon: [{"date": "2026-07-20", "mm": 32.0, "kind": "observed"}])
    monkeypatch.setattr(assist, "REPORTS_PATH", tmp_path / "reports.json")
    monkeypatch.setattr(centers, "CENTERS_PATH", tmp_path / "centers.json")
    monkeypatch.setattr(alerts, "ALERTS_PATH", tmp_path / "alerts.json")
    monkeypatch.setenv("ASSIST_AI", "off")
    ai_client.CFG.reload()
    assist._cache.clear()
    assist._rate.clear()
    yield
    ai_client.CFG.reload()


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


@pytest.fixture
def admin():
    return {"X-Admin-Key": app_module.ADMIN_KEY}


@pytest.fixture
def fake_model(monkeypatch):
    """Turn the AI on with a fake provider. Set .reply to the JSON the 'model' should return."""
    class Fake:
        reply = {}
        calls = []

        def __call__(self, body):
            self.calls.append(body)
            return {"choices": [{"message": {"content": "<think>hmm</think> " + json.dumps(self.reply)}}]}
    fake = Fake()
    monkeypatch.setenv("ASSIST_AI", "on")
    monkeypatch.setenv("AI_API_KEY", "test-key")
    ai_client.CFG.reload()
    monkeypatch.setattr(ai_client, "_post", fake)
    monkeypatch.setattr(ai_client, "_down_until", 0.0)
    return fake
