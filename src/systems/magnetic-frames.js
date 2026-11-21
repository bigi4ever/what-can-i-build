// Rules module for hollow magnetic frame toys (Magformers-style).
// Every shape is a regular polygon with the same edge length (1 unit), and
// magnets sit inside the straight edges, so any straight edge can connect to
// any other straight edge.

function regularPolygon(sides) {
  // Edge length 1, centred on the origin, vertices counter-clockwise (normal +Z),
  // with edge 0 lying flat along the bottom.
  const circumradius = 1 / (2 * Math.sin(Math.PI / sides));
  const start = -Math.PI / 2 - Math.PI / sides;
  const vertices = [];
  for (let i = 0; i < sides; i++) {
    const a = start + (2 * Math.PI * i) / sides;
    vertices.push([circumradius * Math.cos(a), circumradius * Math.sin(a), 0]);
  }
  return vertices;
}

function semicircle(segments = 12) {
  // Straight edge (edge 0) of length 1 along the bottom, arc above it.
  const vertices = [[-0.5, 0, 0], [0.5, 0, 0]];
  for (let i = 1; i < segments; i++) {
    const a = (Math.PI * i) / segments;
    vertices.push([0.5 * Math.cos(a), 0.5 * Math.sin(a), 0]);
  }
  return vertices;
}

const allEdges = (n) => Array.from({ length: n }, (_, i) => i);

export const magneticFrames = {
  id: 'magnetic-frames',
  name: 'Magnetic frames (Magformers-style)',
  edgeLength: 1,
  pieceTypes: {
    square: { label: 'Square', vertices: regularPolygon(4), connectableEdges: allEdges(4) },
    triangle: { label: 'Triangle', vertices: regularPolygon(3), connectableEdges: allEdges(3) },
    hexagon: { label: 'Hexagon', vertices: regularPolygon(6), connectableEdges: allEdges(6) },
    semicircle: { label: 'Semicircle', vertices: semicircle(), connectableEdges: [0] },
  },
  // Fold angles (degrees) for common joints, so a generator can pick known-good
  // values instead of doing trigonometry. fold = 180 - interior dihedral angle.
  knownFolds: {
    'cube: any two faces': 90,
    'hexagonal prism: hexagon to side square': 90,
    'hexagonal prism: square to square': 60,
    'triangular prism: square to square': 120,
    'square pyramid: base to triangle': 125.26,
    'square pyramid roof on a vertical wall: wall to triangle': 35.26,
    'tetrahedron: triangle to triangle': 109.47,
    'octahedron: triangle to triangle': 70.53,
    'lying flat on the ground from a vertical piece': 90,
  },
  colors: {
    red: '#e53935',
    orange: '#fb8c00',
    yellow: '#fdd835',
    lime: '#c0ca33',
    green: '#43a047',
    lightblue: '#29b6f6',
    blue: '#1e63d6',
    purple: '#9c27b0',
  },
};
