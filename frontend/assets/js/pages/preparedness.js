/* Preparedness & emergency help (Figma: Preparedness & emergency help · Desktop) */
(() => {
"use strict";
const { $, $$, esc, icon } = LNG;
const TASKS = [
  ["water_food", "water", "Pack drinking water and ready to eat food", "Include supplies for each person and any pets."],
  ["medicine", "firstaid", "Prepare medicine and a first aid kit", "Keep prescriptions and essential medical items together."],
  ["power", "battery", "Charge phones and a power bank", "Add a flashlight, spare batteries and a whistle."],
  ["documents", "doc", "Protect important documents", "Use a waterproof pouch for copies and emergency contacts."],
  ["meeting_point", "flag", "Agree on a household meeting point", "Choose a safe place and write down a contact plan."],
  ["official_advice", "home", "Review official advice and center options", "Confirm that a center is open, suitable and safe to reach."],
];
const FAQ = [
  ["Does high flood susceptibility mean it is flooding?", "No. Susceptibility describes how prone an area is to flooding. It does not confirm flooding or an evacuation order."],
  ["Is the recommended center an official order?", "No. It is the best match by travel time, space left and mapped hazards. Follow local officials, who may direct you elsewhere."],
  ["Who writes the steps Lilikas Assist shows?", "They come from a fixed guide library. The AI only picks and orders them; it never writes new advice or issues orders."],
];
const u = LNG.user();
let done = new Set((u && u.preferences && u.preferences.checklist && u.preferences.checklist.length ? u.preferences.checklist : LNG.store.get("checklist", [])));

function renderTasks() {
  $("#tasks").innerHTML = TASKS.map(([id, ic, t, s]) => `<label class="task ${done.has(id) ? "done" : ""}"><input type="checkbox" data-id="${id}" ${done.has(id) ? "checked" : ""}><div><b>${esc(t)}</b><span>${esc(s)}</span></div></label>`).join("");
  $("#progress").innerHTML = TASKS.map(([id]) => `<i class="${done.has(id) ? "on" : ""}"></i>`).join("");
  $("#done-count").textContent = `${done.size} of ${TASKS.length} complete`;
  $$("#tasks input").forEach(i => i.onchange = () => { i.checked ? done.add(i.dataset.id) : done.delete(i.dataset.id); save(); renderTasks(); });
  $("#sync-note").textContent = LNG.user() ? "Saved to your account." : "Saved on this device. Log in to keep it on your account.";
}
function save() {
  const list = TASKS.map(t => t[0]).filter(id => done.has(id));
  LNG.store.set("checklist", list);
  if (LNG.user()) LNG.api("/api/me/preferences", { method: "PUT", body: { checklist: list } }).then(d => LNG.setUser(d.user)).catch(() => {});
}
$("#print").onclick = () => window.print();
$("#dl").onclick = () => {
  const l = LNG.loc();
  const text = [`LILIKAS NA GA? HOUSEHOLD SAFETY PLAN`, `Area: ${l.label}`, `Printed: ${new Date().toLocaleString()}`, ``,
    `CHECKLIST`, ...TASKS.map(([id, , t, s]) => `[${done.has(id) ? "x" : " "}] ${t} — ${s}`), ``,
    `EMERGENCY CONTACTS`, `National emergency hotline: 911`, `Batangas City disaster office (CDRRMO): ____________`, `Barangay assistance desk: ____________`,
    `Household meeting point: ____________`, ``, `This plan is a planning aid. Always follow official instructions.`].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "lilikas-household-checklist.txt"; a.click();
};
$("#faq").innerHTML = FAQ.map(([q, a], i) => `<details ${i ? "" : "open"} style="margin-bottom:10px"><summary class="quote" style="cursor:pointer">“${esc(q)}”</summary><p class="muted serif" style="font-size:12.5px;margin:0 0 6px">${esc(a)}</p></details>`).join("");

// ---- share location (consent first)
function syncShare() {
  const l = LNG.loc();
  $("#share-loc").innerHTML = `${icon("pin")} ${l.source === "device" ? "Device location" : "Manual selection"}: ${esc(l.label)}`;
  const granted = l.source === "device";
  $("#perm").textContent = granted ? "Device location used" : "Permission not granted";
  $("#perm").parentElement.className = "badge " + (granted ? "ok" : "warn");
}
$("#consent").onchange = e => { const b = $("#create-msg"); if (e.target.checked) { b.removeAttribute("aria-disabled"); b.textContent = "Create message"; } else { b.setAttribute("aria-disabled", "true"); b.textContent = "Create message · Consent required"; } };
$("#create-msg").onclick = e => { if (!$("#consent").checked) { e.preventDefault(); LNG.toast("Tick the consent box first."); } };
$("#use-device").onclick = () => { location.href = "location.html?next=preparedness.html%23share"; };
LNG.on("location", syncShare);
syncShare(); renderTasks();
})();
