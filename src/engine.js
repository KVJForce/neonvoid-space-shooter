/* NEONVOID — engine (Agent B): gameloop, input, spawner, fysik, kollisioner, render.
   Kontrakt: specs/CONTRACT.md §2–§3. Endast canvas-DOM. ES5/var-stil som core.js.
   Kollar NV.util.hits (kvadratisk) för ALLA kollisioner — inga egna dist-dupletter. */
(function () {
  'use strict';

  var scope = (typeof window !== 'undefined') ? window : globalThis;
  var NV = scope.NV || (scope.NV = {});
  var cfg = NV.cfg;      // frusen kontraktstabell från core.js
  var U = NV.util;       // kontrakts-helpers — används, aldrig dubletter
  var TAU = U.TAU;

  var COL = {
    bg: '#04060f', cyan: '#00fff7', magenta: '#ff2bd6', violet: '#7a2bff',
    amber: '#ffb44a', dim: '#9aa7c1', danger: '#ff3355', white: '#ffffff'
  };

  var PLAYER_R = 13, PLAYER_SPEED = 460, BOLT_R = 4;
  var SHAKE_HIT = 14, SHAKE_DECAY = 34;
  var PART_CAP = 260, FX_CAP = 12;
  var ROCKDEF = {
    L: { r: 34, hp: 3, score: cfg.SCORE.ROCK_L },
    M: { r: 22, hp: 2, score: cfg.SCORE.ROCK_M },
    S: { r: 14, hp: 1, score: cfg.SCORE.ROCK_S }
  };
  var STARSPEED = [22, 48, 96];
  var FONT = '700 14px Consolas, "Cascadia Mono", "Courier New", monospace';

  var game = (NV.game = NV.game || {});

  game.create = function (canvasEl, hooks) {
    var cv = canvasEl;
    var ctx = (cv && cv.getContext) ? cv.getContext('2d') : null;

    var cbState = null, cbHud = null, cbOver = null;
    if (hooks) {
      cbState = (typeof hooks.onState === 'function') ? hooks.onState : null;
      cbHud = (typeof hooks.onHud === 'function') ? hooks.onHud : null;
      cbOver = (typeof hooks.onGameOver === 'function') ? hooks.onGameOver : null;
    }

    /* --- lägesvariabler --- */
    var state = 'menu', rafId = -1, lastT = null, running = true, destroyed = false;
    var ambT = 0;                                   // ambient-tid (rör sig i alla states)
    var player = { x: cfg.W * 0.5, y: cfg.H - 90, alive: false };
    var score = 0, lives = cfg.LIVES, kills = 0, elapsed = 0, hiCache = 0;
    var cooldown = 0, invuln = 0, shield = 0, tri = 0;
    var shake = 0, spawnT = 0, flameAcc = 0, shootHeld = false;
    var keyUp = false, keyDown = false, keyLeft = false, keyRight = false;
    var hudAcc = 0, hudForce = false, lastHudScore = -1, lastHudLives = -1;
    var overPending = false, overRes = null;

    /* --- objekt-pooler (reuse — inga nya objekt per frame) --- */
    var bullets = mkpool(), ships = mkpool(), rocks = mkpool(), ebul = mkpool(),
        parts = mkpool(), pows = mkpool(), fx = mkpool();

    function mkpool() { return { list: [], pool: [], n: 0 }; }
    function pspawn(p) { var o = p.pool.pop(); if (!o) o = {}; p.list[p.n] = o; p.n++; return o; }
    function pkill(p, i) { p.pool.push(p.list[i]); p.list[i] = p.list[p.n - 1]; p.n--; }
    function pclear(p) { var i; for (i = 0; i < p.n; i++) p.pool.push(p.list[i]); p.list.length = 0; p.n = 0; }

    /* --- stjärnhimmel: 3 parallax-lager 120/60/30, wrap --- */
    var star0 = [], star1 = [], star2 = [];
    var STARCOL = ['rgba(154,167,193,0.60)', 'rgba(0,255,247,0.55)', 'rgba(255,255,255,0.85)'];

    function initStars() {
      var l, i, cnt = [120, 60, 30];
      for (l = 0; l < 3; l++) {
        for (i = 0; i < cnt[l]; i++) {
          var s = { x: U.rand(0, cfg.W), y: U.rand(0, cfg.H) };
          if (l === 0) star0.push(s); else if (l === 1) star1.push(s); else star2.push(s);
        }
      }
    }

    /* --- missing-API-vänliga wrappers (kontrakt §2, inga stubs skapas) --- */
    function sfx(name) {
      try { if (NV.audio && typeof NV.audio.play === 'function') NV.audio.play(name); } catch (e) {}
    }
    function loadHi() {
      var v = 0;
      try {
        var l = (NV.scores && typeof NV.scores.load === 'function') ? NV.scores.load() : null;
        if (l && l.length && l[0]) v = l[0].score || 0;
      } catch (e) { v = 0; }
      return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
    }

    /* --- input (window-nivå, håll-in-flerslag via boolsatser) --- */
    function onKeyDown(e) {
      var c = (e && e.code) ? e.code : '';
      if (c === 'Space') shootHeld = true;
      else if (c === 'KeyW' || c === 'ArrowUp') keyUp = true;
      else if (c === 'KeyS' || c === 'ArrowDown') keyDown = true;
      else if (c === 'KeyA' || c === 'ArrowLeft') keyLeft = true;
      else if (c === 'KeyD' || c === 'ArrowRight') keyRight = true;
      else if ((c === 'KeyP' || c === 'Escape') && !e.repeat) {
        if (state === 'playing') setState('paused');
        else if (state === 'paused') { lastT = null; setState('playing'); }
      }
      if (state !== 'menu' && (c === 'Space' || c.indexOf('Arrow') === 0)) {
        if (e.preventDefault) e.preventDefault();
      }
    }
    function onKeyUp(e) {
      var c = (e && e.code) ? e.code : '';
      if (c === 'Space') shootHeld = false;
      else if (c === 'KeyW' || c === 'ArrowUp') keyUp = false;
      else if (c === 'KeyS' || c === 'ArrowDown') keyDown = false;
      else if (c === 'KeyA' || c === 'ArrowLeft') keyLeft = false;
      else if (c === 'KeyD' || c === 'ArrowRight') keyRight = false;
    }
    function onBlur() { keyUp = keyDown = keyLeft = keyRight = false; shootHeld = false; }

    /* --- state/HUD --- */
    function setState(s) {
      if (destroyed) return;
      state = s;
      if (cbState) cbState(s);
    }

    function resetRun() {
      score = 0; kills = 0; lives = cfg.LIVES; elapsed = 0;
      cooldown = 0; invuln = 0; shield = 0; tri = 0; shake = 0;
      spawnT = U.ramp(0).interval; flameAcc = 0; shootHeld = false;
      pclear(bullets); pclear(ships); pclear(rocks); pclear(ebul);
      pclear(parts); pclear(pows); pclear(fx);
      player.x = cfg.W * 0.5; player.y = cfg.H - 90; player.alive = true;
      hudAcc = 0; hudForce = true; lastHudScore = -1; lastHudLives = -1;
      overPending = false; overRes = null;
      hiCache = loadHi();          // kontrakt: hi cacheas vid run-start (NV.scores.load()[0]?.score||0)
    }

    function hudEmit() {
      lastHudScore = score; lastHudLives = lives;
      if (cbHud) cbHud({ score: score, hi: hiCache, lives: lives, shield: shield, tri: tri });
    }

    function hudTick(dt) {
      hudAcc += dt;
      if (hudForce || lastHudScore !== score || lastHudLives !== lives || hudAcc >= 0.2) {
        hudAcc = 0; hudForce = false; hudEmit();
      }
    }

    /* --- spelare träffad (osköldad): liv-- + blink + shake --- */
    function playerDamage() {
      lives = Math.max(0, lives - 1);
      invuln = cfg.INVULN; shake = SHAKE_HIT;
      sfx('playerHit'); sfx('explode');
      burst(player.x, player.y, COL.amber, 16, 320);
      shatter(player.x, player.y, COL.danger, 6, 260);
      hudForce = true;
      if (lives <= 0) enterOver();
    }

    /* --- over-state: sim fryst men rAF fortsätter; onGameOver nästa frame --- */
    function enterOver() {
      player.alive = false;
      sfx('gameover');
      overRes = { score: score, seconds: Math.round(elapsed * 100) / 100, kills: kills };
      overPending = true;
      setState('over');
      hudEmit();               // flush: lives=0 + slutpoäng (hudTick pausas i 'over')
    }

    /* ============================================================
       SPAWNER (endast playing) — tick per ramp.interval (kontrakt §3)
       ============================================================ */
    function spawnTick(rmp) {
      if (Math.random() < 0.4) spawnRock(rmp);
      else if (ships.n < cfg.MAX_SHIPS) spawnShip(rmp);
    }

    function spawnRock(rmp) {
      var q = Math.random(), size = (q < 0.4) ? 'L' : ((q < 0.8) ? 'M' : 'S');
      var o = pspawn(rocks), d = ROCKDEF[size], k, n = U.randInt(8, 11);
      if (!o.pts) o.pts = [];
      o.size = size; o.r = d.r; o.hp = d.hp;
      o.x = U.rand(40, cfg.W - 40); o.y = -40;
      o.vx = U.rand(-40, 40); o.vy = U.rand(55, 160) * rmp.speedMul;
      o.ang = U.rand(0, TAU); o.av = U.rand(-1.8, 1.8);
      for (k = 0; k < n; k++) o.pts[k] = d.r * U.rand(0.72, 1.28);
      o.np = n;
    }

    function spawnShip(rmp) {
      var striker = Math.random() < rmp.strikerChance;
      var s = pspawn(ships);
      s.striker = striker;
      s.baseX = U.rand(40, cfg.W - 40); s.x = s.baseX; s.y = -30;
      s.vy = (striker ? U.rand(80, 140) : U.rand(110, 170)) * rmp.speedMul;
      s.r = striker ? 22 : 18;
      s.hp = striker ? 2 : 1;
      s.t = 0; s.phase = U.rand(0, TAU); s.hx = 0;
      s.shootT = U.rand(0.8, 1.8);
    }

    /* ============================================================
       SKOTT (spelare): bolt r4 dmg1 |v|=BULLET_SPEED; tri → 3 st ±TRI_SPREAD_DEG
       ============================================================ */
    function fire() {
      var spd = cfg.BULLET_SPEED, a = cfg.TRI_SPREAD_DEG * Math.PI / 180, k;
      sfx('laser');
      if (tri > 0) { bolt(0, spd); bolt(a, spd); bolt(-a, spd); }
      else bolt(0, spd);
      for (k = 0; k < 3; k++) {
        if (parts.n >= PART_CAP) break;
        var m = pspawn(parts), amt = U.rand(0, TAU), v = U.rand(30, 90);
        m.x = player.x + U.rand(-3, 3); m.y = player.y - 15;
        m.vx = Math.cos(amt) * v; m.vy = Math.sin(amt) * v - 40;
        m.life = m.max = 0.08; m.size = U.rand(1.5, 3); m.col = COL.white;
        m.kind = 0; m.a = 0; m.spin = 0; m.len = 0;
      }
    }

    function bolt(a, spd) {
      var b = pspawn(bullets);
      b.x = player.x + Math.sin(a) * 8; b.y = player.y - 13;
      b.vx = Math.sin(a) * spd; b.vy = -Math.cos(a) * spd;
    }

    /* --- fiendeskott: aimed bullet, r3 magenta --- */
    function enemyFire(s) {
      var dx = player.x - s.x, dy = player.y - s.y;
      var l = Math.sqrt(dx * dx + dy * dy);
      if (l < 1) { dx = 0; dy = 1; l = 1; }
      var v = cfg.ENEMY_BULLET_SPEED, b = pspawn(ebul);
      b.x = s.x; b.y = s.y + s.r * 0.5;
      b.vx = dx / l * v; b.vy = dy / l * v;
      sfx('laserEnemy');
    }

    /* ============================================================
       KILL-RUTINER (poäng + explode + shards + ev powerup-drop)
       ============================================================ */
    function maybeDrop(x, y, chance) {
      if (Math.random() >= chance) return;
      if (pows.n >= 40) return;
      var o = pspawn(pows);
      o.type = (Math.random() < 0.5) ? 'shield' : 'tri';
      o.x = U.clamp(x, 20, cfg.W - 20); o.y = y;
      o.vy = U.rand(120, 170); o.t = 0; o.r = 15;
    }

    function killShip(i, scored) {
      var s = ships.list[i], x = s.x, y = s.y, st = s.striker;
      pkill(ships, i);
      if (scored) {
        score += st ? cfg.SCORE.STRIKER : cfg.SCORE.SCOUT;
        kills++;
        sfx(st ? 'explodeBig' : 'explode');
        burst(x, y, st ? COL.magenta : COL.cyan, st ? 18 : 14, 300);
        shatter(x, y, st ? COL.magenta : COL.cyan, st ? 8 : 6, 240);
        maybeDrop(x, y, cfg.DROP_SHIP);
        hudForce = true;
      } else {
        burst(x, y, COL.dim, 10, 240);
      }
    }

    function killRock(i, scored) {
      var o = rocks.list[i];
      var x = o.x, y = o.y, size = o.size, vy = o.vy;
      pkill(rocks, i);
      if (scored) {
        score += ROCKDEF[size].score;
        kills++;
        sfx(size === 'L' ? 'explodeBig' : 'explode');
        if (size === 'L') burst(x, y, COL.amber, 22, 320);
        else burst(x, y, '#cbd5e8', size === 'M' ? 16 : 11, 260);
        shatter(x, y, '#8fa3bf', size === 'L' ? 8 : (size === 'M' ? 5 : 3), 220);
        maybeDrop(x, y, cfg.DROP_ROCK);
        hudForce = true;
        splitRock(x, y, size, vy);
      } else {
        burst(x, y, COL.dim, 10, 240);
      }
    }

    function splitRock(x, y, size, parentVy) {
      if (size === 'S') return;
      var cs = (size === 'L') ? 'M' : 'S';
      var d = ROCKDEF[cs], k;
      for (k = 0; k < 2; k++) {
        var o = pspawn(rocks), j, n = U.randInt(8, 11);
        if (!o.pts) o.pts = [];
        o.size = cs; o.r = d.r; o.hp = d.hp;
        o.x = U.clamp(x + (k === 0 ? -18 : 18), 24, cfg.W - 24); o.y = y;
        o.vx = (k === 0) ? -60 : 60; o.vy = parentVy - 20;
        o.ang = U.rand(0, TAU); o.av = U.rand(-1.8, 1.8);
        for (j = 0; j < n; j++) o.pts[j] = d.r * U.rand(0.72, 1.28);
        o.np = n;
      }
    }

    /* --- powerup-pickup: dist<26, max-trick, ljud + floater + ripple --- */
    function pickupPass() {
      var i, o;
      for (i = pows.n - 1; i >= 0; i--) {
        o = pows.list[i];
        if (U.dist(player.x, player.y, o.x, o.y) < 26) {
          if (o.type === 'shield') {
            shield = Math.max(shield, cfg.SHIELD_TIME);
            sfx('shield');
            pushText('+SKÖLD', o.x, o.y, COL.cyan);
            pushRipple(o.x, o.y, COL.cyan);
          } else {
            tri = Math.max(tri, cfg.TRI_TIME);
            sfx('powerup');
            pushText('+TRISKOTT', o.x, o.y, COL.magenta);
            pushRipple(o.x, o.y, COL.magenta);
          }
          pkill(pows, i);
          hudForce = true;
        }
      }
    }

    /* ============================================================
       PARTICLAR + FX (pool-reuse; caps per kontrakt)
       ============================================================ */
    function burst(x, y, col, count, power) {
      var k;
      for (k = 0; k < count; k++) {
        if (parts.n >= PART_CAP) break;
        var p = pspawn(parts);
        var a = U.rand(0, TAU), v = U.rand(power * 0.2, power);
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
        p.life = p.max = U.rand(0.3, 0.7);
        p.size = U.rand(1.5, 3.5);
        p.col = col; p.kind = 0; p.a = 0; p.spin = 0; p.len = 0;
      }
    }

    function shatter(x, y, col, count, power) {
      var k;
      for (k = 0; k < count; k++) {
        if (parts.n >= PART_CAP) break;
        var p = pspawn(parts);
        var a = U.rand(0, TAU), v = U.rand(power * 0.3, power);
        p.x = x; p.y = y;
        p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
        p.life = p.max = U.rand(0.35, 0.8);
        p.size = U.rand(1.6, 2.6);
        p.col = col; p.kind = 1;
        p.a = U.rand(0, TAU); p.spin = U.rand(-6, 6); p.len = U.rand(6, 14);
      }
    }

    function spawnFlame() {
      if (parts.n >= PART_CAP) return;
      var p = pspawn(parts);
      p.x = player.x + U.rand(-4, 4); p.y = player.y + 13;
      p.vx = U.rand(-25, 25); p.vy = U.rand(140, 250);
      p.life = p.max = U.rand(0.16, 0.3);
      p.size = U.rand(1.8, 3.2);
      p.col = (Math.random() < 0.3) ? '#ffd9a0' : COL.amber;
      p.kind = 0; p.a = 0; p.spin = 0; p.len = 0;
    }

    function pushText(text, x, y, col) {
      if (fx.n >= FX_CAP) return;
      var o = pspawn(fx);
      o.kind = 0; o.text = text; o.x = x; o.y = y;
      o.t = 0; o.max = 1.0; o.col = col; o.r = 0;
    }

    function pushRipple(x, y, col) {
      if (fx.n >= FX_CAP) return;
      var o = pspawn(fx);
      o.kind = 1; o.text = ''; o.x = x; o.y = y;
      o.t = 0; o.max = 0.55; o.col = col; o.r = 0;
    }

    /* ============================================================
       SIM (endast state 'playing') — dt i SEKUNDER
       ============================================================ */
    function sim(dt) {
      var rmp = U.ramp(elapsed);
      elapsed += dt;

      /* spawner-akkumulator */
      spawnT -= dt;
      var guard = 0;
      while (spawnT <= 0 && guard < 8) { spawnTick(rmp); spawnT += rmp.interval; guard++; }

      /* spelare: rörelse (normaliserad) + clamp x[0,W] y[40,H-40] */
      var dx = 0, dy = 0;
      if (keyUp) dy -= 1; if (keyDown) dy += 1;
      if (keyLeft) dx -= 1; if (keyRight) dx += 1;
      if (dx || dy) {
        var l = Math.sqrt(dx * dx + dy * dy);
        player.x = U.clamp(player.x + (dx / l) * PLAYER_SPEED * dt, 0, cfg.W);
        player.y = U.clamp(player.y + (dy / l) * PLAYER_SPEED * dt, 40, cfg.H - 40);
      }

      /* skjut + cooldown */
      cooldown -= dt;
      if (shootHeld && cooldown <= 0) { fire(); cooldown = cfg.FIRE_COOLDOWN; }

      /* timers */
      if (invuln > 0) invuln -= dt;
      if (shield > 0) shield -= dt;
      if (tri > 0) tri -= dt;

      /* engine-flame från spelarens bakre */
      flameAcc += dt;
      while (flameAcc >= 0.033) { flameAcc -= 0.033; spawnFlame(); }

      updateBullets(dt);
      updateShips(dt);
      updateRocks(dt);
      updateEbullets(dt);
      updatePows(dt);

      collisions();
      pickupPass();
    }

    function updateBullets(dt) {
      var i, b;
      for (i = bullets.n - 1; i >= 0; i--) {
        b = bullets.list[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y < -14 || b.x < -14 || b.x > cfg.W + 14) pkill(bullets, i);
      }
    }

    function updateShips(dt) {
      var i, s;
      for (i = ships.n - 1; i >= 0; i--) {
        s = ships.list[i];
        s.t += dt;
        if (s.striker) {
          var want = U.clamp(player.x - s.x, -40, 40);   // subtil homing ±40px/s
          s.hx += (want - s.hx) * Math.min(1, dt * 3);
          s.x = U.clamp(s.x + s.hx * dt, 24, cfg.W - 24);
        } else {
          s.x = s.baseX + Math.sin(s.t * 2.2 + s.phase) * 90;  // sinus ±90, ω 2.2
        }
        s.y += s.vy * dt;
        s.shootT -= dt;
        if (s.shootT <= 0 && s.y > 10 && player.alive) {
          enemyFire(s);
          s.shootT = s.striker ? U.rand(1.5, 2.5) : U.rand(2.2, 3.4);  // ~0.5/s resp ~0.35/s
        }
        if (s.y > cfg.H + 50) pkill(ships, i);
      }
    }

    function updateRocks(dt) {
      var i, o;
      for (i = rocks.n - 1; i >= 0; i--) {
        o = rocks.list[i];
        o.x += o.vx * dt; o.y += o.vy * dt; o.ang += o.av * dt;
        if (o.y > cfg.H + 50 || o.x < -60 || o.x > cfg.W + 60) pkill(rocks, i);
      }
    }

    function updateEbullets(dt) {
      var i, b;
      for (i = ebul.n - 1; i >= 0; i--) {
        b = ebul.list[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y > cfg.H + 12 || b.y < -14 || b.x < -12 || b.x > cfg.W + 12) pkill(ebul, i);
      }
    }

    function updatePows(dt) {
      var i, o;
      for (i = pows.n - 1; i >= 0; i--) {
        o = pows.list[i];
        o.t += dt; o.y += o.vy * dt;
        if (o.y > cfg.H + 30) pkill(pows, i);
      }
    }

    /* ============================================================
       KOLLISIONER — uteslutande NV.util.hits (kvadratisk dist)
       Order per kontrakt: bullet×ship|rock → ship×player → rock×player → ebullet×player
       ============================================================ */
    function collisions() {
      var i, j, b, s, o, hit;
      var shieldOn = shield > 0;
      var canHit = player.alive && invuln <= 0;   // blink = kollisioner skippas

      for (i = bullets.n - 1; i >= 0; i--) {
        b = bullets.list[i];
        hit = false;
        for (j = ships.n - 1; j >= 0; j--) {
          s = ships.list[j];
          if (U.hits(b.x, b.y, BOLT_R, s.x, s.y, s.r)) {
            s.hp--; hit = true;
            burst(b.x, b.y, COL.white, 3, 120);
            if (s.hp <= 0) killShip(j, true);
            break;
          }
        }
        if (!hit && rocks.n > 0) {
          for (j = rocks.n - 1; j >= 0; j--) {
            o = rocks.list[j];
            if (U.hits(b.x, b.y, BOLT_R, o.x, o.y, o.r)) {
              o.hp--; hit = true;
              burst(b.x, b.y, COL.white, 3, 120);
              if (o.hp <= 0) killRock(j, true);
              break;
            }
          }
        }
        if (hit) pkill(bullets, i);
      }

      if (canHit) {
        for (j = ships.n - 1; j >= 0; j--) {
          s = ships.list[j];
          if (U.hits(s.x, s.y, s.r, player.x, player.y, PLAYER_R)) {
            if (shieldOn) killShip(j, true);          // kontaktsdöd: poäng + explode, inget tappt liv
            else { killShip(j, false); playerDamage(); }  // ram-kill utan poäng (undviker re-träff)
          }
        }
        for (j = rocks.n - 1; j >= 0; j--) {
          o = rocks.list[j];
          if (U.hits(o.x, o.y, o.r, player.x, player.y, PLAYER_R)) {
            if (shieldOn) killRock(j, true);
            else { killRock(j, false); playerDamage(); }
          }
        }
        for (i = ebul.n - 1; i >= 0; i--) {
          b = ebul.list[i];
          if (U.hits(b.x, b.y, 3, player.x, player.y, PLAYER_R)) {
            pkill(ebul, i);
            if (shieldOn) burst(b.x, b.y, COL.magenta, 6, 180);  // sköld: kontaktdöd bult, ingen poäng (inget SCORE-värde för bultar)
            else playerDamage();
          }
        }
      }
    }

    /* ============================================================
       AMBIENT (alla states) — stjärnor/nebula drift, partiklar, decay
       ============================================================ */
    function updateStars(dt) {
      var i, arr, k, v;
      for (k = 0; k < 3; k++) {
        arr = (k === 0) ? star0 : (k === 1) ? star1 : star2;
        v = STARSPEED[k];
        for (i = 0; i < arr.length; i++) {
          arr[i].y += v * dt;
          if (arr[i].y > cfg.H + 2) arr[i].y -= cfg.H + 4;
        }
      }
    }

    function updateParts(dt) {
      var i, p;
      for (i = parts.n - 1; i >= 0; i--) {
        p = parts.list[i];
        p.life -= dt;
        if (p.life <= 0) { pkill(parts, i); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 1) { p.a += p.spin * dt; p.vx *= (1 - 1.4 * dt); p.vy *= (1 - 1.4 * dt); }
      }
    }

    function updateFx(dt) {
      var i, o;
      for (i = fx.n - 1; i >= 0; i--) {
        o = fx.list[i];
        o.t += dt;
        if (o.t >= o.max) { pkill(fx, i); continue; }
        if (o.kind === 0) o.y -= 30 * dt;
      }
    }

    function step(dt) {
      ambT += dt;
      updateStars(dt);
      updateParts(dt);
      updateFx(dt);
      if (shake > 0) { shake -= SHAKE_DECAY * dt; if (shake < 0) shake = 0; }
      if (state === 'playing') sim(dt);
      if (overPending) {
        overPending = false;
        if (cbOver) cbOver(overRes);
      }
      render();
      if (state === 'playing') hudTick(dt);
    }

    /* ============================================================
       RENDER — DPR per frame + shake → setTransform (kontrakt §3)
       ============================================================ */
    function neb(x, y, r, col) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(4,6,15,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    function drawNebula() {
      neb(cfg.W * 0.30 + Math.sin(ambT * 0.11) * 70, cfg.H * 0.34 + Math.cos(ambT * 0.09) * 46,
          430, 'rgba(122,43,255,0.14)');
      neb(cfg.W * 0.74 + Math.cos(ambT * 0.13) * 80, cfg.H * 0.58 + Math.sin(ambT * 0.07) * 44,
          500, 'rgba(0,255,247,0.09)');
    }

    function drawStars() {
      var i, arr, k, sz;
      for (k = 0; k < 3; k++) {
        arr = (k === 0) ? star0 : (k === 1) ? star1 : star2;
        sz = [1, 1.6, 2.4][k];
        ctx.fillStyle = STARCOL[k];
        for (i = 0; i < arr.length; i++) ctx.fillRect(arr[i].x, arr[i].y, sz, sz);
      }
    }

    function drawRock(o) {
      var k, an, rr, px, py;
      ctx.beginPath();
      for (k = 0; k < o.np; k++) {
        an = o.ang + k * TAU / o.np;
        rr = o.pts[k];
        px = o.x + Math.cos(an) * rr;
        py = o.y + Math.sin(an) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#0c1424';
      ctx.fill();
      ctx.strokeStyle = (o.size === 'L') ? 'rgba(154,167,193,0.95)' : 'rgba(154,167,193,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    function drawShip(s) {
      ctx.beginPath();
      if (s.striker) {
        ctx.moveTo(s.x, s.y + 17);
        ctx.lineTo(s.x + 13, s.y - 2);
        ctx.lineTo(s.x + 5, s.y - 12);
        ctx.lineTo(s.x, s.y - 6);
        ctx.lineTo(s.x - 5, s.y - 12);
        ctx.lineTo(s.x - 13, s.y - 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,43,214,0.14)';
        ctx.strokeStyle = COL.magenta;
      } else {
        ctx.moveTo(s.x, s.y + 14);
        ctx.lineTo(s.x + 9, s.y - 8);
        ctx.lineTo(s.x, s.y - 3);
        ctx.lineTo(s.x - 9, s.y - 8);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,255,247,0.12)';
        ctx.strokeStyle = COL.cyan;
      }
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
    }

    function drawPow(o) {
      var puls = 1 + 0.12 * Math.sin(ambT * 5 + o.t * 4);
      var r = o.r * puls, k, an, px, py;
      var col = (o.type === 'shield') ? COL.cyan : COL.magenta;
      ctx.beginPath();
      for (k = 0; k < 6; k++) {
        an = o.t * 1.5 + k * TAU / 6;
        px = o.x + Math.cos(an) * r;
        py = o.y + Math.sin(an) * r;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(10,16,34,0.85)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.shadowColor = col;
      ctx.shadowBlur = 9;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.type === 'shield' ? 'S' : '3', o.x, o.y + 1);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.textBaseline = 'alphabetic';
    }

    function drawPlayer() {
      if (!player.alive) return;
      var blinkA = (invuln > 0 && (Math.floor(ambT * 16) % 2 === 0)) ? 0.3 : 1;
      /* amber atomic glow */
      ctx.globalAlpha = blinkA * 0.35;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 26, 0, TAU);
      ctx.fillStyle = 'rgba(255,180,74,0.08)';
      ctx.fill();
      /* triangel-ship (r13) */
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 16);
      ctx.lineTo(player.x + 11, player.y + 12);
      ctx.lineTo(player.x, player.y + 6);
      ctx.lineTo(player.x - 11, player.y + 12);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,180,74,0.22)';
      ctx.strokeStyle = COL.amber;
      ctx.lineWidth = 2;
      ctx.shadowColor = COL.amber;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      if (shield > 0) {   /* sköldring: kontaktdöd-aktiv */
        ctx.beginPath();
        ctx.arc(player.x, player.y, 21, 0, TAU);
        ctx.strokeStyle = 'rgba(0,255,247,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(player.x, player.y, 24 + Math.sin(ambT * 7) * 2, 0, Math.PI * 1.5);
        ctx.strokeStyle = 'rgba(0,255,247,0.3)';
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (tri > 0) {
        ctx.fillStyle = COL.magenta;
        ctx.fillRect(player.x - 13, player.y - 4, 2, 6);
        ctx.fillRect(player.x + 11, player.y - 4, 2, 6);
      }
      ctx.globalAlpha = 1;
    }

    function drawPlayerBullets() {
      var i, b;
      ctx.strokeStyle = '#bffcff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (i = 0; i < bullets.n; i++) {
        b = bullets.list[i];
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1;
    }

    function drawEbles() {
      var i, b;
      for (i = 0; i < ebul.n; i++) {
        b = ebul.list[i];
        ctx.beginPath();
        ctx.arc(b.x, b.y, 5.5, 0, TAU);
        ctx.fillStyle = 'rgba(255,43,214,0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, TAU);
        ctx.fillStyle = COL.magenta;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.2, 0, TAU);
        ctx.fillStyle = COL.white;
        ctx.fill();
      }
    }

    function drawParts() {
      var i, p, t, ca, sa, hl;
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < parts.n; i++) {
        p = parts.list[i];
        t = p.life / p.max;
        if (t > 1) t = 1;
        ctx.globalAlpha = t;
        ctx.fillStyle = p.col;
        if (p.kind === 1) {
          ca = Math.cos(p.a); sa = Math.sin(p.a); hl = p.len * 0.5 * t;
          ctx.beginPath();
          ctx.moveTo(p.x + ca * hl, p.y + sa * hl);
          ctx.lineTo(p.x - sa * p.size, p.y + ca * p.size);
          ctx.lineTo(p.x - ca * hl, p.y - sa * hl);
          ctx.lineTo(p.x + sa * p.size, p.y - ca * p.size);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * t), 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function drawFx() {
      var i, o, k;
      for (i = 0; i < fx.n; i++) {
        o = fx.list[i];
        k = 1 - o.t / o.max;
        if (o.kind === 0) {
          ctx.globalAlpha = k;
          ctx.fillStyle = o.col;
          ctx.font = FONT;
          ctx.textAlign = 'center';
          ctx.fillText(o.text, o.x + Math.sin(o.t * 6) * 2, o.y);   /* rotfloat-wobble */
        } else {
          ctx.globalAlpha = k * 0.8;
          ctx.strokeStyle = o.col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(o.x, o.y, 10 + (1 - k) * 34, 0, TAU);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
      ctx.globalAlpha = 1;
    }

    function render() {
      /* kanvas-resize dpr varje frame (kontrakt) — assign clearar även bitmap */
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      if (dpr < 1) dpr = 1; else if (dpr > 3) dpr = 3;
      var cw = Math.round(cfg.W * dpr), ch = Math.round(cfg.H * dpr);
      cv.width = cw; cv.height = ch;
      if (cv.style.width !== '100%') { cv.style.width = '100%'; }
      ctx.setTransform(cw / cfg.W, 0, 0, ch / cfg.H, 0, 0);

      /* screenShake 14px decay → translate i logiska px */
      if (shake > 0.01) ctx.translate(U.rand(-shake, shake), U.rand(-shake, shake));

      ctx.fillStyle = COL.bg;
      ctx.fillRect(-24, -24, cfg.W + 48, cfg.H + 48);

      drawNebula();
      drawStars();
      var i;
      for (i = 0; i < pows.n; i++) drawPow(pows.list[i]);
      for (i = 0; i < rocks.n; i++) drawRock(rocks.list[i]);
      for (i = 0; i < ships.n; i++) drawShip(ships.list[i]);
      drawEbles();
      drawPlayer();
      drawPlayerBullets();
      drawParts();
      drawFx();
    }

    /* ============================================================
       GAMELOOP — dt i SEKUNDER, cap 0.05 (inget tab-blur-hop-framing)
       ============================================================ */
    var rafFn = (typeof scope.requestAnimationFrame === 'function') ? function (f) { return scope.requestAnimationFrame(f); } : null;

    function frame(ts) {
      if (destroyed) return;
      rafId = (rafFn) ? rafFn(frame) : -1;
      var dt;
      if (lastT === null) dt = 0;
      else dt = (ts - lastT) / 1000;
      lastT = ts;
      if (!(dt > 0)) dt = 0; else if (dt > 0.05) dt = 0.05;
      step(dt);
    }

    function doDestroy() {
      if (destroyed) return;
      destroyed = true; running = false;
      if (rafFn && scope.cancelAnimationFrame && rafId !== -1 && rafId !== null) scope.cancelAnimationFrame(rafId);
      scope.removeEventListener('keydown', onKeyDown);
      scope.removeEventListener('keyup', onKeyUp);
      scope.removeEventListener('blur', onBlur);
      pclear(bullets); pclear(ships); pclear(rocks); pclear(ebul);
      pclear(parts); pclear(pows); pclear(fx);
    }

    /* --- init: stjärnor, meny-state, listeners, rAF --- */
    initStars();
    scope.addEventListener('keydown', onKeyDown);
    scope.addEventListener('keyup', onKeyUp);
    scope.addEventListener('blur', onBlur);
    setState('menu');
    hudEmit();                 /* initial HUD (score 0, hi cachad) */
    if (rafFn) rafId = rafFn(frame);

    /* --- publikt API (exakt kontrakt §3-signaturen) --- */
    return {
      start: function () { if (destroyed) return; resetRun(); setState('playing'); },
      restart: function () { if (destroyed) return; resetRun(); setState('playing'); },
      toMenu: function () { if (destroyed) return; resetRun(); setState('menu'); },
      pause: function () { if (destroyed) return; if (state === 'playing') setState('paused'); },
      resume: function () { if (destroyed) return; if (state === 'paused') { lastT = null; setState('playing'); } },
      togglePause: function () {
        if (destroyed) return;
        if (state === 'playing') setState('paused');
        else if (state === 'paused') { lastT = null; setState('playing'); }
      },
      destroy: doDestroy,
      getState: function () { return state; }
    };
  };
})();
