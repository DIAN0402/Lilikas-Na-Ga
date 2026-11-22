/* App frame shared by every in-app screen: dark sidebar, top bar (location, language, alerts, account),
   mobile top bar + tab bar, and the floating "Hey Lilikas" button. A page only provides <main id="page" data-nav="...">. */
(() => {
"use strict";
const { $, $$, esc, icon, t } = LNG;
const page = $("#page");
const navKey = page.dataset.nav || "overview";

const NAV = [
  ["overview", "overview.html", "grid", "Overview"],
  ["map", "map.html", "map", "Hazard map & evacuation"],
  ["alerts", "alerts.html", "bell", "Alerts"],
  ["prep", "preparedness.html", "shield", "Preparedness & help"],
];

function sidebar() {
  return `<aside class="side" aria-label="Main">
    <a class="logo" href="index.html" aria-label="Lilikas na ga? home">${LNG.brandHtml("stacked")}</a>
    <nav>${NAV.map(([k, href, ic, label]) => `<a href="${href}" class="${k === navKey ? "on" : ""}" ${k === navKey ? 'aria-current="page"' : ""}>${icon(ic)}<span data-i18n>${label}</span>${k === "alerts" ? '<span class="dot" id="nav-alert-dot" hidden></span>' : ""}</a>`).join("")}
      <a href="#" data-assist-open>${icon("sparkle")}<span data-i18n>Lilikas Assist</span><span class="ai">AI</span></a></nav>
    <div class="city">${icon("pin")} Batangas City</div>
    <div class="help"><b>${icon("phone")}<span data-i18n>Need urgent help?</span></b><span data-i18n>For emergencies, call 911.</span>
      <a class="btn primary" href="preparedness.html#contacts" data-i18n>Emergency contacts</a></div>
  </aside>`;
}

function topbar() {
  const u = LNG.user(), l = LNG.loc();
  return `<header class="topbar">
    <div style="position:relative">
      <button class="loc-btn" id="loc-btn" aria-haspopup="dialog" aria-expanded="false">${icon("pin")}<span id="loc-label">${esc(l.label)}</span>${icon("down")}</button>
      <div class="locpop" id="locpop" role="dialog" aria-label="Choose your area">
        <form id="loc-form"><input class="input" id="loc-q" placeholder="Barangay, place or 13.7565, 121.0583" aria-label="Search a barangay or place"><button class="btn primary">${icon("arrowR")}<span class="sr-only">Search</span></button></form>
        <p class="hint">Pick your barangay or a landmark in Batangas City. It is saved on this device only.</p>
        <div class="opts">
          <button type="button" data-locate>${icon("locate")} Use my device location</button>
          <button type="button" data-default>${icon("home")} Batangas City centre</button>
        </div>
        <p class="error" id="loc-err" hidden></p>
      </div>
    </div>
    <span class="grow"></span>
    <button class="link" data-locate>${icon("locate")}<span data-i18n>Use my location</span></button>
    <div class="lang" role="group" aria-label="Language"><button data-lang="en">EN</button>/<button data-lang="fil">Filipino</button></div>
    <a class="iconbtn" href="alerts.html" aria-label="Alerts">${icon("bell")}<span class="ping" id="bell-ping" hidden></span></a>
    <div class="who">${u
      ? `<button id="who-btn" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${esc(u.initials)}</span><span class="who-name">${esc(u.first_name)} ${esc((u.name.split(" ")[1] || "")[0] || "")}${u.name.split(" ")[1] ? "." : ""}</span>${icon("down")}</button>
         <div class="menu" id="who-menu" role="menu"><a href="alert-preferences.html" role="menuitem">${icon("sliders")} Alert preferences</a><button data-logout role="menuitem">${icon("logout")} <span data-i18n>Log out</span></button></div>`
      : `<a class="btn sm" href="login.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}" data-i18n>Log in</a>`}</div>
  </header>`;
}

function mobileTop() {
  return `<div class="mtop"><a href="index.html">${LNG.brandHtml("horizontal")}</a>
    <select aria-label="Language" id="m-lang"><option value="en">EN</option><option value="fil">FIL</option></select></div>`;
}
function tabbar() {
  const tab = (k, href, ic, label) => `<a href="${href}" class="${k === navKey ? "on" : ""}">${icon(ic)}<span data-i18n>${label}</span></a>`;
  return `<nav class="tabbar" aria-label="Main">${tab("overview", "overview.html", "grid", "Overview")}${tab("map", "map.html", "map", "Map")}
    <button class="mid" data-assist-open><span class="ib">${icon("mic")}</span><span data-i18n>Assist</span></button>
    ${tab("alerts", "alerts.html", "bell", "Alerts")}${tab("prep", "preparedness.html", "shield", "Help")}</nav>`;
}
function hey() {
  return `<button class="hey" data-assist-open aria-label="Open Lilikas Assist"><span class="mic">${icon("mic")}</span><span><b data-i18n>Hey Lilikas</b><small data-i18n>Say it or tap to report</small></span></button>`;
}

// ---------------------------------------------------------------- build
const shell = document.createElement("div");
shell.className = "shell";
shell.innerHTML = sidebar() + `<div class="main">${mobileTop()}${topbar()}</div>`;
page.replaceWith(shell);
$(".main", shell).appendChild(page);
$(".main", shell).insertAdjacentHTML("beforeend", `<footer class="foot"><a href="methodology.html" data-i18n>Data & methodology</a> · <a href="methodology.html#privacy" data-i18n>Privacy</a></footer>`);
document.body.insertAdjacentHTML("beforeend", tabbar() + hey());
document.body.classList.add("app");

// ---------------------------------------------------------------- behaviour
function syncLang() {
  $$("[data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === LNG.lang())));
  const m = $("#m-lang"); if (m) m.value = LNG.lang();
  LNG.applyI18n();
}
$$("[data-lang]").forEach(b => b.onclick = () => { LNG.setLang(b.dataset.lang); syncLang(); });
$("#m-lang").onchange = e => { LNG.setLang(e.target.value); syncLang(); };
syncLang();

const pop = $("#locpop"), locBtn = $("#loc-btn");
function togglePop(open) { pop.classList.toggle("open", open); locBtn.setAttribute("aria-expanded", String(open)); if (open) setTimeout(() => $("#loc-q").focus(), 30); }
locBtn.onclick = e => { e.stopPropagation(); togglePop(!pop.classList.contains("open")); };
pop.onclick = e => e.stopPropagation();
document.addEventListener("click", () => { togglePop(false); const m = $("#who-menu"); if (m) m.classList.remove("open"); });
const err = msg => { const el = $("#loc-err"); el.hidden = !msg; el.textContent = msg || ""; };
$("#loc-form").onsubmit = async e => {
  e.preventDefault(); const q = $("#loc-q").value.trim(); if (!q) return; err("");
  try { const d = await LNG.locate(q); LNG.setLoc({ lat: d.lat, lon: d.lon, label: d.label.split(",").slice(0, 2).join(","), source: "manual" }); togglePop(false); }
  catch (ex) { err(ex.status === 404 ? "Place not found. Try the barangay name with “Batangas City”." : ex.message); }
};
$("[data-default]", pop).onclick = () => { LNG.setLoc(LNG.CFG.DEFAULT_LOCATION); togglePop(false); };

// "Use my location" goes through the consent screen the first time (Figma: Location access consent · Desktop)
async function useDevice() {
  if (!LNG.store.get("locConsent", false)) { location.href = "location.html?next=" + encodeURIComponent(location.pathname.split("/").pop()); return; }
  try {
    const p = await LNG.deviceLocation();
    let label = "Your device location";
    try { const c = await LNG.api(`/api/assist/context?lat=${p.lat}&lon=${p.lon}`); if (c.barangay) label = `Brgy. ${c.barangay}, Batangas City`; } catch { /* keep generic */ }
    LNG.setLoc({ lat: p.lat, lon: p.lon, label, source: "device" }); togglePop(false); LNG.toast("Location updated.");
  } catch (ex) { err(ex.message); LNG.toast(ex.message); }
}
$$("[data-locate]").forEach(b => b.onclick = e => { e.stopPropagation(); useDevice(); });
LNG.on("location", l => { $("#loc-label").textContent = l.label; });

const who = $("#who-btn");
if (who) who.onclick = e => { e.stopPropagation(); const m = $("#who-menu"); m.classList.toggle("open"); who.setAttribute("aria-expanded", String(m.classList.contains("open"))); };
const lo = $("[data-logout]");
if (lo) lo.onclick = async () => { await LNG.logout(); location.href = "index.html"; };

// red dot on the bell when an active HIGH alert is near
LNG.api("/api/feed").then(d => {
  const hot = (d.alerts || []).some(a => !a.expired && a.near !== false && a.level === "high");
  $("#bell-ping").hidden = !hot; const dot = $("#nav-alert-dot"); if (dot) dot.hidden = !hot;
}).catch(() => {});

// Browser notifications for new alerts while the site is open (turned on from Alert preferences)
const TOPIC_OF = { rain_flood: "rain_flood", storm: "storm", earthquake: "earthquake", local: "local" };
async function checkNotify() {
  const prefs = LNG.store.get("alertPrefs", {});
  if (!prefs.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const d = await LNG.api("/api/feed"), seen = new Set(LNG.store.get("notified", []));
    (d.alerts || []).filter(a => !a.expired && a.near !== false && (prefs.topics || []).includes(TOPIC_OF[a.category]) && !seen.has(a.id))
      .slice(0, 3).forEach(a => { new Notification(`${a.level === "high" ? "HIGH · " : ""}${a.title}`, { body: `${a.source} · ${a.area}`, tag: a.id }); seen.add(a.id); });
    LNG.store.set("notified", [...seen].slice(-200));
  } catch { /* try again later */ }
}
checkNotify(); setInterval(checkNotify, 180000);

// Refresh the signed-in user's details once per page (session may have expired on the server after a restart)
if (LNG.user()) LNG.api("/api/auth/me").then(d => LNG.setUser(d.user)).catch(e => { if (e.status === 401) { LNG.store.del("session"); } });

LNG.hydrateIcons(document);
})();
