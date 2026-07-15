import { useMemo, useRef, useEffect, memo } from 'react'
import { useThree } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import * as THREE from 'three'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { computeVertexDensity } from '../sculpt/sculptTools'
import {
  VIEWPORT_DISPLAY_CONFIG,
  resolveFlatShading,
  type ViewportDisplayMode,
} from '../rendering/viewportDisplay'
import { useAppStore } from '../store/appStore'
import { VIEWPORT_XRAY_OPACITY } from '../store/viewportSlice'
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
import { subscribeUvDraft } from '../uv/uvDraftRelay'
import { patchMeshGeometryUvs } from '../uv/patchMeshGeometryUvs'
import { compositeLayers } from '../pixel/compositeLayers'

interface MeshRendererProps {
  object: SceneObject
  isSelected: boolean
  isPrimary?: boolean
  objectSelectionOutline?: boolean
  facetExaggeration: number
  showDensityHeatmap: boolean
  displayMode: ViewportDisplayMode
  viewportXRay?: boolean
}

const VIEWPORT_GEOMETRY_CACHE_WINDOW_MS = 16
const viewportGeometryBuildCache = new Map<SceneObject, Map<string, THREE.BufferGeometry>>()
let viewportGeometryCacheTimer: ReturnType<typeof setTimeout> | null = null

const viewportEdgeOutlineCache = new Map<SceneObject, THREE.BufferGeometry>()
let viewportEdgeOutlineCacheTimer: ReturnType<typeof setTimeout> | null = null

function geometryBuildKey(
  flatShading: boolean,
  facetExaggeration: number,
  showDensityHeatmap: boolean,
  omitVertexColors: boolean
): string {
  return `${flatShading ? 1 : 0}:${facetExaggeration}:${showDensityHeatmap ? 1 : 0}:${omitVertexColors ? 1 : 0}`
}

/** Clears CPU templates used only to share one geometry-build wave across viewports. */
export function clearViewportGeometryBuildCache(): void {
  if (viewportGeometryCacheTimer !== null) {
    clearTimeout(viewportGeometryCacheTimer)
    viewportGeometryCacheTimer = null
  }
  for (const variants of viewportGeometryBuildCache.values()) {
    for (const geometry of variants.values()) geometry.dispose()
  }
  viewportGeometryBuildCache.clear()

  if (viewportEdgeOutlineCacheTimer !== null) {
    clearTimeout(viewportEdgeOutlineCacheTimer)
    viewportEdgeOutlineCacheTimer = null
  }
  for (const geometry of viewportEdgeOutlineCache.values()) geometry.dispose()
  viewportEdgeOutlineCache.clear()
}

function scheduleViewportGeometryCacheClear(): void {
  if (viewportGeometryCacheTimer !== null) return
  viewportGeometryCacheTimer = setTimeout(() => {
    viewportGeometryCacheTimer = null
    for (const variants of viewportGeometryBuildCache.values()) {
      for (const geometry of variants.values()) geometry.dispose()
    }
    viewportGeometryBuildCache.clear()
  }, VIEWPORT_GEOMETRY_CACHE_WINDOW_MS)
}

function scheduleViewportEdgeOutlineCacheClear(): void {
  if (viewportEdgeOutlineCacheTimer !== null) return
  viewportEdgeOutlineCacheTimer = setTimeout(() => {
    viewportEdgeOutlineCacheTimer = null
    for (const geometry of viewportEdgeOutlineCache.values()) geometry.dispose()
    viewportEdgeOutlineCache.clear()
  }, VIEWPORT_GEOMETRY_CACHE_WINDOW_MS)
}

/**
 * Topology edge outline for Model display — share one CPU build across viewports, clone per canvas.
 */
export function buildViewportEdgeOutlineGeometry(object: SceneObject): THREE.BufferGeometry {
  let template = viewportEdgeOutlineCache.get(object)
  if (!template) {
    template = buildEdgeSegmentsGeometry(object, collectUniqueEdges(object))
    viewportEdgeOutlineCache.set(object, template)
  }
  scheduleViewportEdgeOutlineCacheClear()
  return template.clone()
}

