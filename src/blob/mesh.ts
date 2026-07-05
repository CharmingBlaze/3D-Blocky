// ---------------------------------------------------------------------------
// mesh.ts — thin wrapper around MeshData giving us adjacency + normal maths
// ---------------------------------------------------------------------------

import { MeshData, Vec3 } from './types';

export class IndexedMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  indices: Uint32Array;

  /** vertex index -> neighbouring vertex indices. Built lazily, invalidated on topology change. */
  private _adjacency: number[][] | null = null;

  constructor(data: MeshData) {
    this.positions = data.positions;
    this.normals = data.normals;
    this.uvs = data.uvs;
    this.indices = data.indices;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  getPos(i: number): Vec3 {
    const o = i * 3;
    return [this.positions[o], this.positions[o + 1], this.positions[o + 2]];
  }

  setPos(i: number, p: Vec3): void {
    const o = i * 3;
    this.positions[o] = p[0];
    this.positions[o + 1] = p[1];
    this.positions[o + 2] = p[2];
  }

  getNormal(i: number): Vec3 {
    const o = i * 3;
    return [this.normals[o], this.normals[o + 1], this.normals[o + 2]];
  }

  /** Build (or fetch cached) vertex adjacency list from the index buffer. O(triCount). */
  adjacency(): number[][] {
    if (this._adjacency) return this._adjacency;
    const adj: number[][] = Array.from({ length: this.vertexCount }, () => []);
    const link = (a: number, b: number) => {
      if (!adj[a].includes(b)) adj[a].push(b);
    };
    for (let t = 0; t < this.indices.length; t += 3) {
      const [a, b, c] = [this.indices[t], this.indices[t + 1], this.indices[t + 2]];
      link(a, b); link(b, a);
      link(b, c); link(c, b);
      link(c, a); link(a, c);
    }
    this._adjacency = adj;
    return adj;
  }

  invalidateAdjacency(): void {
    this._adjacency = null;
  }

  /** Recompute smooth (area-weighted) vertex normals from current positions/indices. */
  recomputeNormals(): void {
    this.normals.fill(0);
    for (let t = 0; t < this.indices.length; t += 3) {
      const ia = this.indices[t], ib = this.indices[t + 1], ic = this.indices[t + 2];
      const a = this.getPos(ia), b = this.getPos(ib), c = this.getPos(ic);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      // cross(u, v) — magnitude encodes triangle area, giving area-weighted normals for free
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const i of [ia, ib, ic]) {
        this.normals[i * 3] += nx;
        this.normals[i * 3 + 1] += ny;
        this.normals[i * 3 + 2] += nz;
      }
    }
    for (let i = 0; i < this.vertexCount; i++) {
      const o = i * 3;
      const nx = this.normals[o], ny = this.normals[o + 1], nz = this.normals[o + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      this.normals[o] = nx / len;
      this.normals[o + 1] = ny / len;
      this.normals[o + 2] = nz / len;
    }
  }

  /** One pass of uniform Laplacian smoothing, blended by `amount` (0..1). Used by the smooth brush + doodle relaxation. */
  laplacianSmoothPass(amount: number, vertexFilter?: (i: number) => boolean): void {
    const adj = this.adjacency();
    const next = new Float32Array(this.positions.length);
    next.set(this.positions);
    for (let i = 0; i < this.vertexCount; i++) {
      if (vertexFilter && !vertexFilter(i)) continue;
      const neighbours = adj[i];
      if (neighbours.length === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const n of neighbours) {
        ax += this.positions[n * 3];
        ay += this.positions[n * 3 + 1];
        az += this.positions[n * 3 + 2];
      }
      ax /= neighbours.length; ay /= neighbours.length; az /= neighbours.length;
      const o = i * 3;
      next[o] = this.positions[o] + (ax - this.positions[o]) * amount;
      next[o + 1] = this.positions[o + 1] + (ay - this.positions[o + 1]) * amount;
      next[o + 2] = this.positions[o + 2] + (az - this.positions[o + 2]) * amount;
    }
    this.positions.set(next);
  }

  toMeshData(): MeshData {
    return { positions: this.positions, normals: this.normals, uvs: this.uvs, indices: this.indices };
  }
}
