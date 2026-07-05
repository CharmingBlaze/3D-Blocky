import * as THREE from 'three'

/**
 * Blend texture RGB over vertex/face color by texel alpha — opaque surface, WYSIWYG paint preview.
 * Inlined from Three r173 `map_fragment` (mapTexelToLinear was removed); only the combine line differs.
 */
export function patchPixelTextureBlendShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (!shader.fragmentShader.includes('#include <map_fragment>')) return

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    /* glsl */ `
#ifdef USE_MAP

	vec4 sampledDiffuseColor = texture2D( map, vMapUv );

	#ifdef DECODE_VIDEO_TEXTURE

		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );

	#endif

	diffuseColor.rgb = mix( diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a );

#endif
`
  )
}

export const PIXEL_TEXTURE_BLEND_CACHE_KEY = 'pixelTextureBlend'
