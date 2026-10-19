#!/usr/bin/env node
/**
 * Compila, revisa y empaqueta los modelos de builds/<slug>/ para el visor.
 *
 * Entrada por modelo:
 *   meta.json   nombre, descripcion, dificultad 1-3, estado (disenado|armado|fallido), tags
 *   model.txt   modelo en rejilla (formato abajo) -> genera model.ldr
 *   model.ldr   o un .ldr hecho en Studio / a mano (solo si no hay model.txt)
 * Salida (generada, no editar): model.ldr (si viene de .txt), model.mpd (modelo + todas sus piezas LDraw
 * en un solo archivo, carga rapido en el celular) y builds/index.json (catalogo para la app).
 *
 * Formato model.txt, una pieza por linea:   <pieza> <familia>[:codigoLDraw] <x> <z> <y> [giro]
 *   pieza = numero Brickit/BrickLink (3001). familia = Blacks, Reds... (las de data/inventory.json).
 *   x, z = esquina de la pieza en studs (x a la derecha, z hacia el frente). y = altura de la base en plates
 *   (1 brick = 3 plates). giro = 0|90|180|270 alrededor del eje vertical.
 *   "STEP <titulo>" empieza un paso. "#" comenta. Lineas LDraw crudas ("1 ...") pasan tal cual, sin revisar
 *   estructura (bisagras, ruedas, minifigs).
 * Revisa: piezas vs inventario, piezas encimadas, piezas sin conexion (flotando).
 *
 * Uso:  node scripts/build_models.mjs [slug ...]   (sin slug = todos)
 *       node scripts/build_models.mjs --catalog     (escribe data/part_catalog.csv: medidas LDraw de cada pieza)
 * Sin dependencias: Node >= 18. Descarga piezas LDraw bajo demanda a .ldraw-cache/ (o $LDRAW_CACHE).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, familyOfCode } from '../app/colors.js';
import { checkBom } from '../app/check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDS = path.join(ROOT, 'builds');
const CACHE = process.env.LDRAW_CACHE || path.join(ROOT, '.ldraw-cache');
const MIRRORS = ['https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/',
                 'https://library.ldraw.org/library/official/'];
const readJson = (f, def) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def;
const ALIASES = readJson(path.join(ROOT, 'scripts', 'part_aliases.json'), {}); // numero Brickit -> archivo LDraw
const ldrawName = part => (ALIASES[part] || part).toLowerCase() + '.dat';

// ---------- Libreria LDraw: descarga bajo demanda + cache en disco ----------
const files = new Map();
function ldrawFile(name) {
  name = name.toLowerCase().replace(/\\/g, '/');
  if (!files.has(name)) files.set(name, (async () => {
    const rels = (name.startsWith('s/') ? ['parts/'] : /^(48|8)\//.test(name) ? ['p/'] : ['parts/', 'p/']).map(d => d + name);
    for (const rel of rels) {
      const local = path.join(CACHE, rel);
      if (fs.existsSync(local)) return { path: rel, text: fs.readFileSync(local, 'utf8') };
    }
    // Primero el mirror completo en GitHub; ldraw.org solo si ahi no esta (limita peticiones, da 429).
    let error = null;
    for (const m of MIRRORS) for (const rel of rels) {
      const local = path.join(CACHE, rel);
      if (fs.existsSync(local + '.404')) continue;
      const res = await fetch(m + rel);
      if (res.ok) {
        const text = (await res.text()).replace(/\r\n?/g, '\n');
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, text);
        return { path: rel, text };
      }
      if (res.status !== 404) error = `${m + rel} -> HTTP ${res.status}`;
      else if (m === MIRRORS.at(-1) && !error) { fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local + '.404', ''); }
    }
    if (error) throw new Error(error);
    return null;
  })());
  return files.get(name);
}

// ---------- Geometria: caja, cara de abajo y studs de cada pieza ----------
const subRefs = text => text.split('\n').map(l => l.trim().split(/\s+/)).filter(t => t[0] === '1' && t.length >= 15)
  .map(t => ({ code: t[1], m: t.slice(2, 14).map(Number), file: t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/') }));
const geo = new Map();
function analyze(name) {
  if (!geo.has(name)) geo.set(name, (async () => {
    const f = await ldrawFile(name);
    if (!f) throw new Error(`No encontre "${name}" en la libreria LDraw. Mapea el numero en scripts/part_aliases.json`);
    const verts = [], studs = [];
    const first = f.text.split('\n').find(l => l.trim());
    for (const line of f.text.split('\n')) {
      const t = line.trim().split(/\s+/);
      if (['2', '3', '4'].includes(t[0])) for (let i = 2; i + 2 < t.length; i += 3) verts.push(+t[i], +t[i + 1], +t[i + 2]);
    }
    const subs = subRefs(f.text);
    const kids = await Promise.all(subs.map(s => analyze(s.file)));
    subs.forEach(({ m: [x, y, z, a, b, c, d, e, g2, g, h, i] }, k) => {
      const kid = kids[k], tf = (p, q, r) => [x + a * p + b * q + c * r, y + d * p + e * q + g2 * r, z + g * p + h * q + i * r];
      const upright = e > 0.99;
      if (kid.isStud && upright) { studs.push(tf(0, 0, 0)); return; }
      for (let j = 0; j < kid.verts.length; j += 3) verts.push(...tf(kid.verts[j], kid.verts[j + 1], kid.verts[j + 2]));
      if (upright) for (const s of kid.studs) studs.push(tf(...s));
    });
    let minY = Infinity, maxY = -Infinity;
    for (let j = 1; j < verts.length; j += 3) { minY = Math.min(minY, verts[j]); maxY = Math.max(maxY, verts[j]); }
    // Un "stud" de arriba: primitiva stud*.dat que crece hacia arriba (-Y) desde su origen. Los tubos de abajo no.
    const isStud = /^stud\d*[a-z]?\.dat$/.test(name.split('/').pop()) && minY < -2 && maxY < 0.5;
    let desc = first ? first.trim().replace(/^0\s*/, '') : name;
    if (desc.startsWith('~Moved to') && kids[0]) desc = kids[0].desc;
    return { desc, verts, studs, isStud };
  })());
  return geo.get(name);
}

