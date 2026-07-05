import { useMemo, useEffect, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import { edgeKey, parseEdgeKey } from '../mesh/meshSelection'
import {
  buildEdgeSegmentsGeometry,
  buildFacesFillGeometry,
  collectUniqueEdges,
} from '../mesh/meshTopology'
import {
  boundaryEdgesForFaces,
  getFaceGroupMap,
} from '../mesh/faceGroups'
import type { SelectionMode } from '../store/appStore'
import { useAppStore } from '../store/appStore'
import type { MeshPickHit } from '../select/meshPick'
import { useTheme } from '../theme/useTheme'
import { worldPointFromObject } from '../mesh/objectTransform'
import { worldUnitsForScreenPixels } from '../utils/screenScale'
import {
  buildVertexOverlayGroups,
  vertexHandleLocalPosition,
} from '../mesh/vertexOverlay'
import {
  allFaceOverlayIndices,
  collectHighlightedFaceIndices,
  resolveFaceOverlayGroupState,
} from '../mesh/faceOverlay'

const _scratchWorld = new THREE.Vector3()

const OVERLAY_RENDER = 40

/** Push depth-tested vertex cubes past the mesh surface (~half cube + margin). */
const VERTEX_SURFACE_NUDGE = 0.55

const UNIT_VERTEX_CUBE = new THREE.BoxGeometry(1, 1, 1)
const UNIT_VERTEX_CUBE_EDGES = new THREE.EdgesGeometry(UNIT_VERTEX_CUBE)

const VERTEX_PIXEL_SIZE = {
  idle: 7,
  hover: 9,
  selected: 11,
} as const

function vertexColors(theme: ReturnType<typeof useTheme>) {
  return {
    idleFill: theme.text,
    idleBorder: theme.textMuted,
    hoverFill: theme.meshHover,
    hoverBorder: theme.accentOrange,
    selectedFill: theme.meshSelected,
    selectedBorder: theme.text,
  }
}

function edgeColors(theme: ReturnType<typeof useTheme>) {
  return {
    idle: theme.textMuted,
    hover: theme.accentGreen,
    selected: theme.accent,
  }
}

function faceColors(theme: ReturnType<typeof useTheme>) {
  return {
    idleFill: theme.text,
    idleWire: theme.textMuted,
    hoverFill: theme.meshHover,
    hoverWire: theme.accentOrange,
    selectedFill: theme.accentOrange,
    selectedWire: theme.text,
  }
}

interface MeshEditVisualsProps {
  object: SceneObject
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  meshHover: MeshPickHit | null
  showPickableOverlay: boolean
}

function VertexHandle({
  object,
  position,
  state,
  cullBackfaces,
}: {
  object: SceneObject
  position: { x: number; y: number; z: number }
  state: 'idle' | 'hover' | 'selected'
  cullBackfaces: boolean
}) {
  const theme = useTheme()
  const { camera, size } = useThree()
  const rootRef = useRef<THREE.Group>(null)
  const scaleRef = useRef<THREE.Group>(null)
  const pixelSize = VERTEX_PIXEL_SIZE[state]
  const depthTest = cullBackfaces
  const VERTEX = vertexColors(theme)
  const fill =
    state === 'selected'
      ? VERTEX.selectedFill
      : state === 'hover'
        ? VERTEX.hoverFill
        : VERTEX.idleFill
  const border =
    state === 'selected'
      ? VERTEX.selectedBorder
      : state === 'hover'
        ? VERTEX.hoverBorder
        : VERTEX.idleBorder
  const fillOpacity = state === 'idle' ? 0.82 : 0.96

  useFrame(() => {
    const root = rootRef.current
    const group = scaleRef.current
    if (!root || !group) return

    const world = worldPointFromObject(object, position)
    _scratchWorld.set(world.x, world.y, world.z)
    const worldSize = worldUnitsForScreenPixels(camera, _scratchWorld, pixelSize, size.height)
    group.scale.setScalar(worldSize)

    if (cullBackfaces) {
      const nudged = vertexHandleLocalPosition(
        object,
        position,
        camera,
        worldSize * VERTEX_SURFACE_NUDGE
      )
      root.position.set(nudged.x, nudged.y, nudged.z)
    } else {
      root.position.set(position.x, position.y, position.z)
    }
  })

  return (
    <group ref={rootRef} position={[position.x, position.y, position.z]} renderOrder={OVERLAY_RENDER + 2}>
      <group ref={scaleRef}>
        <mesh geometry={UNIT_VERTEX_CUBE}>
          <meshBasicMaterial
            color={fill}
            transparent
            opacity={fillOpacity}
            depthTest={depthTest}
            depthWrite={false}
            polygonOffset={depthTest}
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
            toneMapped={false}
          />
        </mesh>
        <lineSegments geometry={UNIT_VERTEX_CUBE_EDGES} renderOrder={OVERLAY_RENDER + 3}>
          <lineBasicMaterial
            color={border}
            transparent
            opacity={0.98}
            depthTest={depthTest}
            depthWrite={false}
            polygonOffset={depthTest}
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
            toneMapped={false}
          />
        </lineSegments>
      </group>
    </group>
  )
}

function EdgeHighlight({
  object,
  edge,
  state,
  cullBackfaces,
}: {
  object: SceneObject
  edge: [number, number]
  state: 'idle' | 'hover' | 'selected'
  cullBackfaces: boolean
}) {
  const theme = useTheme()
  const EDGE = edgeColors(theme)
  const pa = object.positions[edge[0]]
  const pb = object.positions[edge[1]]
  if (!pa || !pb) return null

  const color = state === 'selected' ? EDGE.selected : state === 'hover' ? EDGE.hover : EDGE.idle
  const width = state === 'selected' ? 3.5 : state === 'hover' ? 3 : 1.4
  const opacity = state === 'idle' ? 0.55 : 0.98

  return (
    <Line
      points={[
        [pa.x, pa.y, pa.z],
        [pb.x, pb.y, pb.z],
      ]}
      color={color}
      lineWidth={width}
      transparent
      opacity={opacity}
      depthTest={cullBackfaces}
      depthWrite={false}
      renderOrder={OVERLAY_RENDER + (state === 'idle' ? 0 : 2)}
    />
  )
}

function FaceRegionHighlight({
  object,
  faceIndices,
  state,
  hasTexture = false,
  cullBackfaces,
}: {
  object: SceneObject
  faceIndices: number[]
  state: 'idle' | 'hover' | 'selected'
  hasTexture?: boolean
  cullBackfaces: boolean
}) {
  const theme = useTheme()
  const FACE = faceColors(theme)
  const geometry = useMemo(
    () => buildFacesFillGeometry(object, faceIndices),
    [object, faceIndices]
  )

  const boundarySegments = useMemo(() => {
    const edges = boundaryEdgesForFaces(object, faceIndices)
    return buildEdgeSegmentsGeometry(object, edges)
  }, [object, faceIndices])

  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => boundarySegments?.dispose(), [boundarySegments])
  if (!geometry) return null

  const fill =
    state === 'selected' ? FACE.selectedFill : state === 'hover' ? FACE.hoverFill : FACE.idleFill
  const opacity = hasTexture
    ? state === 'selected'
      ? 0.28
      : state === 'hover'
        ? 0.18
        : 0
    : state === 'selected'
      ? 0.58
      : state === 'hover'
        ? 0.44
        : 0.1
  const wireColor =
    state === 'selected' ? FACE.selectedWire : state === 'hover' ? FACE.hoverWire : FACE.idleWire
  const wireOpacity = hasTexture
    ? state === 'idle'
      ? 0
      : state === 'selected'
        ? 0.95
        : 0.8
    : state === 'idle'
      ? 0.45
      : 0.95
  const showFill = opacity > 0
  const depthBias = cullBackfaces
  const renderOrder =
    OVERLAY_RENDER + (state === 'selected' ? 4 : state === 'hover' ? 3 : 0)

  return (
    <group renderOrder={renderOrder}>
      {showFill && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color={fill}
            transparent
            opacity={opacity}
            depthTest={cullBackfaces}
            depthWrite={false}
            polygonOffset={depthBias}
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
            side={cullBackfaces ? THREE.FrontSide : THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      {boundarySegments && wireOpacity > 0 && (
        <lineSegments geometry={boundarySegments} renderOrder={renderOrder + 1}>
          <lineBasicMaterial
            color={wireColor}
            transparent
            opacity={wireOpacity}
            depthTest={cullBackfaces}
            depthWrite={false}
            polygonOffset={depthBias}
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
            toneMapped={false}
          />
        </lineSegments>
      )}
    </group>
  )
}

function resolveVertexGroupState(
  indices: number[],
  objectId: string,
  meshSelection: MeshComponentSelection | null,
  meshHover: MeshPickHit | null
): 'idle' | 'hover' | 'selected' {
  let state: 'idle' | 'hover' | 'selected' = 'idle'
  for (const vi of indices) {
    const next = resolveVertexState(vi, objectId, meshSelection, meshHover)
    if (next === 'selected') return 'selected'
    if (next === 'hover') state = 'hover'
  }
  return state
}

function resolveVertexState(
  vi: number,
  objectId: string,
  meshSelection: MeshComponentSelection | null,
  meshHover: MeshPickHit | null
): 'idle' | 'hover' | 'selected' {
  if (meshSelection?.objectId === objectId && meshSelection.vertices.includes(vi)) {
    return 'selected'
  }
  if (meshHover?.objectId === objectId && meshHover.vertex === vi) {
    return 'hover'
  }
  return 'idle'
}

function resolveEdgeState(
  a: number,
  b: number,
  objectId: string,
  meshSelection: MeshComponentSelection | null,
  meshHover: MeshPickHit | null
): 'idle' | 'hover' | 'selected' {
  const key = edgeKey(a, b)
  if (meshSelection?.objectId === objectId && meshSelection.edges.includes(key)) {
    return 'selected'
  }
  if (meshHover?.objectId === objectId && meshHover.edge) {
    const hk = edgeKey(meshHover.edge[0], meshHover.edge[1])
    if (hk === key) return 'hover'
  }
  return 'idle'
}

export function MeshEditVisuals({
  object,
  selectionMode,
  meshSelection,
  meshHover,
  showPickableOverlay,
}: MeshEditVisualsProps) {
  const theme = useTheme()
  const EDGE = edgeColors(theme)
  const FACE = faceColors(theme)
  const objectId = object.id
  const cullBackfaces = !useAppStore((s) => s.viewportXRay)
  const hasTexture = useAppStore((s) => Boolean(s.objectTextures[object.id]?.url))
  const hoverOnObject = meshHover?.objectId === objectId
  const selectionOnObject = meshSelection?.objectId === objectId

  const allEdges = useMemo(() => collectUniqueEdges(object), [object])
  const faceGroupMap = useMemo(() => getFaceGroupMap(object), [object])

  const idleEdgeGeometry = useMemo(() => {
    if (!showPickableOverlay || selectionMode !== 'edge') return null
    return buildEdgeSegmentsGeometry(object, allEdges)
  }, [object, allEdges, showPickableOverlay, selectionMode])

  useEffect(() => () => idleEdgeGeometry?.dispose(), [idleEdgeGeometry])

  const highlightedFaceKey = useMemo(() => {
    const highlighted = collectHighlightedFaceIndices(
      object,
      selectionOnObject ? meshSelection?.faces : undefined,
      hoverOnObject ? meshHover?.face : undefined
    )
    return [...highlighted].sort((a, b) => a - b).join(',')
  }, [
    object,
    selectionOnObject,
    meshSelection?.faces,
    hoverOnObject,
    meshHover?.face,
  ])

  const idleFaceFillGeometry = useMemo(() => {
    if (!showPickableOverlay || selectionMode !== 'face' || hasTexture) return null
    const all = allFaceOverlayIndices(faceGroupMap.groups)
    const highlighted = new Set(
      highlightedFaceKey ? highlightedFaceKey.split(',').map((s) => Number(s)) : []
    )
    const idle = highlighted.size > 0 ? all.filter((fi) => !highlighted.has(fi)) : all
    if (idle.length === 0) return null
    return buildFacesFillGeometry(object, idle)
  }, [
    object,
    faceGroupMap,
    showPickableOverlay,
    selectionMode,
    hasTexture,
    highlightedFaceKey,
  ])

  useEffect(() => () => idleFaceFillGeometry?.dispose(), [idleFaceFillGeometry])

  if (selectionMode === 'vertex') {
    const highlightIndices = [
      ...(selectionOnObject ? meshSelection!.vertices : []),
      ...(hoverOnObject && meshHover?.vertex !== undefined ? [meshHover.vertex] : []),
    ]
    const vertexGroups = buildVertexOverlayGroups(
      object,
      showPickableOverlay ? undefined : highlightIndices
    )

    return (
      <group renderOrder={OVERLAY_RENDER}>
        {vertexGroups.map((group) => {
          const state = resolveVertexGroupState(group.indices, objectId, meshSelection, meshHover)
          if (!showPickableOverlay && state === 'idle') return null
          return (
            <VertexHandle
              key={`v-${group.key}`}
              object={object}
              position={group.position}
              state={state}
              cullBackfaces={cullBackfaces}
            />
          )
        })}
      </group>
    )
  }

  if (selectionMode === 'edge') {
    const highlightedKeys = new Set<string>()
    if (selectionOnObject) {
      for (const key of meshSelection!.edges) highlightedKeys.add(key)
    }
    if (hoverOnObject && meshHover?.edge) {
      highlightedKeys.add(edgeKey(meshHover.edge[0], meshHover.edge[1]))
    }

    const activeEdges = showPickableOverlay
      ? allEdges.filter(([a, b]) => {
          const state = resolveEdgeState(a, b, objectId, meshSelection, meshHover)
          return state !== 'idle'
        })
      : [...highlightedKeys].map((key) => parseEdgeKey(key))

    return (
      <group renderOrder={OVERLAY_RENDER}>
        {showPickableOverlay && idleEdgeGeometry && (
          <lineSegments geometry={idleEdgeGeometry} renderOrder={OVERLAY_RENDER}>
            <lineBasicMaterial
              color={EDGE.idle}
              transparent
              opacity={0.5}
              depthTest={cullBackfaces}
              depthWrite={false}
              toneMapped={false}
            />
          </lineSegments>
        )}

        {activeEdges.map(([a, b]) => {
          const state = resolveEdgeState(a, b, objectId, meshSelection, meshHover)
          if (state === 'idle') return null
          return (
            <EdgeHighlight
              key={edgeKey(a, b)}
              object={object}
              edge={[a, b]}
              state={state}
              cullBackfaces={cullBackfaces}
            />
          )
        })}
      </group>
    )
  }

  if (selectionMode === 'face') {
    const activeGroups = faceGroupMap.groups.filter((group) => {
      const state = resolveFaceOverlayGroupState(
        group,
        objectId,
        meshSelection,
        meshHover,
        faceGroupMap.faceToGroup
      )
      return state !== 'idle'
    })

    return (
      <group renderOrder={OVERLAY_RENDER}>
        {showPickableOverlay && !hasTexture && idleFaceFillGeometry && (
          <mesh geometry={idleFaceFillGeometry} renderOrder={OVERLAY_RENDER}>
            <meshBasicMaterial
              color={FACE.idleFill}
              transparent
              opacity={0.1}
              depthTest={cullBackfaces}
              depthWrite={false}
              polygonOffset={cullBackfaces}
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
              side={cullBackfaces ? THREE.FrontSide : THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        )}

        {activeGroups.map((group) => {
          const state = resolveFaceOverlayGroupState(
            group,
            objectId,
            meshSelection,
            meshHover,
            faceGroupMap.faceToGroup
          )
          return (
            <FaceRegionHighlight
              key={`fg-${group.id}`}
              object={object}
              faceIndices={group.faceIndices}
              state={state}
              hasTexture={hasTexture}
              cullBackfaces={cullBackfaces}
            />
          )
        })}
      </group>
    )
  }

  return null
}
