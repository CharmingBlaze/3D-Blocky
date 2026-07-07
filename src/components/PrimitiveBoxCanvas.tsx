import { useMemo, useEffect } from 'react'
import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { useAppStore } from '../store/appStore'
import { boxWireSegments, primitivePreviewBox } from '../primitives/primitiveBoxMath'
import { primitiveBoxPreviewMesh } from '../primitives/primitiveBoxCommit'
import { useTheme } from '../theme/useTheme'

export function PrimitiveBoxCanvas() {
  const { meshOutlineSecondary } = useTheme()
  const {
    activePrimitiveKind,
    primitiveBoxDraft,
    activeColor,
    polyBudget,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
  } = useAppStore(
    useShallow((s) => ({
      activePrimitiveKind: s.activePrimitiveKind,
      primitiveBoxDraft: s.primitiveBoxDraft,
      activeColor: s.activeColor,
      polyBudget: s.polyBudget,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
    }))
  )

  const wireSegments = useMemo(() => {
    if (!primitiveBoxDraft) return []
    return boxWireSegments(primitiveBoxDraft.box)
  }, [primitiveBoxDraft])

  const previewGeometry = useMemo(() => {
    if (!primitiveBoxDraft || !activePrimitiveKind) return null
    if (activePrimitiveKind === 'box') return null

    const roundedParams =
      activePrimitiveKind === 'roundedBox'
        ? { roundness: roundedBoxRoundness, subdivisions: roundedBoxSubdivisions }
        : undefined

    const previewBox = primitivePreviewBox(activePrimitiveKind, {
      phase: primitiveBoxDraft.phase,
      heightAxis: primitiveBoxDraft.heightAxis,
      box: primitiveBoxDraft.box,
    })

    const mesh = primitiveBoxPreviewMesh(
      activePrimitiveKind,
      previewBox,
      primitiveBoxDraft.heightAxis,
      activeColor,
      polyBudget,
      roundedParams,
      primitiveBoxDraft.baseView
    )
    if (!mesh) return null
    const data = mesh.toMeshData(true, 0)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
    geo.computeVertexNormals()
    return geo
  }, [
    primitiveBoxDraft,
    activePrimitiveKind,
    activeColor,
    polyBudget,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
  ])

  useEffect(() => () => previewGeometry?.dispose(), [previewGeometry])

  if (!activePrimitiveKind || !primitiveBoxDraft) return null

  const color = meshOutlineSecondary
  const smoothPreview = activePrimitiveKind === 'roundedBox' || activePrimitiveKind === 'dome'

  return (
    <group renderOrder={20}>
      {wireSegments.map(([a, b], i) => (
        <Line
          key={`box-edge-${i}`}
          points={[
            [a.x, a.y, a.z],
            [b.x, b.y, b.z],
          ]}
          color={color}
          lineWidth={1.5}
          dashed
          dashSize={3}
          gapSize={2}
          transparent
          opacity={0.85}
          depthTest={false}
        />
      ))}

      {previewGeometry && (
        <mesh geometry={previewGeometry} renderOrder={21}>
          <meshStandardMaterial
            color={activeColor}
            transparent
            opacity={0.38}
            flatShading={!smoothPreview}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}
