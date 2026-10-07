import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { PRIMS, defaultGeoParams, defaultMods, buildGeometry } from './geometry.js';
import { ParticleSystem, PRESETS, PRESET_Y, TEXTURES, defaultEmitter } from './particles.js';

const $ = s => document.querySelector(s);
const DEG = Math.PI / 180;
const clone = o => JSON.parse(JSON.stringify(o));

// ================= state =================
let state = { nextId: 1, env: { bg: '#1b1d23', grid: true, envLight: 0.8, ground: true }, objects: [] };
let selectedId = null;
let playing = true, wireAll = false, simTime = 0;
const rt = new Map(); // id -> { root, ps? }
const byId = id => state.objects.find(o => o.id === id);

// ================= three setup =================
const wrap = $('#canvas-wrap');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
camera.position.set(3.2, 2.4, 4.2);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0.4, 0);

const grid = new THREE.GridHelper(20, 40, 0x555b68, 0x353a44);
grid.material.transparent = true; grid.material.opacity = 0.7;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.ignore = true;
scene.add(ground);
const defaultSun = new THREE.DirectionalLight(0xffffff, 0.0); scene.add(defaultSun);

const gizmo = new TransformControls(camera, renderer.domElement);
scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', e => {
  orbit.enabled = !e.value;
  if (!e.value) commit();
});
gizmo.addEventListener('objectChange', () => {
  const d = byId(selectedId), r = rt.get(selectedId);
  if (!d || !r) return;
  d.pos = r.root.position.toArray();
  d.rot = [r.root.rotation.x / DEG, r.root.rotation.y / DEG, r.root.rotation.z / DEG];
  d.scl = r.root.scale.toArray();
  syncTransformInputs();
});
let selBox = null;

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);

// ================= object factory =================
let seq = {};
function uniqueName(base) { seq[base] = (seq[base] || 0) + 1; return seq[base] === 1 ? base : `${base}.${String(seq[base] - 1).padStart(3, '0')}`; }
const baseObj = (type, name) => ({ id: state.nextId++, type, name: uniqueName(name), visible: true, pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] });

function newMesh(prim) {
  const o = baseObj('mesh', PRIMS[prim].label);
  return Object.assign(o, {
    prim, geo: defaultGeoParams(prim), mods: defaultMods(),
    mat: { color: '#c9ced8', metalness: 0.1, roughness: 0.5, emissive: '#000000', emissiveIntensity: 1, opacity: 1, wireframe: false, flat: false },
    anim: { spin: 0, bob: 0 },
  });
}
function newEmitter(preset) {
  const o = baseObj('emitter', 'VFX ' + preset[0].toUpperCase() + preset.slice(1));
  o.pos[1] = PRESET_Y[preset] ?? 0;
  o.emitter = defaultEmitter(preset);
  return o;
}
function newLight(kind) {
  const o = baseObj('light', kind === 'point' ? 'Point Light' : 'Sun Light');
  o.light = { kind, color: '#ffffff', intensity: kind === 'point' ? 20 : 2.5, shadow: kind === 'directional' };
  o.pos = kind === 'point' ? [1.5, 2.5, 1.5] : [3, 5, 2];
  return o;
}

// ================= runtime build =================
function makeMaterial(m) {
  return new THREE.MeshStandardMaterial({
    color: m.color, metalness: m.metalness, roughness: m.roughness, emissive: m.emissive,
    emissiveIntensity: m.emissiveIntensity, opacity: m.opacity, transparent: m.opacity < 1,
    wireframe: m.wireframe || wireAll, flatShading: m.flat, side: THREE.DoubleSide,
  });
}
function helperMesh(color, r = 0.12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, wireframe: true }));
  m.userData.helper = true;
  return m;
}

