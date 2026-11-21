#!/usr/bin/env node
// Usage: node scripts/check.js <model.json> [inventory.json]
import { readFileSync } from 'node:fs';
import { validateModel } from '../src/core/validate.js';
import { magneticFrames } from '../src/systems/magnetic-frames.js';

const [modelPath, invPath] = process.argv.slice(2);
if (!modelPath) { console.error('Usage: node scripts/check.js <model.json> [inventory.json]'); process.exit(2); }
const model = JSON.parse(readFileSync(modelPath, 'utf8'));
const inventory = invPath ? JSON.parse(readFileSync(invPath, 'utf8')) : null;
const r = validateModel(model, magneticFrames, inventory);
console.log(`${model.name}: ${r.ok ? 'OK ✅' : 'FAILED ❌'}`);
console.log('  stats:', JSON.stringify(r.stats));
for (const e of r.errors) console.log('  error:', e);
for (const w of r.warnings) console.log('  warning:', w);
process.exit(r.ok ? 0 : 1);
