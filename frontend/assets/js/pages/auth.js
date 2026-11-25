/* Log in / Sign up (Figma: Login · Desktop, Sign up · Desktop). Signing in is optional everywhere. */
(() => {
"use strict";
const { $, $$, api } = LNG;
const signup = !!$("#name");
const nextRaw = new URLSearchParams(location.search).get("next") || "overview.html";
const next = /^[a-z-]+\.html([?#].*)?$/.test(nextRaw) ? nextRaw : "overview.html";
$("#swap").href += "?next=" + encodeURIComponent(next);
const err = m => { const e = $("#err"); e.hidden = !m; e.textContent = m || ""; };
$$("[data-show]").forEach(b => b.onclick = () => { const i = b.previousElementSibling, show = i.type === "password"; i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; });
$$("[data-soon]").forEach(b => b.onclick = () => LNG.toast(`${b.dataset.soon} sign-in is not set up yet. Use email or mobile number, or continue as a guest.`));
const f = $("#forgot"); if (f) f.onclick = e => { e.preventDefault(); LNG.toast("Password reset needs an email/SMS service, which is not set up yet."); };
$$("[data-lang]").forEach(b => b.onclick = () => LNG.setLang(b.dataset.lang));
if (LNG.loc().source !== "default" && $("#barangay")) $("#barangay").value = LNG.loc().label;

$("#form").onsubmit = async e => {
  e.preventDefault(); err("");
  const btn = $("#submit"), label = btn.textContent; btn.disabled = true; btn.textContent = "Please wait…";
  try {
    const l = LNG.loc();
    const body = signup
      ? { name: $("#name").value, contact: $("#contact").value, password: $("#password").value, agree: $("#agree").checked, barangay: $("#barangay").value || null,
          ...(l.source !== "default" ? { lat: l.lat, lon: l.lon } : {}), lang: LNG.lang() }
      : { contact: $("#contact").value, password: $("#password").value, remember: $("#remember").checked };
    const d = await api(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body });
    LNG.setSession(d.token, d.expires_in, d.user);
    const p = d.user.preferences || {};
    if (p.lat && p.lon && LNG.loc().source === "default") LNG.setLoc({ lat: p.lat, lon: p.lon, label: p.barangay || "Saved area", source: "manual" });
    if (p.lang) LNG.setLang(p.lang);
    location.href = next;
  } catch (ex) { err(ex.message); btn.disabled = false; btn.textContent = label; }
};
LNG.hydrateIcons(document);
})();
