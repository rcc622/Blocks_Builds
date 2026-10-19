// Blocks Builds: biblioteca de modelos, manual paso a paso, inventario y sincronizacion con Brickit.
// Sitio estatico (GitHub Pages). Rutas por hash: #/  #/b/<slug>/<paso>  #/piezas  #/sync
import { Viewer, modelCover } from './viewer.js';
import { FAMILIES } from './colors.js';
import { checkBom, sumBoms } from './check.js';

// En GitHub Pages el repo sale de la URL (usuario.github.io/<repo>/): renombrar el repo no rompe la app.
const REPO = location.hostname.endsWith('.github.io')
  ? `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1]}` : 'rcc622/Blocks_Builds';
const BRICKIT = /https:\/\/brickit\.app\/offer\/[0-9a-f-]{36}/;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtDate = iso => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- Estado de este dispositivo (progreso, estado de cada modelo, tema, token) ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem('legobuilds') || '{}'); } catch { return {}; } },
  set(fn) { const s = this.get(); fn(s); try { localStorage.setItem('legobuilds', JSON.stringify(s)); } catch { /* modo privado */ } return s; },
};

// ---------- Datos ----------
const getJson = url => fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
let dataP, locP;
const data = () => dataP ??= Promise.all([getJson('data/inventory.json'), getJson('builds/index.json'), getJson('data/part_names.json').catch(() => ({}))])
  .then(([inventory, index, names]) => {
    for (const b of index.builds) Object.assign(names, b.descs);
    return { inventory, builds: index.builds, names, parts: new Map(inventory.parts.map(p => [p.part, p])) };
  });
const locator = () => locP ??= getJson('data/locator.json');

const statusOf = b => store.get().status?.[b.slug] || b.status;
const STATUS = { 'diseñado': 'Por armar', armado: 'Armado', fallido: 'Necesita cambios' };
function availability(b, d) {
  const reserved = sumBoms(d.builds.filter(o => o.slug !== b.slug && statusOf(o) === 'armado').map(o => o.bom));
  return checkBom(b.bom, d.inventory, reserved);
}

// Nombres LDraw ("Slope Brick 45  2 x  2") en espanol corto ("Pendiente 45° 2×2").
const ES = [[/\s+/g, ' '], [/ ?(without Inner Stopper Ring|with Ribs between Studs|with Groove|without Reinforcement|Hard-Plastic)/g, ''], [/ x /g, '×'], [/Slope Brick Curved/g, 'Pendiente curva'], [/Slope Brick (\d+)/g, 'Pendiente $1°'], [/Brick/g, 'Ladrillo'],
  [/Plate/g, 'Placa'], [/Tile/g, 'Liso'], [/Inverted/g, 'invertida'], [/Round/g, 'redondo'], [/Corner/g, 'esquina'], [/ with /g, ' con '],
  [/without/g, 'sin'], [/Groove/g, 'ranura'], [/Hinge/g, 'Bisagra'], [/Wheel/g, 'Rueda'], [/Cone/g, 'Cono'], [/Windscreen/g, 'Parabrisas'],
  [/Bracket/g, 'Soporte'], [/Double/g, 'doble'], [/Triple/g, 'triple'], [/Hole/g, 'agujero'], [/Axle/g, 'eje'], [/Dish/g, 'Plato'],
  [/Wedge/g, 'Cuña'], [/Door/g, 'Puerta'], [/Window/g, 'Ventana'], [/Fence/g, 'Cerca'], [/Cylinder/g, 'Cilindro'], [/Turntable/g, 'Giratorio'],
  [/Headlight/g, 'faro'], [/Curved Top/g, 'tope curvo'], [/Studs?/g, 'stud'], [/Log/g, 'tronco'], [/Grille/g, 'rejilla']];
const esName = desc => ES.reduce((s, [re, to]) => s.replace(re, to), desc || '').replace(/^~/, '').trim();
const partName = (d, part) => esName(d.names[part]) || d.parts.get(part)?.category || part;
const swatch = fam => `<span class="swatch" style="--sw:${FAMILIES[fam]?.hex || '#999'}" aria-hidden="true"></span>`;
const famName = fam => FAMILIES[fam]?.es || fam;
const partImg = (d, part) => d.parts.get(part)?.image || '';

// ---------- Chrome global ----------
const view = $('#view');
const viewer = new Viewer();
let current = null; // limpieza de la vista anterior

