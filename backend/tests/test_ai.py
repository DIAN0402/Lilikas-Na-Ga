"""The AI path end to end over real HTTP, against a tiny fake OpenAI-style server (no internet needed)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import ai_client
import assist


class FakeProvider(BaseHTTPRequestHandler):
    replies = []
    seen = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeProvider.seen.append({"auth": self.headers.get("Authorization"), "body": body})
        status, content = FakeProvider.replies.pop(0) if FakeProvider.replies else (200, '{"ok": true}')
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"choices": [{"message": {"content": content}}]}).encode())

    def log_message(self, *a):
        pass


@pytest.fixture
def provider(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), FakeProvider)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    FakeProvider.replies, FakeProvider.seen = [], []
    monkeypatch.setenv("ASSIST_AI", "on")
    monkeypatch.setenv("AI_PROVIDER", "nvidia")
    monkeypatch.setenv("AI_API_KEY", "nvapi-test")
    monkeypatch.setenv("AI_BASE_URL", f"http://127.0.0.1:{srv.server_port}/v1")
    monkeypatch.delenv("AI_MODEL", raising=False)
    ai_client.CFG.reload()
    monkeypatch.setattr(ai_client, "_down_until", 0.0)
    yield FakeProvider
    srv.shutdown()


def test_default_model_is_a_plain_instruct_model(monkeypatch):
    for k in ("AI_MODEL", "NIM_MODEL", "AI_BASE_URL", "NIM_BASE_URL", "AI_REASONING_BUDGET", "NIM_REASONING_BUDGET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AI_PROVIDER", "nvidia")
    ai_client.CFG.reload()
    assert ai_client.CFG.model == "meta/llama-3.3-70b-instruct" and ai_client.CFG.reasoning == 0


def test_voice_report_is_translated_and_filled_in_one_call(client, provider):
    provider.replies.append((200, json.dumps({
        "language": "fil", "translation": "It's flooding, knee-deep on our street. There are four of us here.",
        "report_type": "flood", "water_level": "knee", "people_count": 4, "life_in_danger": False})))
    d = client.post("/api/assist/draft-report", json={"text": "Baha na po, hanggang tuhod sa kalye namin. Apat kami dito."}).get_json()
    assert d["engine"] == "model" and d["language"] == "fil" and d["translation_lang"] == "en"
    assert d["translation"].startswith("It's flooding") and d["water_level"] == "knee" and d["people_count"] == 4
    sent = provider.seen[0]
    assert sent["auth"] == "Bearer nvapi-test" and sent["body"]["model"] == "meta/llama-3.3-70b-instruct"
    assert "reasoning_budget" not in sent["body"]


def test_english_is_translated_to_filipino(client, provider):
    provider.replies.append((200, json.dumps({"language": "en", "translation": "May baha na hanggang tuhod."})))
    d = client.post("/api/assist/translate", json={"text": "There is knee-deep flooding."}).get_json()
    assert d == {**d, "language": "en", "target": "fil", "engine": "model", "translation": "May baha na hanggang tuhod."}


def test_translation_without_ai_says_so(client):
    d = client.post("/api/assist/translate", json={"text": "Baha na po dito"}).get_json()
    assert d["translation"] is None and d["engine"] == "rules" and "not connected" in d["note"]
    assert d["language"] == "fil"
    r = client.post("/api/assist/draft-report", json={"text": "Baha na po dito"}).get_json()
    assert r["translation"] is None and r["language"] == "fil" and r["report_type"] == "flood"


def test_bad_key_is_reported_clearly(client, provider):
    provider.replies.append((401, "{}"))
    d = client.get("/api/assist/ai?check=1").get_json()
    assert d["enabled"] and d["check"]["ok"] is False and "key was rejected" in d["check"]["error"]


def test_ai_check_ok(client, provider):
    d = client.get("/api/assist/ai?check=1").get_json()
    assert d["check"]["ok"] is True and d["model"] == "meta/llama-3.3-70b-instruct"


def test_ai_check_without_key(client):
    d = client.get("/api/assist/ai?check=1").get_json()
    assert d["enabled"] is False and "AI_API_KEY" in d["check"]["error"]


def test_report_keeps_translation(client, admin):
    body = {"report_type": "flood", "water_level": "knee", "lat": 13.7565, "lon": 121.0583,
            "quote": "Baha na po", "translation": "It's flooding"}
    assert client.post("/api/assist/report", json=body).status_code == 201
    assert client.get("/api/admin/reports", headers=admin).get_json()["reports"][0]["translation"] == "It's flooding"


def test_reasoning_model_answer_in_reasoning_content(monkeypatch):
    monkeypatch.setenv("ASSIST_AI", "on"); monkeypatch.setenv("AI_API_KEY", "k")
    ai_client.CFG.reload()
    monkeypatch.setattr(ai_client, "_down_until", 0.0)
    monkeypatch.setattr(ai_client, "_post", lambda body: {"choices": [{"message": {"content": None, "reasoning_content": 'ok {"ok": true}'}}]})
    assert ai_client.chat_json("s", "u") == {"ok": True}


def test_env_file_parsing(tmp_path, monkeypatch):
    import os
    import settings
    for k in ("T_EMPTY", "T_KEY", "T_QUOTED", "T_HASH"):
        monkeypatch.delenv(k, raising=False)
    f = tmp_path / ".env"
    f.write_text('T_EMPTY=        # a comment\nT_KEY=nvapi-abc123  # mine\nT_QUOTED="a # b"\nT_HASH=abc#def\n')
    settings.load_env_file(f)
    assert os.environ["T_EMPTY"] == "" and os.environ["T_KEY"] == "nvapi-abc123"
    assert os.environ["T_QUOTED"] == "a # b" and os.environ["T_HASH"] == "abc#def"
