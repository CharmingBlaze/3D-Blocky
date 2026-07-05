// ---------------------------------------------------------------------------
// doodleExtrude.ts — turns a drawn stroke (mouse/stylus path in 3D) into a
// rounded tube mesh. This is the "3D Doodle" side of Paint 3D's blob tool:
// draw a squiggle in the air, it puffs up into a solid 3D shape.
//
// Pipeline: raw points -> Catmull-Rom resample/relax -> parallel-transport
// frames along the curve (avoids the "twisting ribbon" artifact you get if
// you naively use Frenet frames) -> ring of vertices per frame -> stitch
// rings into triangles -> optional hemisphere caps at both ends.
// ---------------------------------------------------------------------------

import { DoodleSettings, MeshData, StrokePoint, Vec3 } from './types';

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale(a: Vec3, s: number): Vec3 { return [a[0]*s, a[1]*s, a[2]*s]; }
function dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0]/l, a[1]/l, a[2]/l];
}

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t, t3 = t2 * t;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (
      2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
  }
  return out;
}

/** Resample a raw stroke into evenly-spaced points with light corner relaxation. */
function resampleStroke(points: StrokePoint[], stepsPerSegment: number): Vec3[] {
  const raw = points.map(p => p.position);
  if (raw.length < 2) return raw;
  const padded = [raw[0], ...raw, raw[raw.length - 1]];
  const out: Vec3[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = padded[i], p1 = padded[i + 1], p2 = padded[i + 2], p3 = padded[i + 3];
    for (let s = 0; s < stepsPerSegment; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / stepsPerSegment));
    }
  }
  out.push(raw[raw.length - 1]);
  return out;
}

/** Builds parallel-transport frames (tangent + two stable perpendicular axes) along the resampled curve. */
function buildFrames(curve: Vec3[]): { tangent: Vec3; normal: Vec3; binormal: Vec3 }[] {
  const frames: { tangent: Vec3; normal: Vec3; binormal: Vec3 }[] = [];
  const n = curve.length;

  const firstTangent = norm(sub(curve[1], curve[0]));
  // pick any vector not parallel to the tangent to seed the first perpendicular frame
  let seed: Vec3 = Math.abs(firstTangent[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let normal = norm(cross(seed, firstTangent));
  let binormal = norm(cross(firstTangent, normal));
  frames.push({ tangent: firstTangent, normal, binormal });

  for (let i = 1; i < n; i++) {
    const prevTangent = frames[i - 1].tangent;
    const tangent = norm(sub(curve[Math.min(i + 1, n - 1)], curve[i - 1]));
    // rotate the previous normal by the smallest rotation that takes prevTangent -> tangent
    const axis = cross(prevTangent, tangent);
    const axisLen = Math.hypot(...axis);
    let rotatedNormal = frames[i - 1].normal;
    if (axisLen > 1e-6) {
      const a = norm(axis);
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(prevTangent, tangent))));
      rotatedNormal = rotateAroundAxis(rotatedNormal, a, angle);
    }
    normal = norm(sub(rotatedNormal, scale(tangent, dot(rotatedNormal, tangent)))); // re-orthogonalize
    binormal = norm(cross(tangent, normal));
    frames.push({ tangent, normal, binormal });
  }
  return frames;
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const k = axis;
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return add(add(scale(v, cos), scale(kxv, sin)), scale(k, kdv * (1 - cos)));
}

/**
 * Extrudes a stroke into a low-poly tube. Default `segments` is deliberately
 * low (6) so the cross-section reads as a hexagonal facet ring rather than a
 * smooth cylinder — pair with faceting.ts if you want fully hard-edged shading,
 * or leave as-is for a subtle low-poly-but-still-rounded look.
 */
export function extrudeStrokeToTube(points: StrokePoint[], settings: DoodleSettings): MeshData {
  const stepsPerSegment = Math.max(2, Math.round(4 * (1 - settings.smoothing) + 2));
  const curve = resampleStroke(points, stepsPerSegment);
  const frames = buildFrames(curve);
  const segs = Math.max(3, settings.segments); // 3 = triangular prism, 6 = hex tube, good low-poly range

  // per-ring radius, derived from nearest original stroke point's pressure
  const radii = curve.map((_, i) => {
    const t = i / (curve.length - 1);
    const srcIdx = Math.min(points.length - 1, Math.round(t * (points.length - 1)));
    const pressure = points[srcIdx].pressure;
    return settings.radius * (1 + (pressure - 0.5) * 2 * settings.radiusPressureScale);
  });

  const ringCount = curve.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < ringCount; i++) {
    const { normal, binormal } = frames[i];
    const center = curve[i];
    const r = radii[i];
    for (let s = 0; s < segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      const dir = add(scale(normal, Math.cos(theta)), scale(binormal, Math.sin(theta)));
      const pos = add(center, scale(dir, r));
      positions.push(...pos);
      normals.push(...dir); // outward radial direction is the correct smooth normal for a tube
      uvs.push(s / segs, i / (ringCount - 1));
    }
  }

  for (let i = 0; i < ringCount - 1; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * segs + s;
      const b = i * segs + ((s + 1) % segs);
      const c = (i + 1) * segs + s;
      const d = (i + 1) * segs + ((s + 1) % segs);
      indices.push(a, c, b, b, c, d);
    }
  }

  if (settings.roundCaps) {
    addCap(curve[0], scale(frames[0].tangent, -1), radii[0], frames[0], segs, 0, positions, normals, uvs, indices);
    addCap(curve[ringCount - 1], frames[ringCount - 1].tangent, radii[ringCount - 1], frames[ringCount - 1], segs, ringCount, positions, normals, uvs, indices);
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/** Adds a low-poly hemispherical cap (single apex point fanned to the end ring) at one end of the tube. */
function addCap(
  center: Vec3, outward: Vec3, radius: number,
  frame: { normal: Vec3; binormal: Vec3 }, segs: number, ringStartIndex: number,
  positions: number[], normals: number[], uvs: number[], indices: number[],
): void {
  const apex = add(center, scale(outward, radius));
  const apexIndex = positions.length / 3;
  positions.push(...apex);
  normals.push(...norm(outward));
  uvs.push(0.5, ringStartIndex === 0 ? 0 : 1);

  const ringBase = ringStartIndex === 0 ? 0 : ringStartIndex * segs - segs;
  for (let s = 0; s < segs; s++) {
    const a = ringBase + s;
    const b = ringBase + ((s + 1) % segs);
    if (ringStartIndex === 0) indices.push(apexIndex, b, a);
    else indices.push(apexIndex, a, b);
  }
}
