// ---------------------------------------------------------------------------
// primitives.ts — base shapes to sculpt. Icosphere is the right starting
// point for a sculptable blob because subdivision gives near-uniform
// triangle density (unlike a UV sphere, which bunches triangles at the poles
// and makes brush strokes near the top/bottom look distorted).
// ---------------------------------------------------------------------------

import { MeshData } from './types';

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Generates an icosphere by subdividing a base icosahedron `subdivisions` times.
 * For a LOW-POLY blob, keep this small:
 *   0 subdivisions = 12 verts / 20 tris  (very chunky, "gem" look)
 *   1 subdivision  = 42 verts / 80 tris  (good low-poly sculpting default)
 *   2 subdivisions = 162 verts / 320 tris (still low-poly, more sculpt detail)
 * Go to 3+ only if you want smooth/organic instead of faceted.
 */
export function createIcosphere(radius = 1, subdivisions = 1): MeshData {
  let verts: number[][] = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ].map(normalize);

  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const midpointCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const va = verts[a], vb = verts[b];
    const mid = normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
    verts.push(mid);
    const idx = verts.length - 1;
    midpointCache.set(key, idx);
    return idx;
  };

  for (let s = 0; s < subdivisions; s++) {
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
    midpointCache.clear(); // vertex set changed shape enough to be safe rebuilding per pass
  }

  const positions = new Float32Array(verts.length * 3);
  const normals = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);
  verts.forEach((v, i) => {
    positions[i * 3] = v[0] * radius;
    positions[i * 3 + 1] = v[1] * radius;
    positions[i * 3 + 2] = v[2] * radius;
    normals[i * 3] = v[0];
    normals[i * 3 + 1] = v[1];
    normals[i * 3 + 2] = v[2];
    // simple equirectangular UV — fine for matcap/solid shading, swap for better if you add textures
    uvs[i * 2] = 0.5 + Math.atan2(v[2], v[0]) / (2 * Math.PI);
    uvs[i * 2 + 1] = 0.5 - Math.asin(v[1]) / Math.PI;
  });

  const indices = new Uint32Array(faces.length * 3);
  faces.forEach(([a, b, c], i) => {
    indices[i * 3] = a; indices[i * 3 + 1] = b; indices[i * 3 + 2] = c;
  });

  return { positions, normals, uvs, indices };
}

function normalize(v: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