function buildViewportMeshGeometryUncached(
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
    const sources = data.sourceVertexIndices
    const cornerCount = data.positions.length / 3
    for (let i = 0; i < cornerCount; i++) {
      const vi = sources?.[i] ?? Math.min(i, densities.length - 1)
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
  else if (data.normals && data.normals.length === data.positions.length) {
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  } else {
    geo.computeVertexNormals()
  }
  return geo
}

/**
 * Build isolated geometry for one viewport while sharing the expensive editable-mesh
 * conversion across canvases rendering the same immutable SceneObject in one frame.
 */
export function buildViewportMeshGeometry(
  object: SceneObject,
  flatShading: boolean,
  facetExaggeration: number,
  showDensityHeatmap: boolean,
  omitVertexColors = false
): THREE.BufferGeometry {
  const key = geometryBuildKey(
    flatShading,
    facetExaggeration,
    showDensityHeatmap,
    omitVertexColors
  )
  let variants = viewportGeometryBuildCache.get(object)
  if (!variants) {
    variants = new Map()
    viewportGeometryBuildCache.set(object, variants)
  }
  let template = variants.get(key)
  if (!template) {
    template = buildViewportMeshGeometryUncached(
      object,
      flatShading,
      facetExaggeration,
      showDensityHeatmap,
      omitVertexColors
    )
    variants.set(key, template)
  }
  scheduleViewportGeometryCacheClear()
  return template.clone()
}

function MeshMaterial({
  config,
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
  textureTint = '#ffffff',
  xray = false,
}: {
  config: (typeof VIEWPORT_DISPLAY_CONFIG)[ViewportDisplayMode]
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
  xray?: boolean
  textureTint?: string
}) {
  const onBeforeCompile = pixelTextureBlend ? patchPixelTextureBlendShader : undefined
  const customProgramCacheKey = pixelTextureBlend
    ? () => PIXEL_TEXTURE_BLEND_CACHE_KEY
    : undefined

  const isTransparent = xray || (pixelTextureBlend ? opacity < 1 : opacity < 1 || textureAlpha)
  // Flat vs smooth is controlled by geometry normals (HalfEdgeMesh.toMeshData), not
  // material.flatShading — toggling that flag often fails to recompile the shader in R3F.
  const common = {
    vertexColors: useVertexColors,
    flatShading: false,
    side,
    wireframe: wireframe ?? config.wireframe,
    transparent: isTransparent,
    opacity,
    alphaTest: pixelTextureBlend ? undefined : !xray && textureAlpha ? 0.02 : undefined,
    // X-Ray: don't write depth so occluded mesh/overlays remain visible (Blender-like).
    depthWrite: xray ? false : pixelTextureBlend ? opacity >= 1 : opacity >= 1,
    depthTest: true,
    map: useTexture ? (map ?? undefined) : undefined,
    color: useTexture && !pixelTextureBlend ? textureTint : undefined,
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
  viewportXRay = false,
}: MeshRendererProps) {
  const {
    meshOutline,
    meshOutlineSecondary,
    objectSelectOutline,
    objectSelectOutlineSecondary,
    accentOrange,
  } = useTheme()
  const meshRef = useRef<THREE.Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const uvPatchRef = useRef({
    topology: null as SceneObject | null,
    flatShading: true,
  })
  const materialSettings = useMemo(() => ensureObjectMaterial(object).material!, [object])
  const texId = useMemo(
    () => (materialSettings.mode === 'texture' ? materialSettings.textureId ?? object.id : null),
    [materialSettings, object.id]
  )
  const textureMeta = useAppStore((s) => (texId ? s.objectTextures[texId] : undefined))
  const pixelDoc = useAppStore((s) => (texId ? s.pixelDocuments[texId] : undefined))
  const textureUrl = textureMeta?.url ?? null
  const config = VIEWPORT_DISPLAY_CONFIG[displayMode]
  const subdPreviewActive = Boolean(
    object.subdEnabled && object.subdLevels && object.subdLevels > 0
  )
  const flatShading = resolveFlatShading(
    subdPreviewActive ? true : object.smoothShading,
    displayMode
  )
  // SubD preview strips UVs (weld + Catmull-Clark) — use vertex colors until Apply SubD.
  const useTexture =
    !subdPreviewActive &&
    materialSettings.mode === 'texture' &&
    config.supportsTexture &&
    Boolean(pixelDoc || textureUrl)
  const usePixelTexture = Boolean(pixelDoc && useTexture)
  const meshSide = materialSettings.doubleSided ? THREE.DoubleSide : THREE.FrontSide
  const meshOpacity = materialSettings.opacity
  const xrayOpacity = viewportXRay
    ? Math.min(meshOpacity, meshOpacity * VIEWPORT_XRAY_OPACITY)
    : meshOpacity
  const xraySide = viewportXRay ? THREE.DoubleSide : meshSide

  const renderObject = useMemo(() => {
    const base = useTexture ? ensureObjectUVs(object) : object
    if (!subdPreviewActive) return base
    const preview = resolveSubdivisionPreview(base)
    return { ...preview, smoothShading: true }
  }, [object, useTexture, subdPreviewActive])

  const urlTexture = useLoadedTexture(useTexture && !pixelDoc && textureUrl ? textureUrl : null)
  const dataTexture = usePixelDocumentTexture(pixelDoc ? texId : null)
  const texture = pixelDoc ? dataTexture : urlTexture
  const sampledTexture = useMemo(() => {
    if (!texture) return null
    let clone: THREE.Texture
    if (pixelDoc && (materialSettings.textureLumaAlpha || (materialSettings.textureBrightness ?? 1) !== 1 || (materialSettings.textureShadowDetail ?? 0) > 0 || materialSettings.textureGradient)) {
      const source = compositeLayers(pixelDoc)
      const data = new Uint8Array(source.length)
      const brightness = Math.max(0.25, Math.min(3, materialSettings.textureBrightness ?? 1))
      const detail = Math.max(0, Math.min(1, materialSettings.textureShadowDetail ?? 0))
      const gamma = 1 - detail * 0.58
      for (let i = 0; i < source.length; i += 4) {
        let r = Math.min(255, Math.pow(source[i]! / 255, gamma) * 255 * brightness)
        let g = Math.min(255, Math.pow(source[i + 1]! / 255, gamma) * 255 * brightness)
        let b = Math.min(255, Math.pow(source[i + 2]! / 255, gamma) * 255 * brightness)
        const gradient = materialSettings.textureGradient
        if (gradient) {
          const pixel = i / 4
          const x = (pixel % pixelDoc.width) / Math.max(1, pixelDoc.width - 1) - 0.5
          const y = Math.floor(pixel / pixelDoc.width) / Math.max(1, pixelDoc.height - 1) - 0.5
          const rad = gradient.angle * Math.PI / 180
          const t = Math.max(0, Math.min(1, 0.5 + x * Math.cos(rad) + y * Math.sin(rad)))
          r *= gradient.start[0] + (gradient.end[0] - gradient.start[0]) * t
          g *= gradient.start[1] + (gradient.end[1] - gradient.start[1]) * t
          b *= gradient.start[2] + (gradient.end[2] - gradient.start[2]) * t
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b
        const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
        data[i + 3] = materialSettings.textureLumaAlpha
          ? Math.round(source[i + 3]! * Math.max(0, Math.min(1, (luma - 0.025) / 0.32)))
          : source[i + 3]!
      }
      const processed = new THREE.DataTexture(data, pixelDoc.width, pixelDoc.height, THREE.RGBAFormat)
      processed.colorSpace = THREE.SRGBColorSpace
      processed.flipY = true
      processed.magFilter = THREE.LinearFilter
      processed.minFilter = THREE.LinearMipmapLinearFilter
      processed.generateMipmaps = true
      clone = processed
    } else {
      clone = texture.clone()
    }
    const wrap = materialSettings.textureWrap ?? 'clamp'
    clone.wrapS = clone.wrapT = wrap === 'repeat'
      ? THREE.RepeatWrapping
      : wrap === 'mirror'
        ? THREE.MirroredRepeatWrapping
        : THREE.ClampToEdgeWrapping
    clone.needsUpdate = true
    return clone
  }, [texture, pixelDoc, materialSettings.textureWrap, materialSettings.textureLumaAlpha, materialSettings.textureBrightness, materialSettings.textureShadowDetail, materialSettings.textureGradient])
  useEffect(() => () => sampledTexture?.dispose(), [sampledTexture])
  const textureTint = materialSettings.textureTint
    ? `#${materialSettings.textureTint.slice(0, 3).map((n) => {
        const strength = Math.max(0, Math.min(1, materialSettings.textureTintStrength ?? 1))
        return Math.round((1 + (n - 1) * strength) * 255).toString(16).padStart(2, '0')
      }).join('')}`
    : '#ffffff'

  const cageGeometry = useMemo(() => {
    if (!subdPreviewActive) return null
    return buildViewportMeshGeometry(object, true, 0, false, true)
  }, [object, subdPreviewActive, object.positions, object.faces])

  useEffect(() => () => cageGeometry?.dispose(), [cageGeometry])

  const geometry = useMemo(() => {
    const geo = buildViewportMeshGeometry(
      renderObject,
      flatShading,
      facetExaggeration,
      showDensityHeatmap,
      useTexture
    )
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
    requestAnimationFrame(() => invalidate())
  }, [flatShading, geometry, invalidate])

  uvPatchRef.current.topology = renderObject
  uvPatchRef.current.flatShading = flatShading

  useEffect(() => {
    return subscribeUvDraft((snapshot) => {
      const mesh = meshRef.current
      const topology = uvPatchRef.current.topology
      if (!mesh || !topology) return

      if (snapshot && snapshot.objectId === object.id) {
        if (
          patchMeshGeometryUvs(
            mesh.geometry,
            topology,
            snapshot.uvs,
            uvPatchRef.current.flatShading
          )
        ) {
          invalidate()
        }
        return
      }

      // Draft cleared — restore committed UVs from the scene object.
      if (
        (!snapshot || snapshot.objectId !== object.id) &&
        object.uvs?.length &&
        patchMeshGeometryUvs(
          mesh.geometry,
          topology,
          object.uvs,
          uvPatchRef.current.flatShading
        )
      ) {
        invalidate()
      }
    })
  }, [object.id, object.uvs, invalidate])

  const emissive = useMemo(() => new THREE.Color(0x000000), [])
  const emissiveIntensity = 0

  const edgeColor = displayMode === 'model' ? meshOutlineSecondary : meshOutline
  const wireColor = meshOutline

  // Model-view outlines use topology edges for both flat and smooth shading.
  // (drei <Edges> fails to draw reliably on smooth/welded meshes.)
  const topologyEdgeGeometry = useMemo(() => {
    if (!config.showEdgeOutline) return null
    return buildViewportEdgeOutlineGeometry(renderObject)
  }, [
    config.showEdgeOutline,
    renderObject.positions,
    renderObject.faces,
  ])

  useEffect(() => () => topologyEdgeGeometry?.dispose(), [topologyEdgeGeometry])

  const useVertexColors = !useTexture

  return (
    <group>
      <mesh
        ref={meshRef}
        key={flatShading ? 'shade-flat' : 'shade-smooth'}
        geometry={geometry}
        renderOrder={0}
      >
        <MeshMaterial
          key={`${flatShading ? 'flat' : 'smooth'}-${texture ? `${textureUrl}-${texture.uuid}` : textureUrl ?? 'no-tex'}`}
          config={config}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          opacity={displayMode === 'wireframe' ? 0 : xrayOpacity}
          side={xraySide}
          map={sampledTexture}
          textureTint={textureTint}
          useVertexColors={useVertexColors}
          useTexture={useTexture}
          textureAlpha={useTexture}
          pixelTextureBlend={false}
          xray={viewportXRay}
        />
        {config.showEdgeOutline && topologyEdgeGeometry && (
          <lineSegments geometry={topologyEdgeGeometry} renderOrder={2}>
            <lineBasicMaterial
              color={edgeColor}
              transparent
              opacity={viewportXRay ? 0.95 : 0.88}
              depthTest={!viewportXRay}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </lineSegments>
        )}
        {objectSelectionOutline && (
          <Outlines
            color={isPrimary ? objectSelectOutline : objectSelectOutlineSecondary}
            thickness={2}
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

      {subdPreviewActive && cageGeometry && (
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
  prev.displayMode === next.displayMode &&
  prev.viewportXRay === next.viewportXRay
)