function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  store.set(s => { s.theme = t || ''; });
  $('#theme-btn')?.setAttribute('aria-label', `Tema: ${t === 'dark' ? 'oscuro' : t === 'light' ? 'claro' : 'automático'}`);
}
setTheme(store.get().theme);
$('#theme-btn').addEventListener('click', () => { const t = store.get().theme; setTheme(t === '' || !t ? 'dark' : t === 'dark' ? 'light' : ''); });

function navActive(name) {
  for (const a of $$('[data-nav]')) a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
}

// ---------- Router ----------
let sharedLink = (() => {
  const q = new URLSearchParams(location.search);
  const m = [q.get('url'), q.get('text'), q.get('title')].join(' ').match(BRICKIT);
  if (m || q.toString()) history.replaceState(null, '', location.pathname + (m ? '#/sync' : location.hash));
  return m?.[0] || '';
})();

let seq = 0; // evita que una vista lenta pinte encima de la siguiente
async function route() {
  current?.(); current = null;
  seq++;
  const [, a, b, c] = (location.hash || '#/').split('/');
  document.body.dataset.view = a === 'b' ? 'manual' : a || 'home';
  scrollTo(0, 0);
  try {
    const d = await data();
    if (a === 'b') return manual(d, decodeURIComponent(b || ''), Number(c) || 0);
    if (a === 'piezas') return inventory(d);
    if (a === 'sync') return sync(d);
    return library(d);
  } catch (e) {
    view.innerHTML = `<section class="page"><div class="panel warn" role="alert"><h1>No se pudieron cargar los datos</h1><p>${esc(e.message)}</p>
      <p><button class="btn" onclick="location.reload()">${icon('refresh')}Reintentar</button></p></div></section>`;
  }
}
addEventListener('hashchange', route);

// ---------- Biblioteca ----------
function library(d) {
  navActive('home');
  document.title = 'Modelos · Blocks Builds';
  const progress = store.get().progress || {};
  const cards = d.builds.map(b => {
    const av = availability(b, d), st = statusOf(b), at = progress[b.slug] || 0, steps = b.steps.length;
    const badge = av.ok ? `<span class="badge ok">${icon('check')}Tienes todas</span>`
      : `<span class="badge warn">${icon('alert')}Faltan ${av.total - av.available}</span>`;
    const cta = at > 0 && at < steps ? `Seguir en el paso ${at}` : st === 'armado' ? 'Ver manual' : 'Abrir manual';
    return `<li class="card">
      <a class="card-link" href="#/b/${esc(b.slug)}${at > 0 && at <= steps ? '/' + at : ''}">
        <div class="card-cover"><img alt="" data-cover="${esc(b.file)}" width="480" height="360"></div>
        <div class="card-body">
          <div class="card-top"><h2>${esc(b.name)}</h2>${st !== 'diseñado' ? `<span class="badge ${st === 'armado' ? 'info' : 'warn'}">${esc(STATUS[st])}</span>` : ''}</div>
          <p>${esc(b.description)}</p>
          <dl class="facts">
            <div><dt>Piezas</dt><dd>${b.pieces}</dd></div>
            <div><dt>Pasos</dt><dd>${steps}</dd></div>
            <div><dt>Nivel</dt><dd class="level" aria-label="Nivel ${b.difficulty} de 3">${[1, 2, 3].map(i => `<i class="${i <= b.difficulty ? 'on' : ''}"></i>`).join('')}</dd></div>
          </dl>
          <div class="card-foot">${badge}<span class="card-cta">${esc(cta)}${icon('chevron-right')}</span></div>
        </div>
      </a></li>`;
  }).join('');
  const t = d.inventory.totals;
  view.innerHTML = `<section class="page">
    <header class="page-head">
      <h1>Mis modelos</h1>
      <p class="lede">Diseñados con tus <strong>${t.pieces}</strong> piezas reales. Cada uno trae su manual paso a paso.</p>
    </header>
    ${d.builds.length ? `<ul class="cards">${cards}</ul>` : `<div class="panel"><p>Todavía no hay modelos. Pídele uno a Claude.</p></div>`}
    <aside class="panel idea">
      <div><h2>¿Quieres otro modelo?</h2>
      <p>Cuéntale a Claude qué quieres armar: una nave, un camión, un robot. Lo diseña solo con tus piezas.</p></div>
      <a class="btn" href="https://github.com/${REPO}/issues/new?labels=idea&title=${encodeURIComponent('Idea: ')}&body=${encodeURIComponent('Quiero armar…\n\nTamaño aproximado (piezas):\nColores que me gustarían:\n')}" target="_blank" rel="noopener">${icon('plus')}Pedir un diseño</a>
    </aside>
  </section>`;
  const io = new IntersectionObserver(entries => entries.forEach(async e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    try { e.target.src = await modelCover(e.target.dataset.cover); e.target.closest('.card-cover').classList.add('ready'); }
    catch { e.target.closest('.card-cover').classList.add('failed'); }
  }), { rootMargin: '200px' });
  $$('img[data-cover]').forEach(img => io.observe(img));
  current = () => io.disconnect();
}

