// Prueba page.js contra un DOM SIMULADO (jsdom). Comprueba la mecánica (estilo inyectado,
// ocultado dinámico, guardia de clics, navegación SPA), NO que los selectores coincidan
// con el Instagram/YouTube reales: eso solo se prueba en el iPhone.
// Uso: npm install --no-save --no-package-lock jsdom@24.1.3 && node tools/dom-check.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, 'Resources', f), 'utf8');
const core = read('core.js');
const page = read('page.js');
const rules = JSON.parse(read('rules.json'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
let checks = 0;
function expect(cond, what) {
  checks++;
  if (!cond) failures.push(what);
}

function boot(platformID, url, html) {
  const platform = rules.platforms.find((p) => p.id === platformID);
  const messages = [];
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  dom.window.webkit = { messageHandlers: { sinreels: { postMessage: (m) => messages.push(m) } } };
  dom.window.eval(core + '\n;\n' + page + '\n;\nSinReelsPage.start(' + JSON.stringify(platform) + ');');
  return { dom, win: dom.window, doc: dom.window.document, messages };
}

function click(win, el) {
  const ev = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

// ---------- Instagram ----------
{
  const { dom, win, doc, messages } = boot('instagram', 'https://www.instagram.com/', `
    <body>
      <nav>
        <a id="home" href="/">Home</a>
        <a id="reelsTab" href="/reels/">Reels</a>
        <a id="dm" href="/direct/inbox/">DM</a>
      </nav>
      <article id="post"><a id="postLink" href="/p/abc/">foto</a></article>
      <article id="reelPost"><a id="reelLink" href="/reel/xyz/">reel</a></article>
    </body>`);
  let pageHandlerRan = 0;
  doc.addEventListener('click', () => { pageHandlerRan++; });
  await sleep(200);

  expect(!!doc.getElementById('sinreels-style'), 'IG: no se inyectó <style>');
  expect(doc.getElementById('sinreels-style').textContent.includes("a[href='/reels/']"), 'IG: el CSS no contiene el selector de la pestaña Reels');
  expect(doc.getElementById('reelPost').getAttribute('data-sinreels-hidden') === '1', 'IG: hideClosest no ocultó el <article> con reel');
  expect(doc.getElementById('post').getAttribute('data-sinreels-hidden') !== '1', 'IG: ocultó un post normal');
  expect(messages.some((m) => m.type === 'ready'), 'IG: no llegó el mensaje ready');

  const before = pageHandlerRan;
  const evReel = click(win, doc.getElementById('reelLink'));
  expect(evReel.defaultPrevented, 'IG: clic en reel no fue cancelado');
  expect(pageHandlerRan === before, 'IG: el handler de la página corrió pese al bloqueo');
  expect(messages.some((m) => m.type === 'blocked' && m.via === 'click' && m.action === 'block'), 'IG: no se registró el clic bloqueado');

  const evDM = click(win, doc.getElementById('dm'));
  expect(!evDM.defaultPrevented, 'IG: clic en DMs fue cancelado');
  const evPost = click(win, doc.getElementById('postLink'));
  expect(!evPost.defaultPrevented, 'IG: clic en un post fue cancelado');

  // Contenido que llega después (scroll infinito)
  const late = doc.createElement('article');
  late.id = 'lateReel';
  late.innerHTML = '<a href="/reel/late/">reel tardío</a>';
  doc.body.appendChild(late);
  await sleep(200);
  expect(late.getAttribute('data-sinreels-hidden') === '1', 'IG: no ocultó un reel añadido después');

  // Navegación SPA a un reel: debe volver atrás
  win.history.pushState({}, '', '/direct/inbox/');
  await sleep(700);
  expect(win.location.pathname === '/direct/inbox/', 'IG: la navegación SPA a DMs fue revertida');
  win.history.pushState({}, '', '/reels/abc123/');
  await sleep(900);
  expect(messages.some((m) => m.type === 'blocked' && m.via === 'spa' && /\/reels\/abc123\//.test(m.url)), 'IG: no detectó pushState a /reels/ID');
  expect(win.location.pathname === '/direct/inbox/', 'IG: no volvió atrás tras pushState a un reel (quedó en ' + win.location.pathname + ')');
  dom.window.close();
}

// ---------- YouTube ----------
{
  const { dom, win, doc, messages } = boot('youtube', 'https://m.youtube.com/', `
    <body>
      <ytm-pivot-bar-item-renderer id="tabHome"><div>Home</div></ytm-pivot-bar-item-renderer>
      <ytm-pivot-bar-item-renderer id="tabShorts"><div> Shorts </div></ytm-pivot-bar-item-renderer>
      <ytm-chip-cloud-chip-renderer id="chipShorts">Shorts</ytm-chip-cloud-chip-renderer>
      <ytm-chip-cloud-chip-renderer id="chipMusic">Music</ytm-chip-cloud-chip-renderer>
      <a id="short" href="/shorts/abc_DEF-123">short</a>
      <a id="video" href="/watch?v=dQw4w9WgXcQ">video</a>
    </body>`);
  await sleep(200);

  expect(doc.getElementById('tabShorts').getAttribute('data-sinreels-hidden') === '1', 'YT: no ocultó la pestaña Shorts');
  expect(doc.getElementById('tabHome').getAttribute('data-sinreels-hidden') !== '1', 'YT: ocultó la pestaña Home');
  expect(doc.getElementById('chipShorts').getAttribute('data-sinreels-hidden') === '1', 'YT: no ocultó el chip Shorts');
  expect(doc.getElementById('chipMusic').getAttribute('data-sinreels-hidden') !== '1', 'YT: ocultó el chip Music');
  expect(doc.getElementById('sinreels-style').textContent.includes('ytm-reel-shelf-renderer'), 'YT: el CSS no contiene el shelf de Shorts');

  const evShort = click(win, doc.getElementById('short'));
  expect(evShort.defaultPrevented, 'YT: clic en short no fue cancelado');
  expect(messages.some((m) => m.via === 'click' && m.action === 'redirect' && m.to === 'https://m.youtube.com/watch?v=abc_DEF-123'), 'YT: el clic en short no redirige a /watch');
  const evVideo = click(win, doc.getElementById('video'));
  expect(!evVideo.defaultPrevented, 'YT: clic en vídeo largo fue cancelado');

  win.history.pushState({}, '', '/shorts/zzz999');
  await sleep(700);
  expect(messages.some((m) => m.via === 'spa' && m.action === 'redirect' && m.to === 'https://m.youtube.com/watch?v=zzz999'), 'YT: no detectó pushState a /shorts/ID');

  const text = win.eval('SinReelsPage.dump()');
  expect(typeof text === 'string' && text.includes('URL: '), 'YT: dump() no devolvió texto');
  dom.window.close();
}

if (failures.length) {
  console.error(failures.map((f) => 'FALLA ' + f).join('\n'));
  console.error(`\nFALLÓ: ${failures.length} de ${checks} comprobaciones`);
  process.exit(1);
}
console.log(`OK: ${checks} comprobaciones de DOM`);
process.exit(0);
