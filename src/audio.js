/* NEONVOID — audio (Agent C) enligt §6: 100 % Web Audio-syntes (oscillatorer +
   noise-buffer + GainNode-envelopes), master gain 0.28, cachad noise-buffer,
   lazy init(), mute-persistens via localStorage NV.cfg.MUTED_KEY (try/catch →
   in-memory var), och no-op utan krasch när Web Audio saknas (t.ex. node).
   Ljud får ALDRIG krascha spelet — alla anrop är insvepta i try/catch. */
(function () {
  'use strict';
  var scope = (typeof window !== 'undefined') ? window : globalThis;
  var NV = (scope.NV = scope.NV || {});
  NV.audio = NV.audio || {};     // seeda regionen så metoderna kan fästas

  var MASTER = 0.28;               // master gain enligt §6
  var KEY = (NV.cfg && NV.cfg.MUTED_KEY) || 'nv.muted.v1';
  var NAMES = (NV.cfg && NV.cfg.SFX) || ['laser', 'laserEnemy', 'explode', 'explodeBig', 'playerHit', 'powerup', 'shield', 'gameover', 'select'];

  var ctx = null;                  // AudioContext när initad, annars null (no-op)
  var master = null;               // master GainNode (0 när mutad)
  var noiseBuf = null;             // cachad noise-buffer (byggs vid första burst)
  var muted = false;               // verkande läge; seedas från persist nedan

  function readPersisted() {
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) return null; // node → mem
      var v = localStorage.getItem(KEY);
      if (v === null || v === undefined) return null;
      return v === '1' || v === 'true';
    } catch (e) { return null; }   // thrown access → in-memory silent
  }

  function persist(v) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage !== null) {
        localStorage.setItem(KEY, v ? '1' : '0');
      }
      // node (typeof localStorage undefined) och quota/kast: `muted`-variabeln
      // är redan det verkande in-memory-läget — tyst fallback per kontrakt.
    } catch (e) { /* tyst */ }
  }

  muted = !!readPersisted();       // init() respekterar persisterat värde

  function audioCtor() {
    try {
      if (typeof window !== 'undefined' && window) {
        if (window.AudioContext) return window.AudioContext;
        if (window.webkitAudioContext) return window.webkitAudioContext;
      }
      if (typeof AudioContext !== 'undefined') return AudioContext;
      if (typeof webkitAudioContext !== 'undefined') return webkitAudioContext;
    } catch (e) { /* skadad miljö */ }
    return null;                   // no-WebAudio → no-op-läge
  }

  function resume() {
    try {
      if (ctx && ctx.state === 'suspended' && ctx.resume) {
        var p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* tyst */ }
  }

  /** Lazy init: skapar AudioContext + master gain vid första anrop. */
  NV.audio.init = function () {
    try {
      if (ctx) { resume(); return true; }
      var AC = audioCtor();
      if (!AC) return false;       // no-WebAudio → no-op utan crash
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
      noiseBuf = null;             // byggs vid första noise-burst
      resume();
      return true;
    } catch (e) {
      ctx = null; master = null; noiseBuf = null;
      return false;                // ljud får aldrig krascha spelet
    }
  };

  function makeNoise() {
    if (noiseBuf) return noiseBuf;
    var len = Math.max(1, Math.floor(ctx.sampleRate * 0.6));
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Oscillator-voice: sweep f0→f1 (0 = statisk) + env (snabb attack, exp-decay).
  function tone(type, f0, f1, t0, dur, peak, detune) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    if (detune) o.detune.setValueAtTime(detune, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  // Noise-burst genom filter (lowpass/bandpass) med sweep + env.
  function burst(t0, dur, peak, f0, f1, ftype) {
    var src = ctx.createBufferSource();
    src.buffer = makeNoise();
    src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = ftype || 'lowpass';
    filt.frequency.setValueAtTime(f0, t0);
    if (f1) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.008, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // Sine med vibrato (LFO modulerar frekvensen) — för sköld-tonen.
  function vibrato(t0, dur, peak, f0, vibHz, vibDepth) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t0);
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(vibHz, t0);
    var lg = ctx.createGain();
    lg.gain.setValueAtTime(vibDepth, t0);
    lfo.connect(lg);
    lg.connect(o.frequency);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0); lfo.start(t0);
    o.stop(t0 + dur + 0.03); lfo.stop(t0 + dur + 0.03);
  }

  // Karaktär per SFX-namn enligt §6 (t0 = starttid i AudioContext-klockan).
  var SFX = {
    laser: function (t) { tone('square', 880, 1760, t, 0.08, 0.16); },
    laserEnemy: function (t) { tone('sawtooth', 440, 220, t, 0.12, 0.14); },
    explode: function (t) { burst(t, 0.18, 0.3, 900, 80, 'lowpass'); },
    explodeBig: function (t) {
      burst(t, 0.32, 0.35, 700, 60, 'lowpass');
      tone('sine', 60, 0, t, 0.32, 0.4);                   // sub-thump
    },
    playerHit: function (t) {
      tone('sawtooth', 200, 60, t, 0.3, 0.14);
      tone('sawtooth', 200, 60, t, 0.3, 0.14, 18);         // 2×saw, lätt detunad
      burst(t, 0.26, 0.22, 1200, 200, 'bandpass');
    },
    powerup: function (t) {                                // 3-node arp, summa .36s
      tone('sine', 523.25, 0, t, 0.12, 0.16);
      tone('sine', 659.25, 0, t + 0.12, 0.12, 0.16);
      tone('sine', 783.99, 0, t + 0.24, 0.12, 0.16);
    },
    shield: function (t) { vibrato(t, 0.5, 0.18, 110, 6, 10); },
    gameover: function (t) {                               // fallande saw: 392→311→247→196, 1.2s
      tone('sawtooth', 392.00, 0, t, 0.3, 0.13);
      tone('sawtooth', 311.13, 0, t + 0.3, 0.3, 0.13);
      tone('sawtooth', 246.94, 0, t + 0.6, 0.3, 0.13);
      tone('sawtooth', 196.00, 0, t + 0.9, 0.3, 0.13);
    },
    select: function (t) { tone('square', 4000, 0, t, 0.04, 0.1); }
  };

  /** Spela upp namn validerat mot NV.cfg.SFX; no-op när ej initad/mutad/ogiltigt. */
  NV.audio.play = function (name) {
    try {
      if (!ctx || !master) return;                     // ej initad / no-WebAudio
      if (NAMES.indexOf(name) === -1) return;          // validera mot cfg.SFX
      if (muted) return;                               // tyst läge → hoppa nodskapande
      var gen = SFX[name];
      if (gen) gen(ctx.currentTime);
    } catch (e) { /* ljudfel får aldrig nå spelloopen */ }
  };

  /** Mute-läge: master gain 0 / återställ .28; persist i localStorage → mem-fallback. */
  NV.audio.setMuted = function (b) {
    muted = !!b;
    persist(muted);
    try {
      if (master) master.gain.value = muted ? 0 : MASTER;
    } catch (e) { /* tyst */ }
  };

  /** Växla mute-läge; returnerar nya läget (booleskt). */
  NV.audio.toggleMuted = function () {
    NV.audio.setMuted(!muted);
    return muted;
  };

  /** Nuvarande mute-läge. */
  NV.audio.isMuted = function () { return !!muted; };
})();
