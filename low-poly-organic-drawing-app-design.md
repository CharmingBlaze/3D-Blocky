# Technical Design Document
## Low-Poly 3D Drawing Application — Organic Shapes with Strict Vertex Control

---

## Overview

**Purpose:** Lightweight 3D drawing tool for rapid creation of organic low-poly geometry (beads, blobs, eyes, limbs, stylized characters). Every vertex is placed deliberately. Sculpting never subdivides.

**Core invariant:**

> Vertex count is a first-class constraint. No operation adds a vertex unless it represents a curvature change, a user-requested edit, or a topological necessity (boolean intersection).

**Technology scope:** CPU-side mesh kernel (half-edge), GPU rendering (flat-shaded triangles), 2D stroke input projected to orthographic work planes. No physics, no animation, no texture painting.

---

## 1. Organic Drawing Workflow

### 1.1 End-to-End Pipeline

```
Pointer input (screen-space polyline)
        │
        ▼
RDP simplification (jitter removal)
        │
        ▼
Closed vs. open classification
        │
   ┌────┴────┐
   │         │
Closed     Open
   │         │
   ▼         ▼
Silhouette  Path extrusion
volume      (tube / ribbon)
   │
   ▼
Radial symmetry test
   │
   ┌────┴────┐
   │         │
 Lathe     Loft
 (bead)    (blob)
   │         │
   └────┬────┘
        ▼
Curvature-based vertex placement
        │
        ▼
Final low-poly mesh (added to scene)
```

### 1.2 Stroke-to-Mesh Generation

**Input:** Ordered list of 2D points `(x, y)` in active viewport screen space.

**Steps:**

1. **Capture** — append points while pointer is down; sample at display refresh rate, not per-pixel.
2. **Simplify (RDP)** — apply Ramer–Douglas–Peucker with tolerance `ε`:
   - `ε = base_tolerance × (1 / zoom)` so simplification scales with view magnification.
   - Default `base_tolerance`: 2–4 px.
   - Raw jitter never reaches mesh generation.
3. **Project** — map simplified 2D polyline to 3D work plane (Section 5.4).
4. **Classify** — closed or open (Section 1.3).
5. **Generate** — dispatch to lathe, loft, or extrusion path (Sections 1.4–1.6).
6. **Commit** — insert mesh into scene graph; push undo snapshot.

**Output:** One new mesh object with positions, triangle faces, per-face flat color.

### 1.3 Closed-Stroke Detection

**Rule:** Stroke is **closed** if:

```
distance(first_point, last_point) ≤ close_threshold
```

- `close_threshold = 12 px × (reference_zoom / current_zoom)`
- Minimum 3 points after RDP; otherwise treat as open.
- Closed → silhouette boundary for volume generation.
- Open → path for tube/ribbon extrusion.

### 1.4 Silhouette-Based Volume Creation

For closed, non-radially-symmetric silhouettes (blobs, irregular organs).

**Algorithm:**

1. Take closed 2D polygon `P` (projected silhouette, post-RDP).
2. Compute approximate **medial axis** `A`:
   - Slice polygon at `N` equally spaced Y intervals (default `N = 8`).
   - At each slice, midpoints of left/right boundary intersections form axis points.
   - Fallback: straight skeleton approximation via iterative inward offset (optional upgrade path).
3. For each axis point `aᵢ`, compute cross-section radius:
   ```
   rᵢ = distance(aᵢ, nearest point on polygon boundary) × roundness
   ```
   - `roundness` ∈ [0.5, 1.0], default 0.8.
4. Place ring of `S` vertices (from poly budget) around each axis point, normal to axis tangent.
5. Connect adjacent rings with quad strips → triangulate to triangles.

**Result:** 3D volume whose orthographic silhouette matches the drawn outline. No side-profile drawing required.

### 1.5 Lathe / Loft Generation for Round Shapes

**Radial symmetry test** (runs on closed strokes):

```
centroid C = average of polygon vertices
radii rᵢ = |Pᵢ − C|
coefficient_of_variation = std(rᵢ) / mean(rᵢ)
area_ratio = min(area(P), π·mean(r)²) / max(...)
```

