import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { useAppStore, type ViewType } from '../store/appStore'
import { buildExtrudePreviewGeometry } from '../preview/extrudePreview'
import type { Vec2 } from '../utils/math'

interface ExtrudePreviewMeshProps {
  points: Vec2[]
  view: ViewType
  closed?: boolean
}

export function ExtrudePreviewMesh({ points, view, closed }: ExtrudePreviewMeshProps) {
  const {
    extrudeAmount,
    defaultDepth,
    brushDensity,
    closeThreshold,
    activeColor,
    strokeMode,
    polyBudget,
    hairTipStyle,
    currentStrokePlane,
    pathStartCap, pathEndCap, pathRadialSegments, pathRadiusScale,
    ribbonStartTip, ribbonEndTip, ribbonTaper, ribbonWidthScale, ribbonFlat,
    pathOutput, pathStartScale, pathEndScale, pathTwist, pathSpacing, pathOffset, pathProfile, pathProfileWidth, pathProfileHeight, pathChainAlternating, pathCardCrossed,
    pathDistributionMode, pathCount, pathStartPadding, pathEndPadding, pathRandomScale, pathRotation, pathRandomRotation, pathAlternateRotation, pathMirrorAlternate, pathSeed,
    sketchLatheMode, penLatheMode, sketchLatheCaps, penLatheCaps,
    latheRadialSegments, latheProfileRings, latheSmoothing,
  } = useAppStore(
    useShallow((s) => ({
      extrudeAmount: s.extrudeAmount,
      defaultDepth: s.defaultDepth,
      brushDensity: s.brushDensity,
      closeThreshold: s.closeThreshold,
      activeColor: s.activeColor,
      strokeMode: s.strokeMode,
      polyBudget: s.polyBudget,
      hairTipStyle: s.hairTipStyle,
      currentStrokePlane: s.currentStrokePlane,
      pathStartCap: s.pathStartCap,
      pathEndCap: s.pathEndCap,
      pathRadialSegments: s.pathRadialSegments,
      pathRadiusScale: s.pathRadiusScale,
      ribbonStartTip: s.ribbonStartTip,
      ribbonEndTip: s.ribbonEndTip,
      ribbonTaper: s.ribbonTaper,
      ribbonWidthScale: s.ribbonWidthScale,
      ribbonFlat: s.ribbonFlat,
      pathOutput: s.pathOutput, pathStartScale: s.pathStartScale, pathEndScale: s.pathEndScale, pathTwist: s.pathTwist, pathSpacing: s.pathSpacing, pathOffset: s.pathOffset,
      pathProfile: s.pathProfile, pathProfileWidth: s.pathProfileWidth, pathProfileHeight: s.pathProfileHeight, pathChainAlternating: s.pathChainAlternating, pathCardCrossed: s.pathCardCrossed,
      pathDistributionMode: s.pathDistributionMode, pathCount: s.pathCount, pathStartPadding: s.pathStartPadding, pathEndPadding: s.pathEndPadding,
      pathRandomScale: s.pathRandomScale, pathRotation: s.pathRotation, pathRandomRotation: s.pathRandomRotation,
      pathAlternateRotation: s.pathAlternateRotation, pathMirrorAlternate: s.pathMirrorAlternate, pathSeed: s.pathSeed,
      sketchLatheMode: s.sketchLatheMode, penLatheMode: s.penLatheMode,
      sketchLatheCaps: s.sketchLatheCaps, penLatheCaps: s.penLatheCaps,
      latheRadialSegments: s.latheRadialSegments, latheProfileRings: s.latheProfileRings,
      latheSmoothing: s.latheSmoothing,
    }))
  )

  const geometry = useMemo(() => {
    if (points.length < 2) return null
    return buildExtrudePreviewGeometry(
      points,
      view,
      defaultDepth,
      extrudeAmount,
      brushDensity,
      closeThreshold,
      closed,
      {
        strokeMode, polyBudget, hairTipStyle, planeFrame: currentStrokePlane,
        pathStartCap, pathEndCap, pathRadialSegments, pathRadiusScale,
        ribbonStartTip, ribbonEndTip, ribbonTaper, ribbonWidthScale, ribbonFlat,
        pathOutput, pathStartScale, pathEndScale, pathTwist, pathSpacing, pathOffset, pathProfile, pathProfileWidth, pathProfileHeight, pathChainAlternating, pathCardCrossed,
        pathDistributionMode, pathCount, pathStartPadding, pathEndPadding, pathRandomScale, pathRotation, pathRandomRotation, pathAlternateRotation, pathMirrorAlternate, pathSeed,
        latheMode: sketchLatheMode || penLatheMode,
        latheCaps: sketchLatheCaps || penLatheCaps,
        latheRadialSegments, latheProfileRings, latheSmoothing,
      }
    )
  }, [
    points,
    view,
    defaultDepth,
    extrudeAmount,
    brushDensity,
    closeThreshold,
    closed,
    strokeMode,
    polyBudget,
    hairTipStyle,
    currentStrokePlane,
    pathStartCap, pathEndCap, pathRadialSegments, pathRadiusScale,
    ribbonStartTip, ribbonEndTip, ribbonTaper, ribbonWidthScale, ribbonFlat,
    pathOutput, pathStartScale, pathEndScale, pathTwist, pathSpacing, pathOffset, pathProfile, pathProfileWidth, pathProfileHeight, pathChainAlternating, pathCardCrossed,
    pathDistributionMode, pathCount, pathStartPadding, pathEndPadding, pathRandomScale, pathRotation, pathRandomRotation, pathAlternateRotation, pathMirrorAlternate, pathSeed,
    sketchLatheMode, penLatheMode, sketchLatheCaps, penLatheCaps,
    latheRadialSegments, latheProfileRings, latheSmoothing,
  ])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null

  const color = new THREE.Color(activeColor)

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.34}
        flatShading={false}
        side={THREE.DoubleSide}
        depthWrite={false}
        emissive={color}
        emissiveIntensity={0.08}
      />
    </mesh>
  )
}
