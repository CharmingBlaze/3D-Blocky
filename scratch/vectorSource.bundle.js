// src/mesh/objectTransform.ts
import * as THREE from "three";
var IDENTITY_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
};
function ensureTransform(obj) {
  return obj.transform ?? {
    position: { ...IDENTITY_TRANSFORM.position },
    rotation: { ...IDENTITY_TRANSFORM.rotation },
    scale: { ...IDENTITY_TRANSFORM.scale }
  };
}
function computeCentroid(positions) {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of positions) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = positions.length;
  return { x: x / n, y: y / n, z: z / n };
}
function getObjectPivot(obj) {
  return obj.pivot ? { ...obj.pivot } : computeCentroid(obj.positions);
}
var _v = new THREE.Vector3();
var _euler = new THREE.Euler();
var _scale = new THREE.Vector3();
var _invRot = new THREE.Matrix4();
function worldPointFromObject(obj, meshPoint) {
  const pivot = getObjectPivot(obj);
  const tr = ensureTransform(obj);
  _v.set(
    meshPoint.x - pivot.x,
    meshPoint.y - pivot.y,
    meshPoint.z - pivot.z
  );
  _scale.set(tr.scale.x, tr.scale.y, tr.scale.z);
  _euler.set(tr.rotation.x, tr.rotation.y, tr.rotation.z);
  _v.multiply(_scale).applyEuler(_euler).add(
    new THREE.Vector3(tr.position.x, tr.position.y, tr.position.z)
  );
  return { x: _v.x, y: _v.y, z: _v.z };
}
var _dir = new THREE.Vector3();
var _startM = new THREE.Matrix4();
var _curM = new THREE.Matrix4();
var _deltaM = new THREE.Matrix4();
var _invStartM = new THREE.Matrix4();
var _pivot = new THREE.Vector3();
var _pos = new THREE.Vector3();
var _gizmoEuler = new THREE.Euler();
var _baseQuat = new THREE.Quaternion();
var _deltaQuat = new THREE.Quaternion();
var _outQuat = new THREE.Quaternion();
var _deltaScale = new THREE.Vector3();
var _dummyPos = new THREE.Vector3();

// src/vector/autoConnect.ts
function cloneAnchors(path) {
  return path.anchors.map((a) => ({
    ...a,
    position: { ...a.position },
    inHandle: a.inHandle ? { ...a.inHandle } : null,
    outHandle: a.outHandle ? { ...a.outHandle } : null
  }));
}

// src/mesh/concaveTriangulate.ts
function cross2(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function signedArea(polygon) {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
  }
  return area / 2;
}
function ensureCCW(polygon) {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : [...polygon];
}
function isConcavePolygon(polygon) {
  if (polygon.length < 4) return false;
  const poly = ensureCCW(polygon);
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    if (cross2(prev, curr, next) < -1e-6) return true;
  }
  return false;
}
function pointInTriangle(p, a, b, c) {
  const c1 = cross2(a, b, p);
  const c2 = cross2(b, c, p);
  const c3 = cross2(c, a, p);
  const hasNeg = c1 < 0 || c2 < 0 || c3 < 0;
  const hasPos = c1 > 0 || c2 > 0 || c3 > 0;
  return !(hasNeg && hasPos);
}
function earClipTriangulate(polygon) {
  const poly = ensureCCW(polygon);
  if (poly.length < 3) return [];
  const indices = poly.map((_, i) => i);
  const triangles = [];
  let guard = 0;
  while (indices.length > 3 && guard++ < 1e4) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i + indices.length - 1) % indices.length];
      const curr = indices[i];
      const next = indices[(i + 1) % indices.length];
      const a = poly[prev];
      const b = poly[curr];
      const c = poly[next];
      if (cross2(a, b, c) <= 0) continue;
      let contains = false;
      for (const idx of indices) {
        if (idx === prev || idx === curr || idx === next) continue;
        if (pointInTriangle(poly[idx], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([prev, curr, next]);
      indices.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }
  if (indices.length === 3) {
    triangles.push([indices[0], indices[1], indices[2]]);
  }
  return triangles;
}
function concavityScore(polygon) {
  const poly = ensureCCW(polygon);
  const hull = convexHull(poly);
  const hullArea = Math.abs(signedArea(hull));
  const polyArea = Math.abs(signedArea(poly));
  if (hullArea < 1e-6) return 0;
  return 1 - polyArea / hullArea;
}
function convexHull(points) {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
function countReflexVertices(polygon) {
  const poly = ensureCCW(polygon);
  let count = 0;
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    if (cross2(prev, curr, next) < -1e-6) count++;
  }
  return count;
}

// src/utils/math.ts
import { Vector3 as Vector32 } from "three";
function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist2(point, lineStart);
  const t = clamp(((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq, 0, 1);
  const proj = { x: lineStart.x + t * dx, y: lineStart.y + t * dy };
  return dist2(point, proj);
}
function polygonArea2D(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}
function normalize3(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}
function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale3(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function faceNormal(a, b, c) {
  return normalize3(cross3(sub3(b, a), sub3(c, a)));
}
function generateId() {
  return Math.random().toString(36).slice(2, 11);
}

// src/material/materialTypes.ts
function cloneMaterial(m) {
  return {
    ...m,
    solidColor: m.solidColor ? [...m.solidColor] : void 0,
    textureTint: m.textureTint ? [...m.textureTint] : void 0,
    textureRepeat: m.textureRepeat ? [...m.textureRepeat] : void 0,
    textureOffset: m.textureOffset ? [...m.textureOffset] : void 0,
    textureGradient: m.textureGradient ? { start: [...m.textureGradient.start], end: [...m.textureGradient.end], angle: m.textureGradient.angle } : void 0
  };
}

// src/mesh/meshNormals.ts
function buildTopologyVertexNormals(mesh) {
  const n = mesh.positions.length;
  const acc = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  const any = new Uint8Array(n);
  for (const face of mesh.faces) {
    if (!face || face.length < 3) continue;
    const len = face.length;
    for (let ci = 0; ci < len; ci++) {
      const vi = face[ci];
      const a = mesh.positions[vi];
      const b = mesh.positions[face[(ci + 1) % len]];
      const c = mesh.positions[face[(ci + len - 1) % len]];
      if (!a || !b || !c) continue;
      const nrm = faceNormal(a, b, c);
      const e1 = normalize3(sub3(b, a));
      const e2 = normalize3(sub3(c, a));
      const cos = Math.max(-1, Math.min(1, e1.x * e2.x + e1.y * e2.y + e1.z * e2.z));
      const angle = Math.acos(cos);
      const weighted = scale3(nrm, angle);
      const sum = acc[vi];
      sum.x += weighted.x;
      sum.y += weighted.y;
      sum.z += weighted.z;
      any[vi] = 1;
    }
  }
  const out = new Array(n);
  for (let vi = 0; vi < n; vi++) {
    if (!any[vi]) {
      out[vi] = { x: 0, y: 1, z: 0 };
      continue;
    }
    out[vi] = normalize3(acc[vi]);
  }
  return out;
}
function getVertexNormalFromHalfEdges(mesh, vi, averaged) {
  if (mesh.halfEdges.length === 0) return null;
  let sum = { x: 0, y: 0, z: 0 };
  let any = false;
  let first = null;
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < mesh.halfEdges.length; i++) {
    const he = mesh.halfEdges[i];
    if (he.origin !== vi) continue;
    if (seen.has(he.face)) continue;
    seen.add(he.face);
    const face = mesh.faces[he.face];
    if (!face || face.length < 3) continue;
    const idx = face.indexOf(vi);
    if (idx < 0) continue;
    const a = mesh.positions[face[idx]];
    const b = mesh.positions[face[(idx + 1) % face.length]];
    const c = mesh.positions[face[(idx + face.length - 1) % face.length]];
    const nrm = faceNormal(a, b, c);
    if (!averaged) return nrm;
    const e1 = normalize3(sub3(b, a));
    const e2 = normalize3(sub3(c, a));
    const cos = Math.max(-1, Math.min(1, e1.x * e2.x + e1.y * e2.y + e1.z * e2.z));
    const angle = Math.acos(cos);
    sum = add3(sum, scale3(nrm, angle));
    if (!any) {
      first = nrm;
      any = true;
    }
  }
  if (!any) return null;
  if (!averaged) return first;
  return normalize3(sum);
}

// src/mesh/geometry2d.ts
function newellNormal(points) {
  const n = points.length;
  if (n < 3) return { x: 0, y: 1, z: 0 };
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const next = points[(i + 1) % n];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}
function planeBasisFromPoints(points) {
  const origin = centroid3(points);
  const normal = newellNormal(points);
  let u = { x: 1, y: 0, z: 0 };
  if (points.length >= 2) {
    u = normalize32(sub32(points[1], points[0]));
  }
  let v = cross32(normal, u);
  if (length3(v) < 1e-8) {
    u = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    v = cross32(normal, u);
  }
  v = normalize32(v);
  u = normalize32(cross32(v, normal));
  return { origin, normal, u, v };
}
function projectPointToPlane2D(point, origin, u, v) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  return {
    x: dx * u.x + dy * u.y + dz * u.z,
    y: dx * v.x + dy * v.y + dz * v.z
  };
}
function centroid3(points) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const inv = 1 / points.length;
  return { x: x * inv, y: y * inv, z: z * inv };
}
function sub32(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross32(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}
function length3(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function normalize32(v) {
  const len = length3(v);
  if (len < 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// src/mesh/faceTriangulation.ts
function triangulateFaceLoop(positions) {
  const n = positions.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) {
    const { origin: origin2, u: u2, v: v2 } = planeBasisFromPoints(positions);
    const poly2D2 = positions.map((p) => projectPointToPlane2D(p, origin2, u2, v2));
    if (!isProjectedConcave(poly2D2)) {
      return [
        [0, 1, 2],
        [0, 2, 3]
      ];
    }
  }
  const { origin, u, v } = planeBasisFromPoints(positions);
  const poly2D = positions.map((p) => projectPointToPlane2D(p, origin, u, v));
  return earClipPreservingIndices(poly2D);
}
function isProjectedConcave(poly) {
  if (poly.length < 4) return false;
  const ccw = ensureCCW(poly);
  for (let i = 0; i < ccw.length; i++) {
    const prev = ccw[(i + ccw.length - 1) % ccw.length];
    const curr = ccw[i];
    const next = ccw[(i + 1) % ccw.length];
    const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
    if (cross < -1e-6) return true;
  }
  return false;
}
function earClipPreservingIndices(poly2D) {
  const n = poly2D.length;
  if (n < 3) return [];
  let order = poly2D.map((_, i) => i);
  if (signedArea(poly2D) < 0) order = order.reverse();
  const orderedPts = order.map((i) => poly2D[i]);
  const tris = earClipTriangulate(orderedPts);
  return tris.map(
    ([a, b, c]) => [order[a], order[b], order[c]]
  );
}
function triangulateMeshFace(positions, face) {
  if (face.length < 3) return [];
  const pts = face.map((vi) => positions[vi]).filter(Boolean);
  if (pts.length !== face.length) return [];
  return triangulateFaceLoop(pts);
}

// src/mesh/HalfEdgeMesh.ts
var HalfEdgeMesh = class _HalfEdgeMesh {
  positions = [];
  faces = [];
  faceColors = [];
  uvs = [];
  faceUvIndices = [];
  cornerColors = [];
  faceColorIndices = [];
  faceGroups = [];
  halfEdges = [];
  topologyLocked = false;
  static fromObject(obj) {
    const mesh = new _HalfEdgeMesh();
    mesh.positions = obj.positions.map((p) => ({ ...p }));
    mesh.faces = obj.faces.map((f) => [...f]);
    mesh.faceColors = [...obj.faceColors];
    mesh.uvs = (obj.uvs ?? []).map((u) => ({ ...u }));
    mesh.faceUvIndices = (obj.faceUvIndices ?? []).map((f) => [...f]);
    mesh.cornerColors = (obj.cornerColors ?? []).map((c) => [...c]);
    mesh.faceColorIndices = (obj.faceColorIndices ?? []).map((f) => [...f]);
    mesh.faceGroups = (obj.faceGroups ?? []).map((g) => [...g]);
    mesh.topologyLocked = obj.topologyLocked;
    mesh.buildHalfEdges();
    return mesh;
  }
  toObject(id, name, meta = {}) {
    return {
      id,
      name,
      positions: this.positions.map((p) => ({ ...p })),
      faces: this.faces.map((f) => [...f]),
      faceColors: [...this.faceColors],
      uvs: this.uvs.length > 0 ? this.uvs.map((u) => ({ ...u })) : meta.uvs,
      faceUvIndices: this.faceUvIndices.length > 0 ? this.faceUvIndices.map((f) => [...f]) : meta.faceUvIndices,
      cornerColors: this.cornerColors.length > 0 ? this.cornerColors.map((c) => [...c]) : meta.cornerColors,
      faceColorIndices: this.faceColorIndices.length > 0 ? this.faceColorIndices.map((f) => [...f]) : meta.faceColorIndices,
      material: meta.material ? cloneMaterial(meta.material) : void 0,
      faceMaterials: meta.faceMaterials?.map((m) => m ? cloneMaterial(m) : null),
      faceGroups: this.faceGroups.length > 0 ? this.faceGroups.map((g) => [...g]) : meta.faceGroups,
      topologyLocked: this.topologyLocked,
      polyBudget: meta.polyBudget ?? 128,
      polyBudgetMode: meta.polyBudgetMode ?? "strict",
      smoothShading: meta.smoothShading ?? false,
      subdEnabled: meta.subdEnabled,
      subdLevels: meta.subdLevels,
      facetExaggeration: meta.facetExaggeration ?? 0,
      color: meta.color ?? 7261173,
      uvMappingMode: meta.uvMappingMode,
      uvAutoPacked: meta.uvAutoPacked,
      uvLayoutVersion: meta.uvLayoutVersion,
      pivot: meta.pivot ? { ...meta.pivot } : void 0,
      transform: meta.transform ? {
        position: { ...meta.transform.position },
        rotation: { ...meta.transform.rotation },
        scale: { ...meta.transform.scale }
      } : void 0,
      sketchSource: meta.sketchSource ? {
        ...meta.sketchSource,
        relative: meta.sketchSource.relative.map((p) => ({ ...p })),
        center: { ...meta.sketchSource.center }
      } : void 0,
      vectorSource: meta.vectorSource ? {
        ...meta.vectorSource,
        path: {
          ...meta.vectorSource.path,
          anchors: meta.vectorSource.path.anchors.map((a) => ({
            ...a,
            position: { ...a.position },
            inHandle: a.inHandle ? { ...a.inHandle } : null,
            outHandle: a.outHandle ? { ...a.outHandle } : null
          })),
          shapeParams: meta.vectorSource.path.shapeParams ? { ...meta.vectorSource.path.shapeParams } : void 0
        }
      } : void 0,
      latheSource: meta.latheSource ? {
        ...meta.latheSource,
        points: meta.latheSource.points.map((point) => ({ ...point }))
      } : void 0,
      primitiveSource: meta.primitiveSource
    };
  }
  buildHalfEdges() {
    this.halfEdges = [];
    const edgeMap = /* @__PURE__ */ new Map();
    for (let fi = 0; fi < this.faces.length; fi++) {
      const face = this.faces[fi];
      const n = face.length;
      for (let i = 0; i < n; i++) {
        const origin = face[i];
        const dest = face[(i + 1) % n];
        const heIdx = this.halfEdges.length;
        this.halfEdges.push({ origin, twin: -1, next: -1, face: fi });
        const key = `${origin}_${dest}`;
        const reverseKey = `${dest}_${origin}`;
        if (edgeMap.has(reverseKey)) {
          const twinIdx = edgeMap.get(reverseKey);
          this.halfEdges[heIdx].twin = twinIdx;
          this.halfEdges[twinIdx].twin = heIdx;
        }
        edgeMap.set(key, heIdx);
      }
    }
    for (let fi = 0; fi < this.faces.length; fi++) {
      const face = this.faces[fi];
      const n = face.length;
      for (let i = 0; i < n; i++) {
        const origin = face[i];
        const dest = face[(i + 1) % n];
        const key = `${origin}_${dest}`;
        const heIdx = edgeMap.get(key);
        const nextDest = face[(i + 2) % n];
        const nextKey = `${dest}_${nextDest}`;
        this.halfEdges[heIdx].next = edgeMap.get(nextKey);
      }
    }
  }
  getVertexNeighbors(vi) {
    if (this.halfEdges.length > 0) {
      const neighbors2 = /* @__PURE__ */ new Set();
      for (let i = 0; i < this.halfEdges.length; i++) {
        const he = this.halfEdges[i];
        if (he.origin !== vi) continue;
        const next = this.halfEdges[he.next];
        if (next) neighbors2.add(next.origin);
      }
      if (neighbors2.size > 0) return [...neighbors2];
    }
    const neighbors = /* @__PURE__ */ new Set();
    for (const face of this.faces) {
      const idx = face.indexOf(vi);
      if (idx >= 0) {
        neighbors.add(face[(idx + face.length - 1) % face.length]);
        neighbors.add(face[(idx + 1) % face.length]);
      }
    }
    return [...neighbors];
  }
  getVertexNormal(vi, averaged = true) {
    const fromHe = getVertexNormalFromHalfEdges(this, vi, averaged);
    if (fromHe) return fromHe;
    let sum = { x: 0, y: 0, z: 0 };
    let any = false;
    let first = null;
    for (const face of this.faces) {
      const idx = face.indexOf(vi);
      if (idx < 0) continue;
      const a = this.positions[face[idx]];
      const b = this.positions[face[(idx + 1) % face.length]];
      const c = this.positions[face[(idx + face.length - 1) % face.length]];
      const n = faceNormal(a, b, c);
      if (!averaged) return n;
      const e1 = normalize3(sub3(b, a));
      const e2 = normalize3(sub3(c, a));
      const cos = Math.max(-1, Math.min(1, e1.x * e2.x + e1.y * e2.y + e1.z * e2.z));
      const angle = Math.acos(cos);
      sum = add3(sum, scale3(n, angle));
      if (!any) {
        first = n;
        any = true;
      }
    }
    if (!any) return { x: 0, y: 1, z: 0 };
    if (!averaged) return first ?? { x: 0, y: 1, z: 0 };
    return normalize3(sum);
  }
  toMeshData(flatShading = true, facetExaggeration = 0) {
    const positions = [];
    const indices = [];
    const uvs = [];
    const faceColors = [];
    const sourceVertexIndices = [];
    const sourceFaceIndices = [];
    const sourceTriIndices = [];
    const hasUv = this.uvs.length > 0 && this.faceUvIndices.length === this.faces.length;
    const hasCornerColors = this.cornerColors.length > 0 && this.faceColorIndices.length === this.faces.length;
    const topoNormals = !flatShading || facetExaggeration > 0 ? buildTopologyVertexNormals(this) : null;
    if (flatShading) {
      for (let fi = 0; fi < this.faces.length; fi++) {
        const face = this.faces[fi];
        const color = this.faceColors[fi] ?? 7261173;
        const r = (color >> 16 & 255) / 255;
        const g = (color >> 8 & 255) / 255;
        const b = (color & 255) / 255;
        const pushCornerColor = (ci) => {
          if (hasCornerColors) {
            const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0;
            const c = this.cornerColors[poolIdx] ?? [r, g, b, 1];
            faceColors.push(c[0], c[1], c[2]);
          } else {
            faceColors.push(r, g, b);
          }
        };
        const baseIdx = positions.length / 3;
        const verts = face.map((vi) => this.positions[vi]);
        let normal = faceNormal(verts[0], verts[1], verts[2]);
        if (facetExaggeration > 0 && topoNormals) {
          const avgNormal = normalize3(
            verts.reduce((acc, _, i) => {
              const n = topoNormals[face[i]] ?? { x: 0, y: 1, z: 0 };
              return add3(acc, n);
            }, { x: 0, y: 0, z: 0 })
          );
          normal = normalize3(
            add3(
              scale3(normal, 1 - facetExaggeration),
              scale3(sub3(normal, avgNormal), facetExaggeration)
            )
          );
        }
        for (let ci = 0; ci < verts.length; ci++) {
          const v = verts[ci];
          positions.push(v.x, v.y, v.z);
          sourceVertexIndices.push(face[ci]);
          if (hasUv) {
            const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0;
            const uv = this.uvs[uvIdx] ?? { u: 0, v: 0 };
            uvs.push(uv.u, uv.v);
          }
          pushCornerColor(ci);
        }
        const tris = triangulateMeshFace(this.positions, face);
        let ti = 0;
        for (const [a, b2, c] of tris) {
          indices.push(baseIdx + a, baseIdx + b2, baseIdx + c);
          sourceFaceIndices.push(fi);
          sourceTriIndices.push(ti++);
        }
      }
      return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        uvs: uvs.length > 0 ? new Float32Array(uvs) : void 0,
        faceColors: new Float32Array(faceColors),
        sourceVertexIndices: new Uint32Array(sourceVertexIndices),
        sourceFaceIndices: new Uint32Array(sourceFaceIndices),
        sourceTriIndices: new Uint32Array(sourceTriIndices),
        flatShading
      };
    }
    const normals = [];
    const weldMap = /* @__PURE__ */ new Map();
    const weldKey = (vi, fi, ci) => {
      if (!hasUv && !hasCornerColors) return String(vi);
      if (hasCornerColors) {
        const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0;
        const uvIdx = hasUv ? this.faceUvIndices[fi]?.[ci] ?? 0 : 0;
        return `${vi}:${poolIdx}:${uvIdx}`;
      }
      if (hasUv) {
        const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0;
        return `${vi}:${uvIdx}`;
      }
      const faceColor = this.faceColors[fi] ?? 0;
      return `${vi}:${faceColor}`;
    };
    const getOrCreateCorner = (vi, fi, ci) => {
      const key = weldKey(vi, fi, ci);
      const existing = weldMap.get(key);
      if (existing !== void 0) return existing;
      const renderIdx = positions.length / 3;
      const p = this.positions[vi];
      positions.push(p.x, p.y, p.z);
      sourceVertexIndices.push(vi);
      const n = topoNormals[vi];
      normals.push(n.x, n.y, n.z);
      if (hasUv) {
        const uvIdx = this.faceUvIndices[fi]?.[ci] ?? 0;
        const uv = this.uvs[uvIdx] ?? { u: 0, v: 0 };
        uvs.push(uv.u, uv.v);
      }
      const color = this.faceColors[fi] ?? 7261173;
      const r = (color >> 16 & 255) / 255;
      const g = (color >> 8 & 255) / 255;
      const b = (color & 255) / 255;
      if (hasCornerColors) {
        const poolIdx = this.faceColorIndices[fi]?.[ci] ?? 0;
        const c = this.cornerColors[poolIdx] ?? [r, g, b, 1];
        faceColors.push(c[0], c[1], c[2]);
      } else {
        faceColors.push(r, g, b);
      }
      weldMap.set(key, renderIdx);
      return renderIdx;
    };
    for (let fi = 0; fi < this.faces.length; fi++) {
      const face = this.faces[fi];
      const cornerIdx2 = [];
      for (let ci = 0; ci < face.length; ci++) {
        cornerIdx2.push(getOrCreateCorner(face[ci], fi, ci));
      }
      const tris = triangulateMeshFace(this.positions, face);
      for (const [a, b, c] of tris) {
        indices.push(cornerIdx2[a], cornerIdx2[b], cornerIdx2[c]);
      }
    }
    return {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      uvs: uvs.length > 0 ? new Float32Array(uvs) : void 0,
      faceColors: new Float32Array(faceColors),
      normals: new Float32Array(normals),
      sourceVertexIndices: new Uint32Array(sourceVertexIndices),
      flatShading
    };
  }
  vertexCount() {
    return this.positions.length;
  }
  faceCount() {
    return this.faces.length;
  }
};

// src/scene/viewTypes.ts
var ORTHO_VIEW_OPTIONS = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left Side" },
  { id: "right", label: "Right Side" }
];
var VIEWPORT_VIEW_OPTIONS = [
  ...ORTHO_VIEW_OPTIONS,
  { id: "perspective", label: "Perspective" }
];
function normalizeViewType(view) {
  if (view === "side") return "right";
  return view;
}
function isOrthoView(view) {
  return view === "front" || view === "back" || view === "left" || view === "right" || view === "top" || view === "bottom" || view === "side";
}

// src/primitives/viewAxes.ts
var VIEW_AXIS_TABLE = {
  front: { h: 0, v: 1, d: 2, hSign: 1, vSign: 1, dSign: 1 },
  back: { h: 0, v: 1, d: 2, hSign: -1, vSign: 1, dSign: -1 },
  right: { h: 2, v: 1, d: 0, hSign: -1, vSign: 1, dSign: 1 },
  left: { h: 2, v: 1, d: 0, hSign: 1, vSign: 1, dSign: -1 },
  top: { h: 0, v: 2, d: 1, hSign: 1, vSign: -1, dSign: 1 },
  bottom: { h: 0, v: 2, d: 1, hSign: 1, vSign: 1, dSign: -1 }
};
function orthoViewFromLegacy(view) {
  if (!isOrthoView(view)) return null;
  return normalizeViewType(view);
}
function axisComponent(v, axis) {
  if (axis === 0) return v.x;
  if (axis === 1) return v.y;
  return v.z;
}
function setAxisComponent(v, axis, value) {
  const out = { ...v };
  if (axis === 0) out.x = value;
  else if (axis === 1) out.y = value;
  else out.z = value;
  return out;
}
function worldToPlanePoint(view, world) {
  const { h, v, hSign, vSign } = VIEW_AXIS_TABLE[view];
  return {
    x: axisComponent(world, h) * hSign,
    y: axisComponent(world, v) * vSign
  };
}
function planePointToWorld(view, planeX, planeY, depthAlongView) {
  const { h, v, d, hSign, vSign, dSign } = VIEW_AXIS_TABLE[view];
  let w = { x: 0, y: 0, z: 0 };
  w = setAxisComponent(w, h, planeX * hSign);
  w = setAxisComponent(w, v, planeY * vSign);
  w = setAxisComponent(w, d, depthAlongView * dSign);
  return w;
}

// src/stroke/worldProjection.ts
function viewProjectionMirrorsWinding(view) {
  switch (view) {
    case "top":
    case "right":
    case "bottom":
    case "left":
      return true;
    default:
      return false;
  }
}
function strokeFrameNormal(frame) {
  const { right, up } = frame;
  const x = right.y * up.z - right.z * up.y;
  const y = right.z * up.x - right.x * up.z;
  const z = right.x * up.y - right.y * up.x;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}
function planePointToStrokeFrame(x, y, frame, localZ = 0) {
  const n = strokeFrameNormal(frame);
  return {
    x: frame.origin.x + frame.right.x * x + frame.up.x * y + n.x * localZ,
    y: frame.origin.y + frame.right.y * x + frame.up.y * y + n.y * localZ,
    z: frame.origin.z + frame.right.z * x + frame.up.z * y + n.z * localZ
  };
}
function projectMeshToView(mesh, view, depth, frame) {
  const ortho = orthoViewFromLegacy(view);
  for (const p of mesh.positions) {
    const planeX = p.x;
    const planeY = p.y;
    const localZ = p.z;
    if (ortho) {
      const w = planePointToWorld(ortho, planeX, planeY, depth + localZ);
      p.x = w.x;
      p.y = w.y;
      p.z = w.z;
      continue;
    }
    if (frame) {
      const w = planePointToStrokeFrame(planeX, planeY, frame, localZ);
      p.x = w.x;
      p.y = w.y;
      p.z = w.z;
      continue;
    }
    p.x = planeX;
    p.y = planeY;
    p.z = depth + localZ;
  }
  if (ortho && viewProjectionMirrorsWinding(ortho)) {
    flipMeshFaces(mesh);
  }
}
function planePathToWorld(path, view, depth, frame) {
  const ortho = orthoViewFromLegacy(view);
  if (ortho) {
    return path.map((p) => planePointToWorld(ortho, p.x, p.y, depth));
  }
  if (frame) {
    return path.map((p) => planePointToStrokeFrame(p.x, p.y, frame, 0));
  }
  return path.map((p) => ({ x: p.x, y: p.y, z: depth }));
}
function offsetMeshInPlane(mesh, cx, cy) {
  for (const p of mesh.positions) {
    p.x += cx;
    p.y += cy;
  }
}

// src/stroke/rdp.ts
function rdpSimplify(points, tolerance) {
  if (points.length <= 2) return [...points];
  let maxDist = 0;
  let maxIndex = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), tolerance);
    const right = rdpSimplify(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[end]];
}
function curvatureSampleProfile(profile, minAngleDeg, maxPoints) {
  if (profile.length <= 2) return [...profile];
  const minAngle = minAngleDeg * Math.PI / 180;
  const result = [profile[0]];
  for (let i = 1; i < profile.length - 1; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];
    const next = profile[i + 1];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (len1 < 1e-10 || len2 < 1e-10) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle > minAngle) {
      result.push(curr);
    }
  }
  result.push(profile[profile.length - 1]);
  if (maxPoints && result.length > maxPoints) {
    return capOpenPolylineByCurvature(result, maxPoints);
  }
  return result;
}
function capOpenPolylineByCurvature(points, maxPoints) {
  if (points.length <= maxPoints) return points.map((p) => ({ ...p }));
  if (maxPoints < 2) return [{ ...points[0] }, { ...points[points.length - 1] }];
  const interiorBudget = maxPoints - 2;
  const scored = [];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    let score = 0;
    if (len1 > 1e-10 && len2 > 1e-10) {
      const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
      score = Math.acos(Math.max(-1, Math.min(1, dot)));
      score += 0.15 * Math.min(len1, len2);
    }
    scored.push({ i, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const keep = /* @__PURE__ */ new Set([0, points.length - 1]);
  for (const s of scored.slice(0, interiorBudget)) keep.add(s.i);
  return points.filter((_, i) => keep.has(i)).map((p) => ({ ...p }));
}
function curvatureSampleClosedLoop(loop, minAngleDeg, maxPoints) {
  let working = [...loop];
  if (working.length >= 2) {
    const first = working[0];
    const last = working[working.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.01) {
      working = working.slice(0, -1);
    }
  }
  if (working.length <= 3) {
    return capClosedLoopPoints(working, maxPoints);
  }
  const minAngle = minAngleDeg * Math.PI / 180;
  const n = working.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = working[(i + n - 1) % n];
    const curr = working[i];
    const next = working[(i + 1) % n];
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    if (len1 < 1e-10 || len2 < 1e-10) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle > minAngle) {
      result.push(curr);
    }
  }
  if (result.length < 3) {
    return capClosedLoopPoints(working, maxPoints);
  }
  return capClosedLoopPoints(result, maxPoints);
}
function capClosedLoopPoints(points, maxPoints) {
  if (!maxPoints || points.length <= maxPoints) return [...points];
  const scored = points.map((p, i) => {
    const prevPt = points[(i + points.length - 1) % points.length];
    const nextPt = points[(i + 1) % points.length];
    const v1 = { x: p.x - prevPt.x, y: p.y - prevPt.y };
    const v2 = { x: nextPt.x - p.x, y: nextPt.y - p.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    let score = 0;
    if (len1 > 1e-10 && len2 > 1e-10) {
      const dot = (v1.x * v2.x + v1.y * v2.y) / (len1 * len2);
      score = Math.acos(Math.max(-1, Math.min(1, dot)));
    }
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const keep = /* @__PURE__ */ new Set();
  for (const s of scored.slice(0, maxPoints)) keep.add(s.i);
  return points.filter((_, i) => keep.has(i));
}

// src/stroke/latheProfile.ts
var LATHE_RADIAL_SEGMENTS = 24;
var LATHE_MIN_ANGLE_DEG = 4;
var LATHE_MAX_PROFILE_RINGS = 48;
var LATHE_PROFILE_RDP_TOLERANCE = 0.18;
var LATHE_PROFILE_DEDUPE = 0.1;
var LATHE_POLY_BUDGET = LATHE_RADIAL_SEGMENTS * LATHE_MAX_PROFILE_RINGS;
function isLatheViewSupported(view) {
  return isOrthoView(view);
}
function strokeToLatheProfile(points, options = {}) {
  if (points.length < 2) return null;
  const axisH = Math.min(...points.map((p) => p.x));
  const raw = [];
  for (const p of points) {
    const radius = Math.max(0, p.x - axisH);
    const height = p.y;
    const last = raw[raw.length - 1];
    if (last && Math.hypot(radius - last.x, height - last.y) < LATHE_PROFILE_DEDUPE) continue;
    raw.push({ x: radius, y: height });
  }
  if (raw.length < 2) return null;
  const smoothing = Math.max(0, Math.min(1, options.smoothing ?? 0.15));
  const tolerance = LATHE_PROFILE_RDP_TOLERANCE + smoothing * 0.82;
  const maxRings = Math.max(4, Math.min(128, Math.round(options.maxProfileRings ?? LATHE_MAX_PROFILE_RINGS)));
  const silhouette = rdpSimplify(raw, tolerance);
  const profile = curvatureSampleProfile(
    silhouette.length >= 2 ? silhouette : raw,
    LATHE_MIN_ANGLE_DEG + smoothing * 8,
    maxRings
  );
  if (profile.length < 2) return null;
  return { profile, axisH };
}
function latheAxisHFromPoints(points) {
  if (points.length === 0) return 0;
  return Math.min(...points.map((p) => p.x));
}
function latheRevolutionAxis(view, axisH, depth) {
  const ortho = orthoViewFromLegacy(view);
  if (!ortho) {
    return { origin: { x: axisH, y: 0, z: depth }, direction: { x: 0, y: 1, z: 0 } };
  }
  const origin = planePointToWorld(ortho, axisH, 0, depth);
  const above = planePointToWorld(ortho, axisH, 1, depth);
  const dx = above.x - origin.x;
  const dy = above.y - origin.y;
  const dz = above.z - origin.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    origin,
    direction: { x: dx / len, y: dy / len, z: dz / len }
  };
}

// src/mesh/MeshBuilder.ts
function computeFaceNormal(positions, face) {
  const a = positions[face[0]];
  const b = positions[face[1]];
  const c = positions[face[2]];
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx
  };
}
function meshCentroid(positions) {
  if (positions.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of positions) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = positions.length;
  return { x: x / n, y: y / n, z: z / n };
}

// src/mesh/meshWinding.ts
function faceNormalForWinding(positions, face) {
  if (face.length === 3) {
    return computeFaceNormal(positions, [face[0], face[1], face[2]]);
  }
  return newellNormal(face.map((vi) => positions[vi]));
}
function meshSignedVolume(mesh) {
  let volume = 0;
  for (const face of mesh.faces) {
    if (face.length < 3) continue;
    const tris = triangulateMeshFace(mesh.positions, face);
    for (const [ia, ib, ic] of tris) {
      const a = mesh.positions[face[ia]];
      const b = mesh.positions[face[ib]];
      const c = mesh.positions[face[ic]];
      volume += a.x * (b.y * c.z - c.y * b.z) + b.x * (c.y * a.z - a.y * c.z) + c.x * (a.y * b.z - b.y * a.z);
    }
  }
  return volume / 6;
}
function flipMeshFaces(mesh) {
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    mesh.faces[fi].reverse();
    const uvs = mesh.faceUvIndices[fi];
    if (uvs) uvs.reverse();
  }
  mesh.buildHalfEdges();
}
function reorientFacesOutward(mesh, refPoint) {
  if (mesh.faces.length === 0) return mesh;
  const center = refPoint ?? meshCentroid(mesh.positions);
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    if (face.length < 3) continue;
    const n = faceNormalForWinding(mesh.positions, face);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const vi of face) {
      const p = mesh.positions[vi];
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    const inv = 1 / face.length;
    cx *= inv;
    cy *= inv;
    cz *= inv;
    const dx = cx - center.x;
    const dy = cy - center.y;
    const dz = cz - center.z;
    const dot = n.x * dx + n.y * dy + n.z * dz;
    if (dot < 0) {
      face.reverse();
      const uv = mesh.faceUvIndices[fi];
      if (uv) uv.reverse();
    }
  }
  mesh.buildHalfEdges();
  return mesh;
}
function ensurePositiveVolume(mesh) {
  if (meshSignedVolume(mesh) < 0) flipMeshFaces(mesh);
  return mesh;
}
function orientLatheMeshOutward(mesh, view, axisH, depth) {
  if (mesh.faces.length === 0) return mesh;
  const { origin, direction } = latheRevolutionAxis(view, axisH, depth);
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of mesh.positions) {
    const t = (p.x - origin.x) * direction.x + (p.y - origin.y) * direction.y + (p.z - origin.z) * direction.z;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const tMid = (tMin + tMax) * 0.5;
  const ref = {
    x: origin.x + direction.x * tMid,
    y: origin.y + direction.y * tMid,
    z: origin.z + direction.z * tMid
  };
  return reorientFacesOutward(mesh, ref);
}
function ensureClosedMeshOutward(mesh) {
  if (countNakedEdges(mesh) > 0) {
    mesh.buildHalfEdges();
    return mesh;
  }
  if (meshSignedVolume(mesh) < 0) flipMeshFaces(mesh);
  return mesh;
}
function countNakedEdges(mesh) {
  const edgeFaceCount = /* @__PURE__ */ new Map();
  for (const face of mesh.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1);
    }
  }
  let naked = 0;
  for (const count of edgeFaceCount.values()) {
    if (count === 1) naked++;
  }
  return naked;
}

