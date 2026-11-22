import ai_client
import assist
from conftest import POBLACION


def test_rules_read_filipino_report():
    d = assist.draft_report("Baha na po, hanggang tuhod sa kalye namin. Apat kami dito.")
    assert d["report_type"] == "flood" and d["water_level"] == "knee" and d["people_count"] == 4
    assert d["engine"] == "rules" and d["life_in_danger"] is False


def test_emergency_words_always_caught_even_if_model_says_no(fake_model):
    fake_model.reply = {"report_type": "flood", "water_level": "chest", "people_count": 2, "life_in_danger": False}
    d = assist.draft_report("Tulungan nyo kami, may nalulunod dito!")
    assert d["life_in_danger"] is True and d["engine"] == "model" and d["water_level"] == "chest"


def test_model_answers_are_checked_against_fixed_lists(fake_model):
    fake_model.reply = {"report_type": "tsunami", "water_level": "roof", "people_count": 9999, "life_in_danger": "yes"}
    d = assist.draft_report("baha hanggang tuhod")
    assert d["report_type"] == "flood" and d["water_level"] == "knee" and d["people_count"] is None
    assert d["life_in_danger"] is False


def test_model_can_only_pick_known_guides(client, fake_model):
    fake_model.reply = {"guide_ids": ["made-up", "flood-power", "flood-go-bag"]}
    d = client.get(f"/api/assist/context?lat={POBLACION[0]}&lon={POBLACION[1]}").get_json()
    ids = [g["id"] for g in d["guides"]]
    assert "made-up" not in ids
    assert d["engine"] == "model"
    # the model's order is kept for ids that fit this place; ids that don't fit are dropped
    assert ids == [i for i in fake_model.reply["guide_ids"] if i in ids]


def test_model_failure_falls_back_to_rules(client, monkeypatch, fake_model):
    def boom(body):
        raise OSError("down")
    monkeypatch.setattr(ai_client, "_post", boom)
    d = client.get(f"/api/assist/context?lat={POBLACION[0]}&lon={POBLACION[1]}").get_json()
    assert d["engine"] == "rules" and d["guides"]
    assert ai_client.STATUS["last_error"]


def test_provider_presets(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("ASSIST_AI", "on")
    ai_client.CFG.reload()
    assert ai_client.CFG.base == "https://api.openai.com/v1" and ai_client.CFG.reasoning == 0
    assert ai_client.enabled() is False                      # hosted provider without a key
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    ai_client.CFG.reload()
    assert ai_client.enabled() is True                       # local server needs no key


def test_old_nim_variable_names_still_work(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "abc")
    monkeypatch.setenv("NIM_MODEL", "some/model")
    monkeypatch.setenv("ASSIST_AI", "on")
    ai_client.CFG.reload()
    assert ai_client.CFG.key == "abc" and ai_client.CFG.model == "some/model" and ai_client.enabled()


def test_explain_rejects_orders_and_invented_numbers(client, fake_model):
    facts = ["High flood susceptibility", "35 mm of rain in the last 3 hours"]
    fake_model.reply = {"text": "You must evacuate now to the gym."}
    d = client.post("/api/assist/explain", json={"level": "High risk", "facts": facts}).get_json()
    assert d["engine"] == "rules" and "not an official evacuation order" in d["text"]
    assist._cache.clear()
    fake_model.reply = {"text": "Your area is mapped as flood prone and 90 mm fell."}
    assert client.post("/api/assist/explain", json={"level": "High risk", "facts": facts}).get_json()["engine"] == "rules"
    assist._cache.clear()
    fake_model.reply = {"text": "Your area is mapped as flood prone, and 35 mm of rain fell in the last 3 hours."}
    d = client.post("/api/assist/explain", json={"level": "High risk", "facts": facts, "lang": "en"}).get_json()
    assert d["engine"] == "model" and "35 mm" in d["text"]


def test_explain_filipino_rules():
    text, engine = assist.explain("Mataas", ["Mataas na panganib ng baha"], "fil")
    assert engine == "rules" and "Hindi ito opisyal" in text


def test_report_flow_is_idempotent_and_returns_guides(client, admin):
    body = {"report_type": "flood", "water_level": "knee", "people_count": 4, "lat": POBLACION[0],
            "lon": POBLACION[1], "barangay": "Poblacion", "quote": "Baha na po", "client_id": "abc123"}
    r1 = client.post("/api/assist/report", json=body)
    assert r1.status_code == 201
    j = r1.get_json()
    assert j["guides"] and j["chips"][0].startswith("Flood")
    r2 = client.post("/api/assist/report", json=body)            # the same offline report sent again
    assert r2.status_code == 200 and r2.get_json()["duplicate"] and r2.get_json()["id"] == j["id"]
    reports = client.get("/api/admin/reports", headers=admin).get_json()["reports"]
    assert len(reports) == 1


def test_report_validation(client):
    assert client.post("/api/assist/report", json={"report_type": "x"}).status_code == 400
    assert client.post("/api/assist/report", json={"report_type": "flood", "lat": 40, "lon": 10}).status_code == 400
