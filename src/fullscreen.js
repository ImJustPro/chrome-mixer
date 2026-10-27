// Script di contenuto, attivo solo se l'utente abilita "Schermo intero vero".
// Avvisa Mixer quando la pagina entra o esce dallo schermo intero.
(() => {
  if (window.__chromeMixerFs) return;
  window.__chromeMixerFs = true;
  document.addEventListener("fullscreenchange", () => {
    chrome.runtime.sendMessage({ cmd: "fullscreen", on: !!document.fullscreenElement }).catch(() => {});
  });
})();