// src/mesh/softInflate.ts
function polygonCentroid(poly) {
  const area = signedArea(poly);
  if (Math.abs(area) < 1e-6) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}
function stitchRingsUpward(mesh, ringLower, ringUpper, color) {
  if (ringLower.length === 1 && ringUpper.length > 1) {
    const pole = ringLower[0];
    for (let si = 0; si < ringUpper.length; si++) {
      const next = (si + 1) % ringUpper.length;
      mesh.faces.push([pole, ringUpper[next], ringUpper[si]]);
      mesh.faceColors.push(color);
    }
    return;
  }
  if (ringUpper.length === 1 && ringLower.length > 1) {
    const pole = ringUpper[0];
    for (let si = 0; si < ringLower.length; si++) {
      const next = (si + 1) % ringLower.length;
      mesh.faces.push([pole, ringLower[si], ringLower[next]]);
      mesh.faceColors.push(color);
    }
    return;
  }
  if (ringLower.length > 1 && ringUpper.length > 1) {
    const segments = ringLower.length;
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments;
      const lo0 = ringLower[si];
      const lo1 = ringLower[next];
      const hi0 = ringUpper[si];
      const hi1 = ringUpper[next];
      mesh.faces.push([lo0, lo1, hi1, hi0]);
      mesh.faceColors.push(color);
    }
  }
}
function generateSoftInflateDome(polygon, options) {
  const poly = ensureCCW(polygon);
  const n = poly.length;
  if (n < 3) return new HalfEdgeMesh();
  const { x: cx, y: cy } = polygonCentroid(poly);
  const depth = Math.max(4, options.depth);
  const color = options.color ?? 0;
  const sliceCount = Math.max(4, options.rings ?? 6);
  const mesh = new HalfEdgeMesh();
  const slices = [];
  const inflation = Math.max(0, Math.min(1, options.inflation ?? 0.65));
  const capScale = 0.34 + (0.08 - 0.34) * inflation;
  const profilePower = 1.45 + (0.52 - 1.45) * inflation;
  for (let si = 0; si <= sliceCount; si++) {
    const t = si / sliceCount;
    const theta = Math.PI * (1 - t);
    const z = depth / 2 * Math.cos(theta);
    const scale = capScale + (1 - capScale) * Math.pow(Math.sin(theta), profilePower);
    const ring = [];
    for (let i = 0; i < n; i++) {
      const vi = mesh.positions.length;
      mesh.positions.push({
        x: cx + (poly[i].x - cx) * scale,
        y: cy + (poly[i].y - cy) * scale,
        z
      });
      ring.push(vi);
    }
    slices.push({ ring, z });
  }
  for (let i = 0; i < slices.length - 1; i++) {
    const lower = slices[i];
    const upper = slices[i + 1];
    if (lower.z <= upper.z) {
      stitchRingsUpward(mesh, lower.ring, upper.ring, color);
    } else {
      stitchRingsUpward(mesh, upper.ring, lower.ring, color);
    }
  }
  const bottom = slices[0].ring;
  const top = slices[slices.length - 1].ring;
  const innerScale = capScale * 0.22;
  const bottomInner = [];
  const topInner = [];
  for (let i = 0; i < n; i++) {
    bottomInner.push(mesh.positions.length);
    mesh.positions.push({
      x: cx + (poly[i].x - cx) * innerScale,
      y: cy + (poly[i].y - cy) * innerScale,
      z: -depth / 2
    });
    topInner.push(mesh.positions.length);
    mesh.positions.push({
      x: cx + (poly[i].x - cx) * innerScale,
      y: cy + (poly[i].y - cy) * innerScale,
      z: depth / 2
    });
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    mesh.faces.push([bottom[i], bottomInner[i], bottomInner[next], bottom[next]]);
    mesh.faceColors.push(color);
    mesh.faces.push([top[i], top[next], topInner[next], topInner[i]]);
    mesh.faceColors.push(color);
  }
  const bottomCenter = mesh.positions.length;
  mesh.positions.push({ x: cx, y: cy, z: -depth / 2 });
  const topCenter = mesh.positions.length;
  mesh.positions.push({ x: cx, y: cy, z: depth / 2 });
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    mesh.faces.push([bottomCenter, bottomInner[next], bottomInner[i]]);
    mesh.faceColors.push(color);
    mesh.faces.push([topCenter, topInner[i], topInner[next]]);
    mesh.faceColors.push(color);
  }
  mesh.buildHalfEdges();
  return ensurePositiveVolume(mesh);
}

// src/mesh/extrusion.ts
function faceNormal3(mesh, face) {
  const a = mesh.positions[face[0]];
  const b = mesh.positions[face[1]];
  const c = mesh.positions[face[2]];
  return normalize3({
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  });
}
function faceCentroid3(mesh, face) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vi of face) {
    const p = mesh.positions[vi];
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = face.length;
  return { x: x / n, y: y / n, z: z / n };
}
function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function closestPointOnPolyline(path, point) {
  let bestDist = Infinity;
  let bestClosest = path[0] ?? { x: 0, y: 0, z: 0 };
  let bestTangent = { x: 1, y: 0, z: 0 };
  let bestParam = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const len2 = abx * abx + aby * aby + abz * abz;
    if (len2 < 1e-12) continue;
    let t = ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const cz = a.z + abz * t;
    const d = Math.hypot(point.x - cx, point.y - cy, point.z - cz);
    if (d < bestDist) {
      bestDist = d;
      bestClosest = { x: cx, y: cy, z: cz };
      bestTangent = normalize3({ x: abx, y: aby, z: abz });
      bestParam = i + t;
    }
  }
  return { closest: bestClosest, tangent: bestTangent, param: bestParam };
}
function estimateTubeRadius(mesh, pathStart, pathEnd) {
  let maxR = 1;
  for (const p of mesh.positions) {
    const dStart = dist3(p, pathStart);
    const dEnd = dist3(p, pathEnd);
    maxR = Math.max(maxR, Math.min(dStart, dEnd));
  }
  return maxR;
}
function orientTubeFacesOutward(mesh, pathWorld, closed = false) {
  if (pathWorld.length < 2 || mesh.faces.length === 0) return;
  const pathStart = pathWorld[0];
  const pathEnd = pathWorld[pathWorld.length - 1];
  const startTan = pathWorld.length >= 2 ? normalize3({
    x: pathWorld[1].x - pathStart.x,
    y: pathWorld[1].y - pathStart.y,
    z: pathWorld[1].z - pathStart.z
  }) : { x: 1, y: 0, z: 0 };
  const endTan = pathWorld.length >= 2 ? normalize3({
    x: pathEnd.x - pathWorld[pathWorld.length - 2].x,
    y: pathEnd.y - pathWorld[pathWorld.length - 2].y,
    z: pathEnd.z - pathWorld[pathWorld.length - 2].z
  }) : startTan;
  const endRadius = estimateTubeRadius(mesh, pathStart, pathEnd);
  for (const face of mesh.faces) {
    if (face.length < 3) continue;
    const center = faceCentroid3(mesh, face);
    const normal = faceNormal3(mesh, face);
    const { closest, param } = closestPointOnPolyline(pathWorld, center);
    const distStart = dist3(center, pathStart);
    const distEnd = dist3(center, pathEnd);
    const atStart = !closed && param < 0.15 && distStart <= endRadius * 1.25;
    const atEnd = !closed && param > pathWorld.length - 1.15 && distEnd <= endRadius * 1.25;
    if (atStart && distStart <= distEnd) {
      const out = { x: -startTan.x, y: -startTan.y, z: -startTan.z };
      const dot2 = normal.x * out.x + normal.y * out.y + normal.z * out.z;
      if (dot2 < 0) face.reverse();
      continue;
    }
    if (atEnd && distEnd <= distStart) {
      const dot2 = normal.x * endTan.x + normal.y * endTan.y + normal.z * endTan.z;
      if (dot2 < 0) face.reverse();
      continue;
    }
    const rx = center.x - closest.x;
    const ry = center.y - closest.y;
    const rz = center.z - closest.z;
    const rLen = Math.hypot(rx, ry, rz);
    if (rLen < 1e-6) continue;
    const dot = (normal.x * rx + normal.y * ry + normal.z * rz) / rLen;
    if (dot < 0) face.reverse();
  }
  mesh.buildHalfEdges();
}
function vec2To3(p) {
  return { x: p.x, y: p.y, z: 0 };
}
function rotateAroundAxis(v, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const kxv = cross3(axis, v);
  const kdv = dot3(axis, v);
  return add3(add3(scale3(v, cos), scale3(kxv, sin)), scale3(axis, kdv * (1 - cos)));
}
function buildSweepFrames(curve, closed) {
  const n = curve.length;
  if (n < 2) return [];
  const frames = [];
  const firstTan = normalize3(sub3(curve[1], curve[0]));
  const seed = Math.abs(firstTan.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let normal = normalize3(cross3(seed, firstTan));
  let binormal = normalize3(cross3(firstTan, normal));
  frames.push({ center: curve[0], tangent: firstTan, normal, binormal });
  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1];
    const prevTan = prev.tangent;
    const nextIdx = closed && i === n - 1 ? 0 : Math.min(i + 1, n - 1);
    const prevIdx = i === 1 ? closed ? n - 1 : 0 : i - 1;
    const tangent2 = normalize3(sub3(curve[nextIdx], curve[prevIdx]));
    const axis = cross3(prevTan, tangent2);
    const axisLen = Math.hypot(axis.x, axis.y, axis.z);
    let rotatedNormal = prev.normal;
    if (axisLen > 1e-6) {
      const a = normalize3(axis);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot3(prevTan, tangent2))));
      rotatedNormal = rotateAroundAxis(rotatedNormal, a, angle);
    }
    normal = normalize3(sub3(rotatedNormal, scale3(tangent2, dot3(rotatedNormal, tangent2))));
    binormal = normalize3(cross3(tangent2, normal));
    frames.push({ center: curve[i], tangent: tangent2, normal, binormal });
  }
  return frames;
}
function addRing(mesh, frame, radius, segments, scale = 1) {
  const ring = [];
  const r = radius * scale;
  for (let si = 0; si < segments; si++) {
    const angle = si / segments * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offset = add3(scale3(frame.normal, cos * r), scale3(frame.binormal, sin * r));
    ring.push(mesh.positions.length);
    mesh.positions.push(add3(frame.center, offset));
  }
  return ring;
}
function connectRingQuads(mesh, ringA, ringB, segments, color) {
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    mesh.faces.push([ringA[si], ringA[next], ringB[next], ringB[si]]);
    mesh.faceColors.push(color);
  }
}
function fanPoleRing(mesh, pole, ring, outward, color) {
  const segments = ring.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    if (outward) {
      mesh.faces.push([pole, ring[si], ring[next]]);
    } else {
      mesh.faces.push([pole, ring[next], ring[si]]);
    }
    mesh.faceColors.push(color);
  }
}
function appendFlatEndCap(mesh, equatorRing, atStart, color) {
  const face = atStart ? [...equatorRing].reverse() : [...equatorRing];
  mesh.faces.push(face);
  mesh.faceColors.push(color);
}
function appendSweepEndCap(mesh, frame, equatorRing, radius, segments, hemiRings, atStart, color) {
  if (hemiRings <= 0) {
    appendFlatEndCap(mesh, equatorRing, atStart, color);
    return;
  }
  const bands = Math.max(1, hemiRings);
  const sign = atStart ? -1 : 1;
  const pole = add3(frame.center, scale3(frame.tangent, sign * radius));
  const poleIdx = mesh.positions.length;
  mesh.positions.push(pole);
  const capRings = [];
  for (let ri = bands - 1; ri >= 1; ri--) {
    const t = ri / bands;
    const scale = Math.sqrt(Math.max(0, t * (2 - t)));
    const ringCenter = add3(frame.center, scale3(frame.tangent, sign * radius * (1 - t)));
    const capFrame = { ...frame, center: ringCenter };
    capRings.push(addRing(mesh, capFrame, radius, segments, scale));
  }
  capRings.push(equatorRing);
  if (capRings.length > 1) {
    fanPoleRing(mesh, poleIdx, capRings[0], !atStart, color);
    for (let ri = 0; ri < capRings.length - 1; ri++) {
      connectRingQuads(mesh, capRings[ri], capRings[ri + 1], segments, color);
    }
  } else {
    fanPoleRing(mesh, poleIdx, equatorRing, !atStart, color);
  }
}
function appendStyledSweepEndCap(mesh, frame, ring, radius, segments, atStart, color, style) {
  if (style === "open") return;
  if (style === "flat") {
    appendFlatEndCap(mesh, ring, atStart, color);
    return;
  }
  const roundRings = Math.max(4, Math.min(10, Math.ceil(segments * 0.6)));
  appendSweepEndCap(mesh, frame, ring, radius, segments, style === "round" ? roundRings : 1, atStart, color);
}
function normalizeClosedSpine(path, closed) {
  if (!closed || path.length < 2) return path;
  const first = path[0];
  const last = path[path.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) < 0.5) {
    return path.slice(0, -1);
  }
  return path;
}
function generateCapsuleSweep(path, options) {
  const {
    radius,
    radialSegments,
    minAngleDeg = 15,
    closed = false,
    hemiRings = 0,
    color = 16098926,
    preserveSpine = false,
    startCap,
    endCap
  } = options;
  const mesh = new HalfEdgeMesh();
  const segments = Math.max(3, Math.min(24, radialSegments));
  if (path.length < 2 || radius < 1e-6) return mesh;
  const spine = normalizeClosedSpine(path, closed);
  const sampled = preserveSpine ? spine : curvatureSampleProfile(spine, minAngleDeg);
  if (sampled.length < 2) return mesh;
  const curve = sampled.map(vec2To3);
  const frames = buildSweepFrames(curve, closed);
  if (frames.length < 2) return mesh;
  const ringVerts = frames.map((frame) => addRing(mesh, frame, radius, segments));
  const ringCount = ringVerts.length;
  for (let ri = 0; ri < ringCount - 1; ri++) {
    connectRingQuads(mesh, ringVerts[ri], ringVerts[ri + 1], segments, color);
  }
  if (closed && ringCount > 2) {
    connectRingQuads(mesh, ringVerts[ringCount - 1], ringVerts[0], segments, color);
  } else if (ringCount >= 1) {
    const legacyStyle = hemiRings > 0 ? "round" : "flat";
    appendStyledSweepEndCap(mesh, frames[0], ringVerts[0], radius, segments, true, color, startCap ?? legacyStyle);
    appendStyledSweepEndCap(mesh, frames[ringCount - 1], ringVerts[ringCount - 1], radius, segments, false, color, endCap ?? legacyStyle);
  }
  mesh.buildHalfEdges();
  return mesh;
}
function pushTubeUv(mesh, u, v) {
  const idx = mesh.uvs.length;
  mesh.uvs.push({ u, v });
  return idx;
}
function arcLengthParams(curve) {
  const params = [0];
  let total = 0;
  for (let i = 1; i < curve.length; i++) {
    total += dist3(curve[i], curve[i - 1]);
    params.push(total);
  }
  const denom = Math.max(total, 1e-8);
  return params.map((p) => p / denom);
}
function tubeTaperScale(t, taperFraction = 0.35) {
  const f = Math.max(0.05, Math.min(0.49, taperFraction));
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < f) {
    const x = clamped / f;
    return x * x * (3 - 2 * x);
  }
  if (clamped > 1 - f) {
    const x = (1 - clamped) / f;
    return x * x * (3 - 2 * x);
  }
  return 1;
}
function generateTaperedPointedTube(path, options) {
  const {
    radius,
    radialSegments,
    minAngleDeg = 15,
    color = 8309665,
    preserveSpine = true,
    taperFraction = 0.35,
    tipStyle = "pointed",
    radiusScaleAtT
  } = options;
  const mesh = new HalfEdgeMesh();
  const segments = Math.max(6, Math.min(8, radialSegments));
  if (path.length < 2 || radius < 1e-6) return mesh;
  const sampled = preserveSpine ? path : curvatureSampleProfile(path, minAngleDeg);
  if (sampled.length < 2) return mesh;
  const curve = sampled.map(vec2To3);
  const frames = buildSweepFrames(curve, false);
  if (frames.length < 2) return mesh;
  const ts = arcLengthParams(curve);
  const square = tipStyle === "square";
  const scaleAt = radiusScaleAtT ?? (square ? () => 1 : (t) => tubeTaperScale(t, taperFraction));
  const minR = square ? radius : Math.max(1e-3, radius * 2e-3);
  const radii = ts.map((t) => Math.max(minR, radius * scaleAt(t)));
  let startPole = -1;
  let endPole = -1;
  if (!square) {
    startPole = mesh.positions.length;
    mesh.positions.push({ ...frames[0].center });
    endPole = mesh.positions.length;
    mesh.positions.push({ ...frames[frames.length - 1].center });
  }
  const ringVerts = frames.map((frame, i) => addRing(mesh, frame, radii[i], segments));
  const ringCount = ringVerts.length;
  if (square) {
    {
      const ring = ringVerts[0];
      const uvIndices = ring.map((_, si) => pushTubeUv(mesh, 0, si / segments));
      mesh.faces.push([...ring].reverse());
      mesh.faceUvIndices.push([...uvIndices].reverse());
      mesh.faceColors.push(color);
    }
    {
      const last = ringCount - 1;
      const ring = ringVerts[last];
      const uvIndices = ring.map((_, si) => pushTubeUv(mesh, 1, si / segments));
      mesh.faces.push([...ring]);
      mesh.faceUvIndices.push(uvIndices);
      mesh.faceColors.push(color);
    }
  } else {
    {
      const u = 0;
      for (let si = 0; si < segments; si++) {
        const next = (si + 1) % segments;
        const v0 = si / segments;
        const v1 = next / segments;
        const uvP = pushTubeUv(mesh, u, (v0 + v1) * 0.5);
        const uvA = pushTubeUv(mesh, u, v0);
        const uvB = pushTubeUv(mesh, u, v1);
        mesh.faces.push([startPole, ringVerts[0][next], ringVerts[0][si]]);
        mesh.faceUvIndices.push([uvP, uvB, uvA]);
        mesh.faceColors.push(color);
      }
    }
    {
      const u = 1;
      const last = ringCount - 1;
      for (let si = 0; si < segments; si++) {
        const next = (si + 1) % segments;
        const v0 = si / segments;
        const v1 = next / segments;
        const uvP = pushTubeUv(mesh, u, (v0 + v1) * 0.5);
        const uvA = pushTubeUv(mesh, u, v0);
        const uvB = pushTubeUv(mesh, u, v1);
        mesh.faces.push([endPole, ringVerts[last][si], ringVerts[last][next]]);
        mesh.faceUvIndices.push([uvP, uvA, uvB]);
        mesh.faceColors.push(color);
      }
    }
  }
  for (let ri = 0; ri < ringCount - 1; ri++) {
    const u0 = ts[ri];
    const u1 = ts[ri + 1];
    const ringA = ringVerts[ri];
    const ringB = ringVerts[ri + 1];
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments;
      const v0 = si / segments;
      const v1 = next / segments;
      const uv0 = pushTubeUv(mesh, u0, v0);
      const uv1 = pushTubeUv(mesh, u0, v1);
      const uv22 = pushTubeUv(mesh, u1, v1);
      const uv3 = pushTubeUv(mesh, u1, v0);
      mesh.faces.push([ringA[si], ringA[next], ringB[next], ringB[si]]);
      mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
      mesh.faceColors.push(color);
    }
  }
  mesh.buildHalfEdges();
  return mesh;
}

// src/mesh/silhouetteExtrude.ts
function strokeToFlatOutline(points, halfWidth) {
  if (points.length < 2 || halfWidth <= 0) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const curr = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let len = Math.hypot(tx, ty);
    if (len < 1e-8) {
      tx = next.x - curr.x;
      ty = next.y - curr.y;
      len = Math.hypot(tx, ty) || 1;
    }
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    left.push({ x: curr.x + nx * halfWidth, y: curr.y + ny * halfWidth });
    right.push({ x: curr.x - nx * halfWidth, y: curr.y - ny * halfWidth });
  }
  return [...left, ...right.reverse()];
}
function extrudeSilhouette(polygon, options) {
  const { depth, color = 8309665 } = options;
  const poly = ensureCCW(polygon);
  const mesh = new HalfEdgeMesh();
  const half = depth / 2;
  if (poly.length < 3) return mesh;
  const n = poly.length;
  const frontOffset = 0;
  const backOffset = n;
  for (let i = 0; i < n; i++) {
    mesh.positions.push({ x: poly[i].x, y: poly[i].y, z: half });
  }
  for (let i = 0; i < n; i++) {
    mesh.positions.push({ x: poly[i].x, y: poly[i].y, z: -half });
  }
  const frontCap = [];
  const backCap = [];
  for (let i = 0; i < n; i++) {
    frontCap.push(frontOffset + i);
    backCap.push(backOffset + (n - 1 - i));
  }
  mesh.faces.push(frontCap, backCap);
  mesh.faceColors.push(color, color);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f0 = frontOffset + i;
    const f1 = frontOffset + j;
    const b0 = backOffset + i;
    const b1 = backOffset + j;
    mesh.faces.push([f0, b0, b1, f1]);
    mesh.faceColors.push(color);
  }
  mesh.buildHalfEdges();
  return ensurePositiveVolume(mesh);
}
function mergeMeshes(meshes, color = 8309665) {
  const result = new HalfEdgeMesh();
  for (const m of meshes) {
    const base = result.positions.length;
    for (const p of m.positions) {
      result.positions.push({ ...p });
    }
    for (let fi = 0; fi < m.faces.length; fi++) {
      result.faces.push(m.faces[fi].map((vi) => vi + base));
      result.faceColors.push(m.faceColors[fi] ?? color);
    }
  }
  result.buildHalfEdges();
  return result;
}
function generateConcaveSilhouette(lobes, depth, color = 8309665) {
  const parts = lobes.map(
    (lobe) => extrudeSilhouette(lobe, { depth, color })
  );
  return parts.length === 1 ? parts[0] : mergeMeshes(parts, color);
}

// src/mesh/hairRibbon.ts
function pushUv(mesh, u, v) {
  const idx = mesh.uvs.length;
  mesh.uvs.push({ u, v });
  return idx;
}
function hairTaperFactor(t, taperFraction = 0.35) {
  const f = Math.max(0.05, Math.min(0.49, taperFraction));
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < f) {
    const x = clamped / f;
    return x * x * (3 - 2 * x);
  }
  if (clamped > 1 - f) {
    const x = (1 - clamped) / f;
    return x * x * (3 - 2 * x);
  }
  return 1;
}
function cumulativeArcLengths(points) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(total);
  }
  return { lengths, total };
}
function strokeToTaperedRibbon(points, halfWidth, taperFraction = 0.35, tipStyle = "pointed", startTipStyle = tipStyle, endTipStyle = tipStyle) {
  if (points.length < 2 || halfWidth <= 0) return null;
  const { lengths, total } = cumulativeArcLengths(points);
  const denom = Math.max(total, 1e-8);
  const left = [];
  const right = [];
  const halfWidths = [];
  const arcT = [];
  const minHalf = Math.max(1e-3, halfWidth * 2e-3);
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const curr = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    let len = Math.hypot(tx, ty);
    if (len < 1e-8) {
      tx = next.x - curr.x;
      ty = next.y - curr.y;
      len = Math.hypot(tx, ty) || 1;
    }
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const t = lengths[i] / denom;
    const startFactor = startTipStyle === "square" || t >= taperFraction ? 1 : hairTaperFactor(Math.min(t, 0.5), taperFraction);
    const endFactor = endTipStyle === "square" || t <= 1 - taperFraction ? 1 : hairTaperFactor(Math.max(t, 0.5), taperFraction);
    const hw = Math.max(minHalf, halfWidth * Math.min(startFactor, endFactor));
    halfWidths.push(hw);
    arcT.push(t);
    left.push({ x: curr.x + nx * hw, y: curr.y + ny * hw });
    right.push({ x: curr.x - nx * hw, y: curr.y - ny * hw });
  }
  return { left, right, halfWidths, arcT };
}
function generateFlatHairRibbon(left, right, arcT, color) {
  const mesh = new HalfEdgeMesh();
  const n = left.length;
  const L = [];
  const R = [];
  for (let i = 0; i < n; i++) {
    const lp = left[i];
    const rp = right[i];
    L.push(mesh.positions.length);
    mesh.positions.push({ x: lp.x, y: lp.y, z: 0 });
    R.push(mesh.positions.length);
    mesh.positions.push({ x: rp.x, y: rp.y, z: 0 });
  }
  for (let i = 0; i < n - 1; i++) {
    const u0 = arcT[i];
    const u1 = arcT[i + 1];
    const uv0 = pushUv(mesh, u0, 0);
    const uv1 = pushUv(mesh, u0, 1);
    const uv22 = pushUv(mesh, u1, 1);
    const uv3 = pushUv(mesh, u1, 0);
    mesh.faces.push([L[i], R[i], R[i + 1], L[i + 1]]);
    mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
    mesh.faceColors.push(color);
    mesh.faces.push([L[i], L[i + 1], R[i + 1], R[i]]);
    mesh.faceUvIndices.push([uv0, uv3, uv22, uv1]);
    mesh.faceColors.push(color);
  }
  mesh.buildHalfEdges();
  return mesh;
}
function generateHairRibbon(points, options) {
  const {
    halfWidth,
    depth,
    color = 8309665,
    taperFraction = 0.35,
    tipStyle = "pointed",
    startTipStyle = tipStyle,
    endTipStyle = tipStyle,
    flat = false
  } = options;
  const ribbon = strokeToTaperedRibbon(points, halfWidth, taperFraction, tipStyle, startTipStyle, endTipStyle);
  if (!ribbon || ribbon.left.length < 2) return new HalfEdgeMesh();
  const { left, right, arcT } = ribbon;
  const useFlat = flat || Math.abs(depth) < 1e-4;
  if (useFlat) {
    return generateFlatHairRibbon(left, right, arcT, color);
  }
  const mesh = new HalfEdgeMesh();
  const n = left.length;
  const half = (Math.sign(depth) || 1) * Math.max(0.4, Math.abs(depth) / 2);
  const lf = [];
  const rf = [];
  const lb = [];
  const rb = [];
  for (let i = 0; i < n; i++) {
    const L = left[i];
    const R = right[i];
    lf.push(mesh.positions.length);
    mesh.positions.push({ x: L.x, y: L.y, z: half });
    rf.push(mesh.positions.length);
    mesh.positions.push({ x: R.x, y: R.y, z: half });
    lb.push(mesh.positions.length);
    mesh.positions.push({ x: L.x, y: L.y, z: -half });
    rb.push(mesh.positions.length);
    mesh.positions.push({ x: R.x, y: R.y, z: -half });
  }
  for (let i = 0; i < n - 1; i++) {
    const u0 = arcT[i];
    const u1 = arcT[i + 1];
    {
      const uv0 = pushUv(mesh, u0, 0);
      const uv1 = pushUv(mesh, u0, 1);
      const uv22 = pushUv(mesh, u1, 1);
      const uv3 = pushUv(mesh, u1, 0);
      mesh.faces.push([lf[i], rf[i], rf[i + 1], lf[i + 1]]);
      mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
      mesh.faceColors.push(color);
    }
    {
      const uv0 = pushUv(mesh, u0, 0);
      const uv1 = pushUv(mesh, u1, 0);
      const uv22 = pushUv(mesh, u1, 1);
      const uv3 = pushUv(mesh, u0, 1);
      mesh.faces.push([lb[i], lb[i + 1], rb[i + 1], rb[i]]);
      mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
      mesh.faceColors.push(color);
    }
    {
      const uv0 = pushUv(mesh, u0, 0);
      const uv1 = pushUv(mesh, u1, 0);
      const uv22 = pushUv(mesh, u1, 0.15);
      const uv3 = pushUv(mesh, u0, 0.15);
      mesh.faces.push([lf[i], lf[i + 1], lb[i + 1], lb[i]]);
      mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
      mesh.faceColors.push(color);
    }
    {
      const uv0 = pushUv(mesh, u0, 0.85);
      const uv1 = pushUv(mesh, u0, 1);
      const uv22 = pushUv(mesh, u1, 1);
      const uv3 = pushUv(mesh, u1, 0.85);
      mesh.faces.push([rf[i], rb[i], rb[i + 1], rf[i + 1]]);
      mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
      mesh.faceColors.push(color);
    }
  }
  {
    const u = 0;
    const uv0 = pushUv(mesh, u, 0);
    const uv1 = pushUv(mesh, u, 1);
    const uv22 = pushUv(mesh, u, 1);
    const uv3 = pushUv(mesh, u, 0);
    mesh.faces.push([lf[0], lb[0], rb[0], rf[0]]);
    mesh.faceUvIndices.push([uv0, uv3, uv22, uv1]);
    mesh.faceColors.push(color);
  }
  {
    const u = 1;
    const last = n - 1;
    const uv0 = pushUv(mesh, u, 0);
    const uv1 = pushUv(mesh, u, 1);
    const uv22 = pushUv(mesh, u, 1);
    const uv3 = pushUv(mesh, u, 0);
    mesh.faces.push([lf[last], rf[last], rb[last], lb[last]]);
    mesh.faceUvIndices.push([uv0, uv1, uv22, uv3]);
    mesh.faceColors.push(color);
  }
  mesh.buildHalfEdges();
  return ensurePositiveVolume(mesh);
}
function hairHalfWidthFromBrush(brushDensity, style) {
  if (style === "strip") {
    return Math.max(4, Math.min(18, brushDensity * 0.55));
  }
  return Math.max(3, Math.min(14, brushDensity * 0.48));
}
function roundedHairRadiusFromBrush(brushDensity) {
  return Math.max(2.5, Math.min(12, brushDensity * 0.42));
}
function resolveRoundedHairRadius(extrudeAmount, brushDensity) {
  const base = roundedHairRadiusFromBrush(brushDensity);
  if (extrudeAmount == null || !Number.isFinite(extrudeAmount)) return base;
  const scale = Math.max(0.5, Math.min(2.2, Math.abs(extrudeAmount) / 12));
  return Math.max(2, Math.min(16, base * scale));
}
function hairDepthFromBrush(brushDensity, style) {
  if (style === "strip") return 0;
  return Math.max(1.2, Math.min(4, brushDensity * 0.1));
}
function resolveHairDepth(extrudeAmount, brushDensity, style) {
  if (style === "strip") return 0;
  if (extrudeAmount != null && Number.isFinite(extrudeAmount)) {
    const mag = Math.max(0.8, Math.abs(extrudeAmount));
    return (Math.sign(extrudeAmount) || 1) * mag;
  }
  return hairDepthFromBrush(brushDensity, style);
}

