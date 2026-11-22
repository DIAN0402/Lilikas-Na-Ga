import auth


def setup_function():
    auth.USERS.clear()
    auth.SESSIONS.clear()
    auth._attempts.clear()


def test_signup_login_me_preferences_logout(client):
    r = client.post("/api/auth/signup", json={"name": "Juan Dela Cruz", "contact": "0917 123 4567",
                                              "password": "secret123", "agree": True, "barangay": "Brgy. Poblacion"})
    assert r.status_code == 201
    j = r.get_json()
    assert j["user"]["first_name"] == "Juan" and j["user"]["initials"] == "JD"
    assert j["user"]["contact"] == "09171234567" and "password" not in j["user"]
    assert client.post("/api/auth/signup", json={"name": "Juan", "contact": "09171234567", "password": "secret123",
                                                 "agree": True}).status_code == 409
    bad = client.post("/api/auth/login", json={"contact": "09171234567", "password": "nope"})
    assert bad.status_code == 401
    tok = client.post("/api/auth/login", json={"contact": "+639171234567", "password": "secret123"}).get_json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/auth/me", headers=h).get_json()["user"]["name"] == "Juan Dela Cruz"
    p = client.put("/api/me/preferences", headers=h, json={"alert_topics": ["rain_flood", "bogus"],
                                                            "checklist": ["water_food", "medicine"]}).get_json()
    assert p["user"]["preferences"]["alert_topics"] == ["rain_flood"]
    client.post("/api/auth/logout", headers=h)
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_password_is_hashed():
    stored = auth.hash_password("secret123")
    assert "secret123" not in stored and auth.check_password("secret123", stored)
    assert not auth.check_password("wrong", stored)


def test_signup_validation(client):
    assert client.post("/api/auth/signup", json={"name": "J", "contact": "x", "password": "1"}).status_code == 400
    assert client.post("/api/auth/signup", json={"name": "Juan Cruz", "contact": "juan@email.com",
                                                 "password": "secret123"}).status_code == 400   # did not agree


def test_login_rate_limit(client):
    for _ in range(8):
        client.post("/api/auth/login", json={"contact": "juan@email.com", "password": "x"})
    assert client.post("/api/auth/login", json={"contact": "juan@email.com", "password": "x"}).status_code == 429