async function partInfo(part) {
  const a = await analyze(ldrawName(part));
  const v = a.verts;
  if (!v.length) throw new Error(`${part}: sin geometria`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < v.length; j += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[j + k]); max[k] = Math.max(max[k], v[j + k]); }
  const bot = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let j = 0; j < v.length; j += 3) if (v[j + 1] > max[1] - 0.5) {
    bot.x0 = Math.min(bot.x0, v[j]); bot.x1 = Math.max(bot.x1, v[j]); bot.z0 = Math.min(bot.z0, v[j + 2]); bot.z1 = Math.max(bot.z1, v[j + 2]);
  }
  return { desc: a.desc, min, max, bot, studs: a.studs };
}

// ---------- model.txt -> piezas colocadas ----------
const ROT = { 0: [1, 0, 0, 0, 1, 0, 0, 0, 1], 90: [0, 0, 1, 0, 1, 0, -1, 0, 0], 180: [-1, 0, 0, 0, 1, 0, 0, 0, -1], 270: [0, 0, -1, 0, 1, 0, 1, 0, 0] };
const fmt = n => String(Math.round(n * 1000) / 1000);

async function compileTxt(text, where) {
  const steps = [{ title: '', pieces: [] }];
  const errors = [];
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const at = `${where}:${n + 1}`;
    if (/^STEP\b/i.test(line)) {
      if (steps.at(-1).pieces.length) steps.push({ title: '', pieces: [] });
      steps.at(-1).title = line.slice(4).trim();
      continue;
    }
    if (line.startsWith('1 ')) { steps.at(-1).pieces.push({ raw: line, at }); continue; }
    const [part, colorTok, xs, zs, ys, rs = '0'] = line.split(/\s+/);
    const [family, codeTok] = colorTok?.split(':') || [];
    const [x, z, y, r] = [xs, zs, ys, rs].map(Number);
    if (!FAMILIES[family]) { errors.push(`${at}: familia de color "${family}" no existe`); continue; }
    if (![x, z, y].every(Number.isFinite) || !ROT[r]) { errors.push(`${at}: esperaba "<pieza> <familia> x z y [0|90|180|270]"`); continue; }
    steps.at(-1).pieces.push({ part, family, code: codeTok ? Number(codeTok) : FAMILIES[family].ldraw, x, z, y, r, at });
  }
  for (const s of steps) for (const p of s.pieces) if (p.part) {
    const info = await partInfo(p.part);
    const M = ROT[p.r];
    const rot = (px, pz) => [M[0] * px + M[2] * pz, M[6] * px + M[8] * pz];
    const corners = [[info.min[0], info.min[2]], [info.max[0], info.min[2]], [info.min[0], info.max[2]], [info.max[0], info.max[2]]].map(c => rot(...c));
    const rx0 = Math.min(...corners.map(c => c[0])), rx1 = Math.max(...corners.map(c => c[0]));
    const rz0 = Math.min(...corners.map(c => c[1])), rz1 = Math.max(...corners.map(c => c[1]));
    // Rejilla: z crece hacia el frente = -Z de LDraw. Y de LDraw crece hacia abajo.
    p.pos = [p.x * 20 - rx0, -p.y * 8 - info.max[1], -p.z * 20 - rz1];
    // Piezas que salen de su base por arriba (hojas, plantas): alinea su cara de abajo a la rejilla, no su caja.
    // Solo si x/z son enteros; un x=1.5 es un medio stud a proposito. Si la base tambien sobresale (petalos de
    // 15469), usa decimales: x/z = esquina de la caja, mira la caja con --part.
    const off = v => { const r = v - Math.round(v / 20) * 20; return Math.abs(r) > 0.5 ? r : 0; };
    const bRel = [[info.bot.x0, info.bot.z0], [info.bot.x1, info.bot.z1]].map(c => rot(...c));
    if (Number.isInteger(p.x)) p.pos[0] -= off(p.pos[0] + Math.min(bRel[0][0], bRel[1][0]));
    if (Number.isInteger(p.z)) p.pos[2] -= off(p.pos[2] + Math.max(bRel[0][1], bRel[1][1]));
    p.w = Math.round((rx1 - rx0) / 20); p.d = Math.round((rz1 - rz0) / 20); p.h = Math.max(1, Math.round((info.max[1] - info.min[1]) / 8));
    const toCell = (wx, wz) => [Math.floor(wx / 20 + 1e-6), Math.floor(-wz / 20 + 1e-6)];
    p.studs = info.studs.map(([sx, sy, sz]) => { const [a, b] = rot(sx, sz); return [...toCell(p.pos[0] + a, p.pos[2] + b), Math.round(-(p.pos[1] + sy) / 8)]; });
    const bc = [[info.bot.x0, info.bot.z0], [info.bot.x1, info.bot.z1]].map(c => rot(...c)).map(([a, b]) => [p.pos[0] + a, p.pos[2] + b]);
    const bx = [Math.min(bc[0][0], bc[1][0]), Math.max(bc[0][0], bc[1][0])], bz = [Math.min(-bc[0][1], -bc[1][1]), Math.max(-bc[0][1], -bc[1][1])];
    p.bottom = [];
    for (let i = Math.floor(bx[0] / 20 + 0.05); i < Math.ceil(bx[1] / 20 - 0.05); i++)
      for (let k = Math.floor(bz[0] / 20 + 0.05); k < Math.ceil(bz[1] / 20 - 0.05); k++) p.bottom.push([i, k]);
    p.desc = info.desc;
  }
  return { steps, errors };
}

