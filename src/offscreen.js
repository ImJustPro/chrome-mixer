// Documento offscreen: riceve l'audio delle schede catturate e lo rimanda alle
// casse passando da equalizzatore, bilanciamento, volume e limitatore.
//
// scheda -> downmix (mono) -> upmix -> bassi -> medi -> alti -> bilanciamento -> volume -> bus generale -> limitatore -> tetto -> casse

const ctx = new AudioContext({ latencyHint: "interactive" });
const masterGain = ctx.createGain();
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -3;
limiter.knee.value = 3;
limiter.ratio.value = 20;
limiter.attack.value = 0.002;
limiter.release.value = 0.12;
// Il compressore di Web Audio aggiunge un guadagno di recupero e da solo puo' superare
// 0 dBFS di poco: dopo di lui un tetto morbido, lineare fino a 0.8 e mai oltre 0.98.
const trim = ctx.createGain();
trim.gain.value = 0.9;
const pre = ctx.createGain();
pre.gain.value = 0.5; // la curva copre l'ingresso da -2 a 2
const ceiling = ctx.createWaveShaper();
ceiling.oversample = "2x";
ceiling.curve = (() => {
  const n = 4097, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(x);
    c[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
  }
  return c;
})();
limiter.connect(trim).connect(pre).connect(ceiling).connect(ctx.destination);
const outMeter = ctx.createAnalyser(); outMeter.fftSize = 2048;
const outBuf = new Float32Array(outMeter.fftSize);
ceiling.connect(outMeter);

let limiterOn = true;
function route() {
  masterGain.disconnect();
  masterGain.connect(limiterOn ? limiter : ctx.destination);
}
route();

const chains = new Map(); // tabId -> { stream, nodes... }
const smooth = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.015);

function build(stream) {
  const src = ctx.createMediaStreamSource(stream);
  const down = ctx.createGain();
  down.channelCountMode = "explicit";
  down.channelInterpretation = "speakers";
  down.channelCount = 2;
  const up = ctx.createGain();
  up.channelCountMode = "explicit";
  up.channelInterpretation = "speakers";
  up.channelCount = 2;
  const bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 220;
  const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = 0.8;
  const treble = ctx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 4500;
  const pan = ctx.createStereoPanner();
  const gain = ctx.createGain();
  const meter = ctx.createAnalyser(); meter.fftSize = 512;
  src.connect(down).connect(up).connect(bass).connect(mid).connect(treble).connect(pan).connect(gain);
  gain.connect(masterGain);
  gain.connect(meter);
  return { stream, src, down, bass, mid, treble, pan, gain, meter, buf: new Float32Array(meter.fftSize) };
}

function apply(ch, a) {
  ch.down.channelCount = a.mono ? 1 : 2;
  smooth(ch.bass.gain, a.bass);
  smooth(ch.mid.gain, a.mid);
  smooth(ch.treble.gain, a.treble);
  smooth(ch.pan.pan, a.pan / 100);
  smooth(ch.gain.gain, a.muted ? 0 : a.vol / 100);
}

function applyPrefs(p) {
  smooth(masterGain.gain, p.master / 100);
  if (limiterOn !== p.limiter) { limiterOn = p.limiter; route(); }
}

async function start(tabId, streamId, audio, prefs) {
  if (chains.has(tabId)) stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  });
  if (ctx.state !== "running") await ctx.resume();
  const ch = build(stream);
  chains.set(tabId, ch);
  apply(ch, audio);
  applyPrefs(prefs);
  stream.getAudioTracks()[0].addEventListener("ended", () => {
    stop(tabId);
    chrome.runtime.sendMessage({ cmd: "ended", tabId });
  });
}

function stop(tabId) {
  const ch = chains.get(tabId);
  if (!ch) return;
  ch.stream.getTracks().forEach(t => t.stop());
  ch.src.disconnect();
  ch.gain.disconnect();
  chains.delete(tabId);
}

function levels() {
  const out = {};
  for (const [id, ch] of chains) {
    ch.meter.getFloatTimeDomainData(ch.buf);
    let peak = 0;
    for (const v of ch.buf) { const a = Math.abs(v); if (a > peak) peak = a; }
    out[id] = peak;
  }
  outMeter.getFloatTimeDomainData(outBuf);
  let outPeak = 0;
  for (const v of outBuf) { const a = Math.abs(v); if (a > outPeak) outPeak = a; }
  return { levels: out, out: limiterOn ? outPeak : null, reduction: limiter.reduction, captured: [...chains.keys()] };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target !== "offscreen") return false;
  (async () => {
    switch (msg.cmd) {
      case "start": await start(msg.tabId, msg.streamId, msg.audio, msg.prefs); return { ok: true };
      case "update": { const ch = chains.get(msg.tabId); if (ch) apply(ch, msg.audio); return { ok: !!ch }; }
      case "stop": stop(msg.tabId); return { ok: true };
      case "prefs": applyPrefs(msg.prefs); return { ok: true };
      case "levels": return levels();
    }
    return { ok: false, error: "comando sconosciuto" };
  })().then(reply, err => reply({ ok: false, error: String(err?.message || err) }));
  return true;
});
