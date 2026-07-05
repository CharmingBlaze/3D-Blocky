// ---------------------------------------------------------------------------
// types.ts — shared vocabulary for the whole blob system
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/** Flat, GPU-friendly mesh buffers (matches three.js BufferGeometry layout). */
export interface MeshData {
  positions: Float32Array; // xyz per vertex, length = vertexCount * 3
  normals: Float32Array;   // xyz per vertex, length = vertexCount * 3
  uvs?: Float32Array;      // uv per vertex, length = vertexCount * 2
  indices: Uint32Array;    // triangle list, length = triCount * 3
}

export type BrushMode = 'inflate' | 'deflate' | 'smooth' | 'flatten' | 'grab';
export type FalloffCurve = 'smooth' | 'linear' | 'sharp';

export interface BrushSettings {
  mode: BrushMode;
  /** World-space radius of influence. */
  radius: number;
  /** 0..1, scaled further by stylus pressure if available. */
  strength: number;
  falloff: FalloffCurve;
  /** Only used in 'grab' mode: locks the initial hit point as a drag handle. */
}

export interface StrokePoint {
  position: Vec3;
  /** Surface normal at the point the stroke was drawn on, or camera-facing normal in free-air mode. */
  normal: Vec3;
  pressure: number; // 0..1
  timestamp: number;
}

export interface DoodleSettings {
  /** Base tube radius before pressure scaling. */
  radius: number;
  /** How much stylus pressure can grow/shrink the radius, 0..1. */
  radiusPressureScale: number;
  /** Sides of the tube's circular cross-section. 8 = faceted, 20+ = smooth. */
  segments: number;
  /** 0..1, how aggressively the raw input polyline is resampled/relaxed before extrusion. */
  smoothing: number;
  /** Round off the two open ends into hemispherical caps, like Paint 3D. */
  roundCaps: boolean;
}

export interface HistoryCommand {
  label: string;
  undo(): void;
  redo(): void;
}

/** A single deformable object in the scene (a sculpted blob or a doodle tube). */
export interface BlobObject {
  id: string;
  mesh: MeshData;
  /** Per-vertex adjacency, needed for smoothing brush + Laplacian ops. Lazily built. */
  adjacency?: number[][];
}
