from conftest import POBLACION


def test_health_and_root(client):
    assert client.get("/").status_code == 200
    h = client.get("/api/health").get_json()
    assert h["ok"] is True and h["ai"]["enabled"] is False and "key" not in h["ai"]


def test_backend_serves_no_pages(client):
    for path in ("/admin", "/alerts", "/index.html"):
        r = client.get(path)
        assert r.status_code == 404 and "error" in r.get_json()


def test_cors_allows_frontend_origin_only(client):
    ok = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert ok.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    bad = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in bad.headers
    pre = client.open("/api/assist/report", method="OPTIONS", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 200 and "Authorization" in pre.headers["Access-Control-Allow-Headers"]


def test_layers_served(client):
    r = client.get("/layers/boundary.json")
    assert r.status_code == 200 and r.get_json()["type"] in ("Feature", "FeatureCollection")


def test_assess_and_centers(client):
    a = client.get(f"/api/assess?lat={POBLACION[0]}&lon={POBLACION[1]}").get_json()
    assert {r["hazard"] for r in a["results"]} == {"flood", "landslide", "fault"}
    assert client.get("/api/assess?lat=x").status_code == 400
    cs = client.get("/api/centers").get_json()
    assert cs and {"id", "name", "capacity", "occupied", "suitability"} <= set(cs[0])


def test_route_falls_back_to_estimate_offline(client):
    r = client.get(f"/api/route?lat={POBLACION[0]}&lon={POBLACION[1]}&mode=walking").get_json()
    assert r["source"] == "estimate" and r["routes"] and r["recommended_id"]


def test_overview_shape(client):
    d = client.get(f"/api/overview?lat={POBLACION[0]}&lon={POBLACION[1]}").get_json()
    assert d["location"]["barangay"] == "Poblacion"
    assert d["risk"]["level"] in ("high", "moderate", "low") and d["risk"]["title"]
    assert d["rain"]["last_3h_mm"] == 35.0 and d["rain"]["heavy"] is True
    assert d["evacuation_order"]["active"] is False
    assert 1 <= len(d["assist"]["guides"]) <= 3
    assert client.get("/api/overview").status_code == 400


def test_admin_routes_need_key(client, admin):
    assert client.get("/api/admin/reports").status_code == 401
    assert client.get("/api/admin/reports", headers=admin).status_code == 200
    assert client.post("/api/sim", json={"mode": "storm"}).status_code == 401
    s = client.get("/api/admin/assist/status", headers=admin).get_json()
    assert s["provider"] == "nvidia" and "key" not in s
