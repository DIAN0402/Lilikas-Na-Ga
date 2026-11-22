/* Lilikas Assist: slide-in panel (desktop) / full screen (mobile).
   Figma: "Overview · Assist panel", "Overview · Assist sending report", and the six "Assist · ... · Mobile web" frames.

   What it does
   - Shows guides PICKED for the person's situation (the AI only orders guides from a fixed library; it never writes advice).
   - Turns a spoken or typed report ("Baha na po, hanggang tuhod") into a draft the person checks, with a 5-second
     cancellable countdown before sending.
   - With no signal, saves the report on this device and sends it when the connection comes back.
   Open it from any element with  data-assist-open . Pages can call  LilikasAssist.setLocation(lat, lon). */
(() => {
"use strict";
const { api, store, esc, icon } = LNG;

const TYPE_LABEL = { flood: "Flood", landslide: "Landslide", earthquake: "Earthquake", fire: "Fire", other: "Other" };
const LEVEL_LABEL = { ankle: "Ankle deep", knee: "Knee deep", thigh: "Thigh deep", waist: "Waist deep", chest: "Chest deep", over_head: "Over head", unknown: "Not sure" };
const EV_ICON = { flood: "waves", landslide: "mountain", rain: "rain", advisory: "bell", storm: "wind", quake: "quake", dark: "moon", report: "msg" };
const QUICK = [["Report flood", "report flood"], ["I need rescue", "I need rescue, trapped"], ["Road blocked", "road blocked by landslide"]];

const S = {
  open: false, view: "home", ctx: null, ctxState: "idle", wake: false, lang: store.get("voiceLang", "fil-PH"),
  contacts: store.get("contacts", []), interim: "", draft: null, left: 5, paused: false, editing: null, err: null,
  sent: null, openCard: null, msg: null, queue: store.get("outbox", []), ai: null,
};
const here = () => { const l = LNG.loc(); return { lat: l.lat, lon: l.lon, label: l.label }; };

// ---------------------------------------------------------------- styles
const css = `
.la{--mute:#cfb3b3;position:fixed;top:0;right:0;bottom:0;width:min(430px,100vw);z-index:5000;color:#f6e6e6;font-family:var(--ui);font-size:13px;
 background:radial-gradient(120% 55% at 50% 30%,#4a1216 0,#2a0e13 45%,#0e0709 100%);box-shadow:-14px 0 50px #0009;transform:translateX(105%);
 transition:transform .25s ease;display:flex;flex-direction:column}
.la.on{transform:none}.la *{box-sizing:border-box}
.la-scroll{overflow:auto;padding:18px 18px 28px;flex:1}
.la-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px}
.la-title{font-size:15px;font-weight:800;display:flex;gap:8px;align-items:center;color:#fff}.la-title .ic{color:var(--coral-l)}
.la-x{width:32px;height:32px;border-radius:50%;border:1px solid #ffffff33;background:#ffffff0d;color:#fff;display:grid;place-items:center}
.la-card{border:1px solid #ffffff1f;background:#ffffff0b;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.la-wake{display:flex;align-items:center;gap:10px}.la-wake b{display:block;font-size:12.5px;color:#fff}.la-wake small{color:var(--mute);font-size:11px;font-family:var(--serif)}.la-wake .tx{flex:1}
.la-dot{width:9px;height:9px;border-radius:50%;background:#777;flex:none}.la-dot.on{background:#ff4d4d;box-shadow:0 0 0 4px #ff4d4d33;animation:la-p 1.6s infinite}
@keyframes la-p{50%{box-shadow:0 0 0 8px #ff4d4d11}}
.la-voice{display:flex;align-items:center;gap:14px;padding:14px;background:linear-gradient(135deg,#5b1515,#3a0e0e);border-color:#ff5a5a44}
.la-mic{width:48px;height:48px;border-radius:50%;border:0;background:var(--red);color:#fff;display:grid;place-items:center;flex:none;box-shadow:0 0 0 6px #d32f2f33}
.la-mic .ic{width:22px;height:22px}.la-mic:disabled{opacity:.45;cursor:not-allowed}.la-mic.live{animation:la-p 1.2s infinite}
.la-voice b{font-size:14px;display:block;color:#fff}.la-voice small{color:var(--mute);font-size:11.5px;line-height:1.45;display:block;margin-top:2px;font-family:var(--serif)}
.la-type{display:flex;gap:6px;margin:2px 0 6px}.la-type input{flex:1;min-width:0;border-radius:10px;border:1px solid #ffffff2b;background:#00000040;color:#fff;padding:10px 12px}
.la-type input::placeholder{color:#cfb3b3aa}
.la-btn{border:1px solid #ffffff33;background:#ffffff12;color:#fff;border-radius:10px;padding:10px 14px;font-weight:700;display:inline-flex;gap:6px;align-items:center;justify-content:center}
.la-btn.red{background:var(--red);border-color:var(--red)}.la-btn.white{background:#fff;color:var(--red);border-color:#fff}.la-btn.block{width:100%}.la-btn:disabled{opacity:.5}
.la-fine{font-size:10.5px;color:var(--mute);line-height:1.5;margin:6px 2px;font-family:var(--serif)}.la-fine select{background:#00000040;color:#fff;border:1px solid #ffffff2b;border-radius:6px;padding:2px 4px}
.la-msg{background:#ffd9d933;border:1px solid #ff8a8a66;color:#ffe0e0;border-radius:10px;padding:9px 11px;margin:8px 0;font-size:12px}
.la-hr{border:0;border-top:1px solid #ffffff1a;margin:16px 0}
.la-tag{display:inline-flex;gap:6px;align-items:center;font-size:10.5px;font-weight:700;color:#ffb1a8;background:#d32f2f33;border:1px solid #ff5a5a55;border-radius:99px;padding:3px 10px}
.la-tag::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--coral-l)}
.la-h2{font-size:22px;font-weight:800;margin:10px 0 10px;color:#fff;line-height:1.2}
.la-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}.la-chip{border:1px solid #ffffff2b;background:#ffffff10;border-radius:99px;padding:5px 11px;font-size:11.5px;color:#fff;font-weight:600}
button.la-chip:hover{background:#ffffff22}
.la-loc{font-size:11.5px;color:var(--mute);margin:0 0 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}.la-link{background:none;border:0;color:#ff8f84;font-weight:700;padding:0;text-decoration:underline}
.la-guide{display:flex;gap:11px;width:100%;text-align:left;background:#fff;color:var(--navy);border:0;border-radius:11px;padding:12px 13px;margin-bottom:9px}
.la-guide .n{width:22px;height:22px;border-radius:50%;background:var(--red);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;flex:none;margin-top:1px}
.la-guide b{display:block;font-size:13.5px;line-height:1.35}.la-guide .lab{display:flex;gap:4px;align-items:center;font-size:11px;font-weight:700;margin-top:5px;color:var(--green)}.la-guide .lab.draft{color:var(--amber)}
.la-guide ul{margin:8px 0 0;padding-left:16px;font-size:12px;font-weight:500;color:#3d475a;line-height:1.5;font-family:var(--serif)}
.la-why{border:1px solid #ffffff1f;background:#ffffff0a;border-radius:12px;padding:11px 13px;margin:12px 0}.la-why summary{cursor:pointer;font-weight:700;font-size:12.5px;color:#fff;display:flex;gap:6px;align-items:center}
.la-why li{list-style:none;display:flex;gap:9px;align-items:center;margin:8px 0;font-size:12px}.la-why li .ic{color:var(--coral-l)}.la-why ul{padding:0;margin:8px 0 0}.la-why p{color:var(--mute);font-size:11px;line-height:1.5;margin:8px 0 0;font-family:var(--serif)}
.la-skel{color:var(--mute);padding:18px 0}
.la-ring{position:relative;width:70px;height:70px;flex:none}.la-ring svg{transform:rotate(-90deg)}.la-ring .num{position:absolute;inset:0;display:grid;place-items:center;font-size:28px;font-weight:800;color:#fff}
.la-send{display:flex;gap:16px;align-items:center;border:1px solid #ff5a5a55;background:linear-gradient(135deg,#5b1515,#2e0b0b);border-radius:16px;padding:16px;margin-bottom:12px}
.la-send b{font-size:16px;display:block;margin-bottom:4px;color:#fff}.la-send small{color:var(--mute);font-size:12px;line-height:1.45;font-family:var(--serif)}
.la-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.la-sec{font-size:12px;color:var(--mute);margin:14px 0 8px;font-weight:700}
.la-rows{background:#fff;color:var(--navy);border-radius:12px;padding:2px 14px}.la-row{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:center;padding:11px 0;border-top:1px solid #f3e4e4}.la-row:first-child{border-top:0}
.la-row>.ic{color:var(--red)}.la-row small{display:block;font-size:10.5px;color:var(--slate)}.la-row b{font-size:13.5px}.la-row b.miss{color:var(--amber)}.la-row .ed{background:none;border:0;color:var(--red);font-weight:700;font-size:12px}
.la-row select,.la-row input{width:100%;margin-top:4px;border:1px solid #d9dde6;border-radius:8px;padding:7px 8px;color:var(--navy)}
.la-quote{font-family:var(--serif);font-style:italic;color:var(--mute);font-size:12px;margin:12px 2px;line-height:1.5}
.la-911{display:flex;gap:8px;align-items:center;justify-content:center;border:0;background:#fff;color:var(--red);border-radius:12px;padding:13px 14px;font-weight:800;text-decoration:none;margin-top:12px}
.la-911.big{background:var(--red);color:#fff;font-size:15px}
.la-listen{text-align:center;padding:16px 6px}.la-orb{width:150px;height:150px;margin:6px auto 18px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#d32f2f55 0,#d32f2f22 45%,transparent 70%)}
.la-orb .la-mic{width:72px;height:72px}.la-listen h2{font-size:24px;margin:0 0 6px;color:#fff}.la-listen p{font-family:var(--serif);color:var(--mute);margin:0 0 14px}
.la-wave{display:flex;gap:3px;justify-content:center;align-items:center;height:34px;margin:6px 0 16px}.la-wave i{width:3px;border-radius:2px;background:var(--coral-l);animation:la-w 1s ease-in-out infinite}
@keyframes la-w{0%,100%{height:6px}50%{height:30px}}
.la-heard{text-align:left;border:1px solid #ffffff1f;background:#ffffff0b;border-radius:12px;padding:12px 14px;min-height:70px}.la-heard small{color:var(--coral-l);font-weight:700;font-size:11px}
.la-heard p{font-family:var(--serif);font-style:italic;color:#fff;margin:4px 0 0;font-size:14px}
.la-ok{display:flex;gap:12px;align-items:center;border:1px solid #2f8f73;background:#123d32aa;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.la-ok .b{width:32px;height:32px;border-radius:50%;background:#2fa27e;display:grid;place-items:center;flex:none;color:#fff}.la-ok b{display:block;color:#fff}.la-ok small{color:#c4e6da;font-family:var(--serif)}
.la-wait{display:flex;gap:12px;align-items:center;border:1px solid #f6c45388;background:#3a2a0bcc;border-radius:14px;padding:12px 14px;margin-bottom:10px}
.la-wait .b{width:32px;height:32px;border-radius:50%;background:var(--yellow);display:grid;place-items:center;flex:none;color:#3a2a0b}.la-wait b{display:block;color:#fff}.la-wait small{color:#f3e2b5;font-family:var(--serif)}
.la-queued{display:flex;justify-content:space-between;align-items:center;border:1px solid #ffffff1f;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px}
.la-feat{display:flex;gap:10px;align-items:center;padding:9px 0;font-size:12.5px;font-weight:600;color:#fff}.la-feat .ic{color:var(--coral-l)}
.la-short{display:grid;grid-template-columns:1fr 1fr;gap:10px}.la-short div{border:1px solid #ffffff1f;background:#ffffff0b;border-radius:12px;padding:11px 12px}.la-short b{color:#fff;display:block}.la-short small{color:var(--mute);font-family:var(--serif)}
.la-con{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 0;border-top:1px solid #ffffff14;font-size:12px}
.la-add{display:flex;gap:6px;margin-top:8px}.la-add input{min-width:0;flex:1;border-radius:8px;border:1px solid #ffffff2b;background:#00000040;color:#fff;padding:7px 9px}
.la-ai{display:inline-flex;gap:5px;align-items:center;font-size:10px;font-weight:800;letter-spacing:.04em;border-radius:99px;padding:3px 8px;margin-left:6px;text-transform:uppercase}
.la-ai.on{background:#2fa27e33;color:#8fe0c2;border:1px solid #2fa27e66}.la-ai.off{background:#f6c45322;color:var(--yellow);border:1px solid #f6c45355}.la-ai.wait{background:#ffffff14;color:var(--mute);border:1px solid #ffffff22}
.la-ai i{width:6px;height:6px;border-radius:50%;background:currentColor}
.la-tr{border:1px solid #2fa27e66;background:#123d3255;border-radius:12px;padding:11px 13px;margin:10px 0}.la-tr small{display:flex;gap:6px;align-items:center;color:#8fe0c2;font-weight:800;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}
.la-tr p{margin:5px 0 0;color:#fff;font-size:14px;line-height:1.45}.la-tr.off{border-color:#f6c45355;background:#3a2a0b55}.la-tr.off small{color:var(--yellow)}.la-tr.off p{font-size:12px;color:#f3e2b5;font-family:var(--serif)}
.la-spin{width:16px;height:16px;border-radius:50%;border:2px solid #ffffff33;border-top-color:var(--coral-l);animation:la-s 0.8s linear infinite;display:inline-block;vertical-align:-3px}
@keyframes la-s{to{transform:rotate(360deg)}}
.la-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.la-backdrop{position:fixed;inset:0;background:#0e070955;z-index:4999;display:none}.la-backdrop.on{display:block}
@media(max-width:900px){.la{width:100vw}}
@media(prefers-reduced-motion:reduce){.la{transition:none}.la-dot.on,.la-mic.live,.la-wave i{animation:none}}`;
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

// ---------------------------------------------------------------- shell
const root = document.createElement("aside");
root.className = "la"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Lilikas Assist");
root.innerHTML = `<div class="la-scroll" id="la-body"></div><div class="la-sr" aria-live="polite" id="la-live"></div>`;
const backdrop = document.createElement("div"); backdrop.className = "la-backdrop";
const mount = () => document.body.append(backdrop, root);
document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
const $ = s => root.querySelector(s);
const body = () => $("#la-body");
const say = t => { const l = $("#la-live"); if (l) l.textContent = t; };
const aiChip = () => S.ai == null ? `<span class="la-ai wait" title="Checking the AI…"><i></i>AI…</span>`
  : S.ai.ok ? `<span class="la-ai on" title="${esc(S.ai.model || "")}"><i></i>AI on</span>`
  : `<span class="la-ai off" title="${esc(S.ai.error || "")}"><i></i>AI off</span>`;
const head = (act = "close", back) => `<div class="la-head">${back ? `<button class="la-x" data-act="${back}" aria-label="Back">${icon("arrowL")}</button>` : ""}
  <div class="la-title">${icon("sparkle")} Lilikas Assist ${aiChip()}</div><button class="la-x" data-act="${act}" aria-label="Close">${icon("x")}</button></div>`;
const call911 = (big, text = "Life in danger? Call 911 now.") => `<a class="la-911 ${big ? "big" : ""}" href="tel:911">${icon("phone")} ${text}</a>`;

// ---------------------------------------------------------------- is the AI connected? (one real call, cached a minute on the server)
let aiAt = 0;
async function checkAI(force) {
  if (!force && Date.now() - aiAt < 60000 && S.ai) return;
  aiAt = Date.now();
  try {
    const d = await api("/api/assist/ai?check=1", { timeout: 40000 });
    S.ai = { ok: !!(d.check && d.check.ok), model: d.model, provider: d.provider, enabled: d.enabled,
      error: d.check && d.check.error ? d.check.error : (d.enabled ? null : "No AI key is set on the server.") };
  } catch (e) { S.ai = { ok: false, error: e.message }; }
  $$chips();
  if (S.view === "home") { const n = $("#la-ainote"); if (n) n.outerHTML = aiNote(); }
}
function $$chips() { root.querySelectorAll(".la-ai").forEach(el => { el.outerHTML = aiChip(); }); }
const aiNote = () => S.ai && !S.ai.ok ? `<div class="la-msg" id="la-ainote"><b>The AI is not connected.</b> ${esc(S.ai.error || "")}
  Reports still work with simple rules, but translating what you say needs the AI. <button class="la-link" data-act="aicheck">Check again</button></div>` : `<span id="la-ainote"></span>`;

// ---------------------------------------------------------------- situation + guides
let ctxSeq = 0;
async function loadCtx(silent) {
  const seq = ++ctxSeq, p = here();
  if (!silent) { S.ctxState = "loading"; renderCtx(); }
  try {
    const d = await api(`/api/assist/context?lat=${p.lat}&lon=${p.lon}`, { timeout: 30000 });
    if (seq !== ctxSeq) return; S.ctx = d; S.ctxState = "ready";
    cacheGuides();
  } catch { if (seq !== ctxSeq) return; if (!silent || !S.ctx) S.ctxState = "error"; }
  renderCtx();
}
// keep the full guide library on this device, so "Do this now" still works with no signal
async function cacheGuides() {
  if (Date.now() - store.get("guidesAt", 0) < 6 * 3600e3) return;
  try { const d = await api("/api/assist/guides"); store.set("guides", d.guides); store.set("guidesAt", Date.now()); } catch { /* try later */ }
}
const TOPICS = { flood: ["Flood", "Evacuation", "Power outage"], landslide: ["Landslide", "Evacuation"], earthquake: ["Earthquake"], fire: ["Be ready"], other: ["Be ready"] };
function offlineGuides(type) {
  const all = store.get("guides", []), want = TOPICS[type] || TOPICS.other;
  return want.flatMap(t => all.filter(g => g.topic === t && !/{center}/.test(g.headline))).slice(0, 3);
}

function guideCard(g, i, open) {
  return `<button class="la-guide" data-act="card" data-id="${esc(g.id)}" aria-expanded="${open}"><span class="n">${i + 1}</span><span><b>${esc(g.headline)}</b>
    <span class="lab ${g.verified ? "" : "draft"}">${icon(g.verified ? "shield" : "info")} ${g.verified ? "Verified guide" : "Draft guide, awaiting CDRRMO review"} · ${esc(g.topic)}</span>
    ${open && g.details ? `<ul>${g.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</span></button>`;
}
function whyBox(evidence, engine, aiOn) {
  return `<details class="la-why"><summary>${icon("sparkle")} Why these instructions?</summary>
    <ul>${evidence.length ? evidence.map(e => `<li>${icon(EV_ICON[e.kind] || "info")}${esc(e.text)}</li>`).join("") : "<li>No special hazard is detected for your location right now.</li>"}</ul>
    <p>Assist picks from a fixed set of guides; it does not write new steps or issue orders. ${engine === "model" ? "The AI chose the order." : `Ordered by simple rules${aiOn ? " (the AI is not responding right now)" : ""}.`}</p></details>`;
}
function renderCtx() {
  const el = $("#la-ctx"); if (!el) return;
  if (S.ctxState === "loading" && !S.ctx) { el.innerHTML = `<div class="la-skel">Checking your area…</div>`; return; }
  if (S.ctxState === "error" && !S.ctx) {
    const g = offlineGuides("flood");
    el.innerHTML = `<div class="la-msg">Could not load tips for your area. <button class="la-link" data-act="retry">Try again</button></div>
      ${g.length ? `<span class="la-tag">Saved on this device</span><h2 class="la-h2">Be ready</h2>${g.map((x, i) => guideCard(x, i, false)).join("")}` : ""}${call911(false)}`;
    return;
  }
  const c = S.ctx; if (!c) return;
  const hasEv = c.evidence.length > 0;
  el.innerHTML = `<span class="la-tag">${hasEv ? "Picked for your situation" : "General preparedness"}</span>
    <h2 class="la-h2">${hasEv ? "Do this now" : "Be ready"}</h2>
    <div class="la-chips">${c.chips.map(x => `<span class="la-chip">${esc(x)}</span>`).join("")}</div>
    ${c.guides.map((g, i) => guideCard(g, i, S.openCard === g.id)).join("")}
    ${whyBox(c.evidence, c.engine, c.ai_enabled)}
    <button class="la-link" data-act="all" data-topic="${esc(c.topic || "")}">${c.topic ? `See all ${esc(c.topic.toLowerCase())} guides →` : "See all guides →"}</button>`;
}

// ---------------------------------------------------------------- home
function renderHome() {
  S.view = "home"; clearInterval(cdTimer);
  const supported = !!SR, notice = S.msg; S.msg = null;
  body().innerHTML = `${head()}
  ${aiNote()}
  ${S.queue.length ? `<div class="la-queued"><span>${icon("wifiOff")} ${S.queue.length} report${S.queue.length > 1 ? "s" : ""} waiting for signal</span><button class="la-link" data-act="flush">Try again</button></div>` : ""}
  <div class="la-card la-wake"><span class="la-dot ${S.wake ? "on" : ""}" id="la-dot"></span>
    <div class="tx"><b>Listening for “Hey Lilikas”</b><small id="la-wake-sub">${supported ? (S.wake ? "Only while this tab is open" : "Off. Turn on to use your voice hands-free") : "Not supported in this browser"}</small></div>
    <label class="switch"><input type="checkbox" id="la-wake" ${S.wake ? "checked" : ""} ${supported ? "" : "disabled"} aria-label="Listen for Hey Lilikas"><i></i></label></div>
  <div class="la-card la-voice"><button class="la-mic" data-act="mic" ${supported ? "" : "disabled"} aria-label="Report by voice">${icon("mic")}</button>
    <div><b>Report by voice</b><small>Say “Hey Lilikas, report flood” or tap the mic. We ask before sending.</small></div></div>
  ${notice ? `<div class="la-msg">${esc(notice)}</div>` : ""}
  <form class="la-type" id="la-form"><input id="la-text" maxlength="500" placeholder="Or type what is happening (Filipino or English)" aria-label="Type your report"><button class="la-btn red">Report</button></form>
  <p class="la-fine">${supported ? `Voice language: <select id="la-lang" aria-label="Voice language"><option value="fil-PH">Filipino / Taglish</option><option value="en-PH">English</option></select>. Voice uses your browser’s speech service; in Chrome and Edge the audio may be processed by Google or Microsoft.` : "Voice is not available in this browser, so type your report instead."}</p>
  <hr class="la-hr">
  <p class="la-loc">${icon("pin")} ${esc(S.ctx && S.ctx.barangay ? `Brgy. ${S.ctx.barangay}, Batangas City` : here().label)} · <button class="la-link" data-act="geo">Use my location</button></p>
  <div id="la-ctx"></div>
  <details class="la-why" id="la-contacts"><summary>${icon("users")} Family contacts (${S.contacts.length})</summary>
    <p>Saved only on this device. After you send a report, you get a button to text each person.</p>
    ${S.contacts.map((c, i) => `<div class="la-con"><span>${esc(c.name)} · ${esc(c.phone)}</span><button class="la-link" data-act="delcon" data-i="${i}">Remove</button></div>`).join("")}
    <form class="la-add" id="la-conform"><input id="la-cn" placeholder="Name" maxlength="40" aria-label="Contact name"><input id="la-cp" placeholder="Mobile number" maxlength="20" inputmode="tel" aria-label="Contact number"><button class="la-btn">Add</button></form></details>`;
  const sel = $("#la-lang"); if (sel) sel.value = S.lang;
  renderCtx();
}

async function showGuides(topic) {
  S.view = "guides";
  body().innerHTML = `${head("close", "home")}<div class="la-skel">Loading guides…</div>`;
  try {
    const p = here();
    const d = await api(`/api/assist/guides?lat=${p.lat}&lon=${p.lon}` + (topic ? `&topic=${encodeURIComponent(topic)}` : ""));
    if (S.view !== "guides") return;
    body().innerHTML = `${head("close", "home")}<h2 class="la-h2">${topic ? esc(topic) + " guides" : "All guides"}</h2>
      <div class="la-chips"><button class="la-chip" data-act="all" data-topic="">All</button>${d.topics.map(t => `<button class="la-chip" data-act="all" data-topic="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      ${d.guides.map((g, i) => guideCard(g, i, true)).join("") || '<p class="la-fine">No guides for this topic.</p>'}
      <p class="la-fine">Always follow instructions from local officials.</p>`;
  } catch { if (S.view === "guides") body().insertAdjacentHTML("beforeend", `<div class="la-msg">Could not load guides.</div>`); }
}

// ---------------------------------------------------------------- voice setup (first time only)
function renderSetup(then) {
  S.view = "setup";
  body().innerHTML = `${head("close", "home")}
    <div class="la-mic" style="margin:6px 0 16px">${icon("mic")}</div>
    <h2 class="la-h2" style="font-size:26px">Report by voice, hands free.</h2>
    <p class="la-fine" style="font-size:13px">Say “Hey Lilikas” while the site is open and tell us what is happening. We always ask before anything is sent.</p>
    <div class="la-card"><div class="la-feat">${icon("grid")} Works while the site is open</div><div class="la-feat">${icon("lock")} Listening stays in your browser</div><div class="la-feat">${icon("wifiOff")} No signal? We send it later</div></div>
    <div class="la-sec">Add a shortcut</div>
    <div class="la-short"><div><b>iPhone</b><small>Shortcuts app: “Hey Siri, Lilikas report” → open this site</small></div><div><b>Android</b><small>Browser menu → Add to Home screen</small></div></div>
    <div style="height:18px"></div>
    <button class="la-btn red block" data-act="setup-ok" style="padding:13px">${icon("mic")} Turn on microphone</button>
    <p class="la-fine" style="text-align:center">Your browser will ask first · <button class="la-link" data-act="home">Maybe later</button></p>`;
  S.afterSetup = then;
}
function needSetup(then) { if (store.get("voiceSetup", false)) return then(); renderSetup(then); }

// ---------------------------------------------------------------- voice
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let wakeRec = null, capRec = null, wakeFails = 0, busy = false;
// "Hey Lilikas" as browsers often write it: "hey lilikas", "hi lili kas", "lilicas", "lily cas", or just "lilikas"
const WAKE_RE = /\b(?:(?:hey|hi|hay|ei|ey|ok|okay)\s+)?(?:li+\s?l[iy]+\s?[ck]+[ae]?[sz]?|lily\s*(?:kas|cas|cus|kaz))\b[,.\s]*(.*)$/;
const norm = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function voiceError(code) {
  return { "not-allowed": "The microphone is blocked. Allow it in your browser settings, or type your report.",
    "service-not-allowed": "Speech recognition is not allowed here. Type your report instead.",
    "no-speech": "I did not hear anything. Tap the mic and try again, or type your report.",
    "audio-capture": "No microphone was found. Type your report instead.",
    "network": "Speech recognition needs internet. Type your report instead; it will be saved if you have no signal.",
    "language-not-supported": "That voice language is not supported here. Try English or type your report." }[code] || "Voice did not work. Type your report instead.";
}
function setWake(on) {
  S.wake = !!on && !!SR; store.set("wake", S.wake);
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
      // act on the finished sentence only, so "Hey Lilikas, report flood …" is not cut off half-way
      if (!e.results[i].isFinal) continue;
      const m = norm(e.results[i][0].transcript).match(WAKE_RE);
      if (m && !fired) { fired = true; wakeFails = 0; try { r.stop(); } catch {} wakeHeard(m[1] || ""); return; }
    }
  };
  r.onerror = e => { if (["not-allowed", "service-not-allowed", "network"].includes(e.error)) { S.msg = voiceError(e.error); setWake(false); if (S.view === "home") renderHome(); } };
  r.onend = () => { wakeRec = null; if (S.wake && !busy && !fired && ++wakeFails < 40) setTimeout(startWake, 400); };
  try { r.start(); wakeRec = r; } catch { wakeRec = null; }
}
function stopWake() { const r = wakeRec; wakeRec = null; if (r) { r.onend = null; try { r.stop(); } catch {} } }
function wakeHeard(rest) { open(); rest = rest.replace(/^(?:please|po)\b\s*/, "").trim(); if (rest.length > 3) reportFrom("Hey Lilikas, " + rest); else listen(); }
function capture() {
  return new Promise((resolve, reject) => {
    const r = new SR(); capRec = r; r.lang = S.lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = "", err = "";
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t + " "; else interim += t; }
      S.interim = (final + interim).trim(); const p = $("#la-interim"); if (p) p.textContent = S.interim ? `“${S.interim}”` : "…";
    };
    r.onerror = e => { err = e.error; };
    r.onend = () => { capRec = null; final.trim() ? resolve(final.trim()) : reject(new Error(err || "no-speech")); };
    try { r.start(); } catch (e) { capRec = null; reject(e); }
  });
}
function renderListening() {
  body().innerHTML = `${head("cancelcap")}
    <div class="la-listen"><div class="la-orb"><button class="la-mic live" data-act="stopcap" aria-label="Stop listening">${icon("mic")}</button></div>
      <h2>Listening</h2><p>Tell us what is happening, for example “report flood”.</p>
      <div class="la-wave" aria-hidden="true">${Array.from({ length: 22 }, (_, i) => `<i style="animation-delay:${(i % 7) * .09}s"></i>`).join("")}</div>
      <div class="la-heard"><small>We heard</small><p id="la-interim">…</p></div>
      <p class="la-fine" style="margin-top:8px">${S.ai && S.ai.ok ? "When you stop talking, Assist translates it and fills in your report." : "When you stop talking, Assist fills in your report."}</p></div>
    <div class="la-chips" style="justify-content:center">${QUICK.map(([l, v]) => `<button class="la-chip" data-act="quick" data-v="${esc(v)}">${esc(l)}</button>`).join("")}</div>
    <button class="la-btn block" data-act="typeinstead">Type instead</button>`;
}
async function listen() {
  if (!SR || busy) return;
  busy = true; stopWake(); S.interim = ""; S.view = "listening"; S.msg = null;
  renderListening(); say("Listening. Say what is happening.");
  try { const text = await capture(); busy = false; if (S.view === "listening") reportFrom(text); }
  catch (e) { busy = false; if (S.view === "listening") { S.msg = voiceError(e.message); renderHome(); } }
  if (!busy) setTimeout(startWake, 300);
}
function abortCapture() { const r = capRec; if (r) { r.onend = null; try { r.abort(); } catch {} } capRec = null; busy = false; }