function build(d) {
  let root, ps = null;
  if (d.type === 'mesh') {
    root = new THREE.Mesh(buildGeometry(d), makeMaterial(d.mat));
    root.castShadow = root.receiveShadow = true;
  } else if (d.type === 'light') {
    const L = d.light;
    root = L.kind === 'point' ? new THREE.PointLight(L.color, L.intensity, 0, 2) : new THREE.DirectionalLight(L.color, L.intensity);
    root.castShadow = L.shadow;
    if (L.kind === 'directional') {
      Object.assign(root.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, far: 40 });
      root.shadow.mapSize.set(2048, 2048);
    } else root.shadow.mapSize.set(1024, 1024);
    root.add(helperMesh(L.color, 0.15));
  } else {
    root = new THREE.Group();
    const h = helperMesh(0xffa040, 0.14);
    const dir = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.6, 0xffa040, 0.15, 0.1);
    dir.userData.helper = true;
    root.add(h, dir);
    root.updateMatrixWorld(true);
    ps = new ParticleSystem(d.emitter, root);
    scene.add(ps.points);
  }
  root.userData.id = d.id;
  root.visible = d.visible;
  if (ps) ps.points.visible = d.visible;
  scene.add(root);
  rt.set(d.id, { root, ps });
  applyTransform(d);
}
function disposeRt(id) {
  const r = rt.get(id); if (!r) return;
  if (gizmo.object === r.root) gizmo.detach();
  scene.remove(r.root);
  r.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  if (r.ps) { scene.remove(r.ps.points); r.ps.dispose(); }
  rt.delete(id);
}
function applyTransform(d) {
  const r = rt.get(d.id); if (!r) return;
  r.root.position.fromArray(d.pos);
  r.root.rotation.set(d.rot[0] * DEG, d.rot[1] * DEG, d.rot[2] * DEG);
  r.root.scale.fromArray(d.scl);
  r.root.updateMatrixWorld(true);
}
function updateGeometry(d) {
  const r = rt.get(d.id); r.root.geometry.dispose(); r.root.geometry = buildGeometry(d);
}
function updateMaterial(d) {
  const r = rt.get(d.id), m = d.mat, mat = r.root.material;
  mat.color.set(m.color); mat.metalness = m.metalness; mat.roughness = m.roughness;
  mat.emissive.set(m.emissive); mat.emissiveIntensity = m.emissiveIntensity;
  mat.opacity = m.opacity; mat.transparent = m.opacity < 1; mat.wireframe = m.wireframe || wireAll;
  if (mat.flatShading !== m.flat) { mat.flatShading = m.flat; mat.needsUpdate = true; }
}
function updateLight(d) {
  const r = rt.get(d.id), L = d.light;
  r.root.color.set(L.color); r.root.intensity = L.intensity;
  if (r.root.castShadow !== L.shadow) { r.root.castShadow = L.shadow; }
  r.root.children[0]?.material.color.set(L.color);
}
function rebuildAll() {
  [...rt.keys()].forEach(disposeRt);
  state.objects.forEach(build);
  applyEnv();
  if (!byId(selectedId)) selectedId = null;
  select(selectedId, true);
}
function applyEnv() {
  const e = state.env;
  scene.background = new THREE.Color(e.bg);
  scene.environmentIntensity = e.envLight;
  grid.visible = e.grid; ground.visible = e.ground;
  $('#t-grid').classList.toggle('on', e.grid);
}

// ================= selection / picking =================
function select(id, force) {
  if (id === selectedId && !force) return;
  selectedId = id;
  const r = rt.get(id);
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  if (r) {
    gizmo.attach(r.root);
    if (byId(id).type === 'mesh') { selBox = new THREE.BoxHelper(r.root, 0xffa040); scene.add(selBox); }
  } else gizmo.detach();
  renderOutliner(); renderProps();
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || e.button !== 0 || gizmo.dragging || gizmo.axis) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const rc = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [...rt.values()].filter(r => r.root.visible).map(r => r.root);
  const hits = ray.intersectObjects(targets, true).filter(h => !h.object.userData.ignore);
  let id = null;
  for (const h of hits) { let o = h.object; while (o && !o.userData.id) o = o.parent; if (o) { id = o.userData.id; break; } }
  select(id);
});

