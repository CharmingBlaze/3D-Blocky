import { describe, expect, it } from 'vitest'
import { connectedUvFaces } from './uvSelection'

describe('connectedUvFaces', () => {
  it('follows shared UV edges but stops at seams and point-only contact', () => {
    const faces = [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
      [5, 6, 7],
      [8, 9, 10, 11],
    ]
    expect(connectedUvFaces(faces, 0)).toEqual([0, 1])
    expect(connectedUvFaces(faces, 2)).toEqual([2])
    expect(connectedUvFaces(faces, 3)).toEqual([3])
  })
})