// ---------------------------------------------------------------- draft → countdown → send
let cdTimer = null;
const TYPE_ONLY = { flood: "flood", landslide: "landslide", earthquake: "earthquake", fire: "fire" };
async function reportFrom(text) {
  text = String(text).trim(); if (!text) return;
  S.view = "drafting"; S.msg = null;
  body().innerHTML = `${head("cancel")}<div class="la-heard"><small>We heard</small><p>“${esc(text)}”</p></div>
    <p class="la-fine" style="margin-top:12px"><span class="la-spin"></span> ${S.ai && S.ai.ok ? "Understanding and translating what you said…" : "Reading what you said…"}</p>${call911(false)}`;
  let d;
  try { d = await api("/api/assist/draft-report", { method: "POST", body: { text } }); }
  catch (e) {
    if (S.view !== "drafting") return;
    if (e.status === 0) d = localDraft(text);                     // no signal: read it with simple on-device rules
    else { S.msg = e.message; return renderHome(); }
  }
  if (S.view !== "drafting") return;
  S.draft = { report_type: d.report_type, water_level: d.water_level, people_count: d.people_count, life_in_danger: d.life_in_danger,
    needs: d.needs || [], quote: d.quote || text, note: "", sending: false,
    language: d.language, translation: d.translation || null, translation_lang: d.translation_lang || "en", engine: d.engine };
  if (d.engine === "model" && S.ai && !S.ai.ok) { S.ai = { ...S.ai, ok: true, error: null }; }
  S.err = null; S.editing = null; S.left = 5;
  S.paused = S.draft.needs.includes("report_type");            // we can't send "other" without asking what it is
  renderDraft(); if (!S.paused) startCountdown();
}
function localDraft(text) {
  const t = text.toLowerCase();
  const type = /guho|landslide/.test(t) ? "landslide" : /lindol|earthquake/.test(t) ? "earthquake" : /sunog|fire/.test(t) ? "fire" : /baha|flood|tubig/.test(t) ? "flood" : null;
  const lvl = [["over_head", /ulo|leeg|lampas/], ["chest", /dibdib|chest/], ["waist", /baywang|bewang|waist/], ["thigh", /hita|thigh/], ["knee", /tuhod|knee/], ["ankle", /bukong|ankle|paa/]].find(([, r]) => r.test(t));
  const danger = /nalulunod|drown|trapped|naipit|rescue|saklolo|tulong|help me|sugatan|injured|bleeding/.test(t);
  return { report_type: type || "other", water_level: type === "flood" ? (lvl ? lvl[0] : "unknown") : null, people_count: null,
    life_in_danger: danger, needs: type ? ["people_count"] : ["report_type", "people_count"], quote: text };
}
const sendTo = () => { const b = S.ctx && S.ctx.barangay, n = S.contacts.length;
  return `${b ? `Barangay ${b}` : "Batangas City responders"}${n ? ` and ${n} family contact${n > 1 ? "s" : ""}` : ""}`; };