// ---------- Manual paso a paso ----------
async function manual(d, slug, n) {
  const b = d.builds.find(x => x.slug === slug);
  if (!b) { location.hash = '#/'; return; }
  const total = b.steps.length;
  n = Math.max(0, Math.min(total, n));
  document.title = `${b.name}${n ? ` · paso ${n}` : ''} · Blocks Builds`;
  if (n > 0) store.set(s => { (s.progress ??= {})[slug] = n; });
  const step = b.steps[n - 1];
  const av = availability(b, d);

  view.innerHTML = `<section class="manual">
    <header class="manual-bar">
      <a class="icon-btn" href="#/" aria-label="Volver a mis modelos">${icon('arrow-left')}</a>
      <div class="manual-title">
        <h1>${esc(b.name)}</h1>
        <p>${n ? `Paso ${n} de ${total}${step.title ? ` · ${esc(step.title)}` : ''}` : `${b.pieces} piezas · ${total} pasos`}</p>
      </div>
      <button class="icon-btn" id="more-btn" aria-label="Opciones del modelo" aria-haspopup="dialog">${icon('more')}</button>
    </header>
    <div class="stage" id="stage">
      ${n ? `<div class="step-no" aria-hidden="true">${n}</div>` : ''}
      ${n ? `<div class="callout" role="group" aria-label="Piezas nuevas en este paso">
        ${step.parts.map(p => `<button class="pc" data-part="${esc(p.part)}" data-family="${esc(p.family)}" aria-label="${p.qty} × ${esc(partName(d, p.part))} ${esc(famName(p.family))}. Ver dónde está">
          <img alt="" width="56" height="52" data-thumb="parts/${esc(p.file)}|${p.code}" src="${esc(partImg(d, p.part))}"><span class="qty">${p.qty}x</span></button>`).join('')}
      </div>` : ''}
      <div class="stage-tools">
        <button class="icon-btn soft" id="reframe" aria-label="Volver a encuadrar">${icon('focus')}</button>
        ${n ? `<button class="icon-btn soft" id="ghost" aria-pressed="${!!store.get().ghost}" aria-label="Resaltar solo las piezas nuevas">${icon('eye')}</button>` : ''}
      </div>
      <p class="stage-msg" id="stage-msg">Cargando modelo…</p>
    </div>
    <aside class="manual-side">${n ? stepPanel(d, b, n) : overviewPanel(d, b, av)}</aside>
    <nav class="manual-nav" aria-label="Pasos">
      <a class="btn ghost nav-prev ${n === 0 ? 'is-disabled' : ''}" ${n === 0 ? 'aria-disabled="true"' : `href="#/b/${esc(slug)}/${n - 1}"`}>${icon('chevron-left')}<span>Anterior</span></a>
      <div class="progress" role="progressbar" aria-label="Avance" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}">
        ${b.steps.map((_, i) => `<i class="${i < n ? 'done' : ''}${i === n - 1 ? ' now' : ''}"></i>`).join('')}
      </div>
      ${n < total ? `<a class="btn primary nav-next" href="#/b/${esc(slug)}/${n + 1}"><span>${n === 0 ? 'Empezar' : 'Siguiente'}</span>${icon('chevron-right')}</a>`
        : `<button class="btn primary nav-next" id="done-btn"><span>Terminé</span>${icon('check')}</button>`}
    </nav>
  </section>`;

  const stage = $('#stage'), mine = seq;
  stage.prepend(viewer.canvas);
  viewer.resize();
  const msg = $('#stage-msg');
  try {
    await viewer.show(b.file);
    if (mine !== seq) return;
    viewer.ghost = !!store.get().ghost;
    viewer.setStep(n);
    msg.hidden = true;
    for (const img of $$('img[data-thumb]', stage)) {
      const [file, code] = img.dataset.thumb.split('|');
      const url = viewer.partThumb(file, code);
      if (url) { img.src = url; img.classList.add('rendered'); }
    }
  } catch (e) {
    msg.textContent = `No se pudo cargar el modelo 3D (${e.message}). Revisa tu conexión y recarga.`;
    msg.classList.add('warn');
  }

  $('#reframe').addEventListener('click', () => viewer.reframe());
  $('#ghost')?.addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    store.set(s => { s.ghost = on; });
    viewer.setGhost(on);
  });
  view.addEventListener('click', onPartClick);
  $('#more-btn').addEventListener('click', () => buildMenu(d, b));
  $('#done-btn')?.addEventListener('click', () => finished(d, b));
  const keys = e => {
    if (e.target.closest('input, textarea, dialog[open]')) return;
    if (e.key === 'ArrowRight' && n < total) location.hash = `#/b/${slug}/${n + 1}`;
    if (e.key === 'ArrowLeft' && n > 0) location.hash = `#/b/${slug}/${n - 1}`;
  };
  addEventListener('keydown', keys);
  current = () => { removeEventListener('keydown', keys); view.removeEventListener('click', onPartClick); };

  function onPartClick(e) {
    const btn = e.target.closest('[data-part][data-family]');
    if (btn) partDialog(d, btn.dataset.part, btn.dataset.family);
  }
}

