// Visor 3D de modelos LDraw empaquetados (.mpd) con pasos de armado. three.js + LDrawLoader.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const VIEW_DIR = new THREE.Vector3(-1, 0.95, 1.35).normalize(); // frente-izquierda-arriba, como los manuales
const DROP = 48; // LDU: cuanto "caen" las piezas nuevas de cada paso

let loaderReady;
const models = new Map();
function loader() {
  loaderReady ??= (async () => {
    const l = new LDrawLoader();
    l.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    await l.preloadMaterials('app/LDConfig.ldr');
    return l;
  })();
  return loaderReady;
}
export function loadModel(url) {
  if (!models.has(url)) {
    const p = loader().then(l => l.loadAsync(url)).then(m => { m.rotation.x = Math.PI; m.updateMatrixWorld(true); return m; });
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return models.get(url);
}

function lights(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-1, 2, 1.5);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.6));
}

// Distancia para que una esfera quepa completa en la camara (vertical u horizontal, la mas estrecha).
function fitDistance(camera, radius) {
  const v = THREE.MathUtils.degToRad(camera.fov), hz = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  return Math.max(radius, 1) / Math.sin(Math.min(v, hz) / 2) * 1.05;
}
function frame(camera, object, zoom = 1) {
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
  const dist = fitDistance(camera, sphere.radius) / zoom;
  camera.position.copy(sphere.center).addScaledVector(VIEW_DIR, dist);
  camera.near = dist / 50; camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(sphere.center);
}

