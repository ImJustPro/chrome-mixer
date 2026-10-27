// Service worker: tiene lo stato delle schede, gestisce muto e solo con il muto
// nativo di Chrome, e passa le catture audio al documento offscreen.

import { DEFAULT_PARAMS, DEFAULT_PREFS, FULLSCREEN_PERMS, hostOf, isCapturable, isDefault, placeOf } from "./shared.js";

const OFFSCREEN_URL = "src/offscreen.html";

// ---------- stato ----------
// session: { tabs: { [id]: { params, muted, captured, invoked, seen } }, solo }
// local:   { sites: { [host]: params }, prefs }

async function load() {
  const s = await chrome.storage.session.get({ tabs: {}, solo: null });
  const l = await chrome.storage.local.get({ sites: {}, prefs: DEFAULT_PREFS });
  return { tabs: s.tabs, solo: s.solo, sites: l.sites, prefs: { ...DEFAULT_PREFS, ...l.prefs } };
}

// Le modifiche passano tutte da qui, in coda, per non perdere scritture concorrenti.
let queue = Promise.resolve();
function withState(fn) {
  const run = queue.then(async () => {
    const st = await load();
    const out = await fn(st);
    await chrome.storage.session.set({ tabs: st.tabs, solo: st.solo });
    await chrome.storage.local.set({ sites: st.sites, prefs: st.prefs });
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

function entry(st, tabId) {
  const k = String(tabId);
  if (!st.tabs[k]) st.tabs[k] = { params: { ...DEFAULT_PARAMS }, muted: false, captured: false, invoked: false, seen: false };
  return st.tabs[k];
}

const effMuted = (st, tabId) => !!st.tabs[tabId]?.muted || (st.solo != null && st.solo !== tabId);

// ---------- offscreen ----------
let creating = null;
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (ctx.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "Elabora l'audio delle schede catturate (volume, equalizzatore, limitatore).",
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", ...msg });
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;
}

function audioState(st, tabId) {
  return { ...st.tabs[tabId].params, muted: effMuted(st, Number(tabId)) };
}

// Prova a catturare una scheda. Restituisce null se va bene, altrimenti il motivo.
async function capture(st, tabId) {
  const e = entry(st, tabId);
  if (e.captured) return null;
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    const m = String(err?.message || err);
    if (/active stream/i.test(m)) return "occupata";
    if (/invoked|activeTab|Chrome pages/i.test(m)) { e.invoked = false; return "da-attivare"; }
    return m;
  }
  const res = await toOffscreen({ cmd: "start", tabId, streamId, audio: audioState(st, tabId), prefs: st.prefs });
  if (!res?.ok) return res?.error || "errore";
  e.captured = true;
  return null;
}

async function release(st, tabId) {
  const e = st.tabs[tabId];
  if (!e?.captured) return;
  e.captured = false;
  if (await hasOffscreen()) await chrome.runtime.sendMessage({ target: "offscreen", cmd: "stop", tabId });
  await closeOffscreenIfIdle(st);
}

async function closeOffscreenIfIdle(st) {
  const any = Object.values(st.tabs).some(t => t.captured);
  if (!any && await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

// Applica muto e solo a tutte le schede note, col muto nativo; le schede catturate
// ricevono anche il guadagno a zero nel documento offscreen.
async function syncMutes(st) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const known = st.tabs[t.id];
    if (!known && st.solo == null) continue;
    const want = effMuted(st, t.id);
    if (!!t.mutedInfo?.muted !== want) {
      if (want || known) await chrome.tabs.update(t.id, { muted: want }).catch(() => {});
      if (want) entry(st, t.id).seen = true;
    }
    if (known?.captured) await toOffscreen({ cmd: "update", tabId: t.id, audio: audioState(st, t.id) });
  }
  await updateBadges(st);
}

async function pushAudio(st, tabId) {
  if (st.tabs[tabId]?.captured) await toOffscreen({ cmd: "update", tabId, audio: audioState(st, tabId) });
}

async function updateBadges(st) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const e = st.tabs[t.id];
    let text = "";
    if (effMuted(st, t.id) && e) text = "off";
    else if (e?.captured && e.params.vol !== 100) text = String(e.params.vol);
    chrome.action.setBadgeText({ tabId: t.id, text }).catch(() => {});
    if (text) chrome.action.setBadgeBackgroundColor({ tabId: t.id, color: text === "off" ? "#c93c3c" : e.params.vol > 100 ? "#e0702f" : "#0e9e90" }).catch(() => {});
  }
}

// Applica i parametri salvati per il sito della scheda, se ci sono.
function applySite(st, tabId, url) {
  const e = entry(st, tabId);
  const saved = st.sites[hostOf(url)];
  if (saved) { e.params = { ...DEFAULT_PARAMS, ...saved }; e.fromSite = true; return true; }
  return false;
}