// Encimadas y flotando. Aproximado: una pieza ocupa su caja completa; conecta si un stud suyo entra en la cara
// de abajo de otra (o al reves). Todo debe colgar, directa o indirectamente, de alguna pieza en el piso (y = 0).
function checkStructure(pieces) {
  const issues = [];
  const occ = new Map();
  for (const p of pieces) for (let i = p.x; i < p.x + p.w; i++) for (let k = p.z; k < p.z + p.d; k++) for (let l = p.y; l < p.y + p.h; l++) {
    const key = `${Math.floor(i)},${Math.floor(k)},${l}`;
    if (occ.has(key)) issues.push(`encimada: ${p.at} (${p.part}) choca con ${occ.get(key).at} (${occ.get(key).part}) en x${Math.floor(i)} z${Math.floor(k)} y${l}`);
    else occ.set(key, p);
  }
  const links = new Map(pieces.map(p => [p, new Set()]));
  const bottoms = new Map();
  for (const p of pieces) for (const [i, k] of p.bottom) bottoms.set(`${i},${k},${p.y}`, p);
  for (const p of pieces) for (const [i, k, l] of p.studs) {
    const q = bottoms.get(`${i},${k},${l}`);
    if (q && q !== p) { links.get(p).add(q); links.get(q).add(p); }
  }
  const seen = new Set(), queue = pieces.filter(p => p.y === 0);
  queue.forEach(p => seen.add(p));
  while (queue.length) for (const q of links.get(queue.pop())) if (!seen.has(q)) { seen.add(q); queue.push(q); }
  for (const p of pieces) if (!seen.has(p)) issues.push(`flotando: ${p.at} (${p.part}) no conecta con nada que llegue al piso`);
  const unique = [...new Set(issues.filter(i => i.startsWith('encimada')).map(i => i.split(' choca')[0]))];
  return [...unique.map(u => issues.find(i => i.startsWith(u))), ...issues.filter(i => i.startsWith('flotando'))];
}

