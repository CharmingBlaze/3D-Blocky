# blob3d — low-poly 3D blob sculpt/doodle system

A self-contained TypeScript core for a Paint-3D-style "3D blob" tool:
sculpt a blob with a soft brush, or draw a stroke and puff it into a
rounded low-poly tube. No rendering engine baked in — pair it with
three.js (or anything else) in your app shell.

## Low-poly by design

Sculpting happens on a smooth, welded mesh (shared vertices — cheap,
coherent deformation). Right before you render or export, run it through
`facetMesh()`, which splits every triangle into its own 3 vertices with a
single hard face normal. That's the actual trick behind the chunky,
angular "low poly art" look — you get correct sculpt math *and* a faceted
result, instead of fighting one mesh for both.

```
sculpt on IndexedMesh (welded) --> facetMesh() --> render/export (faceted)
```

Tune the poly count via:
- `createIcosphere(radius, subdivisions)` — subdivisions 0–2 for low poly
- `DoodleSettings.segments` — tube cross-section sides, 5–8 for low poly

## Files

| File | Responsibility |
|---|---|
| `types.ts` | Shared types: MeshData, BrushSettings, DoodleSettings, etc. |
| `mesh.ts` | `IndexedMesh`: adjacency, normal recompute, Laplacian smoothing |
| `primitives.ts` | Icosphere generator (uniform triangle density, unlike UV spheres) |
| `faceting.ts` | Smooth mesh → hard-edged low-poly mesh conversion |
| `sculptBrush.ts` | inflate / deflate / smooth / flatten / grab brush modes + falloff |
| `doodleExtrude.ts` | Stroke → 3D tube (Catmull-Rom + parallel-transport frames) |
| `raycast.ts` | Möller–Trumbore ray/triangle picking (skip if using three.js's own Raycaster) |
| `history.ts` | Undo/redo, storing only touched vertices per stroke |
| `blobSystem.ts` | Public API — the class your UI actually calls |

## Quick usage

```ts
import { BlobSystem, DEFAULT_BRUSH, DEFAULT_DOODLE } from './src';

const system = new BlobSystem({ mirrorX: true });
const blob = system.createBlob(1, 1); // low-poly icosphere

// per pointer-move while sculpting:
const hit = system.pick(blob.id, cameraPos, rayDir);
if (hit) system.sculpt(blob.id, hit.point, DEFAULT_BRUSH, stylusPressure);

// hand the faceted mesh to your renderer:
const renderMesh = system.getRenderMesh(blob.id);

// doodle mode:
const doodle = system.createDoodle(strokePoints, DEFAULT_DOODLE);
```

## What's intentionally left as a stub for Cursor to fill in

- **Renderer glue**: wiring `MeshData` into a `THREE.BufferGeometry`
  (`setAttribute('position', ...)`, `setAttribute('normal', ...)`,
  `setIndex(...)`) plus a simple `MeshStandardMaterial` or toon material for
  the flat-shaded look.
- **Input handling**: converting pointer events + camera into ray origin/
  direction for `pick()`, and stylus pressure if available (`PointerEvent
  .pressure`).
- **Metaball / blob-merge mode** (optional): if you want multiple blobs to
  organically fuse like Paint 3D's overlapping shapes, that needs a scalar
  field + marching cubes, which is a genuinely separate subsystem — worth
  its own follow-up rather than bolting on here.
- **Export**: three.js already ships `GLTFExporter`/`OBJExporter` — just feed
  them the faceted `BufferGeometry`.

## Suggested prompt for Cursor

> "Wire this blob3d/src package into a Vite + React + three.js app. Add a
> canvas with orbit controls, a brush settings panel (mode/radius/strength),
> pointer handlers that call `BlobSystem.pick()` and `.sculpt()` on
> pointermove, and a toolbar toggle between sculpt mode and doodle mode.
> Render `getRenderMesh()` output with flat shading and update the
> BufferGeometry after every stroke."
