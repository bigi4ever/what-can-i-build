import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateModel } from '../src/core/validate.js';
import { magneticFrames } from '../src/systems/magnetic-frames.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const inventory = load('inventories/magnets-photo-1.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

test('every bundled model is valid against the sample inventory', () => {
  for (const f of readdirSync(new URL('../models/magnetic-frames/', import.meta.url))) {
    const r = validateModel(load(`models/magnetic-frames/${f}`), magneticFrames, inventory);
    assert.equal(r.ok, true, `${f}: ${r.errors.join(' | ')}`);
  }
});

test('cube closes into 12 edge connections', () => {
  const r = validateModel(load('models/magnetic-frames/cube.json'), magneticFrames);
  assert.equal(r.stats.connections, 12);
  assert.equal(r.stats.height, 1);
});

test('hexagonal prism closes into 18 edge connections', () => {
  const r = validateModel(load('models/magnetic-frames/hex-tower.json'), magneticFrames);
  assert.equal(r.stats.connections, 18);
});

test('castle uses the whole sample inventory', () => {
  const r = validateModel(load('models/magnetic-frames/castle.json'), magneticFrames, inventory);
  assert.equal(r.ok, true);
  assert.equal(r.stats.usesWholeInventory, true);
  assert.equal(r.stats.pieceCount, 18);
  assert.equal(r.stats.connections, 28);
});

test('a piece folded through another piece is caught', () => {
  // A wall on a floor, with a hexagon hinged on the wall top folded down through the floor.
  const r = validateModel({
    pieces: [
      { id: 'floor', type: 'square' },
      { id: 'wall', type: 'square', attach: { to: 'floor', edge: 0, fold: 90 } },
      { id: 'flap', type: 'hexagon', attach: { to: 'wall', edge: 2, fold: 150 } },
    ],
  }, magneticFrames);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('"floor" and "flap" pass through')), r.errors.join(' | '));
});

test('two pieces lying on top of each other are caught', () => {
  const r = validateModel({
    pieces: [
      { id: 'a', type: 'square' },
      { id: 'b', type: 'square', attach: { to: 'a', edge: 0, fold: 180 } },
    ],
  }, magneticFrames);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('pass through')));
});

test('a wrong fold that leaves a shape open is visible as fewer connections', () => {
  const m = clone(load('models/magnetic-frames/cube.json'));
  m.pieces.find((p) => p.id === 'top').attach.fold = -90;
  const r = validateModel(m, magneticFrames);
  assert.ok(r.stats.connections < 12);
});

test('using more pieces than owned is an error', () => {
  const m = clone(load('models/magnetic-frames/cube.json'));
  const small = { pieces: [{ type: 'square', count: 5 }] };
  const r = validateModel(m, magneticFrames, small);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('Needs 6 × square')));
});

test('using more pieces of one colour than owned is an error', () => {
  const m = clone(load('models/magnetic-frames/cube.json'));
  for (const p of m.pieces) p.color = 'purple';
  const r = validateModel(m, magneticFrames, inventory);
  assert.ok(r.errors.some((e) => e.includes('purple square')));
});

test('structural mistakes are reported', () => {
  const r = validateModel({
    pieces: [
      { id: 'a', type: 'square' },
      { id: 'b', type: 'circle', attach: { to: 'a', edge: 0, fold: 90 } },
      { id: 'c', type: 'square', attach: { to: 'zzz', edge: 0, fold: 90 } },
      { id: 'd', type: 'square', attach: { to: 'a', edge: 0, fold: 90 } },
      { id: 'e', type: 'semicircle', attach: { to: 'a', edge: 1, myEdge: 3, fold: 0 } },
    ],
  }, magneticFrames);
  const all = r.errors.join(' | ');
  assert.match(all, /unknown type "circle"/);
  assert.match(all, /unknown piece "zzz"/);
  assert.match(all, /Edge 0 of "a" is used by more than one/);
  assert.match(all, /not a magnetic edge/);
});

test('two roots are rejected', () => {
  const r = validateModel({ pieces: [{ id: 'a', type: 'square' }, { id: 'b', type: 'square' }] }, magneticFrames);
  assert.ok(r.errors.some((e) => e.includes('exactly one root')));
});
