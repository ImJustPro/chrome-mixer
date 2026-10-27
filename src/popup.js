import { DEFAULT_PREFS, FULLSCREEN_PERMS } from "./shared.js";

const $ = s => document.querySelector(s);
const send = msg => chrome.runtime.sendMessage(msg);

let state = { tabs: [], solo: null, prefs: { ...DEFAULT_PREFS }, sites: {} };
let open = new Set();      // schede con gli effetti aperti
let errors = {};           // tabId -> motivo dell'ultimo errore di cattura
let dragging = false;      // durante il trascinamento non si ridisegna l'elenco
let signature = "";

const ICON = {
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  release: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDb = v => (v > 0 ? "+" : "") + v + " dB";
const fmtPan = v => v == 0 ? "centro" : (v < 0 ? "S " + -v : "D " + v);
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// ---------- sfondo ----------
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
const systemDark = matchMedia("(prefers-color-scheme: dark)");
function applyBackground() {
  const p = state.prefs, root = document.documentElement;
  root.dataset.bg = p.background;
  let tone = systemDark.matches ? "dark" : "light";
  if (p.background === "grigio") tone = "light";
  if (p.background === "nero") tone = "dark";
  root.style.cssText = "";
  if (p.background === "personalizza") {
    const c = p.custom;
    tone = luminance(c.base) < .25 ? "dark" : "light";
    root.style.setProperty("--ground", c.base);
    root.style.setProperty("--blob-a", c.c1);
    root.style.setProperty("--blob-b", c.c2);
    root.style.setProperty("--blob-c", c.c3);
    root.style.setProperty("--blob-d", c.c1);
  }
  root.dataset.tone = tone;
  root.dataset.moving = String(p.background === "bolle" || (p.background === "personalizza" && p.custom.moving));
  document.querySelectorAll(".bg-opt").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bg === p.background)));
  $("#customBox").hidden = p.background !== "personalizza";
  $("#cBase").value = p.custom.base; $("#c1").value = p.custom.c1; $("#c2").value = p.custom.c2; $("#c3").value = p.custom.c3;
  $("#cMoving").checked = p.custom.moving;
}
systemDark.addEventListener("change", applyBackground);

// ---------- cursori ----------
function sliderHTML(id, min, max, val, { cls = "", label = "", step = 1, disabled = false } = {}) {
  return `<div class="slider ${cls}"><div class="rail"><div class="fill"></div></div>${cls.includes("center") ? "" : '<div class="notch"></div>'}<input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${esc(label)}" ${disabled ? "disabled" : ""}></div>`;
}
function paintSlider(wrap) {
  const inp = wrap.querySelector("input");
  const min = +inp.min, max = +inp.max, v = +inp.value;
  const fill = wrap.querySelector(".fill"), notch = wrap.querySelector(".notch");
  const pos = (v - min) / (max - min) * 100;
  if (wrap.classList.contains("center")) {
    fill.style.left = Math.min(50, pos) + "%";
    fill.style.width = Math.abs(pos - 50) + "%";
    return;
  }
  fill.style.width = pos + "%";
  if (notch) {
    const u = (100 - min) / (max - min) * 100;
    notch.style.left = `calc(${u}% - 1px)`;
    fill.style.setProperty("--unity", pos > 0 ? (u / pos * 100) + "%" : "100%");
  }
}

// ---------- elenco ----------
function favicon(t) {
  const letter = esc((t.host || t.title || "?").charAt(0).toUpperCase());
  const bg = `hsl(${hue(t.host || t.title)} 60% 45%)`;
  if (t.favIconUrl && /^(https?|data):/.test(t.favIconUrl)) {
    return `<div class="fav img"><img src="${esc(t.favIconUrl)}" alt="" data-letter="${letter}" data-bg="${bg}"></div>`;
  }
  return `<div class="fav" style="background:${bg}">${letter}</div>`;
}

