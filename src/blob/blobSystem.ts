// ---------------------------------------------------------------------------
// blobSystem.ts — public API. This is the class your UI (React/vanilla/
// whatever Cursor scaffolds around this) talks to. It owns:
//   - the working (smooth, welded) meshes for sculpting
//   - conversion to low-poly facet meshes for display/export
//   - undo/redo
//   - mirror mode (optional symmetric sculpting)
// ---------------------------------------------------------------------------

import { IndexedMesh } from './mesh';
import { createIcosphere } from './primitives';
import { facetMesh } from './faceting';
import { applyBrush } from './sculptBrush';
import { extrudeStrokeToTube } from './doodleExtrude';
import { raycastMesh, RaycastHit } from './raycast';
import { HistoryStack, createSculptCommand } from './history';
import { BlobObject, BrushSettings, DoodleSettings, StrokePoint, Vec3, MeshData } from './types';
import { worldBoxToMeshData, type PrimitiveBoxType } from '../primitives/primitivesBox';

let nextId = 1;

export interface BlobSystemOptions {
  /** Mirror brush strokes across the X=0 plane, like Paint 3D's symmetry toggle. */
  mirrorX?: boolean;
}

export class BlobSystem {
  readonly history = new HistoryStack();
  objects = new Map<string, IndexedMesh>();
  private mirrorX: boolean;

  constructor(options: BlobSystemOptions = {}) {
    this.mirrorX = options.mirrorX ?? false;
  }

  /** Creates a new sculptable blob primitive. Low subdivisions = low-poly by default (see primitives.ts). */
  createBlob(radius = 1, subdivisions = 1): BlobObject {
    const mesh = new IndexedMesh(createIcosphere(radius, subdivisions));
    const id = `blob_${nextId++}`;
    this.objects.set(id, mesh);
    return { id, mesh: mesh.toMeshData() };
  }

  /** One brush dab, called per pointer-move sample while sculpting. */
  sculpt(id: string, hitPoint: Vec3, settings: BrushSettings, pressure = 1, grabDelta: Vec3 = [0, 0, 0]): void {
    const mesh = this.objects.get(id);
    if (!mesh) return;

    const result = applyBrush(mesh, hitPoint, settings, pressure, grabDelta);
    this.history.push(createSculptCommand(mesh, result.touched));

    if (this.mirrorX) {
      const mirroredHit: Vec3 = [-hitPoint[0], hitPoint[1], hitPoint[2]];
      const mirroredGrab: Vec3 = [-grabDelta[0], grabDelta[1], grabDelta[2]];
      const mirrorResult = applyBrush(mesh, mirroredHit, settings, pressure, mirroredGrab);
      this.history.push(createSculptCommand(mesh, mirrorResult.touched, 'Sculpt (mirror)'));
    }
  }

  /** Cast a ray against a blob to find where to sculpt. Returns null if it misses. */
  pick(id: string, origin: Vec3, direction: Vec3): RaycastHit | null {
    const mesh = this.objects.get(id);
    if (!mesh) return null;
    return raycastMesh(mesh, origin, direction);
  }

  /** Turns a finished doodle stroke into its own blob object (a tube). */
  createDoodle(points: StrokePoint[], settings: DoodleSettings): BlobObject {
    const meshData = extrudeStrokeToTube(points, settings);
    const mesh = new IndexedMesh(meshData);
    const id = `doodle_${nextId++}`;
    this.objects.set(id, mesh);
    return { id, mesh: mesh.toMeshData() };
  }

  /** Display/export copy: converts the smooth working mesh into a hard-edged low-poly mesh. */
  getRenderMesh(id: string): MeshData | null {
    const mesh = this.objects.get(id);
    if (!mesh) return null;
    return facetMesh(mesh.toMeshData());
  }

  /** Low-poly primitive inscribed in a world-space box, faceted for display. */
  createPrimitiveInBox(
    type: PrimitiveBoxType,
    center: Vec3,
    size: Vec3,
    heightAxis: 0 | 1 | 2,
    segments = 8
  ): BlobObject {
    const min = {
      x: center[0] - size[0] / 2,
      y: center[1] - size[1] / 2,
      z: center[2] - size[2] / 2,
    };
    const max = {
      x: center[0] + size[0] / 2,
      y: center[1] + size[1] / 2,
      z: center[2] + size[2] / 2,
    };
    const meshData = worldBoxToMeshData(type, min, max, heightAxis, segments);
    const mesh = new IndexedMesh(meshData);
    const id = `prim_${nextId++}`;
    this.objects.set(id, mesh);
    return { id, mesh: mesh.toMeshData() };
  }

  undo(): void { this.history.undo(); }
  redo(): void { this.history.redo(); }

  removeObject(id: string): void {
    this.objects.delete(id);
  }
}

// Recommended low-poly defaults, tune from your UI's brush/doodle panels:
export const DEFAULT_BRUSH: BrushSettings = {
  mode: 'inflate',
  radius: 0.4,
  strength: 0.6,
  falloff: 'smooth',
};

export const DEFAULT_DOODLE: DoodleSettings = {
  radius: 0.15,
  radiusPressureScale: 0.4,
  segments: 6,       // hex cross-section — low-poly but still reads as round
  smoothing: 0.3,
  roundCaps: true,
};
