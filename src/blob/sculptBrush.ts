// ---------------------------------------------------------------------------
// sculptBrush.ts — the "push and pull the blob with your cursor" engine.
// This is the direct analogue of Paint 3D's blob sculpt tool.
// ---------------------------------------------------------------------------

import { IndexedMesh } from './mesh';
import { BrushSettings, FalloffCurve, Vec3 } from './types';

function falloff(curve: FalloffCurve, t: number): number {
  // t is normalized distance from brush center, 0 = center, 1 = edge of radius
  const x = Math.min(Math.max(t, 0), 1);
  switch (curve) {
    case 'linear': return 1 - x;
    case 'sharp': return Math.pow(1 - x, 4);
    case 'smooth':
    default: return 1 - x * x * (3 - 2 * x); // smoothstep, matches Paint 3D's soft brush edge
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface BrushStrokeResult {
  /** vertex indices touched, and their positions *before* this stroke sample — needed for undo. */
  touched: { index: number; before: Vec3 }[];
}

/**
 * Applies one brush "dab" at a world-space hit point. Call this once per
 * pointer-move sample while the mouse/stylus is down and over the mesh.
 *
 * grabDelta is only used in 'grab' mode: the delta the pointer has moved
 * since the drag started, applied uniformly (scaled by falloff) to pull a
 * region of surface along with it — this is how Paint 3D lets you tug the
 * blob into new shapes rather than just push/pull along the normal.
 */
export function applyBrush(
  mesh: IndexedMesh,
  hitPoint: Vec3,
  settings: BrushSettings,
  pressure = 1,
  grabDelta: Vec3 = [0, 0, 0],
): BrushStrokeResult {
  const touched: { index: number; before: Vec3 }[] = [];
  const strength = settings.strength * pressure;

  for (let i = 0; i < mesh.vertexCount; i++) {
    const p = mesh.getPos(i);
    const d = dist(p, hitPoint);
    if (d > settings.radius) continue;

    const t = d / settings.radius;
    const w = falloff(settings.falloff, t) * strength;
    if (w <= 0) continue;

    touched.push({ index: i, before: p });
    const n = mesh.getNormal(i);

    switch (settings.mode) {
      case 'inflate':
        mesh.setPos(i, [p[0] + n[0] * w * 0.1, p[1] + n[1] * w * 0.1, p[2] + n[2] * w * 0.1]);
        break;
      case 'deflate':
        mesh.setPos(i, [p[0] - n[0] * w * 0.1, p[1] - n[1] * w * 0.1, p[2] - n[2] * w * 0.1]);
        break;
      case 'grab':
        mesh.setPos(i, [p[0] + grabDelta[0] * w, p[1] + grabDelta[1] * w, p[2] + grabDelta[2] * w]);
        break;
      case 'flatten': {
        // project onto the tangent plane at the hit point (approximated with hit normal)
        const toHit: Vec3 = [hitPoint[0] - p[0], hitPoint[1] - p[1], hitPoint[2] - p[2]];
        const planeDist = toHit[0] * n[0] + toHit[1] * n[1] + toHit[2] * n[2];
        mesh.setPos(i, [p[0] + n[0] * planeDist * w, p[1] + n[1] * planeDist * w, p[2] + n[2] * planeDist * w]);
        break;
      }
      case 'smooth':
        // handled in bulk after the loop — smoothing needs neighbour averages, not per-vertex normal pushes
        break;
    }
  }

  if (settings.mode === 'smooth') {
    const touchedSet = new Set(touched.map(t => t.index));
    mesh.laplacianSmoothPass(strength, (i) => touchedSet.has(i));
  }

  mesh.recomputeNormals();
  return { touched };
}
