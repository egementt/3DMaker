import * as THREE from 'three';

const P = (k, label, def, min, max, step = 0.01) => ({ k, label, def, min, max, step });

export const PRIMS = {
  box: { label: 'Cube', icon: '▣', params: [P('width', 'Width', 1, 0.05, 10), P('height', 'Height', 1, 0.05, 10), P('depth', 'Depth', 1, 0.05, 10), P('seg', 'Segments', 4, 1, 32, 1)],
    make: p => new THREE.BoxGeometry(p.width, p.height, p.depth, p.seg, p.seg, p.seg) },
  sphere: { label: 'Sphere', icon: '●', params: [P('radius', 'Radius', 0.5, 0.05, 5), P('w', 'Width seg', 32, 3, 96, 1), P('h', 'Height seg', 16, 2, 64, 1)],
    make: p => new THREE.SphereGeometry(p.radius, p.w, p.h) },
  cylinder: { label: 'Cylinder', icon: '▮', params: [P('top', 'Top radius', 0.5, 0, 5), P('bottom', 'Bottom radius', 0.5, 0, 5), P('height', 'Height', 1, 0.05, 10), P('radial', 'Radial seg', 24, 3, 96, 1), P('hseg', 'Height seg', 4, 1, 32, 1)],
    make: p => new THREE.CylinderGeometry(p.top, p.bottom, p.height, p.radial, p.hseg) },
  cone: { label: 'Cone', icon: '▲', params: [P('radius', 'Radius', 0.5, 0.05, 5), P('height', 'Height', 1, 0.05, 10), P('radial', 'Radial seg', 24, 3, 96, 1), P('hseg', 'Height seg', 6, 1, 32, 1)],
    make: p => new THREE.ConeGeometry(p.radius, p.height, p.radial, p.hseg) },
  torus: { label: 'Torus', icon: '◎', params: [P('radius', 'Radius', 0.5, 0.05, 5), P('tube', 'Tube', 0.18, 0.01, 2), P('radial', 'Radial seg', 16, 3, 64, 1), P('tubular', 'Tubular seg', 48, 3, 128, 1)],
    make: p => new THREE.TorusGeometry(p.radius, p.tube, p.radial, p.tubular) },
  knot: { label: 'Torus Knot', icon: '∞', params: [P('radius', 'Radius', 0.4, 0.05, 3), P('tube', 'Tube', 0.12, 0.01, 1), P('tubular', 'Tubular seg', 128, 8, 256, 1), P('radial', 'Radial seg', 12, 3, 32, 1), P('p', 'P', 2, 1, 12, 1), P('q', 'Q', 3, 1, 12, 1)],
    make: p => new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubular, p.radial, p.p, p.q) },
  plane: { label: 'Plane', icon: '▭', params: [P('width', 'Width', 2, 0.05, 20), P('height', 'Height', 2, 0.05, 20), P('seg', 'Segments', 16, 1, 128, 1)],
    make: p => new THREE.PlaneGeometry(p.width, p.height, p.seg, p.seg) },
  gem: { label: 'Gem / Ico', icon: '◆', params: [P('radius', 'Radius', 0.5, 0.05, 5), P('detail', 'Detail', 0, 0, 5, 1)],
    make: p => new THREE.IcosahedronGeometry(p.radius, p.detail) },
  capsule: { label: 'Capsule', icon: '⬭', params: [P('radius', 'Radius', 0.3, 0.05, 3), P('length', 'Length', 0.8, 0, 6), P('cap', 'Cap seg', 8, 1, 32, 1), P('radial', 'Radial seg', 16, 3, 64, 1)],
    make: p => new THREE.CapsuleGeometry(p.radius, p.length, p.cap, p.radial) },
};

export function defaultGeoParams(prim) {
  return Object.fromEntries(PRIMS[prim].params.map(s => [s.k, s.def]));
}

// --- smooth 3D value noise (position-only, so duplicated seam vertices move together) ---
function hash(x, y, z, s) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi, s), hash(xi + 1, yi, zi, s), u), l(hash(xi, yi + 1, zi, s), hash(xi + 1, yi + 1, zi, s), u), v),
    l(l(hash(xi, yi, zi + 1, s), hash(xi + 1, yi, zi + 1, s), u), l(hash(xi, yi + 1, zi + 1, s), hash(xi + 1, yi + 1, zi + 1, s), u), v),
    w) * 2 - 1;
}

export const defaultMods = () => ({ noise: 0, freq: 2, seed: 1, twist: 0, taper: 0 });

export function buildGeometry(d) {
  let geo = PRIMS[d.prim].make(d.geo);
  const m = d.mods;
  if (!m || (!m.noise && !m.twist && !m.taper)) return geo;
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const h = Math.max(max.y - min.y, 1e-6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y - min.y) / h; // 0..1 along height
    if (m.taper) { const k = 1 - m.taper * t; x *= k; z *= k; }
    if (m.twist) {
      const a = THREE.MathUtils.degToRad(m.twist) * (t - 0.5);
      const c = Math.cos(a), s = Math.sin(a);
      [x, z] = [x * c - z * s, x * s + z * c];
    }
    if (m.noise) {
      const f = m.freq, sd = m.seed;
      x += noise3(x * f, y * f, z * f, sd) * m.noise;
      y += noise3(x * f + 17, y * f, z * f, sd) * m.noise;
      z += noise3(x * f, y * f + 31, z * f + 5, sd) * m.noise;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
