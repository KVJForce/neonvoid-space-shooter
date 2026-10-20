/* NEONVOID — scores (Agent C) enligt §7: highscore-lista med poäng-sortsering desc
   + datum-tiebreaker (tidigast först), trim till NV.cfg.HIGHSCORE_MAX, tolerant
   laddning (ogiltig JSON/icke-array/skitsurfade entries filtreras) och ALLT
   localStorage i try/catch → in-memory fallback för hela sessionen.
   Entry-format: {score:int>0, date:'YYYY-MM-DD'}. Dual-mode: window || globalThis. */
(function () {
  'use strict';
  var scope = (typeof window !== 'undefined') ? window : globalThis;
  var NV = (scope.NV = scope.NV || {});

  var KEY = (NV.cfg && NV.cfg.HIGHSCORE_KEY) || 'nv.highscores.v1';
  var MAX = (NV.cfg && NV.cfg.HIGHSCORE_MAX) || 8;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var UNSET = {};                 // signal: localStorage ännu inte sondad

  var realC = UNSET;              // cachad sondning av localStorage (eller null)
  var injected = null;            // test-injektion: aktivt storage-lik objekt
  var injActive = false;          // sätts vid explicit load(storage)-anrop
  var fallBack = false;           // sant → hela sessionen kör i minnet
  var MEM = null;                 // in-memory fallback-data (nyckel → sträng)

  function memStore() {
    if (!MEM) MEM = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : null; },
      setItem: function (k, v) { MEM[k] = String(v); },
      removeItem: function (k) { delete MEM[k]; }
    };
  }

  function detectReal() {
    try {
      var s = (typeof localStorage !== 'undefined') ? localStorage : null;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function') {
        s.getItem(KEY);           // sond: thrown access upptäcks här
        return s;
      }
    } catch (e) { /* thrown access / sekretessläge → mem */ }
    return null;
  }

  function real() {
    if (realC === UNSET) realC = detectReal();
    return realC;
  }

  function activeStore() {
    if (fallBack) return memStore();
    if (injActive) return injected ? injected : memStore(); // explicit null → tvinga mem
    var s = real();
    return s ? s : memStore();
  }

  function sanitize(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;                        // icke-object → filtreras
      var s = (typeof e.score === 'number') ? e.score : NaN;
      if (!isFinite(s) || s <= 0) continue;                             // NaN/∞/≤0 → filtreras
      if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) continue; // date saknas/skräp → kastas
      out.push({ score: Math.floor(s), date: e.date });
    }
    return out;
  }

  function cmp(a, b) {
    if (b.score !== a.score) return b.score - a.score;                  // poäng desc
    if (a.date < b.date) return -1;                                     // tie: tidigast datum först
    if (a.date > b.date) return 1;
    return 0;
  }

  function parseList(raw) {
    if (typeof raw !== 'string' || raw === '') return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }          // ogiltig JSON → []
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed)) return []; // icke-array → []
    return sanitize(parsed).sort(cmp);
  }

  function readAll() {
    var raw = null;
    try {
      raw = activeStore().getItem(KEY);
    } catch (e) {
      fallBack = true;                                                  // thrown access → minnet
      try { raw = memStore().getItem(KEY); } catch (e2) { raw = null; }
    }
    return parseList(raw);
  }

  function writeAll(list) {
    var json;
    try { json = JSON.stringify(list); } catch (e) { return false; }
    var ok = false;
    try {
      activeStore().setItem(KEY, json);
      ok = true;
    } catch (e) {
      fallBack = true;                                                  // quota/kast → minnet
      try { memStore().setItem(KEY, json); ok = true; } catch (e2) { ok = false; }
    }
    return ok;
  }

  function num(v) {                     // poängvalidering: äkta tal, ändligt, > 0
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
    return Math.floor(v);
  }

  function today() {                    // 'YYYY-MM-DD' (lokal tid)
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return '' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  NV.scores = {
    that: '(NV.scores — highscores med tolerant persistens; load(storage) accepterar valfri storage för test)',

    /** Läs sanerad + sorterad lista. Valfri storage-lik källa som argument (test);
     *  explicit null tvingar in-memory. Default: localStorage → mem-fallback. */
    load: function (storage) {
      if (arguments.length > 0) {
        injected = (storage && typeof storage.getItem === 'function') ? storage : null;
        injActive = true;
      }
      try { return readAll(); } catch (e) { return []; }
    },

    /** true om score>0 och (plats finns i listan ELLER score slår sämsta). */
    qualifies: function (score) {
      var n = num(score);
      if (n === null) return false;
      var list = readAll();
      return list.length < MAX || n > list[list.length - 1].score;
    },

    /** Validera + infoga + trimma. Returnerar {rank (1-baserad eller 0 om ej kval),
     *  isBest (bool — score > alla gamla), best (int, topp efter infogning)}. */
    add: function (score) {
      var n = num(score);
      var list = readAll();
      var oldBest = list.length ? list[0].score : 0;
      if (n === null || !(list.length < MAX || n > list[list.length - 1].score)) {
        return { rank: 0, isBest: false, best: oldBest };               // ej kvalificerad
      }
      var isBest = (list.length === 0) ? true : n > list[0].score;
      var entry = { score: n, date: today() };
      list.push(entry);
      list.sort(cmp);
      if (list.length > MAX) list.length = MAX;                         // sämsta bort från slutet
      var rank = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i] === entry) { rank = i + 1; break; }
      }
      writeAll(list);
      return { rank: rank, isBest: isBest, best: list.length ? list[0].score : 0 };
    },

    /** Bästa poängen (listtopp), 0 om tom. */
    best: function () {
      var list = readAll();
      return list.length ? list[0].score : 0;
    },

    /** Töm listan (debug). */
    clear: function () {
      try { activeStore().removeItem(KEY); } catch (e) { fallBack = true; }
      try { memStore().removeItem(KEY); } catch (e2) { /* tyst */ }
    }
  };
})();