// ---------- vista per il popup ----------
async function view(st, activeTabId) {
  const all = await chrome.tabs.query({});
  const out = [];
  for (const t of all) {
    const e = st.tabs[t.id];
    const show = t.audible || t.mutedInfo?.muted || e?.captured || e?.seen || t.id === activeTabId;
    if (!show) continue;
    if (t.audible && e && !e.seen) e.seen = true;
    const host = hostOf(t.url);
    out.push({
      id: t.id, windowId: t.windowId, title: t.title || host || "Scheda", host, place: placeOf(t.url), favIconUrl: t.favIconUrl || "",
      audible: !!t.audible, active: t.id === activeTabId,
      capturable: isCapturable(t.url),
      params: e?.params || st.sites[host] || { ...DEFAULT_PARAMS },
      muted: !!e?.muted, effMuted: effMuted(st, t.id),
      captured: !!e?.captured, invoked: !!e?.invoked || !!e?.captured,
      remember: !!st.sites[host],
    });
  }
  out.sort((a, b) => (b.active - a.active) || (b.audible - a.audible) || a.id - b.id);
  return { tabs: out, solo: st.solo, prefs: st.prefs, sites: st.sites };
}

// ---------- comandi ----------
async function handle(msg, sender) {
  switch (msg.cmd) {
    case "opened": // il popup si e' aperto sulla scheda attiva: Chrome ci permette di catturarla
      return withState(async st => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let note = null;
        if (tab && isCapturable(tab.url)) {
          const e = entry(st, tab.id);
          e.invoked = true;
          if (!e.captured && !st.tabs[tab.id].touched && applySite(st, tab.id, tab.url) && !isDefault(e.params)) {
            note = await capture(st, tab.id);
          }
        }
        const v = await view(st, tab?.id);
        v.note = note;
        return v;
      });

    case "state":
      return withState(st => view(st, msg.activeTabId));

    case "set": // patch dei parametri audio di una scheda
      return withState(async st => {
        const tab = await chrome.tabs.get(msg.tabId);
        const e = entry(st, msg.tabId);
        e.params = { ...e.params, ...msg.patch };
        e.touched = true;
        e.seen = true;
        const host = hostOf(tab.url);
        if (st.sites[host]) st.sites[host] = { ...e.params };
        let error = null;
        if (!e.captured && !isDefault(e.params)) error = await capture(st, msg.tabId);
        else await pushAudio(st, msg.tabId);
        await updateBadges(st);
        return { error };
      });

    case "capture":
      return withState(async st => ({ error: await capture(st, msg.tabId) }));

    case "release":
      return withState(async st => {
        await release(st, msg.tabId);
        const e = st.tabs[msg.tabId];
        if (e) { e.params = { ...DEFAULT_PARAMS }; e.touched = true; }
        await updateBadges(st);
        return {};
      });

    case "mute":
      return withState(async st => {
        const e = entry(st, msg.tabId);
        e.seen = true;
        if (st.solo != null && st.solo !== msg.tabId && effMuted(st, msg.tabId) && !e.muted) {
          st.solo = null; // riattivare a mano una scheda esclusa dal solo toglie il solo
        } else e.muted = msg.muted ?? !e.muted;
        await syncMutes(st);
        return {};
      });

    case "solo":
      return withState(async st => {
        st.solo = st.solo === msg.tabId ? null : msg.tabId;
        if (st.solo != null) entry(st, msg.tabId).muted = false;
        await syncMutes(st);
        return {};
      });

    case "muteOthers":
      return withState(async st => {
        const v = await view(st, msg.tabId);
        for (const t of v.tabs) entry(st, t.id).muted = t.id !== msg.tabId;
        st.solo = null;
        await syncMutes(st);
        return {};
      });

    case "muteAll":
      return withState(async st => {
        const v = await view(st, null);
        const allMuted = v.tabs.length > 0 && v.tabs.every(t => t.effMuted);
        for (const t of v.tabs) entry(st, t.id).muted = !allMuted;
        st.solo = null;
        await syncMutes(st);
        return {};
      });

    case "remember":
      return withState(async st => {
        const tab = await chrome.tabs.get(msg.tabId);
        const host = hostOf(tab.url);
        if (!host) return {};
        if (msg.on) st.sites[host] = { ...entry(st, msg.tabId).params };
        else delete st.sites[host];
        return {};
      });

    case "forgetSite":
      return withState(async st => { delete st.sites[msg.host]; return {}; });

    case "prefs":
      return withState(async st => {
        st.prefs = { ...st.prefs, ...msg.patch };
        if ("fullscreenFix" in msg.patch) await setFullscreenFix(st.prefs.fullscreenFix);
        if (await hasOffscreen()) await chrome.runtime.sendMessage({ target: "offscreen", cmd: "prefs", prefs: st.prefs });
        return {};
      });

    case "fullscreen": // dallo script di contenuto: la pagina e' entrata o uscita dallo schermo intero
      return withState(async st => {
        const tab = sender?.tab;
        if (!tab || !st.prefs.fullscreenFix) return {};
        const s = await chrome.storage.session.get({ fsWindows: {} });
        const key = String(tab.windowId);
        if (msg.on && st.tabs[tab.id]?.captured) {
          const win = await chrome.windows.get(tab.windowId);
          if (win.state !== "fullscreen") {
            s.fsWindows[key] = win.state;
            await chrome.windows.update(tab.windowId, { state: "fullscreen" });
          }
        } else if (!msg.on && s.fsWindows[key]) {
          await chrome.windows.update(tab.windowId, { state: s.fsWindows[key] }).catch(() => {});
          delete s.fsWindows[key];
        }
        await chrome.storage.session.set({ fsWindows: s.fsWindows });
        return {};
      });

    case "releaseAll":
      return withState(async st => {
        for (const id of Object.keys(st.tabs)) {
          const e = st.tabs[id];
          if (e.captured) await release(st, Number(id));
          e.params = { ...DEFAULT_PARAMS }; e.touched = true; e.fromSite = false;
        }
        await updateBadges(st);
        return {};
      });

    case "levels":
      if (!(await hasOffscreen())) return {};
      return chrome.runtime.sendMessage({ target: "offscreen", cmd: "levels" });

    case "focus":
      await chrome.tabs.update(msg.tabId, { active: true });
      await chrome.windows.update(msg.windowId, { focused: true });
      return {};

    case "ended": // la cattura si e' chiusa da sola (scheda chiusa o cattura interrotta da Chrome)
      return withState(async st => {
        const e = st.tabs[msg.tabId];
        if (e) e.captured = false;
        await closeOffscreenIfIdle(st);
        await updateBadges(st);
        return {};
      });
  }
  return { error: "comando sconosciuto" };
}

