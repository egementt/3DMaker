import * as THREE from 'three';

// ---------- sprite textures ----------
const texCache = {};
function canvasTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const radial = (g, stops) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
};
const TEX = {
  soft: g => radial(g, [[0, 1], [0.4, 0.5], [1, 0]]),
  circle: g => radial(g, [[0, 1], [0.85, 1], [1, 0]]),
  spark: g => {
    radial(g, [[0, 1], [0.15, 0.6], [0.4, 0]]);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(32, 0); g.lineTo(36, 28); g.lineTo(64, 32); g.lineTo(36, 36); g.lineTo(32, 64); g.lineTo(28, 36); g.lineTo(0, 32); g.lineTo(28, 28); g.closePath(); g.fill();
  },
  ring: g => radial(g, [[0.55, 0], [0.75, 1], [0.92, 0.9], [1, 0]]),
  smoke: g => {
    let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9; i++) {
      const x = 32 + (r() - 0.5) * 22, y = 32 + (r() - 0.5) * 22, rad = 12 + r() * 10;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
  },
};
export const TEXTURES = Object.keys(TEX);
const getTex = n => (texCache[n] ||= canvasTex(TEX[n] || TEX.soft));

// ---------- presets ----------
const BASE = {
  preset: 'custom', max: 1500, rate: 80, burst: 0, duration: 2, loop: true,
  shape: 'point', radius: 0.2, spread: 20, speed: 2, speedVar: 0.3,
  gravity: 0, drag: 0, turbulence: 0, life: 1.2, lifeVar: 0.3,
  size0: 0.3, size1: 0.1, sizeVar: 0.3, color0: '#ffffff', color1: '#ffffff',
  alpha0: 1, alpha1: 0, additive: true, texture: 'soft',
};
const mk = o => ({ ...BASE, ...o });
export const PRESETS = {
  fire: mk({ preset: 'fire', shape: 'disc', radius: 0.18, spread: 18, speed: 1.4, gravity: 1.5, turbulence: 0.8, life: 1, size0: 0.45, size1: 0.05, color0: '#ffd24a', color1: '#ff2a00', rate: 90 }),
  smoke: mk({ preset: 'smoke', shape: 'disc', radius: 0.15, spread: 15, speed: 0.6, gravity: 0.6, turbulence: 0.6, life: 3, lifeVar: 0.4, size0: 0.4, size1: 1.6, color0: '#8a8a8a', color1: '#2a2a2a', alpha0: 0.5, additive: false, texture: 'smoke', rate: 25 }),
  sparks: mk({ preset: 'sparks', spread: 60, speed: 4, speedVar: 0.6, gravity: -9, drag: 0.2, life: 0.8, size0: 0.1, size1: 0.02, color0: '#fff2b0', color1: '#ff7a1a', rate: 60, texture: 'spark' }),
  explosion: mk({ preset: 'explosion', shape: 'sphere', radius: 0.1, spread: 180, speed: 6, speedVar: 0.5, gravity: -1, drag: 2.2, life: 1.1, size0: 0.8, size1: 0.1, color0: '#ffd070', color1: '#aa2200', rate: 0, burst: 200, duration: 2.5 }),
  magic: mk({ preset: 'magic', shape: 'ring', radius: 0.6, spread: 10, speed: 0.8, gravity: 0.8, turbulence: 1.5, life: 1.8, size0: 0.18, size1: 0, color0: '#b57bff', color1: '#3ad8ff', rate: 60, texture: 'spark' }),
  heal: mk({ preset: 'heal', shape: 'disc', radius: 0.5, spread: 8, speed: 1.2, life: 1.5, size0: 0.15, size1: 0.05, color0: '#7dff9b', color1: '#d4ffe0', rate: 30, texture: 'spark' }),
  snow: mk({ preset: 'snow', max: 800, shape: 'disc', radius: 3, spread: 180, speed: 0.2, gravity: -0.6, drag: 0.5, turbulence: 0.6, life: 8, lifeVar: 0.2, size0: 0.06, size1: 0.06, color0: '#ffffff', color1: '#dfefff', alpha0: 0.9, alpha1: 0.9, additive: false, texture: 'circle', rate: 70 }),
};
export const PRESET_Y = { snow: 3 };
export const defaultEmitter = (name = 'fire') => ({ ...PRESETS[name] });

