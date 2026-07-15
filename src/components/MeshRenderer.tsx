import { useMemo, useRef, useEffect, memo } from 'react'
import { useThree } from '@react-three/fiber'
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
import {
  useLoadedTexture,
  usePixelDocumentTexture,
  getPixelDocumentTexture,
  pixelDocumentTextureHasAlpha,
  subscribePixelDocumentTexture,
} from '../rendering/textureCache'
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
import { getPixelCompositeCache } from '../pixel/pixelCompositeCache'

interface MeshRendererProps {
  object: SceneObject
  isSelected: boolean
  isPrimary?: boolean
  objectSelectionOutline?: boolean
  /** Pixel-paint focus: translucent surface, topology, and paint preview. */
  paintFocus?: boolean
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

/** Constant-cost 12-edge selection cage fitted to the object's local bounds. */
export function buildObjectSelectionBoundsGeometry(object: SceneObject): THREE.BufferGeometry {
  const box = new THREE.Box3()
  for (const p of object.positions) box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z))
  if (box.isEmpty()) return new THREE.BufferGeometry()

  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const pad = maxDimension * 0.008
  box.expandByScalar(pad)

  const { min, max } = box
  const corners: [number, number, number][] = [
    [min.x, min.y, min.z], [max.x, min.y, min.z],
    [max.x, max.y, min.z], [min.x, max.y, min.z],
    [min.x, min.y, max.z], [max.x, min.y, max.z],
    [max.x, max.y, max.z], [min.x, max.y, max.z],
  ]
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const positions = new Float32Array(edges.length * 6)
  let offset = 0
  for (const [a, b] of edges) {
    const pa = corners[a]!
    const pb = corners[b]!
    positions.set(pa, offset)
    positions.set(pb, offset + 3)
    offset += 6
  }
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return result
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

/** Pixel documents need both UVs and face colors: alpha paints over that color base. */
export function shouldOmitViewportVertexColors(
  useTexture: boolean,
  usePixelTexture: boolean
): boolean {
  return useTexture && !usePixelTexture
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

  // PNG/WebP cutouts: alphaTest discards clear texels (see-through). Keep depthWrite on so
  // opaque texels occlude the scene — depthWrite:false lets transparent grids paint over the image.
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
    alphaTest: pixelTextureBlend ? undefined : !xray && textureAlpha ? 0.05 : undefined,
    depthWrite: xray ? false : opacity < 1 ? false : true,
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
      // Alpha cutout images (PNG/WebP drops): unlit so the photo isn't washed gray by PBR.
      // Opaque textured meshes keep standard lighting.
      if (useTexture && textureAlpha) {
        return <meshBasicMaterial {...common} toneMapped={false} />
      }
      return (
        <meshStandardMaterial
          {...common}
          roughness={useTexture ? 1 : 0.85}
          metalness={0}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          toneMapped={!useTexture}
        />
      )
  }
}