// src/stroke/strokeCapture.ts
function resampleUniform(points, spacing) {
  if (points.length < 2) return [...points];
  const minSpacing = Math.max(spacing, 0.5);
  const result = [{ ...points[0] }];
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const segLen = dist2(prev, curr);
    if (segLen < minSpacing) continue;
    const steps = Math.floor(segLen / minSpacing);
    for (let s = 1; s <= steps; s++) {
      const t = s * minSpacing / segLen;
      result.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t
      });
    }
    result.push({ ...curr });
    prev = curr;
  }
  return result;
}
function resampleUniformClosed(points, spacing) {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const minSpacing = Math.max(spacing, 0.5);
  const verts = points.map((p) => ({ ...p }));
  const n = verts.length;
  const edgeLen = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const len = dist2(verts[i], verts[(i + 1) % n]);
    edgeLen.push(len);
    perimeter += len;
  }
  if (perimeter < minSpacing) return verts;
  const sampleCount = Math.max(8, Math.round(perimeter / minSpacing));
  const stepLen = perimeter / sampleCount;
  const result = [];
  let currEdgeIdx = 0;
  let currEdgePos = 0;
  for (let s = 0; s < sampleCount; s++) {
    const targetDist = s * stepLen;
    let accum = 0;
    for (let j = 0; j < currEdgeIdx; j++) {
      accum += edgeLen[j];
    }
    accum += currEdgePos;
    let needed = targetDist - accum;
    while (needed > 1e-9) {
      const len2 = edgeLen[currEdgeIdx];
      const remainingOnEdge = len2 - currEdgePos;
      if (needed <= remainingOnEdge) {
        currEdgePos += needed;
        needed = 0;
      } else {
        needed -= remainingOnEdge;
        currEdgeIdx = (currEdgeIdx + 1) % n;
        currEdgePos = 0;
      }
    }
    const a = verts[currEdgeIdx];
    const b = verts[(currEdgeIdx + 1) % n];
    const len = edgeLen[currEdgeIdx];
    const t = len > 1e-8 ? clamp01(currEdgePos / len) : 0;
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    });
  }
  return result;
}
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}
function totalCurvature(points) {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const v1 = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
    const v2 = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-8 || l2 < 1e-8) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    total += Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  return total;
}
function fitEllipse(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let rx = 0;
  let ry = 0;
  for (const p of points) {
    rx = Math.max(rx, Math.abs(p.x - cx));
    ry = Math.max(ry, Math.abs(p.y - cy));
  }
  rx = Math.max(rx, 0.5);
  ry = Math.max(ry, 0.5);
  const aspectRatio = Math.min(rx, ry) / Math.max(rx, ry);
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variance = radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length;
  const circularity = 1 - Math.sqrt(variance) / (meanR + 1e-6);
  return { cx, cy, rx, ry, aspectRatio, circularity };
}

// src/stroke/strokeClassifier.ts
function classifyStroke(points, closeThreshold) {
  if (points.length < 3) return "open";
  const start = points[0];
  const end = points[points.length - 1];
  return dist2(start, end) <= closeThreshold ? "closed" : "open";
}
function detectRadialSymmetry(points, threshold = 0.75) {
  if (points.length < 6) return false;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const radii = points.map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  if (mean < 1e-6) return false;
  const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length;
  const cv = Math.sqrt(variance) / mean;
  const area = polygonArea2D(points);
  const circleArea = Math.PI * mean * mean;
  const areaRatio = Math.min(area, circleArea) / Math.max(area, circleArea);
  return cv < 0.35 && areaRatio > threshold;
}
function extractLatheProfile(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const profile = [];
  for (const p of sorted) {
    const r = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    profile.push({ x: r, y: p.y - cy });
  }
  const deduped = [];
  for (const p of profile) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(p.y - last.y) > 0.5) {
      deduped.push(p);
    }
  }
  return deduped;
}

// src/vector/vectorPenLimits.ts
var VECTOR_PEN_POLY_BUDGET = 384;
var VECTOR_PEN_MAX_BOUNDARY_VERTS = 24;
var VECTOR_PEN_MAX_PATH_SAMPLES = 18;
var VECTOR_PEN_RADIAL_SEGMENTS = 8;
var VECTOR_PEN_MIN_ANGLE_DEG = 12;
var VECTOR_PEN_FLATTEN_ERROR = 0.75;
var VECTOR_PEN_LATHE_FLATTEN_ERROR = 0.38;

// src/mesh/organicRemesh.ts
function vertexCurvature(mesh, vi) {
  const neighbors = mesh.getVertexNeighbors(vi);
  if (neighbors.length < 2) return 0;
  const p = mesh.positions[vi];
  let total = 0;
  for (let i = 0; i < neighbors.length; i++) {
    const a = mesh.positions[neighbors[i]];
    const b = mesh.positions[neighbors[(i + 1) % neighbors.length]];
    const v1 = sub3(a, p);
    const v2 = sub3(b, p);
    const l1 = Math.hypot(v1.x, v1.y, v1.z);
    const l2 = Math.hypot(v2.x, v2.y, v2.z);
    if (l1 < 1e-8 || l2 < 1e-8) continue;
    const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2);
    total += Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  return total / neighbors.length;
}
function simplifyCurvatureAware(mesh, targetVertexCount) {
  if (mesh.vertexCount() <= targetVertexCount) return mesh;
  const result = HalfEdgeMesh.fromObject(mesh.toObject("temp", "temp"));
  let curvatures = result.positions.map((_, vi) => vertexCurvature(result, vi));
  while (result.vertexCount() > targetVertexCount && result.faces.length > 0) {
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
    for (const face of result.faces) {
      for (let i = 0; i < face.length; i++) {
        const v0 = face[i];
        const v1 = face[(i + 1) % face.length];
        const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p0 = result.positions[v0];
        const p1 = result.positions[v1];
        const position = {
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2,
          z: (p0.z + p1.z) / 2
        };
        let cost = 0;
        for (const face2 of result.faces) {
          if (!face2.includes(v0) && !face2.includes(v1)) continue;
          const verts = face2.map((vi) => result.positions[vi]);
          const a = verts[0];
          const b = verts[1];
          const c = verts[2];
          const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
          const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
          const normal = {
            x: ab.y * ac.z - ab.z * ac.y,
            y: ab.z * ac.x - ab.x * ac.z,
            z: ab.x * ac.y - ab.y * ac.x
          };
          const len = Math.hypot(normal.x, normal.y, normal.z);
          if (len < 1e-10) continue;
          const d = -(normal.x * a.x + normal.y * a.y + normal.z * a.z) / len;
          const dist4 = Math.abs(
            (normal.x * position.x + normal.y * position.y + normal.z * position.z) / len + d
          );
          cost += dist4 * dist4;
        }
        const curv = (curvatures[v0] + curvatures[v1]) * 0.5;
        cost /= 0.15 + curv;
        edges.push({ v0, v1, cost, position });
      }
    }
    if (edges.length === 0) break;
    edges.sort((a, b) => a.cost - b.cost);
    const best = edges[0];
    result.positions[best.v0] = best.position;
    result.faces = result.faces.map((face) => {
      const newFace = face.map((vi) => vi === best.v1 ? best.v0 : vi).filter((vi, idx, arr) => arr.indexOf(vi) === idx);
      return newFace.length >= 3 ? newFace : null;
    }).filter((f) => f !== null);
    const uniqueVerts = /* @__PURE__ */ new Set();
    for (const face of result.faces) {
      for (const vi of face) uniqueVerts.add(vi);
    }
    const oldToNew = /* @__PURE__ */ new Map();
    const newPositions = [];
    for (const vi of [...uniqueVerts].sort((a, b) => a - b)) {
      oldToNew.set(vi, newPositions.length);
      newPositions.push({ ...result.positions[vi] });
    }
    result.positions = newPositions;
    result.faces = result.faces.map((face) => face.map((vi) => oldToNew.get(vi)));
    if (result.faceColors.length > result.faces.length) {
      result.faceColors = result.faceColors.slice(0, result.faces.length);
    }
    result.buildHalfEdges();
    curvatures = result.positions.map((_, vi) => vertexCurvature(result, vi));
  }
  result.buildHalfEdges();
  return result;
}
function relaxOrganicMesh(mesh, strength = 0.18, iterations = 1) {
  for (let iter = 0; iter < iterations; iter++) {
    const originals = mesh.positions.map((p) => ({ ...p }));
    for (let vi = 0; vi < mesh.positions.length; vi++) {
      const neighbors = mesh.getVertexNeighbors(vi);
      if (neighbors.length === 0) continue;
      const avg = neighbors.reduce(
        (acc, ni) => add3(acc, originals[ni]),
        { x: 0, y: 0, z: 0 }
      );
      avg.x /= neighbors.length;
      avg.y /= neighbors.length;
      avg.z /= neighbors.length;
      mesh.positions[vi] = {
        x: originals[vi].x + (avg.x - originals[vi].x) * strength,
        y: originals[vi].y + (avg.y - originals[vi].y) * strength,
        z: originals[vi].z + (avg.z - originals[vi].z) * strength * 0.35
      };
    }
  }
}
function remeshOrganic(mesh, targetVerts, relaxStrength = 0.12) {
  let result = mesh;
  if (result.vertexCount() > targetVerts) {
    result = simplifyCurvatureAware(result, targetVerts);
  }
  relaxOrganicMesh(result, relaxStrength, 1);
  result.buildHalfEdges();
  return result;
}

// src/mesh/simplification.ts
function computeQuadricError(mesh, v0, v1) {
  const p0 = mesh.positions[v0];
  const p1 = mesh.positions[v1];
  const position = {
    x: (p0.x + p1.x) / 2,
    y: (p0.y + p1.y) / 2,
    z: (p0.z + p1.z) / 2
  };
  let cost = 0;
  for (const face of mesh.faces) {
    if (!face.includes(v0) && !face.includes(v1)) continue;
    const verts = face.map((vi) => mesh.positions[vi]);
    if (verts.length < 3) continue;
    const a = verts[0];
    const b = verts[1];
    const c = verts[2];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normal = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x
    };
    const len = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2);
    if (len < 1e-10) continue;
    const d = -(normal.x * a.x + normal.y * a.y + normal.z * a.z) / len;
    const dist4 = Math.abs(
      (normal.x * position.x + normal.y * position.y + normal.z * position.z) / len + d
    );
    cost += dist4 * dist4;
  }
  return { cost, position };
}
function simplifyMesh(mesh, targetVertexCount) {
  if (mesh.topologyLocked) return mesh;
  if (mesh.vertexCount() <= targetVertexCount) return mesh;
  const result = HalfEdgeMesh.fromObject(mesh.toObject("temp", "temp"));
  while (result.vertexCount() > targetVertexCount && result.faces.length > 0) {
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
    for (const face of result.faces) {
      for (let i = 0; i < face.length; i++) {
        const v0 = face[i];
        const v1 = face[(i + 1) % face.length];
        const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { cost, position } = computeQuadricError(result, v0, v1);
        edges.push({ v0, v1, cost, position });
      }
    }
    if (edges.length === 0) break;
    edges.sort((a, b) => a.cost - b.cost);
    const best = edges[0];
    result.positions[best.v0] = best.position;
    const remap = /* @__PURE__ */ new Map();
    remap.set(best.v1, best.v0);
    for (let i = 0; i < result.positions.length; i++) {
      if (remap.has(i)) continue;
    }
    result.faces = result.faces.map((face) => {
      const newFace = face.map((vi) => vi === best.v1 ? best.v0 : vi).filter((vi, idx, arr) => arr.indexOf(vi) === idx);
      return newFace.length >= 3 ? newFace : null;
    }).filter((f) => f !== null);
    const uniqueVerts = /* @__PURE__ */ new Set();
    for (const face of result.faces) {
      for (const vi of face) uniqueVerts.add(vi);
    }
    const oldToNew = /* @__PURE__ */ new Map();
    const newPositions = [];
    for (const vi of [...uniqueVerts].sort((a, b) => a - b)) {
      oldToNew.set(vi, newPositions.length);
      newPositions.push({ ...result.positions[vi] });
    }
    result.positions = newPositions;
    result.faces = result.faces.map((face) => face.map((vi) => oldToNew.get(vi)));
    if (result.faceColors.length > result.faces.length) {
      result.faceColors = result.faceColors.slice(0, result.faces.length);
    }
  }
  result.buildHalfEdges();
  return result;
}

// src/mesh/meshSelection.ts
import * as THREE2 from "three";
function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
var _startM2 = new THREE2.Matrix4();
var _curM2 = new THREE2.Matrix4();
var _w = new THREE2.Vector3();

// src/mesh/meshOps.ts
import * as THREE3 from "three";

// src/uv/uvEditing.ts
function uvBoundsFromIndices(uvs, indices) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const i of indices) {
    const uv = uvs[i];
    if (!uv) continue;
    minU = Math.min(minU, uv.u);
    minV = Math.min(minV, uv.v);
    maxU = Math.max(maxU, uv.u);
    maxV = Math.max(maxV, uv.v);
  }
  if (!Number.isFinite(minU)) return { minU: 0, minV: 0, maxU: 1, maxV: 1 };
  return { minU, minV, maxU, maxV };
}
function uvBoundsCenter(b) {
  return { u: (b.minU + b.maxU) / 2, v: (b.minV + b.maxV) / 2 };
}
function translateUVs(uvs, indices, du, dv) {
  for (const i of indices) {
    const uv = uvs[i];
    if (!uv) continue;
    uv.u += du;
    uv.v += dv;
  }
}
function scaleUVsFromCenter(uvs, indices, scaleU, scaleV, pivot) {
  const b = uvBoundsFromIndices(uvs, indices);
  const p = pivot ?? uvBoundsCenter(b);
  for (const i of indices) {
    const uv = uvs[i];
    if (!uv) continue;
    uv.u = p.u + (uv.u - p.u) * scaleU;
    uv.v = p.v + (uv.v - p.v) * scaleV;
  }
}
function fitUVsToUnitSquare(uvs, indices) {
  const b = uvBoundsFromIndices(uvs, indices);
  const w = b.maxU - b.minU || 1;
  const h = b.maxV - b.minV || 1;
  for (const i of indices) {
    const uv = uvs[i];
    if (!uv) continue;
    uv.u = (uv.u - b.minU) / w;
    uv.v = (uv.v - b.minV) / h;
  }
}
function fitUVsAspectPreserving(uvs, indices, targetSize = 1, padding = 0) {
  if (indices.length === 0) return;
  const b = uvBoundsFromIndices(uvs, indices);
  const w = b.maxU - b.minU;
  const h = b.maxV - b.minV;
  const avail = Math.max(targetSize - padding * 2, 1e-8);
  const span = Math.max(w, h, 1e-12);
  const scale = avail / span;
  const outW = w * scale;
  const outH = h * scale;
  const offsetU = padding + (avail - outW) / 2;
  const offsetV = padding + (avail - outH) / 2;
  for (const i of indices) {
    const uv = uvs[i];
    if (!uv) continue;
    uv.u = offsetU + (uv.u - b.minU) * scale;
    uv.v = offsetV + (uv.v - b.minV) * scale;
  }
}
var BLOCKBENCH_SLOTS = {
  "+y": { col: 1, row: 0, label: "Up" },
  "-y": { col: 1, row: 2, label: "Down" },
  "-x": { col: 0, row: 1, label: "Left" },
  "+z": { col: 1, row: 1, label: "Front" },
  "+x": { col: 2, row: 1, label: "Right" },
  "-z": { col: 3, row: 1, label: "Back" }
};
function classifyFaceNormalBucket(n) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? "+y" : "-y";
  if (az >= ax && az >= ay) return n.z >= 0 ? "+z" : "-z";
  return n.x >= 0 ? "+x" : "-x";
}
function planarProjectFaceUVs(faceNormal2, faceCorners3D2) {
  const n = faceNormal2;
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let uAxis = "x";
  let vAxis = "y";
  if (ax >= ay && ax >= az) {
    uAxis = "y";
    vAxis = "z";
  } else if (ay >= ax && ay >= az) {
    uAxis = "x";
    vAxis = "z";
  } else {
    uAxis = "x";
    vAxis = "y";
  }
  const raw = faceCorners3D2.map((p) => ({
    u: p[uAxis],
    v: p[vAxis]
  }));
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const p of raw) {
    minU = Math.min(minU, p.u);
    minV = Math.min(minV, p.v);
    maxU = Math.max(maxU, p.u);
    maxV = Math.max(maxV, p.v);
  }
  const w = maxU - minU || 1;
  const h = maxV - minV || 1;
  return raw.map((p) => ({ u: (p.u - minU) / w, v: (p.v - minV) / h }));
}

// src/uv/uvTypes.ts
function uv2(u, v) {
  return { u, v };
}
function cloneUv2(uv) {
  return { u: uv.u, v: uv.v };
}

// src/mesh/faceGroups.ts
var DEFAULT_ANGLE_DEG = 3;
var COPLANAR_EPS = 1e-4;
var SPATIAL_QUANT = 1e-5;
function dot32(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function faceCentroid(obj, fi) {
  const face = obj.faces[fi];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vi of face) {
    const p = obj.positions[vi];
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = face.length || 1;
  return { x: x / n, y: y / n, z: z / n };
}
function facePlane(obj, fi) {
  const normal = faceNormal3D(obj, fi);
  const c = faceCentroid(obj, fi);
  return { normal, d: dot32(normal, c) };
}
function isCoplanarWith(obj, seedFi, otherFi) {
  const { normal, d } = facePlane(obj, seedFi);
  for (const vi of obj.faces[otherFi]) {
    const p = obj.positions[vi];
    if (Math.abs(dot32(normal, p) - d) > COPLANAR_EPS) return false;
  }
  return true;
}
function posKey(obj, vi) {
  const p = obj.positions[vi];
  if (!p) return `${vi}`;
  const q = (v) => Math.round(v / SPATIAL_QUANT);
  return `${q(p.x)},${q(p.y)},${q(p.z)}`;
}
function spatialEdgeKey(obj, a, b) {
  const ka = posKey(obj, a);
  const kb = posKey(obj, b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
function buildEdgeAdjacency(obj) {
  const edgeToFaces = /* @__PURE__ */ new Map();
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      const list = edgeToFaces.get(key);
      if (list) list.push(fi);
      else edgeToFaces.set(key, [fi]);
    }
  }
  return edgeToFaces;
}
function buildSpatialEdgeAdjacency(obj) {
  const edgeToFaces = /* @__PURE__ */ new Map();
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = spatialEdgeKey(obj, a, b);
      const list = edgeToFaces.get(key);
      if (list) list.push(fi);
      else edgeToFaces.set(key, [fi]);
    }
  }
  return edgeToFaces;
}
function neighborsOf(obj, fi, edgeToFaces, spatialEdgeToFaces) {
  const face = obj.faces[fi];
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    for (const other of edgeToFaces.get(edgeKey(a, b)) ?? []) {
      if (other !== fi) out.add(other);
    }
    for (const other of spatialEdgeToFaces.get(spatialEdgeKey(obj, a, b)) ?? []) {
      if (other !== fi) out.add(other);
    }
  }
  return [...out];
}
function finalizeGroupMap(obj, groups, normals) {
  const n = obj.faces.length;
  const faceToGroup = new Array(n).fill(-1);
  const outGroups = [];
  for (let gid = 0; gid < groups.length; gid++) {
    const members = groups[gid].filter((fi) => fi >= 0 && fi < n);
    if (members.length === 0) continue;
    const id = outGroups.length;
    for (const fi of members) faceToGroup[fi] = id;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const fi of members) {
      const nm = normals[fi] ?? faceNormal3D(obj, fi);
      nx += nm.x;
      ny += nm.y;
      nz += nm.z;
      const c = faceCentroid(obj, fi);
      cx += c.x;
      cy += c.y;
      cz += c.z;
    }
    const m = members.length || 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    outGroups.push({
      id,
      faceIndices: members,
      normal: { x: nx / len, y: ny / len, z: nz / len },
      centroid: { x: cx / m, y: cy / m, z: cz / m }
    });
  }
  for (let fi = 0; fi < n; fi++) {
    if (faceToGroup[fi] < 0) {
      const id = outGroups.length;
      faceToGroup[fi] = id;
      const nm = normals[fi] ?? faceNormal3D(obj, fi);
      outGroups.push({
        id,
        faceIndices: [fi],
        normal: nm,
        centroid: faceCentroid(obj, fi)
      });
    }
  }
  return { groups: outGroups, faceToGroup };
}
function computeFaceGroups(obj, angleDeg = DEFAULT_ANGLE_DEG) {
  const n = obj.faces.length;
  if (n === 0) return { groups: [], faceToGroup: [] };
  const cosThreshold = Math.cos(angleDeg * Math.PI / 180);
  const normals = obj.faces.map((_, fi) => faceNormal3D(obj, fi));
  const edgeToFaces = buildEdgeAdjacency(obj);
  const spatialEdgeToFaces = buildSpatialEdgeAdjacency(obj);
  const faceToGroup = new Array(n).fill(-1);
  const groups = [];
  for (let seed = 0; seed < n; seed++) {
    if (faceToGroup[seed] >= 0) continue;
    const gid = groups.length;
    const seedNormal = normals[seed];
    const stack = [seed];
    const members = [];
    faceToGroup[seed] = gid;
    while (stack.length > 0) {
      const cur = stack.pop();
      members.push(cur);
      for (const nb of neighborsOf(obj, cur, edgeToFaces, spatialEdgeToFaces)) {
        if (faceToGroup[nb] >= 0) continue;
        if (dot32(seedNormal, normals[nb]) < cosThreshold) continue;
        if (!isCoplanarWith(obj, seed, nb)) continue;
        faceToGroup[nb] = gid;
        stack.push(nb);
      }
    }
    groups.push(members);
  }
  return finalizeGroupMap(obj, groups, normals);
}

