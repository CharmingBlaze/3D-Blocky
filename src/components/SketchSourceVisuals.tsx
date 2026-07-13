import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { planeToWorld3D } from '../utils/screenToWorld'
import { worldPointFromObject } from '../mesh/objectTransform'
import { worldUnitsForScreenPixels } from '../utils/screenScale'
import { useTheme } from '../theme/useTheme'

function SourceHandle({ position, color }: { position: [number, number, number]; color: string }) {
  const rootRef = useRef<THREE.Group>(null)
  const worldRef = useRef(new THREE.Vector3())
  const { camera, size } = useThree()

  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    root.quaternion.copy(camera.quaternion)
    const world = worldRef.current.set(position[0], position[1], position[2])
    root.scale.setScalar(worldUnitsForScreenPixels(camera, world, 7, size.height))
  })

  return (
    <group ref={rootRef} position={position} renderOrder={46}>
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[1.55, 1.55]} />
        <meshBasicMaterial color="#f7fbff" depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Nondestructive source path shown while a retained Sketch object is being edited. */
export function SketchSourceVisuals() {
  const { accent } = useTheme()
  const { editingSketchObjectId, object } = useAppStore(
    useShallow((state) => ({
      editingSketchObjectId: state.editingSketchObjectId,
      object: state.editingSketchObjectId
        ? (state.objects.find((candidate) => candidate.id === state.editingSketchObjectId) ?? null)
        : null,
    }))
  )

  const points = useMemo(() => {
    const source = object?.sketchSource
    if (!source) return []
    const all = source.relative.map((point) => {
      const local = planeToWorld3D(
        point.x + source.center.x,
        point.y + source.center.y,
        source.view,
        source.defaultDepth,
        source.planeFrame
      )
      const world = worldPointFromObject(object, local)
      return [world.x, world.y, world.z] as [number, number, number]
    })
    if (source.isClosed && all.length >= 3) all.push(all[0]!)
    return all
  }, [object])

  if (!editingSketchObjectId || !object?.sketchSource || points.length < 2) return null

  const handles = object.sketchSource.isClosed ? points.slice(0, -1) : points
  return (
    <group renderOrder={44}>
      <Line points={points} color="#080a0e" lineWidth={5} depthTest={false} toneMapped={false} />
      <Line points={points} color={accent} lineWidth={2} depthTest={false} toneMapped={false} />
      {handles.map((point, index) => (
        <SourceHandle key={`sketch-source-${index}`} position={point} color={accent} />
      ))}
    </group>
  )
}
