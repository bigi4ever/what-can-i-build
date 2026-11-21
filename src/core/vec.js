// Minimal 3D vector / matrix helpers. Vectors are [x, y, z]; matrices are
// arrays of 3 rows. Kept dependency-free so the core runs in Node and the browser.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.sqrt(dot(a, a));
export const normalize = (a) => scale(a, 1 / length(a));
export const distance = (a, b) => length(sub(a, b));

export const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const mulMatVec = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export function mulMat(a, b) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push([0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  }
  return out;
}

export const transpose = (m) => [0, 1, 2].map((j) => [m[0][j], m[1][j], m[2][j]]);

/** Matrix whose columns are the given vectors. */
export const fromColumns = (c0, c1, c2) => transpose([c0, c1, c2]);

/** Rotation matrix about a unit axis by `angle` radians (Rodrigues). */
export function rotationAboutAxis(axis, angle) {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

export const degToRad = (d) => (d * Math.PI) / 180;
