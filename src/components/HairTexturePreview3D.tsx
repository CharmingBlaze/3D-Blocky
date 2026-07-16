import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelDocument } from '../pixel/pixelTypes'
import type { HairUvTransform } from '../stroke/hairUvTransform'
import { transformHairUv } from '../stroke/hairUvTransform'
import type { HairTextureSettings } from '../stroke/hairTextureSettings'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'

type PreviewKind = 'hair-paths' | 'hair-strips' | 'hair-round'

interface Props {
  textureDoc: PixelDocument | null
  textureUrl?: string | null
  transform: HairUvTransform
  settings: HairTextureSettings
  kind: PreviewKind
  pointed: boolean
  object?: SceneObject | null
}

function createObjectGeometry(object: SceneObject): THREE.BufferGeometry {
  const data = HalfEdgeMesh.fromObject(object).toMeshData(false)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  if (data.uvs?.length) geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
  if (data.normals?.length) geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  if (!data.normals?.length) geo.computeVertexNormals()
  if (object.transform) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        object.transform.rotation.x,
        object.transform.rotation.y,
        object.transform.rotation.z
      )),
      new THREE.Vector3(
        object.transform.scale.x,
        object.transform.scale.y,
        object.transform.scale.z
      )
    )
    geo.applyMatrix4(matrix)
  }
  geo.computeBoundingBox()
  geo.center()
  geo.computeBoundingSphere()
  const radius = geo.boundingSphere?.radius ?? 1
  const fitScale = 2.35 / Math.max(radius, 0.001)
  geo.scale(fitScale, fitScale, fitScale)
  geo.computeBoundingSphere()
  return geo
}