function toLdr(name, steps) {
  const out = [`0 ${name}`, '0 Name: model.ldr', '0 Author: legobuilds (generado por scripts/build_models.mjs desde model.txt)', ''];
  steps.forEach((s, i) => {
    if (s.title) out.push(`0 // ${s.title}`);
    for (const p of s.pieces) out.push(p.raw || `1 ${p.code} ${p.pos.map(fmt).join(' ')} ${ROT[p.r].join(' ')} ${ldrawName(p.part)}`);
    if (i < steps.length - 1) out.push('0 STEP');
  });
  return out.join('\n') + '\n';
}

// .ldr (de Studio, a mano o generado) -> pasos con piezas { part, family, code }
function readLdr(text) {
  const steps = [{ title: '', pieces: [] }];
  const back = Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [v.toLowerCase(), k]));
  for (const raw of text.split('\n')) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === '0' && t[1] === 'STEP') { steps.push({ title: '', pieces: [] }); continue; }
    if (t[0] === '0' && t[1] === '//' && !steps.at(-1).pieces.length) { steps.at(-1).title = t.slice(2).join(' '); continue; }
    if (t[0] !== '1' || t.length < 15) continue;
    const file = t.slice(14).join(' ').toLowerCase().replace(/\.dat$/, '');
    steps.at(-1).pieces.push({ part: back[file] || file, file: file + '.dat', code: Number(t[1]), family: familyOfCode(t[1]) });
  }
  return steps.filter(s => s.pieces.length);
}

// Empaqueta: el .ldr + cada archivo LDraw que usa, embebidos con "0 FILE" (mismo formato que three.js packLDrawModel).
async function pack(ldrText) {
  const embedded = [], done = new Map();
  const embed = async name => {
    const f = await ldrawFile(name);
    if (!f) throw new Error(`No encontre "${name}" en la libreria LDraw`);
    if (done.has(f.path)) return f.path;
    done.set(f.path, true);
    embedded.push(null);
    const slot = embedded.length - 1;
    embedded[slot] = `0 FILE ${f.path}\n${await rewrite(f.text)}`;
    return f.path;
  };
  const rewrite = async text => {
    const lines = text.split('\n').filter(l => !/^\s*0\s+(\/\/|!HISTORY|!LICENSE|Author:)/.test(l) && l.trim());
    const out = [];
    for (const l of lines) {
      const t = l.trim().split(/\s+/);
      out.push(t[0] === '1' && t.length >= 15 ? [...t.slice(0, 14), await embed(t.slice(14).join(' '))].join(' ') : l.trim());
    }
    return out.join('\n') + '\n';
  };
  const root = await rewrite(ldrText);
  return root + embedded.join('');
}

async function buildOne(slug, inventory) {
  const dir = path.join(BUILDS, slug);
  const meta = readJson(path.join(dir, 'meta.json'), {});
  const txt = path.join(dir, 'model.txt'), ldr = path.join(dir, 'model.ldr');
  const warnings = [];
  let ldrText;
  if (fs.existsSync(txt)) {
    const { steps, errors } = await compileTxt(fs.readFileSync(txt, 'utf8'), `builds/${slug}/model.txt`);
    if (errors.length) throw new Error(errors.join('\n'));
    warnings.push(...checkStructure(steps.flatMap(s => s.pieces.filter(p => p.part))));
    ldrText = toLdr(meta.name || slug, steps);
    fs.writeFileSync(ldr, ldrText);
  } else if (fs.existsSync(ldr)) ldrText = fs.readFileSync(ldr, 'utf8').replace(/\r\n?/g, '\n');
  else throw new Error(`builds/${slug}: falta model.txt o model.ldr`);

  const steps = readLdr(ldrText);
  const descs = {};
  for (const s of steps) for (const p of s.pieces) descs[p.part] ??= (await analyze(ldrawName(p.part))).desc;
  for (const p of steps.flatMap(s => s.pieces)) if (!p.family) warnings.push(`color LDraw ${p.code} (${p.part}) no corresponde a ninguna familia de Brickit`);
  const group = list => Object.values(list.reduce((acc, p) => {
    const k = `${p.part}|${p.family}|${p.code}`;
    (acc[k] ??= { part: p.part, family: p.family, code: p.code, file: p.file, qty: 0 }).qty++;
    return acc;
  }, {}));
  const bom = group(steps.flatMap(s => s.pieces));
  const check = checkBom(bom, inventory);
  fs.writeFileSync(path.join(dir, 'model.mpd'), await pack(ldrText));

  const pieces = bom.reduce((n, b) => n + b.qty, 0);
  console.log(`\n${slug}: ${pieces} piezas, ${steps.length} pasos  ${check.ok ? 'OK inventario' : `FALTAN ${check.missing.length} tipos`}`);
  for (const m of check.missing) console.log(`  falta ${m.part} ${m.family}: necesito ${m.need}, tengo ${m.have}${m.alts.length ? ' (sustituto: ' + m.alts.map(a => a.family).join(', ') + ')' : ''}`);
  for (const w of warnings) console.log('  aviso ' + w);
  return {
    slug, name: meta.name || slug, description: meta.description || '', difficulty: meta.difficulty || 1,
    status: meta.status || 'diseñado', tags: meta.tags || [], photos: (meta.photos || []).map(p => `builds/${slug}/${p}`),
    file: `builds/${slug}/model.mpd`, ldr: `builds/${slug}/model.ldr`, pieces, warnings, descs,
    bom: bom.map(({ part, family, qty }) => ({ part, family, qty })),
    steps: steps.map(s => ({ title: s.title, parts: group(s.pieces) })),
  };
}

