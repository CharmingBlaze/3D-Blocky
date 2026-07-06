import { useMemo, useRef, useEffect, memo } from 'react'
import { Edges, Outlines } from '@react-three/drei'
import * as THREE from 'three'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { computeVertexDensity } from '../sculpt/sculptTools'
import {
  VIEWPORT_DISPLAY_CONFIG,
  resolveFlatShading,
  type ViewportDisplayMode,
} from '../rendering/viewportDisplay'
import { useAppStore } from '../store/appStore'
import { ensureObjectUVs } from '../uv/uvObject'
import { resolveSubdivisionPreview } from '../mesh/subdivisionSurface'
import { useLoadedTexture, usePixelDocumentTexture } from '../rendering/textureCache'
import {
  patchPixelTextureBlendShader,
  PIXEL_TEXTURE_BLEND_CACHE_KEY,
} from '../rendering/pixelTextureBlend'
import { useTheme } from '../theme/useTheme'
import { ensureObjectMaterial } from '../material/materials'
import { setFlatNormalsFromIndices } from '../rendering/meshGeometry'
import {
  buildEdgeSegmentsGeometry,
  collectUniqueEdges,
} from '../mesh/meshTopology'

interface MeshRendererProps {
  object: SceneObject
  isSelected: boolean
  isPrimary?: boolean
  objectSelectionOutline?: boolean
  facetExaggeration: number
  showDensityHeatmap: boolean
  displayMode: ViewportDisplayMode
}

function buildGeometry(
  object: SceneObject,
  flatShading: boolean,
  facetExaggeration: number,
  showDensityHeatmap: boolean,
  omitVertexColors = false
): THREE.BufferGeometry {
  const mesh = HalfEdgeMesh.fromObject(object)
  const data = mesh.toMeshData(flatShading, facetExaggeration)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))

  if (data.uvs && data.uvs.length > 0) {
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  }

  if (showDensityHeatmap) {
    const densities = computeVertexDensity(mesh)
    const colors = new Float32Array(data.positions.length)
    for (let i = 0; i < data.positions.length / 3; i++) {
      const vi = Math.floor(i / (data.positions.length / 3 / object.positions.length))
      const d = densities[Math.min(vi, densities.length - 1)] ?? 0
      colors[i * 3] = d
      colors[i * 3 + 1] = 0.2
      colors[i * 3 + 2] = 1 - d
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  } else if (!omitVertexColors && data.faceColors.length > 0) {
    geo.setAttribute('color', new THREE.BufferAttribute(data.faceColors, 3))
  }

  if (flatShading) setFlatNormalsFromIndices(geo)
  else geo.computeVertexNormals()
  return geo
}

function MeshMaterial({
  config,
  flatShading,
  emissive,
  emissiveIntensity,
  wireframe,
  opacity = 1,
  side = THREE.FrontSide,
  map,
  useVertexColors,
  useTexture,
  textureAlpha = false,
  pixelTextureBlend = false,
}: {
  config: (typeof VIEWPORT_DISPLAY_CONFIG)[ViewportDisplayMode]
  flatShading: boolean
  emissive: THREE.Color
  emissiveIntensity: number
  wireframe?: boolean
  opacity?: number
  side?: THREE.Side
  map?: THREE.Texture | null
  useVertexColors: boolean
  useTexture: boolean
  textureAlpha?: boolean
  pixelTextureBlend?: boolean
}) {
  const onBeforeCompile = pixelTextureBlend ? patchPixelTextureBlendShader : undefined
  const customProgramCacheKey = pixelTextureBlend
    ? () => PIXEL_TEXTURE_BLEND_CACHE_KEY
    : undefined

  const common = {
    vertexColors: useVertexColors,
    flatShading,
    side,
    wireframe: wireframe ?? config.wireframe,
    transparent: pixelTextureBlend ? opacity < 1 : opacity < 1 || textureAlpha,
    opacity,
    alphaTest: pixelTextureBlend ? undefined : textureAlpha ? 0.02 : undefined,
    depthWrite: pixelTextureBlend ? opacity >= 1 : undefined,
    map: useTexture ? (map ?? undefined) : undefined,
    color: useTexture && !pixelTextureBlend ? '#ffffff' : undefined,
    onBeforeCompile,
    customProgramCacheKey,
  }

  switch (config.material) {
    case 'basic':
      return <meshBasicMaterial {...common} toneMapped={config.gameLighting} />
    case 'lambert':
      return (
        <meshLambertMaterial
          {...common}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
      )
    case 'toon':
      return (
        <meshToonMaterial
          {...common}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
      )
    case 'standard':
    default:
      return (
        <meshStandardMaterial
          {...common}
          roughness={useTexture ? 1 : 0.85}
          metalness={0}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          toneMapped
        />
      )
  }
}