// src/uv/uvPack.ts
function splitUvIslandsForPacking(uvs, faceUvIndices, islands) {
  for (const islandFaces of islands) {
    const uiMap = /* @__PURE__ */ new Map();
    for (const fi of islandFaces) {
      const uvIdx = faceUvIndices[fi];
      if (!uvIdx) continue;
      for (let i = 0; i < uvIdx.length; i++) {
        const oldUi = uvIdx[i];
        if (oldUi === void 0) continue;
        let newUi = uiMap.get(oldUi);
        if (newUi === void 0) {
          newUi = uvs.length;
          uvs.push(cloneUv2(uvs[oldUi] ?? { u: 0, v: 0 }));
          uiMap.set(oldUi, newUi);
        }
        uvIdx[i] = newUi;
      }
    }
  }
}
function islandBounds(uvs, uvIndices) {
  const b = uvBoundsFromIndices(uvs, uvIndices);
  return {
    width: Math.max(b.maxU - b.minU, 1e-8),
    height: Math.max(b.maxV - b.minV, 1e-8)
  };
}
function collectIndices(faceUvIndices, faceList) {
  const set = /* @__PURE__ */ new Set();
  for (const fi of faceList) {
    for (const ui of faceUvIndices[fi] ?? []) set.add(ui);
  }
  return [...set];
}
function packUvIslandsShelf(uvs, islands, atlasSize = 1, margin = 0.02) {
  if (islands.length === 0) return;
  const slots = islands.map((island) => {
    fitUVsToUnitSquare(uvs, island.uvIndices);
    const { width, height } = islandBounds(uvs, island.uvIndices);
    return { island, width, height };
  });
  slots.sort((a, b) => b.height - a.height);
  const inner = atlasSize - margin * 2;
  let x = margin;
  let y = margin;
  let rowHeight = 0;
  for (const slot of slots) {
    const slotW = slot.width * inner;
    const slotH = slot.height * inner;
    if (x + slotW + margin > atlasSize && x > margin) {
      x = margin;
      y += rowHeight + margin;
      rowHeight = 0;
    }
    const b = uvBoundsFromIndices(uvs, slot.island.uvIndices);
    translateUVs(uvs, slot.island.uvIndices, x - b.minU, y - b.minV);
    const scaleU = slotW / slot.width;
    const scaleV = slotH / slot.height;
    const scale = Math.min(scaleU, scaleV);
    const pivot = { u: x, v: y };
    for (const ui of slot.island.uvIndices) {
      const uv = uvs[ui];
      if (!uv) continue;
      uv.u = pivot.u + (uv.u - pivot.u) * scale;
      uv.v = pivot.v + (uv.v - pivot.v) * scale;
    }
    x += slotW + margin;
    rowHeight = Math.max(rowHeight, slotH);
  }
}
function packFaceIslandsShelf(uvs, faceUvIndices, islands, margin = 0.02, atlasSize = 1) {
  if (islands.length === 0) return;
  if (islands.length === 1) {
    const uvIndices = collectIndices(faceUvIndices, islands[0]);
    fitUVsToUnitSquare(uvs, uvIndices);
    const b = uvBoundsFromIndices(uvs, uvIndices);
    const pad = margin;
    const avail = atlasSize - pad * 2;
    const w = b.maxU - b.minU || 1;
    const h = b.maxV - b.minV || 1;
    const scale = Math.min(avail / w, avail / h);
    for (const ui of uvIndices) {
      const uv = uvs[ui];
      if (!uv) continue;
      uv.u = pad + (uv.u - b.minU) * scale;
      uv.v = pad + (uv.v - b.minV) * scale;
    }
    return;
  }
  splitUvIslandsForPacking(uvs, faceUvIndices, islands);
  const slots = islands.map((faceList) => {
    const uvIndices = collectIndices(faceUvIndices, faceList);
    return { uvIndices, width: 1, height: 1 };
  });
  packUvIslandsShelf(uvs, slots, atlasSize, margin);
}
function packFaceIslandsRegionStrip(uvs, faceUvIndices, islands, margin = 0.02, atlasSize = 1) {
  if (islands.length === 0) return;
  if (islands.length > 1) {
    splitUvIslandsForPacking(uvs, faceUvIndices, islands);
  }
  const prepared = islands.map((faceList) => {
    const uvIndices = collectIndices(faceUvIndices, faceList);
    fitUVsToUnitSquare(uvs, uvIndices);
    const { width, height } = islandBounds(uvs, uvIndices);
    const aspect = width / height;
    return { uvIndices, aspect };
  });
  const bandH = Math.min(atlasSize * 0.42, atlasSize - margin * 2);
  const innerW = atlasSize - margin * 2;
  const gap = margin;
  const totalAspect = prepared.reduce((s, p) => s + p.aspect, 0) || 1;
  const usableW = innerW - gap * Math.max(0, prepared.length - 1);
  let x = margin;
  const y = margin;
  for (const part of prepared) {
    const cellW = usableW * part.aspect / totalAspect;
    const b = uvBoundsFromIndices(uvs, part.uvIndices);
    const w = b.maxU - b.minU || 1;
    const h = b.maxV - b.minV || 1;
    const scale = Math.min(cellW / w, bandH / h);
    for (const ui of part.uvIndices) {
      const uv = uvs[ui];
      if (!uv) continue;
      uv.u = x + (uv.u - b.minU) * scale;
      uv.v = y + (uv.v - b.minV) * scale;
    }
    x += cellW + gap;
  }
}
function packFaceIslandsUniformGrid(uvs, faceUvIndices, islands, margin = 0.02, options) {
  if (islands.length === 0) return;
  const atlasSize = options?.atlasSize ?? 1;
  const stretch = options?.stretch ?? false;
  const columnMode = options?.columns ?? "sqrt";
  if (islands.length === 1 && !stretch && columnMode === "sqrt") {
    packFaceIslandsShelf(uvs, faceUvIndices, islands, margin, atlasSize);
    return;
  }
  splitUvIslandsForPacking(uvs, faceUvIndices, islands);
  const cols = columnMode === "row" ? Math.max(1, islands.length) : Math.max(1, Math.ceil(Math.sqrt(islands.length)));
  const rows = Math.max(1, Math.ceil(islands.length / cols));
  const cellW = atlasSize / cols;
  const cellH = atlasSize / rows;
  const padScale = stretch ? margin * 0.5 : margin;
  const padU = cellW * padScale;
  const padV = cellH * padScale;
  const innerW = Math.max(cellW - padU * 2, 1e-8);
  const innerH = Math.max(cellH - padV * 2, 1e-8);
  for (let i = 0; i < islands.length; i++) {
    const uvIndices = collectIndices(faceUvIndices, islands[i]);
    if (uvIndices.length === 0) continue;
    fitUVsToUnitSquare(uvs, uvIndices);
    const b = uvBoundsFromIndices(uvs, uvIndices);
    const w = b.maxU - b.minU || 1;
    const h = b.maxV - b.minV || 1;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const baseU = col * cellW + padU;
    const baseV = atlasSize - (row + 1) * cellH + padV;
    const scaleU = innerW / w;
    const scaleV = innerH / h;
    const scale = stretch ? 1 : Math.min(scaleU, scaleV);
    const usedScaleU = stretch ? scaleU : scale;
    const usedScaleV = stretch ? scaleV : scale;
    for (const ui of uvIndices) {
      const uv = uvs[ui];
      if (!uv) continue;
      uv.u = baseU + (uv.u - b.minU) * usedScaleU;
      uv.v = baseV + (uv.v - b.minV) * usedScaleV;
    }
  }
}
function boxNetCellRect(bucket, size) {
  const { x, y, z } = size;
  switch (bucket) {
    case "+y":
      return { x: z, y: 0, w: x, h: z };
    case "-y":
      return { x: z + x, y: 0, w: x, h: z };
    case "+x":
      return { x: 0, y: z, w: z, h: y };
    case "-x":
      return { x: z + x, y: z, w: z, h: y };
    case "-z":
      return { x: z, y: z, w: x, h: y };
    case "+z":
      return { x: z + x + z, y: z, w: x, h: y };
  }
}
function packFaceIslandsBoxNet(uvs, faceUvIndices, bucketIslands, size, margin = 0.03, atlasSize = 1) {
  if (bucketIslands.length === 0) return;
  splitUvIslandsForPacking(
    uvs,
    faceUvIndices,
    bucketIslands.map((b) => b.faces)
  );
  const sx = Math.max(size.x, 1e-6);
  const sy = Math.max(size.y, 1e-6);
  const sz = Math.max(size.z, 1e-6);
  const netW = 2 * (sx + sz);
  const netH = sz + sy;
  const pad = margin;
  const scaleNet = Math.min((atlasSize - pad * 2) / netW, (atlasSize - pad * 2) / netH);
  const originU = pad + (atlasSize - pad * 2 - netW * scaleNet) * 0.5;
  const originV = pad + (atlasSize - pad * 2 - netH * scaleNet) * 0.5;
  for (const { bucket, faces } of bucketIslands) {
    if (faces.length === 0) continue;
    const uvIndices = collectIndices(faceUvIndices, faces);
    if (uvIndices.length === 0) continue;
    const cell = boxNetCellRect(bucket, { x: sx, y: sy, z: sz });
    const cellU = originU + cell.x * scaleNet;
    const cellV = originV + (netH - cell.y - cell.h) * scaleNet;
    const cellW = Math.max(cell.w * scaleNet, 1e-8);
    const cellH = Math.max(cell.h * scaleNet, 1e-8);
    const inset = Math.min(cellW, cellH) * 0.06;
    fitUVsToUnitSquare(uvs, uvIndices);
    const b = uvBoundsFromIndices(uvs, uvIndices);
    const w = b.maxU - b.minU || 1;
    const h = b.maxV - b.minV || 1;
    const innerW = Math.max(cellW - inset * 2, 1e-8);
    const innerH = Math.max(cellH - inset * 2, 1e-8);
    const scale = Math.min(innerW / w, innerH / h);
    for (const ui of uvIndices) {
      const uv = uvs[ui];
      if (!uv) continue;
      uv.u = cellU + inset + (uv.u - b.minU) * scale;
      uv.v = cellV + inset + (uv.v - b.minV) * scale;
    }
  }
}
function packFacesDirectionAtlas(uvs, faceUvIndices, faceBuckets, margin = 0.04, atlasCols = 4, atlasRows = 3) {
  if (faceBuckets.length === 0) return;
  splitUvIslandsForPacking(
    uvs,
    faceUvIndices,
    faceBuckets.map(({ fi }) => [fi])
  );
  const byBucket = /* @__PURE__ */ new Map();
  for (const { fi, bucket } of faceBuckets) {
    const list = byBucket.get(bucket) ?? [];
    list.push(fi);
    byBucket.set(bucket, list);
  }
  const cellW = 1 / atlasCols;
  const cellH = 1 / atlasRows;
  for (const [bucket, faces] of byBucket) {
    const slot = BLOCKBENCH_SLOTS[bucket];
    const baseU = slot.col * cellW + cellW * margin;
    const baseV = 1 - (slot.row + 1) * cellH + cellH * margin;
    const innerW = cellW * (1 - margin * 2);
    const innerH = cellH * (1 - margin * 2);
    const subCols = Math.max(1, Math.ceil(Math.sqrt(faces.length)));
    const subRows = Math.ceil(faces.length / subCols);
    const subW = innerW / subCols;
    const subH = innerH / subRows;
    faces.forEach((fi, idx) => {
      const uvIndices = collectIndices(faceUvIndices, [fi]);
      if (uvIndices.length === 0) return;
      fitUVsToUnitSquare(uvs, uvIndices);
      const b = uvBoundsFromIndices(uvs, uvIndices);
      const w = b.maxU - b.minU || 1;
      const h = b.maxV - b.minV || 1;
      const col = idx % subCols;
      const row = Math.floor(idx / subCols);
      const padU = subW * 0.08;
      const padV = subH * 0.08;
      const scale = Math.min((subW - padU * 2) / w, (subH - padV * 2) / h);
      const ox = baseU + col * subW + padU;
      const oy = baseV + (subRows - 1 - row) * subH + padV;
      for (const ui of uvIndices) {
        const uv = uvs[ui];
        if (!uv) continue;
        uv.u = ox + (uv.u - b.minU) * scale;
        uv.v = oy + (uv.v - b.minV) * scale;
      }
    });
  }
}
function boundsOverlap(a, b, padding) {
  return !(a.maxU + padding < b.minU || b.maxU + padding < a.minU || a.maxV + padding < b.minV || b.maxV + padding < a.minV);
}
function packPartialUnwrapIslands(uvs, faceUvIndices, faceCount, selectedFaces, islands, margin = 0.02, options) {
  if (islands.length === 0 || selectedFaces.length === 0) return;
  const opts = options ?? {};
  const style = opts.packStyle ?? "shelf";
  if (!opts.skipRefit) {
    if (style === "boxNet" && opts.boxNet) {
      packFaceIslandsBoxNet(
        uvs,
        faceUvIndices,
        opts.boxNet.buckets,
        opts.boxNet.size,
        margin
      );
    } else if (style === "directionAtlas" && opts.directionFaces) {
      packFacesDirectionAtlas(uvs, faceUvIndices, opts.directionFaces, margin);
    } else if (style === "regionStrip") {
      packFaceIslandsRegionStrip(uvs, faceUvIndices, islands, margin);
    } else if (style === "grid" || style === "gridStretch") {
      packFaceIslandsUniformGrid(uvs, faceUvIndices, islands, margin, {
        stretch: style === "gridStretch",
        columns: style === "gridStretch" ? "row" : "sqrt"
      });
    } else {
      packFaceIslandsShelf(uvs, faceUvIndices, islands, margin);
    }
  } else {
    splitUvIslandsForPacking(uvs, faceUvIndices, islands);
  }
  relocatePartialIsland(uvs, faceUvIndices, faceCount, selectedFaces, margin);
}
function relocatePartialIsland(uvs, faceUvIndices, faceCount, selectedFaces, margin = 0.02) {
  const selectedUi = collectIndices(faceUvIndices, selectedFaces);
  if (selectedUi.length === 0) return;
  const selectedSet = new Set(selectedFaces);
  const untouchedFaces = [...Array(faceCount).keys()].filter((fi) => !selectedSet.has(fi));
  if (untouchedFaces.length === 0) return;
  const untouchedUi = collectIndices(faceUvIndices, untouchedFaces);
  const existingBounds = uvBoundsFromIndices(uvs, untouchedUi);
  let selBounds = uvBoundsFromIndices(uvs, selectedUi);
  const selW = selBounds.maxU - selBounds.minU;
  const selH = selBounds.maxV - selBounds.minV;
  const candidates = [
    { u: margin, v: margin },
    { u: existingBounds.maxU + margin, v: margin },
    { u: margin, v: existingBounds.maxV + margin },
    { u: existingBounds.maxU + margin, v: existingBounds.maxV + margin },
    { u: Math.max(margin, 1 - selW - margin), v: margin },
    { u: margin, v: Math.max(margin, 1 - selH - margin) }
  ];
  for (const anchor of candidates) {
    const trial = {
      minU: anchor.u,
      minV: anchor.v,
      maxU: anchor.u + selW,
      maxV: anchor.v + selH
    };
    if (trial.minU < -0.01 || trial.minV < -0.01 || trial.maxU > 1.01 || trial.maxV > 1.01) continue;
    if (!boundsOverlap(trial, existingBounds, margin)) {
      translateUVs(uvs, selectedUi, anchor.u - selBounds.minU, anchor.v - selBounds.minV);
      return;
    }
  }
  const maxDim = Math.max(selW, selH, 1e-8);
  const scale = maxDim > 0.35 ? 0.35 / maxDim : 1;
  if (scale < 1) {
    const pivot = uvBoundsCenter(selBounds);
    scaleUVsFromCenter(uvs, selectedUi, scale, scale, pivot);
    selBounds = uvBoundsFromIndices(uvs, selectedUi);
  }
  translateUVs(uvs, selectedUi, margin - selBounds.minU, margin - selBounds.minV);
}

// src/uv/uvUnwrap.ts
var AUTO_SEAM_ANGLE_DEG = 66;
var VIEW_PROJECTION_MIN_ASPECT = 0.08;
function compactUnwrapTopology(uvs, faceUvIndices) {
  const remap = /* @__PURE__ */ new Map();
  const compactUvs = [];
  const compactFaces = faceUvIndices.map((face) => face.map((oldUi) => {
    let nextUi = remap.get(oldUi);
    if (nextUi === void 0) {
      nextUi = compactUvs.length;
      remap.set(oldUi, nextUi);
      compactUvs.push(cloneUv2(uvs[oldUi] ?? { u: 0, v: 0 }));
    }
    return nextUi;
  }));
  return { uvs: compactUvs, faceUvIndices: compactFaces };
}
var ORTHO_VIEWS = ["front", "back", "right", "left", "top", "bottom"];
function dot33(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function projectWorldPointToViewUV(point, spec) {
  if (spec.kind === "ortho") {
    const p = worldToPlanePoint(spec.view, point);
    return { u: p.x, v: p.y };
  }
  return {
    u: dot33(point, spec.right),
    v: dot33(point, spec.up)
  };
}
function projectedExtents(points, spec) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const uv = projectWorldPointToViewUV(p, spec);
    minU = Math.min(minU, uv.u);
    minV = Math.min(minV, uv.v);
    maxU = Math.max(maxU, uv.u);
    maxV = Math.max(maxV, uv.v);
  }
  const width = Math.max(maxU - minU, 0);
  const height = Math.max(maxV - minV, 0);
  return { width, height, area: width * height };
}
function collectWorldCorners(obj, faces) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const fi of faces) {
    const face = obj.faces[fi];
    if (!face) continue;
    for (const vi of face) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const local = obj.positions[vi];
      if (!local) continue;
      out.push(worldPointFromObject(obj, local));
    }
  }
  return out;
}
function isUsableProjection(width, height) {
  const min = Math.min(width, height);
  const max = Math.max(width, height);
  if (max < 1e-10) return false;
  return min / max >= VIEW_PROJECTION_MIN_ASPECT;
}
function resolveViewProjectionSpec(obj, faces, options = {}) {
  const points = collectWorldCorners(obj, faces);
  if (points.length === 0) {
    return { kind: "ortho", view: "front" };
  }
  let preferred = null;
  const view = options.projectionView;
  if (view && isOrthoView(view)) {
    preferred = { kind: "ortho", view: normalizeViewType(view) };
  } else if (options.projectionAxes) {
    preferred = { kind: "axes", right: options.projectionAxes.right, up: options.projectionAxes.up };
  }
  if (preferred) {
    const { width, height } = projectedExtents(points, preferred);
    if (isUsableProjection(width, height)) return preferred;
  }
  let best = preferred ?? { kind: "ortho", view: "front" };
  let bestScore = -1;
  for (const ortho of ORTHO_VIEWS) {
    const spec = { kind: "ortho", view: ortho };
    const { width, height, area } = projectedExtents(points, spec);
    if (!isUsableProjection(width, height)) continue;
    const bonus = preferred?.kind === "ortho" && preferred.view === ortho ? area * 0.05 : 0;
    const score = area + bonus;
    if (score > bestScore) {
      bestScore = score;
      best = spec;
    }
  }
  return best;
}
function projectFacesFromView(obj, uvs, faceUvIndices, faces, spec) {
  const touched = /* @__PURE__ */ new Set();
  for (const fi of faces) {
    const face = obj.faces[fi];
    const uvIdx = faceUvIndices[fi];
    if (!face || !uvIdx) continue;
    for (let corner = 0; corner < face.length; corner++) {
      const ui = uvIdx[corner];
      const local = obj.positions[face[corner]];
      if (ui === void 0 || !local) continue;
      const point = worldPointFromObject(obj, local);
      uvs[ui] = projectWorldPointToViewUV(point, spec);
      touched.add(ui);
    }
  }
  if (touched.size > 0) fitUVsAspectPreserving(uvs, [...touched], 1, 0.02);
}
function buildEdgeAdjacency2(obj) {
  const edgeToFaces = /* @__PURE__ */ new Map();
  const spatialEdgeToFaces = /* @__PURE__ */ new Map();
  const SPATIAL_QUANT2 = 1e-5;
  const posKey2 = (vi) => {
    const p = obj.positions[vi];
    if (!p) return `${vi}`;
    const q = (v) => Math.round(v / SPATIAL_QUANT2);
    return `${q(p.x)},${q(p.y)},${q(p.z)}`;
  };
  const spatialEdgeKey2 = (a, b) => {
    const ka = posKey2(a);
    const kb = posKey2(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      const list = edgeToFaces.get(key);
      if (list) list.push(fi);
      else edgeToFaces.set(key, [fi]);
      const skey = spatialEdgeKey2(a, b);
      const slist = spatialEdgeToFaces.get(skey);
      if (slist) slist.push(fi);
      else spatialEdgeToFaces.set(skey, [fi]);
    }
  }
  return { edgeToFaces, spatialEdgeToFaces };
}
function faceNeighbors(fi, obj, edgeToFaces, spatialEdgeToFaces) {
  const face = obj.faces[fi];
  const out = /* @__PURE__ */ new Set();
  const SPATIAL_QUANT2 = 1e-5;
  const posKey2 = (vi) => {
    const p = obj.positions[vi];
    if (!p) return `${vi}`;
    const q = (v) => Math.round(v / SPATIAL_QUANT2);
    return `${q(p.x)},${q(p.y)},${q(p.z)}`;
  };
  const spatialEdgeKey2 = (a, b) => {
    const ka = posKey2(a);
    const kb = posKey2(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    for (const other of edgeToFaces.get(edgeKey(a, b)) ?? []) {
      if (other !== fi) out.add(other);
    }
    for (const other of spatialEdgeToFaces.get(spatialEdgeKey2(a, b)) ?? []) {
      if (other !== fi) out.add(other);
    }
  }
  return [...out];
}
function normalAngleDeg(n1, n2) {
  const dot = Math.max(-1, Math.min(1, n1.x * n2.x + n1.y * n2.y + n1.z * n2.z));
  return Math.acos(dot) * 180 / Math.PI;
}
function clusterFacesSmartUv(obj, faceIndices, angleLimitDeg) {
  const allowed = new Set(faceIndices);
  const { edgeToFaces, spatialEdgeToFaces } = buildEdgeAdjacency2(obj);
  const visited = /* @__PURE__ */ new Set();
  const islands = [];
  for (const seed of faceIndices) {
    if (visited.has(seed) || !allowed.has(seed)) continue;
    const island = [];
    const queue = [seed];
    const seedNormal = faceNormal3D(obj, seed);
    visited.add(seed);
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      island.push(cur);
      const nCur = faceNormal3D(obj, cur);
      for (const nb of faceNeighbors(cur, obj, edgeToFaces, spatialEdgeToFaces)) {
        if (!allowed.has(nb) || visited.has(nb)) continue;
        const nNb = faceNormal3D(obj, nb);
        if (normalAngleDeg(nCur, nNb) <= angleLimitDeg && normalAngleDeg(seedNormal, nNb) <= angleLimitDeg) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (island.length > 0) islands.push(island);
  }
  return islands;
}
function clusterFacesConnected(obj, faceIndices) {
  const allowed = new Set(faceIndices);
  const { edgeToFaces, spatialEdgeToFaces } = buildEdgeAdjacency2(obj);
  const visited = /* @__PURE__ */ new Set();
  const components = [];
  for (const seed of faceIndices) {
    if (visited.has(seed) || !allowed.has(seed)) continue;
    const component = [];
    const queue = [seed];
    visited.add(seed);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      component.push(current);
      for (const neighbor of faceNeighbors(current, obj, edgeToFaces, spatialEdgeToFaces)) {
        if (!allowed.has(neighbor) || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}
function isAabbBoxLike(obj, faceIndices) {
  if (faceIndices.length < 6) return false;
  const size = aabbSizeForFaces(obj, faceIndices);
  const mins = { x: Infinity, y: Infinity, z: Infinity };
  const maxs = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const fi of faceIndices) {
    for (const vi of obj.faces[fi] ?? []) {
      const p = obj.positions[vi];
      if (!p) continue;
      mins.x = Math.min(mins.x, p.x);
      mins.y = Math.min(mins.y, p.y);
      mins.z = Math.min(mins.z, p.z);
      maxs.x = Math.max(maxs.x, p.x);
      maxs.y = Math.max(maxs.y, p.y);
      maxs.z = Math.max(maxs.z, p.z);
    }
  }
  const tolerance = Math.max(size.x, size.y, size.z) * 1e-4 + 1e-7;
  const onBoundaryPlane = (fi) => {
    const face = obj.faces[fi] ?? [];
    return ["x", "y", "z"].some(
      (axis) => face.every((vi) => {
        const value = obj.positions[vi]?.[axis];
        return value !== void 0 && (Math.abs(value - mins[axis]) <= tolerance || Math.abs(value - maxs[axis]) <= tolerance);
      })
    );
  };
  return faceIndices.every(onBoundaryPlane);
}
function resolveAutoUnwrapMethod(obj, faceIndices) {
  const indices = faceIndices && faceIndices.length > 0 ? faceIndices.filter((fi) => fi >= 0 && fi < obj.faces.length) : obj.faces.map((_, i) => i);
  if (indices.length === 0) return "smart";
  if (obj.uvMappingMode === "box" || isDoodleLikeObject(obj)) return "box";
  const buckets = /* @__PURE__ */ new Map();
  for (const fi of indices) {
    const b = classifyFaceNormalBucket(faceNormal3D(obj, fi));
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const bucketCount = buckets.size;
  const faceCount = indices.length;
  const largestBucket = Math.max(...buckets.values(), 0);
  const bucketBalance = largestBucket / Math.max(faceCount, 1);
  if (bucketCount >= 4 && bucketCount <= 6 && bucketBalance < 0.55 && isAabbBoxLike(obj, indices)) return "box";
  const connected = clusterFacesConnected(obj, indices);
  const planar = clusterFacesPlanarRegions(obj, indices);
  const planarRegionByFace = /* @__PURE__ */ new Map();
  planar.forEach((region, regionIndex) => {
    for (const fi of region) planarRegionByFace.set(fi, regionIndex);
  });
  const hasBentConnectedPatch = connected.some(
    (component) => component.length > 1 && new Set(component.map((fi) => planarRegionByFace.get(fi))).size > 1
  );
  if (hasBentConnectedPatch) return "smart";
  if (faceCount <= 48 && bucketCount <= 8) return "regions";
  return "smart";
}
function aabbSizeForFaces(obj, faces) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const seen = /* @__PURE__ */ new Set();
  for (const fi of faces) {
    const face = obj.faces[fi];
    if (!face) continue;
    for (const vi of face) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const p = obj.positions[vi];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return { x: 1, y: 1, z: 1 };
  return {
    x: Math.max(maxX - minX, 1e-4),
    y: Math.max(maxY - minY, 1e-4),
    z: Math.max(maxZ - minZ, 1e-4)
  };
}
function clusterFacesByNormalBucket(obj, faceIndices) {
  const buckets = /* @__PURE__ */ new Map();
  for (const fi of faceIndices) {
    const bucket = classifyFaceNormalBucket(faceNormal3D(obj, fi));
    const list = buckets.get(bucket) ?? [];
    list.push(fi);
    buckets.set(bucket, list);
  }
  return buckets;
}
function weldIslandUvTopology(faceUvIndices, uvs, obj, islandFaces) {
  const vertToUi = /* @__PURE__ */ new Map();
  for (const fi of islandFaces) {
    const face = obj.faces[fi];
    const uvIdx = faceUvIndices[fi];
    if (!face || !uvIdx) continue;
    for (let i = 0; i < face.length; i++) {
      const vi = face[i];
      const ui = uvIdx[i];
      if (ui === void 0) continue;
      if (!vertToUi.has(vi)) vertToUi.set(vi, ui);
    }
  }
  for (const fi of islandFaces) {
    const face = obj.faces[fi];
    const uvIdx = faceUvIndices[fi];
    if (!face || !uvIdx) continue;
    for (let i = 0; i < face.length; i++) {
      const vi = face[i];
      const ui = uvIdx[i];
      if (ui === void 0) continue;
      const canonical = vertToUi.get(vi);
      uvs[canonical] = { ...uvs[ui] };
      uvIdx[i] = canonical;
    }
  }
}
function clusterFacesPlanarRegions(obj, faceIndices) {
  const allowed = new Set(faceIndices);
  const map = computeFaceGroups(obj);
  const islands = [];
  const used = /* @__PURE__ */ new Set();
  for (const group of map.groups) {
    const members = group.faceIndices.filter((fi) => allowed.has(fi));
    if (members.length === 0) continue;
    islands.push(members);
    for (const fi of members) used.add(fi);
  }
  for (const fi of faceIndices) {
    if (!used.has(fi)) islands.push([fi]);
  }
  return islands;
}
function projectIslandPlanar(obj, uvs, islandFaces) {
  if (islandFaces.length === 0) return;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const fi of islandFaces) {
    const n = faceNormal3D(obj, fi);
    nx += n.x;
    ny += n.y;
    nz += n.z;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  const avgNormal = { x: nx / len, y: ny / len, z: nz / len };
  const vertToUi = /* @__PURE__ */ new Map();
  for (const fi of islandFaces) {
    const face = obj.faces[fi];
    const uvIdx = obj.faceUvIndices[fi] ?? [];
    for (let i = 0; i < face.length; i++) {
      const vi = face[i];
      const ui = uvIdx[i];
      if (ui === void 0) continue;
      if (!vertToUi.has(vi)) vertToUi.set(vi, []);
      vertToUi.get(vi).push(ui);
    }
  }
  const vertList = [...vertToUi.keys()];
  const corners = vertList.map((vi) => obj.positions[vi]).filter(Boolean);
  const projected = planarProjectFaceUVs(avgNormal, corners);
  for (let i = 0; i < vertList.length; i++) {
    const uv = projected[i] ?? { u: 0, v: 0 };
    for (const ui of vertToUi.get(vertList[i]) ?? []) {
      uvs[ui] = { u: uv.u, v: uv.v };
    }
  }
}
function projectFacePlanar(obj, uvs, fi) {
  const fIdx = obj.faceUvIndices[fi] ?? [];
  const n = faceNormal3D(obj, fi);
  const corners = faceCorners3D(obj, fi);
  const projected = planarProjectFaceUVs(n, corners);
  for (let i = 0; i < fIdx.length; i++) {
    uvs[fIdx[i]] = projected[i] ?? uvs[fIdx[i]];
  }
}
function repackEntireMesh(work, uvs, faceUvIndices, layout, angleLimit, margin, touchedFaces, projectUntouched) {
  const allFaces = work.faces.map((_, i) => i);
  const workUvs = { ...work, uvs, faceUvIndices };
  if (layout === "box") {
    const buckets = clusterFacesByNormalBucket(work, allFaces);
    for (const [, bucketFaces] of buckets) {
      const touch = projectUntouched || bucketFaces.some((fi) => touchedFaces.has(fi));
      if (touch) {
        projectIslandPlanar(workUvs, uvs, bucketFaces);
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces);
      }
    }
    const bucketList = [...buckets.entries()].map(([bucket, faces]) => ({ bucket, faces }));
    splitUvIslandsForPacking(
      uvs,
      faceUvIndices,
      bucketList.map((b) => b.faces)
    );
    packFaceIslandsBoxNet(uvs, faceUvIndices, bucketList, aabbSizeForFaces(work, allFaces), margin);
    return;
  }
  if (layout === "blockbench") {
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi);
    }
    const directionFaces = allFaces.map((fi) => ({
      fi,
      bucket: classifyFaceNormalBucket(faceNormal3D(work, fi))
    }));
    packFacesDirectionAtlas(uvs, faceUvIndices, directionFaces, margin);
    return;
  }
  if (layout === "planar") {
    const islands2 = allFaces.map((fi) => [fi]);
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi);
    }
    packFaceIslandsUniformGrid(uvs, faceUvIndices, islands2, margin, { stretch: false });
    return;
  }
  if (layout === "lightmap") {
    const islands2 = allFaces.map((fi) => [fi]);
    for (const fi of allFaces) {
      if (projectUntouched || touchedFaces.has(fi)) projectFacePlanar(workUvs, uvs, fi);
    }
    packFaceIslandsUniformGrid(uvs, faceUvIndices, islands2, margin, {
      stretch: true,
      columns: "row"
    });
    return;
  }
  const islands = layout === "regions" ? clusterFacesPlanarRegions(work, allFaces) : clusterFacesSmartUv(work, allFaces, angleLimit);
  for (const island of islands) {
    const touch = projectUntouched || island.some((fi) => touchedFaces.has(fi));
    if (touch) {
      projectIslandPlanar(workUvs, uvs, island);
      weldIslandUvTopology(faceUvIndices, uvs, work, island);
    }
  }
  if (layout === "regions") {
    packFaceIslandsRegionStrip(uvs, faceUvIndices, islands, margin);
  } else {
    packFaceIslandsShelf(uvs, faceUvIndices, islands, margin);
  }
}
function unwrapSelectedFaces(obj, faceIndices, method, options = {}) {
  const margin = options.margin ?? 0.02;
  const allFaceCount = obj.faces.length;
  const faces = [...new Set(faceIndices.filter((fi) => fi >= 0 && fi < allFaceCount))];
  if (faces.length === 0) {
    return {
      uvs: obj.uvs.map(cloneUv2),
      faceUvIndices: obj.faceUvIndices.map((f) => [...f])
    };
  }
  const fullMesh = faces.length >= allFaceCount;
  if (method === "view") {
    const spec = resolveViewProjectionSpec(obj, faces, options);
    const source = separateFacesUvTopology(obj, faces);
    const uvs2 = source.uvs.map(cloneUv2);
    const faceUvIndices2 = source.faceUvIndices.map((face) => [...face]);
    projectFacesFromView({ ...obj, uvs: uvs2, faceUvIndices: faceUvIndices2 }, uvs2, faceUvIndices2, faces, spec);
    for (const component of clusterFacesConnected(obj, faces)) {
      weldIslandUvTopology(faceUvIndices2, uvs2, obj, component);
    }
    if (!fullMesh) {
      packPartialUnwrapIslands(uvs2, faceUvIndices2, allFaceCount, faces, [faces], margin, {
        skipRefit: true
      });
    }
    return { ...compactUnwrapTopology(uvs2, faceUvIndices2), uvAutoPacked: true };
  }
  let resolved = method === "auto" ? resolveAutoUnwrapMethod(obj, fullMesh ? void 0 : faces) : method;
  const angleLimit = method === "auto" ? AUTO_SEAM_ANGLE_DEG : options.angleLimitDeg ?? (resolved === "smart" ? AUTO_SEAM_ANGLE_DEG : 89);
  if (fullMesh) {
    const source = separateFacesUvTopology(obj, faces);
    const uvs2 = source.uvs.map(cloneUv2);
    const faceUvIndices2 = source.faceUvIndices.map((f) => [...f]);
    const work2 = { ...obj, faceUvIndices: faceUvIndices2 };
    repackEntireMesh(
      work2,
      uvs2,
      faceUvIndices2,
      resolved,
      angleLimit,
      margin,
      new Set(faces),
      true
    );
    return {
      ...compactUnwrapTopology(uvs2, faceUvIndices2),
      uvAutoPacked: options.markPacked ?? true
    };
  }
  const detached = separateFacesUvTopology(obj, faces);
  const uvs = detached.uvs.map(cloneUv2);
  const faceUvIndices = detached.faceUvIndices.map((f) => [...f]);
  const work = { ...obj, uvs, faceUvIndices };
  let selectionIslands = [];
  let packStyle = "shelf";
  let boxNet;
  let directionFaces;
  switch (resolved) {
    case "smart": {
      selectionIslands = clusterFacesSmartUv(work, faces, angleLimit);
      for (const island of selectionIslands) {
        projectIslandPlanar(work, uvs, island);
        weldIslandUvTopology(faceUvIndices, uvs, work, island);
      }
      packStyle = "shelf";
      break;
    }
    case "regions": {
      selectionIslands = clusterFacesPlanarRegions(work, faces);
      for (const island of selectionIslands) {
        projectIslandPlanar(work, uvs, island);
        weldIslandUvTopology(faceUvIndices, uvs, work, island);
      }
      packStyle = "regionStrip";
      break;
    }
    case "planar": {
      selectionIslands = faces.map((fi) => [fi]);
      for (const fi of faces) projectFacePlanar(work, uvs, fi);
      packStyle = "grid";
      break;
    }
    case "box": {
      const buckets = clusterFacesByNormalBucket(work, faces);
      selectionIslands = [...buckets.values()];
      for (const bucketFaces of selectionIslands) {
        projectIslandPlanar(work, uvs, bucketFaces);
        weldIslandUvTopology(faceUvIndices, uvs, work, bucketFaces);
      }
      packStyle = "boxNet";
      boxNet = {
        size: aabbSizeForFaces(work, faces),
        buckets: [...buckets.entries()].map(([bucket, bucketFaces]) => ({
          bucket,
          faces: bucketFaces
        }))
      };
      break;
    }
    case "blockbench": {
      selectionIslands = faces.map((fi) => [fi]);
      for (const fi of faces) projectFacePlanar(work, uvs, fi);
      packStyle = "directionAtlas";
      directionFaces = faces.map((fi) => ({
        fi,
        bucket: classifyFaceNormalBucket(faceNormal3D(work, fi))
      }));
      break;
    }
    case "lightmap": {
      selectionIslands = faces.map((fi) => [fi]);
      for (const fi of faces) projectFacePlanar(work, uvs, fi);
      packStyle = "gridStretch";
      break;
    }
    case "view":
      break;
  }
  if (options.repackAll !== false && selectionIslands.length > 0) {
    packPartialUnwrapIslands(uvs, faceUvIndices, allFaceCount, faces, selectionIslands, margin, {
      packStyle,
      boxNet,
      directionFaces
    });
  }
  return {
    ...compactUnwrapTopology(uvs, faceUvIndices),
    uvAutoPacked: options.markPacked ?? false
  };
}

// src/uv/uvAuto.ts
function needsUvRepack(obj) {
  if (obj.uvAutoPacked) return false;
  if (!obj.uvs?.length || !obj.faceUvIndices?.length) return true;
  if (obj.faces.length <= 1) return false;
  let fullSquare = 0;
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const idx = obj.faceUvIndices?.[fi] ?? [];
    if (idx.length === 0) continue;
    const b = uvBoundsFromIndices(obj.uvs, idx);
    const w = b.maxU - b.minU;
    const h = b.maxV - b.minV;
    if (w > 0.85 && h > 0.85 && b.minU < 0.08 && b.minV < 0.08) fullSquare++;
  }
  return fullSquare >= Math.max(2, Math.floor(obj.faces.length * 0.25));
}
function needsDoodleUvRepack(obj) {
  if (!isSketchDoodleObject(obj) && !isVectorDoodleObject(obj)) return false;
  if (!obj.uvs?.length || !obj.faceUvIndices?.length) return true;
  if (!obj.uvAutoPacked) return true;
  if (obj.faces.length <= 3) return false;
  let tinyIslands = 0;
  let fullSquare = 0;
  let checked = 0;
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const idx = obj.faceUvIndices[fi] ?? [];
    if (idx.length === 0) continue;
    checked++;
    const b = uvBoundsFromIndices(obj.uvs, idx);
    const w = b.maxU - b.minU;
    const h = b.maxV - b.minV;
    if (w < 0.12 && h < 0.12) tinyIslands++;
    if (w > 0.85 && h > 0.85 && b.minU < 0.08 && b.minV < 0.08) fullSquare++;
  }
  if (checked < 4) return false;
  if (tinyIslands / checked > 0.5) return true;
  return fullSquare >= Math.max(2, Math.floor(checked * 0.25));
}