function stepPanel(d, b, n) {
  const step = b.steps[n - 1];
  return `<h2 class="side-title">${step.title ? esc(step.title) : `Paso ${n}`}</h2>
    <ul class="part-list">${step.parts.map(p => partRow(d, p)).join('')}</ul>
    <p class="hint">${icon('locate')}Toca una pieza para ver en qué foto de Brickit quedó.</p>`;
}

function partRow(d, p, extra = '') {
  return `<li><button class="part-row" data-part="${esc(p.part)}" data-family="${esc(p.family)}">
      <img alt="" src="${esc(partImg(d, p.part))}" loading="lazy" width="48" height="48">
      <span class="pr-name">${esc(partName(d, p.part))}<span class="pr-meta">${swatch(p.family)}${esc(famName(p.family))} · <span class="mono" translate="no">${esc(p.part)}</span></span></span>
      <span class="pr-qty">${p.qty}x</span>${extra}
    </button></li>`;
}

function overviewPanel(d, b, av) {
  const missing = new Map(av.missing.map(m => [`${m.part}|${m.family}`, m]));
  const merged = Object.values(b.bom.reduce((acc, p) => { (acc[`${p.part}|${p.family}`] ??= { ...p, qty: 0 }).qty += p.qty; return acc; }, {}));
  const rows = merged.sort((x, y) => missing.has(`${y.part}|${y.family}`) - missing.has(`${x.part}|${x.family}`) || y.qty - x.qty)
    .map(p => {
      const m = missing.get(`${p.part}|${p.family}`);
      return partRow(d, p, m ? `<span class="pr-flag warn">Tienes ${m.have}${m.alts[0] ? ` · usa ${esc(famName(m.alts[0].family))}` : ''}</span>` : `<span class="pr-flag ok" aria-label="La tienes">${icon('check')}</span>`);
    }).join('');
  const warn = b.warnings?.length ? `<div class="panel warn small"><strong>Revisar al armar:</strong><ul>${b.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  return `<div class="overview">
      <p>${esc(b.description)}</p>
      ${av.ok ? `<div class="panel ok small">${icon('check')}<span>Tienes las <strong>${av.total}</strong> piezas.${statusOf(b) === 'armado' ? ' Este modelo está armado.' : ''}</span></div>`
        : `<div class="panel warn small">${icon('alert')}<span>Te faltan <strong>${av.total - av.available}</strong> de ${av.total} piezas. Abajo van primero, con un color que sí tienes cuando hay.</span></div>`}
      ${warn}
      <h2 class="side-title">Lo que necesitas</h2>
      <ul class="part-list">${rows}</ul>
    </div>`;
}

// ---------- Dialogos (uno nuevo cada vez; se borra al cerrar) ----------
function openDialog(title, body, wide = false) {
  const el = document.createElement('dialog');
  el.className = `dialog${wide ? ' wide' : ''}`;
  el.innerHTML = `<form method="dialog" class="dlg-head"><h2>${title}</h2><button class="icon-btn" aria-label="Cerrar">${icon('x')}</button></form><div class="dlg-body">${body}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.close(); });
  el.addEventListener('close', () => el.remove());
  document.body.append(el);
  el.showModal();
  return el;
}

