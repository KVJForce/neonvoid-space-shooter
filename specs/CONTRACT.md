# NEONVOID — BINDING CONTRACT (single source of truth)

Läs hela dokumentet FÖRST. Du bygger mot exakt dessa namn/värden. Ingenting i ditt uppdrag ska frågas tillbaka — saknas det något API, koda mot tolken nedan och rapportera det som en concern.

## 1. Vad NEONVOID är
Retro-cyberpunk 2D space shooter som en enda fil `index.html` (byggs av lead; agenterna skriver bara sina region-filer). Canvas 1280×720 logisk koordinatsystem + DPR-skalning. UI-copy på svenska.

## 2. Namespace-kontrakt (`window.NV`, IIFE per fil, `'use strict'`)
Laddningsordning i build: 1 core → 2 audio → 3 scores → 4 engine → 5 boot.

### `NV.cfg` (frys — definieras redan i `src/core.js`; använd den, ändra INTE core.js)
```js
{ W:1280, H:720, LIVES:3,
  FIRE_COOLDOWN:.14, BULLET_SPEED:950, ENEMY_BULLET_SPEED:300,
  INVULN:2.0, SHIELD_TIME:8.0, TRI_TIME:10.0, TRI_SPREAD_DEG:14,
  SPAWN_START:1.4, SPAWN_END:.42, RAMP_TIME:90,
  DROP_SHIP:.18, DROP_ROCK:.06,
  SCORE:{SCOUT:100,STRIKER:250,ROCK_L:40,ROCK_M:25,ROCK_S:10},
  HIGHSCORE_MAX:8, HIGHSCORE_KEY:'nv.highscores.v1', MUTED_KEY:'nv.muted.v1',
  SFX:['laser','laserEnemy','explode','explodeBig','playerHit','powerup','shield','gameover','select'],
  STATES:['menu','playing','paused','over'], MAX_SHIPS:28 }
```

### `NV.util` (redan i core.js — engine använder dessa, aldrig egna dubletter)
`clamp(v,a,b), lerp(a,b,t), rand(a,b), randInt(a,b) (inklusive), pick(arr), dist(x1,y1,x2,y2), hits(x1,y1,r1,x2,y2,r2), ramp(elapsedSec) → {t, interval, speedMul, strikerChance}, TAU`.

**Missing-API rule:** Agenterna kör parallellt. Om ett API från en annan region ännu inte finns: koda mot kontraktet ändå — INGEN agent skapar stubs för andras regioner. Vid integration finns allt.

