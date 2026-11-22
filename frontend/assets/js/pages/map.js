/* Hazard map & evacuation (Figma: Hazard map & evacuation · Desktop) */
(() => {
"use strict";
const { $, $$, esc, icon, api, pct } = LNG;
const STATUS = { open: "Open", full: "Full", closed: "Closed", unavailable: "Unavailable" };
let centers = [], sel = null, plan = null, chosen = null, openOnly = false, mode = LNG.store.get("mode", "walking"), seq = 0, lastPlanAt = 0;
const fac = new Set();
const l0 = LNG.loc();
const kit = MapKit.create($("#map"), { lat: l0.lat, lon: l0.lon, zoom: 14 });
kit.addHazard("boundary"); kit.addHazard("flood");

// ---------------------------------------------------------------- filters
$("#f-flood").onclick = e => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", on); kit.addHazard("flood", on); };
$("#f-landslide").onchange = e => { kit.addHazard("landslide", e.target.checked); otherPressed(); };
$("#f-faults").onchange = e => { kit.addHazard("faults", e.target.checked); otherPressed(); };
const otherPressed = () => $("[data-menu=m-haz]").setAttribute("aria-pressed", String($("#f-landslide").checked || $("#f-faults").checked));
$("#f-open").onclick = e => { openOnly = !openOnly; e.currentTarget.setAttribute("aria-pressed", openOnly); render(); };
$$("#m-fac input").forEach(i => i.onchange = () => {
  i.checked ? fac.add(i.value) : fac.delete(i.value);
  $("[data-menu=m-fac]").setAttribute("aria-pressed", String(fac.size > 0)); chosen = null; plan = null; render(); fetchPlan(false);
});
$$("[data-menu]").forEach(b => b.onclick = e => {
  e.stopPropagation(); const m = $("#" + b.dataset.menu), o = m.classList.contains("open");
  $$(".dd .menu").forEach(x => x.classList.remove("open")); if (!o) m.classList.add("open");
});
$$(".dd .menu").forEach(m => m.onclick = e => e.stopPropagation());
document.addEventListener("click", () => $$(".dd .menu").forEach(x => x.classList.remove("open")));
$$(".seg button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); b.onclick = () => {
  mode = b.dataset.mode; LNG.store.set("mode", mode); $$(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); plan = null; fetchPlan(false);
}; });

// ---------------------------------------------------------------- planning
async function fetchPlan(fit) {
  const my = ++seq, l = LNG.loc(); lastPlanAt = Date.now();
  if (!plan) $("#routebox").innerHTML = `<div class="km">–</div><div class="muted serif" style="font-size:12px">Finding the best route…</div>`;
  const q = `/api/route?lat=${l.lat}&lon=${l.lon}&mode=${mode}` + (chosen ? `&to=${encodeURIComponent(chosen)}` : "") + (fac.size ? `&need=${encodeURIComponent([...fac].join(","))}` : "");
  try { const d = await api(q, { timeout: 30000 }); if (my !== seq) return; plan = d; }
  catch (e) { if (my !== seq) return; plan = null; kit.setRoute([]); $("#routebox").innerHTML = `<div class="km">–</div><div class="notice warn">${esc(e.message)}</div>`; render(); return; }
  if (plan.selected_id) sel = centers.find(c => c.id === plan.selected_id) || sel;
  drawPlan(fit);
}
function drawPlan(fit) {
  if (!plan || !plan.routes.length) {
    kit.setRoute([]); $("#routebox").innerHTML = `<div class="km">–</div><div class="notice warn">${esc((plan && plan.message) || "No open center with space matches these filters.")}</div>`;
    $("#review").setAttribute("aria-disabled", "true"); render(); return;
  }
  kit.setRoute(plan.routes, plan.selected_id);
  const r = plan.routes.find(x => x.center.id === plan.selected_id) || plan.routes[0];
  const rec = plan.routes.find(x => x.center.id === plan.recommended_id), others = plan.routes.filter(x => x !== r);
  $("#routebox").innerHTML = `
    ${r.center.id === plan.recommended_id ? '<span class="badge ok">Recommended</span>' : '<span class="badge info">Your choice</span>'}
    <div style="font-weight:800;margin-top:6px">${esc(r.center.name)}</div>
    <div class="km">${r.distance_km.toFixed(1)} km <small>· ${Math.round(r.duration_min)} min ${mode === "walking" ? "walk" : "drive (estimate)"}${r.geometry_type === "road" ? "" : " · straight-line estimate"}</small></div>
    <ul class="reasons">${r.reasons.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    ${r.warnings.map(x => `<div class="notice warn" style="margin-top:6px">${icon("alert")}<span>${esc(x)}</span></div>`).join("")}
    ${plan.note ? `<div class="notice warn" style="margin-top:6px">${esc(plan.note)}</div>` : ""}
    ${r.center.id !== plan.recommended_id && rec ? `<button class="alt" data-pick=""><span>Back to recommended: <b>${esc(rec.center.name)}</b></span><span>${Math.round(rec.duration_min)} min</span></button>` : ""}
    ${others.length ? `<div class="muted" style="font-size:11.5px;margin-top:10px">Other options</div>` + others.slice(0, 3).map(o => `<button class="alt" data-pick="${esc(o.center.id)}"><span>${esc(o.center.name)}</span><span>${Math.round(o.duration_min)} min · ${o.center.spaces} spaces</span></button>`).join("") : ""}`;
  $$("#routebox [data-pick]").forEach(b => b.onclick = () => choose(b.dataset.pick || null));
  const rv = $("#review"); rv.removeAttribute("aria-disabled"); rv.href = `route.html?to=${encodeURIComponent(r.center.id)}&mode=${mode}`;
  if (fit) { const l = LNG.loc(); kit.fit([[l.lat, l.lon], ...r.geometry]); }
  render();
}
function choose(id) {
  chosen = id && plan && id === plan.recommended_id ? null : id;
  if (id) sel = centers.find(c => c.id === id) || sel;
  render(); fetchPlan(false);
}