// ================= history / persistence =================
const hist = { stack: [], i: -1 };
function snapshot() { return JSON.stringify({ state, seq }); }
function commit() {
  const s = snapshot();
  if (hist.stack[hist.i] === s) return;
  hist.stack.length = hist.i + 1; hist.stack.push(s);
  if (hist.stack.length > 100) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  try { localStorage.setItem('3dmaker.autosave', s); } catch { /* storage unavailable */ }
  updateHistButtons();
}
function restore(s) { const o = JSON.parse(s); state = o.state; seq = o.seq; rebuildAll(); }
function undo() { if (hist.i > 0) { restore(hist.stack[--hist.i]); updateHistButtons(); } }
function redo() { if (hist.i < hist.stack.length - 1) { restore(hist.stack[++hist.i]); updateHistButtons(); } }
function updateHistButtons() { $('#b-undo').disabled = hist.i <= 0; $('#b-redo').disabled = hist.i >= hist.stack.length - 1; }

// ================= actions =================
function add(d, at) { state.objects.push(d); build(d); select(d.id); commit(); return d; }
function remove(id) {
  if (!id) return;
  disposeRt(id); state.objects = state.objects.filter(o => o.id !== id);
  selectedId = null; select(null, true); commit();
}
function duplicate() {
  const d = byId(selectedId); if (!d) return;
  const c = clone(d); c.id = state.nextId++; c.name = uniqueName(d.name.replace(/\.\d+$/, '')); c.pos[0] += 0.5;
  add(c);
}
function newScene() {
  if (state.objects.length && !confirm('Discard the current scene?')) return;
  state = { nextId: 1, env: { ...state.env }, objects: [] }; seq = {}; selectedId = null; rebuildAll(); commit();
}

// ================= templates =================
function addMany(list) {
  list.forEach(d => { state.objects.push(d); build(d); });
  select(list[list.length - 1].id, true); commit();
}
function part(prim, name, y, geo, mat, x = 0) {
  const d = newMesh(prim); d.name = uniqueName(name); d.pos = [x, y, 0];
  Object.assign(d.geo, geo); Object.assign(d.mat, mat); return d;
}
/** Rifle cartridge built from 5 meshes (casing, rim, primer, bullet, tip). x = horizontal offset. */
function ammoRound(x) {
  const brass = { color: '#d4a63c', metalness: 0.95, roughness: 0.28 };
  const copper = { color: '#b96a3a', metalness: 0.9, roughness: 0.32 };
  return [
    part('cylinder', 'Ammo Casing', 0.28, { top: 0.1, bottom: 0.115, height: 0.5, radial: 32 }, brass, x),
    part('cylinder', 'Ammo Rim', 0.015, { top: 0.13, bottom: 0.13, height: 0.03, radial: 32 }, brass, x),
    part('cylinder', 'Ammo Primer', -0.0005, { top: 0.045, bottom: 0.045, height: 0.004, radial: 24 }, { color: '#9aa0a8', metalness: 1, roughness: 0.4 }, x),
    part('cylinder', 'Ammo Bullet', 0.59, { top: 0.09, bottom: 0.09, height: 0.12, radial: 32 }, copper, x),
    part('cone', 'Ammo Tip', 0.75, { radius: 0.09, height: 0.2, radial: 32 }, copper, x),
  ];
}
function fx(name, preset, x, y, z, over) {
  const d = newEmitter(preset); d.name = uniqueName(name); d.pos = [x, y, z];
  Object.assign(d.emitter, { preset: 'custom', rate: 0, loop: true, duration: 3 }, over); return d;
}
/** Layered explosion: flash, fireball, sparks, smoke, debris (all loop every 3s). */
function explosionFx(x, y, z) {
  return [
    fx('Boom Flash', 'explosion', x, y, z, { shape: 'sphere', radius: 0.15, burst: 25, speed: 0.5, drag: 3, life: 0.22, lifeVar: 0.2, size0: 2.4, size1: 0.6, color0: '#ffffff', color1: '#ffd27a', max: 100 }),
    fx('Boom Fireball', 'explosion', x, y, z, { burst: 180, speed: 5, speedVar: 0.6, drag: 2.4, gravity: 1.2, life: 1.1, size0: 1.0, size1: 0.2, color0: '#ffc24a', color1: '#b32a00', turbulence: 1, max: 400 }),
    fx('Boom Sparks', 'sparks', x, y, z, { shape: 'sphere', radius: 0.1, spread: 180, burst: 90, speed: 8, speedVar: 0.7, gravity: -9, drag: 0.4, life: 1.1, size0: 0.12, size1: 0.02, max: 300 }),
    fx('Boom Smoke', 'smoke', x, y, z, { shape: 'sphere', radius: 0.3, spread: 180, burst: 45, speed: 1.6, drag: 1.2, gravity: 0.8, life: 3, lifeVar: 0.3, size0: 0.9, size1: 2.8, alpha0: 0.55, max: 200 }),
    fx('Boom Debris', 'sparks', x, y, z, { shape: 'sphere', radius: 0.1, spread: 120, burst: 35, speed: 6, speedVar: 0.6, gravity: -12, drag: 0.1, life: 1.6, size0: 0.07, size1: 0.07, color0: '#3a2a22', color1: '#1a1410', alpha0: 1, alpha1: 1, additive: false, texture: 'circle', max: 100 }),
  ];
}

