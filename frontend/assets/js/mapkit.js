/* Small Leaflet wrapper shared by the Overview, Hazard map and Route review screens. */
(() => {
"use strict";
const { icon, esc } = LNG;
const FLOOD = ["#9ec5ea", "#4f8fd0", "#1f5aa6"], SLIDE = ["#f0cf8a", "#d79b3b", "#a8631a"];
const shade = (c, cols) => ({ color: cols[c - 1], fillColor: cols[c - 1], fillOpacity: .28 + c * .1, weight: 0 });
const layerCache = {};

function base(map) {
  // OpenStreetMap standard tiles: no API key, works on localhost.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

async function geo(name) {
  if (!layerCache[name]) layerCache[name] = fetch(LNG.apiUrl(`/layers/${name}.json`)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return layerCache[name];
}

function create(el, { lat, lon, zoom = 14, interactive = true } = {}) {
  const map = L.map(el, { zoomControl: interactive, scrollWheelZoom: interactive, dragging: interactive, attributionControl: true, preferCanvas: true })
    .setView([lat, lon], zoom);
  base(map);
  const kit = { map, layers: {}, you: null, pins: {}, route: [] };

  kit.addHazard = async (name, on = true) => {
    try {
      if (!kit.layers[name]) {
        const d = await geo(name);
        kit.layers[name] = name === "flood" ? L.geoJSON(d, { style: f => shade(f.properties.c, FLOOD), interactive: false })
          : name === "landslide" ? L.geoJSON(d, { style: f => shade(f.properties.c, SLIDE), interactive: false })
          : name === "boundary" ? L.geoJSON(d, { style: { color: "#5f7083", weight: 1.5, fill: false, dashArray: "4 4" }, interactive: false })
          : (() => { const g = L.layerGroup(); d.features.forEach(f => f.geometry.coordinates.forEach(([x, y]) => L.circleMarker([y, x], { radius: 1.5, color: "#d32f2f", weight: 0, fillOpacity: .9, interactive: false }).addTo(g))); return g; })();
      }
      if (on) kit.layers[name].addTo(map); else map.removeLayer(kit.layers[name]);
    } catch { /* the map still works without this layer */ }
  };

  kit.setYou = (lat, lon, label = "Your location") => {
    if (kit.you) map.removeLayer(kit.you);
    kit.you = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: `<div class="you"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 })
      .addTo(map).bindTooltip(esc(label), { permanent: true, direction: "bottom", offset: [0, 10], className: "maptag" });
  };

  kit.setCenters = (centers, { recommended, selected, onPick, labels = false } = {}) => {
    const ids = new Set(centers.map(c => c.id));
    Object.keys(kit.pins).forEach(id => { if (!ids.has(id)) { map.removeLayer(kit.pins[id]); delete kit.pins[id]; } });
    centers.forEach(c => {
      const col = c.status === "open" ? "#237660" : c.status === "full" ? "#d32f2f" : c.status === "unavailable" ? "#936116" : "#59627a";
      const html = `<div class="pin ${c.id === recommended ? "rec" : ""} ${c.id === selected ? "sel" : ""}" style="background:${col}">${icon("home")}</div>`;
      const tip = `<b>${esc(c.name)}</b><br>${c.status === "open" ? `${c.capacity - c.occupied} spaces shown` : c.status.toUpperCase()}`;
      let m = kit.pins[c.id];
      if (!m) {
        m = kit.pins[c.id] = L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "", html, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
        m.bindTooltip(tip, { direction: "top", offset: [0, -12], permanent: labels, className: labels ? "maptag" : "" });
        if (onPick) m.on("click", () => onPick(c.id));
      } else {
        m.setIcon(L.divIcon({ className: "", html, iconSize: [26, 26], iconAnchor: [13, 13] })); m.setTooltipContent(tip);
      }
    });
  };

  kit.setRoute = (routes, selectedId) => {
    kit.route.forEach(l => map.removeLayer(l)); kit.route = [];
    (routes || []).slice().sort((a, b) => (a.center.id === selectedId) - (b.center.id === selectedId)).forEach(r => {
      const on = r.center.id === selectedId, est = r.geometry_type !== "road";
      if (on) kit.route.push(L.polyline(r.geometry, { color: "#fff", weight: 8, opacity: .9, interactive: false }).addTo(map));
      kit.route.push(L.polyline(r.geometry, { color: on ? "#d32f2f" : "#8a98a9", weight: on ? 4.5 : 3, opacity: on ? .95 : .6,
        dashArray: on && !est ? null : "7 7", interactive: false }).addTo(map));
    });
  };

  kit.fit = points => { if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 }); };
  setTimeout(() => map.invalidateSize(), 60);
  return kit;
}

window.MapKit = { create };
})();
