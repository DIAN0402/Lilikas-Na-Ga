/* Overview (Figma: Overview · Desktop / Overview · Mobile web) */
(() => {
"use strict";
const { $, esc, icon, api } = LNG;
let kit = null, seq = 0;

function greet() {
  const u = LNG.user();
  $("#greet").textContent = LNG.t(LNG.greeting());
  $("#greet-name").innerHTML = u ? `, <span class="hl">${esc(u.first_name)}!</span>` : "!";
}

function chart(week) {
  if (!week || !week.length) return `<p class="note">Rainfall history is not available right now.</p>`;
  const W = 320, H = 110, pad = 18, max = Math.max(50, ...week.map(d => d.mm || 0));
  const x = i => pad + i * (W - pad * 2) / (week.length - 1), y = v => H - 18 - (v / max) * (H - 30);
  const pts = week.map((d, i) => [x(i), y(d.mm || 0), d.kind]);
  const split = week.findIndex(d => d.kind === "forecast");
  const path = arr => arr.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const obs = split < 0 ? pts : pts.slice(0, split + 1), fc = split < 0 ? [] : pts.slice(split);
  const days = ["Su", "M", "T", "W", "Th", "F", "Sa"];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily rainfall, last 7 days and forecast">
    ${[0, 25, 50].map(v => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="#f3e4e4"/><text x="0" y="${y(v) + 3}" font-size="7" fill="#8a98a9">${v ? v + " mm" : 0}</text>`).join("")}
    <path d="${path(obs)}" fill="none" stroke="#d32f2f" stroke-width="2"/>
    ${fc.length ? `<path d="${path(fc)}" fill="none" stroke="#d32f2f" stroke-width="2" stroke-dasharray="4 4" opacity=".7"/>` : ""}
    ${pts.map((p, i) => i % 2 ? "" : `<text x="${p[0]}" y="${H - 4}" font-size="7" text-anchor="middle" fill="#8a98a9">${days[new Date(week[i].date + "T00:00").getDay()]}</text>`).join("")}
    ${split > 0 ? `<circle cx="${pts[split - 1][0]}" cy="${pts[split - 1][1]}" r="3.5" fill="#d32f2f" stroke="#fff" stroke-width="1.5"/>` : ""}
  </svg>
  <div class="legend"><span><i style="background:#d32f2f;border-radius:50%"></i>Observed, last 7 days</span><span><i style="background:#f2a7a7;border-radius:50%"></i>Forecast</span></div>`;
}

function renderRisk(d) {
  const r = d.risk, el = $("#risk");
  el.dataset.level = r.level;
  el.innerHTML = `
    <h2><span class="ib">${icon(r.level === "low" ? "checkCircle" : "alert")}</span>${esc(r.title)}</h2>
    <p>${esc(r.text)}</p>
    <div class="tiles"><div>Susceptibility<b>${esc(r.susceptibility)}</b></div><div>Rainfall<b>${d.rain.last_3h_mm == null ? "–" : d.rain.last_3h_mm + " mm"}</b></div><div>Order<b>${d.evacuation_order.active ? "Active" : "None"}</b></div></div>
    <div class="order ${d.evacuation_order.active ? "on" : ""}">${icon("info")}${d.evacuation_order.active
      ? `Official evacuation order: ${esc(d.evacuation_order.title)} (${esc(d.evacuation_order.source)}). Follow local authorities.`
      : LNG.t("No official evacuation order")}</div>
    <div class="acts"><a class="btn primary" href="map.html">${icon("map")} <span data-i18n>View map & evacuation</span></a>
      <a class="btn dark" href="#why">Why this assessment?</a></div>`;
  LNG.applyI18n(el);
}

function renderRain(d) {
  const mm = d.rain.last_3h_mm;
  $("#rain-body").innerHTML = `
    ${d.rain.heavy ? `<span class="badge warn" style="margin-top:10px">${icon("rain")} Heavy rain</span>` : mm ? `<span class="badge info" style="margin-top:10px">Light rain</span>` : `<span class="badge ok" style="margin-top:10px">No rain now</span>`}
    <div class="big">${mm == null ? "–" : mm}<small> mm</small></div>
    <div class="muted serif" style="font-size:12px">${mm == null ? "Rain data is not available right now" : "over the last 3 hours"}</div>
    ${chart(d.rain.week)}
    <p class="note">Rain can increase flood risk in susceptible areas. Stay alert to changing conditions.</p>`;
}

async function renderWhy(d) {
  $("#why-chips").innerHTML = d.risk.factors.length
    ? d.risk.factors.map((f, i) => `${i ? '<span class="muted">+</span>' : ""}<span class="pill red">${icon(/rain/i.test(f) ? "rain" : /flood/i.test(f) ? "waves" : /landslide/i.test(f) ? "mountain" : /storm/i.test(f) ? "wind" : "info")} ${esc(f)}</span>`).join("")
    : `<span class="pill">No special hazard detected</span>`;
  const facts = d.evidence.map(e => e.text);
  const box = $("#why-text");
  try {
    const x = await api("/api/assist/explain", { method: "POST", body: { level: d.risk.label, facts, lang: LNG.lang() } });
    box.innerHTML = `${esc(x.text)}<small>${x.engine === "model" ? "Explained by Lilikas Assist AI from the evidence above." : "Explained by fixed rules."} AI explains the evidence; it does not issue evacuation orders.</small>`;
  } catch {
    box.textContent = "This level combines hazard and rainfall inputs. AI explains the evidence; it does not issue evacuation orders.";
  }
}

async function renderMap(d) {
  const l = d.location;
  if (!window.L) return;
  if (!kit) { kit = MapKit.create($("#mini-map"), { lat: l.lat, lon: l.lon, zoom: 14 }); kit.addHazard("flood"); kit.addHazard("boundary"); }
  kit.map.setView([l.lat, l.lon], 14);
  kit.setYou(l.lat, l.lon);
  try { const cs = await api("/api/centers"); kit.setCenters(cs, { recommended: d.center && d.center.id, labels: false }); } catch { /* pins are optional */ }
}

async function load() {
  const my = ++seq, l = LNG.loc();
  greet();
  $("#greet-sub").textContent = `Here's your risk snapshot for ${l.label}, and the next steps you can take.`;
  let d;
  try { d = await api(`/api/overview?lat=${l.lat}&lon=${l.lon}`, { timeout: 30000 }); }
  catch (e) {
    if (my !== seq) return;
    $("#risk").innerHTML = `<h2><span class="ib">${icon("wifiOff")}</span>Can't load your snapshot</h2><p>${esc(e.message)}</p><div class="acts"><button class="btn primary" id="retry">Try again</button><a class="btn dark" href="preparedness.html">Preparedness checklist</a></div>`;
    $("#retry").onclick = load; return;
  }
  if (my !== seq) return;
  if (d.location.barangay && l.source !== "manual") {
    $("#greet-sub").textContent = `Here's your risk snapshot for ${d.location.label}, and the next steps you can take.`;
  }
  renderRisk(d); renderRain(d); renderWhy(d); renderMap(d);
  if (d.center) $("#pick-center").textContent = `Best match now: ${d.center.name}, about ${Math.round(d.center.minutes)} min walk. Check before travelling.`;
  if (d.alert) { $("#official-text").textContent = `${d.alert.level_label || "Advisory"}: ${d.alert.title} (${d.alert.source})`; $("#official").href = "alerts.html#" + encodeURIComponent(d.alert.id); }
  if (window.LilikasAssist) LilikasAssist.setLocation(l.lat, l.lon, l.source !== "default");
}

$("#change-loc").onclick = e => { e.stopPropagation(); $("#loc-btn").click(); };
LNG.on("location", load);
LNG.on("lang", () => { greet(); load(); });
LNG.on("user", greet);
load();
})();
