import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { extend, applyProps, useThree } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { toCreasedNormals } from 'three-stdlib'
import { version } from '@react-three/drei/helpers/constants.js'
import { useTheme } from '../theme/useTheme'

const PerforatedOutlinesMaterial = shaderMaterial(
  {
    screenspace: true,
    color: new THREE.Color('black'),
    opacity: 1,
    thickness: 0.05,
    size: new THREE.Vector2(),
    dashLength: 10,
    gapLength: 6,
  },
  `#include <common>
   #include <morphtarget_pars_vertex>
   #include <skinning_pars_vertex>
   #include <clipping_planes_pars_vertex>
   uniform float thickness;
   uniform bool screenspace;
   uniform vec2 size;
   void main() {
     #if defined (USE_SKINNING)
       #include <beginnormal_vertex>
       #include <morphnormal_vertex>
       #include <skinbase_vertex>
       #include <skinnormal_vertex>
       #include <defaultnormal_vertex>
     #endif
     #include <begin_vertex>
     #include <morphtarget_vertex>
     #include <skinning_vertex>
     #include <project_vertex>
     #include <clipping_planes_vertex>
     vec4 tNormal = vec4(normal, 0.0);
     vec4 tPosition = vec4(transformed, 1.0);
     #ifdef USE_INSTANCING
       tNormal = instanceMatrix * tNormal;
       tPosition = instanceMatrix * tPosition;
     #endif
     if (screenspace) {
       vec3 newPosition = tPosition.xyz + tNormal.xyz * thickness;
       gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
     } else {
       vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
       vec4 clipNormal = projectionMatrix * modelViewMatrix * tNormal;
       vec2 offset = normalize(clipNormal.xy) * thickness / size * clipPosition.w * 2.0;
       clipPosition.xy += offset;
       gl_Position = clipPosition;
     }
   }`,
  `uniform vec3 color;
   uniform float opacity;
   uniform float dashLength;
   uniform float gapLength;
   #include <clipping_planes_pars_fragment>
   void main() {
     #include <clipping_planes_fragment>
     float coord = gl_FragCoord.x + gl_FragCoord.y;
     float period = dashLength + gapLength;
     if (mod(coord, period) > dashLength) discard;
     gl_FragColor = vec4(color, opacity);
     #include <tonemapping_fragment>
     #include <${version >= 154 ? 'colorspace_fragment' : 'encodings_fragment'}>
   }`
)

extend({ PerforatedOutlinesMaterial })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      perforatedOutlinesMaterial: object
    }
  }
}

interface PerforatedOutlinesProps {
  color?: string | number
  opacity?: number
  thickness?: number
  dashLength?: number
  gapLength?: number
  angle?: number
  renderOrder?: number
}

export function PerforatedOutlines({
  color: colorProp,
  opacity = 0.85,
  thickness = 0.012,
  dashLength = 10,
  gapLength = 6,
  angle = Math.PI,
  renderOrder = 2,
}: PerforatedOutlinesProps) {
  const { meshOutline } = useTheme()
  const color = colorProp ?? meshOutline
  const ref = useRef<THREE.Group>(null)
  const material = useMemo(
    () => new PerforatedOutlinesMaterial({ side: THREE.BackSide }),
    []
  )
  const { gl, size } = useThree()
  const contextSize = useMemo(() => {
    const v = new THREE.Vector2()
    gl.getDrawingBufferSize(v)
    return v
  }, [gl, size.width, size.height])
  const oldAngle = useRef(0)
  const oldGeometry = useRef<THREE.BufferGeometry | null>(null)
  const creasedGeometryRef = useRef<THREE.BufferGeometry | null>(null)

  useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    const parent = group.parent as THREE.Mesh | undefined
    if (!parent?.geometry) return

    if (oldAngle.current !== angle || oldGeometry.current !== parent.geometry) {
      oldAngle.current = angle
      oldGeometry.current = parent.geometry

      const existing = group.children[0] as THREE.Mesh | undefined
      if (existing) {
        if (creasedGeometryRef.current) {
          creasedGeometryRef.current.dispose()
          creasedGeometryRef.current = null
        }
        group.remove(existing)
      }

      let mesh: THREE.Mesh
      const skinnedParent = parent as THREE.SkinnedMesh
      if (skinnedParent.isSkinnedMesh && skinnedParent.skeleton) {
        const skinned = new THREE.SkinnedMesh()
        skinned.material = material
        skinned.bind(skinnedParent.skeleton, skinnedParent.bindMatrix)
        mesh = skinned
      } else if ((parent as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = parent as THREE.InstancedMesh
        const im = new THREE.InstancedMesh(instanced.geometry, material, instanced.count)
        im.instanceMatrix = instanced.instanceMatrix
        mesh = im
      } else {
        mesh = new THREE.Mesh()
        mesh.material = material
      }

      if (angle) {
        creasedGeometryRef.current = toCreasedNormals(parent.geometry, angle)
        mesh.geometry = creasedGeometryRef.current
      } else {
        mesh.geometry = parent.geometry
      }
      mesh.morphTargetInfluences = parent.morphTargetInfluences
      mesh.morphTargetDictionary = parent.morphTargetDictionary
      group.add(mesh)
    }
  }, [angle, material])

  useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    const mesh = group.children[0] as THREE.Mesh | undefined
    const parent = group.parent as THREE.Mesh | undefined
    if (!mesh || !parent) return

    mesh.renderOrder = renderOrder
    mesh.morphTargetInfluences = parent.morphTargetInfluences
    mesh.morphTargetDictionary = parent.morphTargetDictionary
    applyProps(mesh.material, {
      transparent: true,
      thickness,
      color,
      opacity,
      size: contextSize,
      screenspace: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      dashLength,
      gapLength,
    })
  }, [color, opacity, thickness, dashLength, gapLength, contextSize, renderOrder, material])

  useEffect(
    () => () => {
      if (creasedGeometryRef.current) {
        creasedGeometryRef.current.dispose()
        creasedGeometryRef.current = null
      }
      material.dispose()
    },
    [material]
  )

  return <group ref={ref} />
}
