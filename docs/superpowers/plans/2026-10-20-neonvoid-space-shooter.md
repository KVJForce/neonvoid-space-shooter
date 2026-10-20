# NEONVOID — Implementation Plan

> **For agentic workers:** Execute with superpowers:subagent-driven-development (parallel wave for Tasks 2–4 — file regions are disjoint). Steps use checkbox syntax.

**Goal:** Ett komplett retro-cyberpunk 2D space shooter-spel som en enda körbar `index.html` (öppnas direkt via `file://`).

**Architecture:** Klassiska `<script>`-regioner som alla fäster på ett gemensamt namespace `window.NV`. Tre parallella underagenter äger disjunkta filregioner (shell/CSS, engine, audio+scores). Lead ägare kontraktet + integration (`boot.js`) + `build.mjs` som inlinar allt i `index.html`.

**Tech Stack:** Vanilla HTML5/CSS3, Canvas 2D (glow via shadowBlur + partiklar), Web Audio API (100% syntetiserade SFX, inga asset-filer), `localStorage` för highscores, `node:test` för unittests, `puppeteer-core` + system-Chrome för headless-verifiering.

**Spec:** `specs/CONTRACT.md` (detta är bindinghetsdokumentet — agenterna läser det, inte chatthistoriken)

**Execution log / ledger:** `.superpowers/sdd/neonvoid/progress.md`

## Global Constraints

- Resultatet är **en** fil: `index.html` — inga externa filer, CDN, bilder, typsnitt eller ES-moduler (måste fungera via `file://` i Chrome/Edge/Firefox).
- UI-copy på **svenska**; spelnsnamn **NEONVOID**; klassiska skript med IIFE-namespace `window.NV`; `node --check` (och där lämpligt `node --test`) måste passera för alla JS-delar.
- Ingen `console.error/log` i produktionskodslut; inga `alert/confirm`; ingen literal `</script`-sträng i JS-källor (bygget skjuter in i `<script>`-block).
- All highscore-persistens: nyckel `nv.highscores.v1`, max 8 poster, `{score:int, date:'YYYY-MM-DD'}`; ljud-mute: `nv.muted.v1`. All localStorage-åtkomst i `try/catch` med in-memory fallback.
- Fil-ownership: Agent A → `src/shell.html` + `src/styles.css`; Agent B → `src/engine.js`; Agent C → `src/audio.js` + `src/scores.js` + `test/scores.test.mjs` + `test/audio.test.mjs`; Lead → allt annat. **Inga agent-rör andra filer.**

## Review Focus

1. `localStorage` kastar i privata lägen (Safari/Chrome "block all cookies") → highscore måste fortfarande fungera i minnet per session. (Test: Agent C, `test/scores.test.mjs`)
2. Återanvändning/Assembly: `</script>`-literal i någon JS-fil förstör hela index.html-dokumentet. (Test: build.mjs-validering + Agent-behov)
3. Timer/pause: skärmlås/tab-switch får inte låta ljudet täppa till eller tidsintegrera difficulty medan pausad. (Test: browser-smoke pumpar rAF; dt-cap 50ms)
4. Skala: DPR + responsiv楹-layout får inte göra canvas' logiska koordinatsystem (1280×720) skev. (Test: smoke — canvas.width == 1280*dpr)
5. Game Over-flödet måste spara score **automatiskt** (utan namninput) exakt en gång — inte dubbel vid "Spela igen". (Test: scores.add en gång/hit; smoke — localStorage count)

## Tasks

### Task 1 (Lead): Kontrakt + core + integrationsslire ritning — ✅ done before wave
- `specs/CONTRACT.md`, `src/core.js` (namespace + cfg + util), `src/boot.js`, `build.mjs`, `test/core.test.mjs`, git init.

### Task 2 (Agent A — HTML/CSS): [DISPATCHED PARALLEL]
- Files: `src/shell.html`, `src/styles.css`
- Retro-cyberpunk chrome: scanlines, vignette, glitch-titel, neonknappar, HUD, 3 skärmar (meny/paus/gameover).
- Verifiering: alla lockade ID:n från CONTRACT finns; CSS tillåter `.show`-mekanik exactly som kontraktet kräver.

### Task 3 (Agent B — Engine): [DISPATCHED PARALLEL]
- File: `src/engine.js`
- Gameloop (dt-cap 50ms), input, spawner med ramp, kollisioner, power-ups, partiklar, screenshake, DPR-skalning.
- Verifiering: `node --check src/engine.js` + kontraktets behaviourtbl.

### Task 4 (Agent C — Audio+Scores): [DISPATCHED PARALLEL]
- Files: `src/audio.js`, `src/scores.js`, `test/scores.test.mjs`, `test/audio.test.mjs`
- Web Audio-synth SFX (låst namnlista), highscore CRUD + sanitizering + fel-tolerans, localStorage injections för tests.
- Verifiering: `node --test test/`

### Task 5 (Lead): Integration + verifiering
- Kör `node build.mjs` → `index.html`; `node --check` alla 3 JS; `node --test test/`; puppeteer-core smoke: start → skjut → HUD uppdateras → game over triggeras (sim tid körs via rAF-pump) → localStorage post-entry → "SPELA IGEN" fungerar; screenshot: menu/playing/gameover.
- Fix-loop om nåt fallerar (áteruppta abort agent vid behov).

### Task 6 (Lead): Rapport + ledgerstäda + finish
- Rapport med bevis (kommandonesoutput), garderade avvikelser, `git log`.