- Symmetric if `CV < 0.35` AND `area_ratio > 0.75`.
- **If symmetric → Lathe:**
  1. Extract half-profile: sort vertices by Y, map to `(radius, height)` relative to centroid.
  2. Curvature-sample profile (Section 2.2).
  3. Revolve profile around Y-axis (or stroke-major axis) in `S` radial segments.
  4. Collapse top/bottom poles to single vertices (Section 3.3).
- **If not symmetric → Loft** (Section 1.4).

**Segment count `S`:** derived from poly budget, not stroke point count:

```
S = clamp(floor(poly_budget / profile_ring_count), 4, 32)
```

### 1.6 One-Stroke Bead Creation

Fast path for ellipse-like closed strokes.

1. Closed stroke detected + radial symmetry passes.
2. Fit bounding ellipse to silhouette (centroid + max radius + height span).
3. Build 4-point lathe profile: `(0, −h/2) → (R, −h/2) → (R, h/2) → (0, h/2)`.
4. Revolve with default `S = 8–12` (controlled by Density slider).
5. Mesh appears on pointer-up; no confirmation dialog.

**Live adjustment:** changing Density slider re-runs lathe from cached profile without re-drawing stroke.

---

## 2. Strict Vertex Control (No Useless Vertices)

### 2.1 Governing Rule

| Operation category        | May add vertices? |
|---------------------------|-------------------|
| Initial stroke generation | Yes (curvature-sampled) |
| Sculpting (all tools)     | No |
| Relax / smooth            | No |
| Export                    | No |
| Undo / redo               | No |
| Boolean cut               | Yes (intersection loop only) |
| User-triggered simplify   | No (removes only) |
| Mirror / array            | No (duplicate exact topology) |

### 2.2 Curvature-Based Vertex Placement

Replaces uniform sampling everywhere in generation pipeline.

**Adaptive angular deviation sampling:**

```
Input: polyline profile [p₀ … pₙ], threshold θ_min (default 15°)
Output: reduced vertex list

Always include p₀ and pₙ.
For each interior point pᵢ:
  v₁ = pᵢ − pᵢ₋₁
  v₂ = pᵢ₊₁ − pᵢ
  angle = arccos(dot(normalize(v₁), normalize(v₂)))
  If angle > θ_min: include pᵢ
```

- Flat regions: zero interior vertices.
- Sharp corners: vertex guaranteed.
- In **Strict mode**, if resulting count exceeds budget, merge lowest-angle interior points first until within budget.

### 2.3 Adaptive Tessellation

| Mode       | Behavior |
|------------|----------|
| **Strict** | Hard vertex ceiling = poly budget. Greedy curvature-priority insertion until budget exhausted; lowest-curvature points dropped first if over. |
| **Adaptive** | No hard ceiling. Count determined solely by `θ_min`. Budget is advisory; warn if exceeded by >10%. |

Per-object override available; global default in settings.

### 2.4 Poly Budget Slider

- Range: 16–256 vertices (UI slider, step 8).
- Maps to target range, not exact count (avoids degenerate topology at odd numbers).
- Display: `current_verts / budget` with color warning when over budget in adaptive mode.
- **Strict sub-mode:** generation refuses to exceed; sculpting unaffected.
- **Adaptive sub-mode:** budget is soft cap; sharp features may exceed with ⚠ indicator.

### 2.5 Topology Lock Mode

When enabled on an object:

- Vertex count and face connectivity frozen.
- Sculpt tools: position changes only.
- Boolean, simplify, remesh: disabled until unlocked.
- Visual indicator: lock icon in viewport stats bar.
- Toggle: `L` hotkey or toolbar button.

### 2.6 Relax / Smooth (No Subdivision)

**In-place Laplacian:**

```
For each affected vertex v (within brush radius):
  neighbors N = adjacent vertices via half-edge traversal
  avg = (1/|N|) Σ nᵢ
  v' = lerp(v, avg, strength × falloff(dist))
```

- No Taubin iteration loops during brush — single step per pointer move.
- Strength ∈ [0, 1], default 0.5.
- Falloff: smoothstep from brush center to radius edge.
- Topology unchanged; only `positions[]` array updated.

### 2.7 Rules for Preserving Low-Poly Style

