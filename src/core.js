/* NEONVOID — core contract (Lead-owned). Laddas först. Alla andra regioner fäster på detta namespace. */
(function () {
  'use strict';
  var scope = (typeof window !== 'undefined') ? window : globalThis;
  var NV = (scope.NV = scope.NV || {});

  NV.cfg = Object.freeze({
    // Kanvas
    W: 1280, H: 720,
    // Spelare
    LIVES: 3,
    FIRE_COOLDOWN: 0.14, BULLET_SPEED: 950, ENEMY_BULLET_SPEED: 300,
    INVULN: 2.0,
    // Power-ups
    SHIELD_TIME: 8.0, TRI_TIME: 10.0, TRI_SPREAD_DEG: 14,
    // Spavner/difficulty ramp
    SPAWN_START: 1.4, SPAWN_END: 0.42, RAMP_TIME: 90,
    DROP_SHIP: 0.18, DROP_ROCK: 0.06,
    // Poäng
    SCORE: { SCOUT: 100, STRIKER: 250, ROCK_L: 40, ROCK_M: 25, ROCK_S: 10 },
    // Persistens
    HIGHSCORE_MAX: 8,
    HIGHSCORE_KEY: 'nv.highscores.v1',
    MUTED_KEY: 'nv.muted.v1',
    // Ljudnamn (låst lista)
    SFX: ['laser', 'laserEnemy', 'explode', 'explodeBig', 'playerHit', 'powerup', 'shield', 'gameover', 'select'],
    // States (låst lista)
    STATES: ['menu', 'playing', 'paused', 'over'],
    MAX_SHIPS: 28
  });

  var TAU = Math.PI * 2;

  NV.util = {
    TAU: TAU,
    that: '(NV.util — rena hjälpfunktioner, inga DOM/canvas-beroenden)',
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { var tt = NV.util.clamp(t, 0, 1); return a + (b - a) * tt; },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    dist: function (x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return Math.hypot(dx, dy); },
    hits: function (x1, y1, r1, x2, y2, r2) {
      var dx = x2 - x1, dy = y2 - y1, rr = r1 + r2;
      return dx * dx + dy * dy <= rr * rr;
    },
    // Difficulty-ramp: benign nära IDLE, agressivt senare.
    ramp: function (elapsedSec) {
      var t = NV.util.clamp((elapsedSec || 0) / NV.cfg.RAMP_TIME, 0, 1);
      if (t >= 1) {
        return { t: 1, interval: NV.cfg.SPAWN_END, speedMul: 1.6, strikerChance: 0.45 };
      }
      return {
        t: t,
        interval: NV.cfg.SPAWN_START - (NV.cfg.SPAWN_START - NV.cfg.SPAWN_END) * t,
        speedMul: 1 + 0.6 * t,
        strikerChance: 0.15 + 0.30 * t
      };
    }
  };

  NV.that = 'NEONVOID namespace core — see specs/CONTRACT.md for the binding contract';
})();
