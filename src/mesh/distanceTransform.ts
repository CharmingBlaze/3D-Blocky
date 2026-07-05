import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'

export interface Grid2D {
  minX: number
  minY: number
  cellSize: number
  cols: number
  rows: number
  data: Float32Array
}

function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside
    }
  }
  return inside
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function signedDistToPolygon(p: Vec2, polygon: Vec2[]): number {
  let minDist = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    minDist = Math.min(minDist, distToSegment(p, polygon[i], polygon[j]))
  }
  return pointInPolygon(p, polygon) ? minDist : -minDist
}

export function buildDistanceField(polygon: Vec2[], resolution = 32): Grid2D {
  const poly = ensureCCW(polygon)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 2
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad

  const cols = resolution
  const rows = resolution
  const cellSize = Math.max((maxX - minX) / cols, (maxY - minY) / rows)
  const data = new Float32Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * cellSize
      const y = minY + (row + 0.5) * cellSize
      data[row * cols + col] = signedDistToPolygon({ x, y }, poly)
    }
  }

  return { minX, minY, cellSize, cols, rows, data }
}

export interface MedialNode {
  x: number
  y: number
  radius: number
}

export function extractMedialAxis(grid: Grid2D, minRadius = 1.5): MedialNode[] {
  const { cols, rows, data, minX, minY, cellSize } = grid
  const nodes: MedialNode[] = []

  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      const v = data[row * cols + col]
      if (v < minRadius) continue

      let isMax = true
      for (let dr = -1; dr <= 1 && isMax; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          if (data[(row + dr) * cols + (col + dc)] > v + 0.01) {
            isMax = false
            break
          }
        }
      }
      if (!isMax) continue

      nodes.push({
        x: minX + (col + 0.5) * cellSize,
        y: minY + (row + 0.5) * cellSize,
        radius: v,
      })
    }
  }

  if (nodes.length === 0) {
    let best = 0
    let bestIdx = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] > best) {
        best = data[i]
        bestIdx = i
      }
    }
    const col = bestIdx % cols
    const row = Math.floor(bestIdx / cols)
    nodes.push({
      x: minX + (col + 0.5) * cellSize,
      y: minY + (row + 0.5) * cellSize,
      radius: best,
    })
  }

  return thinNodes(nodes, cellSize * 2.5)
}

function thinNodes(nodes: MedialNode[], minDist: number): MedialNode[] {
  const sorted = [...nodes].sort((a, b) => b.radius - a.radius)
  const kept: MedialNode[] = []
  for (const n of sorted) {
    const tooClose = kept.some(
      (k) => Math.hypot(k.x - n.x, k.y - n.y) < minDist && k.radius >= n.radius * 0.8
    )
    if (!tooClose) kept.push(n)
  }
  return kept.slice(0, 24)
}

export function sampleDistance(grid: Grid2D, x: number, y: number): number {
  const { minX, minY, cellSize, cols, rows, data } = grid
  const col = (x - minX) / cellSize - 0.5
  const row = (y - minY) / cellSize - 0.5
  const c0 = Math.floor(col)
  const r0 = Math.floor(row)
  if (c0 < 0 || r0 < 0 || c0 >= cols - 1 || r0 >= rows - 1) return -1
  const fx = col - c0
  const fy = row - r0
  const v00 = data[r0 * cols + c0]
  const v10 = data[r0 * cols + c0 + 1]
  const v01 = data[(r0 + 1) * cols + c0]
  const v11 = data[(r0 + 1) * cols + c0 + 1]
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
}
