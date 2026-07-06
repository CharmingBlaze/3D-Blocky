import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useAppStore, type ActiveTool } from '../store/appStore'
import type { BillboardImage } from '../images/imageDropTypes'
import { useLoadedTexture } from '../rendering/textureCache'
import { popViewportInteraction, pushViewportInteraction } from '../rendering/viewportFrameLoop'

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

const TRANSFORM_EPS = 1e-6

function billboardStatesEqual(
  a: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; width: number; height: number },
  b: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; width: number; height: number }
): boolean {
  return (
    Math.abs(a.position.x - b.position.x) <= TRANSFORM_EPS &&
    Math.abs(a.position.y - b.position.y) <= TRANSFORM_EPS &&
    Math.abs(a.position.z - b.position.z) <= TRANSFORM_EPS &&
    Math.abs(a.rotation.x - b.rotation.x) <= TRANSFORM_EPS &&
    Math.abs(a.rotation.y - b.rotation.y) <= TRANSFORM_EPS &&
    Math.abs(a.rotation.z - b.rotation.z) <= TRANSFORM_EPS &&
    Math.abs(a.width - b.width) <= TRANSFORM_EPS &&
    Math.abs(a.height - b.height) <= TRANSFORM_EPS
  )
}

function billboardStateFromGroup(
  g: THREE.Group,
  widthBase: number,
  heightBase: number
) {
  return {
    position: { x: g.position.x, y: g.position.y, z: g.position.z },
    rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
    width: Math.max(0.5, widthBase * g.scale.x),
    height: Math.max(0.5, heightBase * g.scale.y),
  }
}

export function BillboardNode({ billboard, isSelected }: BillboardNodeProps) {
  const activeTool = useAppStore((s) => s.activeTool)
  const updateBillboardImage = useAppStore((s) => s.updateBillboardImage)
  const commitHistory = useAppStore((s) => s.commitHistory)
  const groupRef = useRef<THREE.Group>(null)
  const faceRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const dragBaseRef = useRef<ReturnType<typeof billboardStateFromGroup> | null>(null)
  const scaleBaseRef = useRef<{ width: number; height: number } | null>(null)
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
    const scaleBase = scaleBaseRef.current ?? { width: billboard.width, height: billboard.height }
    const next = billboardStateFromGroup(g, scaleBase.width, scaleBase.height)
    const current = useAppStore.getState().billboardImages.find((bb) => bb.id === billboard.id)
    if (current) {
      const currentState = {
        position: current.position,
        rotation: current.rotation ?? { x: 0, y: 0, z: 0 },
        width: current.width,
        height: current.height,
      }
      if (billboardStatesEqual(next, currentState)) return
    }
    updateBillboardImage(billboard.id, {
      position: next.position,
      rotation: next.rotation,
      width: next.width,
      height: next.height,
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
            pushViewportInteraction()
            draggingRef.current = true
            scaleBaseRef.current = { width: billboard.width, height: billboard.height }
            dragBaseRef.current = {
              position: { ...billboard.position },
              rotation: { ...(billboard.rotation ?? { x: 0, y: 0, z: 0 }) },
              width: billboard.width,
              height: billboard.height,
            }
          }}
          onMouseUp={() => {
            popViewportInteraction()
            draggingRef.current = false
            const base = dragBaseRef.current
            const scaleBase = scaleBaseRef.current
            const g = groupRef.current
            if (base && scaleBase && g) {
              const final = billboardStateFromGroup(g, scaleBase.width, scaleBase.height)
              if (!billboardStatesEqual(base, final)) {
                syncFromGroup()
                commitHistory('Edit billboard')
              }
            }
            dragBaseRef.current = null
            scaleBaseRef.current = null
          }}
          onObjectChange={() => {
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