async function partDialog(d, part, family) {
  const p = d.parts.get(part);
  const uses = d.builds.map(b => ({ b, q: b.bom.filter(x => x.part === part).reduce((n, x) => n + x.qty, 0) })).filter(x => x.q);
  const el = openDialog(esc(partName(d, part)), `
    <div class="pd-head">
      <img src="${esc(p?.image || '')}" alt="" width="96" height="96">
      <div><p class="mono">${esc(part)}</p><p>${p ? `Tienes <strong>${p.qty}</strong> en total` : 'No está en tu inventario'}</p></div>
    </div>
    ${p ? `<ul class="color-counts">${Object.entries(p.colors).map(([f, q]) => `<li class="${f === family ? 'is-current' : ''}">${swatch(f)}${esc(famName(f))}<strong>${q}</strong></li>`).join('')}</ul>` : ''}
    <h3>Dónde está ${family ? `(${esc(famName(family).toLowerCase())})` : ''}</h3>
    <div id="where"><p class="hint">Buscando en tus fotos de Brickit…</p></div>
    ${uses.length ? `<h3>La usan</h3><ul class="uses">${uses.map(u => `<li><a href="#/b/${esc(u.b.slug)}">${esc(u.b.name)}</a> · ${u.q}</li>`).join('')}</ul>` : ''}`, true);
  try {
    const loc = await locator();
    const keys = family ? [`${part}|${family}`] : Object.keys(p?.colors || {}).map(f => `${part}|${f}`);
    const hits = keys.flatMap(k => (loc.parts[k] || []).map(h => ({ k, h })));
    $('#where', el).innerHTML = hits.length ? whereHtml(loc, hits) : `<p class="hint">Brickit no guardó la posición de esta pieza (la agregaste a mano o vino de otro link).</p>`;
  } catch {
    $('#where', el).innerHTML = `<p class="hint">No se pudo cargar el localizador. Revisa tu conexión.</p>`;
  }
}

// Recortes de la foto de escaneo alrededor de cada pieza + la foto completa con recuadros.
function whereHtml(loc, hits) {
  const byScan = new Map();
  for (const x of hits) (byScan.get(x.h[0]) || byScan.set(x.h[0], []).get(x.h[0])).push(x);
  return [...byScan].map(([scanKey, list]) => {
    const s = loc.scans[scanKey];
    if (!s) return '';
    const crops = list.slice(0, 6).map(({ h: [, l, t, r, b] }) => {
      const W = s.w || 3000, H = s.h || 4000, side = Math.max((r - l) * W, (b - t) * H) * 2.4;
      const rw = side / W, rh = side / H, x0 = (l + r) / 2 - rw / 2, y0 = (t + b) / 2 - rh / 2, S = 88;
      const bw = S / rw, bh = bw * H / W;
      return `<span class="crop" style="background-image:url('${esc(s.image)}');background-size:${bw}px ${bh}px;background-position:${-x0 * bw}px ${-y0 * bh}px"></span>`;
    }).join('');
    const boxes = list.map(({ h: [, l, t, r, b] }) => `<i style="left:${l * 100}%;top:${t * 100}%;width:${(r - l) * 100}%;height:${(b - t) * 100}%"></i>`).join('');
    return `<figure class="where">
        <figcaption>Escaneo ${s.n} · ${plural(list.length, 'pieza', 'piezas')}</figcaption>
        <div class="crops">${crops}</div>
        <details><summary>Ver foto completa</summary><div class="scan"><img src="${esc(s.image)}" alt="Foto del escaneo ${s.n} con la pieza marcada" loading="lazy" width="${s.w || 3024}" height="${s.h || 4032}">${boxes}</div></details>
      </figure>`;
  }).join('');
}