// ---------- particle system (world-space CPU sim rendered as sized/coloured points) ----------
const VERT = `
attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = aSize * uScale / max(0.001, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `
uniform sampler2D map; varying vec4 vColor;
void main(){ float a = texture2D(map, gl_PointCoord).a * vColor.a; if(a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <colorspace_fragment>
}`;

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c0 = new THREE.Color(), _c1 = new THREE.Color(), _c = new THREE.Color();
const rnd = () => Math.random();
const lerp = (a, b, t) => a + (b - a) * t;

export class ParticleSystem {
  constructor(cfg, source) {
    this.cfg = cfg; this.source = source;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uScale: { value: 500 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 10;
    this.allocate();
    this.refresh();
    this.reset();
  }
  allocate() {
    const n = this.n = Math.max(1, Math.floor(this.cfg.max));
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.rs = new Float32Array(n);
    this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points.geometry.dispose();
    this.points.geometry = g;
    this.cursor = 0;
  }
  /** Call after any cfg change. */
  refresh() {
    const c = this.cfg;
    if (Math.floor(c.max) !== this.n) this.allocate();
    this.material.uniforms.map.value = getTex(c.texture);
    this.material.blending = c.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.needsUpdate = true;
    _c0.set(c.color0); _c1.set(c.color1);
    this.c0 = _c0.clone(); this.c1 = _c1.clone();
  }
  reset() {
    this.age.fill(0); this.life.fill(0); this.size.fill(0);
    this.t = 0; this.lastCycle = -1; this.acc = 0; this.time = 0;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
  get alive() { let k = 0; for (let i = 0; i < this.n; i++) if (this.age[i] < this.life[i]) k++; return k; }

  spawn() {
    const c = this.cfg, n = this.n;
    let i = -1;
    for (let k = 0; k < n; k++) { const j = (this.cursor + k) % n; if (this.age[j] >= this.life[j]) { i = j; break; } }
    if (i < 0) return;
    this.cursor = (i + 1) % n;
    // local-space spawn position
    const r = c.radius;
    switch (c.shape) {
      case 'sphere': do { _p.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (_p.lengthSq() > 1); _p.multiplyScalar(r); break;
      case 'box': _p.set((rnd() * 2 - 1) * r, (rnd() * 2 - 1) * r, (rnd() * 2 - 1) * r); break;
      case 'disc': { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; _p.set(Math.cos(a) * d, 0, Math.sin(a) * d); break; }
      case 'ring': { const a = rnd() * Math.PI * 2; _p.set(Math.cos(a) * r, 0, Math.sin(a) * r); break; }
      default: _p.set(0, 0, 0);
    }
    // direction: random inside cone around +Y
    const cosMax = Math.cos(THREE.MathUtils.degToRad(Math.min(180, c.spread)));
    const ct = lerp(1, cosMax, rnd()), st = Math.sqrt(1 - ct * ct), ph = rnd() * Math.PI * 2;
    _v.set(st * Math.cos(ph), ct, st * Math.sin(ph)).multiplyScalar(c.speed * (1 + (rnd() * 2 - 1) * c.speedVar));
    _p.applyMatrix4(this.source.matrixWorld);
    _v.applyQuaternion(this._q);
    this.pos.set([_p.x, _p.y, _p.z], i * 3);
    this.vel.set([_v.x, _v.y, _v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = Math.max(0.05, c.life * (1 + (rnd() * 2 - 1) * c.lifeVar));
    this.rs[i] = 1 + (rnd() * 2 - 1) * c.sizeVar;
  }

  update(dt, uScale) {
    const c = this.cfg, n = this.n;
    this.material.uniforms.uScale.value = uScale;
    this._q ||= new THREE.Quaternion();
    this.source.matrixWorld.decompose(_p, this._q, _s);
    this.t += dt; this.time += dt;
    const dur = Math.max(0.05, c.duration);
    const cycle = Math.floor(this.t / dur);
    const emitting = c.loop || cycle === 0;
    if (cycle !== this.lastCycle) {
      this.lastCycle = cycle;
      if (emitting) for (let k = 0; k < c.burst; k++) this.spawn();
    }
    if (emitting && c.rate > 0) {
      this.acc += c.rate * dt;
      while (this.acc >= 1) { this.acc--; this.spawn(); }
    }
    const drag = Math.exp(-c.drag * dt), tb = c.turbulence, T = this.time;
    for (let i = 0; i < n; i++) {
      if (this.age[i] >= this.life[i]) { this.size[i] = 0; continue; }
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.size[i] = 0; continue; }
      const i3 = i * 3, i4 = i * 4;
      let vx = this.vel[i3], vy = this.vel[i3 + 1] + c.gravity * dt, vz = this.vel[i3 + 2];
      if (tb) {
        const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
        vx += Math.sin(y * 3 + T * 2 + z * 1.7) * tb * dt * 3;
        vz += Math.cos(x * 3 + T * 1.7 + y * 2) * tb * dt * 3;
        vy += Math.sin(x * 2.3 + z * 3 + T * 2.4) * tb * dt * 1.5;
      }
      vx *= drag; vy *= drag; vz *= drag;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.pos[i3] += vx * dt; this.pos[i3 + 1] += vy * dt; this.pos[i3 + 2] += vz * dt;
      const t = this.age[i] / this.life[i];
      this.size[i] = Math.max(0, lerp(c.size0, c.size1, t) * this.rs[i]);
      _c.copy(this.c0).lerp(this.c1, t);
      this.col[i4] = _c.r; this.col[i4 + 1] = _c.g; this.col[i4 + 2] = _c.b;
      this.col[i4 + 3] = lerp(c.alpha0, c.alpha1, t) * Math.min(1, t / 0.08);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}
