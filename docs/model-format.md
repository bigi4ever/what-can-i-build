# Model format

A model is a JSON file describing how pieces snap together edge-to-edge. It is
designed to be easy for a generator (an LLM) to write and for code to check.

```json
{
  "name": "Cube",
  "system": "magnetic-frames",
  "pieces": [
    { "id": "floor", "type": "square", "color": "blue" },
    { "id": "front", "type": "square", "color": "yellow",
      "attach": { "to": "floor", "edge": 0, "myEdge": 0, "fold": 90 } }
  ]
}
```

## Pieces

| field | meaning |
|---|---|
| `id` | unique name, used by other pieces' `attach.to` |
| `type` | a piece type from the system (`square`, `triangle`, `hexagon`, `semicircle`) |
| `color` | optional; when present, the inventory must have that colour |
| `attach` | how this piece connects to one already-placed piece; omitted on exactly one piece (the root) |

The listing order is the build order shown to the user.

## Attachments

`attach: { to, edge, myEdge = 0, fold }`

- `to`: the id of the piece to attach to.
- `edge`: which edge of that piece. Edges are numbered 0..n-1 counter-clockwise
  when looking at the piece's front side.
- `myEdge`: which edge of this piece touches it (default 0). For regular
  polygons this only changes edge numbering on the new piece, not its position.
- `fold` (degrees): the new piece first lies flat next to the parent, like an
  unfolded paper net, with the same front side. It is then rotated about the
  shared edge. Positive folds lift it towards the parent's front side.
  `0` = flat, `90` = perpendicular. The angle you see between the two pieces
  is `180 - |fold|`.

The root lies flat with its front side facing up. A piece folded up by +90
from the floor ends up with its front side facing **inwards** (towards the
floor's centre), so a lid hinged on its top edge folds over the box with +90.

### Edge numbering tips

- For a piece attached with `myEdge: 0`, the edge opposite the shared one on a
  square is edge 2.
- In a ring of walls (as in `castle.json`), where each square is attached by
  its edge 0 to the previous wall's vertical edge, edge 1 ends up at the bottom
  and edge 3 at the top. When unsure, run the validator: missing connections or
  collisions show a wrong guess.

### Known fold angles (magnetic frames)

| joint | fold |
|---|---|
| cube: any two faces | 90 |
| hexagonal prism: hexagon to side square | 90 |
| hexagonal prism: square to square | 60 |
| triangular prism: square to square | 120 |
| square pyramid: base to triangle | 125.26 |
| pyramid roof on a vertical wall: wall to triangle | 35.26 |
| tetrahedron: triangle to triangle | 109.47 |
| octahedron: triangle to triangle | 70.53 |

## What the validator checks

`validateModel(model, system, inventory)` in `src/core/validate.js`:

1. Structure: known types, valid references, one root, no cycles, magnetic edges only.
2. Inventory: never more pieces per shape and per colour than owned.
3. Edges: each edge is used by at most one attachment.
4. Geometry: finds every pair of edges that physically meet. This includes
   the edges that close a loop, like the last wall of a cube, so you don't
   have to declare them.
5. Collisions: no two pieces pass through or lie on top of each other.
6. Stability (warning): the centre of mass, with pieces weighted by area,
   must be above the convex hull of the points touching the ground.

Errors are plain English sentences meant to be fed back to the generator.