function issueUrl(b, kind) {
  const title = kind === 'fallo' ? `Resultado: ${b.name} — algo falló` : `Resultado: ${b.name}`;
  const body = `Modelo: ${b.name} (\`builds/${b.slug}\`)\n\n¿Se armó completo? \n¿Qué paso falló o quedó flojo? \n¿Qué cambiarías? \n\n(Arrastra aquí fotos del resultado)`;
  return `https://github.com/${REPO}/issues/new?labels=resultado&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function setStatus(b, st) { store.set(s => { (s.status ??= {})[b.slug] = st; }); }

function buildMenu(d, b) {
  const st = statusOf(b);
  const el = openDialog('Opciones', `
    <fieldset class="radios"><legend>Estado del modelo</legend>
      ${Object.entries(STATUS).map(([k, v]) => `<label><input type="radio" name="st" value="${k}" ${k === st ? 'checked' : ''}><span>${v}</span></label>`).join('')}
      <p class="hint">“Armado” aparta sus piezas: los otros modelos ya no cuentan con ellas.</p>
    </fieldset>
    <div class="menu-links">
      <a class="btn ghost" href="${issueUrl(b)}" target="_blank" rel="noopener">${icon('message')}Reportar cómo quedó</a>
      <a class="btn ghost" href="${esc(b.ldr)}" download="${esc(b.slug)}.ldr">${icon('download')}Descargar .ldr (Studio)</a>
      <button class="btn ghost" id="reset-progress">${icon('rotate')}Empezar de nuevo</button>
    </div>`);
  el.addEventListener('change', e => { if (e.target.name === 'st') setStatus(b, e.target.value); });
  $('#reset-progress', el).addEventListener('click', () => { store.set(s => { delete s.progress?.[b.slug]; }); el.close(); location.hash = `#/b/${b.slug}/0`; });
  el.addEventListener('close', () => route());
}

function finished(d, b) {
  const el = openDialog('¡Listo!', `
    <p>Terminaste los ${b.steps.length} pasos de <strong>${esc(b.name)}</strong>. ¿Cómo quedó?</p>
    <div class="menu-links">
      <button class="btn primary" data-st="armado">${icon('check')}Quedó armado</button>
      <a class="btn ghost" data-st="fallido" href="${issueUrl(b, 'fallo')}" target="_blank" rel="noopener">${icon('alert')}Algo falló</a>
      <a class="btn ghost" href="${issueUrl(b)}" target="_blank" rel="noopener">${icon('message')}Mandar fotos</a>
    </div>`);
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-st]');
    if (!btn) return;
    setStatus(b, btn.dataset.st);
    if (btn.tagName === 'BUTTON') { el.close(); location.hash = '#/'; }
  });
}

// ---------- Inventario ----------
const GROUPS = { Bricks: 'Ladrillos', Plates: 'Placas y lisos', Technic: 'Technic', Functional: 'Bisagras', Minifigs: 'Minifigs', Outdoor: 'Naturaleza', Transport: 'Ruedas y más', Building: 'Puertas y ventanas' };
function inventory(d) {
  navActive('piezas');
  document.title = 'Mis piezas · Blocks Builds';
  const inv = d.inventory, f = { q: '', group: '', color: '' };
  const groups = [...new Set(inv.parts.map(p => p.group))];
  view.innerHTML = `<section class="page">
    <header class="page-head">
      <h1>Mis piezas</h1>
      <p class="lede"><strong>${inv.totals.pieces}</strong> piezas · ${inv.totals.shapes} formas · ${inv.totals.colors} colores. Escaneadas con Brickit, actualizado el ${fmtDate(inv.generated_at)}.</p>
    </header>
    <div class="filters">
      <label class="search">${icon('search')}<span class="sr-only">Buscar pieza</span><input type="search" id="q" name="q" placeholder="Busca 3001, pendiente, placa…" autocomplete="off"></label>
      <div class="chips" role="group" aria-label="Tipo de pieza">
        <button class="chip" aria-pressed="true" data-group="">Todas</button>
        ${groups.map(g => `<button class="chip" aria-pressed="false" data-group="${esc(g)}">${esc(GROUPS[g] || g)}</button>`).join('')}
      </div>
      <div class="chips" role="group" aria-label="Color">
        <button class="chip" aria-pressed="true" data-color="">Todos</button>
        ${Object.entries(inv.colors).map(([c, q]) => `<button class="chip" aria-pressed="false" data-color="${esc(c)}">${swatch(c)}${esc(famName(c))} <span class="chip-n">${q}</span></button>`).join('')}
      </div>
    </div>
    <p class="count" id="count" aria-live="polite"></p>
    <ul class="parts-grid" id="grid"></ul>
  </section>`;
  const grid = $('#grid'), count = $('#count');
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const list = inv.parts.filter(p => (!f.group || p.group === f.group) && (!f.color || p.colors[f.color])
      && (!q || p.part.toLowerCase().includes(q) || partName(d, p.part).toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)));
    const pieces = list.reduce((n, p) => n + (f.color ? p.colors[f.color] : p.qty), 0);
    count.textContent = `${plural(list.length, 'forma', 'formas')} · ${plural(pieces, 'pieza', 'piezas')}`;
    grid.innerHTML = list.map(p => `<li><button class="part-card" data-part="${esc(p.part)}" data-family="${esc(f.color)}">
        <span class="pcard-img"><img src="${esc(p.image)}" alt="" loading="lazy" width="96" height="96"></span>
        <span class="pcard-qty">${f.color ? p.colors[f.color] : p.qty}</span>
        <span class="pcard-name">${esc(partName(d, p.part))}</span>
        <span class="pcard-num mono" translate="no">${esc(p.part)}</span>
        <span class="pcard-colors" aria-label="${Object.keys(p.colors).map(famName).join(', ')}">${Object.keys(p.colors).map(swatch).join('')}</span>
      </button></li>`).join('') || `<li class="empty">Ninguna pieza coincide.</li>`;
  };
  draw();
  $('#q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  view.querySelector('.filters').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const key = 'group' in chip.dataset ? 'group' : 'color';
    f[key] = chip.dataset[key];
    for (const c of $$(`.chip[data-${key}]`)) c.setAttribute('aria-pressed', c === chip);
    draw();
  });
  grid.addEventListener('click', e => { const b = e.target.closest('.part-card'); if (b) partDialog(d, b.dataset.part, b.dataset.family); });
}

