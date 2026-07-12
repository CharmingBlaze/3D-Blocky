import { performance } from 'node:perf_hooks'
import {
  buildViewportMeshGeometry,
  clearViewportGeometryBuildCache,
} from '../src/components/MeshRenderer'
import { buildEdgeSegmentsGeometry, collectUniqueEdges } from '../src/mesh/meshTopology'
import { prepareSceneObject } from '../src/mesh/objectTransform'
import type { SceneObject } from '../src/mesh/HalfEdgeMesh'

function gridObject(side: number): SceneObject {
  const positions: Array<{ x: number; y: number; z: number }> = []
  const faces: number[][] = []
  for (let y = 0; y <= side; y++) {
    for (let x = 0; x <= side; x++) positions.push({ x, y, z: 0 })
  }
  const stride = side + 1
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const a = y * stride + x
      faces.push([a, a + 1, a + stride + 1, a + stride])
    }
  }
  return prepareSceneObject({
    id: `grid-${side}`,
    name: `Grid ${side}`,
    positions,
    faces,
    faceColors: faces.map(() => 0x7aa7d9),
    color: 0x7aa7d9,
    topologyLocked: false,
    polyBudget: Math.max(256, positions.length),
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
  })
}

function measure(label: string, runs: number, action: () => void): number {
  action()
  const started = performance.now()
  for (let i = 0; i < runs; i++) action()
  const elapsed = performance.now() - started
  const mean = elapsed / runs
  console.log(`${label}: ${mean.toFixed(2)} ms mean (${runs} runs)`)
  return mean
}

for (const side of [31, 70, 100]) {
  const object = gridObject(side)
  const edges = collectUniqueEdges(object)
  const runs = side >= 100 ? 3 : 5
  console.log(`\n${object.name}: ${object.positions.length} vertices, ${object.faces.length} quads, ${edges.length} edges`)
  const geometryMs = measure('cold viewport geometry', runs, () => {
    clearViewportGeometryBuildCache()
    const geometry = buildViewportMeshGeometry(object, true, 0, false)
    geometry.dispose()
  })
  const edgesMs = measure('edge overlay', runs, () => {
    const geometry = buildEdgeSegmentsGeometry(object, edges)
    geometry.dispose()
  })
  const fourViewMs = measure('four-view shared build', runs, () => {
    clearViewportGeometryBuildCache()
    const geometries = Array.from({ length: 4 }, () =>
      buildViewportMeshGeometry(object, true, 0, false)
    )
    for (const geometry of geometries) geometry.dispose()
  })
  clearViewportGeometryBuildCache()
  console.log(`previous four-view estimate: ${(4 * (geometryMs + edgesMs)).toFixed(2)} ms`)
  console.log(`measured shared four-view total: ${(fourViewMs + 4 * edgesMs).toFixed(2)} ms`)
}