// ================= left panel =================
function paletteButton(parent, label, fn) {
  const b = document.createElement('button'); b.textContent = label; b.onclick = fn; parent.appendChild(b);
}
Object.entries(PRIMS).forEach(([k, p]) => paletteButton($('#add-mesh'), `${p.icon} ${p.label}`, () => add(newMesh(k))));
Object.keys(PRESETS).forEach(k => paletteButton($('#add-vfx'), '✦ ' + k[0].toUpperCase() + k.slice(1), () => add(newEmitter(k))));
const tpl = (label, fn) => paletteButton($('#add-tpl'), label, () => addMany(fn()));
tpl('🔫 Ammo round', () => ammoRound(0));
tpl('💥 Explosion', () => explosionFx(0, 0.4, 0));
tpl('Ammo + blast', () => [...ammoRound(-1), ...explosionFx(1, 0.4, 0)]);
paletteButton($('#add-light'), '💡 Point', () => add(newLight('point')));
paletteButton($('#add-light'), '☀ Sun', () => add(newLight('directional')));

const ICON = { mesh: '▣', emitter: '✦', light: '💡' };
function renderOutliner() {
  const ul = $('#outliner'); ul.innerHTML = '';
  state.objects.forEach(d => {
    const li = document.createElement('li');
    li.className = d.id === selectedId ? 'sel' : '';
    li.innerHTML = `<i>${d.type === 'mesh' ? PRIMS[d.prim].icon : ICON[d.type]}</i><span class="n"></span><b title="Toggle visibility">${d.visible ? '👁' : '·'}</b><b title="Delete">✕</b>`;
    li.querySelector('.n').textContent = d.name;
    li.onclick = () => select(d.id);
    const [eye, del] = li.querySelectorAll('b');
    eye.onclick = e => { e.stopPropagation(); d.visible = !d.visible; const r = rt.get(d.id); r.root.visible = d.visible; if (r.ps) r.ps.points.visible = d.visible; renderOutliner(); commit(); };
    del.onclick = e => { e.stopPropagation(); remove(d.id); };
    ul.appendChild(li);
  });
}

// ================= properties panel =================
let trInputs = null;
const fmt = v => (Math.round(v * 1000) / 1000).toString();

