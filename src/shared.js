// Valori condivisi fra service worker, popup e documento offscreen.

export const DEFAULT_PARAMS = { vol: 100, bass: 0, mid: 0, treble: 0, pan: 0, mono: false };

export const DEFAULT_PREFS = {
  master: 100,
  limiter: true,
  background: "bolle", // bolle | colori | grigio | nero | personalizza
  custom: { base: "#14212b", c1: "#ff8f6b", c2: "#27c2b0", c3: "#ffd36e", moving: true },
  tutorialDone: false,
  fullscreenFix: false,
};

// Permessi facoltativi per "Schermo intero vero", chiesti solo se l'utente lo attiva.
export const FULLSCREEN_PERMS = { permissions: ["scripting"], origins: ["<all_urls>"] };

export function placeOf(url) {
  const h = hostOf(url);
  if (h) return h;
  if (/^file:/.test(url || "")) return "file locale";
  return "pagina di Chrome";
}

export function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : "";
  } catch { return ""; }
}

// Chrome non lascia catturare le proprie pagine, quelle delle estensioni e il Web Store.
export function isCapturable(url) {
  if (!url) return false;
  if (!/^(https?|file):/.test(url)) return false;
  return !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

export function isDefault(p) {
  return Object.keys(DEFAULT_PARAMS).every(k => p[k] === DEFAULT_PARAMS[k]);
}
