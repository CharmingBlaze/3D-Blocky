import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore, type ActiveTool } from '../store/appStore'
import type { BillboardImage } from '../images/imageDropTypes'
import { useLoadedTexture } from '../rendering/textureCache'

const TRANSFORM_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']

function toolToMode(tool: ActiveTool): 'translate' | 'rotate' | 'scale' {
  if (tool === 'rotate') return 'rotate'
  if (tool === 'scale') return 'scale'
  return 'translate'
}

interface BillboardNodeProps {
  billboard: BillboardImage
  isSelected: boolean
}

import { useTheme } from '../theme/useTheme'

function BillboardSelectionOutline({
  width,
  height,
}: {
  width: number
  height: number
}) {
  const { accentNum } = useTheme()
  const lineRef = useRef<THREE.LineSegments>(null)
  const sourceGeometry = useMemo(
    () => new THREE.PlaneGeometry(width, height),
    [width, height]
  )
  const edgesGeometry = useMemo(
    () => new THREE.EdgesGeometry(sourceGeometry),
    [sourceGeometry]
  )

  useEffect(() => {
    return () => {
      sourceGeometry.dispose()
      edgesGeometry.dispose()
    }
  }, [sourceGeometry, edgesGeometry])

  return (
    <lineSegments ref={lineRef} geometry={edgesGeometry}>
      <lineBasicMaterial color={accentNum} />
    </lineSegments>
  )
}

function BillboardMesh({ billboard, isSelected }: BillboardNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const selectBillboardImage = useAppStore((s) => s.selectBillboardImage)
  const activeTool = useAppStore((s) => s.activeTool)
  const texture = useLoadedTexture(billboard.url)

  const canPick =
    activeTool === 'select-object' || TRANSFORM_TOOLS.includes(activeTool)

  return (
    <mesh
      ref={meshRef}
      onPointerDown={(e) => {
        if (!canPick) return
        e.stopPropagation()
        selectBillboardImage(billboard.id)
      }}
    >
      <planeGeometry args={[billboard.width, billboard.height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={billboard.opacity}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
      {isSelected && (
        <BillboardSelectionOutline
          width={billboard.width}
          height={billboard.height}
        />
      )}
    </mesh>
  )
}

export function BillboardNode({ billboard, isSelected }: BillboardNodeProps) {
  const activeTool = useAppStore((s) => s.activeTool)
  const updateBillboardImage = useAppStore((s) => s.updateBillboardImage)
  const commitHistory = useAppStore((s) => s.commitHistory)
  const groupRef = useRef<THREE.Group>(null)
  const faceRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const changedRef = useRef(false)
  const glDomElement = useThree((s) => s.gl.domElement)

  const gizmoActive = isSelected && TRANSFORM_TOOLS.includes(activeTool)

  useEffect(() => {
    const g = groupRef.current
    if (!g || draggingRef.current) return
    const rot = billboard.rotation ?? { x: 0, y: 0, z: 0 }
    g.position.set(billboard.position.x, billboard.position.y, billboard.position.z)
    g.rotation.set(rot.x, rot.y, rot.z)
    g.scale.set(1, 1, 1)
  }, [billboard.position, billboard.rotation, billboard.width, billboard.height, billboard.id])

  useFrame(({ camera }) => {
    const face = faceRef.current
    if (!face) return
    face.quaternion.copy(camera.quaternion)
    const parent = groupRef.current
    if (parent) {
      parent.updateWorldMatrix(true, false)
      const inv = _parentQuat.copy(parent.quaternion).invert()
      face.quaternion.premultiply(inv)
    }
  })

  const syncFromGroup = () => {
    const g = groupRef.current
    if (!g) return
    updateBillboardImage(billboard.id, {
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
      width: Math.max(0.5, billboard.width * g.scale.x),
      height: Math.max(0.5, billboard.height * g.scale.y),
    })
    g.scale.set(1, 1, 1)
  }

  const rot = billboard.rotation ?? { x: 0, y: 0, z: 0 }

  return (
    <>
      <group
        ref={groupRef}
        position={[billboard.position.x, billboard.position.y, billboard.position.z]}
        rotation={[rot.x, rot.y, rot.z]}
      >
        <group ref={faceRef}>
          <BillboardMesh billboard={billboard} isSelected={isSelected} />
        </group>
      </group>
      {gizmoActive && groupRef.current && (
        <TransformControls
          object={groupRef as RefObject<THREE.Object3D>}
          domElement={glDomElement}
          mode={toolToMode(activeTool)}
          space="world"
          size={1.2}
          onMouseDown={() => {
            draggingRef.current = true
            changedRef.current = false
          }}
          onMouseUp={() => {
            draggingRef.current = false
            if (changedRef.current) {
              commitHistory('Edit billboard')
            }
            changedRef.current = false
            syncFromGroup()
          }}
          onObjectChange={() => {
            changedRef.current = true
            syncFromGroup()
          }}
        />
      )}
    </>
  )
}

const _parentQuat = new THREE.Quaternion()

export function BillboardImages() {
  const billboardImages = useAppStore((s) => s.billboardImages)
  const selectedBillboardImageId = useAppStore((s) => s.selectedBillboardImageId)

  if (billboardImages.length === 0) return null

  return (
    <>
      {billboardImages.map((bb) => (
        <BillboardNode
          key={bb.id}
          billboard={bb}
          isSelected={bb.id === selectedBillboardImageId}
        />
      ))}
    </>
  )
}