function createRibbonGeometry(transform: HairUvTransform, pointed: boolean, strip: boolean): THREE.BufferGeometry {
  const segments = strip ? 8 : 28
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const x = (t - 0.5) * 4.8
    const y = Math.sin((t - 0.08) * Math.PI * 1.25) * 0.72
    const z = Math.sin(t * Math.PI * 2) * 0.18
    const taper = pointed ? Math.max(0.04, Math.sin(Math.PI * t) ** 0.55) : 1
    const width = 0.72 * taper
    for (const side of [-1, 1]) {
      positions.push(x, y + side * width * 0.5, z)
      const uv = transformHairUv(t, side < 0 ? 0 : 1, transform)
      uvs.push(uv.u, 1 - uv.v)
    }
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function PreviewMesh({ textureDoc, textureUrl, transform, settings, kind, pointed, object }: Props) {
  const geometry = useMemo(() => {
    if (object) return createObjectGeometry(object)
    if (kind !== 'hair-round') return createRibbonGeometry(transform, pointed, kind === 'hair-strips')
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.4, -0.55, 0),
      new THREE.Vector3(-1.1, 0.45, 0.15),
      new THREE.Vector3(0.4, 0.65, -0.2),
      new THREE.Vector3(2.4, -0.25, 0.1),
    ])
    const geo = new THREE.TubeGeometry(curve, 40, 0.26, 12, false)
    const uv = geo.getAttribute('uv')
    const position = geo.getAttribute('position')
    for (let i = 0; i < uv.count; i++) {
      const lengthT = uv.getX(i)
      if (pointed) {
        const center = curve.getPointAt(lengthT)
        const taper = Math.max(0.025, Math.sin(Math.PI * lengthT) ** 0.58)
        position.setXYZ(
          i,
          center.x + (position.getX(i) - center.x) * taper,
          center.y + (position.getY(i) - center.y) * taper,
          center.z + (position.getZ(i) - center.z) * taper
        )
      }
      const mapped = transformHairUv(lengthT, 1 - uv.getY(i), transform)
      uv.setXY(i, mapped.u, 1 - mapped.v)
    }
    position.needsUpdate = true
    uv.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [kind, pointed, transform, object])

  const texture = useMemo(() => {
    let tex: THREE.Texture | null = null
    if (textureDoc) {
      const source = compositeLayers(textureDoc)
      const pixels = new Uint8Array(source.length)
      const brightness = Math.max(0.25, Math.min(3, settings.brightness))
      const gamma = 1 - Math.max(0, Math.min(1, settings.shadowDetail)) * 0.58
      const parse = (hex: string) => {
        const n = Number.parseInt(hex.replace('#', ''), 16)
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
      }
      const gradA = parse(settings.gradientStart)
      const gradB = parse(settings.gradientEnd)
      for (let i = 0; i < source.length; i += 4) {
        let r = Math.min(255, Math.pow(source[i]! / 255, gamma) * 255 * brightness)
        let g = Math.min(255, Math.pow(source[i + 1]! / 255, gamma) * 255 * brightness)
        let b = Math.min(255, Math.pow(source[i + 2]! / 255, gamma) * 255 * brightness)
        if (settings.colorMode === 'gradient') {
          const pixel = i / 4
          const x = (pixel % textureDoc.width) / Math.max(1, textureDoc.width - 1) - 0.5
          const y = Math.floor(pixel / textureDoc.width) / Math.max(1, textureDoc.height - 1) - 0.5
          const rad = settings.gradientAngle * Math.PI / 180
          const t = Math.max(0, Math.min(1, 0.5 + x * Math.cos(rad) + y * Math.sin(rad)))
          r *= gradA[0]! + (gradB[0]! - gradA[0]!) * t
          g *= gradA[1]! + (gradB[1]! - gradA[1]!) * t
          b *= gradA[2]! + (gradB[2]! - gradA[2]!) * t
        }
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b
        const luma = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
        pixels[i + 3] = settings.removeDarkBackground
          ? Math.round(source[i + 3]! * Math.max(0, Math.min(1, (luma - 0.025) / 0.32)))
          : source[i + 3]!
      }
      tex = new THREE.DataTexture(
        pixels,
        textureDoc.width,
        textureDoc.height,
        THREE.RGBAFormat
      )
      tex.colorSpace = THREE.SRGBColorSpace
      tex.flipY = true
      tex.magFilter = THREE.LinearFilter
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.generateMipmaps = true
    } else if (textureUrl) {
      tex = new THREE.TextureLoader().load(textureUrl)
      tex.colorSpace = THREE.SRGBColorSpace
    }
    if (!tex) return null
    tex.wrapS = tex.wrapT = settings.wrap === 'repeat'
      ? THREE.RepeatWrapping
      : settings.wrap === 'mirror'
        ? THREE.MirroredRepeatWrapping
        : THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [textureDoc, textureUrl, settings.wrap, settings.removeDarkBackground, settings.brightness, settings.shadowDetail, settings.colorMode, settings.gradientStart, settings.gradientEnd, settings.gradientAngle])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => texture?.dispose(), [texture])

  const objectColor = object ? `#${object.color.toString(16).padStart(6, '0')}` : '#ffffff'
  const previewColor = settings.colorMode === 'tint' || settings.tintEnabled
    ? settings.tint
    : texture
      ? '#ffffff'
      : objectColor

  return (
    <mesh geometry={geometry} rotation={[-0.18, -0.12, -0.08]}>
      <meshStandardMaterial
        map={texture ?? undefined}
        color={previewColor}
        opacity={settings.opacity}
        transparent={settings.opacity < 1 || Boolean(texture)}
        alphaTest={settings.removeDarkBackground ? 0.08 : 0.02}
        side={THREE.DoubleSide}
        roughness={0.68}
        metalness={0}
      />
    </mesh>
  )
}

export function HairTexturePreview3D(props: Props) {
  return (
    <div className="hair-preview-3d">
      <Canvas
        frameloop="demand"
        camera={{ position: [0.2, 0.35, 5.8], fov: 38 }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#181b21']} />
        <ambientLight intensity={1.35} />
        <directionalLight position={[3, 4, 5]} intensity={2.2} />
        <directionalLight position={[-3, -1, 2]} intensity={0.65} color="#8ccfff" />
        <PreviewMesh {...props} />
        <gridHelper args={[8, 16, '#343943', '#252a32']} position={[0, -1.35, 0]} />
        <OrbitControls makeDefault enablePan={false} minDistance={3.7} maxDistance={9} />
      </Canvas>
      <div className="hair-preview-orbit-hint">Drag to orbit · Scroll to zoom</div>
    </div>
  )
}