function tabHTML(t) {
  const p = t.params;
  const solo = state.solo === t.id;
  const cls = ["tab", "glass", t.effMuted && "muted", t.audible && "audible", t.captured && "captured", open.has(t.id) && "open"].filter(Boolean).join(" ");
  const tag = t.active ? '<span class="tag">Questa scheda</span>' : "";
  const head = `<div class="head">${favicon(t)}<div class="meta"><b title="${esc(t.title)}">${esc(t.title)}</b><span>${esc(t.place)}</span></div>${tag}<span class="vu" aria-hidden="true"><i></i><i></i><i></i></span></div>`;
  const muteBtns = `
    <button class="pill ico ${t.muted ? "on-mute" : ""}" data-act="mute" type="button" title="Muto (Alt+Shift+M)" aria-pressed="${t.muted}">M</button>
    <button class="pill ico ${solo ? "on" : ""}" data-act="solo" type="button" title="Solo (Alt+Shift+S)" aria-pressed="${solo}">S</button>
    <button class="pill" data-act="others" type="button" title="Muta tutte le altre schede">Muta le altre</button>`;

  if (!t.capturable) {
    return `<article class="${cls}" data-id="${t.id}">${head}
      <div class="note">Chrome non permette di regolare il volume di questa pagina. Muto e solo funzionano.</div>
      <div class="actions">${muteBtns}</div></article>`;
  }
  const err = errors[t.id];
  if (!t.invoked || err === "da-attivare") {
    return `<article class="${cls}" data-id="${t.id}">${head}
      <div class="note">Per regolare il volume di questa scheda apri Mixer mentre sei su di essa: vai alla scheda e clicca di nuovo l'icona.</div>
      <div class="actions">${muteBtns}<span class="spacer"></span>
        <button class="pill" data-act="focus" type="button" title="Passa a questa scheda">Vai ${ICON.go}</button></div></article>`;
  }
  const errNote = err === "occupata"
    ? '<div class="note warn">Un\'altra estensione sta gia\' catturando l\'audio di questa scheda. Chiudila o liberala e riprova.</div>'
    : err ? `<div class="note warn">Non riesco a controllare questa scheda: ${esc(err)}</div>` : "";
  return `<article class="${cls}" data-id="${t.id}">${head}
    <div class="row">
      ${sliderHTML("v" + t.id, 0, 400, p.vol, { label: "Volume di " + t.title, step: 5 })}
      <span class="pct ${p.vol > 100 ? "boost" : ""}">${p.vol}%</span>
    </div>
    ${errNote}
    <div class="actions">${muteBtns}<span class="spacer"></span>
      ${t.captured ? `<button class="pill ico" data-act="release" type="button" title="Libera: rimette la scheda com'era, audio gestito da Chrome" aria-label="Libera">${ICON.release}</button>` : ""}
      <button class="pill ico chev" data-act="fx" type="button" title="Effetti" aria-label="Effetti" aria-expanded="${open.has(t.id)}">${ICON.chev}</button>
    </div>
    <div class="fx">
      ${[["bass", "Bassi"], ["mid", "Medi"], ["treble", "Alti"]].map(([k, n]) =>
        `<div class="row"><span class="label">${n}</span>${sliderHTML(`${k}-${t.id}`, -12, 12, p[k], { cls: "small center", label: n })}<span class="val">${fmtDb(p[k])}</span></div>`).join("")}
      <div class="row"><span class="label">Bilanc.</span>${sliderHTML(`pan-${t.id}`, -100, 100, p.pan, { cls: "small center", label: "Bilanciamento sinistra destra", step: 5 })}<span class="val">${fmtPan(p.pan)}</span></div>
      <div class="toggles">
        <label><span class="switch"><input type="checkbox" data-act="mono" ${p.mono ? "checked" : ""}><span></span></span>Mono</label>
        ${t.host ? `<label title="Riapplica questi valori ogni volta che apri ${esc(t.host)}"><span class="switch"><input type="checkbox" data-act="remember" ${t.remember ? "checked" : ""}><span></span></span>Ricorda per ${esc(t.host)}</label>` : ""}
      </div>
    </div></article>`;
}

function render() {
  const list = $("#list");
  const tabs = state.tabs;
  const playing = tabs.filter(t => t.audible).length;
  $("#count").textContent = playing === 1 ? "1 scheda suona" : `${playing} schede suonano`;
  if (!tabs.length) {
    list.innerHTML = '<div class="empty glass"><b>Nessuna scheda sta suonando</b>Quando una scheda riproduce audio compare qui.</div>';
  } else {
    list.innerHTML = tabs.map(tabHTML).join("");
  }
  list.querySelectorAll(".slider").forEach(paintSlider);
  list.querySelectorAll(".fav img").forEach(img => img.addEventListener("error", () => {
    const box = img.parentElement;
    box.classList.remove("img"); box.style.background = img.dataset.bg; box.textContent = img.dataset.letter;
  }, { once: true }));
  const allMuted = tabs.length && tabs.every(t => t.effMuted);
  $("#muteAll").textContent = allMuted ? "Riattiva tutte" : "Muta tutte";
  signature = sig();
}