// src/uv/uvObject.ts
var DEFAULT_UV_LAYOUT_VERSION = 1;
function isDoodleLikeObject(obj) {
  return isSketchDoodleObject(obj) || isVectorDoodleObject(obj);
}
function ensureUvTopology(obj) {
  if (obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length) {
    return obj;
  }
  const uvs = [];
  const faceUvIndices = [];
  for (const face of obj.faces) {
    const indices = [];
    for (let i = 0; i < face.length; i++) {
      indices.push(uvs.length);
      uvs.push({ u: 0, v: 0 });
    }
    faceUvIndices.push(indices);
  }
  return { ...obj, uvs, faceUvIndices };
}
function defaultBoxUnwrapObject(obj) {
  const base = ensureUvTopology(obj);
  const allFaces = base.faces.map((_, i) => i);
  const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(
    base,
    allFaces,
    "box",
    { angleLimitDeg: AUTO_SEAM_ANGLE_DEG, margin: 0.035, repackAll: true, markPacked: true }
  );
  return {
    ...base,
    uvs,
    faceUvIndices,
    // Per-face editing means islands can still be detached and transformed;
    // the initial projection itself is the familiar six-direction box atlas.
    uvMappingMode: "perFace",
    uvAutoPacked: uvAutoPacked ?? true,
    uvLayoutVersion: DEFAULT_UV_LAYOUT_VERSION
  };
}
function ensureObjectUVs(obj) {
  if (obj.primitiveSource && obj.material?.mode !== "texture" && obj.uvLayoutVersion !== DEFAULT_UV_LAYOUT_VERSION) {
    return defaultBoxUnwrapObject(obj);
  }
  if (obj.uvAutoPacked && obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length) {
    return obj;
  }
  if (needsDoodleUvRepack(obj)) {
    return defaultBoxUnwrapObject(obj);
  }
  if (!obj.uvs?.length || obj.faceUvIndices?.length !== obj.faces.length || needsUvRepack(obj)) {
    return defaultBoxUnwrapObject(obj);
  }
  return obj;
}
function separateFacesUvTopology(obj, faceIndices) {
  const base = ensureUvTopology(obj);
  if (faceIndices.length === 0) return base;
  const uvs = base.uvs.map(cloneUv2);
  const faceUvIndices = base.faceUvIndices.map((face) => [...face]);
  const selected = new Set(faceIndices);
  for (const fi of selected) {
    const face = base.faces[fi];
    const oldIndices = base.faceUvIndices[fi];
    if (!face || !oldIndices) continue;
    const next = [];
    for (let corner = 0; corner < face.length; corner++) {
      const oldUi = oldIndices[corner];
      next.push(uvs.length);
      uvs.push(
        cloneUv2(oldUi === void 0 ? { u: 0, v: 0 } : base.uvs[oldUi] ?? { u: 0, v: 0 })
      );
    }
    faceUvIndices[fi] = next;
  }
  return { ...base, uvs, faceUvIndices };
}
function faceCorners3D(obj, faceIndex) {
  const face = obj.faces[faceIndex];
  if (!face) return [];
  return face.map((vi) => ({ ...obj.positions[vi] }));
}
function faceNormal3D(obj, faceIndex) {
  const corners = faceCorners3D(obj, faceIndex);
  if (corners.length < 3) return { x: 0, y: 1, z: 0 };
  return faceNormal(corners[0], corners[1], corners[2]);
}

// src/mesh/meshOps.ts
var _pivot2 = new THREE3.Vector3();
var _axis = new THREE3.Vector3();

// src/mesh/meshTopology.ts
import * as THREE4 from "three";

// src/mesh/meshPolyBudget.ts
function gridResolutionCap(polyBudget) {
  return Math.max(8, Math.min(18, Math.round(Math.cbrt(polyBudget * 5))));
}
function primitiveSegmentsForBudget(polyBudget, fallback = 8) {
  return Math.max(6, Math.min(12, Math.floor(Math.sqrt(polyBudget * 0.5)) || fallback));
}

// src/primitives/capsuleMesh.ts
var LOW_POLY_CAPSULE_HEMI_RINGS = 2;

// src/mesh/verticalCapsule.ts
function chordAtY(poly, y) {
  const xs = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dy = b.y - a.y;
    if (Math.abs(dy) < 1e-10) continue;
    const crosses = a.y <= y && b.y > y || b.y <= y && a.y > y;
    if (!crosses) continue;
    const t = (y - a.y) / dy;
    xs.push(a.x + t * (b.x - a.x));
  }
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b);
  return { x0: xs[0], x1: xs[xs.length - 1] };
}
function boundsY(poly) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minY, maxY };
}
function bodyFitRadius(poly, minY, maxY) {
  const height = maxY - minY;
  if (height < 1e-4) return 0.35;
  const samples = [];
  for (let i = 0; i < 16; i++) {
    const t = 0.2 + 0.6 * i / 15;
    const chord = chordAtY(poly, minY + height * t);
    if (!chord) continue;
    samples.push(Math.max(0.35, (chord.x1 - chord.x0) * 0.5));
  }
  if (samples.length === 0) return Math.min(0.35, height * 0.49);
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length * 0.6)];
  return Math.min(mid, height * 0.49);
}
function centerXAt(poly, y, fallback) {
  const chord = chordAtY(poly, y);
  if (!chord) return fallback;
  return (chord.x0 + chord.x1) * 0.5;
}
function sampleMeridian(s, minY, maxY, fitR, bodyLen, hemiArc) {
  if (s <= hemiArc) {
    const theta2 = fitR > 1e-8 ? s / fitR : 0;
    return {
      y: minY + fitR * (1 - Math.cos(theta2)),
      radius: fitR * Math.sin(theta2)
    };
  }
  if (s <= hemiArc + bodyLen) {
    return {
      y: minY + fitR + (s - hemiArc),
      radius: fitR
    };
  }
  const sTop = s - hemiArc - bodyLen;
  const theta = fitR > 1e-8 ? sTop / fitR : 0;
  return {
    y: maxY - fitR * (1 - Math.cos(theta)),
    radius: fitR * Math.sin(theta)
  };
}
function pushUv2(mesh, u, v) {
  const idx = mesh.uvs.length;
  mesh.uvs.push(uv2(u, v));
  return idx;
}
function addRing2(mesh, cx, y, radius, segments) {
  const ring = [];
  for (let si = 0; si < segments; si++) {
    const angle = si / segments * Math.PI * 2;
    ring.push(mesh.positions.length);
    mesh.positions.push({
      x: cx + Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius
    });
  }
  return ring;
}
function stitchRingPair(mesh, ringA, ringB, vA, vB, color) {
  const segments = ringA.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    const u0 = si / segments;
    const u1 = (si + 1) / segments;
    const uvA0 = pushUv2(mesh, u0, vA);
    const uvA1 = pushUv2(mesh, u1, vA);
    const uvB0 = pushUv2(mesh, u0, vB);
    const uvB1 = pushUv2(mesh, u1, vB);
    mesh.faces.push([ringA[si], ringA[next], ringB[next], ringB[si]]);
    mesh.faceUvIndices.push([uvA0, uvA1, uvB1, uvB0]);
    mesh.faceColors.push(color);
  }
}
function fanPole(mesh, pole, ring, vPole, vRing, color, poleIsMin) {
  const segments = ring.length;
  const uvPole = pushUv2(mesh, 0.5, vPole);
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    const u0 = si / segments;
    const u1 = (si + 1) / segments;
    const uv0 = pushUv2(mesh, u0, vRing);
    const uv1 = pushUv2(mesh, u1, vRing);
    if (poleIsMin) {
      mesh.faces.push([pole, ring[next], ring[si]]);
      mesh.faceUvIndices.push([uvPole, uv1, uv0]);
    } else {
      mesh.faces.push([pole, ring[si], ring[next]]);
      mesh.faceUvIndices.push([uvPole, uv0, uv1]);
    }
    mesh.faceColors.push(color);
  }
}
function generateVerticalShapedCapsule(polygon, options = {}) {
  const {
    radialSegments = 8,
    profileRings = 10,
    minAngleDeg = 12,
    maxBoundaryVerts = 32,
    preserveBoundary = false,
    color = 16098926
  } = options;
  const mesh = new HalfEdgeMesh();
  const ccw = ensureCCW(polygon);
  const boundary = preserveBoundary ? ccw : curvatureSampleClosedLoop(ccw, minAngleDeg, maxBoundaryVerts);
  if (boundary.length < 3) return mesh;
  const { minY, maxY } = boundsY(boundary);
  const height = maxY - minY;
  if (height < 1e-4) return mesh;
  const fitR = bodyFitRadius(boundary, minY, maxY);
  const segments = Math.max(6, Math.min(16, radialSegments));
  const bodyLen = Math.max(0, height - 2 * fitR);
  const hemiArc = fitR * (Math.PI * 0.5);
  const totalArc = bodyLen + 2 * hemiArc;
  if (totalArc < 1e-4) return mesh;
  const equatorEdge = 2 * Math.PI * fitR / segments;
  const fromSpacing = Math.max(6, Math.round(totalArc / Math.max(0.5, equatorEdge)));
  const maxLong = Math.max(6, Math.min(18, profileRings + 4));
  const longSegs = Math.max(6, Math.min(maxLong, fromSpacing));
  const midY = (minY + maxY) * 0.5;
  const bodyCx = centerXAt(boundary, midY, 0);
  const slots = [];
  const span = Math.max(1e-6, height);
  const bottomPole = mesh.positions.length;
  mesh.positions.push({
    x: centerXAt(boundary, minY + fitR * 0.15, bodyCx),
    y: minY,
    z: 0
  });
  for (let i = 1; i < longSegs; i++) {
    const s = totalArc * i / longSegs;
    const { y, radius } = sampleMeridian(s, minY, maxY, fitR, bodyLen, hemiArc);
    if (radius < 1e-4) continue;
    const cx = centerXAt(boundary, y, bodyCx);
    slots.push({
      ring: addRing2(mesh, cx, y, Math.max(0.35, radius), segments),
      v: (y - minY) / span
    });
  }
  const topPole = mesh.positions.length;
  mesh.positions.push({
    x: centerXAt(boundary, maxY - fitR * 0.15, bodyCx),
    y: maxY,
    z: 0
  });
  if (slots.length === 0) return mesh;
  fanPole(mesh, bottomPole, slots[0].ring, 0, slots[0].v, color, true);
  for (let ri = 0; ri < slots.length - 1; ri++) {
    stitchRingPair(
      mesh,
      slots[ri].ring,
      slots[ri + 1].ring,
      slots[ri].v,
      slots[ri + 1].v,
      color
    );
  }
  fanPole(mesh, topPole, slots[slots.length - 1].ring, 1, slots[slots.length - 1].v, color, false);
  mesh.buildHalfEdges();
  return reorientFacesOutward(mesh);
}

// src/mesh/pathOutputs.ts
function tangent(path, i) {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
function mergeOutputMeshes(meshes, color) {
  const out = new HalfEdgeMesh();
  for (const mesh of meshes) {
    const vertexBase = out.positions.length;
    const uvBase = out.uvs.length;
    out.positions.push(...mesh.positions.map((p) => ({ ...p })));
    out.uvs.push(...mesh.uvs.map((uv) => ({ ...uv })));
    mesh.faces.forEach((face, fi) => {
      out.faces.push(face.map((vi) => vi + vertexBase));
      out.faceColors.push(mesh.faceColors[fi] ?? color);
      const faceUv = mesh.faceUvIndices[fi];
      if (faceUv) out.faceUvIndices.push(faceUv.map((ui) => ui + uvBase));
      else if (out.uvs.length > 0) out.faceUvIndices.push(face.map(() => uvBase));
    });
  }
  out.buildHalfEdges();
  return out;
}
function seededRandom(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state = state * 1664525 + 1013904223 >>> 0;
    return state / 4294967296;
  };
}
function samplePath(path, settings) {
  if (path.length < 2) return [];
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = lengths[lengths.length - 1];
  const start = Math.max(0, Math.min(total, settings.startPadding ?? 0));
  const end = Math.max(start, total - Math.max(0, settings.endPadding ?? 0));
  const usable = Math.max(0, end - start);
  const requested = Math.max(1, Math.round(settings.count ?? 8));
  const mode = settings.distributionMode ?? "spacing";
  const count = mode === "count" ? requested : Math.max(1, Math.floor(usable / Math.max(1, settings.spacing)) + (mode === "fit" ? 0 : 1));
  const out = [];
  for (let k = 0; k < count; k++) {
    const d = count === 1 ? start + usable / 2 : start + usable * (k / Math.max(1, count - 1));
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < d) i++;
    const a = path[i - 1];
    const b = path[i];
    const span = Math.max(1e-6, lengths[i] - lengths[i - 1]);
    const f = (d - lengths[i - 1]) / span;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ p: { x: a.x + dx * f, y: a.y + dy * f }, t: { x: dx / len, y: dy / len }, u: total > 0 ? d / total : 0 });
  }
  return out;
}
function transformCopy(source, p, angle, scale, roll = 0, mirror = false) {
  const out = new HalfEdgeMesh();
  const c = Math.cos(angle), s = Math.sin(angle), cr = Math.cos(roll), sr = Math.sin(roll);
  out.positions = source.positions.map((v) => {
    const x0 = v.x * scale * (mirror ? -1 : 1), y0 = v.y * scale, z0 = v.z * scale;
    const y1 = y0 * cr - z0 * sr, z1 = y0 * sr + z0 * cr;
    return { x: p.x + x0 * c - y1 * s, y: p.y + x0 * s + y1 * c, z: z1 };
  });
  out.faces = source.faces.map((f) => [...f]);
  out.faceColors = [...source.faceColors];
  out.uvs = source.uvs.map((uv) => ({ ...uv }));
  out.faceUvIndices = source.faceUvIndices.map((f) => [...f]);
  out.buildHalfEdges();
  return out;
}
function makeBox(width, height, depth, color) {
  const m = new HalfEdgeMesh(), x = width / 2, y = height / 2, z = depth / 2;
  m.positions = [
    { x: -x, y: -y, z: -z },
    { x, y: -y, z: -z },
    { x, y, z: -z },
    { x: -x, y, z: -z },
    { x: -x, y: -y, z },
    { x, y: -y, z },
    { x, y, z },
    { x: -x, y, z }
  ];
  m.faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  m.faceColors = m.faces.map(() => color);
  m.buildHalfEdges();
  return m;
}
function makeCard(width, height, color) {
  const m = new HalfEdgeMesh(), x = width / 2, y = height / 2;
  m.positions = [{ x: -x, y: -y, z: 0 }, { x, y: -y, z: 0 }, { x, y, z: 0 }, { x: -x, y, z: 0 }];
  m.faces = [[0, 1, 2, 3], [0, 3, 2, 1]];
  m.faceColors = [color, color];
  m.uvs = [{ u: 0, v: 1 }, { u: 1, v: 1 }, { u: 1, v: 0 }, { u: 0, v: 0 }];
  m.faceUvIndices = [[0, 1, 2, 3], [0, 3, 2, 1]];
  m.buildHalfEdges();
  return m;
}
function makeLink(major, minor, color) {
  const m = new HalfEdgeMesh(), around = 12, tube = 5;
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    const a = i / around * Math.PI * 2, b = j / tube * Math.PI * 2;
    m.positions.push({ x: Math.cos(a) * (major + minor * Math.cos(b)), y: Math.sin(a) * (major * 0.72 + minor * Math.cos(b)), z: minor * Math.sin(b) });
  }
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    const n = (i + 1) % around, q = (j + 1) % tube;
    m.faces.push([i * tube + j, n * tube + j, n * tube + q, i * tube + q]);
    m.faceColors.push(color);
  }
  m.buildHalfEdges();
  return m;
}
function sweepProfile(path, profile, settings, color) {
  const m = new HalfEdgeMesh(), n = profile.length;
  for (let i = 0; i < path.length; i++) {
    const t = tangent(path, i), nx = -t.y, ny = t.x, u = i / Math.max(1, path.length - 1);
    const scale = settings.startScale + (settings.endScale - settings.startScale) * u;
    const roll = settings.twist * Math.PI / 180 * u, cr = Math.cos(roll), sr = Math.sin(roll);
    for (const q of profile) {
      const lateral = (q.x * cr - q.y * sr) * scale + settings.offset, z = (q.x * sr + q.y * cr) * scale;
      m.positions.push({ x: path[i].x + nx * lateral, y: path[i].y + ny * lateral, z });
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < n; j++) {
    const q = (j + 1) % n;
    m.faces.push([i * n + j, (i + 1) * n + j, (i + 1) * n + q, i * n + q]);
    m.faceColors.push(color);
  }
  if (settings.startCap !== "open") {
    m.faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
    m.faceColors.push(color);
  }
  if (settings.endCap !== "open") {
    m.faces.push(Array.from({ length: n }, (_, i) => (path.length - 1) * n + i));
    m.faceColors.push(color);
  }
  m.buildHalfEdges();
  return m;
}
function generatePathOutput(path, settings, color) {
  const radius = Math.max(0.25, settings.radius);
  if (settings.output === "tube") return generateCapsuleSweep(path, { radius, radialSegments: settings.radialSegments, preserveSpine: true, color, startCap: settings.startCap, endCap: settings.endCap });
  if (settings.output === "ribbon") return generateHairRibbon(path, { halfWidth: radius, depth: Math.max(0.2, radius * 0.25), flat: settings.ribbonFlat, color, startTipStyle: settings.ribbonStartTip, endTipStyle: settings.ribbonEndTip, taperFraction: settings.ribbonTaper });
  if (settings.output === "vine") return generateTaperedPointedTube(path, { radius, radialSegments: settings.radialSegments, preserveSpine: true, color, tipStyle: "pointed" });
  if (settings.output === "rope") {
    const strands = [];
    for (let strand = 0; strand < 3; strand++) strands.push(generateCapsuleSweep(path.map((p, i) => {
      const t = tangent(path, i), phase = i / Math.max(1, path.length - 1) * settings.twist * Math.PI / 180 + strand * Math.PI * 2 / 3;
      return { x: p.x - t.y * Math.cos(phase) * radius * 0.7, y: p.y + t.x * Math.cos(phase) * radius * 0.7 };
    }), { radius: radius * 0.42, radialSegments: Math.max(4, settings.radialSegments - 2), preserveSpine: true, color, startCap: settings.startCap, endCap: settings.endCap }));
    return mergeOutputMeshes(strands, color);
  }
  if (settings.output === "profile-sweep") {
    const w = radius * settings.profileWidth, h = radius * settings.profileHeight;
    const profile = settings.profile === "rail" ? [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: -h * 0.55 }, { x: w * 0.3, y: -h * 0.55 }, { x: w * 0.3, y: h * 0.55 }, { x: w, y: h * 0.55 }, { x: w, y: h }, { x: -w, y: h }, { x: -w, y: h * 0.55 }, { x: -w * 0.3, y: h * 0.55 }, { x: -w * 0.3, y: -h * 0.55 }, { x: -w, y: -h * 0.55 }] : settings.profile === "round" ? Array.from({ length: settings.radialSegments }, (_, i) => ({ x: Math.cos(i / settings.radialSegments * Math.PI * 2) * w, y: Math.sin(i / settings.radialSegments * Math.PI * 2) * h })) : [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
    return sweepProfile(path, profile, settings, color);
  }
  const samples = samplePath(path, settings).map((sample) => ({ ...sample, p: { x: sample.p.x - sample.t.y * settings.offset, y: sample.p.y + sample.t.x * settings.offset } }));
  const random = seededRandom(settings.seed ?? 1);
  const placement = (s, i) => {
    const randomScale = Math.max(0, settings.randomScale ?? 0);
    const scale = Math.max(0.01, (settings.startScale + (settings.endScale - settings.startScale) * s.u) * (1 + (random() * 2 - 1) * randomScale));
    const randomRotation = (random() * 2 - 1) * (settings.randomRotation ?? 0);
    const alternate = settings.alternateRotation && i % 2 ? 90 : 0;
    const angle = Math.atan2(s.t.y, s.t.x) + ((settings.rotation ?? 0) + randomRotation + alternate) * Math.PI / 180;
    return { scale, angle, mirror: !!settings.mirrorAlternate && i % 2 === 1 };
  };
  if (settings.output === "chain") {
    const link = makeLink(radius * 1.25, radius * 0.28, color);
    return mergeOutputMeshes(samples.map((s, i) => {
      const p = placement(s, i);
      return transformCopy(link, s.p, p.angle + Math.PI / 2, p.scale, settings.chainAlternating && i % 2 ? Math.PI / 2 : 0, p.mirror);
    }), color);
  }
  if (settings.output === "cards") {
    const card = makeCard(radius * 2, radius * 2, color);
    const meshes = samples.flatMap((s, i) => {
      const p = placement(s, i);
      const first = transformCopy(card, s.p, p.angle, p.scale, 0, p.mirror);
      return settings.cardCrossed ? [first, transformCopy(card, s.p, p.angle, p.scale, Math.PI / 2, p.mirror)] : [first];
    });
    return mergeOutputMeshes(meshes, color);
  }
  const source = settings.sourceObject ? HalfEdgeMesh.fromObject(settings.sourceObject) : makeBox(radius * 1.3, radius * 1.3, radius * 1.3, color);
  return mergeOutputMeshes(samples.map((s, i) => {
    const p = placement(s, i);
    return transformCopy(source, s.p, p.angle, p.scale, 0, p.mirror);
  }), color);
}

// src/stroke/sketchSource.ts
function isSketchDoodleObject(obj) {
  return !!obj?.sketchSource;
}
function capBoundaryPoints(relative, maxPoints) {
  if (relative.length <= maxPoints) return relative;
  const out = [];
  const step = relative.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    out.push(relative[Math.min(relative.length - 1, Math.round(i * step))]);
  }
  return out;
}
var OUTLINE_BOUNDARY_HARD_CAP = 512;
var PATH_SPINE_HARD_CAP = 56;
var HAIR_PATH_SPINE_HARD_CAP = 48;
var HAIR_STRIP_SPINE_HARD_CAP = 14;
var PATH_CLEANUP_MIN_DISTANCE = 0.9;
function capsuleProfileRingsForBudget(polyBudget) {
  return Math.max(6, Math.min(12, Math.round(polyBudget / 20)));
}
function capsuleRadialSegments(segments) {
  return Math.max(6, Math.min(16, Math.round(segments ?? 8)));
}
function outlineBoundaryBudget(polyBudget, pointCount, closed) {
  const fromBudget = Math.max(closed ? 64 : 32, Math.floor(polyBudget * 2));
  return Math.max(
    closed ? 8 : 4,
    Math.min(pointCount, fromBudget, OUTLINE_BOUNDARY_HARD_CAP)
  );
}
function pathSpineBudget(polyBudget, pointCount) {
  const fromBudget = Math.max(16, Math.floor(polyBudget * 0.45));
  return Math.max(4, Math.min(pointCount, fromBudget, PATH_SPINE_HARD_CAP));
}
function resolveSilhouetteDepth(extrudeDepth, minMag = 4) {
  const mag = Math.max(minMag, Math.abs(extrudeDepth));
  return (Math.sign(extrudeDepth) || 1) * mag;
}
function outlineHalfWidthFromBrush(brushDensity) {
  return Math.max(2.5, brushDensity * 0.4);
}
function stripClosedDuplicate(points, eps = 0.01) {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) {
    return points.slice(0, -1).map((p) => ({ ...p }));
  }
  return points.map((p) => ({ ...p }));
}
function lightCleanupBoundary(points, closed, minDistance = 0.5) {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  let working = closed ? stripClosedDuplicate(points, minDistance) : points.map((p) => ({ ...p }));
  const deduped = [{ ...working[0] }];
  for (let i = 1; i < working.length; i++) {
    const p = working[i];
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= minDistance) {
      deduped.push({ ...p });
    } else if (!closed && i === working.length - 1) {
      deduped[deduped.length - 1] = { ...p };
    }
  }
  if (!closed && working.length >= 2) {
    deduped[deduped.length - 1] = { ...working[working.length - 1] };
  }
  return deduped;
}
function prepareOutlineBoundary(relative, polyBudget, closed) {
  const deduped = lightCleanupBoundary(relative, closed);
  if (closed) {
    if (deduped.length < 3) return null;
    const shaped = ensureCCW(deduped);
    const maxBoundary = outlineBoundaryBudget(polyBudget, shaped.length, true);
    if (shaped.length <= maxBoundary) return shaped;
    return capBoundaryPoints(shaped, maxBoundary);
  }
  if (deduped.length < 2) return null;
  const maxPath = outlineBoundaryBudget(polyBudget, deduped.length, false);
  return deduped.length <= maxPath ? deduped : capBoundaryPoints(deduped, maxPath);
}
function preparePathCenterline(relative, polyBudget) {
  const deduped = lightCleanupBoundary(relative, false, PATH_CLEANUP_MIN_DISTANCE);
  if (deduped.length < 2) return null;
  const maxSpine = pathSpineBudget(polyBudget, deduped.length);
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine);
}
function prepareHairPathCenterline(relative, polyBudget) {
  const deduped = lightCleanupBoundary(relative, false, PATH_CLEANUP_MIN_DISTANCE);
  if (deduped.length < 2) return null;
  const fromBudget = Math.max(12, Math.floor(polyBudget * 0.4));
  const maxSpine = Math.max(4, Math.min(deduped.length, fromBudget, HAIR_PATH_SPINE_HARD_CAP));
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine);
}
function prepareHairStripCenterline(relative, polyBudget) {
  const deduped = lightCleanupBoundary(relative, false, Math.max(PATH_CLEANUP_MIN_DISTANCE, 1.4));
  if (deduped.length < 2) return null;
  const fromBudget = Math.max(6, Math.floor(polyBudget * 0.12));
  const maxSpine = Math.max(3, Math.min(deduped.length, fromBudget, HAIR_STRIP_SPINE_HARD_CAP));
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine);
}

