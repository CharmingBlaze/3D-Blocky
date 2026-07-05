// ---------------------------------------------------------------------------
// faceting.ts — converts a smooth, welded mesh into a flat-shaded low-poly
// mesh: every triangle gets its own 3 vertices and one hard face normal, so
// each facet reads as a distinct flat plane instead of blending into its
// neighbours. This is what gives the "low poly art" look (chunky angular
// facets, visible triangle edges).
//
// Deformation (sculpt brush, smoothing) should still run on the ORIGINAL
// welded mesh from mesh.ts — call facetMesh() only when you're about to
// render or export, as a display-time conversion, not the working copy.
// ---------------------------------------------------------------------------

import { MeshData } from './types';

function sourceUvIndex(source: MeshData, cornerIndex: number): number {
  if (source.uvIndices) return source.uvIndices[cornerIndex];
  return source.indices[cornerIndex];
}

export function facetMesh(source: MeshData): MeshData {
  const triCount = source.indices.length / 3;
  const positions = new Float32Array(triCount * 3 * 3);
  const normals = new Float32Array(triCount * 3 * 3);
  const hasUv = Boolean(source.uvs);
  const uvs = hasUv ? new Float32Array(triCount * 3 * 2) : undefined;
  const uvIndices = hasUv ? new Uint32Array(triCount * 3) : undefined;
  const indices = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const ia = source.indices[t * 3];
    const ib = source.indices[t * 3 + 1];
    const ic = source.indices[t * 3 + 2];

    const ax = source.positions[ia * 3], ay = source.positions[ia * 3 + 1], az = source.positions[ia * 3 + 2];
    const bx = source.positions[ib * 3], by = source.positions[ib * 3 + 1], bz = source.positions[ib * 3 + 2];
    const cx = source.positions[ic * 3], cy = source.positions[ic * 3 + 1], cz = source.positions[ic * 3 + 2];

    // one flat normal per triangle, shared by all three of its (duplicated) vertices
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const base = t * 3;
    const verts: [number, number, number][] = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]];
    const srcCorners = [t * 3, t * 3 + 1, t * 3 + 2];

    for (let k = 0; k < 3; k++) {
      const vi = base + k;
      positions[vi * 3] = verts[k][0];
      positions[vi * 3 + 1] = verts[k][1];
      positions[vi * 3 + 2] = verts[k][2];
      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
      if (uvs && source.uvs) {
        const srcUv = sourceUvIndex(source, srcCorners[k]);
        uvs[vi * 2] = source.uvs[srcUv * 2];
        uvs[vi * 2 + 1] = source.uvs[srcUv * 2 + 1];
        uvIndices![vi] = vi;
      }
      indices[vi] = vi;
    }
  }

  return { positions, normals, uvs, uvIndices, indices, faceGroups: source.faceGroups };
}
