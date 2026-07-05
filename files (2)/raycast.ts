// ---------------------------------------------------------------------------
// raycast.ts — Möller–Trumbore ray/triangle test to find where the cursor
// ray hits the blob surface, so the brush knows where to apply.
// If you're rendering with three.js, you can use THREE.Raycaster against the
// BufferGeometry instead and skip this file entirely — kept here so the
// system has no hard three.js dependency if you want to swap engines.
// ---------------------------------------------------------------------------

import { IndexedMesh } from './mesh';
import { Vec3 } from './types';

export interface RaycastHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  triangleIndex: number;
}

const EPSILON = 1e-7;

export function raycastMesh(mesh: IndexedMesh, origin: Vec3, direction: Vec3): RaycastHit | null {
  let closest: RaycastHit | null = null;

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t], ib = mesh.indices[t + 1], ic = mesh.indices[t + 2];
    const a = mesh.getPos(ia), b = mesh.getPos(ib), c = mesh.getPos(ic);

    const e1: Vec3 = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const e2: Vec3 = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const h = cross(direction, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < EPSILON) continue;

    const invDet = 1 / det;
    const s: Vec3 = [origin[0]-a[0], origin[1]-a[1], origin[2]-a[2]];
    const u = dot(s, h) * invDet;
    if (u < 0 || u > 1) continue;

    const q = cross(s, e1);
    const v = dot(direction, q) * invDet;
    if (v < 0 || u + v > 1) continue;

    const dist = dot(e2, q) * invDet;
    if (dist < EPSILON) continue;
    if (closest && dist >= closest.distance) continue;

    const point: Vec3 = [origin[0] + direction[0]*dist, origin[1] + direction[1]*dist, origin[2] + direction[2]*dist];
    const n = cross(e1, e2);
    const nLen = Math.hypot(...n) || 1;
    closest = { point, normal: [n[0]/nLen, n[1]/nLen, n[2]/nLen], distance: dist, triangleIndex: t / 3 };
  }

  return closest;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
