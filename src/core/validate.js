// Checks that a model can really be built from a given inventory:
//   1. structure   - known piece types, valid references, one root, no cycles
//   2. inventory   - never uses more pieces (per shape / colour) than you own
//   3. edges       - each magnetic edge holds at most one other edge
//   4. geometry    - finds every pair of edges that physically meet (including
//                    loops that close a shape, like the last wall of a cube)
//   5. collisions  - no two pieces pass through each other
//   6. stability   - warns when the centre of mass is not over the footprint
//
// Messages are plain English so they can be fed back to a generator (LLM) as-is.

import { sub, dot, cross, normalize, distance, add, scale, length } from './vec.js';
import { computePoses, worldVertices, worldNormal } from './geometry.js';

const EDGE_TOLERANCE = 1e-3;
const SHRINK = 0.97; // shrink pieces slightly so touching edges don't count as collisions

export function validateModel(model, system, inventory = null) {
  const errors = [];
  const warnings = [];
  const result = { ok: false, errors, warnings, stats: {}, connections: [] };

  if (!model || !Array.isArray(model.pieces) || model.pieces.length === 0) {
    errors.push('Model must have a non-empty "pieces" array.');
    return result;
  }

  // ---- 1. structure ---------------------------------------------------------
  const byId = new Map();
  for (const p of model.pieces) {
    if (!p.id) { errors.push('Every piece needs an "id".'); continue; }
    if (byId.has(p.id)) errors.push(`Duplicate piece id "${p.id}".`);
    byId.set(p.id, p);
    if (!system.pieceTypes[p.type]) {
      errors.push(`Piece "${p.id}" has unknown type "${p.type}". Known types: ${Object.keys(system.pieceTypes).join(', ')}.`);
    }
  }
  const roots = model.pieces.filter((p) => !p.attach);
  if (roots.length !== 1) {
    errors.push(`Model must have exactly one root piece (a piece without "attach"); found ${roots.length}.`);
  }

  const edgeUse = new Map(); // "id:edge" -> list of what uses it
  const useEdge = (id, edge, by) => {
    const key = `${id}:${edge}`;
    if (!edgeUse.has(key)) edgeUse.set(key, []);
    edgeUse.get(key).push(by);
  };

  for (const p of model.pieces) {
    if (!p.attach) continue;
    const { to, edge, myEdge = 0, fold } = p.attach;
    const parent = byId.get(to);
    if (!parent) { errors.push(`Piece "${p.id}" attaches to unknown piece "${to}".`); continue; }
    if (to === p.id) { errors.push(`Piece "${p.id}" attaches to itself.`); continue; }
    useEdge(to, edge, p.id);
    useEdge(p.id, myEdge, to);
    const pt = system.pieceTypes[parent.type];
    const ct = system.pieceTypes[p.type];
    if (!pt || !ct) continue;
    if (!pt.connectableEdges.includes(edge)) {
      errors.push(`Piece "${p.id}" attaches to edge ${edge} of "${to}" (${parent.type}), which is not a magnetic edge. Valid edges: ${pt.connectableEdges.join(', ')}.`);
    }
    if (!ct.connectableEdges.includes(myEdge)) {
      errors.push(`Piece "${p.id}" (${p.type}) uses its edge ${myEdge}, which is not a magnetic edge. Valid edges: ${ct.connectableEdges.join(', ')}.`);
    }
    if (typeof fold !== 'number' || !Number.isFinite(fold)) {
      errors.push(`Piece "${p.id}" needs a numeric "fold" angle in degrees.`);
    }
  }

  // Cycle / reachability check.
  if (roots.length === 1) {
    for (const p of model.pieces) {
      const seen = new Set();
      let cur = p;
      while (cur && cur.attach) {
        if (seen.has(cur.id)) { errors.push(`Attachment cycle involving piece "${p.id}".`); break; }
        seen.add(cur.id);
        cur = byId.get(cur.attach.to);
      }
    }
  }

  for (const [key, users] of edgeUse) {
    if (users.length > 1) {
      const [id, edge] = key.split(':');
      errors.push(`Edge ${edge} of "${id}" is used by more than one attachment (${users.join(', ')}). Each edge connects to only one other edge.`);
    }
  }

  // ---- 2. inventory ---------------------------------------------------------
  const demand = countPieces(model.pieces);
  result.stats.pieceCount = model.pieces.length;
  result.stats.byType = Object.fromEntries(
    Object.entries(demand).map(([type, d]) => [type, d.total]),
  );
  if (inventory) {
    const supply = countPieces(inventory.pieces || []);
    for (const [type, d] of Object.entries(demand)) {
      const have = supply[type]?.total ?? 0;
      if (d.total > have) errors.push(`Needs ${d.total} × ${type}, but the inventory has only ${have}.`);
      for (const [color, n] of Object.entries(d.colors)) {
        const haveColor = supply[type]?.colors[color] ?? 0;
        if (n > haveColor) {
          errors.push(`Needs ${n} × ${color} ${type}, but the inventory has only ${haveColor}.`);
        }
      }
    }
    let leftover = 0;
    for (const [type, s] of Object.entries(supply)) leftover += s.total - (demand[type]?.total ?? 0);
    result.stats.unusedPieces = Math.max(0, leftover);
    result.stats.usesWholeInventory = leftover === 0;
  }

  if (errors.length) return result; // geometry is meaningless on a broken structure

  // ---- 3/4. geometry: discover every pair of edges that meet ----------------
  const { poses, order } = computePoses(model, system);
  result.order = order;
  const world = new Map();
  for (const id of order) {
    const p = byId.get(id);
    const type = system.pieceTypes[p.type];
    world.set(id, { piece: p, type, verts: worldVertices(poses.get(id), type), normal: worldNormal(poses.get(id)) });
  }

  const edges = [];
  for (const [id, w] of world) {
    const n = w.verts.length;
    for (const e of w.type.connectableEdges) edges.push({ id, edge: e, a: w.verts[e], b: w.verts[(e + 1) % n] });
  }
  const meetCount = new Map();
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i];
      const B = edges[j];
      if (A.id === B.id) continue;
      const same = (distance(A.a, B.a) < EDGE_TOLERANCE && distance(A.b, B.b) < EDGE_TOLERANCE)
        || (distance(A.a, B.b) < EDGE_TOLERANCE && distance(A.b, B.a) < EDGE_TOLERANCE);
      if (!same) continue;
      result.connections.push({ a: { id: A.id, edge: A.edge }, b: { id: B.id, edge: B.edge } });
      for (const k of [`${A.id}:${A.edge}`, `${B.id}:${B.edge}`]) meetCount.set(k, (meetCount.get(k) || 0) + 1);
    }
  }
  for (const [key, n] of meetCount) {
    if (n > 1) {
      const [id, edge] = key.split(':');
      warnings.push(`Edge ${edge} of "${id}" touches ${n} other edges at once; magnets may not hold all of them.`);
    }
  }
  result.stats.connections = result.connections.length;

  // ---- 5. collisions --------------------------------------------------------
  const shrunk = new Map();
  for (const [id, w] of world) shrunk.set(id, { verts: shrinkPolygon(w.verts, SHRINK), normal: w.normal });
  const ids = [...world.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (polygonsIntersect(shrunk.get(ids[i]), shrunk.get(ids[j]))) {
        errors.push(`Pieces "${ids[i]}" and "${ids[j]}" pass through each other. Check the fold angles (and their signs) on the path between them.`);
      }
    }
  }

  // ---- extras ---------------------------------------------------------------
  let maxZ = 0;
  for (const w of world.values()) for (const v of w.verts) maxZ = Math.max(maxZ, v[2]);
  result.stats.height = round(maxZ);

  // ---- 6. stability ---------------------------------------------------------
  // The model rests on the vertices touching the ground; it stands if its
  // centre of mass (pieces weighted by area) is inside their convex hull.
  const ground = [];
  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (const w of world.values()) {
    for (const v of w.verts) if (v[2] < 1e-3) ground.push([v[0], v[1]]);
    const area = polygonArea(w.type.vertices);
    const c = scale(w.verts.reduce((acc, v) => add(acc, v), [0, 0, 0]), 1 / w.verts.length);
    mass += area;
    cx += c[0] * area;
    cy += c[1] * area;
  }
  const hull = convexHull(ground);
  if (maxZ > 1e-3 && !pointInHull([cx / mass, cy / mass], hull)) {
    warnings.push('The centre of mass is not above the part touching the ground, so the model may tip over.');
    result.stats.stable = false;
  } else {
    result.stats.stable = true;
  }

  result.ok = errors.length === 0;
  return result;
}