// ---------------------------------------------------------------- centers
const visible = () => centers.filter(c => (!openOnly || c.status === "open") && [...fac].every(f => (c.facilities || []).includes(f)));
function render() {
  let list = visible();
  if (plan && plan.considered) { const rank = new Map(plan.considered.map((d, i) => [d.id, i])); list = list.slice().sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 99) - (rank.has(b.id) ? rank.get(b.id) : 99)); }
  if (sel && !list.includes(sel)) sel = list.find(c => plan && c.id === plan.selected_id) || list[0] || null;
  kit.setCenters(list, { recommended: plan && plan.recommended_id, selected: sel && sel.id, onPick: choose });
  const eta = new Map(((plan && plan.considered) || []).map(d => [d.id, d]));
  $("#cmp").innerHTML = list.map(c => {
    const d = eta.get(c.id), best = plan && c.id === plan.recommended_id;
    return `<button class="card opt ${c === sel ? "sel" : ""}" data-id="${esc(c.id)}"><span class="badge ${c.status}">${icon(c.status === "open" ? "checkCircle" : "info")} ${STATUS[c.status]}</span>${best ? ' <span class="badge ok">Best match</span>' : ""}${d ? `<span class="eta">${Math.round(d.duration_min)} min · ${d.distance_km.toFixed(1)} km</span>` : ""}
      <br><span class="center-name">${esc(c.name)}</span><small>${c.status === "open" || c.status === "full" ? `${c.capacity - c.occupied ? c.capacity - c.occupied + " spaces shown" : "No spaces shown"} · ` : ""}${esc((c.facilities || []).join(", ") || "No facilities listed")}</small></button>`;
  }).join("") || `<p class="muted">No centers match these filters.</p>`;
  $$("#cmp [data-id]").forEach(el => el.onclick = () => choose(el.dataset.id));
  renderDetail();
}
function renderDetail() {
  const c = sel;
  if (!c) { $("#detail").innerHTML = `<b>No center selected</b><p class="muted serif">Pick a center on the map or below.</p>`; return; }
  const p = pct(c.occupied, c.capacity);
  $("#detail").innerHTML = `<span class="badge ${c.status}">${icon(c.status === "open" ? "checkCircle" : "info")} ${STATUS[c.status]}</span><br>
    <span class="center-name">${esc(c.name)}</span>
    <div class="cap"><span>${c.occupied} / ${c.capacity} capacity</span><span>${Math.max(0, c.capacity - c.occupied)} spaces shown</span></div>
    <div class="bar"><i style="width:${p}%"></i></div>
    <div style="margin-top:12px">
      <div class="kv"><span>Facilities</span><span>${esc((c.facilities || []).join(" · ") || "Not provided")}</span></div>
      <div class="kv"><span>Suitability</span><span>${esc(c.suitability || "")}</span></div>
      <div class="kv"><span>Contact</span><span>${esc(c.contact || "Not provided · Confirm with local officials")}</span></div></div>`;
}
async function refresh() {
  const n = await api("/api/centers");
  centers = n.map(x => { const c = centers.find(y => y.id === x.id); return c ? Object.assign(c, x) : x; });
  if (!centers.includes(sel)) sel = centers.find(c => c.status === "open") || centers[0] || null;
  const t = n.map(x => x.updated).filter(Boolean).sort().pop();
  $("#live").textContent = "● Live (simulated)" + (t ? " · updated " + t : "");
  render();
  // capacity changes live: if the recommended center filled up or closed, plan again right away
  if (plan && plan.recommended_id && Date.now() - lastPlanAt > 4000) {
    const c = centers.find(x => x.id === plan.recommended_id);
    if (!c || c.status !== "open" || c.occupied >= c.capacity) { fetchPlan(false); LNG.toast("The recommended center changed because its space or status changed."); }
  }
}

function setYou(fit) { const l = LNG.loc(); kit.setYou(l.lat, l.lon); chosen = null; plan = null; fetchPlan(fit); }
kit.map.on("click", e => LNG.setLoc({ lat: e.latlng.lat, lon: e.latlng.lng, label: `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`, source: "manual" }));
LNG.on("location", () => setYou(true));

(async () => {
  try { centers = await api("/api/centers"); } catch (e) { $("#detail").innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; }
  sel = centers.find(c => c.status === "open") || centers[0] || null;
  render(); setYou(true);
  setInterval(() => refresh().catch(() => {}), 5000);
  setInterval(() => { if (Date.now() - lastPlanAt > 30000) fetchPlan(false); }, 30000);
})();
})();