export const MeshRenderer = memo(function MeshRenderer({
  object,
  isSelected: _isSelected,
  isPrimary = false,
  objectSelectionOutline = false,
  facetExaggeration,
  showDensityHeatmap,
  displayMode,
}: MeshRendererProps) {
  const { meshOutline, meshOutlineSecondary, objectSelectOutline, objectSelectOutlineSecondary, accentOrange } = useTheme()
  const meshRef = useRef<THREE.Mesh>(null)
  const geometryRef = useRef<THREE.BufferGeometry | null>(null)
  const materialSettings = useMemo(() => ensureObjectMaterial(object).material!, [object])
  const texId = useMemo(
    () => (materialSettings.mode === 'texture' ? materialSettings.textureId ?? object.id : null),
    [materialSettings, object.id]
  )
  const textureMeta = useAppStore((s) => (texId ? s.objectTextures[texId] : undefined))
  const pixelDoc = useAppStore((s) => (texId ? s.pixelDocuments[texId] : undefined))
  const textureUrl = textureMeta?.url ?? null
  const updateObject = useAppStore((s) => s.updateObject)
  const config = VIEWPORT_DISPLAY_CONFIG[displayMode]
  const flatShading = resolveFlatShading(
    object.subdEnabled ? true : object.smoothShading,
    displayMode
  )
  const useTexture =
    materialSettings.mode === 'texture' &&
    config.supportsTexture &&
    Boolean(pixelDoc || textureUrl)
  const usePixelTexture = Boolean(pixelDoc && useTexture)
  const meshSide =
    usePixelTexture && !materialSettings.doubleSided ? THREE.FrontSide : THREE.DoubleSide
  const meshOpacity = materialSettings.opacity

  const renderObject = useMemo(() => {
    const base = useTexture ? ensureObjectUVs(object) : object
    const preview = resolveSubdivisionPreview(base)
    if (object.subdEnabled && object.subdLevels && object.subdLevels > 0) {
      return { ...preview, smoothShading: true }
    }
    return base
  }, [object, useTexture])

  const urlTexture = useLoadedTexture(useTexture && !pixelDoc && textureUrl ? textureUrl : null)
  const dataTexture = usePixelDocumentTexture(pixelDoc ? texId : null)
  const texture = pixelDoc ? dataTexture : urlTexture

  useEffect(() => {
    if (!textureUrl || object.uvs?.length) return
    const withUvs = ensureObjectUVs(object)
    updateObject(object.id, {
      uvs: withUvs.uvs,
      faceUvIndices: withUvs.faceUvIndices,
    })
  }, [object.id, object.uvs?.length, textureUrl, object, updateObject])

  const cageGeometry = useMemo(() => {
    if (!object.subdEnabled || !object.subdLevels || object.subdLevels <= 0) return null
    const cage = useTexture ? ensureObjectUVs(object) : object
    return buildGeometry(cage, true, 0, false, true)
  }, [
    object,
    object.subdEnabled,
    object.subdLevels,
    object.positions,
    object.faces,
    useTexture,
  ])

  useEffect(() => () => cageGeometry?.dispose(), [cageGeometry])

  const geometry = useMemo(() => {
    const geo = buildGeometry(
      renderObject,
      flatShading,
      facetExaggeration,
      showDensityHeatmap,
      useTexture && !usePixelTexture
    )
    geometryRef.current = geo
    return geo
  }, [
    renderObject.positions,
    renderObject.faces,
    object.subdEnabled,
    object.subdLevels,
    renderObject.uvs,
    renderObject.faceUvIndices,
    renderObject.cornerColors,
    renderObject.faceColorIndices,
    renderObject.material,
    renderObject.smoothShading,
    flatShading,
    facetExaggeration,
    showDensityHeatmap,
    useTexture,
    usePixelTexture,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const geo = geometryRef.current
    if (!geo) return
    const data = HalfEdgeMesh.fromObject(renderObject).toMeshData(flatShading, facetExaggeration)
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined
    if (posAttr && posAttr.array.length === data.positions.length) {
      posAttr.copyArray(data.positions)
      posAttr.needsUpdate = true
      if (flatShading) setFlatNormalsFromIndices(geo)
      else geo.computeVertexNormals()
    }
  }, [renderObject.positions, flatShading, facetExaggeration])

  useEffect(() => {
    const geo = geometryRef.current
    if (!geo || !renderObject.uvs?.length) return
    const data = HalfEdgeMesh.fromObject(renderObject).toMeshData(flatShading, facetExaggeration)
    if (!data.uvs?.length) return
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
    if (uvAttr && uvAttr.array.length === data.uvs.length) {
      uvAttr.copyArray(data.uvs)
      uvAttr.needsUpdate = true
    } else if (!uvAttr) {
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
    }
  }, [renderObject.uvs, renderObject.faceUvIndices, flatShading, facetExaggeration])

  const emissive = useMemo(() => new THREE.Color(0x000000), [])
  const emissiveIntensity = 0

  const edgeColor = displayMode === 'model' ? meshOutlineSecondary : meshOutline
  const edgeThreshold = !flatShading
    ? 50
    : displayMode === 'model'
      ? 15
      : 12
  const wireColor = meshOutline

  const topologyEdgeGeometry = useMemo(() => {
    if (!config.showEdgeOutline || !flatShading) return null
    return buildEdgeSegmentsGeometry(renderObject, collectUniqueEdges(renderObject))
  }, [
    config.showEdgeOutline,
    flatShading,
    renderObject.positions,
    renderObject.faces,
  ])

  useEffect(() => () => topologyEdgeGeometry?.dispose(), [topologyEdgeGeometry])

  const useVertexColors = !useTexture || usePixelTexture

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry} renderOrder={0}>
        <MeshMaterial
          key={texture ? `${textureUrl}-${texture.uuid}` : textureUrl ?? 'no-tex'}
          config={config}
          flatShading={flatShading}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          opacity={meshOpacity}
          side={meshSide}
          map={texture}
          useVertexColors={useVertexColors}
          useTexture={useTexture}
          textureAlpha={Boolean(useTexture && !usePixelTexture && textureUrl && !pixelDoc)}
          pixelTextureBlend={usePixelTexture}
        />
        {config.showEdgeOutline && topologyEdgeGeometry && (
          <lineSegments geometry={topologyEdgeGeometry} renderOrder={2}>
            <lineBasicMaterial
              color={edgeColor}
              transparent
              opacity={0.88}
              depthTest
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </lineSegments>
        )}
        {config.showEdgeOutline && !flatShading && (
          <Edges threshold={edgeThreshold} color={edgeColor} renderOrder={2} />
        )}
        {objectSelectionOutline && (
          <Outlines
            color={isPrimary ? objectSelectOutline : objectSelectOutlineSecondary}
            thickness={isPrimary ? 0.022 : 0.018}
            screenspace
            transparent
            opacity={isPrimary ? 0.95 : 0.85}
            toneMapped={false}
            polygonOffset
            polygonOffsetFactor={-1}
            angle={Math.PI}
            renderOrder={5}
          />
        )}
      </mesh>

      {object.subdEnabled && object.subdLevels && object.subdLevels > 0 && cageGeometry && (
        <mesh geometry={cageGeometry} renderOrder={3}>
          <meshBasicMaterial
            wireframe
            color={accentOrange}
            transparent
            opacity={0.45}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {config.wireOverlay && (
        <mesh geometry={geometry} renderOrder={1}>
          <meshBasicMaterial
            wireframe
            vertexColors={false}
            color={wireColor}
            transparent
            opacity={0.55}
            side={meshSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      )}
    </group>
  )
}, (prev, next) =>
  prev.object === next.object &&
  prev.object.smoothShading === next.object.smoothShading &&
  prev.isSelected === next.isSelected &&
  prev.isPrimary === next.isPrimary &&
  prev.objectSelectionOutline === next.objectSelectionOutline &&
  prev.facetExaggeration === next.facetExaggeration &&
  prev.showDensityHeatmap === next.showDensityHeatmap &&
  prev.displayMode === next.displayMode
)
