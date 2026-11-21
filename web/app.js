import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { magneticFrames } from '../src/systems/magnetic-frames.js';
import { validateModel } from '../src/core/validate.js';
import { computePoses, worldVertices, worldNormal } from '../src/core/geometry.js';

const system = magneticFrames;
const HE_TYPES = { square: 'ריבוע', triangle: 'משולש', hexagon: 'משושה', semicircle: 'חצי עיגול' };
const HE_COLORS = {
  red: 'אדום', orange: 'כתום', yellow: 'צהוב', lime: 'ירוק בהיר', green: 'ירוק',
  lightblue: 'תכלת', blue: 'כחול', purple: 'סגול',
};

const $ = (id) => document.getElementById(id);
const els = {
  select: $('model-select'), viewer: $('viewer'), slider: $('step-slider'),
  prev: $('prev'), next: $('next'), play: $('play'), stepText: $('step-text'),
  badge: $('status-badge'), inventory: document.querySelector('#inventory-table tbody'),
  validation: $('validation'),
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

function frameMeshes(verts, normal, color, isSemicircle) {
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

// ---- state ------------------------------------------------------------------
let inventory = null;
let current = null; // { model, result, order, meshes: Map, byId }
let playTimer = null;

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function describePiece(p) {
  return `${HE_TYPES[p.type] ?? p.type}${p.color ? ' ' + (HE_COLORS[p.color] ?? p.color) : ''}`;
}

function showModel(model) {
  const result = validateModel(model, system, inventory);
  modelGroup.clear();
  const byId = new Map(model.pieces.map((p) => [p.id, p]));
  const meshes = new Map();
  let order = [];

  if (result.order) {
    const computed = computePoses(model, system);
    order = computed.order;
    for (const id of order) {
      const p = byId.get(id);
      const type = system.pieceTypes[p.type];
      const pose = computed.poses.get(id);
      const mesh = frameMeshes(worldVertices(pose, type), worldNormal(pose), system.colors[p.color] ?? '#9e9e9e', p.type === 'semicircle');
      meshes.set(id, mesh);
      modelGroup.add(mesh);
    }
  }
  current = { model, result, order, meshes, byId };
  frameCamera();
  renderValidation(result);
  renderInventory(model);
  els.slider.max = String(Math.max(order.length, 1));
  setStep(order.length);
}

function frameCamera() {
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  grid.position.set(centre.x, 0, centre.z);
  controls.target.copy(centre);
  camera.position.copy(centre).add(new THREE.Vector3(size * 0.5, size * 0.45, size * 0.65));
  camera.near = size / 100;
  camera.far = size * 20;
  camera.updateProjectionMatrix();
}

function setStep(k) {
  if (!current) return;
  const { order, meshes, byId } = current;
  k = Math.max(1, Math.min(k, order.length));
  els.slider.value = String(k);
  pulseTarget = null;
  order.forEach((id, i) => {
    const m = meshes.get(id);
    m.visible = i < k;
    m.userData.ringMat.emissive.setScalar(0);
  });
  const id = order[k - 1];
  const p = byId.get(id);
  if (k < order.length) pulseTarget = meshes.get(id).userData.ringMat;
  if (!p) { els.stepText.textContent = ''; return; }
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

function renderValidation(r) {
  els.badge.textContent = r.ok ? '✓ אפשר לבנות' : '✗ יש בעיה במודל';
  els.badge.className = `badge ${r.ok ? 'ok' : 'bad'}`;
  const items = [];
  if (r.stats.pieceCount) items.push(['', `${r.stats.pieceCount} חלקים, ${r.stats.connections ?? 0} חיבורים בין צלעות`]);
  if (r.stats.height !== undefined) items.push(['', `גובה: ${r.stats.height} יחידות (צלע אחת = יחידה)`]);
  if (r.stats.usesWholeInventory) items.push(['', '⭐ משתמש בכל החלקים שזוהו']);
  else if (r.stats.unusedPieces !== undefined) items.push(['', `נשארים ${r.stats.unusedPieces} חלקים בצד`]);
  for (const e of r.errors) items.push(['error', e]);
  for (const w of r.warnings) items.push(['warning', w]);
  els.validation.replaceChildren(...items.map(([cls, text]) => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.textContent = text;
    if (cls) li.dir = 'ltr';
    return li;
  }));
}

function renderInventory(model) {
  const used = {};
  for (const p of model.pieces) {
    const key = `${p.type}|${p.color ?? ''}`;
    used[key] = (used[key] || 0) + 1;
  }
  els.inventory.replaceChildren(...inventory.pieces.map((p) => {
    const tr = document.createElement('tr');
    const n = used[`${p.type}|${p.color}`] || 0;
    if (!n) tr.className = 'unused';
    const sw = `<span class="swatch" style="background:${system.colors[p.color] ?? '#999'}"></span>`;
    tr.innerHTML = `<td>${HE_TYPES[p.type] ?? p.type}</td><td>${sw}${HE_COLORS[p.color] ?? p.color}</td><td>${p.count}</td><td>${n}</td>`;
    return tr;
  }));
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  els.play.textContent = '▶ הפעל';
}

els.slider.addEventListener('input', () => { stopPlay(); setStep(Number(els.slider.value)); });
els.prev.addEventListener('click', () => { stopPlay(); setStep(Number(els.slider.value) - 1); });
els.next.addEventListener('click', () => { stopPlay(); setStep(Number(els.slider.value) + 1); });
els.play.addEventListener('click', () => {
  if (playTimer) return stopPlay();
  let k = Number(els.slider.value) >= current.order.length ? 1 : Number(els.slider.value);
  setStep(k);
  els.play.textContent = '⏸ עצור';
  playTimer = setInterval(() => {
    k += 1;
    setStep(k);
    if (k >= current.order.length) stopPlay();
  }, 900);
});

async function init() {
  inventory = await loadJson('../inventories/magnets-photo-1.json');
  const index = await loadJson('../models/index.json');
  const models = await Promise.all(index['magnetic-frames'].map((f) => loadJson(`../models/magnetic-frames/${f}`)));
  els.select.replaceChildren(...models.map((m, i) => new Option(m.nameHe ?? m.name, String(i))));
  els.select.addEventListener('change', () => { stopPlay(); showModel(models[Number(els.select.value)]); });
  resize();
  showModel(models[0]);
}

init().catch((err) => {
  els.stepText.textContent = `שגיאה בטעינה: ${err.message}`;
  console.error(err);
});
