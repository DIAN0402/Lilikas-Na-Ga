/* Alerts for your area (Figma: Alerts · Desktop) */
(() => {
"use strict";
const { $, $$, esc, icon, api, fmtTime } = LNG;
const TABS = [["all", "All"], ["rain", "Rain & flood"], ["quake", "Earthquake"], ["local", "Local advice"], ["past", "Past alerts"]];
const IN = { all: a => !a.expired, rain: a => !a.expired && (a.category === "rain_flood" || a.category === "storm"), quake: a => !a.expired && a.category === "earthquake",
  local: a => !a.expired && a.category === "local", past: a => a.expired };
const LEVEL = a => a.expired ? ["expired", "Expired", "clock"] : a.level === "high" ? ["high", a.level_label || "High · Prepare", "alert"] : ["advisory", "Advisory", "info"];
let feed = [], tab = "all", selId = decodeURIComponent(location.hash.slice(1)) || null;

function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([k, label]) => {
    const n = feed.filter(IN[k]).length;
    return `<button class="fchip" role="tab" aria-selected="${k === tab}" aria-pressed="${k === tab}" data-tab="${k}">${label}${k === "all" ? ` · ${n}` : ""}</button>`;
  }).join("");
  $$("#tabs [data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; selId = null; render(); });
}
function render() {
  renderTabs();
  const list = feed.filter(IN[tab]);
  if (!list.find(a => a.id === selId)) selId = list[0] ? list[0].id : null;
  $("#list").innerHTML = list.map(a => {
    const [cls, lab, ic] = LEVEL(a);
    return `<button class="card aitem ${a.id === selId ? "sel" : ""} ${a.expired ? "exp" : ""}" data-id="${esc(a.id)}">
      <span class="badge ${cls}">${icon(ic)} ${esc(lab)}</span><br><span class="t">${esc(a.title)}</span>
      <div class="src">${esc(a.source)}</div><div class="area">${esc(a.area)}</div>
      <div class="when">Issued ${fmtTime(a.issued, true)} · ${a.expired ? "Expired" : "Expires"} ${fmtTime(a.expires, true)}</div>${!a.expired && a.level === "high" ? '<span class="live"></span>' : ""}</button>`;
  }).join("") || `<div class="card pad"><b>No ${tab === "past" ? "past" : "active"} alerts here.</b><p class="muted serif" style="margin:6px 0 0">${tab === "past" ? "Expired alerts appear here for reference." : "Nothing needs your attention right now. Keep checking official channels during bad weather."}</p></div>`;
  $$("#list [data-id]").forEach(b => b.onclick = () => { selId = b.dataset.id; history.replaceState(null, "", "#" + encodeURIComponent(selId)); render(); if (innerWidth < 1100) $("#detail").scrollIntoView({ behavior: "smooth" }); });
  renderDetail(list.find(a => a.id === selId));
}
function renderDetail(a) {
  const el = $("#detail");
  if (!a) { el.innerHTML = `<p class="muted serif">Select an alert to see what it means and what to do.</p>`; return; }
  const [cls, lab, ic] = LEVEL(a);
  el.innerHTML = `<span class="badge ${cls}">${icon(ic)} ${esc(lab)}</span>
    <h2>${esc(a.title)}</h2><p class="sum">${esc(a.summary)}</p>
    <div class="facts"><div class="kv"><span>Source</span><span>${esc(a.source)}</span></div><div class="kv"><span>Affected area</span><span>${esc(a.area)}</span></div>
      <div class="kv"><span>Issued</span><span>${fmtTime(a.issued, true)} PHT</span></div><div class="kv"><span>${a.expired ? "Expired" : "Expires"}</span><span>${fmtTime(a.expires, true)} PHT</span></div></div>
    <h3 class="sec-title" data-i18n>What to do</h3>
    <div class="steps">${(a.steps || []).map((s, i) => `<div class="step"><span class="n">${i + 1}</span><div><b>${esc(s.title)}</b><span>${esc(s.text)}</span></div></div>`).join("") || `<p class="muted serif">Follow official instructions from local authorities.</p>`}</div>
    <div class="notice ${a.evac_order ? "" : "warn"}" style="${a.evac_order ? "background:var(--red);color:#fff;border-color:var(--red)" : ""}">${icon("info")}<span>${a.evac_order ? "An official evacuation order is in effect. Follow local authorities." : "No official evacuation order is in effect."}</span></div>
    <div class="row" style="margin-top:16px;flex-wrap:wrap"><a class="btn primary" href="preparedness.html">${icon("list")} Review preparedness steps</a>
      ${a.advisory_url ? `<a class="btn" href="${esc(a.advisory_url)}" target="_blank" rel="noopener">About this source ${icon("ext")}</a>` : `<a class="btn" href="methodology.html#alerts">About this source</a>`}</div>`;
  LNG.applyI18n(el);
}
function renderStatus(d) {
  const msgs = [];
  if (d.status && d.status.last_error) msgs.push("Earthquake feed: " + d.status.last_error);
  if (d.storm_status && d.storm_status.last_error) msgs.push("Storm feed: " + d.storm_status.last_error);
  $("#feed-status").innerHTML = msgs.length ? `<div class="notice warn" style="margin-bottom:14px">${icon("info")}<span>Some alert sources are not available, so this list may be incomplete. ${msgs.map(esc).join(" ")}</span></div>` : "";
}
async function load() {
  try { const d = await api("/api/feed"); feed = d.alerts || []; renderStatus(d); render(); }
  catch (e) { $("#list").innerHTML = `<div class="card pad"><div class="notice warn">${esc(e.message)}</div></div>`; $("#detail").innerHTML = ""; }
}
function notifState() {
  const p = LNG.store.get("alertPrefs", {}), perm = "Notification" in window ? Notification.permission : "unsupported";
  const on = p.notify && perm === "granted";
  $("#notif-state").textContent = on ? "On" : "Off"; $("#notif-state").className = "badge " + (on ? "ok" : "off");
  $("#notif-btn").lastChild.textContent = on ? " Change preferences" : " Enable notifications";
}
notifState(); load(); setInterval(load, 60000);
})();
