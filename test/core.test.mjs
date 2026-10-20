/* Unittests för NV.util (core) — kör: node --test test/ */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

new Function(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8'))();
const NV = globalThis.NV;

test('core namespace exists', () => {
  assert.ok(NV, 'NV namespace missing');
  assert.ok(NV.cfg && NV.util);
});

test('cfg exact values', () => {
  assert.equal(NV.cfg.W, 1280);
  assert.equal(NV.cfg.H, 720);
  assert.equal(NV.cfg.LIVES, 3);
  assert.equal(NV.cfg.FIRE_COOLDOWN, 0.14);
  assert.equal(NV.cfg.HIGHSCORE_MAX, 8);
  assert.deepEqual(NV.cfg.SFX, ['laser','laserEnemy','explode','explodeBig','playerHit','powerup','shield','gameover','select']);
  assert.throws(() => { NV.cfg.W = 1; }, TypeError);
});

test('clamp/lerp bounds', () => {
  assert.equal(NV.util.clamp(5, 0, 3), 3);
  assert.equal(NV.util.clamp(-1, 0, 3), 0);
  assert.equal(NV.util.clamp(2, 0, 3), 2);
  assert.equal(NV.util.lerp(10, 20, 0.5), 15);
  assert.equal(NV.util.lerp(0, 10, 2), 10); // clamped t
});

test('rand within bounds', () => {
  for (let i = 0; i < 200; i++) {
    const r = NV.util.rand(7, 9);
    assert.ok(r >= 7 && r <= 9);
    const ri = NV.util.randInt(1, 3);
    assert.ok(Number.isInteger(ri) && ri >= 1 && ri <= 3);
  }
});

test('hits: circle collision sqrt-free', () => {
  assert.equal(NV.util.hits(0, 0, 5, 3, 4, 5), true);   // dist 5 <= 10
  assert.equal(NV.util.hits(0, 0, 2, 10, 0, 3), false); // dist 10 > 5
});

test('ramp endpoints per contract', () => {
  const s = NV.util.ramp(0);
  assert.equal(s.interval, NV.cfg.SPAWN_START); // 1.4
  assert.equal(s.speedMul, 1);
  assert.ok(Math.abs(s.strikerChance - 0.15) < 1e-9);
  const e = NV.util.ramp(90); // >= RAMP_TIME clamps
  assert.equal(e.interval, NV.cfg.SPAWN_END); // 0.42
  assert.equal(e.speedMul, 1.6);
  assert.ok(Math.abs(e.strikerChance - 0.45) < 1e-9);
  const mid = NV.util.ramp(45);
  assert.ok(Math.abs(mid.interval - 0.91) < 1e-9);
});
