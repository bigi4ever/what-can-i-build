// Matches models against what the user actually owns.
//
// Colours in a bundled model are only a suggestion: before checking a model we
// repaint it with the colours the user has (keeping the original colour where
// possible), so a model is never rejected just because the colours differ.

import { validateModel } from './validate.js';

/** Merges inventory rows into { type: { color: count } }. */
export function supplyByTypeAndColor(inventory) {
  const out = {};
  for (const row of inventory.pieces || []) {
    const n = row.count ?? 1;
    if (n <= 0) continue;
    out[row.type] ??= {};
    const color = row.color ?? '';
    out[row.type][color] = (out[row.type][color] || 0) + n;
  }
  return out;
}

/** Returns a copy of the model whose piece colours come from the inventory. */
export function recolorModel(model, inventory) {
  const remaining = structuredClone(supplyByTypeAndColor(inventory));
  const copy = structuredClone(model);
  const unassigned = [];

  // First pass: keep the model's colour when the user has a piece of it.
  for (const p of copy.pieces) {
    const pool = remaining[p.type];
    if (pool && p.color && pool[p.color] > 0) pool[p.color] -= 1;
    else unassigned.push(p);
  }
  // Second pass: give the rest whichever colour the user has most of.
  for (const p of unassigned) {
    const pool = remaining[p.type];
    if (!pool) continue;
    const best = Object.entries(pool).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
    if (!best) continue; // not enough pieces of this shape; validation reports it
    pool[best[0]] -= 1;
    if (best[0]) p.color = best[0];
    else delete p.color;
  }
  return copy;
}

/** Pieces (by shape) the model needs beyond what the inventory has. */
export function missingPieces(model, inventory) {
  const supply = supplyByTypeAndColor(inventory);
  const need = {};
  for (const p of model.pieces) need[p.type] = (need[p.type] || 0) + 1;
  const missing = [];
  for (const [type, n] of Object.entries(need)) {
    const have = Object.values(supply[type] || {}).reduce((a, b) => a + b, 0);
    if (n > have) missing.push({ type, count: n - have });
  }
  return missing;
}

/**
 * Checks every model against the inventory. Buildable models come first
 * (largest first, since a bigger build uses more of the pile), then the rest by
 * how few pieces are missing.
 */
export function rankModels(models, inventory, system) {
  const ranked = models.map((original) => {
    const model = recolorModel(original, inventory);
    const result = validateModel(model, system, inventory);
    const missing = missingPieces(model, inventory);
    const missingCount = missing.reduce((a, m) => a + m.count, 0);
    return { model, original, result, missing, missingCount, buildable: result.ok };
  });
  ranked.sort((a, b) => {
    if (a.buildable !== b.buildable) return a.buildable ? -1 : 1;
    if (a.buildable) return b.model.pieces.length - a.model.pieces.length;
    return a.missingCount - b.missingCount;
  });
  return ranked;
}