export const MeshRenderer = memo(function MeshRenderer({
  object,
  isSelected: _isSelected,
  isPrimary = false,
  objectSelectionOutline = false,
  paintFocus = false,
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
  // Presence only — do not subscribe to pixel buffer contents (strokes mutate in place).
  const hasPixelDoc = useAppStore((s) => Boolean(texId && s.pixelDocuments[texId]))
  const pixelDocWidth = useAppStore((s) => (texId ? s.pixelDocuments[texId]?.width ?? 0 : 0))
  const pixelDocHeight = useAppStore((s) => (texId ? s.pixelDocuments[texId]?.height ?? 0 : 0))
  const pixelDocSize =
    hasPixelDoc && pixelDocWidth > 0 && pixelDocHeight > 0
      ? { width: pixelDocWidth, height: pixelDocHeight }
      : null
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
    Boolean(hasPixelDoc || textureUrl)
  const usePixelTexture = Boolean(hasPixelDoc && useTexture)
  const usePixelTextureOverlay = Boolean(
    usePixelTexture && materialSettings.textureCanvasMode !== 'replace'
  )
  // Paint focus is a viewport-only aid: every quad camera must be able to see
  // and paint the selected surface, even when that view faces its back side.
  // This does not modify the saved material's double-sided setting.
  const meshSide =
    paintFocus || materialSettings.doubleSided ? THREE.DoubleSide : THREE.FrontSide
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

  const urlTexture = useLoadedTexture(useTexture && !hasPixelDoc && textureUrl ? textureUrl : null)
  const dataTexture = usePixelDocumentTexture(hasPixelDoc ? texId : null)
  const texture = hasPixelDoc ? dataTexture : urlTexture
  // Enable cutout/blend only when the live composite (or URL map) actually has alpha —
  // covers PNG/WebP/GIF and Pixel Editor erases, not opaque JPEG fills.
  const textureHasAlpha =
    useTexture &&
    (hasPixelDoc && texId
      ? pixelDocumentTextureHasAlpha(texId)
      : Boolean(textureUrl))

  const needsPixelProcessing = Boolean(
    hasPixelDoc &&
      (materialSettings.textureLumaAlpha ||
        (materialSettings.textureBrightness ?? 1) !== 1 ||
        (materialSettings.textureShadowDetail ?? 0) > 0 ||
        materialSettings.textureGradient)
  )
  // Rebuild processed material maps only when THIS document commits.
  // Unprocessed maps share DataTexture image data — live dabs use subscribePixelDocumentTexture.
  const pixelDocRevision = useAppStore((s) =>
    hasPixelDoc && texId ? (s.pixelDocRevisions[texId] ?? 0) : 0
  )

  const sampledTexture = useMemo(() => {
    if (!texture) return null
    const wrap = materialSettings.textureWrap ?? 'clamp'
    const repeat = materialSettings.textureRepeat ?? [1, 1]
    const offset = materialSettings.textureOffset ?? [0, 0]
    const rotationDeg = materialSettings.textureRotation ?? 0
    const hasCustomUv =
      wrap !== 'clamp' ||
      Math.abs(repeat[0] - 1) > 1e-6 ||
      Math.abs(repeat[1] - 1) > 1e-6 ||
      Math.abs(offset[0]) > 1e-6 ||
      Math.abs(offset[1]) > 1e-6 ||
      Math.abs(rotationDeg) > 1e-6

    // Live pixel docs with default UV transform: use the shared DataTexture directly so
    // paint uploads do not force a second full GPU upload via texture.clone().
    if (!needsPixelProcessing && hasPixelDoc && !hasCustomUv) {
      return texture
    }

    let clone: THREE.Texture
    if (needsPixelProcessing && pixelDocSize && texId) {
      const cached = getPixelCompositeCache(texId)
      const source =
        cached && cached.width === pixelDocSize.width && cached.height === pixelDocSize.height
          ? cached.pixels
          : null
      if (!source) {
        // Composite not ready yet — fall back to raw GPU texture.
        clone = texture.clone()
      } else {
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
            const x = (pixel % pixelDocSize.width) / Math.max(1, pixelDocSize.width - 1) - 0.5
            const y =
              Math.floor(pixel / pixelDocSize.width) / Math.max(1, pixelDocSize.height - 1) - 0.5
            const rad = (gradient.angle * Math.PI) / 180
            const t = Math.max(0, Math.min(1, 0.5 + x * Math.cos(rad) + y * Math.sin(rad)))
            r *= gradient.start[0] + (gradient.end[0] - gradient.start[0]) * t
            g *= gradient.start[1] + (gradient.end[1] - gradient.start[1]) * t
            b *= gradient.start[2] + (gradient.end[2] - gradient.start[2]) * t
          }
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
          const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
          data[i + 3] = materialSettings.textureLumaAlpha
            ? Math.round(source[i + 3]! * Math.max(0, Math.min(1, (luma - 0.025) / 0.32)))
            : source[i + 3]!
        }
        const processed = new THREE.DataTexture(
          data,
          pixelDocSize.width,
          pixelDocSize.height,
          THREE.RGBAFormat
        )
        processed.colorSpace = THREE.SRGBColorSpace
        processed.flipY = true
        processed.magFilter = THREE.LinearFilter
        processed.minFilter = THREE.LinearMipmapLinearFilter
        processed.generateMipmaps = true
        clone = processed
      }
    } else {
      clone = texture.clone()
      // DataTexture.clone() can drop upload flags — keep sRGB + flip so the image isn't washed/gray.
      clone.colorSpace = THREE.SRGBColorSpace
      if ('flipY' in texture) clone.flipY = texture.flipY
      if (texture instanceof THREE.DataTexture) {
        clone.magFilter = THREE.NearestFilter
        clone.minFilter = THREE.NearestFilter
        clone.generateMipmaps = false
      }
    }
    clone.wrapS = clone.wrapT =
      wrap === 'repeat'
        ? THREE.RepeatWrapping
        : wrap === 'mirror'
          ? THREE.MirroredRepeatWrapping
          : THREE.ClampToEdgeWrapping
    clone.repeat.set(Math.max(0.01, repeat[0]), Math.max(0.01, repeat[1]))
    clone.offset.set(offset[0], offset[1])
    clone.center.set(0.5, 0.5)
    clone.rotation = (rotationDeg * Math.PI) / 180
    clone.needsUpdate = true
    return clone
  }, [
    texture,
    needsPixelProcessing,
    hasPixelDoc,
    // Only processed maps need a rebuild on commit; unprocessed share live GPU texels.
    needsPixelProcessing ? pixelDocRevision : 0,
    pixelDocSize?.width,
    pixelDocSize?.height,
    texId,
    materialSettings.textureWrap,
    materialSettings.textureRepeat,
    materialSettings.textureOffset,
    materialSettings.textureRotation,
    materialSettings.textureLumaAlpha,
    materialSettings.textureBrightness,
    materialSettings.textureShadowDetail,
    materialSettings.textureGradient,
  ])

  const sampledTextureRef = useRef(sampledTexture)
  sampledTextureRef.current = sampledTexture
  useEffect(() => {
    return () => {
      if (!sampledTexture) return
      // Shared pixel-doc cache textures must not be disposed by mesh unmount.
      if (texId && sampledTexture === getPixelDocumentTexture(texId)) return
      sampledTexture.dispose()
    }
  }, [sampledTexture, texId])

  // Live paint: shared DataTexture is already uploaded by textureCache.
  // Clones that share image.data still need needsUpdate so their GPU copy refreshes.
  useEffect(() => {
    if (!texId || !usePixelTexture) return
    return subscribePixelDocumentTexture(texId, () => {
      const map = sampledTextureRef.current
      if (!map) return
      if (needsPixelProcessing) {
        // Processed maps own a separate buffer — rebuild on next commit/revision.
        return
      }
      const shared = getPixelDocumentTexture(texId)
      if (map === shared) {
        invalidate()
        return
      }
      map.needsUpdate = true
      invalidate()
    })
  }, [texId, usePixelTexture, needsPixelProcessing, invalidate])
  const textureTint = materialSettings.textureTint
    ? `#${materialSettings.textureTint.slice(0, 3).map((n) => {
        // 0% = keep image colors (matches PaletteBar "Texture color amount").
        const strength = Math.max(0, Math.min(1, materialSettings.textureTintStrength ?? 0))
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
      shouldOmitViewportVertexColors(useTexture, usePixelTextureOverlay)
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
    usePixelTextureOverlay,
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
    if (!config.showEdgeOutline && !paintFocus) return null
    return buildViewportEdgeOutlineGeometry(renderObject)
  }, [
    config.showEdgeOutline,
    paintFocus,
    renderObject.positions,
    renderObject.faces,
  ])

  useEffect(() => () => topologyEdgeGeometry?.dispose(), [topologyEdgeGeometry])

  // Object selection is a constant-cost bounds cage. It stays readable on dense
  // topology and never covers the surface being modeled or painted.
  const selectionOutlineGeometry = useMemo(() => {
    if (!objectSelectionOutline) return null
    return buildObjectSelectionBoundsGeometry(object)
  }, [objectSelectionOutline, object.positions])

  useEffect(() => () => selectionOutlineGeometry?.dispose(), [selectionOutlineGeometry])

  // Overlay documents paint over the object's existing color/material. A
  // deliberately cleared replacement document uses its own alpha instead.
  const useVertexColors = !useTexture || usePixelTextureOverlay

  return (
    <group>
      <mesh
        ref={meshRef}
        key={flatShading ? 'shade-flat' : 'shade-smooth'}
        geometry={geometry}
        renderOrder={0}
      >
        <MeshMaterial
          key={`${flatShading ? 'flat' : 'smooth'}-${useTexture ? `${texId ?? textureUrl ?? 'tex'}-${textureHasAlpha ? 'alpha' : 'opaque'}-${usePixelTextureOverlay ? 'overlay' : 'replace'}` : 'no-tex'}`}
          config={config}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          opacity={displayMode === 'wireframe' ? 0 : xrayOpacity}
          side={xraySide}
          map={sampledTexture}
          textureTint={textureTint}
          useVertexColors={useVertexColors}
          useTexture={useTexture}
          textureAlpha={textureHasAlpha}
          pixelTextureBlend={usePixelTextureOverlay}
          xray={viewportXRay}
        />
        {(config.showEdgeOutline || paintFocus) && topologyEdgeGeometry && (
          <lineSegments geometry={topologyEdgeGeometry} renderOrder={2}>
            <lineBasicMaterial
              color={paintFocus ? meshOutline : edgeColor}
              transparent
              opacity={paintFocus ? 0.78 : viewportXRay ? 0.95 : 0.88}
              depthTest={paintFocus ? false : !viewportXRay}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-1}
              polygonOffsetUnits={-1}
            />
          </lineSegments>
        )}
      </mesh>

      {objectSelectionOutline && selectionOutlineGeometry && (
        <lineSegments geometry={selectionOutlineGeometry} renderOrder={8}>
          <lineBasicMaterial
            color={isPrimary ? objectSelectOutline : objectSelectOutlineSecondary}
            transparent
            opacity={isPrimary ? 1 : 0.86}
            depthTest
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}

      {subdPreviewActive && !paintFocus && cageGeometry && (
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

      {config.wireOverlay && !paintFocus && (
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
  prev.paintFocus === next.paintFocus &&
  prev.facetExaggeration === next.facetExaggeration &&
  prev.showDensityHeatmap === next.showDensityHeatmap &&
  prev.displayMode === next.displayMode &&
  prev.viewportXRay === next.viewportXRay
)