const sig = () => JSON.stringify([state.tabs.map(t => [t.id, t.title, t.audible, t.effMuted, t.muted, t.captured, t.invoked, t.remember, t.favIconUrl, t.params]), state.solo, errors]);

function renderSettings() {
  const sites = Object.entries(state.sites);
  $("#sites").innerHTML = sites.length
    ? sites.map(([h, p]) => `<div class="site"><span>${esc(h)}</span><em>${p.vol}%</em><button class="pill" type="button" data-forget="${esc(h)}">Dimentica</button></div>`).join("")
    : '<p class="small-print">Nessun sito salvato. Apri gli effetti di una scheda e attiva "Ricorda per".</p>';
  $("#version").textContent = `Chrome Mixer ${chrome.runtime.getManifest().version}`;
  $("#fsFix").checked = !!state.prefs.fullscreenFix;
}

function renderMaster() {
  const p = state.prefs;
  $("#master").value = p.master;
  $("#masterPct").textContent = p.master + "%";
  $("#masterPct").classList.toggle("boost", p.master > 100);
  paintSlider($("#master").closest(".slider"));
  $("#limiter").checked = p.limiter;
}

// ---------- invio dei cursori, al massimo uno per fotogramma ----------
const pending = new Map();
function queueSet(tabId, patch) {
  const prev = pending.get(tabId);
  pending.set(tabId, { ...prev, ...patch });
  if (prev) return;
  requestAnimationFrame(async () => {
    const p = pending.get(tabId); pending.delete(tabId);
    const res = await send({ cmd: "set", tabId, patch: p });
    if (res?.error) { errors[tabId] = res.error; await refresh(true); }
    else if (errors[tabId]) { delete errors[tabId]; await refresh(true); }
  });
}

const findTab = id => state.tabs.find(t => t.id === id);

$("#list").addEventListener("input", e => {
  const inp = e.target;
  if (inp.type !== "range") return;
  paintSlider(inp.closest(".slider"));
  const out = inp.closest(".row").querySelector(".pct, .val");
  const [kind, idStr] = inp.id.startsWith("v") ? ["vol", inp.id.slice(1)] : inp.id.split("-");
  const tabId = Number(idStr), v = Number(inp.value);
  const t = findTab(tabId);
  if (t) t.params[kind] = v;
  if (kind === "vol") { out.textContent = v + "%"; out.classList.toggle("boost", v > 100); }
  else if (kind === "pan") out.textContent = fmtPan(v);
  else out.textContent = fmtDb(v);
  queueSet(tabId, { [kind]: v });
});
$("#list").addEventListener("pointerdown", e => { if (e.target.type === "range") dragging = true; });
addEventListener("pointerup", () => { dragging = false; });
// doppio clic sul cursore: torna al valore neutro
$("#list").addEventListener("dblclick", e => {
  const inp = e.target;
  if (inp.type !== "range") return;
  inp.value = inp.id.startsWith("v") ? 100 : 0;
  inp.dispatchEvent(new Event("input", { bubbles: true }));
});

$("#list").addEventListener("change", async e => {
  const inp = e.target;
  const act = inp.dataset.act;
  if (!act) return;
  const tabId = Number(inp.closest(".tab").dataset.id);
  if (act === "mono") queueSet(tabId, { mono: inp.checked });
  if (act === "remember") { await send({ cmd: "remember", tabId, on: inp.checked }); await refresh(true); }
});

$("#list").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const card = b.closest(".tab");
  const tabId = Number(card.dataset.id);
  const t = findTab(tabId);
  switch (b.dataset.act) {
    case "mute": await send({ cmd: "mute", tabId }); break;
    case "solo": await send({ cmd: "solo", tabId }); break;
    case "others": await send({ cmd: "muteOthers", tabId }); break;
    case "release": delete errors[tabId]; await send({ cmd: "release", tabId }); break;
    case "focus": await send({ cmd: "focus", tabId, windowId: t.windowId }); window.close(); return;
    case "fx":
      open.has(tabId) ? open.delete(tabId) : open.add(tabId);
      card.classList.toggle("open");
      b.setAttribute("aria-expanded", String(open.has(tabId)));
      return;
  }
  await refresh(true);
});

