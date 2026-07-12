import { describe, expect, it } from 'vitest'
import { APP_PROJECT_FORMAT } from '../app/branding'
import { parseProjectFile } from './projectIO'

function project(objects: unknown[]): string {
  return JSON.stringify({ version: 1, format: APP_PROJECT_FORMAT, objects })
}

describe('parseProjectFile', () => {
  it('returns a clear error for a non-object JSON root', () => {
    expect(() => parseProjectFile('null')).toThrow('expected a project object')
  })

  it('rejects faces that point outside the vertex array', () => {
    expect(() =>
      parseProjectFile(
        project([
          {
            id: 'broken',
            positions: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
            faces: [[0, 1, 4]],
            faceColors: [0xffffff],
          },
        ])
      )
    ).toThrow('contains an invalid face')
  })

  it('accepts a structurally valid legacy-compatible mesh', () => {
    const parsed = parseProjectFile(
      project([
        {
          id: 'triangle',
          positions: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
          ],
          faces: [[0, 1, 2]],
          faceColors: [0xffffff],
        },
      ])
    )
    expect(parsed.objects).toHaveLength(1)
  })
})