async function catalog(inventory) {
  const rows = [['pieza', 'ldraw', 'descripcion', 'ancho', 'fondo', 'alto_plates', 'studs_arriba', 'cantidad', 'colores']];
  for (const p of inventory.parts) {
    try {
      const i = await partInfo(p.part);
      rows.push([p.part, ldrawName(p.part), i.desc, (i.max[0] - i.min[0]) / 20, (i.max[2] - i.min[2]) / 20, (i.max[1] - i.min[1]) / 8,
        i.studs.length, p.qty, Object.entries(p.colors).map(([c, q]) => `${c}:${q}`).join(' ')]);
    } catch (e) { rows.push([p.part, ldrawName(p.part), 'NO ENCONTRADA: ' + e.message.split('.')[0], '', '', '', '', p.qty, '']); }
  }
  const csv = rows.map(r => r.map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'data', 'part_catalog.csv'), csv);
  // Nombres LDraw para la app (la vista de piezas los traduce al espanol).
  const names = Object.fromEntries(rows.slice(1).filter(r => r[3] !== '').map(r => [r[0], r[2]]));
  fs.writeFileSync(path.join(ROOT, 'data', 'part_names.json'), JSON.stringify(names, null, 1) + '\n');
  console.log(`data/part_catalog.csv: ${rows.length - 1} piezas, ${rows.filter(r => String(r[2]).startsWith('NO ')).length} sin LDraw`);
}

async function main() {
  const inventory = readJson(path.join(ROOT, 'data', 'inventory.json'));
  if (process.argv.includes('--catalog')) return catalog(inventory);
  if (process.argv[2] === '--part') {
    // Ayuda para disenar: como queda cada pieza en la rejilla con giro 0, puesta en x=0 z=0 y=0.
    for (const part of process.argv.slice(3)) {
      const { steps: [{ pieces: [p] }] } = await compileTxt(`${part} Blacks 0 0 0`, part);
      console.log(`${part} ${p.desc}: ${p.w}x${p.d} studs, ${p.h} plates. studs arriba (x,z,y): ${p.studs.map(s => s.join(',')).join(' ')}  cara de abajo (x,z): ${p.bottom.map(s => s.join(',')).join(' ')}`);
    }
    return;
  }
  const wanted = process.argv.slice(2);
  const slugs = fs.readdirSync(BUILDS).filter(s => fs.statSync(path.join(BUILDS, s)).isDirectory()).sort();
  const index = readJson(path.join(BUILDS, 'index.json'), { builds: [] });
  const bySlug = new Map(index.builds.map(b => [b.slug, b]));
  let failed = false;
  for (const slug of slugs) {
    if (wanted.length && !wanted.includes(slug)) continue;
    try { bySlug.set(slug, await buildOne(slug, inventory)); }
    catch (e) { failed = true; console.error(`\nERROR ${slug}:\n${e.message}`); }
  }
  const builds = slugs.filter(s => bySlug.has(s)).map(s => bySlug.get(s));
  fs.writeFileSync(path.join(BUILDS, 'index.json'), JSON.stringify({ generated_at: new Date().toISOString(), builds }, null, 1) + '\n');
  console.log(`\nbuilds/index.json: ${builds.length} modelos`);
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
