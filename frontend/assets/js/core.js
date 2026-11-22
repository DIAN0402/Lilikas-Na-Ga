/* Shared helpers for every page: API calls, saved state, icons, language, small UI bits.
   Everything hangs off one global, window.LNG, so pages stay plain <script> files with no build step. */
(() => {
"use strict";
const CFG = window.LILIKAS_CONFIG || {};

// ---------------------------------------------------------------- storage (fails quietly in private mode)
const store = {
  get(k, d) { try { const v = localStorage.getItem("lilikas." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lilikas." + k, JSON.stringify(v)); } catch { /* not remembered */ } },
  del(k) { try { localStorage.removeItem("lilikas." + k); } catch { /* ignore */ } },
};

// ?api=http://host:port overrides the backend address and is remembered on this device
const qsApi = new URLSearchParams(location.search).get("api");
if (qsApi && /^https?:\/\//.test(qsApi)) store.set("api", qsApi.replace(/\/$/, ""));
const API_BASE = (store.get("api", null) || CFG.API_BASE || "").replace(/\/$/, "");

// ---------------------------------------------------------------- API
class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
async function api(path, { method = "GET", body, timeout = 20000, admin } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const s = session();
  if (s) headers.Authorization = "Bearer " + s.token;
  if (admin) headers["X-Admin-Key"] = admin;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    throw new ApiError(navigator.onLine === false ? "You are offline." : "Can't reach the Lilikas server. Check that the backend is running.", 0);
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  return data;
}
const apiUrl = p => API_BASE + p;

// ---------------------------------------------------------------- account (optional)
function session() {
  const s = store.get("session", null);
  if (!s) return null;
  if (s.expires && s.expires < Date.now()) { store.del("session"); return null; }
  return s;
}
function setSession(token, expiresIn, user) { store.set("session", { token, expires: Date.now() + expiresIn * 1000, user }); emit("user"); }
function user() { const s = session(); return s ? s.user : null; }
function setUser(u) { const s = session(); if (s) { s.user = u; store.set("session", s); emit("user"); } }
async function logout() { try { await api("/api/auth/logout", { method: "POST" }); } catch { /* already gone */ } store.del("session"); emit("user"); }

// ---------------------------------------------------------------- location: always one current place
function loc() { return store.get("loc", null) || { ...CFG.DEFAULT_LOCATION }; }
function setLoc(l) {
  const v = { lat: +(+l.lat).toFixed(5), lon: +(+l.lon).toFixed(5), label: l.label || "Selected place", source: l.source || "manual", at: Date.now() };
  if (!isFinite(v.lat) || !isFinite(v.lon)) return;
  store.set("loc", v); emit("location", v);
  const u = user();
  if (u) api("/api/me/preferences", { method: "PUT", body: { lat: v.lat, lon: v.lon, barangay: v.label } }).then(d => setUser(d.user)).catch(() => {});
}
function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser cannot share your location."));
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.code === 1 ? "Location permission was declined. You can choose your barangay instead." : "Could not get your location. Try again or choose your barangay.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
async function locate(q) { return api("/api/locate?q=" + encodeURIComponent(q)); }

// ---------------------------------------------------------------- events
function emit(name, detail) { window.dispatchEvent(new CustomEvent("lilikas:" + name, { detail })); }
function on(name, fn) { window.addEventListener("lilikas:" + name, e => fn(e.detail)); }

// ---------------------------------------------------------------- language (EN / Filipino)
const FIL = {
  "Overview": "Pangkalahatan", "Hazard map & evacuation": "Mapa ng panganib at paglikas", "Alerts": "Mga alerto",
  "Preparedness & help": "Paghahanda at tulong", "Lilikas Assist": "Lilikas Assist", "Need urgent help?": "Kailangan ng agarang tulong?",
  "For emergencies, call 911.": "Sa emergency, tumawag sa 911.", "Emergency contacts": "Mga emergency contact",
  "Use my location": "Gamitin ang lokasyon ko", "Change location": "Palitan ang lokasyon", "Hey Lilikas": "Hey Lilikas",
  "Say it or tap to report": "Sabihin o i-tap para mag-ulat", "Data & methodology": "Datos at pamamaraan", "Privacy": "Privacy",
  "Log in": "Mag-log in", "Sign up": "Mag-sign up", "Log out": "Mag-log out", "Explore as guest": "Tumingin bilang bisita",
  "Map": "Mapa", "Assist": "Assist", "Help": "Tulong", "Home": "Home", "Hazard map": "Mapa ng panganib", "Preparedness": "Paghahanda",
  "Magandang araw": "Magandang araw", "Rainfall outlook": "Tantiya ng ulan", "Your area at a glance": "Ang lugar mo sa isang tingin",
  "Picked for you": "Pinili para sa iyo", "Why this risk level?": "Bakit ganito ang antas?", "Official advice comes first": "Opisyal na payo ang mauna",
  "View map & evacuation": "Tingnan ang mapa at paglikas", "No official evacuation order": "Walang opisyal na utos ng paglikas",
  "Compare evacuation options": "Ihambing ang mga evacuation center", "Alerts for your area": "Mga alerto para sa lugar mo",
  "Preparedness & emergency help": "Paghahanda at emergency na tulong", "Your household checklist": "Checklist ng inyong sambahayan",
  "Share your location safely": "Ibahagi nang ligtas ang lokasyon mo", "Understand your risk": "Unawain ang panganib mo",
  "Call 911": "Tumawag sa 911", "What to do": "Ano ang gagawin", "Notification preferences": "Mga setting ng abiso",
};
function lang() { return store.get("lang", "en"); }
function setLang(l) { store.set("lang", l === "fil" ? "fil" : "en"); applyI18n(); emit("lang", lang()); }
function t(s) { return lang() === "fil" && FIL[s] ? FIL[s] : s; }
function applyI18n(root = document) {
  document.documentElement.lang = lang() === "fil" ? "fil" : "en";
  root.querySelectorAll("[data-i18n]").forEach(el => {
    if (!el.dataset.i18nSrc) el.dataset.i18nSrc = el.textContent.trim();
    el.textContent = t(el.dataset.i18nSrc);
  });
}

// ---------------------------------------------------------------- icons (Lucide-style strokes)
const P = {
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  map: '<path d="M14.1 5.6a2 2 0 0 0 1.8 0l3.7-1.9A1 1 0 0 1 21 4.6v12.8a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.9A1 1 0 0 1 3 19.4V6.6a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0z"/><path d="M15 5.8v15M9 3.2v15"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  sparkle: '<path d="M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18.5l-1.9-5.9L4 10.7l6.1-1.9z"/>',
  pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
  arrowR: '<path d="M5 12h14M12 5l7 7-7 7"/>', arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>', ext: '<path d="M7 17 17 7M8 7h9v9"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2z"/>',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8a2.5 2.5 0 1 1 2 4H2M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  volcano: '<path d="m2 21 7-12h6l7 12z"/><path d="M12 9V3M9 5l3 2 3-2"/>',
  quake: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  home: '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  nav: '<path d="m3 11 19-9-9 19-2-8z"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  wifiOff: '<path d="M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5c4-.4 8.1.9 11.3 3.8M16.9 11.3a10 10 0 0 1 2.2 1.7M5 13a10 10 0 0 1 5.2-2.8M2 2l20 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  phoneMobile: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  list: '<path d="M11 6h10M11 12h10M11 18h10M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>', car: '<path d="M5 17h14M6 17v2M18 17v2M3 13l2-6a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 6v4H3z"/><circle cx="7.5" cy="13.5" r=".5"/><circle cx="16.5" cy="13.5" r=".5"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 3M10 8l-1 6"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  water: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
  firstaid: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M12 10v7M8.5 13.5h7"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>',
  flag: '<path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.3 16a2 2 0 0 1 3-2.7L8 15"/>',
};
function icon(name, cls = "") {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach(el => { el.outerHTML = icon(el.dataset.icon, el.className); });
}

// ---------------------------------------------------------------- small UI helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
function toast(msg, ms = 4000) {
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}
function fmtTime(iso, withDate) {
  if (!iso) return "";
  const d = new Date(iso);
  const opts = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" };
  if (withDate) Object.assign(opts, { day: "numeric", month: "short" });
  return d.toLocaleString("en-GB", opts);
}
function greeting() {
  const h = +new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Manila" });
  return h < 12 ? "Magandang umaga" : h < 18 ? "Magandang araw" : "Magandang gabi";
}
function brandHtml(kind = "horizontal", dark = true) {
  // Logo files exported from Figma go in assets/img/. If they are missing, a text badge is shown instead.
  return `<span class="brand-wrap"><img class="brand-img ${kind}" src="${assetBase()}assets/img/lilikas-logo-${kind}.svg" alt="Lilikas na ga?"
    onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'badge-text',textContent:'Lilikas na ga?'}))"></span>`;
}
function assetBase() { return ""; }
function pct(n, d) { return d ? Math.max(0, Math.min(100, Math.round(n / d * 100))) : 0; }

// offline support for the website's own files (only over http(s), not file://)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

window.LNG = { CFG, API_BASE, api, apiUrl, ApiError, store, session, setSession, user, setUser, logout,
  loc, setLoc, deviceLocation, locate, on, emit, lang, setLang, t, applyI18n, icon, hydrateIcons,
  $, $$, esc, toast, fmtTime, greeting, brandHtml, pct };
})();
