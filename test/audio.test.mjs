/* Unittests för NV.audio enligt §8 — kör: node --test (i projektroten).
   Node saknar AudioContext: init()/play() ska vara no-op utan kast; mute-läget
   (setMuted/toggleMuted/isMuted) ska fungera med in-memory fallback. */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

new Function(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'))();
new Function(readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8'))();
const NV = globalThis.NV;

test('no-WebAudio: init + play (giltiga och ogiltiga namn) kastar inget', () => {
  assert.equal(typeof globalThis.AudioContext, 'undefined'); // precondition: node-miljö
  assert.equal(NV.audio.init(), false);                      // no-op → false, ingen crash
  assert.doesNotThrow(() => NV.audio.play('laser'));         // §6-flödet utan AudioContext
  assert.doesNotThrow(() => NV.audio.play('explodeBig'));
  assert.doesNotThrow(() => NV.audio.play('definitely-not-a-sfx')); // valideras mot cfg.SFX
});

test('toggleMuted togglar isMuted', () => {
  NV.audio.setMuted(false);
  const before = NV.audio.isMuted();
  NV.audio.toggleMuted();
  assert.equal(NV.audio.isMuted(), !before);
  NV.audio.toggleMuted();
  assert.equal(NV.audio.isMuted(), before);
});

test('setMuted(true) → isMuted true (och tillbaka med false)', () => {
  NV.audio.setMuted(false);                                   // reset mellan tester
  assert.equal(NV.audio.isMuted(), false);
  NV.audio.setMuted(true);
  assert.equal(NV.audio.isMuted(), true);
  assert.equal(typeof NV.audio.isMuted(), 'boolean');
  NV.audio.setMuted(0);                                       // falsy → av
  assert.equal(NV.audio.isMuted(), false);
  NV.audio.setMuted(1);                                       // truthy → på
  assert.equal(NV.audio.isMuted(), true);
  NV.audio.setMuted(false);                                   // återställ för ev. senare tester
});

test('mute-tillståndet överlever localStorage-fri miljö (in-memory fallback)', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');  // precondition per §8-anteckning
  NV.audio.setMuted(true);
  assert.equal(NV.audio.isMuted(), true);                     // persist-kast faller tyst till mem
  assert.doesNotThrow(() => NV.audio.toggleMuted());
  assert.equal(NV.audio.isMuted(), false);
  NV.audio.setMuted(false);
});