## 3. Engine (Agent B) — `src/engine.js`
```js
NV.game.create(canvasEl, hooks) -> { start, restart, toMenu, pause, resume, togglePause, destroy, getState }
hooks = { onState(state), onHud(hud), onGameOver(res) }
state ∈ 'menu'|'playing'|'paused'|'over'; hud = {score:int, hi:int, lives:int, shield:secLeft, tri:secLeft}
res = { score:int, seconds:float, kills:int }
```
Behavior:
- Direkt efter create: state='menu' (ambient: endast starfield renderas) + hooks.onState('menu').
- `start()`/`restart()`: reset allt (score, lives=LIVES, arrayer, timers) → state 'playing'. `pause()`/`resume()`/`togglePause()` (KeyP/Escape). `toMenu()`: reset + state 'menu'. `destroy()`: tar bort listeners, cancelAnimationFrame.
- Input på window (keydown/keyup): WASD + piltangenter i alla 4 riktningar (y clamp [40, H-40], x clamp [0, W]); håll-in-flerslag fungerar (state-lista). Space skjuter med FIRE_COOLDOWN-cooldown: bultar r=4, dmg 1, |v|=BULLET_SPEED; tri aktiv → 3 bultar ±TRI_SPREAD_DEG i rad. KeyP/Escape togglar paus i playing/paused. preventDefault för Space/Arrow* medan state!=='menu' (annars scrollar sidan).
- Spawner (endast playing): akkumulerad elapsed; tick per `ramp.interval` sek. Varje tick: rock om Math.random()<0.4 && ships.length<MAX_SHIPS, annars ship (striker om Math.random()<ramp.strikerChance). Ships spawnar top x∈rand(40, W-40)*speedMul vy rand(110,170)*speedMul, sinus x ±90px (ω 2.2 rad/s, fas random) + skjut ~0.35/s (aimed bullet). Striker hp2 r22 vy rand(80,140)*speedMul, subtil homing ±40px/s mot spel.x, skjut ~0.5/s.
- Rocks: storlekar L(r34 hp3, 40% sannolikhet)/M(r22 hp2,40%)/S(r14 hp1,20%); vy rand(55,160)*speedMul, vx rand(-40,40), angular vel rand(-1.8,1.8) rad/s, polygon 8-11 hörn med radiejitter 0.72-1.28×r. Dödad av bullet → split L→2×M, M→2×S (split-vx ±60, vy −20), score enligt SCORE.
- Kollisioner (kvadratisk dist, använd `NV.util.hits`): playerBullet×ship|rock, ship×player, rock×player, enemyBullet×player. Bult liv: until off-screen. Enemy bullet r3 magenta. Player hit med shield aktiv → kontaktdöd på ships/rocks/enemyBullets (poäng + explode) utan livförlust; annars: lives--, INVULN=2s blink (kollisioner skippas), screenShake 14px, NV.audio.play('playerHit')+NV.audio.play('explode'); lives==0 → state 'over', rAF fortsätta men sim fryss, hooks.onGameOver({score, seconds, kills}).
- Powerups: drop vid ship-kill om rand<DROP_SHIP, vid rock-destroy rand<DROP_ROCK; type 'shield'|'tri' randjämnt; faller 120-170px/s, r15, pulsande hex + bokstav ('S' cyan / '3' magenta); pickup vid dist<26: shield→max(shield,SHIELD_TIME), tri→max(tri,TRI_TIME); NV.audio.play('shield') resp play('powerup'); text-floater "+SKÖLD"/"+TRISKOTT".
- Score/kill: scout 100, striker 250, rock L40/M25/S10. Varje kill: explode + shard-partiklar; rock-L: 'explodeBig'; striker-death: 'explodeBig'.
- HUD-hook: kalla hooks.onHud({score, hi, lives, shield, tri}) när score/lives/ändringar ELLER varje 0.2s (timers sekunder ceil). hi = NV.scores.load()[0]?.score || 0 (beräknas I RUN-start, cachas).
- Render-order: nebula (2 st radial-gradient blobbar, sine-drift) → 3 lager stjärnor (120/60/30, y+=v*dt, wrap till top) → entities → additiva partiklar (`globalCompositeOperation 'lighter'`, cap 260) → screenshake (decay) → powerup pickup-ripples/floaters (rotfloat, cap 12) → DPR-skalning via canvas.width = W*dpr, csswidth 100%, ctx.setTransform(dpr,0,0,dpr,0,0).
- Muzzle flash vid skjut + engine-flame partiklar från spelarens bakre.
- Spelaren: triangel-ship (r13), movement speed 460 px/s, amber atomic glow.
- KAP-validering: `node --check src/engine.js` måste passera. INGEN console.*. INGEN DOM manipulera utanför canvas. ALLT score/lives/patent via hooks. INGEN literal '</script' i koden.

## 4. Boot (Lead, färdig) — element-ID kräver Agent A skapar exakt dessa (engång varje)
```
#game (canvas 1280x720, inuti .stage-wrap)
#screen-menu .screen.show | #screen-pause .screen | #screen-over .screen  (.screen = display:none; .screen.show = display:flex — A gör CSS:n)
#btn-start | #btn-resume | #btn-restart | #btn-again | #btn-menu
#menu-highscores (ol) | #over-highscores (ol)
#over-score | #over-best-new (badge "NYTT REKORD!", default hidden via CSS — .show visar)
#hud-score | #hud-high | #hud-lives (EXAKT 3 <i>; klass .lost = dött liv) | #hud-shield (badge, default .hide) | #hud-tri (badge, default .hide)
#btn-sound (boot byter 🔊/🔇 och aria-pressed)
```
State→skärm: 'playing'→inga; 'paused'→screen-pause; 'over'→screen-over; 'menu'→screen-menu.

