/* Top navigation and footer for the public pages (Home, Info pages). */
(() => {
"use strict";
const { $, $$, esc, icon } = LNG;
const active = document.body.dataset.nav || "home";
const u = LNG.user();
const links = [["home", "index.html", "Home"], ["overview", "info.html?p=overview", "Overview"], ["map", "info.html?p=map", "Hazard map"],
  ["alerts", "info.html?p=alerts", "Alerts"], ["prep", "info.html?p=prep", "Preparedness"]];
// signed-in people go straight to the screens, guests see the Info page first
const href = (k, h) => u && k !== "home" ? { overview: "overview.html", map: "map.html", alerts: "alerts.html", prep: "preparedness.html" }[k] : h;

const nav = document.createElement("header");
nav.className = "pnav";
nav.innerHTML = `<div class="wrap"><a href="index.html" aria-label="Lilikas na ga? home">${LNG.brandHtml("horizontal")}</a>
  <nav id="pnav-links" aria-label="Main">${links.map(([k, h, l]) => `<a href="${href(k, h)}" class="${k === active ? "on" : ""}" data-i18n>${l}</a>`).join("")}</nav>
  <div class="right"><span class="lang" role="group" aria-label="Language"><button data-lang="en">EN</button> / <button data-lang="fil">Filipino</button></span>
    ${u ? `<a class="login" href="overview.html">${icon("user")} ${esc(u.first_name)}</a>` : `<a class="login" href="login.html" data-i18n>Log in</a>`}
    <a class="btn dark sm" href="overview.html">${u ? "Open app" : '<span data-i18n>Explore as guest</span>'}</a>
    <button class="menu-btn" aria-label="Menu" aria-expanded="false">${icon("map")}</button></div></div>`;
document.body.prepend(nav);

const foot = document.createElement("footer");
foot.className = "pfoot";
foot.innerHTML = `<div class="wrap"><a href="index.html">${LNG.brandHtml("horizontal")}</a>
  <nav>${links.slice(1).map(([k, h, l]) => `<a href="${href(k, h)}" data-i18n>${l}</a>`).join("")}<a href="login.html" data-i18n>Log in</a><a href="signup.html" data-i18n>Sign up</a><a href="methodology.html">Data & methodology</a></nav></div>
  <div class="wrap" style="margin-top:18px"><small>© 2026 Lilikas na ga? · A planning aid for Batangas City. Not an official warning service.</small><small>EN / Filipino</small></div>`;
document.body.appendChild(foot);

const sync = () => { $$(".pnav [data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === LNG.lang()))); LNG.applyI18n(); };
$$(".pnav [data-lang]").forEach(b => b.onclick = () => { LNG.setLang(b.dataset.lang); sync(); });
const mb = $(".menu-btn");
mb.onclick = () => { const n = $("#pnav-links"); n.classList.toggle("open"); mb.setAttribute("aria-expanded", String(n.classList.contains("open"))); };
document.body.classList.add("pub");
sync();
LNG.hydrateIcons(document);
})();
