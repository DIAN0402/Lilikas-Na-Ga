"""The AI model client used by Lilikas Assist. Kept separate from assist.py so the business rules there never
depend on which provider is used.

Any provider with an OpenAI-style  POST /chat/completions  API works: NVIDIA NIM (default), OpenAI, Groq,
OpenRouter, Anthropic's OpenAI-compatible endpoint, or a local Ollama / self-hosted NIM.

Settings (environment variables / backend/.env):
    AI_PROVIDER          nvidia | openai | groq | openrouter | anthropic | ollama   (default nvidia)
                         Only picks the default AI_BASE_URL / AI_MODEL; either can still be set directly.
    AI_BASE_URL          e.g. https://integrate.api.nvidia.com/v1   (old name NIM_BASE_URL still works)
    AI_API_KEY           the provider's key                          (old name NVIDIA_API_KEY still works)
    AI_MODEL             model name, default meta/llama-3.3-70b-instruct on NVIDIA   (old name NIM_MODEL still works)
    AI_REASONING_BUDGET  NVIDIA reasoning models only, default 1024  (old name NIM_REASONING_BUDGET)
    AI_TIMEOUT           seconds, default 30
    ASSIST_AI            set to "off" to use the rules only

The model only ever returns JSON that the caller checks against fixed lists. If the model is off, has no key,
or fails, callers fall back to plain rules, so the app always works without it.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

PHT = timezone(timedelta(hours=8))
USER_AGENT = "LilikasNaGa/2.0 (Lilikas Assist)"

PROVIDERS = {   # name: (default base URL, default model)
    "nvidia": ("https://integrate.api.nvidia.com/v1", "meta/llama-3.3-70b-instruct"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.1-8b-instant"),
    "openrouter": ("https://openrouter.ai/api/v1", "meta-llama/llama-3.1-8b-instruct"),
    "anthropic": ("https://api.anthropic.com/v1", "claude-haiku-4-5"),
    "ollama": ("http://localhost:11434/v1", "llama3.1"),
}
HOSTED = tuple(base for name, (base, _) in PROVIDERS.items() if name != "ollama")


def _env(*names, default=""):
    for n in names:
        v = os.environ.get(n, "").strip()
        if v:
            return v
    return default


class Config:
    """Read once at import; reload() re-reads (used by tests)."""

    def __init__(self):
        self.reload()

    def reload(self):
        self.provider = _env("AI_PROVIDER", default="nvidia").lower()
        base, model = PROVIDERS.get(self.provider, PROVIDERS["nvidia"])
        self.base = _env("AI_BASE_URL", "NIM_BASE_URL", default=base).rstrip("/")
        self.key = _env("AI_API_KEY", "NVIDIA_API_KEY")
        self.model = _env("AI_MODEL", "NIM_MODEL", default=model)
        # only NVIDIA "reasoning" models understand reasoning_budget; everything else gets 0 (not sent)
        self.reasoning = int(_env("AI_REASONING_BUDGET", "NIM_REASONING_BUDGET",
                                  default="1024" if "reasoning" in self.model else "0"))
        self.timeout = float(_env("AI_TIMEOUT", "NIM_TIMEOUT", default="30"))
        self.switch = _env("ASSIST_AI", default="on").lower()
        return self


CFG = Config()
STATUS = {"last_ok": None, "last_error": None, "calls": 0, "failures": 0}
_LOCK = threading.Lock()
_down_until = 0.0


class ModelError(Exception):
    pass


def enabled():
    """True when a model can be called: not switched off, and a key is set (a local/self-hosted server needs none)."""
    if CFG.switch == "off":
        return False
    return bool(CFG.key) or not CFG.base.startswith(HOSTED)


def describe():
    """Safe summary for the admin page and /api/health (never includes the key)."""
    return {"enabled": enabled(), "provider": CFG.provider, "base_url": CFG.base, "model": CFG.model,
            "key_set": bool(CFG.key), **STATUS}


def extract_json(text):
    """First JSON object in the model's reply (it may add thinking text around it). None if there isn't one."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    if "</think>" in text:
        text = text.split("</think>")[-1]
    dec = json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            obj, _ = dec.raw_decode(text[m.start():])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            continue
    return None


def _post(body):
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT}
    if CFG.key:
        headers["Authorization"] = f"Bearer {CFG.key}"
    req = urllib.request.Request(f"{CFG.base}/chat/completions", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=CFG.timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fail(msg, cooldown=True):
    global _down_until
    with _LOCK:
        STATUS["last_error"] = msg
        STATUS["failures"] += 1
        if cooldown:
            _down_until = time.time() + 60


def chat_json(system, user, max_tokens=600):
    """Ask the model and return its JSON answer as a dict. Raises ModelError on any problem."""
    if not enabled():
        raise ModelError("AI is switched off or has no key")
    if time.time() < _down_until:
        raise ModelError("AI recently failed; using rules for a minute")
    body = {"model": CFG.model, "stream": False, "temperature": 0.2, "top_p": 0.95,
            "max_tokens": max_tokens + max(CFG.reasoning, 0),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if CFG.reasoning > 0:
        body["reasoning_budget"] = CFG.reasoning
    with _LOCK:
        STATUS["calls"] += 1
    try:
        try:
            data = _post(body)
        except urllib.error.HTTPError as exc:
            if exc.code == 400 and "reasoning_budget" in body:      # this server does not know that setting
                body.pop("reasoning_budget")
                data = _post(body)
            else:
                raise
        msg = data["choices"][0]["message"]
        # some reasoning models put the answer only in reasoning_content when content is empty
        obj = extract_json(msg.get("content") or "") or extract_json(msg.get("reasoning_content") or "")
        if obj is None:
            _fail("the model did not return JSON", cooldown=False)
            raise ModelError("the model did not return JSON")
        with _LOCK:
            STATUS.update(last_ok=datetime.now(PHT).isoformat(), last_error=None)
        return obj
    except ModelError:
        raise
    except urllib.error.HTTPError as exc:
        msg = {401: "the AI key was rejected", 403: "the AI key is not allowed to use this model",
               404: "the AI model or address was not found", 429: "AI rate limit reached"}.get(exc.code, f"HTTP {exc.code}")
        _fail(msg)
        raise ModelError(msg) from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        _fail(f"could not reach the model: {exc}")
        raise ModelError(str(exc)) from exc


def check():
    """Make one tiny real call so staff and the website can see whether the AI actually answers.
    Returns {"ok": bool, "error": str|None, "ms": int}."""
    if not enabled():
        return {"ok": False, "error": "No AI key set. Put AI_API_KEY in backend/.env and restart the backend.", "ms": 0}
    global _down_until
    _down_until = 0.0                              # a manual check always tries again
    t = time.time()
    try:
        out = chat_json('Reply with ONLY this JSON: {"ok": true}', "ping", max_tokens=20)
        return {"ok": out.get("ok") is True, "error": None if out.get("ok") is True else "unexpected answer", "ms": int((time.time() - t) * 1000)}
    except ModelError as exc:
        return {"ok": False, "error": STATUS.get("last_error") or str(exc), "ms": int((time.time() - t) * 1000)}
