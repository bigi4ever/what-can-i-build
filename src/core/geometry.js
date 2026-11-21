// Turns a model (a tree of edge-to-edge attachments) into world-space poses.
//
// Model format (see docs/model-format.md):
//   { pieces: [ { id, type, color?, attach?: { to, edge, myEdge?, fold } } ] }
// Exactly one piece has no `attach`; it is the root and lies flat on the ground
// (its local frame is the world frame, normal pointing up = +Z).
//
// Attaching piece B to edge `edge` of piece A with B's edge `myEdge`:
//   1. B is laid flat next to A, on the other side of the shared edge, with the
//      same front side (like an unfolded paper net).
//   2. B is then rotated about the shared edge by `fold` degrees. Positive folds
//      lift B towards A's front side (A's normal); 90 = perpendicular,
//      0 = flat, negative = fold towards A's back side.

import {
  add, sub, cross, normalize, mulMatVec, mulMat, transpose, fromColumns,
  rotationAboutAxis, degToRad,
} from './vec.js';

export function transformPoint(pose, p) {
  return add(mulMatVec(pose.R, p), pose.t);
}

export function worldVertices(pose, pieceType) {
  return pieceType.vertices.map((v) => transformPoint(pose, v));
}

export function worldNormal(pose) {
  return mulMatVec(pose.R, [0, 0, 1]);
}

function edgeVertexIndices(pieceType, edge) {
  const n = pieceType.vertices.length;
  return [edge, (edge + 1) % n];
}

/** Pose of B given A's pose and the attachment parameters. */
export function attachPose(parentPose, parentType, childType, { edge, myEdge = 0, fold = 0 }) {
  const [pa0, pa1] = edgeVertexIndices(parentType, edge);
  const a0 = transformPoint(parentPose, parentType.vertices[pa0]);
  const a1 = transformPoint(parentPose, parentType.vertices[pa1]);
  const nA = worldNormal(parentPose);

  const [cb0, cb1] = edgeVertexIndices(childType, myEdge);
  const b0 = childType.vertices[cb0];
  const b1 = childType.vertices[cb1];

  // Child edge runs opposite to the parent edge: b1 -> a0, b0 -> a1.
  const xb = normalize(sub(b0, b1));
  const zb = [0, 0, 1];
  const yb = cross(zb, xb);
  const xw = normalize(sub(a1, a0));
  const zw = nA;
  const yw = cross(zw, xw);
  const Rflat = mulMat(fromColumns(xw, yw, zw), transpose(fromColumns(xb, yb, zb)));
  const tflat = sub(a0, mulMatVec(Rflat, b1));

  // Rotating by -fold about the parent edge direction lifts the child towards nA.
  const Rf = rotationAboutAxis(xw, -degToRad(fold));
  const R = mulMat(Rf, Rflat);
  const t = add(mulMatVec(Rf, sub(tflat, a0)), a0);
  return { R, t };
}

/**
 * Computes a pose for every reachable piece, in build order (root first,
 * then breadth-first). Returns { poses: Map<id, pose>, order: id[] }.
 * Assumes the structure has already been validated (see validate.js).
 */
export function computePoses(model, system) {
  const byId = new Map(model.pieces.map((p) => [p.id, p]));
  const children = new Map();
  let root = null;
  for (const p of model.pieces) {
    if (!p.attach) root = p;
    else {
      if (!children.has(p.attach.to)) children.set(p.attach.to, []);
      children.get(p.attach.to).push(p);
    }
  }
  const poses = new Map();
  const order = [];
  if (!root) return { poses, order };

  // Build order follows the order pieces are listed (so the author controls
  // the steps); a piece listed before its parent waits until the parent is placed.
  poses.set(root.id, { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] });
  order.push(root.id);
  let pending = model.pieces.filter((p) => p.attach);
  while (pending.length) {
    const waiting = [];
    for (const child of pending) {
      const parentPose = poses.get(child.attach.to);
      if (!parentPose) { waiting.push(child); continue; }
      const parent = byId.get(child.attach.to);
      poses.set(child.id, attachPose(
        parentPose,
        system.pieceTypes[parent.type],
        system.pieceTypes[child.type],
        child.attach,
      ));
      order.push(child.id);
    }
    if (waiting.length === pending.length) break; // unreachable pieces (reported by the validator)
    pending = waiting;
  }

  // Sit the model on the ground: shift so the lowest vertex is at z = 0.
  let minZ = Infinity;
  for (const [id, pose] of poses) {
    for (const v of worldVertices(pose, system.pieceTypes[byId.get(id).type])) {
      minZ = Math.min(minZ, v[2]);
    }
  }
  for (const pose of poses.values()) pose.t = [pose.t[0], pose.t[1], pose.t[2] - minZ];

  return { poses, order };
}