## 5. Shell + CSS (Agent A) — `src/shell.html` + `src/styles.css`
- shell.html = ENDAST body-innehåll (ingen html/head/body/script/style-taggar). Följ strukturen punkt-punkt-punkt:
```html
<div id="app">
 <div class="scanlines" aria-hidden="true"></div>
 <div class="frame">
  <header class="hud">
    <div class="hud-item"><span class="hud-label">POÄNG</span><span class="hud-value" id="hud-score">000000</span></div>
    <div class="hud-item"><span class="hud-label">LIV</span><span class="hud-lives" id="hud-lives"><i></i><i></i><i></i></span></div>
    <div class="hud-item"><span class="hud-label">REKORD</span><span class="hud-value" id="hud-high">000000</span></div>
    <span class="badge hide" id="hud-shield">SKÖLD</span>
    <span class="badge badge-tri hide" id="hud-tri">TRI</span>
    <button type="button" class="btn btn-icon" id="btn-sound" aria-label="Växla ljud" title="Växla ljud (M)">🔊</button>
  </header>
  <main class="stage-wrap">
    <canvas id="game" width="1280" height="720"></canvas>
    <section id="screen-menu" class="screen show" role="dialog" aria-label="Huvudmeny">
      <h1 class="title">NEONVOID</h1>
      <p class="tagline">En neonljud-rymdjakt — överlev stjärnstormen!</p>
      <dl class="legend"> RÖR DIG/WASD+PIL · SKJUT/MELLANSLAG · PAUSA/P/ESC · LJUD/M </dl>
      <h2 class="subtitle">HIGHSCORE — TOPP 5</h2>
      <ol id="menu-highscores"></ol>
      <button type="button" class="btn btn-primary" id="btn-start">STARTA SPEL</button>
    </section>
    <section id="screen-pause" class="screen" role="dialog" aria-label="Pausad">
      <h1 class="title-sm">PAUSAD</h1>
      <button type="button" class="btn btn-primary" id="btn-resume">FORTSÄTT</button>
      <button type="button" class="btn" id="btn-restart">STARTA OM</button>
      <p class="hintP">P eller ESC för att återvända</p>
    </section>
    <section id="screen-over" class="screen" role="dialog" aria-label="Game over">
      <h1 class="title-over">GAME OVER</h1>
      <p class="over-label">DIN POÄNG</p>
      <p class="over-value" id="over-score">000000</p>
      <p class="badge-new show" id="over-best-new">NYTT REKORD!</p>
      <h2 class="subtitle">HIGHSCORE — TOPP 8</h2>
      <ol id="over-highscores"></ol>
      <button type="button" class="btn btn-primary" id="btn-again">SPELA IGEN</button>
      <button type="button" class="btn" id="btn-menu">MENY</button>
    </section>
  </main>
  <footer class="foot">WASD/PIL — rör dig · MELLANSLAG — skjut · P/ESC — paus · M — ljud på/av</footer>
 </div>
</div>
```
- CSS (`src/styles.css`) — fullständig layout HOISTUL-mot dessa krav:
  - `:root` färgvariabler: `--bg:#04060f; --cyan:#00fff7; --magenta:#ff2bd6; --violet:#7a2bff; --amber:#ffb44a; --dim:#9aa7c1; --panel:rgba(10,16,34,.86); --danger:#ff3355;` + monospace stack `Consolas, 'Cascadia Mono', 'Courier New', monospace`.
  - `#app` fullviewport flex; `.frame` max-width fit; canvas via `.stage-wrap` (width 96vw, height auto, aspect-ratio 16/9, centrering, canvas width 100% height 100%, `border:1px solid var(--cyan); box-shadow:0 0 24px rgba(0,255,247,.25), inset 0 0 60px rgba(0,255,247,.06); background:#04060f`).
  - `.screen`: absolute inset:0, display:none, align-items:center, justify-content:center, flex-direction:column, gap, background var(--panel), backdrop-filter blur(2px), z-index 2. `.screen.show` display:flex.
  - `.title`: font-size clamp(2.5rem, 8vw, 4.5rem), text-shadow: 0 0 8px var(--cyan), 0 0 24px var(--cyan), 3px 0 12px var(--magenta), -3px 0 12px var(--cyan), letter-spacing .35em; glitch/flicker keyframes (2 pseudo-elements med clip-path slices; enkel variant ok men MÅSTE ha någon rörelse); animation Hel.
  - `.badge-new` ∈ [display:none by default; .show visar med magenta glow + pulse].
  - HUD: `.hud` flex rad, gap, padding; `.hud-label` font-size .7rem letterspacing .25em var(--dim); `.hud-value` cyan glow; `.hud-lives i`: inline-block 14px × 16px clip-path triangel, background cyan glow; `.lost` background dimgrå, ingen glow.
  - `.badge`: inline-block, border 1px solid var(--cyan), padding 2px 8px, border-radius 12px, font-size .7rem; `.badge-tri` border-color var(--magenta); `.badge.hide` opacity 0.
  - `.btn`: transparent bg, 1px solid var(--cyan), color var(--cyan), padding .65rem 1.4rem, letter-spacing .2em, uppercase, transitions; hover: box-shadow 0 0 24px rgba(0,255,247,.35), background rgba(0,255,247,.08); focus-visible: outline 2px dashed var(--magenta); `.btn-primary`: lite starkare (`border COLOR: cyan, text-shadow cyan glow`); `.btn-icon`: endast ikon padding mindre.
  - `.scanlines`: absolute inset:0, pointer-events:none, repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 1px, transparent 1px 3px), opacity .12, z-index 3. `.vignette`: radial-gradient(ellipse, transparent 55%, rgba(0,0,0,.4)); pointer-events none; z-index 3.
  - `.subtitle` magenta letterspaced; `.hs-*` list styles (punkter med .hs-rank violet, .hs-score cyan, .hs-date dim); `.hs-empty` dim italic. `#over-best-new` hidden w/o .show (magenta border + glow); `#over-score` extra stor. `.hintP` dim liten.
  - `.foot` centeredgit dim .8rem med padding.
  - keyframes: flicker, glitch-shift, pulse-badge, hover-glow (via box-shadow), fade-in-up.
  - **`prefers-reduced-motion: reduce`** → alla animation duration 0 / none (åtminstone title glitch + scanline flicker), men allt fortfarande synligt och fungerar.
  - `:focus-visible` på knappar: synlig outline. ALDRIG”；EVERY copy på svenska.
