#!/usr/bin/env node
/**
 * Importa inventario de Lego desde links compartidos de Brickit (Pockets > Share).
 *
 * Uso:  node scripts/brickit_import.mjs            (lee data/sources/brickit_links.txt)
 *       node scripts/brickit_import.mjs <url> ...   (links explicitos)
 *
 * Cada link brickit.app/offer/<id> es un SNAPSHOT fijo del inventario al momento de compartir.
 * La pagina trae los datos embebidos en window.__NUXT__; de ahi sale cada pieza individual
 * con su numero, categoria, tamano y familia de color. Se suman las piezas de data/manual_parts.csv
 * (piezas que Brickit no reconocio), se aplican las correcciones de data/corrections.csv (piezas que Brickit
 * identifico mal, por id de pieza) y se escriben los archivos de data/.
 *
 *       node scripts/brickit_import.mjs --add-corrections   (lee $CORRECTIONS: lineas "<id> -> <pieza> <familia>"
 *                                                            o "<id> -> -" para quitar; las agrega al csv)
 *
 * Sin dependencias: Node >= 18.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FAMILIES } from '../app/colors.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const LINKS_FILE = path.join(DATA, 'sources', 'brickit_links.txt');
const MANUAL_FILE = path.join(DATA, 'manual_parts.csv');
const RAW_DIR = path.join(DATA, 'raw');
const FIX_FILE = path.join(DATA, 'corrections.csv');
const FIX_HEAD = 'id,pieza,color,nota\n# Piezas que Brickit identifico mal, una por id de pieza (sale en la app al tocar "Corregir"). pieza "-" = no existe.\n';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Correcciones que manda la app (o un issue "[correcciones]"). Valida todo: llegan de afuera.
function addCorrections() {
  if (!process.argv.includes('--add-corrections')) return;
  const rows = new Map(fs.existsSync(FIX_FILE) ? parseCsv(fs.readFileSync(FIX_FILE, 'utf8')).map(r => [r.id, r]) : []);
  let added = 0;
  for (const line of (process.env.CORRECTIONS || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f-]{36})\s*->\s*(-|([A-Za-z0-9]{2,12})\s+([A-Za-z]+))\s*$/);
    if (!m || !ID.test(m[1])) continue;
    if (m[2] !== '-' && !FAMILIES[m[4]]) { console.log(`ignorada (color "${m[4]}" no existe): ${line}`); continue; }
    rows.set(m[1], { id: m[1], pieza: m[2] === '-' ? '-' : m[3], color: m[2] === '-' ? '' : m[4], nota: new Date().toISOString().slice(0, 10) });
    added++;
  }
  if (!added) throw new Error('No llego ninguna correccion valida (formato: "<id> -> <pieza> <familia>")');
  fs.writeFileSync(FIX_FILE, FIX_HEAD + [...rows.values()].map(r => csvLine([r.id, r.pieza, r.color, r.nota])).join('\n') + '\n');
  console.log(`${FIX_FILE}: ${added} correccion(es) nueva(s), ${rows.size} en total`);
}

// --replace <url> deja ese link como unica coleccion; --add <url> lo suma como pocket extra. Ambos editan
// data/sources/brickit_links.txt (los usa el boton "Actualizar inventario" de la app via GitHub Actions).
function updateLinks() {
  const i = process.argv.findIndex(a => a === '--replace' || a === '--add');
  if (i < 0) return;
  const url = (process.argv[i + 1] || '').trim();
  if (!/^https:\/\/brickit\.app\/offer\/[0-9a-f-]{36}$/.test(url)) throw new Error(`Link de Brickit invalido: "${url}"`);
  const lines = fs.readFileSync(LINKS_FILE, 'utf8').split('\n');
  const comments = lines.filter(l => !l.trim() || l.trim().startsWith('#'));
  const links = lines.filter(l => l.trim() && !l.trim().startsWith('#'));
  const next = process.argv[i] === '--replace' ? [url] : [...new Set([...links, url])];
  fs.writeFileSync(LINKS_FILE, [...comments.filter(Boolean), ...next].join('\n') + '\n');
  console.log(`${LINKS_FILE}: ${process.argv[i] === '--replace' ? 'reemplazado por' : 'agregado'} ${url}`);
}

function readLinks() {
  const editing = process.argv.includes('--replace') || process.argv.includes('--add');
  const argv = editing ? [] : process.argv.slice(2).filter(a => a.startsWith('http'));
  if (argv.length) return argv;
  if (!fs.existsSync(LINKS_FILE)) throw new Error(`No existe ${LINKS_FILE}`);
  return fs.readFileSync(LINKS_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

async function fetchOffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 legobuilds-import' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();
  const i = html.indexOf('window.__NUXT__=');
  if (i < 0) throw new Error(`${url}: no trae window.__NUXT__ (cambio el formato de Brickit?)`);
  const j = html.indexOf('</script>', i);
  const code = html.slice(i + 'window.__NUXT__='.length, j).trim().replace(/;$/, '');
  const nuxt = vm.runInNewContext('(' + code + ')', Object.create(null), { timeout: 5000 });
  const d = nuxt?.data?.[0];
  if (!d?.offer || !d?.parts) throw new Error(`${url}: estructura inesperada`);
  const id = url.split('/offer/')[1]?.split(/[?#]/)[0] || 'offer';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, `${id}.json`), JSON.stringify(d));
  return { id, url, d };
}

function applyCorrections(pieces) {
  if (!fs.existsSync(FIX_FILE)) return;
  const fixes = new Map(parseCsv(fs.readFileSync(FIX_FILE, 'utf8')).filter(r => ID.test(r.id)).map(r => [r.id, r]));
  const meta = new Map(pieces.map(p => [p.part, p]));
  let used = 0;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i], f = fixes.get(p.id);
    if (!f) continue;
    used++;
    if (f.pieza === '-') { pieces.splice(i, 1); continue; }
    if (f.pieza && f.pieza !== p.part) {
      const m = meta.get(f.pieza);
      Object.assign(p, { part: f.pieza, group: m?.group || 'Corregidas', category: m?.category || '', size: m?.size || '',
        image: m?.image || `https://storage.googleapis.com/brickit-prod-imagebox-public/manual_images/pom_part/${f.pieza}/pom_part_lanczos_webp/image.WEBP` });
    }
    if (f.color) p.color = f.color;
  }
  console.log(`correcciones: ${used} aplicadas${fixes.size - used ? `, ${fixes.size - used} no aparecen en estos links` : ''}`);
}

function parseCsv(text) {
  const [head, ...lines] = text.split('\n').map(l => l.trim()).filter(Boolean);
  const cols = head.split(',');
  return lines.filter(l => !l.startsWith('#')).map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}
const csvLine = arr => arr.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',');

async function main() {
  updateLinks();
  addCorrections();
  const links = readLinks();
  const pieces = [];
  const sources = [];
  // Localizador: en que foto de escaneo (y en que parte de la foto) esta cada pieza+color.
  const locator = { scans: {}, parts: {} };
  for (const url of links) {
    const { id, d } = await fetchOffer(url);
    let n = 0;
    for (const scan of Object.values(d.parts)) {
      const scanKey = `${id.slice(0, 8)}-${scan.scanNumber}`;
      locator.scans[scanKey] = { n: scan.scanNumber, source: id, image: scan.scanImage };
      for (const [part, list] of Object.entries(scan.partsMap)) {
        for (const p of list) {
          n++;
          const b = p.boundingBox, c = p.crop;
          if (b && c && !locator.scans[scanKey].w && b.right > b.left && b.bottom > b.top) {
            // crop esta en pixeles y centrado en la caja normalizada: el cociente de centros da el tamano de la foto.
            locator.scans[scanKey].w = Math.round((c.left + c.right) / (b.left + b.right));
            locator.scans[scanKey].h = Math.round((c.top + c.bottom) / (b.top + b.bottom));
          }
          const box = b ? [scanKey, ...[b.left, b.top, b.right, b.bottom].map(v => Math.round(v * 1e4) / 1e4), p.partId] : null;
          pieces.push({ source: id, scan: scan.scanNumber, part, group: p.partGroup, category: p.partCategory,
                        size: p.partSize || '', color: p.colorName, image: p.partImage || '', id: p.partId, box });
        }
      }
    }
    const shapes = new Set(pieces.filter(p => p.source === id).map(p => p.part)).size;
    const ok = n === d.offer.partCount && shapes === d.offer.shapesCount;
    sources.push({ id, url, user: d.offer.username, scans: d.offer.scanCount, parts: n, shapes, declared: d.offer, ok });
    console.log(`${id}: ${n} piezas / ${shapes} formas / ${d.offer.scanCount} escaneos  ${ok ? 'OK' : 'NO CUADRA con lo declarado: ' + JSON.stringify(d.offer)}`);
    if (!ok) process.exitCode = 1;
  }
  applyCorrections(pieces);
  // Localizador: despues de corregir, para que cada caja quede bajo su pieza+color correctos.
  for (const p of pieces) if (p.box) (locator.parts[`${p.part}|${p.color}`] ??= []).push(p.box);
  for (const p of pieces) { delete p.box; delete p.id; }
  if (fs.existsSync(MANUAL_FILE)) {
    for (const r of parseCsv(fs.readFileSync(MANUAL_FILE, 'utf8'))) {
      const qty = Number(r.cantidad || 1);
      for (let k = 0; k < qty; k++) pieces.push({ source: 'manual', scan: 'manual', part: r.pieza, group: r.grupo, category: r.categoria, size: r.tamano, color: r.color, image: '' });
    }
  }

  const key = p => `${p.part}|${p.color}`;
  const byKey = new Map(), byPart = new Map(), byColor = new Map();
  for (const p of pieces) {
    byKey.set(key(p), (byKey.get(key(p)) || 0) + 1);
    if (!byPart.has(p.part)) byPart.set(p.part, { ...p, qty: 0 });
    byPart.get(p.part).qty++;
    byColor.set(p.color, (byColor.get(p.color) || 0) + 1);
  }
  const colors = [...byColor.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const parts = [...byPart.values()].sort((a, b) => b.qty - a.qty || a.part.localeCompare(b.part));

  fs.writeFileSync(path.join(DATA, 'inventory.csv'), [csvLine(['pieza', 'grupo', 'categoria', 'tamano', 'color', 'cantidad'])]
    .concat([...byKey.entries()].sort((a, b) => byPart.get(b[0].split('|')[0]).qty - byPart.get(a[0].split('|')[0]).qty || b[1] - a[1])
      .map(([k, q]) => { const [part, color] = k.split('|'); const m = byPart.get(part); return csvLine([part, m.group, m.category, m.size, color, q]); })).join('\n') + '\n');

  fs.writeFileSync(path.join(DATA, 'color_matrix.csv'), [csvLine(['pieza', 'categoria', 'tamano', 'total', ...colors])]
    .concat(parts.map(m => csvLine([m.part, m.category, m.size, m.qty, ...colors.map(c => byKey.get(`${m.part}|${c}`) || '')]))).join('\n') + '\n');

  const byScan = new Map();
  for (const p of pieces) { const k = `${p.source}|${p.scan}|${p.part}|${p.color}`; byScan.set(k, (byScan.get(k) || 0) + 1); }
  fs.writeFileSync(path.join(DATA, 'by_scan.csv'), [csvLine(['fuente', 'scan', 'pieza', 'categoria', 'tamano', 'color', 'cantidad'])]
    .concat([...byScan.entries()].sort().map(([k, q]) => { const [s, sc, part, color] = k.split('|'); const m = byPart.get(part); return csvLine([s, sc, part, m.category, m.size, color, q]); })).join('\n') + '\n');

  const inventory = {
    generated_at: new Date().toISOString(),
    totals: { pieces: pieces.length, shapes: byPart.size, part_color_combos: byKey.size, colors: colors.length },
    sources,
    colors: Object.fromEntries([...byColor.entries()].sort((a, b) => b[1] - a[1])),
    parts: parts.map(m => ({ part: m.part, group: m.group, category: m.category, size: m.size, qty: m.qty, image: m.image,
      colors: Object.fromEntries(colors.filter(c => byKey.has(`${m.part}|${c}`)).map(c => [c, byKey.get(`${m.part}|${c}`)])) })),
  };
  fs.writeFileSync(path.join(DATA, 'inventory.json'), JSON.stringify(inventory, null, 1) + '\n');
  fs.writeFileSync(path.join(DATA, 'locator.json'), JSON.stringify(locator) + '\n');
  console.log(`\nTOTAL: ${pieces.length} piezas, ${byPart.size} formas, ${byKey.size} pieza+color, ${colors.length} familias de color`);
  console.log('Colores:', inventory.colors);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
