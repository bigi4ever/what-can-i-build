import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { magneticFrames } from '../src/systems/magnetic-frames.js';
import { computePoses, worldVertices } from '../src/core/geometry.js';
import { rankModels } from '../src/core/match.js';

const system = magneticFrames;
const HE_TYPES = { square: 'ריבוע', triangle: 'משולש', hexagon: 'משושה', semicircle: 'חצי עיגול' };
const HE_TYPES_PLURAL = { square: 'ריבועים', triangle: 'משולשים', hexagon: 'משושים', semicircle: 'חצאי עיגול' };
const HE_COLORS = {
  red: 'אדום', orange: 'כתום', yellow: 'צהוב', lime: 'ירוק בהיר', green: 'ירוק',
  lightblue: 'תכלת', blue: 'כחול', purple: 'סגול',
};
const COLOR_ORDER = Object.keys(HE_COLORS);
const STORAGE_KEY = 'wcib.inventory.v1';
const SAMPLE_PHOTO = '../samples/magnets-photo-1.webp';
const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;

const $ = (id) => document.getElementById(id);
const els = {
  photo: $('photo'), photoEmpty: $('photo-empty'), camera: $('camera-input'), gallery: $('gallery-input'),
  sample: $('sample-button'), recognitionNote: $('recognition-note'),
  list: $('inventory-list'), listEmpty: $('inventory-empty'), total: $('inventory-total'),
  clear: $('clear-button'), find: $('find-button'),
  resultsSection: $('results-section'), results: $('results'),
  viewerPanel: $('viewer-panel'), viewer: $('viewer'), title: $('model-title'), badge: $('status-badge'),
  slider: $('step-slider'), prev: $('prev'), next: $('next'), play: $('play'), stepText: $('step-text'),
  validation: $('validation'),
};

// ---- state ------------------------------------------------------------------
let models = [];          // bundled models
let inventory = [];       // [{ type, color, count }]
let ranked = [];          // output of rankModels
let selected = null;      // entry of `ranked` shown in the viewer
let resultsStale = false; // inventory edited since the last search
let photoUrl = null;

const storage = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  },
  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory)); } catch { /* private mode etc. */ }
  },
};

// ---- three.js scene ---------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
els.viewer.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(4, 8, 5);
scene.add(sun);
const grid = new THREE.GridHelper(12, 12, 0x99a3ad, 0xc4cbd2);
grid.material.opacity = 0.5;
grid.material.transparent = true;
scene.add(grid);
const modelGroup = new THREE.Group();
scene.add(modelGroup);

// Model space is Z-up; three.js is Y-up.
const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y);

function frameMeshes(verts, color, isSemicircle) {
  const group = new THREE.Group();
  const c = verts.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map((x) => x / verts.length);
  const centre = isSemicircle ? verts[0].map((x, i) => (x + verts[1][i]) / 2) : c;
  const inset = isSemicircle ? 0.62 : 0.74;
  const inner = verts.map((v) => v.map((x, i) => centre[i] + (x - centre[i]) * inset));
  const n = verts.length;

  // Frame ring (the coloured plastic border).
  const ringPos = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const p of [verts[i], verts[j], inner[j], verts[i], inner[j], inner[i]]) ringPos.push(...toThree(p).toArray());
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPos, 3));
  ringGeo.computeVertexNormals();
  const ringMat = new THREE.MeshStandardMaterial({
    color, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.92,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  group.add(new THREE.Mesh(ringGeo, ringMat));

  // Faint see-through window in the middle.
  const facePos = [];
  for (let i = 1; i < n - 1; i++) for (const p of [inner[0], inner[i], inner[i + 1]]) facePos.push(...toThree(p).toArray());
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3));
  faceGeo.computeVertexNormals();
  group.add(new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
    color, side: THREE.DoubleSide, transparent: true, opacity: 0.18, depthWrite: false,
  })));

  // Crisp outline.
  const outline = new THREE.BufferGeometry().setFromPoints([...verts, verts[0]].map(toThree));
  group.add(new THREE.Line(outline, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.6) })));
  group.userData.ringMat = ringMat;
  return group;
}