function section(parent, title, open = true) {
  const det = document.createElement('details'); det.open = open;
  det.innerHTML = `<summary>${title}</summary><div class="body"></div>`;
  parent.appendChild(det); return det.querySelector('.body');
}
function row(parent, label) {
  const r = document.createElement('div'); r.className = 'row';
  if (label) { const l = document.createElement('label'); l.textContent = label; l.title = label; r.appendChild(l); }
  parent.appendChild(r); return r;
}
/** slider + number; `live` runs on every input, history commits on change */
function slider(parent, label, obj, key, { min = 0, max = 1, step = 0.01, live = () => {} } = {}) {
  const r = row(parent, label);
  const rg = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: obj[key] });
  const nm = Object.assign(document.createElement('input'), { type: 'number', step, value: fmt(obj[key]) });
  const set = v => { obj[key] = v; rg.value = v; nm.value = fmt(v); live(); };
  rg.oninput = () => set(+rg.value);
  rg.onchange = commit;
  nm.onchange = () => { set(+nm.value); commit(); };
  r.append(rg, nm);
}
function colorField(parent, label, obj, key, live) {
  const r = row(parent, label);
  const c = Object.assign(document.createElement('input'), { type: 'color', value: obj[key] });
  c.oninput = () => { obj[key] = c.value; live?.(); };
  c.onchange = commit;
  r.appendChild(c);
}
function check(parent, label, obj, key, live) {
  const r = row(parent, label);
  const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!obj[key] });
  c.onchange = () => { obj[key] = c.checked; live?.(); commit(); };
  r.appendChild(c);
}
function select_(parent, label, obj, key, options, live, rerender) {
  const r = row(parent, label);
  const s = document.createElement('select');
  options.forEach(o => s.add(new Option(o, o)));
  s.value = obj[key];
  s.onchange = () => { obj[key] = s.value; live?.(); commit(); if (rerender) renderProps(); };
  r.appendChild(s);
}
function vec3(parent, label, d, key, scale) {
  const r = row(parent, label); r.classList.add('v3');
  const ins = [0, 1, 2].map(i => {
    const n = Object.assign(document.createElement('input'), { type: 'number', step: scale ? 0.05 : key === 'rot' ? 5 : 0.1, value: fmt(d[key][i]) });
    n.onchange = () => { d[key][i] = +n.value; applyTransform(d); commit(); };
    r.appendChild(n); return n;
  });
  return ins;
}
function syncTransformInputs() {
  const d = byId(selectedId); if (!d || !trInputs) return;
  ['pos', 'rot', 'scl'].forEach(k => trInputs[k].forEach((n, i) => { n.value = fmt(d[k][i]); }));
}

function renderProps() {
  const el = $('#props'); el.innerHTML = ''; trInputs = null;
  const d = byId(selectedId);
  if (!d) { renderSceneProps(el); return; }

  const o = section(el, 'Object');
  const nr = row(o, 'Name');
  const nm = Object.assign(document.createElement('input'), { type: 'text', value: d.name });
  nm.oninput = () => { d.name = nm.value; renderOutliner(); }; nm.onchange = commit; nr.appendChild(nm);
  check(o, 'Visible', d, 'visible', () => {
    const r = rt.get(d.id); r.root.visible = d.visible; if (r.ps) r.ps.points.visible = d.visible; renderOutliner();
  });

  const t = section(el, 'Transform');
  trInputs = { pos: vec3(t, 'Position', d, 'pos'), rot: vec3(t, 'Rotation °', d, 'rot'), scl: vec3(t, 'Scale', d, 'scl', true) };

  if (d.type === 'mesh') {
    const g = section(el, 'Geometry');
    PRIMS[d.prim].params.forEach(p => slider(g, p.label, d.geo, p.k, { min: p.min, max: p.max, step: p.step, live: () => updateGeometry(d) }));
    const md = section(el, 'Modifiers', false);
    const live = () => updateGeometry(d);
    slider(md, 'Noise', d.mods, 'noise', { max: 1, live });
    slider(md, 'Noise freq', d.mods, 'freq', { min: 0.2, max: 10, live });
    slider(md, 'Noise seed', d.mods, 'seed', { min: 1, max: 50, step: 1, live });
    slider(md, 'Twist °', d.mods, 'twist', { min: -720, max: 720, step: 1, live });
    slider(md, 'Taper', d.mods, 'taper', { min: -1, max: 1, live });
    const m = section(el, 'Material'), ml = () => updateMaterial(d);
    colorField(m, 'Color', d.mat, 'color', ml);
    slider(m, 'Metalness', d.mat, 'metalness', { live: ml });
    slider(m, 'Roughness', d.mat, 'roughness', { live: ml });
    colorField(m, 'Emissive', d.mat, 'emissive', ml);
    slider(m, 'Glow power', d.mat, 'emissiveIntensity', { max: 10, live: ml });
    slider(m, 'Opacity', d.mat, 'opacity', { live: ml });
    check(m, 'Wireframe', d.mat, 'wireframe', ml);
    check(m, 'Flat shading', d.mat, 'flat', ml);
    const a = section(el, 'Preview animation', false);
    slider(a, 'Spin °/s', d.anim, 'spin', { min: -360, max: 360, step: 1 });
    slider(a, 'Bob height', d.anim, 'bob', { max: 1 });
  } else if (d.type === 'light') {
    const l = section(el, 'Light'), ll = () => updateLight(d);
    colorField(l, 'Color', d.light, 'color', ll);
    slider(l, 'Intensity', d.light, 'intensity', { max: d.light.kind === 'point' ? 100 : 10, step: 0.1, live: ll });
    check(l, 'Cast shadow', d.light, 'shadow', ll);
  } else renderEmitterProps(el, d);
}

