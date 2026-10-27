# Chrome Mixer

Mixer audio per le schede di Chrome: volume di ogni scheda da 0 al 400% con limitatore, muto, solo, muta le altre, volume generale, equalizzatore a tre bande, bilanciamento, mono e volume salvato per sito. Popup in stile vetro, con sfondo a scelta e tutorial integrato.

*English: a per-tab audio mixer for Chrome (Manifest V3). Volume 0 to 400% with a limiter, mute, solo, mute others, master volume, 3-band EQ, balance, mono, per-site memory. Download the zip from Releases, unzip, and load the `chrome-mixer` folder with "Load unpacked" in `chrome://extensions`.*

## Installazione

1. Scarica `chrome-mixer-<versione>.zip` dall'ultima [release](https://github.com/ImJustPro/chrome-mixer/releases/latest).
2. Estrai lo zip: ottieni una cartella `chrome-mixer` con dentro `manifest.json`. Mettila in un posto dove resta, per esempio `Documenti\chrome-mixer`: Chrome la legge da lì ogni volta.
3. Apri `chrome://extensions` e attiva **Modalità sviluppatore** in alto a destra.
4. Clicca **Carica estensione non pacchettizzata** e scegli la cartella `chrome-mixer`.
5. Clicca l'icona del puzzle nella barra di Chrome e fissa **Chrome Mixer** con la puntina.

Per aggiornare: scarica la nuova release, sostituisci il contenuto della cartella e premi l'icona di ricarica sulla scheda dell'estensione in `chrome://extensions`.

Serve Chrome 116 o successivo.

## Come si usa

Al primo avvio il popup mostra un tutorial di sei passi; si rivede dalle impostazioni.

