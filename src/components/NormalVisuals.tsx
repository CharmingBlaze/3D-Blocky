import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import { faceNewellNormal } from '../mesh/meshEdit'
import { boundsCenterHalf } from '../mesh/roundedBox'
import type { MeshPickHit } from '../select/meshPick'
import { useTheme } from '../theme/useTheme'

const OVERLAY_RENDER = 42
const ARROW_HEAD_RATIO = 0.28

interface NormalVisualsProps {
  object: SceneObject
  meshSelection: MeshComponentSelection | null
  meshHover: MeshPickHit | null
}

interface FaceNormalData {
  faceIndex: number
  cx: number
  cy: number
  cz: number
  nx: number
  ny: number
  nz: number
  /** True when winding normal points away from mesh center. */
  outward: boolean
}

const _mat = new THREE.Matrix4()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _yAxis = new THREE.Vector3(0, 1, 0)
const _color = new THREE.Color()

function buildFaceNormals(object: SceneObject): FaceNormalData[] {
  const { center } = boundsCenterHalf(object)
  const out: FaceNormalData[] = []

  for (let fi = 0; fi < object.faces.length; fi++) {
    const face = object.faces[fi]
    if (!face || face.length < 3) continue

    let cx = 0
    let cy = 0
    let cz = 0
    for (const vi of face) {
      const p = object.positions[vi]!
      cx += p.x
      cy += p.y
      cz += p.z
    }
    const inv = 1 / face.length
    cx *= inv
    cy *= inv
    cz *= inv

    const n = faceNewellNormal(object.positions, face)
    const outward =
      n.x * (cx - center.x) + n.y * (cy - center.y) + n.z * (cz - center.z) >= 0

    out.push({
      faceIndex: fi,
      cx,
      cy,
      cz,
      nx: n.x,
      ny: n.y,
      nz: n.z,
      outward,
    })
  }

  return out
}

function arrowLengthForObject(object: SceneObject): number {
  const { half } = boundsCenterHalf(object)
  const diag = Math.hypot(half.x * 2, half.y * 2, half.z * 2)
  return Math.max(0.1, Math.min(diag * 0.07, 1.5))
}

/**
 * Face-normal arrow overlay. Green = outward winding, red = inverted.
 * Drawn in object-local space (parented under the object pivot group).
 */
export function NormalVisuals({ object, meshSelection, meshHover }: NormalVisualsProps) {
  const theme = useTheme()
  const headsRef = useRef<THREE.InstancedMesh>(null)

  const selectedFaces = useMemo(() => {
    if (!meshSelection || meshSelection.objectId !== object.id) return new Set<number>()
    return new Set(meshSelection.faces)
  }, [meshSelection, object.id])

  const hoverFace =
    meshHover?.objectId === object.id && meshHover.face !== undefined ? meshHover.face : -1

  const normals = useMemo(() => buildFaceNormals(object), [object])
  const arrowLen = useMemo(() => arrowLengthForObject(object), [object])

  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const count = normals.length
    const pos = new Float32Array(count * 2 * 3)
    const col = new Float32Array(count * 2 * 3)

    const outwardColor = _color.set(theme.accentGreen).clone()
    const invertedColor = _color.set(theme.danger).clone()
    const selectedColor = _color.set(theme.accentOrange).clone()
    const hoverColor = _color.set(theme.meshHover).clone()

    for (let i = 0; i < count; i++) {
      const n = normals[i]!
      const selected = selectedFaces.has(n.faceIndex)
      const hovered = n.faceIndex === hoverFace
      const c = selected
        ? selectedColor
        : hovered
          ? hoverColor
          : n.outward
            ? outwardColor
            : invertedColor

      const i6 = i * 6
      pos[i6] = n.cx
      pos[i6 + 1] = n.cy
      pos[i6 + 2] = n.cz
      pos[i6 + 3] = n.cx + n.nx * arrowLen
      pos[i6 + 4] = n.cy + n.ny * arrowLen
      pos[i6 + 5] = n.cz + n.nz * arrowLen

      col[i6] = c.r
      col[i6 + 1] = c.g
      col[i6 + 2] = c.b
      col[i6 + 3] = c.r
      col[i6 + 4] = c.g
      col[i6 + 5] = c.b
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return geo
  }, [normals, selectedFaces, hoverFace, theme, arrowLen])

  useEffect(() => () => lineGeo.dispose(), [lineGeo])

  const coneGeo = useMemo(() => new THREE.ConeGeometry(1, 1, 6), [])
  useEffect(() => () => coneGeo.dispose(), [coneGeo])

  useEffect(() => {
    const mesh = headsRef.current
    if (!mesh || normals.length === 0) return

    const headH = arrowLen * ARROW_HEAD_RATIO
    const headR = headH * 0.45
    const outwardColor = _color.set(theme.accentGreen).clone()
    const invertedColor = _color.set(theme.danger).clone()
    const selectedColor = _color.set(theme.accentOrange).clone()
    const hoverColor = _color.set(theme.meshHover).clone()

    for (let i = 0; i < normals.length; i++) {
      const n = normals[i]!
      _dir.set(n.nx, n.ny, n.nz)
      if (_dir.lengthSq() < 1e-12) _dir.set(0, 1, 0)
      else _dir.normalize()
      _quat.setFromUnitVectors(_yAxis, _dir)
      _pos.set(
        n.cx + n.nx * (arrowLen - headH * 0.15),
        n.cy + n.ny * (arrowLen - headH * 0.15),
        n.cz + n.nz * (arrowLen - headH * 0.15)
      )
      _scale.set(headR, headH, headR)
      _mat.compose(_pos, _quat, _scale)
      mesh.setMatrixAt(i, _mat)

      const selected = selectedFaces.has(n.faceIndex)
      const hovered = n.faceIndex === hoverFace
      const c = selected
        ? selectedColor
        : hovered
          ? hoverColor
          : n.outward
            ? outwardColor
            : invertedColor
      mesh.setColorAt(i, c)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [normals, selectedFaces, hoverFace, theme, arrowLen])

  if (normals.length === 0) return null

  return (
    <group renderOrder={OVERLAY_RENDER}>
      <lineSegments geometry={lineGeo} frustumCulled={false} renderOrder={OVERLAY_RENDER}>
        <lineBasicMaterial
          vertexColors
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.92}
        />
      </lineSegments>

      <instancedMesh
        ref={headsRef}
        args={[coneGeo, undefined, normals.length]}
        frustumCulled={false}
        renderOrder={OVERLAY_RENDER + 1}
        raycast={() => null}
      >
        <meshBasicMaterial depthTest={false} depthWrite={false} transparent opacity={0.95} />
      </instancedMesh>
    </group>
  )
}