function renderEmitterProps(el, d) {
  const e = d.emitter, ps = () => rt.get(d.id).ps;
  const live = () => ps().refresh();
  const pr = section(el, 'Preset');
  const r = row(pr, 'Preset');
  const sel = document.createElement('select');
  ['custom', ...Object.keys(PRESETS)].forEach(k => sel.add(new Option(k, k))); sel.value = e.preset;
  sel.onchange = () => { if (sel.value !== 'custom') { Object.assign(e, PRESETS[sel.value]); ps().refresh(); ps().reset(); } renderProps(); commit(); };
  r.appendChild(sel);
  const edit = fn => () => { e.preset = 'custom'; fn?.(); };

  const em = section(el, 'Emission');
  const L = (extra = {}) => ({ live, ...extra });
  slider(em, 'Rate /s', e, 'rate', L({ max: 500, step: 1 }));
  slider(em, 'Burst count', e, 'burst', L({ max: 1000, step: 1 }));
  slider(em, 'Duration s', e, 'duration', L({ min: 0.1, max: 20 }));
  check(em, 'Loop', e, 'loop', live);
  slider(em, 'Max particles', e, 'max', L({ min: 10, max: 5000, step: 10 }));
  select_(em, 'Shape', e, 'shape', ['point', 'sphere', 'box', 'disc', 'ring'], live);
  slider(em, 'Shape size', e, 'radius', L({ max: 6 }));
  slider(em, 'Cone spread °', e, 'spread', L({ max: 180, step: 1 }));

  const mo = section(el, 'Motion');
  slider(mo, 'Speed', e, 'speed', L({ max: 20 }));
  slider(mo, 'Speed var', e, 'speedVar', L());
  slider(mo, 'Gravity', e, 'gravity', L({ min: -20, max: 20 }));
  slider(mo, 'Drag', e, 'drag', L({ max: 5 }));
  slider(mo, 'Turbulence', e, 'turbulence', L({ max: 5 }));
  slider(mo, 'Lifetime s', e, 'life', L({ min: 0.1, max: 10 }));
  slider(mo, 'Life var', e, 'lifeVar', L());

  const lk = section(el, 'Look');
  slider(lk, 'Start size', e, 'size0', L({ max: 3 }));
  slider(lk, 'End size', e, 'size1', L({ max: 3 }));
  slider(lk, 'Size var', e, 'sizeVar', L());
  colorField(lk, 'Start color', e, 'color0', live);
  colorField(lk, 'End color', e, 'color1', live);
  slider(lk, 'Start alpha', e, 'alpha0', L());
  slider(lk, 'End alpha', e, 'alpha1', L());
  check(lk, 'Additive glow', e, 'additive', live);
  select_(lk, 'Sprite', e, 'texture', TEXTURES, live);
  const b = row(lk); const rb = Object.assign(document.createElement('button'), { textContent: '⟲ Restart effect', onclick: () => ps().reset() });
  b.appendChild(rb);
}