// ---------- Sincronizar con Brickit ----------
function sync(d) {
  navActive('sync');
  document.title = 'Sincronizar · Blocks Builds';
  const inv = d.inventory, token = store.get().token || '';
  const src = inv.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.split('/offer/')[1].slice(0, 8))}…</a> · ${s.scans} escaneos · ${s.parts} piezas</li>`).join('');
  view.innerHTML = `<section class="page narrow">
    <header class="page-head">
      <h1>Actualizar inventario</h1>
      <p class="lede">Tu inventario sale de Brickit. Cada link de compartir es una foto fija: si escaneas piezas nuevas, comparte un link nuevo y pégalo aquí.</p>
    </header>
    <div class="panel">
      <h2>Ahora</h2>
      <p><strong>${inv.totals.pieces}</strong> piezas de ${plural(inv.sources.length, 'link', 'links')}, actualizado el ${fmtDate(inv.generated_at)}.</p>
      <ul class="plain">${src}</ul>
    </div>
    <form class="panel form" id="sync-form" novalidate>
      <h2>Nuevo link de Brickit</h2>
      <ol class="how"><li>En Brickit abre <strong>Pockets</strong> y toca <strong>Share</strong>.</li><li>Elige <strong>Blocks Builds</strong> (si instalaste la app) o copia el link y pégalo abajo.</li></ol>
      <label class="field"><span>Link</span><input type="url" name="url" id="link" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://brickit.app/offer/…" value="${esc(sharedLink)}" required aria-describedby="link-err"></label>
      <p class="field-err" id="link-err" hidden>Ese no parece un link de Brickit. Debe verse como https://brickit.app/offer/ seguido de un código.</p>
      <fieldset class="radios"><legend>¿Qué es este link?</legend>
        <label><input type="radio" name="mode" value="replace" checked><span>Toda mi colección <small>reemplaza el inventario</small></span></label>
        <label><input type="radio" name="mode" value="add"><span>Un pocket extra <small>se suma al inventario</small></span></label>
      </fieldset>
      <button class="btn primary" id="sync-btn">${icon('refresh')}<span>Actualizar inventario</span></button>
      <p class="hint" id="sync-status" aria-live="polite">${token ? 'Tarda unos 2 minutos en reflejarse aquí.' : 'Primero conecta GitHub (abajo, una sola vez).'}</p>
    </form>
    <details class="panel" ${token ? '' : 'open'}>
      <summary><h2>Conectar con GitHub</h2><span class="badge ${token ? 'ok' : 'warn'}">${token ? 'Conectado' : 'Pendiente'}</span></summary>
      <ol class="how">
        <li>Abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">crear token de GitHub ${icon('external')}</a>.</li>
        <li>Nombre: <span class="mono">BlocksBuilds</span>. Repository access: <strong>Only select repositories</strong> → <span class="mono">${esc(REPO.split('/')[1])}</span>.</li>
        <li>Permissions → Repository → <strong>Contents: Read and write</strong>. Genera y copia el token.</li>
        <li>Pégalo aquí. Se guarda solo en este dispositivo.</li>
      </ol>
      <form class="token-form" id="token-form">
        <label class="field"><span>Token</span><input type="password" id="token" name="token" autocomplete="off" spellcheck="false" placeholder="github_pat_…" value=""></label>
        <div class="row">${token ? `<button class="btn ghost" type="button" id="token-del">Quitar token</button>` : ''}<button class="btn">Guardar</button></div>
      </form>
    </details>
    <details class="panel">
      <summary><h2>Sin token, a mano</h2></summary>
      <p>Edita <a href="https://github.com/${REPO}/edit/main/data/sources/brickit_links.txt" target="_blank" rel="noopener">brickit_links.txt en GitHub ${icon('external')}</a>, pega el link nuevo (reemplaza el viejo si es tu colección completa) y guarda. GitHub regenera el inventario solo.</p>
      <p>Piezas que Brickit no reconoció: agrégalas en <a href="https://github.com/${REPO}/edit/main/data/manual_parts.csv" target="_blank" rel="noopener">manual_parts.csv ${icon('external')}</a> con su número de BrickLink.</p>
    </details>
  </section>`;

  const form = $('#sync-form'), link = $('#link'), err = $('#link-err'), status = $('#sync-status');
  const badLink = err.textContent;
  link.addEventListener('input', () => { err.hidden = true; err.textContent = badLink; link.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const url = (link.value.match(BRICKIT) || [])[0];
    if (!url) { err.hidden = false; link.setAttribute('aria-invalid', 'true'); link.focus(); return; }
    if (inv.sources.some(x => x.url === url)) {
      err.hidden = false; link.setAttribute('aria-invalid', 'true');
      err.textContent = 'Ese link ya está en tu inventario y no cambia. Escanea en Brickit y comparte desde Pockets para obtener uno nuevo.';
      link.focus();
      return;
    }
    if (!store.get().token) {
      status.textContent = 'Falta conectar GitHub: pega tu token abajo y guarda. Solo se hace una vez.';
      $('details.panel').open = true; $('#token').focus();
      return;
    }
    const btn = $('#sync-btn');
    btn.disabled = true; btn.dataset.state = 'loading';
    status.textContent = 'Enviando a GitHub…';
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${store.get().token}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({ event_type: 'brickit-link', client_payload: { url, mode: form.mode.value } }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('GitHub rechazó el token. Revisa que tenga Contents: Read and write en ' + REPO.split('/')[1] + '.');
      if (!res.ok) throw new Error(`GitHub respondió ${res.status}.`);
      sharedLink = '';
      status.textContent = 'Listo, GitHub está importando tu inventario…';
      watchRun(status, btn);
    } catch (ex) {
      status.textContent = ex.message.startsWith('GitHub') ? ex.message : `Sin conexión con GitHub (${ex.message}). Revisa tu internet y vuelve a intentar.`;
      btn.disabled = false; btn.dataset.state = 'error';
    }
  });
  $('#token-form').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#token').value.trim();
    if (!t) return;
    store.set(s => { s.token = t; });
    route();
  });
  $('#token-del')?.addEventListener('click', () => { store.set(s => { delete s.token; }); route(); });
}

// Sigue la corrida de GitHub Actions disparada por el boton (repo publico: no necesita token para leer).
async function watchRun(status, btn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 60e3) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const { workflow_runs: [run] = [] } = await getJson(`https://api.github.com/repos/${REPO}/actions/runs?event=repository_dispatch&per_page=1`);
      if (!run || new Date(run.created_at) < t0 - 60e3) continue;
      if (run.status !== 'completed') { status.innerHTML = `Importando… <a href="${esc(run.html_url)}" target="_blank" rel="noopener">ver en GitHub</a>`; continue; }
      if (run.conclusion === 'success') {
        status.innerHTML = `Inventario actualizado. La app se refresca cuando GitHub Pages publique (≈1 min). <a href="${esc(run.html_url)}" target="_blank" rel="noopener">Detalle</a>`;
        btn.dataset.state = 'success';
      } else {
        status.innerHTML = `La importación falló. <a href="${esc(run.html_url)}" target="_blank" rel="noopener">Ver qué pasó</a>`;
        btn.dataset.state = 'error';
      }
      btn.disabled = false;
      return;
    } catch { /* sin red un momento */ }
  }
  status.textContent = 'Sigue corriendo en GitHub. Revisa la pestaña Actions del repo.';
  btn.disabled = false;
}

route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