- **Attivare una scheda.** Chrome lascia regolare l'audio di una scheda solo dopo che hai aperto l'estensione mentre sei su quella scheda (clic sull'icona o scorciatoia). Le altre schede che suonano compaiono comunque nell'elenco, con muto e solo, e un pulsante **Vai** che ti porta alla scheda. Il permesso resta finché non cambi sito in quella scheda.
- **Volume.** Il cursore va da 0 al 400%. Oltre la tacca del 100% diventa arancio: è il boost. Doppio clic su un cursore per tornare al valore normale.
- **Limitatore.** Interruttore in basso. Un compressore seguito da un tetto morbido tiene l'uscita sotto 0 dBFS (misurato: picco massimo -0.7 dBFS con segnale a fondo scala, volume al 400% e generale al 200%).
- **Volume generale.** In alto, da 0 al 200%; agisce sulle schede regolate.
- **M, S, Muta le altre, Muta tutte.** Muto della scheda, solo (le altre tacciono finché lo togli, anche quelle che iniziano a suonare dopo), muto di tutte le altre, muto o ripristino di tutte. Usano il muto nativo di Chrome, quindi funzionano su tutte le schede, anche quelle non attivate.
- **Effetti** (freccia): bassi, medi, alti da -12 a +12 dB, bilanciamento sinistra destra, mono.
- **Ricorda per il sito.** Salva i valori della scheda per quel sito e li rimette quando apri il sito e apri Mixer. Si gestiscono nelle impostazioni.
- **Libera** (freccia circolare): ferma la cattura, la scheda torna a Chrome com'era. **Libera tutte** nelle impostazioni.
- **Sfondo.** Nelle impostazioni: bolle in movimento, colori, grigio, nero, oppure il tuo (colore di base, tre colori per le bolle, bolle ferme o in movimento).

### Scorciatoie

| Tasti | Azione |
| --- | --- |
| `Alt+Shift+M` | Muta o riattiva la scheda attiva |
| `Alt+Shift+S` | Solo sulla scheda attiva |
| `Alt+Shift+Su` | Volume della scheda attiva +10% |
| `Alt+Shift+Giù` | Volume della scheda attiva -10% |

Si cambiano in `chrome://extensions/shortcuts` (anche dal pulsante nelle impostazioni). Lì puoi assegnare anche un tasto per aprire il popup. Una scorciatoia conta come attivazione: `Alt+Shift+Su` su una scheda nuova la sblocca e alza il volume senza aprire il popup.

## Permessi

| Permesso | Perché serve |
| --- | --- |
| `tabCapture` | Ricevere l'audio della scheda per poterlo regolare. Chrome lo concede solo per le schede su cui hai aperto l'estensione. |
| `offscreen` | Un documento nascosto dove gira Web Audio (volume, equalizzatore, limitatore), perché il service worker non può elaborare audio. |
| `tabs` | Leggere titolo, icona e indirizzo delle schede per mostrarle nell'elenco e riconoscere il sito per "Ricorda per il sito". |
| `storage` | Salvare preferenze e volumi per sito, solo nel browser. |

Permessi **facoltativi**, chiesti solo se attivi "Schermo intero vero" nelle impostazioni e tolti quando la disattivi:

| Permesso | Perché serve |
| --- | --- |
| `scripting` + accesso ai siti | Un piccolo script (`src/fullscreen.js`) che avvisa solo quando la pagina entra o esce dallo schermo intero. Non legge altro. |

L'estensione non fa richieste di rete, non ha analisi d'uso e non manda dati da nessuna parte.

## Limiti

- **Schermo intero.** Quando una scheda è catturata, Chrome mette i video a schermo intero dentro la finestra invece che sul monitor (verificato: 1186x706 invece di 2294x960). Rimedi: attivare **Schermo intero vero** nelle impostazioni (Mixer porta a schermo intero anche la finestra e la ripristina all'uscita, verificato), premere F11, oppure liberare la scheda.
- **Una cattura per scheda.** Se un'altra estensione (per esempio Volume Master) sta già catturando una scheda, Chrome rifiuta la seconda cattura; il popup lo segnala.
- **Pagine non regolabili.** `chrome://`, il Chrome Web Store e le pagine di altre estensioni non si possono catturare: in elenco compaiono solo con muto e solo.
- **Attivazione per scheda.** Vedi sopra: è una regola di sicurezza di Chrome, nessuna estensione può aggirarla.
- **Icona di condivisione.** Mentre una scheda è catturata, Chrome mostra sulla linguetta l'indicatore di condivisione.
- **Volume generale** agisce solo sulle schede regolate (catturate), non sulle altre.
- **Ricaricare o aggiornare l'estensione** ferma tutte le catture: le schede tornano normali e vanno riattivate.
- Il passaggio dal documento offscreen aggiunge qualche millisecondo di ritardo all'audio.

## Sviluppo

```
src/
  background.js   service worker: stato, muto e solo, catture, scorciatoie
  offscreen.js    motore audio Web Audio
  popup.*         interfaccia
  shared.js       valori condivisi
  fullscreen.js   script facoltativo per lo schermo intero
scripts/
  make-icons.mjs  genera le icone PNG (node scripts/make-icons.mjs)
  build-zip.ps1   crea dist\chrome-mixer-<versione>.zip (supporta -WhatIf)
```

Catena audio di ogni scheda: downmix mono, bassi (shelf 220 Hz), medi (picco 1.2 kHz), alti (shelf 4.5 kHz), bilanciamento, volume. Poi bus generale, compressore (soglia -3 dB, rapporto 20:1) e tetto morbido a 0.98.

Nessuna dipendenza e nessun passo di build: i file in `src/` sono quelli che carica Chrome.

### Prove

La versione 1.0.0 è stata provata in Chrome for Testing con Puppeteer, cliccando davvero l'icona dell'estensione (`page.triggerExtensionAction`) su pagine che suonano toni di ampiezza nota:

- elenco delle schede, scheda non attivata bloccata, sblocco col clic sull'icona;
- volume misurato all'uscita della scheda: 300% dà 0.300, 50% dà 0.050, 200% dà 0.209 (ampiezza di partenza 0.1);
- muto (picco zero e muto nativo), solo, muta le altre, muta e riattiva tutte;
- equalizzatore, bilanciamento, mono, ricorda per sito, valori mantenuti dopo il ricaricamento della pagina;
- volume generale, limitatore, libera e libera tutte (il documento offscreen si chiude);
- pagina `chrome://` mostrata come non regolabile; i cinque sfondi; il tutorial;
- schermo intero con e senza l'opzione;
- scorciatoie premute con tasti veri: `Alt+Shift+M` muta, `Alt+Shift+Su` sblocca la scheda e alza il volume;
- nessun errore in console.

## Licenza

MIT