// ---------- testata e piede ----------
$("#muteAll").addEventListener("click", async () => { await send({ cmd: "muteAll" }); await refresh(true); });
let masterTimer = 0;
$("#master").addEventListener("input", e => {
  const v = Number(e.target.value);
  state.prefs.master = v;
  $("#masterPct").textContent = v + "%";
  $("#masterPct").classList.toggle("boost", v > 100);
  paintSlider(e.target.closest(".slider"));
  cancelAnimationFrame(masterTimer);
  masterTimer = requestAnimationFrame(() => send({ cmd: "prefs", patch: { master: v } }));
});
$("#master").addEventListener("dblclick", e => { e.target.value = 100; e.target.dispatchEvent(new Event("input")); });
$("#limiter").addEventListener("change", e => send({ cmd: "prefs", patch: { limiter: e.target.checked } }));

// ---------- impostazioni ----------
function showSettings(on) {
  $("#settings").hidden = !on;
  $("#list").hidden = on;
  $("#masterRow").hidden = on;
  if (on) renderSettings();
}
$("#openSettings").addEventListener("click", () => showSettings($("#settings").hidden));
$("#closeSettings").addEventListener("click", () => showSettings(false));
$("#bgs").addEventListener("click", e => {
  const b = e.target.closest(".bg-opt");
  if (!b) return;
  state.prefs.background = b.dataset.bg;
  applyBackground();
  send({ cmd: "prefs", patch: { background: b.dataset.bg } });
});
for (const [id, key] of [["#cBase", "base"], ["#c1", "c1"], ["#c2", "c2"], ["#c3", "c3"]]) {
  $(id).addEventListener("input", e => {
    state.prefs.custom = { ...state.prefs.custom, [key]: e.target.value };
    applyBackground();
  });
  $(id).addEventListener("change", () => send({ cmd: "prefs", patch: { custom: state.prefs.custom } }));
}
$("#cMoving").addEventListener("change", e => {
  state.prefs.custom = { ...state.prefs.custom, moving: e.target.checked };
  applyBackground();
  send({ cmd: "prefs", patch: { custom: state.prefs.custom } });
});
$("#sites").addEventListener("click", async e => {
  const h = e.target.dataset.forget;
  if (!h) return;
  await send({ cmd: "forgetSite", host: h });
  await refresh(true);
  renderSettings();
});
$("#fsFix").addEventListener("change", async e => {
  if (e.target.checked) {
    const ok = await chrome.permissions.request(FULLSCREEN_PERMS).catch(() => false);
    if (!ok) { e.target.checked = false; return; }
    await send({ cmd: "prefs", patch: { fullscreenFix: true } });
  } else {
    await send({ cmd: "prefs", patch: { fullscreenFix: false } });
    await chrome.permissions.remove(FULLSCREEN_PERMS).catch(() => {});
  }
  state.prefs.fullscreenFix = e.target.checked;
});
$("#shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
$("#releaseAll").addEventListener("click", async () => { errors = {}; await send({ cmd: "releaseAll" }); await refresh(true); });
$("#replayTour").addEventListener("click", () => { showSettings(false); startTour(); });

// ---------- tutorial ----------
const STEPS = [
  { t: "Benvenuto in Mixer", b: `<p>Qui trovi le schede che stanno suonando. Ognuna ha il suo cursore del volume, da 0 al 400%.</p>
      <div class="demo glass"><div class="row"><span class="label">Esempio</span>${sliderHTML("demo1", 0, 400, 160, { step: 5, label: "Esempio" })}<span class="pct boost">160%</span></div></div>` },
  { t: "Prima attiva la scheda", b: `<p>Chrome lascia regolare il volume di una scheda solo dopo che hai aperto Mixer mentre sei su quella scheda.</p>
      <ul><li>Vai sulla scheda che suona.</li><li>Clicca l'icona di Mixer, oppure usa una scorciatoia.</li><li>Il cursore si sblocca e resta attivo finché non cambi sito in quella scheda.</li></ul>
      <p>Muto e solo funzionano sempre, anche senza attivare.</p>` },
  { t: "Volume e boost", b: `<p>Oltre la tacca del 100% il cursore diventa arancio: e' il boost, fino al 400%.</p>
      <p>Il <b>limitatore</b>, in basso, tiene il suono pulito quando alzi molto. Il <b>volume generale</b> in alto agisce su tutte le schede regolate. Doppio clic su un cursore per tornare al valore normale.</p>` },
  { t: "Muto, solo, muta le altre", b: `<ul><li><b>M</b> muta o riattiva la scheda.</li><li><b>S</b> mette la scheda in solo: le altre tacciono finché lo togli, anche quelle che iniziano a suonare dopo.</li><li><b>Muta le altre</b> silenzia tutte le altre schede in un colpo.</li></ul>` },
  { t: "Effetti e siti", b: `<p>La freccia apre gli effetti della scheda: bassi, medi, alti, bilanciamento sinistra destra e mono.</p>
      <p><b>Ricorda per il sito</b> salva i valori e li rimette da soli la prossima volta che apri quel sito e apri Mixer.</p>
      <p>Il pulsante con la freccia circolare <b>libera</b> la scheda: l'audio torna a Chrome com'era.</p>
      <p>Sulle schede regolate i video a schermo intero restano dentro la finestra: libera la scheda, premi F11, oppure attiva "Schermo intero vero" nelle impostazioni.</p>` },
  { t: "Scorciatoie e sfondo", b: `<ul><li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> muto della scheda attiva</li><li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> solo</li><li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Su</kbd> / <kbd>Giù</kbd> volume più o meno 10%</li></ul>
      <p>Dall'icona delle impostazioni scegli lo sfondo (bolle, colori, grigio, nero o il tuo) e rivedi questo tutorial.</p>` },
];
let step = 0;
function drawStep() {
  const s = STEPS[step];
  $("#tourTitle").textContent = s.t;
  $("#tourBody").innerHTML = s.b;
  $("#tourBody").style.display = "grid"; $("#tourBody").style.gap = "8px";
  $("#tourBody").querySelectorAll(".slider").forEach(w => { paintSlider(w); w.querySelector("input").addEventListener("input", ev => { paintSlider(w); const o = w.parentElement.querySelector(".pct"); o.textContent = ev.target.value + "%"; o.classList.toggle("boost", ev.target.value > 100); }); });
  $("#tourDots").innerHTML = STEPS.map((_, i) => `<i class="${i === step ? "on" : ""}"></i>`).join("");
  $("#tourCount").textContent = `${step + 1} di ${STEPS.length}`;
  $("#tourBack").hidden = step === 0;
  $("#tourNext").textContent = step === STEPS.length - 1 ? "Inizia" : "Avanti";
}
function startTour() { step = 0; $("#tour").hidden = false; drawStep(); $("#tourNext").focus(); }
function endTour() {
  $("#tour").hidden = true;
  state.prefs.tutorialDone = true;
  send({ cmd: "prefs", patch: { tutorialDone: true } });
}
$("#tourNext").addEventListener("click", () => { if (step < STEPS.length - 1) { step++; drawStep(); } else endTour(); });
$("#tourBack").addEventListener("click", () => { if (step > 0) { step--; drawStep(); } });
$("#tourSkip").addEventListener("click", endTour);
addEventListener("keydown", e => {
  if ($("#tour").hidden) return;
  if (e.key === "Escape") endTour();
  if (e.key === "ArrowRight") $("#tourNext").click();
  if (e.key === "ArrowLeft") $("#tourBack").click();
});

// ---------- aggiornamento ----------
let activeTabId = null;
async function refresh(force = false) {
  const v = await send({ cmd: "state", activeTabId });
  if (!v?.tabs) return;
  state = v;
  if (force || (!dragging && sig() !== signature)) render();
}

async function meters() {
  const r = await send({ cmd: "levels" }).catch(() => null);
  const lv = r?.levels || {};
  document.querySelectorAll(".tab.captured").forEach(card => {
    // livello in dB, da -48 a 0, sulle tre barre con soglie sfalsate
    const peak = lv[card.dataset.id] || 0;
    const db = peak > 0 ? 20 * Math.log10(peak) : -96;
    const x = Math.max(0, Math.min(1, (db + 48) / 48));
    card.querySelectorAll(".vu i").forEach((b, i) => {
      const y = Math.max(0, Math.min(1, (x - i * 0.15) / (1 - i * 0.15)));
      b.style.height = (3 + 9 * y).toFixed(1) + "px";
    });
  });
}

(async function init() {
  const v = await send({ cmd: "opened" });
  if (!v?.tabs) return;
  state = v;
  activeTabId = v.tabs.find(t => t.active)?.id ?? null;
  if (v.note && activeTabId != null) errors[activeTabId] = v.note;
  applyBackground();
  renderMaster();
  render();
  if (!state.prefs.tutorialDone) startTour();
  setInterval(refresh, 1000);
  setInterval(meters, 80);
})();