// src/stroke/sketchDoodle.ts
function strokeBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    diagonal: Math.hypot(width, height),
    shortSide: Math.min(width, height),
    longSide: Math.max(width, height)
  };
}
function strokePathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}
function effectiveCloseThreshold(points, baseThreshold) {
  if (points.length < 2) return baseThreshold;
  const { diagonal, shortSide } = strokeBounds(points);
  return Math.max(baseThreshold, shortSide * 0.12, diagonal * 0.07, 8);
}
function snapSketchStrokeClosed(points, baseThreshold) {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const gap = Math.hypot(first.x - last.x, first.y - last.y);
  const threshold = effectiveCloseThreshold(points, baseThreshold) * 1.25;
  const { shortSide, longSide } = strokeBounds(points);
  const pathLen = strokePathLength(points);
  const loopLike = pathLen >= Math.max(shortSide * 2, longSide * 0.75) && gap <= Math.max(threshold, effectiveCloseThreshold(points, baseThreshold) * 1.8);
  if (gap <= threshold || loopLike) {
    return [...points.slice(0, -1), { ...first }];
  }
  return points;
}
function strokeCentroid(points) {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length
  };
}
function relativePoints(points, center) {
  return points.map((p) => ({ x: p.x - center.x, y: p.y - center.y }));
}
function resampleSpacing(points, brushDensity) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  return Math.max(1.25, Math.min(3.8, diagonal / 48, brushDensity * 0.32));
}
function dedupeConsecutivePoints(points, epsilon = 0.01) {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = out[out.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > epsilon) out.push(p);
  }
  return out;
}
function cleanupDrawnPoints(points, minDistance = 2) {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const last = result[result.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) {
      result.push(p);
    }
  }
  const lastRaw = points[points.length - 1];
  const lastResult = result[result.length - 1];
  if (Math.hypot(lastRaw.x - lastResult.x, lastRaw.y - lastResult.y) >= 0.5) {
    result.push(lastRaw);
  } else {
    result[result.length - 1] = lastRaw;
  }
  return result;
}
function prepareSketchStroke(points, closeThreshold, brushDensity, options = {}) {
  if (points.length < 2) return null;
  const highFidelity = !!options.highFidelity;
  const forceOpen = !!options.forceOpen;
  const minCleanDist = options.preserveDetail || highFidelity ? 0.8 : 2;
  const cleaned = cleanupDrawnPoints(points, minCleanDist);
  if (cleaned.length < 2) return null;
  if (options.preserveDetail || highFidelity) {
    let work2 = dedupeConsecutivePoints(cleaned);
    if (!options.preserveDetail && !forceOpen) {
      work2 = snapSketchStrokeClosed(work2, closeThreshold);
    }
    const threshold2 = options.preserveDetail ? closeThreshold * 2.5 : effectiveCloseThreshold(work2, closeThreshold) * 2.5;
    let isClosed2 = !forceOpen && (options.pathClosed === true || classifyStroke(work2, threshold2) === "closed");
    if (isClosed2 && work2.length >= 3) {
      const first = work2[0];
      const last = work2[work2.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= (options.preserveDetail ? 0.01 : threshold2)) {
        work2 = work2.slice(0, -1);
      }
    }
    if (work2.length < 2) return null;
    const center2 = strokeCentroid(work2);
    return {
      points: work2,
      relative: relativePoints(work2, center2),
      center: center2,
      isClosed: isClosed2 && work2.length >= 3
    };
  }
  const snapped = snapSketchStrokeClosed(cleaned, closeThreshold);
  const threshold = effectiveCloseThreshold(snapped, closeThreshold) * 2.5;
  let isClosed = classifyStroke(snapped, threshold) === "closed";
  let work = [...snapped];
  if (isClosed && work.length >= 3) {
    const first = work[0];
    const last = work[work.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= threshold) {
      work = work.slice(0, -1);
    }
  }
  const spacing = resampleSpacing(work, brushDensity);
  let resampled = isClosed && work.length >= 3 ? resampleUniformClosed(work, spacing) : resampleUniform(work, spacing);
  if (resampled.length < 2) return null;
  if (!isClosed) {
    isClosed = classifyStroke(resampled, threshold) === "closed";
    if (isClosed && work.length >= 3) {
      resampled = resampleUniformClosed(work, spacing);
    }
  }
  const loopPoints = isClosed && resampled.length >= 3 ? resampled : resampled;
  const center = strokeCentroid(loopPoints);
  return {
    points: resampled,
    relative: relativePoints(loopPoints, center),
    center,
    isClosed: isClosed && loopPoints.length >= 3
  };
}
function capBoundaryPoints2(relative, maxPoints) {
  if (relative.length <= maxPoints) return relative;
  const out = [];
  const step = relative.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    out.push(relative[Math.min(relative.length - 1, Math.round(i * step))]);
  }
  return out;
}
function resolveExtrudeDepth(input, brushDensity) {
  if (input.extrudeAmount != null) return input.extrudeAmount;
  return Math.max(8, brushDensity * 1.2);
}
function buildClosedSoftBlob(relative, polyBudget, extrudeDepth, inflation = 0.65, preserveDetail = false) {
  const budgetRings = polyBudget < 64 ? 2 : polyBudget < 128 ? 3 : polyBudget < 224 ? 4 : 5;
  const rings = budgetRings + 2;
  const vertexRingCount = budgetRings + 1;
  const budgetedBoundary = Math.floor(polyBudget / vertexRingCount);
  const maxBoundary = preserveDetail ? Math.min(relative.length, Math.max(8, budgetedBoundary)) : Math.max(8, Math.min(relative.length, budgetedBoundary, 28));
  const boundary = relative.length <= maxBoundary ? relative : capBoundaryPoints2(relative, maxBoundary);
  return generateSoftInflateDome(boundary, {
    depth: Math.max(4, Math.abs(extrudeDepth)),
    rings,
    inflation,
    color: 0
  });
}
function buildClosedSharpExtrusion(relative, extrudeDepth, color) {
  return extrudeSilhouette(relative, {
    depth: resolveSilhouetteDepth(extrudeDepth),
    color
  });
}
function buildOpenSoftTube(relative, brushDensity, polyBudget) {
  const spine = preparePathCenterline(relative, polyBudget);
  if (!spine) return null;
  return generateCapsuleSweep(spine, {
    radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
    radialSegments: primitiveSegmentsForBudget(polyBudget, 8),
    closed: false,
    hemiRings: 0,
    preserveSpine: true
  });
}
function buildFilledOutline(relative, brushDensity, extrudeDepth, closed, color, polyBudget) {
  const depth = resolveSilhouetteDepth(extrudeDepth);
  if (closed) {
    const budgetRings = polyBudget < 64 ? 2 : polyBudget < 128 ? 3 : polyBudget < 224 ? 4 : 5;
    const maxBoundary = Math.max(8, Math.min(28, Math.floor(polyBudget / (budgetRings + 1))));
    const prepared = prepareOutlineBoundary(relative, polyBudget, true);
    const boundary = prepared && prepared.length > maxBoundary ? capBoundaryPoints2(prepared, maxBoundary) : prepared;
    if (!boundary || boundary.length < 3) return null;
    return generateSoftInflateDome(boundary, {
      depth: Math.abs(depth),
      rings: budgetRings,
      inflation: 0,
      color
    });
  }
  const path = prepareOutlineBoundary(relative, polyBudget, false);
  if (!path || path.length < 2) return null;
  const halfWidth = outlineHalfWidthFromBrush(brushDensity);
  const ribbon = strokeToFlatOutline(path, halfWidth);
  if (!ribbon || ribbon.length < 3) return null;
  return extrudeSilhouette(ribbon, { depth, color });
}
function finalizeSketchMesh(mesh, center, view, depth, color, polyBudget, name, sketchSource, smoothShading = false, tubePathPlane, uvFlags) {
  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = color;
  offsetMeshInPlane(mesh, center.x, center.y);
  projectMeshToView(mesh, view, depth, sketchSource.planeFrame);
  if (tubePathPlane && tubePathPlane.length >= 2) {
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(tubePathPlane, view, depth, sketchSource.planeFrame)
    );
  } else {
    ensureClosedMeshOutward(mesh);
  }
  return mesh.toObject(generateId(), name, {
    polyBudget: Math.max(mesh.vertexCount(), polyBudget),
    color,
    polyBudgetMode: "strict",
    smoothShading,
    sketchSource,
    uvAutoPacked: uvFlags?.uvAutoPacked,
    uvMappingMode: uvFlags?.uvMappingMode,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale }
    }
  });
}
function makeSketchSource(prepared, input, kind, extrudeDepth) {
  const hairKind = kind === "ribbon" || kind === "tapered-tube" || kind === "hair-path" || kind === "hair-strip" || kind === "hair-round";
  const tipStyle = input.hairTipStyle === "square" ? "square" : "pointed";
  return {
    relative: prepared.relative.map((p) => ({ ...p })),
    center: { ...prepared.center },
    view: input.view,
    brushDensity: input.brushDensity,
    polyBudget: input.polyBudget,
    closeThreshold: input.closeThreshold,
    defaultDepth: input.defaultDepth,
    isClosed: prepared.isClosed,
    kind,
    extrudeDepth,
    ...kind === "soft" ? { inflation: input.blobInflation ?? 0.65 } : {},
    planeFrame: input.planeFrame ?? null,
    ...hairKind ? { tipStyle } : {},
    ...kind === "path" || kind === "capsule-path" || kind === "capsule-shape" ? {
      pathStartCap: input.pathStartCap ?? "flat",
      pathEndCap: input.pathEndCap ?? "flat",
      pathRadialSegments: input.pathRadialSegments ?? 8,
      pathRadiusScale: input.pathRadiusScale ?? 1,
      pathOutput: input.pathOutput ?? "tube",
      pathStartScale: input.pathStartScale ?? 1,
      pathEndScale: input.pathEndScale ?? 1,
      pathTwist: input.pathTwist ?? 360,
      pathSpacing: input.pathSpacing ?? 16,
      pathOffset: input.pathOffset ?? 0,
      pathProfile: input.pathProfile ?? "round",
      pathProfileWidth: input.pathProfileWidth ?? 1,
      pathProfileHeight: input.pathProfileHeight ?? 1,
      pathChainAlternating: input.pathChainAlternating ?? true,
      pathCardCrossed: input.pathCardCrossed ?? false,
      pathDistributionMode: input.pathDistributionMode ?? "spacing",
      pathCount: input.pathCount ?? 8,
      pathStartPadding: input.pathStartPadding ?? 0,
      pathEndPadding: input.pathEndPadding ?? 0,
      pathRandomScale: input.pathRandomScale ?? 0,
      pathRotation: input.pathRotation ?? 0,
      pathRandomRotation: input.pathRandomRotation ?? 0,
      pathAlternateRotation: input.pathAlternateRotation ?? false,
      pathMirrorAlternate: input.pathMirrorAlternate ?? false,
      pathSeed: input.pathSeed ?? 1,
      pathKeepInstances: input.pathKeepInstances ?? true,
      pathSourceObjectId: input.pathSourceObjectId ?? null,
      pathSourceObject: input.pathSourceObject ? (() => {
        const { sketchSource: _sketch, vectorSource: _vector, ...snapshot } = input.pathSourceObject;
        return {
          ...snapshot,
          positions: snapshot.positions.map((p) => ({ ...p })),
          faces: snapshot.faces.map((face) => [...face]),
          faceColors: [...snapshot.faceColors],
          uvs: snapshot.uvs?.map((uv) => ({ ...uv })),
          faceUvIndices: snapshot.faceUvIndices?.map((face) => [...face])
        };
      })() : null,
      ribbonStartTip: input.ribbonStartTip ?? "square",
      ribbonEndTip: input.ribbonEndTip ?? "square",
      ribbonTaper: input.ribbonTaper ?? 0.35,
      ribbonFlat: input.ribbonFlat ?? false
    } : {},
    ...kind === "ribbon" ? {
      ribbonStartTip: input.ribbonStartTip ?? "square",
      ribbonEndTip: input.ribbonEndTip ?? "square",
      ribbonTaper: input.ribbonTaper ?? 0.35,
      ribbonWidthScale: input.ribbonWidthScale ?? 1,
      ribbonFlat: input.ribbonFlat ?? false
    } : {}
  };
}
function softSketchDoodleToObject(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed
  });
  if (!prepared) return null;
  const { relative, center, isClosed } = prepared;
  const extrudeDepth = resolveExtrudeDepth(input, brushDensity);
  const kind = isClosed ? "soft" : "path";
  const mesh = isClosed ? buildClosedSoftBlob(relative, polyBudget, extrudeDepth, input.blobInflation ?? 0.65, !!input.preserveDetail) : buildOpenSoftTube(relative, brushDensity, polyBudget);
  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const doodleName = name ?? (isClosed ? "Doodle" : "Doodle Path");
  const source = makeSketchSource(prepared, input, kind, extrudeDepth);
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false,
    isClosed ? void 0 : prepared.points
  );
}
function outlineSketchDoodleToObject(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
    highFidelity: true
  });
  if (!prepared) return null;
  const { relative, center, isClosed } = prepared;
  const extrudeDepth = resolveSilhouetteDepth(resolveExtrudeDepth(input, brushDensity));
  const mesh = buildFilledOutline(relative, brushDensity, extrudeDepth, isClosed, color, polyBudget);
  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const doodleName = name ?? (isClosed ? "Outline" : "Outline Path");
  const source = makeSketchSource(prepared, input, "outline", extrudeDepth);
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false
  );
}
function pathSketchDoodleToObject(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: true
  });
  if (!prepared) return null;
  const { relative, center } = prepared;
  const extrudeDepth = resolveExtrudeDepth(input, brushDensity);
  const radius = Math.max(2.5, Math.min(14, brushDensity * 0.55)) * (input.pathRadiusScale ?? 1);
  const spine = preparePathCenterline(relative, polyBudget);
  if (!spine) return null;
  const mesh = generatePathOutput(spine, {
    output: input.pathOutput ?? "tube",
    radius,
    radialSegments: input.pathRadialSegments ?? primitiveSegmentsForBudget(polyBudget, 8),
    startCap: input.pathStartCap ?? "flat",
    endCap: input.pathEndCap ?? "flat",
    startScale: input.pathStartScale ?? 1,
    endScale: input.pathEndScale ?? 1,
    twist: input.pathTwist ?? 360,
    spacing: input.pathSpacing ?? 16,
    offset: input.pathOffset ?? 0,
    ribbonStartTip: input.ribbonStartTip ?? "square",
    ribbonEndTip: input.ribbonEndTip ?? "square",
    ribbonTaper: input.ribbonTaper ?? 0.35,
    ribbonFlat: input.ribbonFlat ?? false,
    profile: input.pathProfile ?? "round",
    profileWidth: input.pathProfileWidth ?? 1,
    profileHeight: input.pathProfileHeight ?? 1,
    chainAlternating: input.pathChainAlternating ?? true,
    cardCrossed: input.pathCardCrossed ?? false,
    sourceObject: input.pathSourceObject,
    distributionMode: input.pathDistributionMode ?? "spacing",
    count: input.pathCount ?? 8,
    startPadding: input.pathStartPadding ?? 0,
    endPadding: input.pathEndPadding ?? 0,
    randomScale: input.pathRandomScale ?? 0,
    rotation: input.pathRotation ?? 0,
    randomRotation: input.pathRandomRotation ?? 0,
    alternateRotation: input.pathAlternateRotation ?? false,
    mirrorAlternate: input.pathMirrorAlternate ?? false,
    seed: input.pathSeed ?? 1
  }, color);
  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    "path",
    extrudeDepth
  );
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    name ?? { tube: "Path", ribbon: "Ribbon", chain: "Chain", vine: "Vine", rope: "Rope", cards: "2D Cards", "object-array": "Object Array", "profile-sweep": "Profile Sweep" }[input.pathOutput ?? "tube"],
    source,
    false,
    prepared.points
  );
}
function capsuleSketchDoodleToObject(input) {
  const { points, view, polyBudget, brushDensity, closeThreshold, defaultDepth, color, name } = input;
  if (points.length < 2 || view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
    highFidelity: true
  });
  if (!prepared) return null;
  const depth = Math.max(2, Math.abs(input.extrudeAmount ?? brushDensity));
  let mesh;
  let kind;
  if (prepared.isClosed) {
    const boundary = prepareOutlineBoundary(prepared.relative, polyBudget, true);
    if (!boundary || boundary.length < 3) return null;
    mesh = generateVerticalShapedCapsule(boundary, {
      radialSegments: capsuleRadialSegments(input.pathRadialSegments),
      profileRings: capsuleProfileRingsForBudget(polyBudget),
      preserveBoundary: true,
      color
    });
    kind = "capsule-shape";
  } else {
    const spine = preparePathCenterline(prepared.relative, polyBudget);
    if (!spine) return null;
    mesh = generateCapsuleSweep(spine, {
      radius: depth,
      radialSegments: capsuleRadialSegments(input.pathRadialSegments),
      closed: false,
      hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
      preserveSpine: true,
      color,
      startCap: "round",
      endCap: "round"
    });
    kind = "capsule-path";
  }
  if (!mesh.vertexCount() || !mesh.faces.length) return null;
  const source = makeSketchSource(prepared, input, kind, depth);
  return ensureObjectUVs(finalizeSketchMesh(mesh, prepared.center, view, defaultDepth, color, polyBudget, name ?? "Capsule", source, true, prepared.isClosed ? void 0 : prepared.points, { uvAutoPacked: true, uvMappingMode: "box" }));
}
function sharpSketchDoodleToObject(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    extrudeAmount,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
    // Same fidelity as Outline — Extrude must track the drawn loop.
    highFidelity: true
  });
  if (!prepared) return null;
  const { relative, center, isClosed } = prepared;
  const extrudeDepth = resolveSilhouetteDepth(
    extrudeAmount ?? resolveExtrudeDepth(input, brushDensity)
  );
  if (!isClosed) {
    const mesh2 = buildFilledOutline(
      relative,
      brushDensity,
      extrudeDepth,
      false,
      color,
      polyBudget
    );
    if (!mesh2 || mesh2.vertexCount() === 0 || mesh2.faces.length === 0) return null;
    const doodleName2 = name ?? "Outline Path";
    const source2 = makeSketchSource(prepared, input, "outline", extrudeDepth);
    return finalizeSketchMesh(
      mesh2,
      center,
      view,
      defaultDepth,
      color,
      polyBudget,
      doodleName2,
      source2,
      false
    );
  }
  const kind = "sharp";
  const boundary = prepareOutlineBoundary(relative, polyBudget, true);
  if (!boundary || boundary.length < 3) return null;
  const mesh = buildClosedSharpExtrusion(boundary, extrudeDepth, color);
  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const doodleName = name ?? "Extrude";
  const source = makeSketchSource(prepared, input, kind, extrudeDepth);
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false
  );
}
function hairSketchDoodleToObject(input, style) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: style === "path"
  });
  if (!prepared) return null;
  const { relative, center } = prepared;
  const spine = style === "strip" ? prepareHairStripCenterline(relative, polyBudget) : prepareHairPathCenterline(relative, polyBudget);
  if (!spine) return null;
  const extrudeDepth = resolveHairDepth(input.extrudeAmount, brushDensity, style);
  const tipStyle = input.hairTipStyle === "square" ? "square" : "pointed";
  const mesh = generateHairRibbon(spine, {
    halfWidth: hairHalfWidthFromBrush(brushDensity, style) * (input.ribbonWidthScale ?? 1),
    depth: extrudeDepth,
    color,
    flat: input.ribbonFlat ?? style === "strip",
    tipStyle,
    startTipStyle: input.ribbonStartTip ?? tipStyle,
    endTipStyle: input.ribbonEndTip ?? tipStyle,
    taperFraction: input.ribbonTaper ?? 0.35
  });
  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const kind = style === "strip" ? "hair-strip" : "hair-path";
  const doodleName = name ?? (style === "strip" ? "Hair Strips" : "Hair Paths");
  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    kind,
    extrudeDepth
  );
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false,
    void 0,
    { uvAutoPacked: true, uvMappingMode: "box" }
  );
}
function ribbonSketchDoodleToObject(input) {
  const object = hairSketchDoodleToObject(
    { ...input, hairTipStyle: "square", name: input.name ?? "Ribbon" },
    "path"
  );
  if (!object?.sketchSource) return object;
  return {
    ...object,
    name: input.name ?? "Ribbon",
    sketchSource: {
      ...object.sketchSource,
      kind: "ribbon",
      tipStyle: "square",
      ribbonStartTip: input.ribbonStartTip ?? "square",
      ribbonEndTip: input.ribbonEndTip ?? "square",
      ribbonTaper: input.ribbonTaper ?? 0.35,
      ribbonWidthScale: input.ribbonWidthScale ?? 1,
      ribbonFlat: input.ribbonFlat ?? false
    }
  };
}
function taperedTubeSketchDoodleToObject(input) {
  const object = roundedHairSketchDoodleToObject({
    ...input,
    hairTipStyle: "pointed",
    name: input.name ?? "Tapered Tube"
  });
  if (!object?.sketchSource) return object;
  return { ...object, name: input.name ?? "Tapered Tube", sketchSource: { ...object.sketchSource, kind: "tapered-tube", tipStyle: "pointed" } };
}
function roundedHairSketchDoodleToObject(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !input.planeFrame) return null;
  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: true
  });
  if (!prepared) return null;
  const { relative, center } = prepared;
  const spine = prepareHairPathCenterline(relative, polyBudget);
  if (!spine) return null;
  const extrudeDepth = input.extrudeAmount != null && Number.isFinite(input.extrudeAmount) ? input.extrudeAmount : 12;
  const mesh = generateTaperedPointedTube(spine, {
    radius: resolveRoundedHairRadius(input.extrudeAmount, brushDensity),
    radialSegments: Math.max(6, Math.min(8, primitiveSegmentsForBudget(polyBudget, 7))),
    preserveSpine: true,
    color,
    tipStyle: input.hairTipStyle === "square" ? "square" : "pointed"
  });
  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null;
  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    "hair-round",
    extrudeDepth
  );
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    name ?? "Rounded Hair",
    source,
    false,
    void 0,
    { uvAutoPacked: true, uvMappingMode: "box" }
  );
}

// src/mesh/lathe.ts
function addRingCap(mesh, ring, height, axis, normalSign) {
  if (ring.length < 3) return;
  const ci = mesh.positions.length;
  if (axis === "y") {
    mesh.positions.push({ x: 0, y: height, z: 0 });
  } else {
    mesh.positions.push({ x: height, y: 0, z: 0 });
  }
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    if (normalSign < 0) {
      mesh.faces.push([ci, ring[next], ring[i]]);
    } else {
      mesh.faces.push([ci, ring[i], ring[next]]);
    }
    mesh.faceColors.push(7261173);
  }
}
function generateLathe(profile, options) {
  const {
    radialSegments,
    minAngleDeg = 15,
    axis = "y",
    depth = 0,
    preserveProfile = false,
    capBottom = false,
    capTop = false
  } = options;
  const sampled = preserveProfile ? profile.filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-6) : curvatureSampleProfile(profile, minAngleDeg, radialSegments + 2);
  const mesh = new HalfEdgeMesh();
  const segments = Math.max(3, radialSegments);
  const ringVerts = [];
  for (let ri = 0; ri < sampled.length; ri++) {
    const { x: radius, y: height } = sampled[ri];
    const ring = [];
    if (ri === 0 && radius < 0.01) {
      const poleIdx = mesh.positions.length;
      if (axis === "y") {
        mesh.positions.push({ x: 0, y: height + depth, z: 0 });
      } else {
        mesh.positions.push({ x: height + depth, y: 0, z: 0 });
      }
      ring.push(poleIdx);
    } else if (ri === sampled.length - 1 && radius < 0.01) {
      const poleIdx = mesh.positions.length;
      if (axis === "y") {
        mesh.positions.push({ x: 0, y: height + depth, z: 0 });
      } else {
        mesh.positions.push({ x: height + depth, y: 0, z: 0 });
      }
      ring.push(poleIdx);
    } else {
      for (let si = 0; si < segments; si++) {
        const angle = si / segments * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const vi = mesh.positions.length;
        if (axis === "y") {
          mesh.positions.push({
            x: cos * radius,
            y: height + depth,
            z: sin * radius
          });
        } else {
          mesh.positions.push({
            x: height + depth,
            y: cos * radius,
            z: sin * radius
          });
        }
        ring.push(vi);
      }
    }
    ringVerts.push(ring);
  }
  for (let ri = 0; ri < ringVerts.length - 1; ri++) {
    const ringA = ringVerts[ri];
    const ringB = ringVerts[ri + 1];
    if (ringA.length === 1 && ringB.length > 1) {
      for (let si = 0; si < ringB.length; si++) {
        const next = (si + 1) % ringB.length;
        mesh.faces.push([ringA[0], ringB[si], ringB[next]]);
        mesh.faceColors.push(7261173);
      }
    } else if (ringB.length === 1 && ringA.length > 1) {
      for (let si = 0; si < ringA.length; si++) {
        const next = (si + 1) % ringA.length;
        mesh.faces.push([ringB[0], ringA[next], ringA[si]]);
        mesh.faceColors.push(7261173);
      }
    } else if (ringA.length > 1 && ringB.length > 1) {
      for (let si = 0; si < segments; si++) {
        const next = (si + 1) % segments;
        const a = ringA[si];
        const b = ringA[next];
        const c = ringB[si];
        const d = ringB[next];
        mesh.faces.push([a, c, d, b]);
        mesh.faceColors.push(7261173);
      }
    }
  }
  if (capBottom && ringVerts[0].length > 1) {
    addRingCap(mesh, ringVerts[0], sampled[0].y + depth, axis, -1);
  }
  if (capTop && ringVerts.length > 0) {
    const last = ringVerts.length - 1;
    const lastRing = ringVerts[last];
    if (lastRing.length > 1) {
      addRingCap(mesh, lastRing, sampled[last].y + depth, axis, 1);
    }
  }
  mesh.buildHalfEdges();
  return mesh;
}

// src/mesh/bead.ts
function generateBeadFromEllipse(ellipse, options) {
  const { radialSegments, minAngleDeg = 18 } = options;
  const { rx, ry } = ellipse;
  const rawProfile = [];
  const steps = Math.max(6, options.profileRings ?? 8);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = -ry + t * 2 * ry;
    const nv = ry > 0 ? v / ry : 0;
    const r = rx * Math.sqrt(Math.max(0, 1 - nv * nv * 0.92));
    rawProfile.push({ x: r, y: v });
  }
  const profile = curvatureSampleProfile(rawProfile, minAngleDeg, steps + 2);
  return generateLathe(profile, {
    radialSegments,
    minAngleDeg,
    axis: "y",
    depth: 0
  });
}
function generateBeadFromSilhouette(silhouette, radialSegments, minAngleDeg = 18) {
  const cx = silhouette.reduce((s, p) => s + p.x, 0) / silhouette.length;
  const cy = silhouette.reduce((s, p) => s + p.y, 0) / silhouette.length;
  const radii = silhouette.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const rx = Math.max(...radii, 0.5);
  const minY = Math.min(...silhouette.map((p) => p.y));
  const maxY = Math.max(...silhouette.map((p) => p.y));
  const ry = Math.max((maxY - minY) / 2, 0.5);
  return generateBeadFromEllipse(
    { cx, cy, rx, ry, aspectRatio: Math.min(rx, ry) / Math.max(rx, ry), circularity: 0.8 },
    { radialSegments, minAngleDeg }
  );
}

// src/mesh/capsulePillow.ts
function boundaryCentroid(boundary) {
  let x = 0;
  let y = 0;
  for (const p of boundary) {
    x += p.x;
    y += p.y;
  }
  const n = boundary.length;
  return { x: x / n, y: y / n };
}
function scaleBoundaryRing(mesh, boundary, centroid, scale, z) {
  const ring = [];
  for (const p of boundary) {
    ring.push(mesh.positions.length);
    mesh.positions.push({
      x: centroid.x + (p.x - centroid.x) * scale,
      y: centroid.y + (p.y - centroid.y) * scale,
      z
    });
  }
  return ring;
}
function stitchRingPair2(mesh, ringA, ringB, color) {
  const segments = ringA.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    mesh.faces.push([ringA[si], ringA[next], ringB[next]]);
    mesh.faces.push([ringA[si], ringB[next], ringB[si]]);
    mesh.faceColors.push(color, color);
  }
}
function fanPole2(mesh, pole, ring, color, poleIsMin) {
  const segments = ring.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    if (poleIsMin) {
      mesh.faces.push([pole, ring[next], ring[si]]);
    } else {
      mesh.faces.push([pole, ring[si], ring[next]]);
    }
    mesh.faceColors.push(color);
  }
}
function hemiScale(t) {
  return Math.sqrt(Math.max(0, t * (2 - t)));
}
function generateCapsulePillow(polygon, options) {
  const {
    depth: rawDepth,
    minAngleDeg = 12,
    maxBoundaryVerts = 48,
    hemiRings = LOW_POLY_CAPSULE_HEMI_RINGS,
    preserveBoundary = false,
    color = 16098926
  } = options;
  const mesh = new HalfEdgeMesh();
  const ccw = ensureCCW(polygon);
  const boundary = preserveBoundary ? ccw : curvatureSampleClosedLoop(ccw, minAngleDeg, maxBoundaryVerts);
  if (boundary.length < 3) return mesh;
  const depth = Math.max(1.6, rawDepth);
  const fitR = depth / 2;
  const centroid = boundaryCentroid(boundary);
  const bands = Math.max(2, hemiRings);
  const rings = [];
  const bottomPole = mesh.positions.length;
  mesh.positions.push({ x: centroid.x, y: centroid.y, z: 0 });
  for (let ri = 1; ri < bands; ri++) {
    const t = ri / bands;
    rings.push(scaleBoundaryRing(mesh, boundary, centroid, hemiScale(t), fitR * t));
  }
  rings.push(scaleBoundaryRing(mesh, boundary, centroid, 1, fitR));
  for (let ri = bands - 1; ri >= 1; ri--) {
    const t = ri / bands;
    rings.push(
      scaleBoundaryRing(mesh, boundary, centroid, hemiScale(t), depth - fitR * t)
    );
  }
  const topPole = mesh.positions.length;
  mesh.positions.push({ x: centroid.x, y: centroid.y, z: depth });
  if (rings.length > 0) {
    fanPole2(mesh, bottomPole, rings[0], color, true);
    for (let ri = 0; ri < rings.length - 1; ri++) {
      stitchRingPair2(mesh, rings[ri], rings[ri + 1], color);
    }
    fanPole2(mesh, topPole, rings[rings.length - 1], color, false);
  }
  mesh.buildHalfEdges();
  return mesh;
}

// src/mesh/meshSafety.ts
function faceArea(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const nx = ab.y * ac.z - ab.z * ac.y;
  const ny = ab.z * ac.x - ab.x * ac.z;
  const nz = ab.x * ac.y - ab.y * ac.x;
  return Math.hypot(nx, ny, nz) * 0.5;
}
function meshCentroid2(mesh) {
  if (mesh.positions.length === 0) return { x: 0, y: 0, z: 0 };
  const c = mesh.positions.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 }
  );
  c.x /= mesh.positions.length;
  c.y /= mesh.positions.length;
  c.z /= mesh.positions.length;
  return c;
}
function removeDegenerateFaces(mesh, minArea = 1e-10) {
  const validFaces = [];
  const validColors = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi];
    if (f.length < 3) continue;
    const a = mesh.positions[f[0]];
    const b = mesh.positions[f[1]];
    const c = mesh.positions[f[2]];
    if (faceArea(a, b, c) < minArea) continue;
    validFaces.push(f);
    validColors.push(mesh.faceColors[fi] ?? 8309665);
  }
  mesh.faces = validFaces;
  mesh.faceColors = validColors;
}
function removeUnreferencedVertices(mesh) {
  const used = /* @__PURE__ */ new Set();
  for (const f of mesh.faces) {
    for (const vi of f) used.add(vi);
  }
  const oldToNew = /* @__PURE__ */ new Map();
  const newPositions = [];
  for (const vi of [...used].sort((a, b) => a - b)) {
    oldToNew.set(vi, newPositions.length);
    newPositions.push({ ...mesh.positions[vi] });
  }
  mesh.positions = newPositions;
  mesh.faces = mesh.faces.map((f) => f.map((vi) => oldToNew.get(vi)));
}
function weldCoincidentVertices(mesh, epsilon = 1e-4) {
  const n = mesh.positions.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let curr = i;
    while (parent[curr] !== curr) {
      const next = parent[curr];
      parent[curr] = root;
      curr = next;
    }
    return root;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = mesh.positions[i];
      const pj = mesh.positions[j];
      if (Math.hypot(pi.x - pj.x, pi.y - pj.y, pi.z - pj.z) < epsilon) unite(i, j);
    }
  }
  const roots = /* @__PURE__ */ new Set();
  for (let i = 0; i < n; i++) roots.add(find(i));
  if (roots.size === n) return;
  const oldToNew = /* @__PURE__ */ new Map();
  const newPositions = [];
  for (const root of [...roots].sort((a, b) => a - b)) {
    oldToNew.set(root, newPositions.length);
    newPositions.push({ ...mesh.positions[root] });
  }
  const remap = (vi) => oldToNew.get(find(vi));
  mesh.positions = newPositions;
  mesh.faces = mesh.faces.map((f) => {
    const mapped = f.map(remap);
    const unique = mapped.filter((v, idx, arr) => arr.indexOf(v) === idx);
    return unique.length >= 3 ? unique : null;
  }).filter((f) => f !== null);
}
function fixInvertedNormals(mesh) {
  const center = meshCentroid2(mesh);
  for (const f of mesh.faces) {
    if (f.length < 3) continue;
    const a = mesh.positions[f[0]];
    const b = mesh.positions[f[1]];
    const c = mesh.positions[f[2]];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nx = ab.y * ac.z - ab.z * ac.y;
    const ny = ab.z * ac.x - ab.x * ac.z;
    const nz = ab.x * ac.y - ab.y * ac.x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    const fc = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3
    };
    const toCenter = {
      x: center.x - fc.x,
      y: center.y - fc.y,
      z: center.z - fc.z
    };
    const dot = (nx * toCenter.x + ny * toCenter.y + nz * toCenter.z) / len;
    if (dot > 0) f.reverse();
  }
}
function fillSmallHoles(mesh, maxLoopLen = 6) {
  mesh.buildHalfEdges();
  const edgeCount = /* @__PURE__ */ new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.length; i++) {
      const v0 = f[i];
      const v1 = f[(i + 1) % f.length];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  const boundaryEdges = [];
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const [a, b] = key.split("_").map(Number);
    boundaryEdges.push([a, b]);
  }
  if (boundaryEdges.length === 0 || boundaryEdges.length > maxLoopLen * 3) return;
  const adj = /* @__PURE__ */ new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const visited = /* @__PURE__ */ new Set();
  for (const [start] of boundaryEdges) {
    const loop = [];
    let curr = start;
    let prev = -1;
    for (let step = 0; step < maxLoopLen + 2; step++) {
      loop.push(curr);
      const neighbors = adj.get(curr) ?? [];
      const next = neighbors.find((n) => n !== prev);
      if (next === void 0) break;
      const eKey = curr < next ? `${curr}_${next}` : `${next}_${curr}`;
      if (visited.has(eKey)) break;
      visited.add(eKey);
      prev = curr;
      curr = next;
      if (curr === start && loop.length >= 3) {
        if (loop.length <= maxLoopLen) {
          const anchor = loop[0];
          for (let i = 1; i < loop.length - 1; i++) {
            mesh.faces.push([anchor, loop[i], loop[i + 1]]);
            mesh.faceColors.push(mesh.faceColors[0] ?? 8309665);
          }
        }
        break;
      }
    }
  }
}
function meshSafetyPass(mesh) {
  removeDegenerateFaces(mesh);
  removeUnreferencedVertices(mesh);
  weldCoincidentVertices(mesh);
  fixInvertedNormals(mesh);
  fillSmallHoles(mesh);
  removeDegenerateFaces(mesh);
  removeUnreferencedVertices(mesh);
  mesh.buildHalfEdges();
  return mesh;
}

