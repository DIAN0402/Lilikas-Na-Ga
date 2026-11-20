/* Lilikas Assist: slide-in panel (guides picked for your situation + report by voice or text).
   Add to a page with:  <script src="/assist.js" defer></script>
   and any element with  data-assist-open  (for example a sidebar link) to open it.
   A page that knows the person's location can call  LilikasAssist.setLocation(lat, lon). */
(() => {
"use strict";
const DEFAULT = [13.7565, 121.0583];                       // Batangas City centre
const K = {loc: "lilikas.loc", contacts: "lilikas.contacts", wake: "lilikas.wake", lang: "lilikas.lang"};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: just don't remember */ } }
};
const esc = t => String(t ?? "").replace(/[&<>"']/g, m => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[m]));
const $ = s => root.querySelector(s);

const TYPE_LABEL = {flood: "Flood", landslide: "Landslide", earthquake: "Earthquake", fire: "Fire", other: "Other"};
const LEVEL_LABEL = {ankle: "Ankle deep", knee: "Knee deep", thigh: "Thigh deep", waist: "Waist deep", chest: "Chest deep", over_head: "Over head", unknown: "Not sure"};
const EVIDENCE_ICON = {flood: "🌊", landslide: "⛰️", rain: "🌧️", advisory: "🔔", storm: "🌀", quake: "📳", dark: "🌙"};

const S = {
  open: false, view: "home", loc: store.get(K.loc, null), ctx: null, ctxState: "idle",
  wake: false, lang: store.get(K.lang, "fil-PH"), contacts: store.get(K.contacts, []),
  interim: "", draft: null, left: 5, paused: false, editing: null, err: null, sent: null,
  allGuides: null, guideTopic: null, openCard: null, voiceMsg: null
};
if (!S.loc) S.loc = {lat: DEFAULT[0], lon: DEFAULT[1], explicit: false};

// ---------------------------------------------------------------- styles
const css = `
.la-panel{--ink:#f3dcdc;--mute:#c9a4a4;--red:#d62b2b;--navy:#0f2747;position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:5000;color:var(--ink);
 background:radial-gradient(120% 60% at 50% 38%,#5a1414 0,#2a0b0b 45%,#140505 100%);box-shadow:-12px 0 40px #0008;transform:translateX(105%);transition:transform .25s ease;
 display:flex;flex-direction:column;font-family:inherit;font-size:13px}
.la-panel.on{transform:none}.la-panel *{box-sizing:border-box}
.la-scroll{overflow:auto;padding:18px 18px 28px;flex:1}
.la-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.la-title{font-size:16px;font-weight:800;display:flex;gap:8px;align-items:center}.la-title i{color:#ff6b5e;font-style:normal}
.la-x{width:34px;height:34px;border-radius:50%;border:1px solid #ffffff33;background:#ffffff0d;color:#fff;font-size:18px;cursor:pointer}
.la-card{border:1px solid #ffffff1f;background:#ffffff0d;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.la-wake{display:flex;align-items:center;gap:10px}.la-wake b{display:block;font-size:12.5px}.la-wake small{color:var(--mute);font-size:11px}.la-wake .tx{flex:1}
.la-dot{width:9px;height:9px;border-radius:50%;background:#777;flex:none}.la-dot.on{background:#ff4d4d;box-shadow:0 0 0 4px #ff4d4d33;animation:la-p 1.6s infinite}
@keyframes la-p{50%{box-shadow:0 0 0 7px #ff4d4d11}}
.la-sw{position:relative;width:44px;height:26px;flex:none}.la-sw input{opacity:0;position:absolute;inset:0;cursor:pointer;z-index:1;margin:0}.la-sw i{position:absolute;inset:0;border-radius:99px;background:#ffffff2b;transition:.2s}
.la-sw i::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s}.la-sw input:checked+i{background:var(--red)}.la-sw input:checked+i::after{left:21px}
.la-sw input:disabled+i{opacity:.4}.la-sw input:focus-visible+i{outline:2px solid #fff}
.la-voice{display:flex;align-items:center;gap:14px;padding:14px;background:linear-gradient(135deg,#5b1515,#3a0e0e);border-color:#ff5a5a44}
.la-mic{width:50px;height:50px;border-radius:50%;border:0;background:var(--red);color:#fff;cursor:pointer;display:grid;place-items:center;flex:none;box-shadow:0 0 0 6px #d62b2b33}
.la-mic:disabled{opacity:.45;cursor:not-allowed}.la-mic:focus-visible{outline:3px solid #fff}.la-mic.live{animation:la-p 1.2s infinite}
.la-voice b{font-size:14px;display:block}.la-voice small{color:var(--mute);font-size:11.5px;line-height:1.4;display:block;margin-top:2px}
.la-type{display:flex;gap:6px;margin:-2px 0 6px}.la-type input{flex:1;min-width:0;border-radius:10px;border:1px solid #ffffff2b;background:#00000040;color:#fff;padding:9px 11px;font:inherit}
.la-type input::placeholder{color:#c9a4a4aa}.la-btn{border:1px solid #ffffff33;background:#ffffff14;color:#fff;border-radius:10px;padding:9px 13px;font:inherit;font-weight:700;cursor:pointer}
.la-btn.red{background:var(--red);border-color:var(--red)}.la-btn.white{background:#fff;color:var(--red);border-color:#fff}.la-btn:disabled{opacity:.5;cursor:default}
.la-fine{font-size:10.5px;color:var(--mute);line-height:1.45;margin:6px 2px}.la-fine select{background:#00000040;color:#fff;border:1px solid #ffffff2b;border-radius:6px;padding:2px 4px;font:inherit}
.la-msg{background:#ffd9d955;border:1px solid #ff8a8a66;color:#ffe0e0;border-radius:10px;padding:8px 10px;margin:6px 0;font-size:12px;line-height:1.4}
.la-hr{border:0;border-top:1px solid #ffffff1a;margin:16px 0}
.la-tag{display:inline-block;font-size:10.5px;font-weight:700;color:#ffb1a8;background:#d62b2b33;border:1px solid #ff5a5a55;border-radius:99px;padding:3px 10px}
.la-h2{font-size:24px;font-weight:800;margin:10px 0 8px;color:#fff}
.la-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}.la-chip{border:1px solid #ffffff2b;background:#ffffff10;border-radius:99px;padding:5px 11px;font-size:11.5px;color:#fff}
.la-loc{font-size:11.5px;color:var(--mute);margin:0 0 4px}.la-link{background:none;border:0;color:#ff8f84;font:inherit;font-weight:700;cursor:pointer;padding:0;text-decoration:underline}
.la-guide{display:flex;gap:11px;width:100%;text-align:left;background:#fff;color:var(--navy);border:0;border-radius:11px;padding:12px;margin-bottom:9px;cursor:pointer;font:inherit}
.la-guide .n{width:22px;height:22px;border-radius:50%;background:var(--red);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;flex:none;margin-top:1px}
.la-guide b{display:block;font-size:13.5px;line-height:1.35}.la-guide .lab{display:block;font-size:11px;font-weight:700;margin-top:5px;color:#1b7a4b}.la-guide .lab.draft{color:#9a6200}
.la-guide ul{margin:8px 0 0;padding-left:16px;font-size:12px;font-weight:500;color:#3d475a;line-height:1.5}
.la-why{border:1px solid #ffffff1f;background:#ffffff0a;border-radius:12px;padding:10px 12px;margin:12px 0}.la-why summary{cursor:pointer;font-weight:700;font-size:12.5px}
.la-why li{list-style:none;display:flex;gap:9px;align-items:center;margin:8px 0;font-size:12px}.la-why ul{padding:0;margin:8px 0 0}.la-why p{color:var(--mute);font-size:11px;line-height:1.5;margin:8px 0 0}
.la-skel{color:var(--mute);padding:18px 0}
.la-ring{position:relative;width:74px;height:74px;flex:none}.la-ring svg{transform:rotate(-90deg)}.la-ring .num{position:absolute;inset:0;display:grid;place-items:center;font-size:30px;font-weight:800;color:#fff}
.la-send{display:flex;gap:16px;align-items:center;border:1px solid #ff5a5a55;background:linear-gradient(135deg,#5b1515,#2e0b0b);border-radius:16px;padding:16px;margin-bottom:12px}
.la-send b{font-size:16px;display:block;margin-bottom:4px}.la-send small{color:var(--mute);font-size:12px;line-height:1.45}
.la-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.la-btns .la-btn{padding:12px;font-size:14px}
.la-sec{font-size:12px;color:var(--mute);margin:14px 0 8px}
.la-rows{background:#fff;color:var(--navy);border-radius:12px;padding:2px 14px}.la-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:11px 0;border-top:1px solid #eee}.la-row:first-child{border-top:0}
.la-row small{display:block;font-size:10.5px;color:#7a8396}.la-row b{font-size:13.5px}.la-row b.miss{color:#9a6200}.la-row .ed{background:none;border:0;color:var(--red);font:inherit;font-weight:700;cursor:pointer;font-size:12px}
.la-row select,.la-row input{width:100%;margin-top:4px;border:1px solid #d9dde6;border-radius:8px;padding:7px 8px;font:inherit;color:var(--navy)}
.la-quote{font-family:Georgia,serif;font-style:italic;color:var(--mute);font-size:12px;margin:12px 2px;line-height:1.5}
.la-911{display:block;text-align:left;border:1px solid #ffffff2b;background:#00000040;color:#fff;border-radius:12px;padding:12px 14px;font-weight:700;text-decoration:none;margin-top:10px}
.la-911.big{background:var(--red);border-color:var(--red);font-size:15px;text-align:center;padding:14px}
.la-listen{text-align:center;padding:26px 10px}.la-listen .la-mic{margin:0 auto 14px;width:70px;height:70px}.la-listen p{font-family:Georgia,serif;font-style:italic;min-height:44px;font-size:15px;color:#fff}
.la-ok{width:56px;height:56px;border-radius:50%;background:#1b7a4b;display:grid;place-items:center;font-size:28px;margin:6px auto 12px}
.la-con{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #ffffff14;font-size:12px}
.la-add{display:flex;gap:6px;margin-top:8px}.la-add input{min-width:0;flex:1;border-radius:8px;border:1px solid #ffffff2b;background:#00000040;color:#fff;padding:7px 9px;font:inherit}
.la-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.la-fab{position:fixed;right:16px;bottom:16px;z-index:4000;width:54px;height:54px;border-radius:50%;border:0;background:#d62b2b;color:#fff;font-size:22px;box-shadow:0 6px 20px #0006;cursor:pointer;display:none}
@media(max-width:900px){.la-fab{display:block}}
nav a .la-ai{margin-left:6px;font-size:9px;font-weight:800;background:#d62b2b;color:#fff;border-radius:99px;padding:2px 6px}
@media(prefers-reduced-motion:reduce){.la-panel{transition:none}.la-dot.on,.la-mic.live{animation:none}}
`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

// ---------------------------------------------------------------- shell
const root = document.createElement("aside");
root.className = "la-panel"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Lilikas Assist");
root.innerHTML = `<div class="la-scroll" id="la-body"></div><div class="la-sr" aria-live="polite" id="la-live"></div>`;
const fab = document.createElement("button");
fab.className = "la-fab"; fab.setAttribute("aria-label", "Open Lilikas Assist"); fab.textContent = "✦";
const mount = () => { document.body.append(root, fab); };
document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
const body = () => root.querySelector("#la-body");
const say = t => { const l = root.querySelector("#la-live"); if (l) l.textContent = t; };
const MIC = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

// ---------------------------------------------------------------- location + context
const locLabel = () => S.ctx && S.ctx.barangay ? `Brgy. ${S.ctx.barangay}, Batangas City` : (S.loc.explicit ? "Your chosen location" : "Batangas City (default)");
let ctxTimer = null, ctxSeq = 0;
async function loadCtx(silent) {
  const seq = ++ctxSeq;
  if (!silent) { S.ctxState = "loading"; renderCtx(); }
  try {
    const r = await fetch(`/api/assist/context?lat=${S.loc.lat}&lon=${S.loc.lon}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json(); if (seq !== ctxSeq) return;
    S.ctx = d; S.ctxState = "ready";
  } catch (e) { if (seq !== ctxSeq) return; if (!silent || !S.ctx) S.ctxState = "error"; }
  renderLoc(); renderCtx();
}
function setLocation(lat, lon, explicit = true) {
  lat = +lat; lon = +lon; if (!isFinite(lat) || !isFinite(lon)) return;
  S.loc = {lat, lon, explicit}; store.set(K.loc, S.loc);
  clearTimeout(ctxTimer);
  if (S.open) ctxTimer = setTimeout(() => loadCtx(false), 500);
}
function useMyLocation() {
  if (!navigator.geolocation) { S.voiceMsg = "This browser cannot share your location."; return renderHome(); }
  navigator.geolocation.getCurrentPosition(p => { setLocation(p.coords.latitude, p.coords.longitude, true); },
    () => { S.voiceMsg = "Could not get your location. Allow location access, or pick a place on the map."; if (S.view === "home") renderHome(); });
}

// ---------------------------------------------------------------- home view
function renderHome() {
  S.view = "home"; clearInterval(cdTimer);
  const supported = !!SR, notice = S.voiceMsg; S.voiceMsg = null;
  body().innerHTML = `
  <div class="la-head"><div class="la-title"><i>✦</i> Lilikas Assist</div><button class="la-x" data-act="close" aria-label="Close Lilikas Assist">×</button></div>
  <div class="la-card la-wake"><span class="la-dot ${S.wake ? "on" : ""}" id="la-dot"></span>
    <div class="tx"><b>Listening for “Hey Lilikas”</b><small id="la-wake-sub">${supported ? (S.wake ? "Only while this tab is open" : "Off. Turn on to use your voice hands-free") : "Not supported in this browser"}</small></div>
    <label class="la-sw"><input type="checkbox" id="la-wake" ${S.wake ? "checked" : ""} ${supported ? "" : "disabled"} aria-label="Listen for Hey Lilikas"><i></i></label></div>
  <div class="la-card la-voice"><button class="la-mic" data-act="mic" ${supported ? "" : "disabled"} aria-label="Report by voice">${MIC}</button>
    <div><b>Report by voice</b><small>Say “Hey Lilikas, report flood” or tap the mic. We ask before sending.</small></div></div>
  ${notice ? `<div class="la-msg">${esc(notice)}</div>` : ""}
  <form class="la-type" id="la-form"><input id="la-text" maxlength="500" placeholder="Or type what is happening (Filipino or English)" aria-label="Type your report"><button class="la-btn red" aria-label="Make a report">Report</button></form>
  <p class="la-fine">${supported ? `Voice language: <select id="la-lang" aria-label="Voice language"><option value="fil-PH">Filipino / Taglish</option><option value="en-PH">English</option></select>. Voice uses your browser’s speech service; in Chrome and Edge the audio may be processed by Google or Microsoft.` : "Voice is not available in this browser, so type your report instead."}</p>
  <hr class="la-hr">
  <div id="la-loc"></div>
  <div id="la-ctx"></div>
  <details class="la-why" id="la-contacts"><summary>Family contacts (${S.contacts.length})</summary>
    <p>Saved only on this device. After you send a report, you get a button to text each person.</p>
    ${S.contacts.map((c, i) => `<div class="la-con"><span>${esc(c.name)} · ${esc(c.phone)}</span><button class="la-link" data-act="delcon" data-i="${i}">Remove</button></div>`).join("")}
    <form class="la-add" id="la-conform"><input id="la-cn" placeholder="Name" maxlength="40" aria-label="Contact name"><input id="la-cp" placeholder="Mobile number" maxlength="20" inputmode="tel" aria-label="Contact number"><button class="la-btn">Add</button></form></details>`;
  const sel = $("#la-lang"); if (sel) { sel.value = S.lang; }
  renderLoc(); renderCtx();
}
function renderLoc() {
  const el = $("#la-loc"); if (!el) return;
  el.innerHTML = `<p class="la-loc">📍 ${esc(locLabel())} · <button class="la-link" data-act="geo">Use my location</button></p>`;
}
function guideCard(g, i, open) {
  return `<button class="la-guide" data-act="card" data-id="${esc(g.id)}" aria-expanded="${open}"><span class="n">${i + 1}</span><span><b>${esc(g.headline)}</b>
    <span class="lab ${g.verified ? "" : "draft"}">${g.verified ? "✓ Verified guide" : "Draft guide (awaiting review)"} · ${esc(g.topic)}</span>
    ${open ? `<ul>${g.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</span></button>`;
}
function renderCtx() {
  const el = $("#la-ctx"); if (!el) return;
  if (S.ctxState === "loading" && !S.ctx) { el.innerHTML = `<div class="la-skel">Checking your area…</div>`; return; }
  if (S.ctxState === "error" && !S.ctx) { el.innerHTML = `<div class="la-msg">Could not load tips for your area. <button class="la-link" data-act="retry">Try again</button></div><a class="la-911" href="tel:911">📞 Life in danger? Call 911 now.</a>`; return; }
  const c = S.ctx; if (!c) return;
  const hasEv = c.evidence.length > 0, allVerified = c.guides.every(g => g.verified);
  el.innerHTML = `
    <span class="la-tag">• ${hasEv ? "Picked for your situation" : "General preparedness"}</span>
    <h2 class="la-h2">${hasEv ? "Do this now" : "Be ready"}</h2>
    <div class="la-chips">${c.chips.map(x => `<span class="la-chip">${esc(x)}</span>`).join("")}</div>
    ${c.guides.map((g, i) => guideCard(g, i, S.openCard === g.id)).join("")}
    <details class="la-why"><summary>✦ Why these instructions?</summary>
      <ul>${hasEv ? c.evidence.map(e => `<li><span>${EVIDENCE_ICON[e.kind] || "•"}</span>${esc(e.text)}</li>`).join("") : "<li>No special hazard is detected for your location right now.</li>"}</ul>
      <p>${allVerified ? "Assist picks from verified guides." : "Assist picks from a fixed set of guides. Some are still awaiting review by the city disaster office."} It does not write new steps or issue orders.
      ${c.engine === "model" ? "The AI only chooses the order." : `Ordered by simple rules${c.ai_enabled ? " (the AI is not responding right now)" : " (the AI is switched off)"}.`}</p></details>
    <button class="la-link" data-act="all" data-topic="${esc(c.topic || "")}">${c.topic ? `See all ${esc(c.topic.toLowerCase())} guides →` : "See all guides →"}</button>`;
}

// ---------------------------------------------------------------- guides list
async function showGuides(topic) {
  S.view = "guides"; S.guideTopic = topic || "";
  body().innerHTML = `<div class="la-head"><button class="la-link" data-act="home">← Back</button><button class="la-x" data-act="close" aria-label="Close Lilikas Assist">×</button></div><div class="la-skel">Loading guides…</div>`;
  try {
    const d = await (await fetch(`/api/assist/guides?lat=${S.loc.lat}&lon=${S.loc.lon}` + (topic ? `&topic=${encodeURIComponent(topic)}` : ""))).json();
    if (S.view !== "guides") return;
    body().innerHTML = `<div class="la-head"><button class="la-link" data-act="home">← Back</button><button class="la-x" data-act="close" aria-label="Close Lilikas Assist">×</button></div>
      <h2 class="la-h2">${topic ? esc(topic) + " guides" : "All guides"}</h2>
      <div class="la-chips"><button class="la-chip" data-act="all" data-topic="">All</button>${d.topics.map(t => `<button class="la-chip" data-act="all" data-topic="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      ${d.guides.map((g, i) => guideCard(g, i, true)).join("") || '<p class="la-fine">No guides for this topic.</p>'}
      <p class="la-fine">${d.guides.every(g => g.verified) ? "" : "Some guides are still awaiting review by the city disaster office. "}Always follow instructions from local officials.</p>`;
  } catch { if (S.view === "guides") body().innerHTML += `<div class="la-msg">Could not load guides.</div>`; }
}

// ---------------------------------------------------------------- voice
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null, capRec = null, wakeFails = 0, busy = false;
const WAKE_RE = /\b(?:hey|hi|hay|ok|okay)\s+(?:li+l[iy]+[ck]+[ae]?s?|lily\s*(?:kas|cas|cus))\b[,.\s]*(.*)$/;
const norm = t => t.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
function voiceError(code) {
  return {"not-allowed": "The microphone is blocked. Allow it in your browser settings, or type your report.",
    "service-not-allowed": "Speech recognition is not allowed here. Type your report instead.",
    "no-speech": "I did not hear anything. Tap the mic and try again, or type your report.",
    "audio-capture": "No microphone was found. Type your report instead.",
    "network": "Speech recognition could not reach its service. Type your report instead.",
    "language-not-supported": "That voice language is not supported here. Try English or type your report."}[code] || "Voice did not work. Type your report instead.";
}
function setWake(on, quiet) {
  S.wake = !!on && !!SR; store.set(K.wake, S.wake);
  const dot = $("#la-dot"), sub = $("#la-wake-sub"), box = $("#la-wake");
  if (dot) dot.classList.toggle("on", S.wake);
  if (sub) sub.textContent = S.wake ? "Only while this tab is open" : "Off. Turn on to use your voice hands-free";
  if (box) box.checked = S.wake;
  if (S.wake) startWake(); else stopWake();
}
function startWake() {
  if (!SR || wakeRec || busy || !S.wake) return;
  const r = new SR(); r.lang = S.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  let fired = false;
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const m = norm(e.results[i][0].transcript).match(WAKE_RE);
      if (m && !fired) { fired = true; wakeFails = 0; try { r.stop(); } catch {} wakeHeard(m[1] || ""); return; }
    }
  };
  r.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "network") {
      S.voiceMsg = voiceError(e.error); setWake(false); if (S.view === "home") renderHome();
    }
  };
  r.onend = () => { wakeRec = null; if (S.wake && !busy && !fired && ++wakeFails < 40) setTimeout(startWake, 400); };
  try { r.start(); wakeRec = r; } catch { wakeRec = null; }
}
function stopWake() { const r = wakeRec; wakeRec = null; if (r) { r.onend = null; try { r.stop(); } catch {} } }
function wakeHeard(rest) {
  open();
  rest = rest.replace(/^(?:please|po)\b\s*/, "").trim();
  if (rest.length > 3) reportFrom(rest); else listen();
}
function capture() {
  return new Promise((resolve, reject) => {
    const r = new SR(); capRec = r; r.lang = S.lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = "", err = "";
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t + " "; else interim += t; }
      S.interim = (final + interim).trim(); const p = root.querySelector("#la-interim"); if (p) p.textContent = S.interim || "Listening…";
    };
    r.onerror = e => { err = e.error; };
    r.onend = () => { capRec = null; final.trim() ? resolve(final.trim()) : reject(new Error(err || "no-speech")); };
    try { r.start(); } catch (e) { capRec = null; reject(e); }
  });
}
async function listen() {
  if (!SR || busy) return;
  busy = true; stopWake(); S.interim = ""; S.view = "listening"; S.voiceMsg = null;
  body().innerHTML = `<div class="la-head"><div class="la-title"><i>✦</i> Lilikas Assist</div><button class="la-x" data-act="cancelcap" aria-label="Cancel">×</button></div>
    <div class="la-listen"><button class="la-mic live" data-act="stopcap" aria-label="Stop listening">${MIC}</button><p id="la-interim">Listening…</p>
    <small class="la-fine">Say what is happening, where, and how many of you. Tap the mic when you are done.</small></div>
    <a class="la-911" href="tel:911">📞 Life in danger? Call 911 now.</a>`;
  say("Listening. Say what is happening.");
  try {
    const text = await capture(); busy = false;
    if (S.view === "listening") reportFrom(text);
  } catch (e) {
    busy = false;
    if (S.view === "listening") { S.voiceMsg = voiceError(e.message); renderHome(); }
  }
  if (!busy) setTimeout(startWake, 300);
}

// ---------------------------------------------------------------- report: draft, countdown, send
let cdTimer = null;
async function reportFrom(text) {
  text = String(text).trim(); if (!text) return;
  S.view = "drafting"; S.voiceMsg = null;
  body().innerHTML = `<div class="la-head"><div class="la-title"><i>✦</i> Lilikas Assist</div><button class="la-x" data-act="cancel" aria-label="Cancel">×</button></div><div class="la-skel">Reading what you said…</div><a class="la-911" href="tel:911">📞 Life in danger? Call 911 now.</a>`;
  let d;
  try {
    const r = await fetch("/api/assist/draft-report", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text})});
    d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not read the report");
  } catch (e) { if (S.view !== "drafting") return; S.voiceMsg = e.message || "Could not read the report."; return renderHome(); }
  if (S.view !== "drafting") return;
  S.draft = {report_type: d.report_type, water_level: d.water_level, people_count: d.people_count, life_in_danger: d.life_in_danger,
    needs: d.needs || [], quote: d.quote || text, note: "", sending: false};
  S.err = null; S.editing = null; S.left = 5;
  S.paused = S.draft.needs.includes("report_type");           // we can't send "other" without asking what it is
  renderDraft(); if (!S.paused) startCountdown();
}
const nContacts = () => S.contacts.length;
function subtitle() {
  const d = S.draft, brgy = S.ctx && S.ctx.barangay, n = nContacts();
  const to = `Batangas City responders${brgy ? ` (Brgy. ${esc(brgy)})` : ""}`;
  if (d.sending) return "Sending…";
  if (S.err) return esc(S.err);
  if (S.paused) return d.needs.includes("report_type") ? "Choose what kind of report this is, then tap Send now." : "Paused. Check the details, then tap Send now.";
  return `To ${to} in ${S.left} second${S.left === 1 ? "" : "s"}.${n ? ` Then you can text your ${n} family contact${n > 1 ? "s" : ""}.` : ""}`;
}
function ringHtml() {
  const C = 2 * Math.PI * 34, off = C * (1 - (S.paused ? 1 : S.left / 5));
  return `<div class="la-ring" aria-hidden="true"><svg width="74" height="74"><circle cx="37" cy="37" r="34" fill="none" stroke="#ffffff22" stroke-width="5"/>
    <circle id="la-arc" cx="37" cy="37" r="34" fill="none" stroke="#ff5a5a" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset 1s linear"/></svg>
    <div class="num" id="la-num">${S.paused ? "Ⅱ" : S.left}</div></div>`;
}
function rowHtml(key, label, value, miss) {
  if (S.editing === key) {
    const d = S.draft; let ctl = "";
    if (key === "report_type") ctl = `<select id="la-ed">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === d.report_type ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    if (key === "water_level") ctl = `<select id="la-ed">${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${k === (d.water_level || "unknown") ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    if (key === "location") ctl = `<input id="la-ed" maxlength="160" placeholder="Landmark or street (optional)" value="${esc(d.note)}">`;
    if (key === "people_count") ctl = `<input id="la-ed" type="number" min="1" max="500" value="${d.people_count || ""}" placeholder="How many people?">`;
    return `<div class="la-row"><div><small>${label}</small>${ctl}</div><button class="ed" data-act="done" data-k="${key}">Done</button></div>`;
  }
  return `<div class="la-row"><div><small>${label}</small><b class="${miss ? "miss" : ""}">${esc(value)}</b></div><button class="ed" data-act="edit" data-k="${key}">${miss ? "Add" : "Edit"}</button></div>`;
}
function renderDraft() {
  S.view = "draft"; const d = S.draft, brgy = S.ctx && S.ctx.barangay;
  const typeName = d.report_type === "other" ? "hazard" : d.report_type;
  body().innerHTML = `
  <div class="la-head"><div class="la-title"><i>✦</i> Lilikas Assist</div><button class="la-x" data-act="cancel" aria-label="Cancel report">×</button></div>
  ${d.life_in_danger ? `<a class="la-911 big" href="tel:911">📞 This sounds serious. Call 911 now.</a><div style="height:12px"></div>` : ""}
  <div class="la-send">${ringHtml()}<div><b>Sending your ${esc(typeName)} report</b><small id="la-sub">${subtitle()}</small></div></div>
  <div class="la-btns"><button class="la-btn white" data-act="cancel">Cancel</button><button class="la-btn" data-act="sendnow" ${d.sending ? "disabled" : ""}>Send now →</button></div>
  <div class="la-sec">Your report</div>
  <div class="la-rows">
    ${rowHtml("report_type", "Report", TYPE_LABEL[d.report_type] || "Other", d.needs.includes("report_type"))}
    ${d.report_type === "flood" ? rowHtml("water_level", "Water level", LEVEL_LABEL[d.water_level || "unknown"], (d.water_level || "unknown") === "unknown") : ""}
    ${rowHtml("location", "Location", (brgy ? `Brgy. ${brgy}, Batangas City` : "Batangas City") + (d.note ? ` · ${d.note}` : ""), false)}
    ${rowHtml("people_count", "People with you", d.people_count ? String(d.people_count) : "Not stated", !d.people_count)}
  </div>
  <p class="la-quote">From what you said: “${esc(d.quote)}”</p>
  ${d.life_in_danger ? "" : `<a class="la-911" href="tel:911">📞 Life in danger? Call 911 now.</a>`}`;
  const ed = $("#la-ed"); if (ed) ed.focus();
}
function startCountdown() {
  clearInterval(cdTimer); S.left = 5; say("Sending your report in 5 seconds. Press Cancel to stop."); tick();
  cdTimer = setInterval(() => {
    if (S.paused || S.view !== "draft") { clearInterval(cdTimer); return; }
    S.left -= 1; tick();
    if (S.left <= 0) { clearInterval(cdTimer); sendReport(); }
  }, 1000);
}
function tick() {
  const n = $("#la-num"), a = $("#la-arc"), s = $("#la-sub");
  if (n) n.textContent = Math.max(S.left, 0); if (s) s.innerHTML = subtitle();
  if (a) { const C = 2 * Math.PI * 34; requestAnimationFrame(() => a.setAttribute("stroke-dashoffset", C * (1 - Math.max(S.left, 0) / 5))); }
}
function pause() { if (S.paused) return; S.paused = true; clearInterval(cdTimer); say("Paused."); }
async function sendReport() {
  const d = S.draft; if (!d || d.sending) return;
  clearInterval(cdTimer); d.sending = true; S.err = null; S.paused = false; renderDraft();
  const payload = {report_type: d.report_type, water_level: d.report_type === "flood" && d.water_level !== "unknown" ? d.water_level : (d.report_type === "flood" ? "unknown" : null),
    people_count: d.people_count || null, lat: S.loc.lat, lon: S.loc.lon, barangay: S.ctx && S.ctx.barangay || "", location_note: d.note,
    quote: d.quote, life_in_danger: d.life_in_danger, family_contacts: nContacts()};
  try {
    const r = await fetch("/api/assist/report", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not send the report");
    S.sent = {id: j.id, payload}; renderSent();
  } catch (e) { d.sending = false; S.err = (e.message || "Could not send.") + " Tap Send now to try again."; S.paused = true; renderDraft(); }
}
function smsLink(c, p) {
  const lvl = p.water_level && p.water_level !== "unknown" ? `, ${LEVEL_LABEL[p.water_level].toLowerCase()}` : "";
  const ppl = p.people_count ? `, ${p.people_count} people` : "";
  const msg = `${TYPE_LABEL[p.report_type]} report from Lilikas Na Ga${lvl}${ppl}. Near ${p.barangay ? "Brgy. " + p.barangay : "Batangas City"}. Map: https://www.google.com/maps?q=${p.lat},${p.lon}`;
  return `sms:${encodeURIComponent(c.phone)}?&body=${encodeURIComponent(msg)}`;
}
function renderSent() {
  S.view = "sent"; const p = S.sent.payload;
  body().innerHTML = `<div class="la-head"><div class="la-title"><i>✦</i> Lilikas Assist</div><button class="la-x" data-act="home" aria-label="Close report">×</button></div>
    <div style="text-align:center"><div class="la-ok">✓</div><h2 class="la-h2" style="margin-top:0">Report sent</h2>
    <p class="la-fine">Saved for Batangas City responders. Reference <b>${esc(S.sent.id)}</b>. This does not replace calling for help.</p></div>
    ${S.contacts.length ? `<div class="la-sec">Let your family know</div>${S.contacts.map(c => `<a class="la-911" href="${smsLink(c, p)}">💬 Text ${esc(c.name)}</a>`).join("")}` : ""}
    <a class="la-911 ${p.life_in_danger ? "big" : ""}" href="tel:911">📞 Life in danger? Call 911 now.</a>
    <div style="height:12px"></div><button class="la-btn" style="width:100%" data-act="home">Done</button>`;
  say("Report sent.");
}
function cancelDraft() { clearInterval(cdTimer); S.draft = null; S.err = null; renderHome(); say("Report cancelled."); }

// ---------------------------------------------------------------- events
root.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  if (act === "close") return close();
  if (act === "home") return renderHome();
  if (act === "mic") return listen();
  if (act === "stopcap") { try { capRec && capRec.stop(); } catch {} return; }
  if (act === "cancelcap") { const r = capRec; if (r) { r.onend = null; try { r.abort(); } catch {} } capRec = null; busy = false; renderHome(); setTimeout(startWake, 300); return; }
  if (act === "geo") return useMyLocation();
  if (act === "retry") return loadCtx(false);
  if (act === "card") { S.openCard = S.openCard === el.dataset.id ? null : el.dataset.id; if (S.view === "guides") return; return renderCtx(); }
  if (act === "all") return showGuides(el.dataset.topic);
  if (act === "delcon") { S.contacts.splice(+el.dataset.i, 1); store.set(K.contacts, S.contacts); const open = $("#la-contacts").open; renderHome(); $("#la-contacts").open = open; return; }
  if (act === "cancel") return cancelDraft();
  if (act === "sendnow") return sendReport();
  if (act === "edit") { pause(); S.editing = el.dataset.k; return renderDraft(); }
  if (act === "done") {
    const d = S.draft, k = el.dataset.k, v = ($("#la-ed") || {}).value;
    if (k === "report_type") { d.report_type = v; d.needs = d.needs.filter(x => x !== "report_type"); if (v !== "flood") d.water_level = null; else d.water_level = d.water_level || "unknown"; }
    if (k === "water_level") d.water_level = v;
    if (k === "location") d.note = (v || "").trim();
    if (k === "people_count") d.people_count = Math.max(1, Math.min(500, parseInt(v, 10) || 0)) || null;
    S.editing = null; S.paused = true; return renderDraft();
  }
});
root.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "la-form") { const i = $("#la-text"); const t = i.value.trim(); if (t) reportFrom(t); }
  if (e.target.id === "la-conform") {
    const name = $("#la-cn").value.trim(), phone = $("#la-cp").value.trim();
    if (!name || !/^\+?[\d\s-]{7,15}$/.test(phone)) { S.voiceMsg = "Enter a name and a mobile number (for example 0917 123 4567)."; return renderHome(); }
    S.contacts.push({name: name.slice(0, 40), phone}); store.set(K.contacts, S.contacts); S.voiceMsg = null; renderHome(); $("#la-contacts").open = true;
  }
});
root.addEventListener("change", e => {
  if (e.target.id === "la-wake") { if (e.target.checked) { S.voiceMsg = null; } setWake(e.target.checked); }
  if (e.target.id === "la-lang") { S.lang = e.target.value; store.set(K.lang, S.lang); if (S.wake) { stopWake(); startWake(); } }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !S.open) return;
  if (S.view === "draft") cancelDraft(); else if (S.view === "listening") root.querySelector("[data-act=cancelcap]").click(); else close();
});
document.addEventListener("click", e => { if (e.target.closest("[data-assist-open]")) { e.preventDefault(); open(); } });
fab.addEventListener("click", open);

// ---------------------------------------------------------------- open / close
let pollTimer = null;
function open() {
  if (S.open) return; S.open = true; root.classList.add("on");
  if (S.view === "home" || !S.draft) renderHome();
  loadCtx(false); clearInterval(pollTimer); pollTimer = setInterval(() => { if (S.open && S.view === "home") loadCtx(true); }, 60000);
  setTimeout(() => { const x = root.querySelector(".la-x"); x && x.focus(); }, 260);
}
function close() {
  S.open = false; root.classList.remove("on"); clearInterval(pollTimer);
  if (S.view === "draft") { /* a pending report is cancelled when the panel is closed */ clearInterval(cdTimer); S.draft = null; }
  const r = capRec; if (r) { r.onend = null; try { r.abort(); } catch {} capRec = null; busy = false; }
  S.view = "home";
}
window.LilikasAssist = {open, close, setLocation};
// A person who turned "Hey Lilikas" on before keeps it on (the browser has already been given mic permission).
if (SR && store.get(K.wake, false)) { S.wake = true; setTimeout(startWake, 600); }
})();