- Face count invariant under: vertex move, export, undo/redo, facet exaggeration (shader-only).
- Boolean that adds vertices must show projected delta: `"Boolean will add ~N vertices. Continue?"`
- Post-boolean: offer region-restricted simplify (Section 3.5).
- Symmetry duplicate: copy positions + faces verbatim; no re-tessellation.
- No automatic LOD, no auto-smooth on export, no normal subdivision modifiers.

---

## 3. Mesh Kernel Architecture

### 3.1 Half-Edge Mesh Structure

**Why half-edge:** O(1) vertex→edge→face adjacency for relax, pinch, heatmap, and edge collapse.

**Data structures:**

```
Vertex {
  position: Vec3        // separate array for GPU upload
}

HalfEdge {
  origin:   vertex_index
  twin:     halfedge_index
  next:     halfedge_index   // CCW around face
  face:     face_index | null
}

Face {
  halfedge: halfedge_index   // one of its bounding half-edges
  color:    uint24
}
```

**Invariants:**

- Each undirected edge = two twins.
- Face boundary: follow `next` until cycle completes.
- Boundary edges: `face = null` on one twin.

**Rebuild trigger:** after boolean, simplify, or import. Not after sculpt (positions-only change).

### 3.2 Convex Hull Generation

**Use case:** Fallback solid when silhouette has no concavity and loft fails (self-intersecting medial axis).

**Algorithm:** Incremental Quickhull on 3D point cloud sampled from medial-axis cross-sections.

- Input points = ring vertices from Section 1.4 step 4.
- Output hull vertex count ≤ input count (no densification).
- If hull vertex count < 4, reject and prompt user to redraw.

### 3.3 Minimal Lathe Extrusion

**Profile rings:** one ring per curvature-sampled profile point.

**Pole handling:**

```
If profile radius at endpoint < ε (0.01 units):
  Emit single pole vertex (not a degenerate n-gon ring)
  Fan triangles from pole to first/last full ring
```

**Face construction:** quad strip between ring `i` and ring `i+1`:

```
For each segment s in 0 … S−1:
  quad = (ring[i][s], ring[i][s+1], ring[i+1][s+1], ring[i+1][s])
  triangulate as two triangles
```

**Post-creation edit:** radial segment count stored in object metadata; changing it re-runs lathe from cached profile array without re-stroking.

### 3.4 Boolean Hole-Punching with Remeshing

**Cutting tools:** cylinder, capsule (aligned to view axis or free in Side view).

**Pipeline:**

1. Compute mesh–tool intersection curve (triangle–cylinder tests, collect edge segments).
2. Insert intersection as new edge loop into half-edge structure.
3. Retriangulate only faces intersecting the tool bounding volume.
4. Delete faces whose centroids fall inside the tool volume.
5. Cap option: through-hole (no cap) or blind hole (planar cap at tool depth).

**Local remesh scope:** only faces within `tool_bbox + 2× edge length` padding.

**Post-boolean:** optional simplify restricted to faces within remesh scope (Section 3.5).

### 3.5 Quadric Error Simplification (Optional)

**Garland–Heckbert edge collapse:**

1. For each edge `(v₀, v₁)`, compute combined quadric `Q = Q₀ + Q₁`.
2. Optimal collapse position = min-error point from `Q`.
3. Error cost = `Q(v_opt)`.
4. Priority queue ordered by cost.
5. Collapse lowest-cost edge; update adjacent quadrics; repeat.

**Stop condition:** vertex count ≤ target OR min cost > max_error threshold.

**Invocation:**

- User tool: "Reduce Poly Count" (Section 7.5).
- Auto-offered post-boolean on affected region only.
- Never runs in background.

### 3.6 Flat-Normal Shading Pipeline

**Default (flat):**

```
For each triangle (a, b, c):
  face_normal = normalize(cross(b−a, c−a))
  Duplicate vertices per face for GPU (no shared normals)
```

**Optional smooth (per-object toggle):**

```
vertex_normal = normalize(Σ adjacent face_normals)
```

**Facet exaggeration (shader-only, Section 4.5):**

```
shading_normal = normalize(lerp(face_normal, vertex_normal, −facet_amount))
```

Normals are render-time derived; not stored in mesh kernel.

---

## 4. Sculpting Tools (Low-Poly Friendly)

All tools modify `positions[]` only. Brush falloff = weight, never subdivision.

### 4.1 Push / Pull

```
displacement = averaged_vertex_normal × strength × falloff(dist) × ±1
```

