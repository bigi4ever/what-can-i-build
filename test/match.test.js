import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recolorModel, missingPieces, rankModels } from '../src/core/match.js';
import { magneticFrames } from '../src/systems/magnetic-frames.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const cube = load('models/magnetic-frames/cube.json');
const house = load('models/magnetic-frames/house.json');
const castle = load('models/magnetic-frames/castle.json');
const sample = load('inventories/magnets-photo-1.json');

test('recolor keeps colours the user has and repaints the rest', () => {
  const inv = { pieces: [{ type: 'square', color: 'yellow', count: 2 }, { type: 'square', color: 'pink', count: 10 }] };
  const m = recolorModel(cube, inv);
  const colors = m.pieces.map((p) => p.color);
  assert.equal(colors.filter((c) => c === 'yellow').length, 2); // cube has 2 yellow squares
  assert.equal(colors.filter((c) => c === 'pink').length, 4);
  assert.equal(cube.pieces[0].color, 'blue', 'original model is not modified');
});

test('a model in other colours is still buildable after recolouring', () => {
  const inv = { pieces: [{ type: 'square', color: 'pink', count: 6 }] };
  const [r] = rankModels([cube], inv, magneticFrames);
  assert.equal(r.buildable, true, r.result.errors.join(' | '));
});

test('inventory rows without a colour work', () => {
  const inv = { pieces: [{ type: 'square', count: 6 }] };
  const [r] = rankModels([cube], inv, magneticFrames);
  assert.equal(r.buildable, true, r.result.errors.join(' | '));
});

test('missing pieces are counted per shape', () => {
  const inv = { pieces: [{ type: 'square', color: 'red', count: 3 }, { type: 'triangle', color: 'red', count: 0 }] };
  assert.deepEqual(missingPieces(house, inv), [{ type: 'square', count: 2 }, { type: 'triangle', count: 4 }]);
});

test('ranking puts buildable models first, largest first', () => {
  const ranked = rankModels([cube, house, castle], sample, magneticFrames);
  assert.deepEqual(ranked.map((r) => r.original.name), [castle.name, house.name, cube.name]);
  assert.ok(ranked.every((r) => r.buildable));
});

test('ranking puts closest unbuildable models before far ones', () => {
  const inv = { pieces: [{ type: 'square', color: 'red', count: 5 }] };
  const ranked = rankModels([castle, house, cube], inv, magneticFrames);
  assert.equal(ranked[0].original.name, cube.name);
  assert.equal(ranked[0].buildable, false);
  assert.equal(ranked[1].original.name, house.name); // missing 4 triangles
  assert.equal(ranked[2].original.name, castle.name);
});
