/* NEONVOID build — sätter ihop alla regioner till en enda körbar index.html (file://-kompatibel). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const files = {
  shell: 'src/shell.html',
  css: 'src/styles.css',
  core: 'src/core.js',
  audio: 'src/audio.js',
  scores: 'src/scores.js',
  engine: 'src/engine.js',
  boot: 'src/boot.js',
};
const read = (f) => {
  const path = new URL('./' + f, import.meta.url);
  if (!existsSync(path)) throw new Error('MISSING FILE: ' + f);
  return readFileSync(path, 'utf8');
};

const srcs = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, read(f)]));

// Guard: '</script' literal i JS-källor förstör hela dokumentet.
for (const [k, s] of Object.entries(srcs)) {
  if (k === 'shell') continue;
  if (/<\/script/i.test(s)) throw new Error(k + ' innehåller literal "</script" — otillåtet i inline-build');
}

// Boot-refererade ID:n finns i shell
const requiredIds = [
  'game','screen-menu','screen-pause','screen-over',
  'btn-start','btn-resume','btn-restart','btn-again','btn-menu','btn-sound',
  'menu-highscores','over-highscores','over-score','over-best-new',
  'hud-score','hud-high','hud-lives','hud-shield','hud-tri'
];
for (const id of requiredIds) {
  if (!new RegExp('id="' + id + '"').test(srcs.shell)) throw new Error('shell.html saknar #' + id);
}
if ((srcs.shell.match(/id="[^"]+"/g) || []).length !== new Set((srcs.shell.match(/id="[^"]+"/g) || [])).size) {
  // dubbletter av samma id (t.ex. en lista två ggr) är ett fel
  const duplicates = {};
  for (const m of srcs.shell.match(/id="[^"]+"/g)) duplicates[m] = (duplicates[m] || 0) + 1;
  throw new Error('Duplicerat ID i shell.html: ' + Object.entries(duplicates).filter(([, n]) => n > 1).map(([k]) => k).join(', '));
}

const script = (body) => '<script>\n' + body.trim() + '\n</script>';
const html = `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEONVOID — retro space shooter</title>
<style>
${srcs.css.trim()}
</style>
</head>
<body>
${srcs.shell}
${script(srcs.core)}
${script(srcs.audio)}
${script(srcs.scores)}
${script(srcs.engine)}
${script(srcs.boot)}
</body>
</html>
`.replace(/\n{3,}/g, '\n\n');

const out = new URL('./index.html', import.meta.url);
writeFileSync(out, html);
const size = html.length;
if (/<html/i.test(srcs.shell) || /<script/i.test(srcs.shell) || /<style/i.test(srcs.shell)) throw new Error('shell.html får inte innehålla html/head/body/script/style-taggar');
console.log('OK built index.html —', size, 'bytes,', Object.keys(srcs).length, 'regioner inlined.');