function renderSceneProps(el) {
  const s = section(el, 'Scene'), e = state.env, live = applyEnv;
  colorField(s, 'Background', e, 'bg', live);
  slider(s, 'Env light', e, 'envLight', { max: 3, live });
  check(s, 'Grid', e, 'grid', live);
  check(s, 'Shadow floor', e, 'ground', live);
  const h = document.createElement('div'); h.className = 'empty';
  h.textContent = 'Select an object to edit it, or add meshes, VFX emitters and lights from the left panel.';
  el.appendChild(h);
}

// ================= toolbar / menus =================
document.querySelectorAll('#toolbar [data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function setMode(m) {
  gizmo.setMode(m);
  document.querySelectorAll('#toolbar [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}
$('#t-snap').onclick = e => {
  const on = e.currentTarget.classList.toggle('on');
  gizmo.setTranslationSnap(on ? 0.25 : null); gizmo.setRotationSnap(on ? 15 * DEG : null); gizmo.setScaleSnap(on ? 0.1 : null);
};
$('#t-wire').onclick = e => { wireAll = e.currentTarget.classList.toggle('on'); state.objects.filter(o => o.type === 'mesh').forEach(updateMaterial); };
$('#t-grid').onclick = () => { state.env.grid = !state.env.grid; applyEnv(); commit(); if (!selectedId) renderProps(); };
function setPlaying(v) { playing = v; $('#t-play').textContent = v ? '⏸ Pause' : '▶ Play'; $('#t-play').classList.toggle('on', v); if (!v) state.objects.forEach(applyTransform); }
$('#t-play').onclick = () => setPlaying(!playing);
const restartAll = () => { simTime = 0; rt.forEach(r => r.ps?.reset()); };
$('#t-restart').onclick = restartAll;

$('#b-new').onclick = newScene;
$('#b-undo').onclick = undo; $('#b-redo').onclick = redo;
$('#b-dup').onclick = duplicate; $('#b-del').onclick = () => remove(selectedId);

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#b-save').onclick = () => download('project.3dmaker.json', JSON.stringify({ format: '3dmaker', version: 1, state, seq }, null, 1), 'application/json');
$('#b-open').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (o.format !== '3dmaker') throw new Error('not a 3DMaker project');
    state = o.state; seq = o.seq || {}; selectedId = null; rebuildAll(); commit();
  } catch (err) { alert('Could not open file: ' + err.message); }
};
function exportGroup() {
  const g = new THREE.Scene();
  state.objects.filter(o => o.type === 'mesh' && o.visible).forEach(d => { const m = rt.get(d.id).root.clone(); m.name = d.name; g.add(m); });
  return g;
}
$('#x-glb').onclick = async () => {
  const g = exportGroup(); if (!g.children.length) return alert('No visible meshes to export.');
  const buf = await new GLTFExporter().parseAsync(g, { binary: true });
  download('asset.glb', new Blob([buf], { type: 'model/gltf-binary' }));
};
$('#x-obj').onclick = () => {
  const g = exportGroup(); if (!g.children.length) return alert('No visible meshes to export.');
  download('asset.obj', new OBJExporter().parse(g), 'text/plain');
};
$('#x-vfx').onclick = () => {
  const fx = state.objects.filter(o => o.type === 'emitter').map(o => ({ name: o.name, position: o.pos, rotation: o.rot, scale: o.scl, ...o.emitter }));
  if (!fx.length) return alert('No VFX emitters in the scene.');
  download('vfx.json', JSON.stringify({ format: '3dmaker-vfx', version: 1, effects: fx }, null, 2), 'application/json');
};
$('#x-png').onclick = () => {
  gizmo.getHelper().visible = false; if (selBox) selBox.visible = false; grid.visible = false;
  renderFrame(0);
  const url = renderer.domElement.toDataURL('image/png');
  gizmo.getHelper().visible = true; if (selBox) selBox.visible = true; grid.visible = state.env.grid;
  const a = Object.assign(document.createElement('a'), { href: url, download: 'screenshot.png' }); a.click();
};