- shell.html = ENDAST fragment (ingen `<html>`, `<head>`, `<body>`, `<script>`, `<style>`).

## 6. Audio (Agent C) — `src/audio.js`
```js
NV.audio = { init(), play(name), setMuted(b), toggleMuted(), isMuted() }
```
- 100% Web Audio-syntes (OscillatorNode / BufferSource med noise + GainNode-envelopes). INGA filer. init() lazy (AudioContext skapas vid första gclearning: boot kallar init vid startknappen/klick) + master gain .28; cache noise buffer.
- `play(name)` validerar name ∈ NV.cfg.SFX; try/catch helt (ljudfEL ALDRIG kraschar spel). Karaktär per namn:
  - laser: square 880→1760Hz sweep .08s gain .16 (blev kortare start)
  - laserEnemy: saw 440→220Hz .12s
  - explode: noise burst lowpass 900→80Hz .18s
  - explodeBig: noise burst + sine thump 60Hz .32s
  - playerHit: 2×saw 200→60Hz .3s + noise
  - powerup: 3-node arp sine 523/659/784 .36s
  - shield: sine 110Hz vibrato .5s
  - gameover: 4-node fallande saw 392→311→247→196 (1.2s)
  - select: kort blip square 4000Hz .04s
- `setMuted(b)` → gain 0 / återställ; persist via localStorage cfg.MUTED_KEY med try/catch (fallback in-memory var); `init()` respekterar persisterat värde; isMuted().
- No-WebAudio (typeof AudioContext undefined e.g. node): play/init no-op utan crash. `node --check src/audio.js` måste pass.

## 7. Scores (Agent C) — `src/scores.js`
```js
NV.scores = { load(), qualifies(score), add(score)->{rank,isBest,best}, best(), clear() }
```
- Entry {score:int>0, date:'YYYY-MM-DD'}; sort desc, TDD → tidigast date först (stabil). Max HIGHSCORE_MAX. `add()` avläsning + insert + trim → return {rank (1-baserad eller 0 om ej kval), isBest (bool — score > alla gamla), best (int)}.
- `load()` tolererar: JSON-violation → [], icke-array → [], icke-object entries → filtreras; score NaN/inf/≤0 → filtreras; date saknas → kastas. try/catch på ALLT localStorage (quota, thrown access) → in-memory fallback array (liv helt session).
- `qualifies(score)` true om score>0 && (list.length<MAX || score> minsta score). `best()` → load()[0]?.score||0. `clear()` tömmer (för debug).
- Dual-mode (mönstar i testfilen nedan): scope = window || globalThis. `node --check src/scores.js` + `node --test test/` måste pass.

## 8. Tests (Agent C) — `test/scores.test.mjs` + `test/audio.test.mjs`
Mönster:
```js
import { readFileSync } from 'node:fs';
import { test } from 'node:test'; import assert from 'node:assert/strict';
new Function(readFileSync('src/scores.js','utf8'))();
const NV = globalThis.NV;
```
- scores.test: tom load []; add → rank1 isBest true; 9 adds (variera score) → length 8, sämsta bort; tie scores sortera datum; invalid JSON string i storage → [] inte krasch; storage med throw get/set → funkar; qualifies boundary (0 tom → false, positiv → true); add→best().
- audio.test: utan AudioContext: init()+play('laser') inga kast; toggleMuted() togglar isMuted; setMuted(true)→isMuted true.
- Kör `node --test test/` — all green, OCKSÅ bekräfta i rapporten (klistra en sista radd av output).

## 9. Deliverables + rapportformat
- Agent A: `src/shell.html`, `src/styles.css`. Rapport: filer + concerns. Själv-verifiera alla ID-namn exakt matchar §4.
- Agent B: `src/engine.js` + `node --check` output (måste 0 fel).
- Agent C: `src/audio.js`, `src/scores.js`, `test/scores.test.mjs`, `test/audio.test.mjs` + `node --test test/` output (all pass).
- Svarsformat: status (DONE | DONE_WITH_CONCERNS | BLOCKED), en rad per fil, verifieringsbevis (kommandon + sammanfattning), concerns.