// src/mesh/dualContouring.ts
function cornerIdx(i, j, k, nx, ny) {
  return i + (nx + 1) * j + (nx + 1) * (ny + 1) * k;
}
function cornerPos(grid, i, j, k) {
  return {
    x: grid.origin.x + i * grid.spacing.x,
    y: grid.origin.y + j * grid.spacing.y,
    z: grid.origin.z + k * grid.spacing.z
  };
}
function edgeCrossing(p0, p1, v0, v1, iso) {
  if (v0 <= iso && v1 <= iso || v0 > iso && v1 > iso) return null;
  const denom = v1 - v0;
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - v0) / denom;
  const s = Math.max(0, Math.min(1, t));
  return {
    x: p0.x + (p1.x - p0.x) * s,
    y: p0.y + (p1.y - p0.y) * s,
    z: p0.z + (p1.z - p0.z) * s
  };
}
function cubeKey(i, j, k) {
  return `${i},${j},${k}`;
}
function extractDualContour(grid, options = {}) {
  const { isoValue = 0, color = 8309665 } = options;
  const mesh = new HalfEdgeMesh();
  const { nx, ny, nz, values } = grid;
  const cubeVerts = /* @__PURE__ */ new Map();
  const sample = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i > nx || j > ny || k > nz) return 1;
    return values[cornerIdx(i, j, k, nx, ny)];
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const corners = [
          sample(i, j, k),
          sample(i + 1, j, k),
          sample(i, j + 1, k),
          sample(i + 1, j + 1, k),
          sample(i, j, k + 1),
          sample(i + 1, j, k + 1),
          sample(i, j + 1, k + 1),
          sample(i + 1, j + 1, k + 1)
        ];
        const inside = corners.some((v) => v <= isoValue);
        const outside = corners.some((v) => v > isoValue);
        if (!inside || !outside) continue;
        const c000 = cornerPos(grid, i, j, k);
        const c100 = cornerPos(grid, i + 1, j, k);
        const c010 = cornerPos(grid, i, j + 1, k);
        const c110 = cornerPos(grid, i + 1, j + 1, k);
        const c001 = cornerPos(grid, i, j, k + 1);
        const c101 = cornerPos(grid, i + 1, j, k + 1);
        const c011 = cornerPos(grid, i, j + 1, k + 1);
        const c111 = cornerPos(grid, i + 1, j + 1, k + 1);
        const crossings = [];
        const edges = [
          [c000, c100, corners[0], corners[1]],
          [c010, c110, corners[2], corners[3]],
          [c001, c101, corners[4], corners[5]],
          [c011, c111, corners[6], corners[7]],
          [c000, c010, corners[0], corners[2]],
          [c100, c110, corners[1], corners[3]],
          [c101, c111, corners[5], corners[7]],
          [c001, c011, corners[4], corners[6]],
          [c000, c001, corners[0], corners[4]],
          [c100, c101, corners[1], corners[5]],
          [c110, c111, corners[3], corners[7]],
          [c010, c011, corners[2], corners[6]]
        ];
        for (const [p0, p1, v0, v1] of edges) {
          const c = edgeCrossing(p0, p1, v0, v1, isoValue);
          if (c) crossings.push(c);
        }
        if (crossings.length === 0) continue;
        const vtx = crossings.reduce(
          (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
          { x: 0, y: 0, z: 0 }
        );
        vtx.x /= crossings.length;
        vtx.y /= crossings.length;
        vtx.z /= crossings.length;
        cubeVerts.set(cubeKey(i, j, k), mesh.positions.length);
        mesh.positions.push(vtx);
      }
    }
  }
  const getCube = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return null;
    return cubeVerts.get(cubeKey(i, j, k)) ?? null;
  };
  const pushQuad = (a, b, c, d) => {
    mesh.faces.push([a, b, c]);
    mesh.faces.push([a, c, d]);
    mesh.faceColors.push(color, color);
  };
  const pushTri = (a, b, c) => {
    mesh.faces.push([a, b, c]);
    mesh.faceColors.push(color);
  };
  const edgeCrosses = (v0, v1) => v0 <= isoValue && v1 > isoValue || v0 > isoValue && v1 <= isoValue;
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i + 1, j, k))) continue;
        const q = [
          getCube(i, j, k),
          getCube(i, j - 1, k),
          getCube(i, j - 1, k - 1),
          getCube(i, j, k - 1)
        ].filter((v) => v !== null);
        if (q.length === 4) pushQuad(q[0], q[1], q[2], q[3]);
        else if (q.length === 3) pushTri(q[0], q[1], q[2]);
      }
    }
  }
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i, j + 1, k))) continue;
        const q = [
          getCube(i, j, k),
          getCube(i - 1, j, k),
          getCube(i - 1, j, k - 1),
          getCube(i, j, k - 1)
        ].filter((v) => v !== null);
        if (q.length === 4) pushQuad(q[0], q[3], q[2], q[1]);
        else if (q.length === 3) pushTri(q[0], q[2], q[1]);
      }
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i, j, k + 1))) continue;
        const q = [
          getCube(i, j, k),
          getCube(i - 1, j, k),
          getCube(i - 1, j - 1, k),
          getCube(i, j - 1, k)
        ].filter((v) => v !== null);
        if (q.length === 4) pushQuad(q[0], q[1], q[2], q[3]);
        else if (q.length === 3) pushTri(q[0], q[1], q[2]);
      }
    }
  }
  removeDegenerateFaces2(mesh);
  meshSafetyPass(mesh);
  return mesh;
}
function removeDegenerateFaces2(mesh) {
  const validFaces = [];
  const validColors = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi];
    if (f.length < 3) continue;
    const a = mesh.positions[f[0]];
    const b = mesh.positions[f[1]];
    const c = mesh.positions[f[2]];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const nx = ab.y * ac.z - ab.z * ac.y;
    const ny = ab.z * ac.x - ab.x * ac.z;
    const nz = ab.x * ac.y - ab.y * ac.x;
    if (Math.hypot(nx, ny, nz) < 1e-10) continue;
    validFaces.push(f);
    validColors.push(mesh.faceColors[fi] ?? 8309665);
  }
  mesh.faces = validFaces;
  mesh.faceColors = validColors;
}
function buildScalarGrid3D(field, bounds, resolution) {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ * 2;
  const nx = resolution;
  const ny = resolution;
  const aspectZ = spanZ / Math.max(spanX, spanY, 1);
  const nz = Math.max(4, Math.min(resolution, Math.round(resolution * aspectZ)));
  const spacing = {
    x: spanX / nx,
    y: spanY / ny,
    z: spanZ / nz
  };
  const origin = {
    x: bounds.minX,
    y: bounds.minY,
    z: -bounds.maxZ
  };
  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  let idx = 0;
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = origin.x + i * spacing.x;
        const y = origin.y + j * spacing.y;
        const z = origin.z + k * spacing.z;
        values[idx++] = field(x, y, z);
      }
    }
  }
  return { origin, spacing, nx, ny, nz, values };
}

// src/mesh/fieldSampling.ts
function analyzeSilhouetteComplexity(polygon, lobes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const span = Math.max(w, h, 1);
  const area = Math.abs(signedArea(polygon));
  const aspectRatio = span / Math.max(Math.sqrt(area), 1);
  let minNeckWidth = span;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p = polygon[i];
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      minDist = Math.min(minDist, Math.hypot(p.x - polygon[j].x, p.y - polygon[j].y));
    }
    minNeckWidth = Math.min(minNeckWidth, minDist);
  }
  return {
    span,
    area,
    reflexCount: countReflexVertices(polygon),
    lobeCount: lobes?.length ?? 1,
    isConcave: isConcavePolygon(polygon),
    aspectRatio,
    minNeckWidth
  };
}
function computeAdaptiveGridResolution(polygon, polyBudget, lobes) {
  const c = analyzeSilhouetteComplexity(polygon, lobes);
  const budgetCap = gridResolutionCap(polyBudget);
  const budgetBase = Math.max(8, Math.min(budgetCap, Math.round(Math.cbrt(polyBudget * 5))));
  let factor = 1;
  if (c.isConcave) factor += 0.1;
  factor += c.reflexCount * 0.06;
  factor += (c.lobeCount - 1) * 0.14;
  if (c.aspectRatio > 2.2) factor += 0.12;
  if (c.minNeckWidth < c.span * 0.12) factor += 0.16;
  const flatness = c.area / (c.span * c.span);
  if (flatness > 0.45) factor -= 0.08;
  const res = Math.round(budgetBase * factor);
  return Math.max(8, Math.min(budgetCap, res));
}
function estimateMinCellSize(bounds, resolution) {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ * 2;
  const nx = resolution;
  const ny = resolution;
  const nz = Math.max(4, Math.min(resolution, Math.round(resolution * (spanZ / Math.max(spanX, spanY, 1)))));
  return Math.min(spanX / nx, spanY / ny, spanZ / nz);
}

// src/mesh/distanceTransform.ts
function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi > p.y !== yj > p.y && p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function signedDistToPolygon(p, polygon) {
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    minDist = Math.min(minDist, distToSegment(p, polygon[i], polygon[j]));
  }
  return pointInPolygon(p, polygon) ? minDist : -minDist;
}
function buildDistanceField(polygon, resolution = 32) {
  const poly = ensureCCW(polygon);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 2;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const cols = resolution;
  const rows = resolution;
  const cellSize = Math.max((maxX - minX) / cols, (maxY - minY) / rows);
  const data = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * cellSize;
      const y = minY + (row + 0.5) * cellSize;
      data[row * cols + col] = signedDistToPolygon({ x, y }, poly);
    }
  }
  return { minX, minY, cellSize, cols, rows, data };
}
function extractMedialAxis(grid, minRadius = 1.5) {
  const { cols, rows, data, minX, minY, cellSize } = grid;
  const nodes = [];
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const v = data[row * cols + col];
      if (v < minRadius) continue;
      let isMax = true;
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (data[(row + dr) * cols + (col + dc)] > v + 0.01) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      nodes.push({
        x: minX + (col + 0.5) * cellSize,
        y: minY + (row + 0.5) * cellSize,
        radius: v
      });
    }
  }
  if (nodes.length === 0) {
    let best = 0;
    let bestIdx = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > best) {
        best = data[i];
        bestIdx = i;
      }
    }
    const col = bestIdx % cols;
    const row = Math.floor(bestIdx / cols);
    nodes.push({
      x: minX + (col + 0.5) * cellSize,
      y: minY + (row + 0.5) * cellSize,
      radius: best
    });
  }
  return thinNodes(nodes, cellSize * 2.5);
}
function thinNodes(nodes, minDist) {
  const sorted = [...nodes].sort((a, b) => b.radius - a.radius);
  const kept = [];
  for (const n of sorted) {
    const tooClose = kept.some(
      (k) => Math.hypot(k.x - n.x, k.y - n.y) < minDist && k.radius >= n.radius * 0.8
    );
    if (!tooClose) kept.push(n);
  }
  return kept.slice(0, 24);
}
function sampleDistance(grid, x, y) {
  const { minX, minY, cellSize, cols, rows, data } = grid;
  const col = (x - minX) / cellSize - 0.5;
  const row = (y - minY) / cellSize - 0.5;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  if (c0 < 0 || r0 < 0 || c0 >= cols - 1 || r0 >= rows - 1) return -1;
  const fx = col - c0;
  const fy = row - r0;
  const v00 = data[r0 * cols + c0];
  const v10 = data[r0 * cols + c0 + 1];
  const v01 = data[(r0 + 1) * cols + c0];
  const v11 = data[(r0 + 1) * cols + c0 + 1];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

// src/mesh/silhouetteField.ts
function maxInteriorDistance(grid) {
  let max = 0.01;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] > max) max = grid.data[i];
  }
  return max;
}
function curvatureAt(grid, col, row) {
  const { cols, data } = grid;
  const c = col;
  const r = row;
  if (c < 1 || r < 1 || c >= cols - 1 || r >= grid.rows - 1) return 0;
  const v = data[r * cols + c];
  const dx = data[r * cols + c + 1] - data[r * cols + c - 1];
  const dy = data[(r + 1) * cols + c] - data[(r - 1) * cols + c];
  const dxx = data[r * cols + c + 1] - 2 * v + data[r * cols + c - 1];
  const dyy = data[(r + 1) * cols + c] - 2 * v + data[(r - 1) * cols + c];
  return Math.abs(dxx) + Math.abs(dyy) + Math.hypot(dx, dy) * 0.25;
}
function lobeInfluenceAt(seeds, x, y, sigma) {
  let sum = 0;
  for (const s of seeds) {
    const dx = x - s.x;
    const dy = y - s.y;
    const r = s.radius + sigma;
    sum += Math.exp(-(dx * dx + dy * dy) / (2 * r * r));
  }
  return Math.min(1, sum / Math.max(1, seeds.length * 0.28));
}
function softUnion(values, k = 6) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const max = Math.max(...values);
  let sum = 0;
  for (const v of values) sum += Math.exp(k * (v - max));
  return max + Math.log(sum) / k;
}
function medialInfluence(field, x, y) {
  const { seeds, lobeSeeds, medialSigma } = field;
  const groups = lobeSeeds.length > 1 ? lobeSeeds : [seeds];
  const lobeValues = groups.map(
    (group) => lobeInfluenceAt(group.length > 0 ? group : seeds, x, y, medialSigma)
  );
  return softUnion(lobeValues);
}
function buildSilhouetteField(polygon, resolution = 32, lobes) {
  const poly = ensureCCW(polygon);
  const grid = buildDistanceField(poly, resolution);
  const seeds = extractMedialAxis(grid);
  const maxInteriorDist = maxInteriorDistance(grid);
  const area = Math.abs(signedArea(poly));
  const medialSigma = Math.sqrt(area) * 0.06 + grid.cellSize * 0.5;
  const lobeSeeds = [];
  const activeLobes = lobes && lobes.length > 1 ? lobes : [poly];
  for (const lobe of activeLobes) {
    const lobeGrid = buildDistanceField(ensureCCW(lobe), Math.max(16, Math.floor(resolution * 0.75)));
    let lobeNodes = extractMedialAxis(lobeGrid);
    lobeNodes = lobeNodes.map((n) => {
      const col = Math.round((n.x - lobeGrid.minX) / lobeGrid.cellSize - 0.5);
      const row = Math.round((n.y - lobeGrid.minY) / lobeGrid.cellSize - 0.5);
      const curv = curvatureAt(lobeGrid, col, row);
      return { ...n, radius: (n.radius + medialSigma * 0.3) * (1 + curv * 0.12) };
    });
    lobeSeeds.push(lobeNodes);
  }
  return { polygon: poly, grid, seeds, lobeSeeds, maxInteriorDist, medialSigma };
}
function clampedBoundaryDist(field, x, y) {
  const d = sampleDistance(field.grid, x, y);
  return Math.max(-field.maxInteriorDist, Math.min(d, field.maxInteriorDist));
}

// src/mesh/organicVolumeField.ts
function thicknessProfile(boundaryDist, maxDist, roundness, meta) {
  const t = Math.min(1, Math.max(0, boundaryDist / maxDist));
  const bulb = 0.35 + roundness / 24 * 0.65;
  const flatness = 2.4 - bulb * 1.5;
  const profile = Math.pow(Math.sin(t * Math.PI * 0.5), flatness) * bulb;
  return profile * (0.45 + 0.55 * meta);
}
function depthScaleMin(roundness) {
  return 0.04 + roundness / 24 * 0.06;
}
function thicknessAt(x, y, options) {
  const { silhouette, depthScale, roundness, minThickness = 0 } = options;
  const d = clampedBoundaryDist(silhouette, x, y);
  if (d <= 0) return Math.max(depthScale * depthScaleMin(roundness), minThickness);
  const meta = medialInfluence(silhouette, x, y);
  const raw = depthScale * thicknessProfile(d, silhouette.maxInteriorDist, roundness, meta);
  return Math.max(raw, minThickness);
}
function createOrganicField3D(options) {
  const { silhouette, stylize = 0 } = options;
  const stylizeBias = 1 + stylize * 0.35;
  return function field(x, y, z) {
    const thick = thicknessAt(x, y, options) * stylizeBias;
    const boundaryDist = clampedBoundaryDist(silhouette, x, y);
    const xyOutside = -boundaryDist;
    const zOutside = Math.abs(z) - thick;
    return Math.max(xyOutside, zOutside);
  };
}

// src/mesh/organicVolumeReconstruct.ts
function polygonBounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
function generateOrganicVolume(polygon, options, lobes) {
  const {
    depthScale,
    roundness = 10,
    polyBudget = 48,
    stylize = 0,
    color = 8309665
  } = options;
  const poly = ensureCCW(polygon);
  const mesh = new HalfEdgeMesh();
  if (poly.length < 3) return mesh;
  const resolution = computeAdaptiveGridResolution(poly, polyBudget, lobes);
  const silhouette = buildSilhouetteField(poly, resolution, lobes);
  const bounds2d = polygonBounds(poly);
  const pad = Math.max(bounds2d.maxX - bounds2d.minX, bounds2d.maxY - bounds2d.minY) * 0.08;
  const cx = (bounds2d.minX + bounds2d.maxX) / 2;
  const cy = (bounds2d.minY + bounds2d.maxY) / 2;
  const bounds3d = {
    minX: bounds2d.minX - pad,
    minY: bounds2d.minY - pad,
    maxX: bounds2d.maxX + pad,
    maxY: bounds2d.maxY + pad,
    maxZ: 1
  };
  const cellSize = estimateMinCellSize(bounds3d, resolution);
  const minThickness = cellSize * 1.6;
  const fieldOpts = {
    silhouette,
    depthScale,
    roundness,
    stylize,
    minThickness
  };
  bounds3d.maxZ = thicknessAt(cx, cy, fieldOpts) * 1.2 + minThickness;
  const field3d = createOrganicField3D(fieldOpts);
  const scalarGrid = buildScalarGrid3D(field3d, bounds3d, resolution);
  return extractDualContour(scalarGrid, { isoValue: 0, color });
}
function reconstructOrganicMesh(polygon, options, lobes) {
  return generateOrganicVolume(polygon, options, lobes);
}

// src/mesh/silhouetteLoft.ts
function orderMedialChain(nodes) {
  if (nodes.length <= 2) return nodes;
  const start = nodes.reduce((best, n) => n.radius > best.radius ? n : best);
  const remaining = nodes.filter((n) => n !== start);
  const chain = [start];
  while (remaining.length > 0) {
    const last = chain[chain.length - 1];
    let pick = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - last.x, remaining[i].y - last.y);
      if (d < bestDist) {
        bestDist = d;
        pick = i;
      }
    }
    chain.push(remaining[pick]);
    remaining.splice(pick, 1);
  }
  return chain;
}
function subsampleMedialNodes(nodes, maxRings) {
  if (nodes.length <= maxRings) return nodes;
  const out = [];
  const step = (nodes.length - 1) / (maxRings - 1);
  for (let i = 0; i < maxRings; i++) {
    out.push(nodes[Math.round(i * step)]);
  }
  return out;
}
function stitchRingPair3(mesh, ringA, ringB, color, flip = false) {
  const segments = ringA.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    const a = ringA[si];
    const b = ringA[next];
    const c = ringB[si];
    const d = ringB[next];
    if (flip) {
      mesh.faces.push([a, c, d]);
      mesh.faces.push([a, d, b]);
    } else {
      mesh.faces.push([a, b, d]);
      mesh.faces.push([a, d, c]);
    }
    mesh.faceColors.push(color, color);
  }
}
function addPoleCap(mesh, ring, node, z, color, flip) {
  const pole = mesh.positions.length;
  mesh.positions.push({ x: node.x, y: node.y, z });
  const segments = ring.length;
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments;
    if (flip) mesh.faces.push([pole, ring[next], ring[si]]);
    else mesh.faces.push([pole, ring[si], ring[next]]);
    mesh.faceColors.push(color);
  }
}
function loftFromMedialNodes(nodes, options) {
  const {
    depthScale,
    roundness = 0.88,
    radialSegments,
    color = 8309665
  } = options;
  const mesh = new HalfEdgeMesh();
  const segments = Math.max(4, radialSegments);
  const depth = Math.max(3, depthScale);
  const maxR = Math.max(...nodes.map((n) => n.radius), 1);
  const ringPairs = [];
  for (const node of nodes) {
    const r = Math.max(0.75, node.radius * roundness);
    const halfZ = depth * (0.22 + 0.78 * Math.pow(r / maxR, 0.85));
    const top = [];
    const bot = [];
    for (let si = 0; si < segments; si++) {
      const angle = si / segments * Math.PI * 2;
      const dx = Math.cos(angle) * r;
      const dy = Math.sin(angle) * r;
      top.push(mesh.positions.length);
      mesh.positions.push({ x: node.x + dx, y: node.y + dy, z: halfZ });
      bot.push(mesh.positions.length);
      mesh.positions.push({ x: node.x + dx, y: node.y + dy, z: -halfZ });
    }
    ringPairs.push({ top, bot, halfZ });
  }
  for (let i = 0; i < ringPairs.length - 1; i++) {
    stitchRingPair3(mesh, ringPairs[i].top, ringPairs[i + 1].top, color);
    stitchRingPair3(mesh, ringPairs[i].bot, ringPairs[i + 1].bot, color, true);
  }
  for (const pair of ringPairs) {
    stitchRingPair3(mesh, pair.top, pair.bot, color);
  }
  const first = ringPairs[0];
  const last = ringPairs[ringPairs.length - 1];
  addPoleCap(mesh, first.top, nodes[0], first.halfZ * 1.02, color, false);
  addPoleCap(mesh, last.bot, nodes[nodes.length - 1], -last.halfZ * 1.02, color, true);
  mesh.buildHalfEdges();
  return mesh;
}
function generateSilhouetteLoft(polygon, options) {
  const {
    minAngleDeg = 14,
    maxBoundaryVerts = 32,
    maxRings = 8,
    depthScale,
    color
  } = options;
  const boundary = curvatureSampleClosedLoop(
    ensureCCW(polygon),
    minAngleDeg,
    maxBoundaryVerts
  );
  if (boundary.length < 3) return new HalfEdgeMesh();
  const gridRes = Math.max(24, Math.min(44, Math.ceil(Math.sqrt(boundary.length) * 2.8)));
  const grid = buildDistanceField(boundary, gridRes);
  let nodes = extractMedialAxis(grid);
  nodes = orderMedialChain(nodes);
  nodes = subsampleMedialNodes(nodes, maxRings);
  if (nodes.length < 2) {
    return extrudeSilhouette(boundary, {
      depth: Math.max(4, depthScale),
      color
    });
  }
  return loftFromMedialNodes(nodes, options);
}
function generateSharpSilhouette(polygon, options) {
  const boundary = curvatureSampleClosedLoop(
    ensureCCW(polygon),
    options.minAngleDeg ?? 16,
    options.maxBoundaryVerts ?? 28
  );
  if (boundary.length < 3) return new HalfEdgeMesh();
  return extrudeSilhouette(boundary, {
    depth: Math.max(4, options.depthScale),
    color: options.color
  });
}

// src/stroke/strokeInterpreter.ts
function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}
function isStraightLine(points, ratioThreshold = 0.06) {
  if (points.length < 2) return false;
  const start = points[0];
  const end = points[points.length - 1];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (chord < 3) return false;
  let maxDev = 0;
  for (const p of points) {
    maxDev = Math.max(maxDev, perpendicularDistance(p, start, end));
  }
  return maxDev / chord <= ratioThreshold;
}
function isCircleOrOval(points) {
  if (points.length < 8 || isConcavePolygon(points)) return false;
  const ellipse = fitEllipse(points);
  return ellipse.circularity > 0.9 && ellipse.aspectRatio > 0.75 && concavityScore(points) < 0.04;
}
function estimateLobeCount(points) {
  return Math.max(1, Math.floor(countReflexVertices(points) / 2));
}
function interpretStroke(points, closeThreshold, strokeMode, extrudeMode = false, options = {}) {
  const strokeType = options.pathClosed === true ? "closed" : classifyStroke(points, closeThreshold);
  const isClosed = options.pathClosed === true || strokeType === "closed";
  const concave = isClosed && isConcavePolygon(points);
  const lobes = isClosed ? estimateLobeCount(points) : 1;
  const ellipse = isClosed ? fitEllipse(points) : null;
  const centroid = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length
  };
  const len = pathLength(points);
  const turn = totalCurvature(points);
  const base = {
    strokeType,
    isClosed,
    isConcave: concave,
    lobeCount: lobes,
    ellipse,
    centroid,
    pathLength: len,
    totalTurn: turn
  };
  if (options.latheMode && points.length >= 2) {
    return {
      ...base,
      intent: "profile-lathe",
      name: "Lathe",
      latheAxisH: latheAxisHFromPoints(points)
    };
  }
  if (extrudeMode && points.length >= 2) {
    return {
      ...base,
      intent: isClosed ? "silhouette-extrude" : "path-capsule",
      name: isClosed ? "Extrude" : "Capsule"
    };
  }
  if (strokeMode === "centerline") {
    return {
      ...base,
      intent: isStraightLine(points) ? "hole-line" : "path-tube",
      name: isStraightLine(points) ? "Hole" : "Path"
    };
  }
  if (strokeMode === "blob") {
    if (!isClosed) {
      return {
        ...base,
        intent: isStraightLine(points) ? "hole-line" : "path-tube",
        name: isStraightLine(points) ? "Hole" : "Blob Path"
      };
    }
    return {
      ...base,
      intent: "soft-silhouette",
      name: lobes > 1 ? `Blob (${lobes} lobes)` : "Blob"
    };
  }
  if (strokeMode === "capsule") {
    if (!isClosed) {
      return {
        ...base,
        intent: "path-capsule",
        name: "Capsule"
      };
    }
    return {
      ...base,
      intent: "vertical-capsule",
      name: "Capsule"
    };
  }
  if (strokeMode === "ribbon" || strokeMode === "tapered-tube" || strokeMode === "hair-paths" || strokeMode === "hair-strips" || strokeMode === "hair-round") {
    return {
      ...base,
      intent: "path-tube",
      name: strokeMode === "ribbon" ? "Ribbon" : strokeMode === "tapered-tube" ? "Tapered Tube" : strokeMode === "hair-strips" ? "Hair Strips" : strokeMode === "hair-round" ? "Rounded Hair" : "Hair Paths"
    };
  }
  if (!isClosed) {
    if (isStraightLine(points)) {
      return { ...base, intent: "hole-line", name: "Hole" };
    }
    return { ...base, intent: "path-tube", name: "Path" };
  }
  if (!options.preserveDetail && isCircleOrOval(points)) {
    return { ...base, intent: "bead", name: "Bead" };
  }
  if (!options.preserveDetail && detectRadialSymmetry(points, 0.72)) {
    return { ...base, intent: "silhouette-lathe", name: "Bead" };
  }
  if (concave && lobes > 1) {
    return {
      ...base,
      intent: "capsule-pillow",
      name: `Doodle (${lobes} lobes)`
    };
  }
  return {
    ...base,
    intent: "capsule-pillow",
    name: "Doodle"
  };
}
function allocateTessellation(polyBudget, brushDensity, intent, profilePoints, minAngleDeg = 15, preserveDetail = false) {
  const sampled = curvatureSampleProfile(profilePoints, minAngleDeg);
  const curvatureRings = Math.max(3, Math.min(sampled.length, preserveDetail ? 128 : 16));
  const cappedDensity = preserveDetail ? Math.max(6, Math.min(brushDensity, 32)) : Math.max(4, Math.min(brushDensity, 24));
  const budget = Math.max(12, polyBudget);
  switch (intent) {
    case "bead": {
      const profileRings = Math.max(4, Math.min(curvatureRings, 8));
      const radialSegments = Math.max(
        4,
        Math.min(cappedDensity, Math.floor((budget - 2) / profileRings))
      );
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: cappedDensity * 0.8,
        minAngleDeg: 18
      };
    }
    case "silhouette-lathe": {
      const profileRings = Math.max(3, Math.min(curvatureRings, 12));
      const radialSegments = Math.max(
        4,
        Math.min(cappedDensity, Math.floor(budget / profileRings))
      );
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: cappedDensity * 0.8,
        minAngleDeg
      };
    }
    case "soft-silhouette": {
      const radialSegments = Math.max(
        6,
        Math.min(cappedDensity, Math.floor(Math.sqrt(budget * 1.1)))
      );
      const maxRings = Math.max(
        5,
        Math.min(14, Math.floor(budget * 0.9 / Math.max(12, radialSegments * 2)))
      );
      return {
        radialSegments,
        profileRings: maxRings,
        pathSamples: 0,
        boundaryVerts: Math.max(14, Math.min(Math.floor(budget * 0.75), 56)),
        extrudeDepth: Math.max(6, cappedDensity * 1.1),
        minAngleDeg: Math.max(10, minAngleDeg - 2)
      };
    }
    case "sharp-silhouette": {
      const maxBoundary = Math.max(8, Math.min(Math.floor(budget * 0.5), 28));
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(6, cappedDensity),
        minAngleDeg
      };
    }
    case "organic-volume": {
      const maxBoundary = Math.max(12, Math.min(Math.floor(budget * 0.65), 40));
      const gridRes = Math.max(8, Math.min(16, Math.floor(Math.sqrt(budget) * 1.1)));
      return {
        radialSegments: gridRes,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(6, cappedDensity * 1.2),
        minAngleDeg: Math.max(8, minAngleDeg - 4)
      };
    }
    case "silhouette-extrude": {
      const maxBoundary = Math.max(64, Math.min(Math.max(Math.floor(budget * 2), 256), 512));
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(8, cappedDensity),
        minAngleDeg: Math.min(minAngleDeg, 6)
      };
    }
    case "path-tube":
    case "path-capsule": {
      const radialSegments = Math.max(
        6,
        Math.min(
          10,
          preserveDetail ? VECTOR_PEN_RADIAL_SEGMENTS : Math.min(cappedDensity, Math.floor(Math.sqrt(budget * 0.5)) || 8)
        )
      );
      const pathSamples = preserveDetail ? Math.min(
        VECTOR_PEN_MAX_PATH_SAMPLES,
        Math.max(3, Math.min(curvatureRings, profilePoints.length))
      ) : pathSpineBudget(budget, profilePoints.length);
      return {
        radialSegments,
        profileRings: 0,
        pathSamples,
        boundaryVerts: 0,
        extrudeDepth: Math.max(4, cappedDensity),
        // Unused when preserveSpine; kept low as a safe fallback.
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : 4
      };
    }
    case "capsule-pillow": {
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: preserveDetail ? VECTOR_PEN_MAX_BOUNDARY_VERTS : Math.max(16, Math.min(Math.floor(budget * 0.85), 64)),
        extrudeDepth: Math.max(4, cappedDensity * 1.1),
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : Math.max(8, minAngleDeg - 4)
      };
    }
    case "vertical-capsule": {
      const profileRings = Math.max(
        6,
        Math.min(14, Math.floor(budget / Math.max(8, cappedDensity)))
      );
      const radialSegments = Math.max(
        6,
        Math.min(10, Math.floor(budget / Math.max(6, profileRings)))
      );
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: Math.max(12, Math.min(Math.floor(budget * 0.5), 36)),
        extrudeDepth: Math.max(4, cappedDensity),
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : minAngleDeg
      };
    }
    case "profile-lathe": {
      const profileRings = Math.min(LATHE_MAX_PROFILE_RINGS, Math.max(2, profilePoints.length));
      return {
        radialSegments: LATHE_RADIAL_SEGMENTS,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: 0,
        minAngleDeg: LATHE_MIN_ANGLE_DEG
      };
    }
    case "hole-line":
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 2,
        boundaryVerts: 0,
        extrudeDepth: 0,
        minAngleDeg
      };
  }
}

// src/stroke/lobeDetection.ts
function cross22(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function distToSegment2(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-10) return { x: 0, y: 1 };
  return { x: v.x / len, y: v.y / len };
}
function findNeckVertices(polygon) {
  const poly = ensureCCW(polygon);
  const n = poly.length;
  if (n < 6) return [];
  const widths = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const bisector = normalize({
      x: curr.x - prev.x + curr.x - next.x,
      y: curr.y - prev.y + curr.y - next.y
    });
    let maxDist = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = distToSegment2(poly[j], curr, {
        x: curr.x + bisector.x * 1e3,
        y: curr.y + bisector.y * 1e3
      });
      maxDist = Math.max(maxDist, d);
    }
    widths.push(maxDist);
  }
  const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
  const necks = [];
  for (let i = 0; i < n; i++) {
    const prev = widths[(i + n - 1) % n];
    const curr = widths[i];
    const next = widths[(i + 1) % n];
    if (curr < avg * 0.45 && curr <= prev && curr <= next) {
      necks.push(i);
    }
  }
  return necks;
}
function countReflex(poly) {
  let count = 0;
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    if (cross22(prev, curr, next) < -1e-6) count++;
  }
  return count;
}
function splitAtNecks(polygon, necks) {
  if (necks.length === 0) return [polygon];
  const sorted = [...necks].sort((a, b) => a - b);
  const lobes = [];
  for (let ni = 0; ni < sorted.length; ni++) {
    const start = sorted[ni];
    const end = sorted[(ni + 1) % sorted.length];
    const lobe = [];
    if (start < end) {
      for (let i = start; i <= end; i++) lobe.push({ ...polygon[i] });
    } else {
      for (let i = start; i < polygon.length; i++) lobe.push({ ...polygon[i] });
      for (let i = 0; i <= end; i++) lobe.push({ ...polygon[i] });
    }
    if (lobe.length >= 3 && Math.abs(signedArea(lobe)) > 10) {
      lobes.push(lobe);
    }
  }
  return lobes.length >= 2 ? lobes : [polygon];
}
function detectLobes(polygon) {
  const poly = ensureCCW(polygon);
  const reflexCount = countReflex(poly);
  if (reflexCount === 0 || poly.length < 6) {
    return { lobes: [poly], lobeCount: 1, isMultiLobe: false, neckIndices: [] };
  }
  const necks = findNeckVertices(poly);
  if (necks.length === 0) {
    return {
      lobes: [poly],
      lobeCount: 1,
      isMultiLobe: reflexCount >= 2,
      neckIndices: []
    };
  }
  const lobes = splitAtNecks(poly, necks.slice(0, 4));
  return {
    lobes: lobes.length > 1 ? lobes : [poly],
    lobeCount: lobes.length > 1 ? lobes.length : 1,
    isMultiLobe: lobes.length > 1 || reflexCount >= 3,
    neckIndices: necks
  };
}

