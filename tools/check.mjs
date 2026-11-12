// Verificación local sin Mac: valida rules.json y corre Tests/cases.json contra core.js.
// Uso: node tools/check.mjs   (salida esperada al final: "OK: N casos")
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Core = require(path.join(root, 'Resources', 'core.js'));
const rules = JSON.parse(readFileSync(path.join(root, 'Resources', 'rules.json'), 'utf8'));
const cases = JSON.parse(readFileSync(path.join(root, 'Tests', 'cases.json'), 'utf8'));

const errors = [];
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const ids = new Set();
const stores = new Set();

for (const p of rules.platforms) {
  for (const key of ['id', 'title', 'startURL', 'dataStoreID']) {
    if (typeof p[key] !== 'string' || !p[key]) errors.push(`${p.id}: falta ${key}`);
  }
  if (!UUID_RE.test(p.dataStoreID)) errors.push(`${p.id}: dataStoreID no es UUID`);
  if (ids.has(p.id)) errors.push(`id duplicado ${p.id}`);
  if (stores.has(p.dataStoreID)) errors.push(`dataStoreID duplicado ${p.dataStoreID}`);
  ids.add(p.id); stores.add(p.dataStoreID);

  for (const re of [...(p.hosts || []), ...(p.ruleHosts || [])]) {
    try { new RegExp(re); } catch (e) { errors.push(`${p.id}: host regex inválida ${re}`); }
  }
  for (const r of p.pathRules || []) {
    try { new RegExp(r.pattern); } catch (e) { errors.push(`${p.id}: pattern inválida ${r.pattern}`); }
    if (!['allow', 'redirect', 'block'].includes(r.action)) errors.push(`${p.id}: action desconocida ${r.action}`);
  }
  for (const r of p.hideByText || []) {
    try { new RegExp(r.text, 'i'); } catch (e) { errors.push(`${p.id}: hideByText inválida ${r.text}`); }
  }
  const start = Core.decide(p, p.startURL);
  if (start.action !== 'allow') errors.push(`${p.id}: startURL no está permitida (${start.action})`);
}

let passed = 0;
for (const c of cases) {
  const p = rules.platforms.find((x) => x.id === c.platform);
  if (!p) { errors.push(`caso con plataforma desconocida ${c.platform}`); continue; }
  const d = Core.decide(p, c.url);
  const okAction = d.action === c.action;
  const okTo = c.to === undefined || d.to === c.to;
  if (okAction && okTo) passed++;
  else errors.push(`FALLA ${c.url}: esperaba ${c.action} ${c.to ?? ''} y obtuve ${d.action} ${d.to ?? ''}`);
}

// page.js debe evaluarse sin errores de sintaxis en un contexto vacío.
try {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(path.join(root, 'Resources', 'core.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(path.join(root, 'Resources', 'page.js'), 'utf8'), ctx);
  for (const p of rules.platforms) {
    const css = vm.runInContext(`SinReelsPage.buildCSS(${JSON.stringify(p)})`, ctx);
    if (!css.includes('display: none !important')) errors.push(`${p.id}: CSS vacío`);
  }
} catch (e) {
  errors.push(`page.js: ${e.message}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\nFALLÓ: ${errors.length} error(es), ${passed}/${cases.length} casos OK`);
  process.exit(1);
}
console.log(`OK: ${passed} casos, ${rules.platforms.length} plataformas`);