function resize() {
  const { clientWidth: w, clientHeight: h } = els.viewer;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(els.viewer);

let pulseTarget = null;
renderer.setAnimationLoop((t) => {
  controls.update();
  if (pulseTarget) pulseTarget.emissive.setScalar(0.25 + 0.2 * Math.sin(t / 180));
  renderer.render(scene, camera);
});

// ---- viewer -----------------------------------------------------------------
let view = null; // { order, meshes, byId }
let playTimer = null;

function describePiece(p) {
  return `${HE_TYPES[p.type] ?? p.type}${p.color ? ' ' + (HE_COLORS[p.color] ?? p.color) : ''}`;
}

function showModel(entry) {
  stopPlay();
  selected = entry;
  const { model } = entry;
  modelGroup.clear();
  const byId = new Map(model.pieces.map((p) => [p.id, p]));
  const meshes = new Map();
  const { poses, order } = computePoses(model, system);
  for (const id of order) {
    const p = byId.get(id);
    const mesh = frameMeshes(
      worldVertices(poses.get(id), system.pieceTypes[p.type]),
      system.colors[p.color] ?? '#9e9e9e',
      p.type === 'semicircle',
    );
    meshes.set(id, mesh);
    modelGroup.add(mesh);
  }
  view = { order, meshes, byId };
  els.title.textContent = model.nameHe ?? model.name;
  frameCamera();
  renderValidation(entry);
  els.slider.max = String(Math.max(order.length, 1));
  setStep(order.length);
  renderInventory();
  renderResults();
}

function frameCamera() {
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  grid.position.set(centre.x, 0, centre.z);
  controls.target.copy(centre);
  // Back off until the model's bounding sphere fits the narrower field of view,
  // so long models fit on wide screens and wide models fit on phones.
  const radius = size / 2;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
  const direction = new THREE.Vector3(0.55, 0.5, 0.7).normalize();
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.near = size / 100;
  camera.far = size * 20;
  camera.updateProjectionMatrix();
}

function setStep(k) {
  if (!view) return;
  const { order, meshes, byId } = view;
  k = Math.max(1, Math.min(k, order.length));
  els.slider.value = String(k);
  pulseTarget = null;
  order.forEach((id, i) => {
    const m = meshes.get(id);
    m.visible = i < k;
    m.userData.ringMat.emissive.setScalar(0);
  });
  const p = byId.get(order[k - 1]);
  if (k < order.length) pulseTarget = meshes.get(p.id).userData.ringMat;
  const prefix = `שלב ${k} מתוך ${order.length}: `;
  if (!p.attach) {
    els.stepText.textContent = `${prefix}מניחים ${describePiece(p)} על הרצפה.`;
  } else {
    const parent = byId.get(p.attach.to);
    // Show the angle between the two pieces (what you see), not the fold amount.
    const between = Math.round(180 - Math.abs(p.attach.fold));
    const how = between === 180 ? 'בהמשך ישר' : between === 90 ? 'בזווית ישרה' : `בזווית של ${between}° ביניהם`;
    els.stepText.textContent = `${prefix}מחברים ${describePiece(p)} לצלע של ה${describePiece(parent)}, ${how}.`;
  }
}

function missingText(missing) {
  return missing.map((m) => `${m.count} ${m.count === 1 ? HE_TYPES[m.type] : HE_TYPES_PLURAL[m.type]}`).join(', ');
}

function renderValidation({ result, missing, buildable }) {
  els.badge.textContent = buildable ? '✓ אפשר לבנות' : `✗ חסרים ${missingText(missing) || 'חלקים'}`;
  els.badge.className = `badge ${buildable ? 'ok' : 'bad'}`;
  const items = [];
  items.push(['', `${result.stats.pieceCount} חלקים, ${result.stats.connections ?? 0} חיבורים בין צלעות`]);
  if (result.stats.height !== undefined) items.push(['', `גובה: ${result.stats.height} יחידות (צלע אחת = יחידה)`]);
  if (result.stats.usesWholeInventory) items.push(['', '⭐ משתמש בכל החלקים שלכם']);
  else if (buildable) items.push(['', `נשארים ${result.stats.unusedPieces} חלקים בצד`]);
  // Shortages are already in the badge; list only other problems.
  for (const e of result.errors) if (!e.startsWith('Needs ')) items.push(['error', e]);
  for (const w of result.warnings) items.push(['warning', w]);
  els.validation.replaceChildren(...items.map(([cls, text]) => {
    const li = document.createElement('li');
    if (cls) { li.className = cls; li.dir = 'ltr'; }
    li.textContent = text;
    return li;
  }));
}

// ---- inventory editor -------------------------------------------------------
function normalizeInventory() {
  // Merge rows with the same shape and colour, drop empty ones.
  const merged = new Map();
  for (const row of inventory) {
    if (row.count <= 0) continue;
    const key = `${row.type}|${row.color}`;
    if (merged.has(key)) merged.get(key).count += row.count;
    else merged.set(key, { ...row });
  }
  inventory = [...merged.values()];
}

function usedCounts() {
  const used = {};
  if (!selected || resultsStale) return used;
  for (const p of selected.model.pieces) {
    const key = `${p.type}|${p.color}`;
    used[key] = (used[key] || 0) + 1;
  }
  return used;
}

function inventoryChanged() {
  storage.save();
  if (ranked.length) {
    resultsStale = true;
    els.find.textContent = '🔍 עדכנו את התוצאות';
  }
  renderInventory();
  renderResults();
}

function button(text, label, onClick, className) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

function renderInventory() {
  const used = usedCounts();
  els.list.replaceChildren(...inventory.map((row, index) => {
    const li = document.createElement('li');

    const shape = document.createElement('span');
    shape.className = 'shape';
    shape.textContent = HE_TYPES[row.type] ?? row.type;

    const colorPick = document.createElement('label');
    colorPick.className = 'color-pick';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = system.colors[row.color] ?? '#999';
    const select = document.createElement('select');
    select.setAttribute('aria-label', `צבע ה${HE_TYPES[row.type]}`);
    for (const c of COLOR_ORDER) select.add(new Option(HE_COLORS[c], c, false, c === row.color));
    select.addEventListener('change', () => {
      row.color = select.value;
      normalizeInventory();
      inventoryChanged();
    });
    colorPick.append(swatch, select);

    const counter = document.createElement('span');
    counter.className = 'counter';
    const out = document.createElement('output');
    out.textContent = String(row.count);
    counter.append(
      button('−', 'פחות', () => { row.count -= 1; normalizeInventory(); inventoryChanged(); }),
      out,
      button('+', 'יותר', () => { row.count += 1; inventoryChanged(); }),
    );

    const remove = button('🗑', 'הסרה', () => { inventory.splice(index, 1); inventoryChanged(); }, 'remove');

    li.append(shape, colorPick, counter, remove);
    const n = used[`${row.type}|${row.color}`];
    if (n) {
      const usedEl = document.createElement('span');
      usedEl.className = 'used';
      usedEl.textContent = `בשימוש במודל: ${n}`;
      li.append(usedEl);
    }
    return li;
  }));
  const total = inventory.reduce((a, r) => a + r.count, 0);
  els.total.textContent = `סה"כ ${total} חלקים`;
  els.listEmpty.hidden = inventory.length > 0;
}

function addPiece(type) {
  // A new row gets a colour this shape doesn't have yet, so it stands out.
  const taken = new Set(inventory.filter((r) => r.type === type).map((r) => r.color));
  const color = COLOR_ORDER.find((c) => !taken.has(c)) ?? COLOR_ORDER[0];
  inventory.push({ type, color, count: 1 });
  normalizeInventory();
  inventoryChanged();
}

// ---- photo ------------------------------------------------------------------
function setPhoto(src) {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = src && src.startsWith('blob:') ? src : null;
  els.photo.hidden = !src;
  els.photoEmpty.hidden = Boolean(src);
  if (src) els.photo.src = src;
}

function onPhotoPicked(input) {
  const file = input.files?.[0];
  input.value = ''; // allow picking the same file again
  if (!file) return;
  setPhoto(URL.createObjectURL(file));
  els.recognitionNote.hidden = false;
  els.photo.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function useSample() {
  const sample = await loadJson('../inventories/magnets-photo-1.json');
  inventory = sample.pieces.map((p) => ({ type: p.type, color: p.color, count: p.count }));
  setPhoto(SAMPLE_PHOTO);
  els.recognitionNote.hidden = true;
  storage.save();
  findModels({ scroll: false });
}

// ---- results ----------------------------------------------------------------
function findModels({ scroll = true } = {}) {
  normalizeInventory();
  ranked = rankModels(models, { pieces: inventory }, system);
  resultsStale = false;
  els.find.textContent = '🔍 מה אפשר לבנות?';
  els.resultsSection.hidden = false;
  if (!ranked.length) return;
  showModel(ranked[0]);
  if (scroll && isNarrow()) els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderResults() {
  if (!ranked.length) return;
  const buildableCount = ranked.filter((r) => r.buildable).length;
  const note = document.createElement('p');
  note.className = 'results-note';
  note.textContent = resultsStale
    ? 'שיניתם את הרשימה. לחצו על "עדכנו את התוצאות".'
    : buildableCount
      ? `אפשר לבנות ${buildableCount} מתוך ${ranked.length} המודלים שיש לנו כרגע. בקרוב ה-AI ימציא מודלים במיוחד בשבילכם.`
      : 'אף מודל עדיין לא מתאים לחלקים שלכם. הנה הקרובים ביותר. בקרוב ה-AI ימציא מודלים במיוחד בשבילכם.';

  const items = ranked.map((entry) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = entry.model.nameHe ?? entry.model.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const status = document.createElement('span');
    status.className = entry.buildable ? 'ok' : 'bad';
    status.textContent = entry.buildable ? '✓ אפשר לבנות' : `חסרים ${missingText(entry.missing) || 'חלקים'}`;
    meta.append(status, ` · ${entry.model.pieces.length} חלקים`);
    if (entry.result.stats.usesWholeInventory) meta.append(' · ⭐ כל החלקים');
    const btn = button('', null, () => {
      showModel(entry);
      if (isNarrow()) els.viewerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    btn.setAttribute('aria-pressed', String(entry === selected));
    btn.append(title, meta);
    li.append(btn);
    return li;
  });
  els.results.replaceChildren(note, ...items);
}

// ---- wiring -----------------------------------------------------------------
function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  els.play.textContent = '▶ הפעל';
}

els.slider.addEventListener('input', () => { stopPlay(); setStep(Number(els.slider.value)); });
els.prev.addEventListener('click', () => { stopPlay(); setStep(Number(els.slider.value) - 1); });
els.next.addEventListener('click', () => { stopPlay(); setStep(Number(els.slider.value) + 1); });
els.play.addEventListener('click', () => {
  if (playTimer || !view) return stopPlay();
  let k = Number(els.slider.value) >= view.order.length ? 1 : Number(els.slider.value);
  setStep(k);
  els.play.textContent = '⏸ עצור';
  playTimer = setInterval(() => {
    k += 1;
    setStep(k);
    if (k >= view.order.length) stopPlay();
  }, 900);
});

els.camera.addEventListener('change', () => onPhotoPicked(els.camera));
els.gallery.addEventListener('change', () => onPhotoPicked(els.gallery));
els.sample.addEventListener('click', () => useSample());
els.clear.addEventListener('click', () => { inventory = []; inventoryChanged(); });
els.find.addEventListener('click', () => {
  if (!inventory.length) { els.listEmpty.hidden = false; return; }
  findModels();
});
for (const b of document.querySelectorAll('[data-add]')) {
  b.addEventListener('click', () => addPiece(b.dataset.add));
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function init() {
  const index = await loadJson('../models/index.json');
  models = await Promise.all(index['magnetic-frames'].map((f) => loadJson(`../models/magnetic-frames/${f}`)));
  resize();
  const saved = storage.load();
  if (Array.isArray(saved) && saved.length) {
    inventory = saved.filter((r) => system.pieceTypes[r.type] && r.count > 0);
    findModels({ scroll: false });
  } else {
    await useSample();
  }
}

init().catch((err) => {
  els.stepText.textContent = `שגיאה בטעינה: ${err.message}`;
  console.error(err);
});
