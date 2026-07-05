import { curvatureSampleClosedLoop } from '../stroke/rdp'
import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'
import {
  buildDistanceField,
  extractMedialAxis,
  type MedialNode,
} from './distanceTransform'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { extrudeSilhouette } from './silhouetteExtrude'

export interface SilhouetteLoftOptions {
  depthScale: number
  roundness?: number
  radialSegments: number
  maxRings?: number
  minAngleDeg?: number
  maxBoundaryVerts?: number
  color?: number
}

function orderMedialChain(nodes: MedialNode[]): MedialNode[] {
  if (nodes.length <= 2) return nodes
  const start = nodes.reduce((best, n) => (n.radius > best.radius ? n : best))
  const remaining = nodes.filter((n) => n !== start)
  const chain: MedialNode[] = [start]

  while (remaining.length > 0) {
    const last = chain[chain.length - 1]
    let pick = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - last.x, remaining[i].y - last.y)
      if (d < bestDist) {
        bestDist = d
        pick = i
      }
    }
    chain.push(remaining[pick])
    remaining.splice(pick, 1)
  }

  return chain
}

function subsampleMedialNodes(nodes: MedialNode[], maxRings: number): MedialNode[] {
  if (nodes.length <= maxRings) return nodes
  const out: MedialNode[] = []
  const step = (nodes.length - 1) / (maxRings - 1)
  for (let i = 0; i < maxRings; i++) {
    out.push(nodes[Math.round(i * step)])
  }
  return out
}

function stitchRingPair(
  mesh: HalfEdgeMesh,
  ringA: number[],
  ringB: number[],
  color: number,
  flip = false
): void {
  const segments = ringA.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    const a = ringA[si]
    const b = ringA[next]
    const c = ringB[si]
    const d = ringB[next]
    if (flip) {
      mesh.faces.push([a, c, d])
      mesh.faces.push([a, d, b])
    } else {
      mesh.faces.push([a, b, d])
      mesh.faces.push([a, d, c])
    }
    mesh.faceColors.push(color, color)
  }
}

function addPoleCap(
  mesh: HalfEdgeMesh,
  ring: number[],
  node: MedialNode,
  z: number,
  color: number,
  flip: boolean
): void {
  const pole = mesh.positions.length
  mesh.positions.push({ x: node.x, y: node.y, z })
  const segments = ring.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    if (flip) mesh.faces.push([pole, ring[next], ring[si]])
    else mesh.faces.push([pole, ring[si], ring[next]])
    mesh.faceColors.push(color)
  }
}

function loftFromMedialNodes(
  nodes: MedialNode[],
  options: SilhouetteLoftOptions
): HalfEdgeMesh {
  const {
    depthScale,
    roundness = 0.88,
    radialSegments,
    color = 0x7ecba1,
  } = options

  const mesh = new HalfEdgeMesh()
  const segments = Math.max(4, radialSegments)
  const depth = Math.max(3, depthScale)
  const maxR = Math.max(...nodes.map((n) => n.radius), 1)

  const ringPairs: { top: number[]; bot: number[]; halfZ: number }[] = []

  for (const node of nodes) {
    const r = Math.max(0.75, node.radius * roundness)
    const halfZ = depth * (0.22 + 0.78 * Math.pow(r / maxR, 0.85))

    const top: number[] = []
    const bot: number[] = []
    for (let si = 0; si < segments; si++) {
      const angle = (si / segments) * Math.PI * 2
      const dx = Math.cos(angle) * r
      const dy = Math.sin(angle) * r
      top.push(mesh.positions.length)
      mesh.positions.push({ x: node.x + dx, y: node.y + dy, z: halfZ })
      bot.push(mesh.positions.length)
      mesh.positions.push({ x: node.x + dx, y: node.y + dy, z: -halfZ })
    }
    ringPairs.push({ top, bot, halfZ })
  }

  for (let i = 0; i < ringPairs.length - 1; i++) {
    stitchRingPair(mesh, ringPairs[i].top, ringPairs[i + 1].top, color)
    stitchRingPair(mesh, ringPairs[i].bot, ringPairs[i + 1].bot, color, true)
  }

  for (const pair of ringPairs) {
    stitchRingPair(mesh, pair.top, pair.bot, color)
  }

  const first = ringPairs[0]
  const last = ringPairs[ringPairs.length - 1]
  addPoleCap(mesh, first.top, nodes[0], first.halfZ * 1.02, color, false)
  addPoleCap(mesh, last.bot, nodes[nodes.length - 1], -last.halfZ * 1.02, color, true)

  mesh.buildHalfEdges()
  return mesh
}

/**
 * Paint 3D-style soft-edge volume: medial-axis ring loft with dome caps.
 * Clean low-poly topology — no dual contouring artifacts.
 */
export function generateSilhouetteLoft(
  polygon: Vec2[],
  options: SilhouetteLoftOptions
): HalfEdgeMesh {
  const {
    minAngleDeg = 14,
    maxBoundaryVerts = 32,
    maxRings = 8,
    depthScale,
    color,
  } = options

  const boundary = curvatureSampleClosedLoop(
    ensureCCW(polygon),
    minAngleDeg,
    maxBoundaryVerts
  )
  if (boundary.length < 3) return new HalfEdgeMesh()

  const gridRes = Math.max(24, Math.min(44, Math.ceil(Math.sqrt(boundary.length) * 2.8)))
  const grid = buildDistanceField(boundary, gridRes)
  let nodes = extractMedialAxis(grid)
  nodes = orderMedialChain(nodes)
  nodes = subsampleMedialNodes(nodes, maxRings)

  if (nodes.length < 2) {
    return extrudeSilhouette(boundary, {
      depth: Math.max(4, depthScale),
      color,
    })
  }

  return loftFromMedialNodes(nodes, options)
}

/** Sharp-edge variant — flat prism extrusion (Paint 3D sharp doodle). */
export function generateSharpSilhouette(
  polygon: Vec2[],
  options: Pick<SilhouetteLoftOptions, 'depthScale' | 'minAngleDeg' | 'maxBoundaryVerts' | 'color'>
): HalfEdgeMesh {
  const boundary = curvatureSampleClosedLoop(
    ensureCCW(polygon),
    options.minAngleDeg ?? 16,
    options.maxBoundaryVerts ?? 28
  )
  if (boundary.length < 3) return new HalfEdgeMesh()
  return extrudeSilhouette(boundary, {
    depth: Math.max(4, options.depthScale),
    color: options.color,
  })
}