// ---------- schermo intero vero (facoltativo) ----------
// Chrome tiene a schermo intero "dentro la finestra" i video delle schede catturate.
// Con il permesso facoltativo uno script di contenuto avvisa quando la pagina va a
// schermo intero, e Mixer mette a schermo intero anche la finestra.
async function setFullscreenFix(on) {
  const has = chrome.scripting && await chrome.permissions.contains(FULLSCREEN_PERMS);
  if (!has) return;
  const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ["fullscreen"] });
  if (on && !reg.length) {
    await chrome.scripting.registerContentScripts([{ id: "fullscreen", js: ["src/fullscreen.js"], matches: ["<all_urls>"], runAt: "document_start" }]);
    for (const t of await chrome.tabs.query({})) {
      if (isCapturable(t.url)) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["src/fullscreen.js"] }).catch(() => {});
    }
  }
  if (!on && reg.length) await chrome.scripting.unregisterContentScripts({ ids: ["fullscreen"] });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target === "offscreen") return false;
  handle(msg, sender).then(reply, err => reply({ error: String(err?.message || err) }));
  return true;
});

// ---------- scorciatoie ----------
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  // La scorciatoia conta come invocazione dell'estensione su questa scheda.
  await withState(async st => { if (isCapturable(tab.url)) entry(st, tab.id).invoked = true; });
  if (command === "toggle-mute") return handle({ cmd: "mute", tabId: tab.id });
  if (command === "toggle-solo") return handle({ cmd: "solo", tabId: tab.id });
  if (command === "volume-up" || command === "volume-down") {
    const st = await load();
    const cur = st.tabs[tab.id]?.params?.vol ?? st.sites[hostOf(tab.url)]?.vol ?? 100;
    const vol = Math.max(0, Math.min(400, cur + (command === "volume-up" ? 10 : -10)));
    return handle({ cmd: "set", tabId: tab.id, patch: { vol } });
  }
});

// ---------- eventi delle schede ----------
chrome.tabs.onRemoved.addListener(tabId => withState(async st => {
  await release(st, tabId);
  delete st.tabs[tabId];
  if (st.solo === tabId) { st.solo = null; await syncMutes(st); }
}));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.mutedInfo && info.mutedInfo.reason === "user") {
    // muto cambiato dall'utente nella barra delle schede: lo seguiamo
    withState(async st => {
      const e = entry(st, tabId);
      e.seen = true;
      e.muted = info.mutedInfo.muted;
      if (!e.muted && st.solo != null && st.solo !== tabId) { st.solo = null; await syncMutes(st); }
      await pushAudio(st, tabId);
      await updateBadges(st);
    });
  }
  if (info.audible === true) {
    withState(async st => {
      entry(st, tabId).seen = true;
      if (st.solo != null && st.solo !== tabId) await syncMutes(st); // una scheda nuova suona durante il solo
    });
  }
  if (info.url) {
    // cambio di pagina: Chrome ritira il permesso di cattura, la cattura gia' aperta resta
    withState(async st => {
      const e = st.tabs[tabId];
      if (!e) return;
      if (!e.captured) e.invoked = false;
      const prevSite = e.fromSite;
      if (applySite(st, tabId, info.url)) { e.fromSite = true; await pushAudio(st, tabId); }
      else if (prevSite) { e.params = { ...DEFAULT_PARAMS }; e.fromSite = false; await pushAudio(st, tabId); }
      await updateBadges(st);
    });
  }
});

chrome.runtime.onStartup.addListener(() => chrome.storage.session.clear());