function countPieces(pieces) {
  const out = {};
  for (const p of pieces) {
    const n = p.count ?? 1;
    out[p.type] ??= { total: 0, colors: {} };
    out[p.type].total += n;
    if (p.color) out[p.type].colors[p.color] = (out[p.type].colors[p.color] || 0) + n;
  }
  return out;
}

/** Area of a flat polygon given in its local XY plane. */
function polygonArea(verts) {
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const [x1, y1] = verts[i];
    const [x2, y2] = verts[(i + 1) % verts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** 2D convex hull (monotone chain), counter-clockwise. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function pointInHull(p, hull) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-9) return false;
  }
  return true;
}

function shrinkPolygon(verts, factor) {
  const c = scale(verts.reduce((acc, v) => add(acc, v), [0, 0, 0]), 1 / verts.length);
  return verts.map((v) => add(c, scale(sub(v, c), factor)));
}

function pointInConvexPolygon(p, verts, normal) {
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (dot(cross(sub(b, a), sub(p, a)), normal) < -1e-9) return false;
  }
  return true;
}

function segmentHitsPolygon(s0, s1, poly) {
  const d0 = dot(sub(s0, poly.verts[0]), poly.normal);
  const d1 = dot(sub(s1, poly.verts[0]), poly.normal);
  if ((d0 > 1e-9 && d1 > 1e-9) || (d0 < -1e-9 && d1 < -1e-9)) return false;
  if (Math.abs(d0 - d1) < 1e-12) return false; // parallel; coplanar handled separately
  const t = d0 / (d0 - d1);
  const p = add(s0, scale(sub(s1, s0), t));
  return pointInConvexPolygon(p, poly.verts, poly.normal);
}