// ================= keyboard =================
addEventListener('keydown', e => {
  if (e.target.matches('input[type=text],input[type=number],select')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod) return;
  else if (e.shiftKey && k === 'd') duplicate();
  else if (e.shiftKey && k === 'r') restartAll();
  else if (k === 'g') setMode('translate');
  else if (k === 'r') setMode('rotate');
  else if (k === 's') setMode('scale');
  else if (k === 'delete' || k === 'backspace') remove(selectedId);
  else if (k === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (k === 'f') focusSelected();
  else if (k === 'escape') select(null);
});
function focusSelected() {
  const r = rt.get(selectedId); if (!r) return;
  const p = r.root.getWorldPosition(new THREE.Vector3());
  const off = camera.position.clone().sub(orbit.target);
  orbit.target.copy(p); camera.position.copy(p).add(off);
}

// ================= render loop =================
const clock = new THREE.Clock();
function renderFrame(dt) {
  if (playing) {
    simTime += dt;
    state.objects.forEach(d => {
      if (d.type !== 'mesh' || !(d.anim.spin || d.anim.bob) || (gizmo.dragging && d.id === selectedId)) return;
      const r = rt.get(d.id);
      r.root.rotation.y = d.rot[1] * DEG + d.anim.spin * DEG * simTime;
      r.root.position.y = d.pos[1] + Math.sin(simTime * 2) * d.anim.bob;
    });
  }
  const scale = renderer.domElement.height / (2 * Math.tan(camera.fov * DEG / 2));
  rt.forEach(r => {
    if (!r.ps) return;
    r.root.updateMatrixWorld(true);
    if (playing && r.root.visible) r.ps.update(Math.min(dt, 0.05), scale);
    else r.ps.material.uniforms.uScale.value = scale;
  });
  orbit.update();
  selBox?.update();
  renderer.render(scene, camera);
}
let statT = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  renderFrame(dt);
  if ((statT += dt) > 0.4) {
    statT = 0;
    let n = 0; rt.forEach(r => { if (r.ps) n += r.ps.alive; });
    $('#stats').textContent = `${state.objects.length} objects · ${n} particles`;
  }
});

// ================= boot =================
function seed() {
  const gem = newMesh('gem');
  Object.assign(gem, { name: 'Crystal' }); gem.pos = [0, 0.7, 0]; gem.geo.radius = 0.45; gem.geo.detail = 0;
  Object.assign(gem.mat, { color: '#5ad1ff', metalness: 0.3, roughness: 0.15, emissive: '#1b78ff', emissiveIntensity: 1.2, flat: true });
  gem.anim = { spin: 45, bob: 0.1 };
  const base = newMesh('cylinder'); base.name = 'Pedestal'; base.pos = [0, -0.25, 0];
  Object.assign(base.geo, { top: 0.7, bottom: 0.8, height: 0.5 }); base.mat.color = '#59606e'; base.mat.roughness = 0.7;
  const fx = newEmitter('magic'); fx.pos = [0, 0.05, 0]; fx.emitter.radius = 0.7;
  const sun = newLight('directional');
  state.objects.push(base, gem, fx, sun);
}
try {
  const saved = localStorage.getItem('3dmaker.autosave');
  if (saved) { const o = JSON.parse(saved); state = o.state; seq = o.seq || {}; }
} catch { /* ignore corrupt autosave */ }
if (!state.objects.length) seed();
resize();
rebuildAll();
commit();
window.__app = { get state() { return state; }, add, newMesh, newEmitter, select, undo, redo, rt };
