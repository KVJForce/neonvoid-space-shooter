/* NEONVOID — ledad boot: kör integrationen av skärmar, HUD, button wiring och highscore-flöde. */
(function () {
  'use strict';
  var $id = function (id) { return document.getElementById(id); };
  var cv = $id('game');
  if (!cv) throw new Error('NEONVOID boot: #game saknas');

  var els = {
    screens: { menu: $id('screen-menu'), pause: $id('screen-pause'), over: $id('screen-over') },
    score: $id('hud-score'), hi: $id('hud-high'), lives: $id('hud-lives'),
    badgeShield: $id('hud-shield'), badgeTri: $id('hud-tri'),
    overScore: $id('over-score'), bestNew: $id('over-best-new'),
    menuList: $id('menu-highscores'), overList: $id('over-highscores'),
    btnSound: $id('btn-sound'),
    btnStart: $id('btn-start'), btnResume: $id('btn-resume'), btnRestart: $id('btn-restart'),
    btnAgain: $id('btn-again'), btnMenu: $id('btn-menu')
  };
  ['screens.menu', 'screens.pause', 'screens.over', 'btnStart', 'btnAgain'].forEach(function (k) {
    if (!els[k]) throw new Error('NEONVOID boot: DOM-element "' + k + '" saknas');
  });
  var livesEls = Array.prototype.slice.call(els.lives.querySelectorAll('i'));

  var fmt = { pad: function (n) { n = Math.max(0, n | 0); var s = String(n); while (s.length < 6) s = '0' + s; return s; } };

  function showScreen(name) {
    ['menu', 'pause', 'over'].forEach(function (k) {
      els.screens[k].classList.toggle('show', k === name);
    });
  }

  function listToHtml(list, max) {
    if (!list.length) return '<li class="hs-empty">Inga resultat ännu — skriv historia!</li>';
    var out = '';
    for (var i = 0; i < list.length && i < max; i++) {
      out += '<li><span class="hs-rank">' + (i + 1) + '</span>' +
             '<span class="hs-score">' + fmt.pad(list[i].score) + '</span>' +
             '<span class="hs-date">' + list[i].date + '</span></li>';
    }
    return out;
  }

  function renderList(ol, max) {
    var list = [];
    try { list = NV.scores.load(); } catch (e) { list = []; }
    if (ol) ol.innerHTML = listToHtml(list, max);
  }

  var IS_MUTED = false;
  function syncSoundBtn() {
    try { IS_MUTED = !!NV.audio.isMuted(); } catch (e) {}
    els.btnSound.textContent = IS_MUTED ? '🔇' : '🔊';
    els.btnSound.setAttribute('aria-label', IS_MUTED ? 'Slå på ljud (M)' : 'Stäng av ljud (M)');
    els.btnSound.setAttribute('aria-pressed', IS_MUTED ? 'true' : 'false');
  }

  function onHud(hud) {
    els.score.textContent = fmt.pad(hud.score);
    els.hi.textContent = fmt.pad(hud.hi);
    for (var i = 0; i < livesEls.length; i++) livesEls[i].classList.toggle('lost', i >= hud.lives);
    var sh = hud.shield > 0 ? 'SKÖLD ' + Math.ceil(hud.shield) + 's' : null;
    var tr = hud.tri > 0 ? 'TRI ' + Math.ceil(hud.tri) + 's' : null;
    if (sh) { els.badgeShield.textContent = sh; els.badgeShield.classList.remove('hide'); }
    else { els.badgeShield.classList.add('hide'); els.badgeShield.textContent = 'SKÖLD'; }
    if (tr) { els.badgeTri.textContent = tr; els.badgeTri.classList.remove('hide'); }
    else { els.badgeTri.classList.add('hide'); els.badgeTri.textContent = 'TRI'; }
  }

  function onState(state) {
    if (state === 'playing') showScreen(null);
    else if (state === 'paused') showScreen('pause');
    else if (state === 'over') showScreen('over');
    else showScreen('menu');
    if (state === 'menu') renderList(els.menuList, 5);
  }

  function onGameOver(res) {
    var added = null;
    try { added = NV.scores.add(res.score); } catch (e) { added = null; }
    els.overScore.textContent = fmt.pad(res.score);
    if (els.bestNew) els.bestNew.classList.toggle('show', !!(added && added.isBest));
    renderList(els.overList, 8);
  }

  function startRun() {
    try { NV.audio.init(); NV.audio.play('select'); } catch (e) {}
    game.start();
  }

  // Init flows — skapa motorn först, koppla knappar efter
  var game = NV.game.create(cv, { onState: onState, onHud: onHud, onGameOver: onGameOver });

  els.btnStart.addEventListener('click', startRun);
  els.btnResume.addEventListener('click', function () { try { NV.audio.play('select'); } catch (e) {} game.resume(); });
  els.btnRestart.addEventListener('click', function () { try { NV.audio.play('select'); } catch (e) {} game.restart(); });
  els.btnAgain.addEventListener('click', function () { try { NV.audio.play('select'); } catch (e) {} game.restart(); });
  els.btnMenu.addEventListener('click', function () { try { NV.audio.play('select'); } catch (e) {} game.toMenu(); });
  els.btnSound.addEventListener('click', function () {
    try { NV.audio.init(); NV.audio.toggleMuted(); } catch (e) {}
    syncSoundBtn();
  });

  window.addEventListener('keydown', function (e) {
    var st = game.getState();
    if (e.code === 'Enter') {
      if (st === 'menu') { startRun(); }
      else if (st === 'over') { try { NV.audio.play('select'); } catch (err) {} game.restart(); }
      else if (st === 'paused') { try { NV.audio.play('select'); } catch (err) {} game.resume(); }
    } else if (e.code === 'KeyM') {
      try { NV.audio.init(); NV.audio.toggleMuted(); } catch (err) {}
      syncSoundBtn();
    }
  });

  renderList(els.menuList, 5);
})();