function subtitle() {
  const d = S.draft;
  if (d.sending) return "Sending…";
  if (S.err) return esc(S.err);
  if (S.paused) return d.needs.includes("report_type") ? "Choose what kind of report this is, then tap Send now." : "Paused. Check the details, then tap Send now.";
  return `To ${esc(sendTo())} in ${S.left} second${S.left === 1 ? "" : "s"}.`;
}
function ringHtml() {
  const C = 2 * Math.PI * 31, off = C * (1 - (S.paused ? 1 : S.left / 5));
  return `<div class="la-ring" aria-hidden="true"><svg width="70" height="70"><circle cx="35" cy="35" r="31" fill="none" stroke="#ffffff22" stroke-width="5"/>
    <circle id="la-arc" cx="35" cy="35" r="31" fill="none" stroke="#ff5a5a" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset 1s linear"/></svg>
    <div class="num" id="la-num">${S.paused ? "Ⅱ" : S.left}</div></div>`;
}
function rowHtml(key, ic, label, value, miss) {
  const d = S.draft;
  if (S.editing === key) {
    let ctl = "";
    if (key === "report_type") ctl = `<select id="la-ed">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === d.report_type ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    if (key === "water_level") ctl = `<select id="la-ed">${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${k === (d.water_level || "unknown") ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    if (key === "location") ctl = `<input id="la-ed" maxlength="160" placeholder="Landmark or street (optional)" value="${esc(d.note)}">`;
    if (key === "people_count") ctl = `<input id="la-ed" type="number" min="1" max="500" value="${d.people_count || ""}" placeholder="How many people?">`;
    return `<div class="la-row">${icon(ic)}<div><small>${label}</small>${ctl}</div><button class="ed" data-act="done" data-k="${key}">Done</button></div>`;
  }
  return `<div class="la-row">${icon(ic)}<div><small>${label}</small><b class="${miss ? "miss" : ""}">${esc(value)}</b></div>${key ? `<button class="ed" data-act="edit" data-k="${key}">${miss ? "Add" : "Edit"}</button>` : "<span></span>"}</div>`;
}
function renderDraft() {
  S.view = "draft"; const d = S.draft, brgy = S.ctx && S.ctx.barangay;
  body().innerHTML = `${head("cancel")}
  ${d.life_in_danger ? `${call911(true, "This sounds serious. Call 911 now.")}<div style="height:12px"></div>` : ""}
  <div class="la-send">${ringHtml()}<div><b>Sending your ${esc(TYPE_ONLY[d.report_type] || "hazard")} report</b><small id="la-sub">${subtitle()}</small></div></div>
  <div class="la-btns"><button class="la-btn white" data-act="cancel">Cancel</button><button class="la-btn" data-act="sendnow" ${d.sending ? "disabled" : ""}>Send now ${icon("arrowR")}</button></div>
  <div class="la-sec">Your report</div>
  <div class="la-rows">
    ${rowHtml("report_type", "waves", "Report", TYPE_LABEL[d.report_type] || "Other", d.needs.includes("report_type"))}
    ${d.report_type === "flood" ? rowHtml("water_level", "info", "Water level", LEVEL_LABEL[d.water_level || "unknown"], (d.water_level || "unknown") === "unknown") : ""}
    ${rowHtml("location", "pin", "Location", (brgy ? `Brgy. ${brgy}, Batangas City` : here().label) + (d.note ? ` · ${d.note}` : ""), false)}
    ${rowHtml("people_count", "users", "People with you", d.people_count ? String(d.people_count) : "Not stated", !d.people_count)}
    ${rowHtml("", "bell", "Send to", sendTo(), false)}
  </div>
  <p class="la-quote">From what you said: “${esc(d.quote)}”</p>
  ${trBlock(d)}
  ${d.life_in_danger ? "" : call911(false)}`;
  const ed = $("#la-ed"); if (ed) ed.focus();
}
const LANG_NAME = { en: "English", fil: "Filipino" };
function trBlock(d) {
  if (d.translation) return `<div class="la-tr"><small>${icon("globe")} In ${LANG_NAME[d.translation_lang] || "English"} · AI translation</small><p>${esc(d.translation)}</p></div>`;
  if (d.language === "en") return "";
  return `<div class="la-tr off"><small>${icon("globe")} Translation unavailable</small><p>${S.ai && !S.ai.ok ? "The AI is not connected, so this was read with simple rules and not translated." : "The AI did not return a translation this time."}</p></div>`;
}
function startCountdown() {
  clearInterval(cdTimer); S.left = 5; say("Sending your report in 5 seconds. Press Cancel to stop."); tick();
  cdTimer = setInterval(() => {
    if (S.paused || S.view !== "draft") { clearInterval(cdTimer); return; }
    S.left -= 1; tick(); if (S.left <= 0) { clearInterval(cdTimer); sendReport(); }
  }, 1000);
}
function tick() {
  const n = $("#la-num"), a = $("#la-arc"), s = $("#la-sub");
  if (n) n.textContent = Math.max(S.left, 0); if (s) s.innerHTML = subtitle();
  if (a) { const C = 2 * Math.PI * 31; requestAnimationFrame(() => a.setAttribute("stroke-dashoffset", C * (1 - Math.max(S.left, 0) / 5))); }
}
function pause() { if (S.paused) return; S.paused = true; clearInterval(cdTimer); say("Paused."); }
function payloadOf(d) {
  const p = here();
  return { report_type: d.report_type, water_level: d.report_type === "flood" ? (d.water_level || "unknown") : null,
    people_count: d.people_count || null, lat: p.lat, lon: p.lon, barangay: (S.ctx && S.ctx.barangay) || "", location_note: d.note,
    quote: d.quote, translation: d.translation || null, life_in_danger: d.life_in_danger, family_contacts: S.contacts.length,
    client_id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
}
async function sendReport() {
  const d = S.draft; if (!d || d.sending) return;
  clearInterval(cdTimer); d.sending = true; S.err = null; S.paused = false; renderDraft();
  const payload = d.payload || (d.payload = payloadOf(d));
  try {
    const j = await api("/api/assist/report", { method: "POST", body: payload });
    S.sent = { ...j, payload }; renderSent();
  } catch (e) {
    if (e.status === 0) { queue(payload); S.sent = { payload, offline: true }; return renderOffline(); }
    d.sending = false; S.err = e.message + " Tap Send now to try again."; S.paused = true; renderDraft();
  }
}
function smsLink(c, p) {
  const lvl = p.water_level && p.water_level !== "unknown" ? `, ${LEVEL_LABEL[p.water_level].toLowerCase()}` : "";
  const ppl = p.people_count ? `, ${p.people_count} people` : "";
  const msg = `${TYPE_LABEL[p.report_type]} report from Lilikas Na Ga${lvl}${ppl}. Near ${p.barangay ? "Brgy. " + p.barangay : "Batangas City"}. Map: https://www.google.com/maps?q=${p.lat},${p.lon}`;
  return `sms:${encodeURIComponent(c.phone)}?&body=${encodeURIComponent(msg)}`;
}
function family(p) { return S.contacts.length ? `<div class="la-sec">Let your family know</div>${S.contacts.map(c => `<a class="la-btn block" style="margin-bottom:8px;text-decoration:none" href="${smsLink(c, p)}">${icon("msg")} Text ${esc(c.name)}</a>`).join("")}` : ""; }
function renderSent() {
  S.view = "sent"; const s = S.sent, p = s.payload, when = LNG.fmtTime(s.created || new Date().toISOString());
  body().innerHTML = `${head("home")}
    <div class="la-ok"><span class="b">${icon("check")}</span><div><b>Report sent</b><small>${esc(sendTo())} · ${when} · Ref ${esc(s.id || "")}</small></div></div>
    ${p.translation ? `<div class="la-tr"><small>${icon("globe")} What you reported, translated</small><p>${esc(p.translation)}</p></div>` : ""}
    <span class="la-tag">Picked for your situation</span><h2 class="la-h2">Do this now</h2>
    <div class="la-chips">${(s.chips || []).map(x => `<span class="la-chip">${esc(x)}</span>`).join("")}</div>
    ${(s.guides || []).map((g, i) => guideCard(g, i, false)).join("")}
    ${whyBox((s.evidence || []).map(t => ({ kind: "report", text: t })), s.engine, true)}
    ${family(p)}${call911(p.life_in_danger, "Call 911")}
    <div style="height:10px"></div><button class="la-btn block" data-act="home">Done</button>`;
  say("Report sent.");
}
function renderOffline() {
  S.view = "offline"; const p = S.sent.payload, g = offlineGuides(p.report_type);
  body().innerHTML = `${head("home")}
    <div class="la-wait"><span class="b">${icon("clock")}</span><div><b>Saved on this device</b><small>No signal. We will send it as soon as you are back online.</small></div></div>
    <div class="la-queued"><span>${esc(TYPE_LABEL[p.report_type])} report · waiting for signal</span><button class="la-link" data-act="flush">Try again</button></div>
    <span class="la-tag">Works without signal</span><h2 class="la-h2">Do this now</h2>
    <p class="la-fine" style="margin-top:-4px">Picked from guides saved in your browser.</p>
    ${g.length ? g.map((x, i) => guideCard(x, i, false)).join("") : `<div class="la-msg">No guides are saved on this device yet. Open Assist once while online to save them.</div>`}
    ${family(p)}${call911(true, "Call 911")}`;
  say("No signal. Report saved on this device.");
}
function cancelDraft() { clearInterval(cdTimer); S.draft = null; S.err = null; renderHome(); say("Report cancelled."); }

// ---------------------------------------------------------------- offline outbox
function queue(payload) { S.queue = S.queue.filter(q => q.client_id !== payload.client_id); S.queue.push({ ...payload, queued_at: new Date().toISOString() }); store.set("outbox", S.queue); }
let flushing = false;
async function flush(manual) {
  if (flushing || !S.queue.length) return; flushing = true;
  let sent = 0;
  for (const q of [...S.queue]) {
    try { await api("/api/assist/report", { method: "POST", body: q }); S.queue = S.queue.filter(x => x.client_id !== q.client_id); store.set("outbox", S.queue); sent++; }
    catch (e) { if (e.status === 0) break; S.queue = S.queue.filter(x => x.client_id !== q.client_id); store.set("outbox", S.queue); }
  }
  flushing = false;
  if (sent) LNG.toast(`${sent} saved report${sent > 1 ? "s were" : " was"} sent.`);
  else if (manual) LNG.toast("Still no connection. We will keep trying.");
  if (S.open && (S.view === "home" || S.view === "offline")) { if (!S.queue.length && S.view === "offline") renderHome(); else if (S.view === "home") renderHome(); }
}
window.addEventListener("online", () => flush(false));
setTimeout(() => flush(false), 1500);

// ---------------------------------------------------------------- events
root.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  if (act === "close") return close();
  if (act === "home") return renderHome();
  if (act === "mic") return needSetup(listen);
  if (act === "setup-ok") { store.set("voiceSetup", true); const f = S.afterSetup || listen; S.afterSetup = null; return f(); }
  if (act === "stopcap") { try { capRec && capRec.stop(); } catch {} return; }
  if (act === "cancelcap") { abortCapture(); renderHome(); setTimeout(startWake, 300); return; }
  if (act === "quick") { abortCapture(); return reportFrom(el.dataset.v); }
  if (act === "typeinstead") { abortCapture(); renderHome(); setTimeout(() => { const i = $("#la-text"); i && i.focus(); }, 30); return; }
  if (act === "geo") { location.href = "location.html?next=" + encodeURIComponent(location.pathname.split("/").pop()); return; }
  if (act === "retry") return loadCtx(false);
  if (act === "flush") return flush(true);
  if (act === "aicheck") { S.ai = null; $$chips(); return checkAI(true); }
  if (act === "card") { S.openCard = S.openCard === el.dataset.id ? null : el.dataset.id; if (S.view === "home") renderCtx(); return; }
  if (act === "all") return showGuides(el.dataset.topic);
  if (act === "delcon") { S.contacts.splice(+el.dataset.i, 1); store.set("contacts", S.contacts); renderHome(); $("#la-contacts").open = true; return; }
  if (act === "cancel") return cancelDraft();
  if (act === "sendnow") return sendReport();
  if (act === "edit") { pause(); S.editing = el.dataset.k; return renderDraft(); }
  if (act === "done") {
    const d = S.draft, k = el.dataset.k, v = ($("#la-ed") || {}).value;
    if (k === "report_type") { d.report_type = v; d.needs = d.needs.filter(x => x !== "report_type"); d.water_level = v === "flood" ? (d.water_level || "unknown") : null; }
    if (k === "water_level") d.water_level = v;
    if (k === "location") d.note = (v || "").trim();
    if (k === "people_count") d.people_count = Math.max(1, Math.min(500, parseInt(v, 10) || 0)) || null;
    d.payload = null; S.editing = null; S.paused = true; return renderDraft();
  }
});
root.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "la-form") { const t = $("#la-text").value.trim(); if (t) reportFrom(t); }
  if (e.target.id === "la-conform") {
    const name = $("#la-cn").value.trim(), phone = $("#la-cp").value.trim();
    if (!name || !/^\+?[\d\s-]{7,15}$/.test(phone)) { S.msg = "Enter a name and a mobile number (for example 0917 123 4567)."; return renderHome(); }
    S.contacts.push({ name: name.slice(0, 40), phone }); store.set("contacts", S.contacts); renderHome(); $("#la-contacts").open = true;
  }
});
root.addEventListener("change", e => {
  if (e.target.id === "la-wake") { if (e.target.checked && !store.get("voiceSetup", false)) { e.target.checked = false; return renderSetup(() => { renderHome(); setWake(true); }); } setWake(e.target.checked); }
  if (e.target.id === "la-lang") { S.lang = e.target.value; store.set("voiceLang", S.lang); if (S.wake) { stopWake(); startWake(); } }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || !S.open) return;
  if (S.view === "draft") cancelDraft(); else if (S.view === "listening") { abortCapture(); renderHome(); } else close();
});
document.addEventListener("click", e => { if (e.target.closest("[data-assist-open]")) { e.preventDefault(); open(); } });
backdrop.addEventListener("click", () => { if (S.view !== "draft") close(); });