export class Viewer {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Modelo 3D del paso actual. Arrastra para girar, pellizca o usa la rueda para acercar.');
    this.scene = new THREE.Scene();
    lights(this.scene, this.renderer);
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 10000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    this.ghostLine = new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.25 });
    this.original = new WeakMap();
    this.anims = [];
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    const tick = t => {
      requestAnimationFrame(tick);
      this.controls.update();
      if (this.anims.length) { this.anims = this.anims.filter(a => a(t)); this.dirty = true; }
      if (this.dirty) { this.dirty = false; this.renderer.render(this.scene, this.camera); }
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.camera.view?.enabled) this.camera.setViewOffset(w, h, -w * 0.05, -h * 0.07, w, h);
    this.camera.updateProjectionMatrix();
    if (this.needsFrame && this.model) { this.needsFrame = false; this.focus(false); }
    this.dirty = true;
  }

  async show(url) {
    const m = await loadModel(url);
    if (this.model === m) return m;
    if (this.model) this.scene.remove(this.model);
    this.model = m;
    this.parts = m.children.filter(c => c.isGroup);
    for (const p of this.parts) p.userData.base ??= p.position.y;
    this.scene.add(m);
    m.updateMatrixWorld(true);
    this.radius = new THREE.Box3().setFromObject(m).getBoundingSphere(new THREE.Sphere()).radius;
    this.step = -1;
    this.camera.position.copy(VIEW_DIR);
    this.controls.target.set(0, 0, 0);
    return m;
  }

  get steps() { return this.model?.userData.numBuildingSteps || 0; }

  // "Volver a encuadrar": angulo de manual y zoom a lo que hay armado.
  reframe() {
    this.camera.position.copy(this.controls.target).add(VIEW_DIR);
    this.focus(!reduceMotion());
  }

  // Encuadra las piezas visibles conservando el angulo que el usuario eligio (como el manual, que se acerca al paso).
  focus(animate) {
    if (!this.model) return;
    if (!this.canvas.clientWidth) { this.needsFrame = true; return; }
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const p of this.parts) if (p.visible) box.expandByObject(p);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Con recuadro de piezas (paso > 0) deja aire arriba a la izquierda: aleja un poco y baja el modelo.
    const inset = this.step > 0;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (inset) this.camera.setViewOffset(w, h, -w * 0.05, -h * 0.07, w, h); else this.camera.clearViewOffset();
    const dist = fitDistance(this.camera, Math.max(sphere.radius, this.radius * 0.4)) * (inset ? 1.14 : 1);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const toT = sphere.center.clone(), toP = toT.clone().addScaledVector(dir, dist);
    this.camera.near = dist / 50; this.camera.far = dist * 20; this.camera.updateProjectionMatrix();
    if (!animate) { this.controls.target.copy(toT); this.camera.position.copy(toP); this.dirty = true; return; }
    const fromT = this.controls.target.clone(), fromP = this.camera.position.clone(), t0 = performance.now(), dur = 450;
    this.anims.push(t => {
      const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.controls.target.lerpVectors(fromT, toT, e);
      this.camera.position.lerpVectors(fromP, toP, e);
      return k < 1;
    });
  }

  // n = 1..steps muestra hasta ese paso (las piezas nuevas caen en su lugar); 0 = modelo completo.
  setStep(n, animate = true) {
    if (!this.model) return;
    const prev = this.step;
    this.step = n;
    const upto = n === 0 ? this.steps : n;
    const fresh = [];
    for (const p of this.parts) {
      const s = p.userData.buildingStep + 1;
      p.visible = s <= upto;
      p.position.y = p.userData.base;
      if (n > 0 && s === n) fresh.push(p);
      this.ghostPart(p, this.ghost && n > 0 && s < n);
    }
    this.focus(animate && prev >= 0 && !reduceMotion());
    if (animate && n > prev && n > 0 && !reduceMotion()) this.drop(fresh);
    this.dirty = true;
  }

  drop(parts) {
    const t0 = performance.now(), dur = 360;
    parts.forEach(p => { p.position.y = p.userData.base - DROP; });
    this.anims.push(t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      parts.forEach(p => { p.position.y = p.userData.base - DROP * (1 - e); });
      return k < 1;
    });
  }

  setGhost(on) { this.ghost = on; this.setStep(this.step, false); }

  ghostPart(part, on) {
    part.traverse(o => {
      if (!o.material || o.isLineSegments && o.material.isShaderMaterial) { if (o.isLineSegments) o.visible = !on; return; }
      if (!this.original.has(o)) this.original.set(o, o.material);
      o.material = on ? (o.isMesh ? this.ghostMat : this.ghostLine) : this.original.get(o);
    });
  }

  // Miniatura de una pieza (nombre LDraw + color) tal como aparece en el modelo, para el recuadro del paso.
  partThumb(fileName, colorCode) {
    const key = `${fileName}|${colorCode}`;
    this.thumbs ??= new Map();
    if (this.thumbs.has(key)) return this.thumbs.get(key);
    const src = this.parts?.find(p => p.name === fileName && String(p.userData.colorCode) === String(colorCode));
    if (!src) return null;
    const g = src.clone();
    g.position.set(0, 0, 0); g.quaternion.identity();
    const url = snapshot(g, 160, 160, this.original);
    this.thumbs.set(key, url);
    return url;
  }
}

// Render fuera de pantalla -> dataURL. Un solo contexto WebGL para todas las miniaturas.
let off;
function snapshot(object, w, h, original, zoom = 1) {
  if (!off) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    const scene = new THREE.Scene();
    lights(scene, renderer);
    off = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 1, 10000) };
  }
  const wrap = new THREE.Group();
  wrap.rotation.x = Math.PI;
  wrap.add(object);
  object.traverse(o => { o.visible = true; if (original?.has(o)) o.material = original.get(o); });
  wrap.updateMatrixWorld(true);
  off.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  off.renderer.setSize(w, h, false);
  off.camera.aspect = w / h;
  frame(off.camera, wrap, zoom);
  off.scene.add(wrap);
  off.renderer.render(off.scene, off.camera);
  off.scene.remove(wrap);
  return off.renderer.domElement.toDataURL('image/png');
}

const covers = new Map();
export async function modelCover(url, w = 480, h = 360) {
  if (!covers.has(url)) covers.set(url, loadModel(url).then(m => {
    const c = m.clone();
    c.rotation.set(0, 0, 0);
    c.traverse(o => { o.visible = true; });
    return snapshot(c, w, h, null, 1.25);
  }));
  return covers.get(url);
}