- Push: +normal direction.
- Pull: −normal direction.
- Averaged normal: mean of incident face normals (shared low-poly look).

### 4.2 Inflate / Deflate

```
displacement = individual_face_normal × strength × falloff(dist) × 0.6
```

- Uses unaveraged normal (first incident face) for stronger local puff.
- Scale factor 0.6 prevents self-intersection at low poly counts.

### 4.3 Relax (No Subdivision)

See Section 2.6. No directional bias. Reduces noise and sharp artifacts.

### 4.4 Pinch

```
displacement = (brush_center − vertex) × strength × falloff(dist) × 0.3
```

- Pulls vertices toward brush center (or axis-aligned line for edge-loop pinch).
- Use cases: taper limb ends, sharpen brow ridge, pinch bead tip.

### 4.5 Facet Exaggeration Slider

- Range: 0–100%.
- 0%: standard flat shading.
- 100%: maximum deviation of shading normal from face normal toward neighbor average.
- **Non-destructive** by default (shader uniform).
- Optional "Bake" action writes offset into vertex positions (one-way, undoable).

### 4.6 Vertex Density Heatmap

**Metric per vertex:**

```
density(v) = |neighbors(v)| / mean_edge_length(v)
```

**Visualization:** vertex color overlay, cool (blue, sparse) → warm (red, dense).

**Thresholds:** tied to poly budget target; warn color when local density > 2× scene average.

**Use:** audit boolean artifacts, identify simplify candidates.

---

## 5. Quad-View Layout

### 5.1 Layout

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│   FRONT (XY)        │   SIDE (YZ)         │
│   orthographic      │   orthographic      │
│                     │                     │
├─────────────────────┼─────────────────────┤
│                     │                     │
│   TOP (XZ)          │   PERSPECTIVE       │
│   orthographic      │   orbit camera      │
│                     │                     │
└─────────────────────┴─────────────────────┘
         ▲ bottom bar: palette, sliders, export
```

- Active viewport: accent outline border.
- Click viewport to activate for input.
- Shared scene graph rendered in all four panels.

### 5.2 Silhouette Tracing

| View   | Work plane | Stroke axes map to |
|--------|------------|--------------------|
| Front  | XY at Z=d  | screen X→X, screen Y→Y |
| Side   | YZ at X=d  | screen X→Y, screen Y→Z |
| Top    | XZ at Y=d  | screen X→X, screen Y→Z |
| Perspective | —     | draw disabled; sculpt + select enabled |

- Default depth `d = 0` (world origin plane).
- Depth adjustable via slider or snap-to-surface.

### 5.3 Synchronized Editing

- Single scene graph; all viewports read same object list.
- Selection in any view highlights in all views.
- Sculpt brush operates in world space; same displacement regardless of active view.
- Undo/redo affects all viewports simultaneously.

### 5.4 Stroke Projection Rules

**Empty space (no geometry under cursor):**

```
depth = default_depth (global or per-view last-used)
```

**Over existing geometry:**

```
Ray: origin = view_camera_pos, direction = view_normal
Hit = nearest triangle intersection along ray
depth = hit_point coordinate on inactive axis
```

**Refinement stroke (over existing mesh):**

- Prefer displacing nearest existing vertices toward stroke silhouette.
- Do not insert vertices unless user explicitly enables "Add topology" (future, off by default).

**Perspective view:** mesh generation disabled (depth ambiguous). Selection and sculpt permitted.

---

## 6. UI/UX Design

### 6.1 Tool Rings Instead of Menus

**Invocation:** `Tab` key or press-and-hold on viewport.

```
              [Boolean]
                 │
    [Select] ── CENTER ── [Sculpt]
                 │
               [Draw]