// ---------------------------------------------------------------- open / close
let pollTimer = null, lastLoc = "";
function open(view) {
  if (!S.open) { S.open = true; root.classList.add("on"); backdrop.classList.add("on"); }
  if (view === "mic") return needSetup(listen);
  if (S.view === "home" || !S.draft) renderHome();
  checkAI(false);
  const key = JSON.stringify(here()); if (key !== lastLoc || !S.ctx) { lastLoc = key; loadCtx(false); }
  clearInterval(pollTimer); pollTimer = setInterval(() => { if (S.open && S.view === "home") loadCtx(true); }, 60000);
  setTimeout(() => { const x = root.querySelector(".la-x"); x && x.focus(); }, 260);
}
function close() {
  S.open = false; root.classList.remove("on"); backdrop.classList.remove("on"); clearInterval(pollTimer);
  if (S.view === "draft") { clearInterval(cdTimer); S.draft = null; }      // a pending report is cancelled when the panel closes
  abortCapture(); S.view = "home";
}
function setLocation() { S.ctx = null; if (S.open) loadCtx(false); }
LNG.on("location", setLocation);
window.LilikasAssist = { open, close, setLocation };
if (SR && store.get("wake", false)) { S.wake = true; setTimeout(startWake, 600); }
if (new URLSearchParams(location.search).get("assist")) setTimeout(() => open(new URLSearchParams(location.search).get("assist")), 300);
})();
