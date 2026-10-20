/* NEONVOID smoke — headless Chrome-verifiering: spelar igenom hela spelcykeln och lämnar bevis.
   Kör: node tools/smoke.mjs   (exit 0 = alla assertions passerade) */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) { console.error('FAIL: ingen Chrome/Edge hittad'); process.exit(1); }

const INDEX = new URL('../index.html', import.meta.url).href;
mkdirSync('docs/proof', { recursive: true });

const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra: extra || '' }); };

/* rAF-pump: driver spelets gameloop i kontrollerad, acceleraerad turtakt (sim-tid, inte wall-clock). */
const PUMP_BOOT = `
  window.__t = 0; window.__rafQ = []; window.__errNs = [];
  const perf = performance;
  try { perf.__realNow = perf.now.bind(perf); } catch (e) {}
  Object.defineProperty(perf, 'now', { configurable: true, value: () => window.__t });
  window.requestAnimationFrame = (cb) => { window.__rafQ.push(cb); return window.__rafQ.length; };
  window.__pump = (n) => {
    for (let i = 0; i < n; i++) {
      const q = window.__rafQ.splice(0); window.__t += 16.6667;
      for (const cb of q) { try { cb(window.__t); } catch (e) { window.__errNs.push(String((e && e.stack) || e)); throw e; } }
    }
    return window.__t;
  };
`;

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const consoleErrors = [], pageErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err && (err.stack || err.message || err))));

try {
  await page.evaluateOnNewDocument(PUMP_BOOT);
  await page.goto(INDEX, { waitUntil: 'load' });

  // P1 — meny visas vid load
  ok('P1 menu visible on load', await page.evaluate(() =>
    document.getElementById('screen-menu').classList.contains('show')));
  await page.screenshot({ path: 'docs/proof/1-menu.png' });

  // P2 — startknapp -> playing
  await page.click('#btn-start');
  await page.evaluate(() => window.__pump(2));
  ok('P2 state=playing after start', (await page.evaluate(() => NV.gameInstance.getState())) === 'playing');
  ok('P2 menu screen hidden', await page.evaluate(() =>
    !document.getElementById('screen-menu').classList.contains('show')));

  // P3 — skjut ~15 sim-s (space + wiggle) - HUD ska uppdateras fran kills
  await page.keyboard.down('Space');
  let scoreSeen = 0;
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) { await page.keyboard.down('ArrowLeft'); await page.keyboard.up('ArrowRight'); }
    else { await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowLeft'); }
    await page.evaluate(() => window.__pump(150));
    scoreSeen = await page.evaluate(() => parseInt(document.getElementById('hud-score').textContent, 10) || 0);
    if (scoreSeen > 0) break;
  }
  await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
  ok('P3 score > 0 after shooting phase (hud showed ' + scoreSeen + ')', scoreSeen > 0);
  await page.screenshot({ path: 'docs/proof/2-playing.png' });

  // P3b — DPR-skalerad backing store ar exakt 1280*dpr
  const dpr = await page.evaluate(() => ({ dpr: window.devicePixelRatio, w: document.getElementById('game').width }));
  ok('P3b canvas backing = 1280*dpr (dpr=' + dpr.dpr + ', w=' + dpr.w + ')', dpr.w === Math.round(1280 * dpr.dpr));

  // P4 — paus/resume fungerar (P-tangel + overlay)
  await page.keyboard.press('KeyP');
  await page.evaluate(() => window.__pump(2));
  ok('P4 paused state + overlay', await page.evaluate(() =>
    NV.gameInstance.getState() === 'paused' &&
    document.getElementById('screen-pause').classList.contains('show')));
  await page.keyboard.press('KeyP');
  await page.evaluate(() => window.__pump(2));
  ok('P4 resumed to playing', (await page.evaluate(() => NV.gameInstance.getState())) === 'playing');

  const idleToDeath = async (shoot) => {
    if (shoot) await page.keyboard.down('Space'); else await page.keyboard.up('Space');
    let ov = false;
    for (let i = 0; i < 36; i++) {
      if (shoot && i % 4 === 0) { await page.keyboard.down(i % 8 === 0 ? 'ArrowLeft' : 'ArrowRight'); }
      if (shoot && i % 4 === 3) { await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight'); }
      await page.evaluate(() => window.__pump(150));
      if ((await page.evaluate(() => NV.gameInstance.getState())) === 'over') { ov = true; break; }
    }
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight'); await page.keyboard.up('Space');
    if (!ov && shoot) { ov = await idleToDeath(false); } // fall back: rörig energi slut — lat den fainta med idler
    return ov;
  };

  // P5 — lat spelaren do naturligt (idler, inga skott)
  ok('P5 reached state=over naturally', await idleToDeath(false));
  const ls1 = await page.evaluate(() => JSON.parse(localStorage.getItem('nv.highscores.v1') || '[]'));
  ok('P5 highscore saved to localStorage (len=' + ls1.length + ')', ls1.length >= 1);
  ok('P5 entry {score,date} + ISO-shape',
    !!(ls1[0] && typeof ls1[0].score === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(ls1[0].date)));
  ok('P5 over screen shown', await page.evaluate(() =>
    document.getElementById('screen-over').classList.contains('show')));
  ok('P5 over-highscores list populated', await page.evaluate(() =>
    document.querySelectorAll('#over-highscores li:not(.hs-empty)').length >= 1));
  await page.screenshot({ path: 'docs/proof/3-gameover.png' });

  // P6 — SPELA IGEN -> playing + HUD-reset, sedan död igen -> adds andra entry
  await page.click('#btn-again');
  await page.evaluate(() => window.__pump(2));
  ok('P6 again -> playing', (await page.evaluate(() => NV.gameInstance.getState())) === 'playing');
  ok('P6 hud score reset to 000000', await page.evaluate(() =>
    document.getElementById('hud-score').textContent === '000000'));
  ok('P6 all 3 lives shown (no .lost)', await page.evaluate(() =>
    document.querySelectorAll('#hud-lives i.lost').length === 0));
  ok('P6 second death (with shooting) -> over again', await idleToDeath(true));
  const ls2 = await page.evaluate(() => JSON.parse(localStorage.getItem('nv.highscores.v1') || '[]'));
  ok('P6 second run also saved (len=' + ls2.length + ' >= 2)', ls2.length >= 2, 'scores: ' + JSON.stringify(ls2));

  // P7 — MENY-knapp (nu synlig på over-skärm) + ljudknapp
  await page.click('#btn-menu');
  await page.evaluate(() => window.__pump(2));
  ok('P7 back to menu', await page.evaluate(() =>
    NV.gameInstance.getState() === 'menu' &&
    document.getElementById('screen-menu').classList.contains('show')));
  await page.click('#btn-sound');
  ok('P7 sound toggle -> aria-pressed true', await page.evaluate(() =>
    document.getElementById('btn-sound').getAttribute('aria-pressed') === 'true'));
  await page.click('#btn-sound');
  ok('P7 sound toggle -> back false', await page.evaluate(() =>
    document.getElementById('btn-sound').getAttribute('aria-pressed') === 'false'));
} catch (e) {
  results.push({ name: 'EXCEPTION during smoke', pass: false, extra: String(e && (e.stack || e.message || e)).split('\n').slice(0, 5).join(' | ') });
} finally {
  await browser.close().catch(() => {});
}

ok('zero pageerrors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
ok('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : ''));
console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' assertions pass, ' + failed.length + ' fail');
process.exit(failed.length === 0 ? 0 : 1);