// src/blob/strokeToBlob.ts
function blobStrokeToObject(input) {
  if (input.extrudeMode) {
    return polylineToMesh({
      ...input,
      strokeMode: "outline",
      extrudeMode: true,
      name: input.name ?? "Extrude"
    });
  }
  const obj = softSketchDoodleToObject(input);
  if (!obj) return null;
  const defaultName = obj.sketchSource?.isClosed ? "Blob" : "Blob Path";
  return {
    ...obj,
    name: input.name ?? defaultName,
    facetExaggeration: input.stylize ?? 0,
    polyBudgetMode: "strict",
    smoothShading: false
  };
}

// src/stroke/polylineToMesh.ts
function capSpineToSampleCount(spine, maxSamples) {
  if (maxSamples < 2 || spine.length <= maxSamples) return spine;
  const out = [];
  for (let i = 0; i < maxSamples; i++) {
    out.push(
      spine[Math.min(spine.length - 1, Math.round(i / (maxSamples - 1) * (spine.length - 1)))]
    );
  }
  return out;
}
function dedupeConsecutivePoints2(points, epsilon = 0.01) {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = out[out.length - 1];
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > epsilon) out.push(p);
  }
  return out;
}
function centroidRelative(points, cx, cy) {
  return points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}
function applyColor(mesh, color) {
  for (let i = 0; i < mesh.faceColors.length; i++) {
    mesh.faceColors[i] = color;
  }
}
function finalizeMesh(mesh, interpretation, view, depth, color, polyBudget, intent, customName, tubePathPlane, preserveDetail = false, latheObject = false, planeFrame) {
  const planeOffsetX = intent === "profile-lathe" && interpretation.latheAxisH != null ? interpretation.latheAxisH : interpretation.centroid.x;
  const planeOffsetY = intent === "profile-lathe" ? 0 : interpretation.centroid.y;
  offsetMeshInPlane(mesh, planeOffsetX, planeOffsetY);
  projectMeshToView(mesh, view, depth, planeFrame);
  applyColor(mesh, color);
  if ((intent === "path-tube" || intent === "path-capsule") && tubePathPlane && tubePathPlane.length >= 2) {
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(tubePathPlane, view, depth, planeFrame),
      interpretation.isClosed
    );
  } else if (intent === "profile-lathe" && interpretation.latheAxisH != null) {
    orientLatheMeshOutward(mesh, view, interpretation.latheAxisH, depth);
  } else {
    ensureClosedMeshOutward(mesh);
  }
  let result = mesh;
  if (intent === "organic-volume") {
    result = remeshOrganic(result, polyBudget);
    applyColor(result, color);
  } else if (!preserveDetail && intent !== "vertical-capsule" && intent !== "silhouette-extrude" && intent !== "path-tube" && (intent === "soft-silhouette" || intent === "sharp-silhouette" || intent === "capsule-pillow")) {
    if (result.vertexCount() > polyBudget) {
      result = simplifyMesh(result, polyBudget);
      applyColor(result, color);
    }
  } else if (!preserveDetail && !latheObject && intent !== "vertical-capsule" && intent !== "silhouette-extrude" && intent !== "path-tube" && result.vertexCount() > polyBudget) {
    result = simplifyMesh(result, polyBudget);
    applyColor(result, color);
  }
  const hasCylindricalUvs = intent === "vertical-capsule" && result.uvs.length > 0 && result.faceUvIndices.length === result.faces.length;
  const object = result.toObject(generateId(), customName ?? interpretation.name, {
    polyBudget: latheObject ? result.vertexCount() : preserveDetail ? result.vertexCount() : polyBudget,
    color,
    polyBudgetMode: latheObject || preserveDetail ? "adaptive" : "strict",
    smoothShading: latheObject ? true : void 0,
    uvAutoPacked: hasCylindricalUvs ? true : void 0,
    uvMappingMode: hasCylindricalUvs ? "box" : void 0,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale }
    }
  });
  return latheObject ? ensureObjectUVs(object) : object;
}
function generateForIntent(intent, points, tess, interpretation, color, brushDensity, stylize, polyBudget, latheCaps = false, latheRadialSegments, latheProfileRings, latheSmoothing) {
  const relative = centroidRelative(points, interpretation.centroid.x, interpretation.centroid.y);
  switch (intent) {
    case "bead": {
      if (interpretation.ellipse) {
        return generateBeadFromEllipse(
          { ...interpretation.ellipse, cx: 0, cy: 0 },
          {
            radialSegments: tess.radialSegments,
            profileRings: tess.profileRings,
            minAngleDeg: tess.minAngleDeg
          }
        );
      }
      return generateBeadFromSilhouette(relative, tess.radialSegments, tess.minAngleDeg);
    }
    case "silhouette-lathe": {
      const profile = extractLatheProfile(relative);
      const sampled = curvatureSampleProfile(profile, tess.minAngleDeg, tess.profileRings);
      return generateLathe(sampled, {
        radialSegments: tess.radialSegments,
        minAngleDeg: tess.minAngleDeg,
        depth: 0
      });
    }
    case "silhouette-extrude": {
      let boundary;
      if (interpretation.isClosed) {
        const first = relative[0];
        const last = relative[relative.length - 1];
        boundary = Math.hypot(first.x - last.x, first.y - last.y) <= 0.01 ? relative.slice(0, -1) : relative;
        if (boundary.length > tess.boundaryVerts) {
          const out = [];
          const step = boundary.length / tess.boundaryVerts;
          for (let i = 0; i < tess.boundaryVerts; i++) {
            out.push(boundary[Math.min(boundary.length - 1, Math.round(i * step))]);
          }
          boundary = out;
        }
      } else {
        const halfWidth = Math.max(2.5, brushDensity * 0.4);
        const outline = strokeToFlatOutline(relative, halfWidth);
        if (!outline || outline.length < 3) return null;
        boundary = outline;
      }
      const { lobes, isMultiLobe } = detectLobes(boundary);
      if (isMultiLobe && lobes.length > 1) {
        return generateConcaveSilhouette(lobes, tess.extrudeDepth, color);
      }
      return extrudeSilhouette(boundary, { depth: tess.extrudeDepth, color });
    }
    case "soft-silhouette": {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      );
      const { lobes, isMultiLobe } = detectLobes(boundary);
      if (isMultiLobe && lobes.length > 1) {
        const parts = lobes.map(
          (lobe) => generateSilhouetteLoft(lobe, {
            depthScale: tess.extrudeDepth,
            roundness: 0.82 + Math.min(0.12, brushDensity * 5e-3),
            radialSegments: tess.radialSegments,
            maxRings: tess.profileRings,
            minAngleDeg: tess.minAngleDeg,
            maxBoundaryVerts: tess.boundaryVerts,
            color
          })
        );
        return parts.length === 1 ? parts[0] : mergeMeshes(parts, color);
      }
      return generateSilhouetteLoft(boundary, {
        depthScale: tess.extrudeDepth,
        roundness: 0.82 + Math.min(0.12, brushDensity * 5e-3),
        radialSegments: tess.radialSegments,
        maxRings: tess.profileRings,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        color
      });
    }
    case "sharp-silhouette": {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      );
      const { lobes, isMultiLobe } = detectLobes(boundary);
      if (isMultiLobe && lobes.length > 1) {
        return generateConcaveSilhouette(lobes, tess.extrudeDepth, color);
      }
      return generateSharpSilhouette(boundary, {
        depthScale: tess.extrudeDepth,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        color
      });
    }
    case "organic-volume": {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      );
      const { lobes, isMultiLobe } = detectLobes(boundary);
      const activeLobes = isMultiLobe && lobes.length > 1 ? lobes : void 0;
      return reconstructOrganicMesh(
        boundary,
        {
          depthScale: tess.extrudeDepth,
          roundness: brushDensity,
          polyBudget,
          stylize,
          color
        },
        activeLobes
      );
    }
    case "path-tube": {
      const spine = preparePathCenterline(relative, Math.max(polyBudget, tess.pathSamples * 4));
      if (!spine || spine.length < 2) return null;
      const ringSpine = capSpineToSampleCount(spine, tess.pathSamples);
      return generateCapsuleSweep(ringSpine, {
        radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
        radialSegments: tess.radialSegments,
        closed: false,
        hemiRings: 0,
        preserveSpine: true,
        color
      });
    }
    case "path-capsule": {
      const spine = preparePathCenterline(relative, Math.max(polyBudget, tess.pathSamples * 4));
      if (!spine || spine.length < 2) return null;
      const ringSpine = capSpineToSampleCount(spine, tess.pathSamples);
      return generateCapsuleSweep(ringSpine, {
        radius: Math.max(2, tess.extrudeDepth),
        radialSegments: tess.radialSegments,
        closed: false,
        hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
        preserveSpine: true,
        color
      });
    }
    case "capsule-pillow": {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      );
      const { lobes, isMultiLobe } = detectLobes(boundary);
      if (isMultiLobe && lobes.length > 1) {
        const parts = lobes.map(
          (lobe) => generateCapsulePillow(lobe, {
            depth: tess.extrudeDepth,
            minAngleDeg: tess.minAngleDeg,
            maxBoundaryVerts: tess.boundaryVerts,
            preserveBoundary: true,
            color
          })
        );
        return parts.length === 1 ? parts[0] : mergeMeshes(parts, color);
      }
      return generateCapsulePillow(boundary, {
        depth: tess.extrudeDepth,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        preserveBoundary: true,
        color
      });
    }
    case "vertical-capsule": {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      );
      return generateVerticalShapedCapsule(boundary, {
        radialSegments: tess.radialSegments,
        profileRings: tess.profileRings,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        preserveBoundary: true,
        color
      });
    }
    case "profile-lathe": {
      const lathe = strokeToLatheProfile(points, {
        maxProfileRings: latheProfileRings,
        smoothing: latheSmoothing
      });
      if (!lathe || lathe.profile.length < 2) return null;
      return generateLathe(lathe.profile, {
        radialSegments: Math.max(8, Math.min(64, Math.round(latheRadialSegments ?? 24))),
        preserveProfile: true,
        capBottom: latheCaps,
        capTop: latheCaps,
        depth: 0,
        axis: "y"
      });
    }
    case "hole-line":
      return null;
  }
}
function polylineToMesh(input) {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    strokeMode,
    rdpTolerance,
    closeThreshold,
    defaultDepth,
    color,
    stylize = 0,
    extrudeMode = false,
    latheMode = false,
    latheCaps = false,
    latheRadialSegments = 24,
    latheProfileRings = 48,
    latheSmoothing = 0.15,
    extrudeAmount,
    name,
    pathClosed,
    preserveDetail = false,
    planeFrame = null
  } = input;
  if (points.length < 2) return null;
  if (view === "perspective" && !planeFrame) return null;
  if (latheMode && !isLatheViewSupported(view)) return null;
  if (strokeMode === "blob" && !extrudeMode && !latheMode) {
    return blobStrokeToObject(input);
  }
  let closedPoints;
  if (preserveDetail || latheMode) {
    closedPoints = dedupeConsecutivePoints2(points);
    if (!latheMode && pathClosed && closedPoints.length >= 3) {
      const first = closedPoints[0];
      const last = closedPoints[closedPoints.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.01) {
        closedPoints = closedPoints.slice(0, -1);
      }
    }
  } else if (strokeMode === "outline" || extrudeMode && strokeMode !== "centerline") {
    closedPoints = dedupeConsecutivePoints2(points);
    const effectiveCloseThreshold3 = extrudeMode ? closeThreshold * 2.5 : closeThreshold;
    if (classifyStroke(closedPoints, effectiveCloseThreshold3) === "closed") {
      const first = closedPoints[0];
      const last = closedPoints[closedPoints.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
        closedPoints = [...closedPoints, first];
      }
    }
  } else {
    const spacing = Math.max(rdpTolerance * 0.35, 0.8);
    const resampled = resampleUniform(points, spacing);
    const simplified = rdpSimplify(resampled, rdpTolerance);
    if (simplified.length < 2) return null;
    const effectiveCloseThreshold3 = extrudeMode ? closeThreshold * 2.5 : closeThreshold;
    closedPoints = simplified;
    if (classifyStroke(simplified, effectiveCloseThreshold3) === "closed") {
      const first = simplified[0];
      const last = simplified[simplified.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
        closedPoints = [...simplified, first];
      }
    }
  }
  if (closedPoints.length < 2) return null;
  const effectiveCloseThreshold2 = extrudeMode ? closeThreshold * 2.5 : closeThreshold;
  const interpretation = interpretStroke(
    closedPoints,
    effectiveCloseThreshold2,
    strokeMode,
    extrudeMode,
    { preserveDetail, pathClosed, latheMode }
  );
  if (interpretation.intent === "hole-line") return null;
  const profileSource = interpretation.intent === "bead" && interpretation.ellipse ? (() => {
    const { rx, ry } = interpretation.ellipse;
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const v = -ry + t * 2 * ry;
      const nv = ry > 0 ? v / ry : 0;
      prof.push({ x: rx * Math.sqrt(Math.max(0, 1 - nv * nv)), y: v });
    }
    return prof;
  })() : closedPoints;
  const tess = allocateTessellation(
    polyBudget,
    brushDensity,
    interpretation.intent,
    profileSource,
    15,
    preserveDetail
  );
  const effectiveTess = extrudeAmount != null && (extrudeMode || preserveDetail || strokeMode === "capsule") ? { ...tess, extrudeDepth: Math.max(1.6, Math.abs(extrudeAmount)) } : tess;
  const mesh = generateForIntent(
    interpretation.intent,
    closedPoints,
    effectiveTess,
    interpretation,
    color,
    brushDensity,
    stylize,
    polyBudget,
    latheCaps,
    latheRadialSegments,
    latheProfileRings,
    latheSmoothing
  );
  if (!mesh || mesh.vertexCount() === 0) return null;
  const object = finalizeMesh(
    mesh,
    interpretation,
    view,
    defaultDepth,
    color,
    polyBudget,
    interpretation.intent,
    name,
    interpretation.intent === "path-tube" || interpretation.intent === "path-capsule" ? closedPoints : void 0,
    preserveDetail,
    interpretation.intent === "profile-lathe",
    planeFrame
  );
  if (interpretation.intent === "profile-lathe") {
    object.latheSource = {
      points: closedPoints.map((point) => ({ ...point })),
      view,
      defaultDepth,
      caps: latheCaps,
      radialSegments: latheRadialSegments,
      profileRings: latheProfileRings,
      smoothing: latheSmoothing
    };
  }
  return object;
}

// src/stroke/strokeToMesh.ts
function strokeToMesh(input) {
  if (input.view === "perspective" && !input.planeFrame) return null;
  if (input.latheMode) {
    return polylineToMesh({
      ...input,
      latheMode: true,
      extrudeMode: false,
      name: input.name ?? "Lathe"
    });
  }
  if (input.extrudeMode) {
    if (input.strokeMode === "outline" || input.strokeMode === "blob") {
      return sharpSketchDoodleToObject({
        ...input,
        strokeMode: "outline",
        name: input.name ?? void 0
      });
    }
    if (input.strokeMode === "centerline") {
      return pathSketchDoodleToObject({
        ...input,
        name: input.name ?? "Path"
      });
    }
    if (input.strokeMode === "hair-paths") {
      return hairSketchDoodleToObject(input, "path");
    }
    if (input.strokeMode === "hair-strips") {
      return hairSketchDoodleToObject(input, "strip");
    }
    if (input.strokeMode === "hair-round") {
      return roundedHairSketchDoodleToObject(input);
    }
    return polylineToMesh({
      ...input,
      extrudeMode: true
    });
  }
  if (input.strokeMode === "outline") {
    return outlineSketchDoodleToObject(input);
  }
  if (input.strokeMode === "centerline") {
    return pathSketchDoodleToObject(input);
  }
  if (input.strokeMode === "capsule") {
    return capsuleSketchDoodleToObject(input);
  }
  if (input.strokeMode === "ribbon") {
    return ribbonSketchDoodleToObject(input);
  }
  if (input.strokeMode === "tapered-tube") {
    return taperedTubeSketchDoodleToObject(input);
  }
  if (input.strokeMode === "hair-paths") {
    return hairSketchDoodleToObject(input, "path");
  }
  if (input.strokeMode === "hair-strips") {
    return hairSketchDoodleToObject(input, "strip");
  }
  if (input.strokeMode === "hair-round") {
    return roundedHairSketchDoodleToObject(input);
  }
  return polylineToMesh(input);
}

// src/vector/bezier.ts
function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function subdivideCubic(p0, p1, p2, p3) {
  const p01 = lerp(p0, p1, 0.5);
  const p12 = lerp(p1, p2, 0.5);
  const p23 = lerp(p2, p3, 0.5);
  const p012 = lerp(p01, p12, 0.5);
  const p123 = lerp(p12, p23, 0.5);
  const mid = lerp(p012, p123, 0.5);
  return [
    [p0, p01, p012, mid],
    [mid, p123, p23, p3]
  ];
}
function evalCubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y
  };
}
var FLATTEN_MAX_DEPTH = 24;
function flattenSegment(p0, p1, p2, p3, error, out, depth = 0) {
  const mid = evalCubic(p0, p1, p2, p3, 0.5);
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const dev = Math.hypot(mid.x - (p0.x + p3.x) / 2, mid.y - (p0.y + p3.y) / 2);
  if (dev <= error || chord < error || depth >= FLATTEN_MAX_DEPTH) {
    if (out.length === 0 || Math.hypot(out[out.length - 1].x - p3.x, out[out.length - 1].y - p3.y) > 0.01) {
      out.push({ ...p3 });
    }
    return;
  }
  const [first, second] = subdivideCubic(p0, p1, p2, p3);
  flattenSegment(first[0], first[1], first[2], first[3], error, out, depth + 1);
  flattenSegment(second[0], second[1], second[2], second[3], error, out, depth + 1);
}
function flattenVectorPath(path, maxError = 0.5) {
  return sampleAnchors(path.anchors, path.closed, maxError);
}
function sampleAnchors(anchors, closed, maxError = 0.5, previewPoint) {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) {
    return previewPoint ? [{ ...anchors[0].position }, previewPoint] : [{ ...anchors[0].position }];
  }
  const out = [{ ...anchors[0].position }];
  const n = anchors.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a0 = anchors[i];
    const a1 = anchors[(i + 1) % n];
    const p0 = a0.position;
    const p3 = a1.position;
    const p1 = a0.outHandle ?? p0;
    const p2 = a1.inHandle ?? p3;
    flattenSegment(p0, p1, p2, p3, maxError, out);
  }
  if (!closed && previewPoint) {
    const last = anchors[n - 1];
    const p0 = last.position;
    const p3 = previewPoint;
    const p1 = last.outHandle ?? p0;
    const p2 = previewPoint;
    flattenSegment(p0, p1, p2, p3, maxError, out);
  }
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < maxError) out.pop();
  }
  return out;
}

// src/vector/vectorPathToMesh.ts
function meshPointsFromPath(path, latheMode = false) {
  const points = flattenVectorPath(
    path,
    latheMode ? VECTOR_PEN_LATHE_FLATTEN_ERROR : VECTOR_PEN_FLATTEN_ERROR
  );
  if (points.length < 2) return points;
  if (!path.closed) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.5) {
    return points.slice(0, -1);
  }
  return points;
}
function vectorPathMeshName(strokeMode, extrudeMode, latheMode, closed) {
  if (latheMode) return "Lathe";
  if (extrudeMode) {
    if (strokeMode === "centerline") return "Path";
    if (strokeMode === "capsule") return "Capsule";
    if (strokeMode === "ribbon") return "Ribbon";
    if (strokeMode === "tapered-tube") return "Tapered Tube";
    return closed ? "Extrude" : "Capsule";
  }
  if (strokeMode === "blob") return "Blob";
  if (strokeMode === "centerline") return "Path";
  if (strokeMode === "capsule") return "Capsule";
  if (strokeMode === "ribbon") return "Ribbon";
  if (strokeMode === "tapered-tube") return "Tapered Tube";
  if (strokeMode === "hair-paths") return "Hair Paths";
  if (strokeMode === "hair-strips") return "Hair Strips";
  if (strokeMode === "hair-round") return "Rounded Hair";
  if (strokeMode === "outline") return closed ? "Outline" : "Outline Path";
  return closed ? "Doodle" : "Path";
}
function vectorPathToMesh(path, options) {
  const points = meshPointsFromPath(path, !!options.latheMode);
  if (points.length < 2) return null;
  const name = vectorPathMeshName(
    options.strokeMode,
    !!options.extrudeMode,
    !!options.latheMode,
    path.closed
  );
  const input = {
    points,
    view: path.view,
    polyBudget: options.latheMode ? LATHE_POLY_BUDGET : options.polyBudget,
    brushDensity: options.brushDensity,
    strokeMode: options.strokeMode,
    rdpTolerance: options.rdpTolerance,
    closeThreshold: options.closeThreshold,
    defaultDepth: options.defaultDepth,
    color: path.color,
    stylize: options.stylize,
    extrudeMode: options.extrudeMode,
    latheMode: options.latheMode,
    latheCaps: options.latheCaps,
    latheRadialSegments: options.latheRadialSegments,
    latheProfileRings: options.latheProfileRings,
    latheSmoothing: options.latheSmoothing,
    extrudeAmount: options.extrudeAmount,
    blobInflation: options.blobInflation,
    name,
    pathClosed: path.closed,
    preserveDetail: true,
    hairTipStyle: options.hairTipStyle,
    pathStartCap: options.pathStartCap,
    pathEndCap: options.pathEndCap,
    pathRadialSegments: options.pathRadialSegments,
    pathRadiusScale: options.pathRadiusScale,
    ribbonStartTip: options.ribbonStartTip,
    ribbonEndTip: options.ribbonEndTip,
    ribbonTaper: options.ribbonTaper,
    ribbonWidthScale: options.ribbonWidthScale,
    ribbonFlat: options.ribbonFlat,
    pathOutput: options.pathOutput,
    pathStartScale: options.pathStartScale,
    pathEndScale: options.pathEndScale,
    pathTwist: options.pathTwist,
    pathSpacing: options.pathSpacing,
    pathOffset: options.pathOffset,
    pathProfile: options.pathProfile,
    pathProfileWidth: options.pathProfileWidth,
    pathProfileHeight: options.pathProfileHeight,
    pathChainAlternating: options.pathChainAlternating,
    pathCardCrossed: options.pathCardCrossed,
    pathDistributionMode: options.pathDistributionMode,
    pathCount: options.pathCount,
    pathStartPadding: options.pathStartPadding,
    pathEndPadding: options.pathEndPadding,
    pathRandomScale: options.pathRandomScale,
    pathRotation: options.pathRotation,
    pathRandomRotation: options.pathRandomRotation,
    pathAlternateRotation: options.pathAlternateRotation,
    pathMirrorAlternate: options.pathMirrorAlternate,
    pathSeed: options.pathSeed,
    pathKeepInstances: options.pathKeepInstances,
    pathSourceObject: options.pathSourceObject,
    pathSourceObjectId: options.pathSourceObjectId
  };
  return strokeToMesh(input);
}

// src/vector/vectorSource.ts
function isVectorDoodleObject(obj) {
  return !!obj?.vectorSource;
}
function clonePath(path) {
  return {
    ...path,
    anchors: cloneAnchors(path),
    shapeParams: path.shapeParams ? { ...path.shapeParams } : void 0
  };
}
function attachVectorSource(obj, source) {
  return {
    ...obj,
    vectorSource: {
      ...source,
      path: clonePath(source.path)
    }
  };
}
function regenerateVectorObjectFromSource(obj, changes) {
  const source = obj.vectorSource;
  if (!source) return null;
  const nextSource = {
    ...source,
    brushDensity: Math.max(2, Math.min(48, changes.brushDensity ?? source.brushDensity)),
    polyBudget: Math.max(16, Math.min(512, changes.polyBudget ?? source.polyBudget ?? VECTOR_PEN_POLY_BUDGET)),
    extrudeDepth: changes.extrudeDepth ?? source.extrudeDepth,
    blobInflation: Math.max(0, Math.min(1, changes.blobInflation ?? source.blobInflation ?? 0.65)),
    strokeMode: changes.strokeMode ?? source.strokeMode,
    extrudeMode: changes.extrudeMode ?? source.extrudeMode,
    latheMode: changes.latheMode ?? source.latheMode,
    latheCaps: changes.latheCaps ?? source.latheCaps,
    latheRadialSegments: changes.latheRadialSegments ?? source.latheRadialSegments,
    latheProfileRings: changes.latheProfileRings ?? source.latheProfileRings,
    latheSmoothing: changes.latheSmoothing ?? source.latheSmoothing,
    hairTipStyle: changes.hairTipStyle ?? source.hairTipStyle,
    pathStartCap: changes.pathStartCap ?? source.pathStartCap,
    pathEndCap: changes.pathEndCap ?? source.pathEndCap,
    pathRadialSegments: Math.max(3, Math.min(24, changes.pathRadialSegments ?? source.pathRadialSegments ?? 8)),
    pathRadiusScale: Math.max(0.1, Math.min(4, changes.pathRadiusScale ?? source.pathRadiusScale ?? 1)),
    ribbonStartTip: changes.ribbonStartTip ?? source.ribbonStartTip,
    ribbonEndTip: changes.ribbonEndTip ?? source.ribbonEndTip,
    ribbonTaper: Math.max(0.05, Math.min(0.49, changes.ribbonTaper ?? source.ribbonTaper ?? 0.35)),
    ribbonWidthScale: Math.max(0.1, Math.min(4, changes.ribbonWidthScale ?? source.ribbonWidthScale ?? 1)),
    ribbonFlat: changes.ribbonFlat ?? source.ribbonFlat,
    pathOutput: changes.pathOutput ?? source.pathOutput,
    pathStartScale: Math.max(0.05, Math.min(5, changes.pathStartScale ?? source.pathStartScale ?? 1)),
    pathEndScale: Math.max(0.05, Math.min(5, changes.pathEndScale ?? source.pathEndScale ?? 1)),
    pathTwist: Math.max(-3600, Math.min(3600, changes.pathTwist ?? source.pathTwist ?? 360)),
    pathSpacing: Math.max(1, Math.min(512, changes.pathSpacing ?? source.pathSpacing ?? 16)),
    pathOffset: Math.max(-256, Math.min(256, changes.pathOffset ?? source.pathOffset ?? 0)),
    pathProfile: changes.pathProfile ?? source.pathProfile,
    pathProfileWidth: Math.max(0.1, Math.min(8, changes.pathProfileWidth ?? source.pathProfileWidth ?? 1)),
    pathProfileHeight: Math.max(0.1, Math.min(8, changes.pathProfileHeight ?? source.pathProfileHeight ?? 1)),
    pathChainAlternating: changes.pathChainAlternating ?? source.pathChainAlternating,
    pathCardCrossed: changes.pathCardCrossed ?? source.pathCardCrossed,
    pathDistributionMode: changes.pathDistributionMode ?? source.pathDistributionMode,
    pathCount: Math.max(1, Math.min(1e3, changes.pathCount ?? source.pathCount ?? 8)),
    pathStartPadding: Math.max(0, changes.pathStartPadding ?? source.pathStartPadding ?? 0),
    pathEndPadding: Math.max(0, changes.pathEndPadding ?? source.pathEndPadding ?? 0),
    pathRandomScale: Math.max(0, Math.min(1, changes.pathRandomScale ?? source.pathRandomScale ?? 0)),
    pathRotation: changes.pathRotation ?? source.pathRotation ?? 0,
    pathRandomRotation: Math.max(0, Math.min(360, changes.pathRandomRotation ?? source.pathRandomRotation ?? 0)),
    pathAlternateRotation: changes.pathAlternateRotation ?? source.pathAlternateRotation,
    pathMirrorAlternate: changes.pathMirrorAlternate ?? source.pathMirrorAlternate,
    pathSeed: Math.floor(changes.pathSeed ?? source.pathSeed ?? 1),
    pathKeepInstances: changes.pathKeepInstances ?? source.pathKeepInstances
  };
  const path = clonePath(nextSource.path);
  const rebuilt = vectorPathToMesh(path, {
    view: path.view,
    polyBudget: nextSource.polyBudget ?? VECTOR_PEN_POLY_BUDGET,
    brushDensity: nextSource.brushDensity,
    strokeMode: nextSource.strokeMode,
    rdpTolerance: nextSource.rdpTolerance,
    closeThreshold: nextSource.closeThreshold,
    defaultDepth: nextSource.defaultDepth,
    color: path.color,
    stylize: nextSource.stylize,
    extrudeMode: nextSource.latheMode ? false : nextSource.extrudeMode,
    latheMode: nextSource.latheMode,
    latheCaps: nextSource.latheCaps,
    latheRadialSegments: nextSource.latheRadialSegments,
    latheProfileRings: nextSource.latheProfileRings,
    latheSmoothing: nextSource.latheSmoothing,
    extrudeAmount: nextSource.extrudeDepth,
    blobInflation: nextSource.blobInflation,
    hairTipStyle: nextSource.hairTipStyle,
    pathStartCap: nextSource.pathStartCap,
    pathEndCap: nextSource.pathEndCap,
    pathRadialSegments: nextSource.pathRadialSegments,
    pathRadiusScale: nextSource.pathRadiusScale,
    ribbonStartTip: nextSource.ribbonStartTip,
    ribbonEndTip: nextSource.ribbonEndTip,
    ribbonTaper: nextSource.ribbonTaper,
    ribbonWidthScale: nextSource.ribbonWidthScale,
    ribbonFlat: nextSource.ribbonFlat,
    pathOutput: nextSource.pathOutput,
    pathStartScale: nextSource.pathStartScale,
    pathEndScale: nextSource.pathEndScale,
    pathTwist: nextSource.pathTwist,
    pathSpacing: nextSource.pathSpacing,
    pathOffset: nextSource.pathOffset,
    pathProfile: nextSource.pathProfile,
    pathProfileWidth: nextSource.pathProfileWidth,
    pathProfileHeight: nextSource.pathProfileHeight,
    pathChainAlternating: nextSource.pathChainAlternating,
    pathCardCrossed: nextSource.pathCardCrossed,
    pathDistributionMode: nextSource.pathDistributionMode,
    pathCount: nextSource.pathCount,
    pathStartPadding: nextSource.pathStartPadding,
    pathEndPadding: nextSource.pathEndPadding,
    pathRandomScale: nextSource.pathRandomScale,
    pathRotation: nextSource.pathRotation,
    pathRandomRotation: nextSource.pathRandomRotation,
    pathAlternateRotation: nextSource.pathAlternateRotation,
    pathMirrorAlternate: nextSource.pathMirrorAlternate,
    pathSeed: nextSource.pathSeed,
    pathKeepInstances: nextSource.pathKeepInstances
  });
  if (!rebuilt) return null;
  return {
    ...rebuilt,
    id: obj.id,
    name: obj.name,
    transform: obj.transform ?? {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale }
    },
    smoothShading: obj.smoothShading ?? false,
    material: obj.material,
    faceMaterials: obj.faceMaterials,
    uvMappingMode: obj.uvMappingMode,
    visible: obj.visible,
    vectorSource: {
      ...nextSource,
      path: { ...path, objectId: obj.id }
    }
  };
}
function regenerateVectorObject(obj, extrudeDepth) {
  return regenerateVectorObjectFromSource(obj, { extrudeDepth });
}
export {
  attachVectorSource,
  isVectorDoodleObject,
  regenerateVectorObject,
  regenerateVectorObjectFromSource
};