```

- Inner ring: 4 categories (Draw, Sculpt, Select, Boolean).
- Hover/click category → outer ring shows specific tools.
- Release or click tool → ring closes, tool active.
- Minimal persistent chrome: bottom bar only.

### 6.2 Palette of Flat Colors

- 16 fixed swatches (no color picker in v1).
- Assign to: active draw color (whole object) or selected faces (face mode).
- Per-face color stored in `face.color`.
- No gradients, no UV, no textures.

### 6.3 Density Slider

- Always visible in bottom bar.
- Controls: radial segments (lathe), ring segments (loft), tube sides (extrusion).
- Range: 4–32.
- Distinct from Poly Budget (which caps total vertices).

### 6.4 Vertex / Edge / Face Selection Modes

| Key | Mode   | Highlight color | Primary use |
|-----|--------|-----------------|-------------|
| 1   | Vertex | Cyan            | Move, pinch, push |
| 2   | Edge   | Green           | Loop pinch, edge relax |
| 3   | Face   | Orange          | Color assign, boolean target |

### 6.5 Simple Export (OBJ / GLTF)

**OBJ:**

- `v` lines for positions.
- `f` lines for faces (1-indexed).
- `usemtl` groups per flat color.
- No automatic triangulation of quads at export if already triangulated.

**GLTF 2.0:**

- Single `.gltf` + embedded base64 buffer (or `.glb` optional).
- Per-primitive `COLOR_0` attribute for flat colors.
- Node per scene object.

**Invariant:** export reads mesh kernel verbatim. No re-tessellation, no normal regeneration beyond current shading mode.

---

## 7. Example Workflows

### 7.1 Drawing a Bead

1. Activate Front view. Select **Draw** (tool ring or `D`).
2. Draw closed elliptical stroke.
3. System: RDP → closed → radial symmetry ✓ → lathe bead (8–12 segments).
4. Bead appears on pointer-up.
5. Adjust **Density** slider to change segment count live.
6. Optional: **Inflate** for puffier bead; **Relax** to soften without adding verts.

### 7.2 Drawing an Organic Blob

1. Front view: draw closed irregular stroke (no radial symmetry).
2. System: medial axis → loft with curvature-based rings.
3. Switch to **Inflate**, brush over one side for asymmetry.
4. **Relax** transitions between inflated and base regions.
5. Check **Heatmap** to confirm even vertex distribution.

### 7.3 Drawing a Stylized Character Head

1. Front view: closed head silhouette → loft/base volume.
2. Side view: refinement stroke over existing mesh → vertices snap to surface, displaced toward stroke.
3. Vertex mode + **Pinch**: brow ridge, chin, nose bump.
4. **Facet Exaggeration** at 40% for stylized cheek/jaw read.
5. Enable **Topology Lock** before posing limbs separately.

### 7.4 Adding a Hole Through a Bead

1. Select bead. Unlock topology if locked.
2. Boolean → through-hole cylinder.
3. Side view: align cylinder depth and diameter.
4. Confirm → intersection loop inserted, local retriangulation.
5. Heatmap: expect warm band at hole edge.
6. **Reduce Poly Count** (region = boolean scope) to recover budget.

### 7.5 Reducing Poly Count While Preserving Shape

1. Note current verts vs. poly budget on selected object.
2. Trigger **Simplify** → set target count or max error.
3. Quadric collapse runs until target reached.
4. Re-check Heatmap for even distribution.
5. Compare silhouette against original in Front/Side views.
6. If features lost: undo, retry with lower reduction step (e.g. −10 verts at a time).

---

## 8. Key Constraints Summary

| Constraint | Enforcement |
|------------|---------------|
| No sculpt subdivision | Position-only updates; half-edge topology unchanged |
| No export densification | Serializers read kernel directly |
| Vertex creation gated | Generation, boolean, explicit simplify only |
| Poly budget | Strict/adaptive modes + UI counter |
| Topology lock | Blocks all topology-changing ops |
| Flat low-poly look | Flat normals default; facet exaggeration shader-only |
| Fast organic workflow | One-stroke bead, quad-view silhouette tracing, tool ring |

---

## 9. Module Map (Implementation Reference)

```
src/
├── mesh/           Half-edge kernel, lathe, loft, extrusion, simplify
├── stroke/         RDP, classifier, stroke-to-mesh pipeline
├── sculpt/         Push, inflate, relax, pinch, heatmap
├── export/         OBJ, GLTF serializers
├── store/          Scene state, undo history, tool settings
└── components/     Quad viewport, tool ring, palette, export dialog
```

**Undo model:** snapshot `objects[]` array (deep copy positions + faces) on each topology-changing or sculpt commit. Max 50 steps.

**Rendering:** React Three Fiber; orthographic cameras for Front/Side/Top; OrbitControls for Perspective; `meshStandardMaterial` with `flatShading: true` by default.
