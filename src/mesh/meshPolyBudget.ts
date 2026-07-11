import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import { remeshOrganic } from './organicRemesh'
import { simplifyMesh } from './simplification'
import { MAX_SUBD_LEVELS } from './subdivisionSurface'

/** Upper bound for dual-contouring grid resolution derived from poly budget. */
export function gridResolutionCap(polyBudget: number): number {
  return Math.max(8, Math.min(18, Math.round(Math.cbrt(polyBudget * 5))))
}

/** Radial segments for CAD / vector primitives derived from poly budget. */
export function primitiveSegmentsForBudget(polyBudget: number, fallback = 8): number {
  return Math.max(6, Math.min(12, Math.floor(Math.sqrt(polyBudget * 0.5)) || fallback))
}

export function icosphereSubdivisionsForBudget(polyBudget: number): number {
  if (polyBudget <= 40) return 0
  if (polyBudget <= 112) return 1
  if (polyBudget <= 192) return 1
  return 2
}

export function maxRoundedBoxSubdivisionsForBudget(polyBudget: number): number {
  if (polyBudget <= 48) return 0
  if (polyBudget <= 96) return 1
  if (polyBudget <= 192) return 2
  return 2
}

/** Catmull-Clark ~4× verts per level — cap levels so bakes stay near budget. */
export function maxSubdLevelsForBudget(polyBudget: number, vertexCount: number): number {
  let verts = Math.max(1, vertexCount)
  let levels = 0
  const target = Math.max(polyBudget * 2, 24)
  while (levels < MAX_SUBD_LEVELS && verts * 4 <= target) {
    levels++
    verts *= 4
  }
  return levels
}

export function importVertexCap(polyBudget: number): number {
  return Math.max(128, Math.min(512, polyBudget * 4))
}

export function enforceSceneObjectPolyBudget(
  obj: SceneObject,
  budget: number,
  options?: { organic?: boolean }
): SceneObject {
  if (obj.topologyLocked || budget <= 0 || obj.polyBudgetMode === 'adaptive') return obj
  const mesh = HalfEdgeMesh.fromObject(obj)
  if (mesh.vertexCount() <= budget) return obj

  const simplified = options?.organic
    ? remeshOrganic(mesh, budget)
    : simplifyMesh(mesh, budget)

  return simplified.toObject(obj.id, obj.name, {
    ...obj,
    polyBudget: budget,
    polyBudgetMode: 'strict',
  })
}
