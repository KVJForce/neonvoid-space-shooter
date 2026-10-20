/* Unittests för NV.scores enligt §8 — kör: node --test (i projektroten).
   Dual-mode-mönstret: källfilerna eval:as via new Function(), NV fäster på globalThis.
   Storage injiceras via NV.scores.load(storage) — TESTERNA LANDAR ALDRIG på riktigt localStorage. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

new Function(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'))();
new Function(readFileSync(new URL('../src/scores.js', import.meta.url), 'utf8'))();
const NV = globalThis.NV;
const KEY = NV.cfg.HIGHSCORE_KEY;
const MAX = NV.cfg.HIGHSCORE_MAX;

// Fake storage-objekt (valfri initial JSON-sträng eller null = tom).
function fakeStore(initialJson) {
  const data = {};
  if (initialJson != null) data[KEY] = initialJson;
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    _data: data
  };
}

// Återställ modulläge mellan tester: hoppa av injektion (explicit null) + töm.
function reset() {
  NV.scores.load(null);
  NV.scores.clear();
}

test('tom load → [] och best() → 0', () => {
  reset();
  assert.deepEqual(NV.scores.load(), []);
  assert.equal(NV.scores.best(), 0);
});

test('add: första poängen → rank 1, isBest true, best satt', () => {
  reset();
  const r = NV.scores.add(100);
  assert.deepEqual(r, { rank: 1, isBest: true, best: 100 });
  assert.equal(NV.scores.load().length, 1);
  assert.equal(NV.scores.best(), 100);
});

test('add: datum skrivs som YYYY-MM-DD', () => {
  reset();
  NV.scores.add(77);
  const e = NV.scores.load()[0];
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('add: sämre/equal poäng → isBest false men rank ökar', () => {
  reset();
  NV.scores.add(500);
  const r2 = NV.scores.add(500);            // equal → ej > alla gamla
  assert.equal(r2.isBest, false);
  assert.equal(r2.rank, 2);
  const r3 = NV.scores.add(700);            // ny topp
  assert.equal(r3.isBest, true);
  assert.equal(r3.rank, 1);
  assert.equal(r3.best, 700);
  const r4 = NV.scores.add(450);            // mitt i, ej bäst
  assert.equal(r4.isBest, false);
  assert.equal(NV.scores.best(), 700);
});

test('ogiltigt score → rank 0, listan oförändrad', () => {
  reset();
  NV.scores.add(300);
  for (const bad of [0, -5, NaN, Infinity, '100', null]) {
    const r = NV.scores.add(bad);
    assert.equal(r.rank, 0);
    assert.equal(r.isBest, false);
  }
  assert.equal(NV.scores.load().length, 1);
});

test('cap: 9 adds → längd 8, sämsta trimmad, och senare låg add avvisas', () => {
  reset();
  const adds = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (const s of adds) {
    const r = NV.scores.add(s);
    assert.equal(r.isBest, true);           // allt stigande → varje add slår alla gamla
  }
  const list = NV.scores.load();
  assert.equal(list.length, MAX);
  assert.deepEqual(list.map((e) => e.score), [900, 800, 700, 600, 500, 400, 300, 200]);
  assert.equal(list.some((e) => e.score === 100), false); // sämsta borta
  // full lista: under minsta score kvalar inte
  assert.equal(NV.scores.qualifies(50), false);
  const r = NV.scores.add(50);
  assert.equal(r.rank, 0);
  assert.equal(r.isBest, false);
  assert.equal(NV.scores.load().length, MAX);
  // strax över minsta score kvalar och trimmar sämsta
  assert.equal(NV.scores.qualifies(201), true);
  const r2 = NV.scores.add(201);
  assert.equal(r2.rank, MAX); // in på tröskeln, sist
  assert.deepEqual(NV.scores.load().map((e) => e.score), [900, 800, 700, 600, 500, 400, 300, 201]);
});

test('datum-tie: equal poäng sorterar på datum — tidigast först', () => {
  reset();
  const fake = fakeStore(JSON.stringify([
    { score: 500, date: '2026-03-02' },
    { score: 500, date: '2026-03-01' },
    { score: 700, date: '2026-01-01' }
  ]));
  const list = NV.scores.load(fake);
  assert.deepEqual(list.map((e) => e.score), [700, 500, 500]);
  assert.deepEqual(list.map((e) => e.date), ['2026-01-01', '2026-03-01', '2026-03-02']);
});

test('tie via add: identiska score+datum → stabil ordning (först tillagd först)', () => {
  reset();
  const r1 = NV.scores.add(300);
  const r2 = NV.scores.add(300);
  assert.equal(r1.rank, 1);
  assert.equal(r2.rank, 2);
  const l = NV.scores.load();
  assert.equal(l.length, 2);
  assert.equal(l[0].score, 300);
});

test('load tolererar skräpdata: ogiltig JSON → [] utan krasch', () => {
  reset();
  assert.deepEqual(NV.scores.load(fakeStore('{definitivt-ogiltig')), []);
  assert.deepEqual(NV.scores.load(fakeStore('"bar-sträng"')), []);
  assert.deepEqual(NV.scores.load(fakeStore('42')), []);
  assert.deepEqual(NV.scores.load(fakeStore(JSON.stringify({ key: 'objekt-är-inte-array' }))), []);
});

test('load filtrerar: icke-objects, NaN/∞/≤0-score och date saknas/skräp', () => {
  reset();
  const raw = JSON.stringify([
    null,
    'sträng-entry',
    42,
    { score: 'abc', date: '2026-01-01' },
    { score: 0, date: '2026-01-01' },
    { score: -40, date: '2026-01-01' },
    { score: 300, date: 'ej-datum' },
    { score: 400 },                            // date saknas → kastas
    { score: 150, date: '2026-01-01' },        // giltig
    { score: 250, date: '2026-02-03' }         // giltig
  ]);
  const list = NV.scores.load(fakeStore(raw));
  assert.deepEqual(list, [
    { score: 250, date: '2026-02-03' },
    { score: 150, date: '2026-01-01' }
  ]);
});

test('storage som kastar på get ELLER set → fallback funkar utan krasch', () => {
  reset();
  const boom = () => { throw new Error('kaka-söndrig'); };
  const bad = { getItem: boom, setItem: boom, removeItem: boom };
  assert.doesNotThrow(() => NV.scores.load(bad));
  assert.deepEqual(NV.scores.load(bad), []);   // get kastar → [] — inte krasch
  // set kastar → add funkar ändå via in-memory fallback
  const r = NV.scores.add(123);
  assert.deepEqual(r, { rank: 1, isBest: true, best: 123 });
  assert.deepEqual(NV.scores.load().map((e) => e.score), [123]);
  assert.equal(NV.scores.best(), 123);
  // clear med kastande storage kraschar inte
  assert.doesNotThrow(() => NV.scores.clear());
});

test('qualifies-gränser: 0/negativt/NaN → false, positivt på tom lista → true', () => {
  reset();
  assert.equal(NV.scores.qualifies(0), false);
  assert.equal(NV.scores.qualifies(-1), false);
  assert.equal(NV.scores.qualifies(NaN), false);
  assert.equal(NV.scores.qualifies(Infinity), false);
  assert.equal(NV.scores.qualifies(1), true);        // tom lista + positivt
  assert.equal(NV.scores.qualifies(999999), true);
});

test('clear tömmer listan', () => {
  reset();
  NV.scores.add(400);
  NV.scores.add(500);
  assert.equal(NV.scores.load().length, 2);
  NV.scores.clear();
  assert.deepEqual(NV.scores.load(), []);
  assert.equal(NV.scores.best(), 0);
});