function polygonsIntersect(P, Q) {
  const coplanar = Math.abs(Math.abs(dot(P.normal, Q.normal)) - 1) < 1e-6
    && Math.abs(dot(sub(Q.verts[0], P.verts[0]), P.normal)) < 1e-6;
  if (coplanar) return coplanarOverlap(P, Q);
  for (const [A, B] of [[P, Q], [Q, P]]) {
    for (let i = 0; i < A.verts.length; i++) {
      if (segmentHitsPolygon(A.verts[i], A.verts[(i + 1) % A.verts.length], B)) return true;
    }
  }
  return false;
}

function coplanarOverlap(P, Q) {
  // Separating axis test in the shared plane.
  const n = P.normal;
  const polys = [P.verts, Q.verts];
  for (const verts of polys) {
    for (let i = 0; i < verts.length; i++) {
      const edge = sub(verts[(i + 1) % verts.length], verts[i]);
      if (length(edge) < 1e-9) continue;
      const axis = normalize(cross(n, edge));
      const [minP, maxP] = project(P.verts, axis);
      const [minQ, maxQ] = project(Q.verts, axis);
      if (maxP <= minQ + 1e-9 || maxQ <= minP + 1e-9) return false;
    }
  }
  return true;
}

function project(verts, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of verts) {
    const d = dot(v, axis);
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}

const round = (x) => Math.round(x * 1000) / 1000;
