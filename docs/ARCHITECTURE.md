# Quadlo architecture

## Runtime boundaries

The React application owns modelling state, editing workflows, serialization, and Three.js rendering. Zustand slices compose into `src/store/appStore.ts`; individual slices should own one workflow and expose actions rather than requiring components to coordinate invariants.

Wails embeds the built frontend and exposes only native file dialogs plus bounded, dialog-authorized file I/O through `app.go`. `src/io/wailsBridge.ts` is the stable frontend boundary; normal frontend builds do not depend on generated `wailsjs` files.

## Geometry

`SceneObject` in `src/mesh/HalfEdgeMesh.ts` is the persistent mesh representation. Geometry creators should finalize through shared mesh utilities, preserve positive outward winding, and avoid T-junctions. Untrusted project and import data must pass `validateMeshStructure` before reaching rendering or editing code.

Retained `sketchSource`, `vectorSource`, `latheSource`, and `primitiveSource` data allow parametric rebuilding. Any new persistent `SceneObject` field must also be considered in history cloning, equality, project serialization, and validation.

## State and history

Scene history captures objects, textures, pixel documents, image references, and selection. Snapshots use structural sharing for unchanged immutable values. Actions that span pointer gestures should capture the initial state and replace the history head with the completed gesture.

Object deletion must atomically update object indexes, object and component selection, texture ownership, and pixel-document ownership. Project replacement is guarded inside the store action so every UI entry point follows the same discard policy.

## Rendering

The main workspace uses one React Three Fiber canvas per visible viewport. Canvas rendering defaults to demand mode and becomes continuous only while an interaction or CAD preview requires it. Secondary UV and hair previews manage their own frame loops and must not register as main viewport interactions.

CPU geometry is shared through the viewport geometry cache. Every created `BufferGeometry`, material, texture, renderer registration, object URL, listener, and animation-frame callback requires a paired cleanup path.

## File formats and trust

Project JSON, pixel documents, image data URLs, and imported scene files are untrusted input. Validation is intentionally structural and bounded; it does not reject valid open or non-manifold modelling data unless a downstream invariant requires it.

Desktop file methods accept only paths returned by native dialogs. Save authorization covers same-stem companion files used by multi-file exports, while reads remain exact-path authorized.

## Verification boundaries

- Vitest covers geometry, serialization, state, selection, rendering helpers, and resource ownership.
- Go tests cover desktop path authorization.
- Primitive validation checks every CAD primitive in front, right, and top construction views.
- Microbenchmarks report history and viewport geometry costs.
- GitHub Actions builds the frontend and Windows desktop package from a clean dependency install.

Browser and packaged end-to-end interaction testing remains the primary coverage gap.
