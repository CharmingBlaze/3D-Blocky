import { describe, expect, it } from 'vitest'
import { patchPixelTextureBlendShader } from './pixelTextureBlend'

describe('pixel texture blend shader', () => {
  it('blends painted RGB over the existing surface without applying canvas alpha to the mesh', () => {
    const shader = {
      fragmentShader: `
        vec4 diffuseColor = vec4( diffuse, opacity );
        #include <map_fragment>
        gl_FragColor = diffuseColor;
      `,
    } as Parameters<typeof patchPixelTextureBlendShader>[0]

    patchPixelTextureBlendShader(shader)

    expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
    expect(shader.fragmentShader).toContain(
      'diffuseColor.rgb = mix( diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a )'
    )
    expect(shader.fragmentShader).toContain(
      'diffuseColor.a = mix( diffuseColor.a, 1.0, sampledDiffuseColor.a )'
    )
    expect(shader.fragmentShader).not.toContain('diffuseColor *= sampledDiffuseColor')
  })

  it('leaves an unknown shader layout untouched', () => {
    const shader = {
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    } as Parameters<typeof patchPixelTextureBlendShader>[0]
    const before = shader.fragmentShader
    patchPixelTextureBlendShader(shader)
    expect(shader.fragmentShader).toBe(before)
  })
})
