import { afterEach, describe, expect, it } from 'vitest'
import { emptySceneSnapshot, resetSceneHistory } from './historySlice'
import { useAppStore } from './appStore'

afterEach(() => {
  resetSceneHistory(emptySceneSnapshot())
  useAppStore.setState({
    objects: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
    polyDrawDraft: null,
    polyDrawHover: null,
    symmetryEnabled: false,
    drawDoubleSided: false,
  })
})

describe('SketchUp-style mesh creation workflows', () => {
  it('creates a rectangle face from two opposite-corner clicks', () => {
    const store = useAppStore.getState()
    store.setPolyDrawMode('rectangle')
    store.polyDrawClick({ x: -2, y: -1, z: 0 }, null, 'front')
    expect(useAppStore.getState().objects).toHaveLength(0)
    useAppStore.getState().polyDrawClick({ x: 3, y: 4, z: 0 }, null, 'front')

    const state = useAppStore.getState()
    expect(state.polyDrawDraft).toBeNull()
    expect(state.objects).toHaveLength(1)
    expect(state.objects[0]!.positions).toHaveLength(4)
    expect(state.objects[0]!.faces).toHaveLength(2)
  })

  it('creates a regular polygon from centre and radius clicks', () => {
    const store = useAppStore.getState()
    store.setPolyDrawMode('ngon')
    store.polyDrawClick({ x: 0, y: 0, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick({ x: 4, y: 0, z: 0 }, null, 'front')

    const object = useAppStore.getState().objects[0]!
    expect(object.positions).toHaveLength(6)
    expect(object.faces.length).toBeGreaterThanOrEqual(4)
  })

  it('creates a face when a connected line loop closes', () => {
    const store = useAppStore.getState()
    store.setPolyDrawMode('poly')
    store.polyDrawClick({ x: 0, y: 0, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick({ x: 3, y: 0, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick({ x: 0, y: 3, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick(
      { x: 0, y: 0, z: 0 },
      { kind: 'draft', draftIndex: 0 },
      'front'
    )

    expect(useAppStore.getState().objects).toHaveLength(1)
    const object = useAppStore.getState().objects[0]!
    expect(object.faces).toHaveLength(1)
    const [aIndex, bIndex, cIndex] = object.faces[0]!
    const a = object.positions[aIndex!]!
    const b = object.positions[bIndex!]!
    const c = object.positions[cIndex!]!
    const normalZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    expect(normalZ).toBeGreaterThan(0)
  })

  it('creates reverse-wound twins when Drawing Options Double-sided is on', () => {
    const store = useAppStore.getState()
    store.setDrawDoubleSided(true)
    store.setPolyDrawMode('poly')
    store.polyDrawClick({ x: 0, y: 0, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick({ x: 3, y: 0, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick({ x: 0, y: 3, z: 0 }, null, 'front')
    useAppStore.getState().polyDrawClick(
      { x: 0, y: 0, z: 0 },
      { kind: 'draft', draftIndex: 0 },
      'front'
    )

    const object = useAppStore.getState().objects[0]!
    expect(object.faces).toHaveLength(2)
    expect(object.faces[1]).toEqual([...(object.faces[0] ?? [])].reverse())
    // Material stays single-sided; the reverse face covers the other view.
    expect(object.material?.doubleSided).toBe(false)
  })

  it('faces a perspective line loop toward the camera captured at drawing start', () => {
    const store = useAppStore.getState()
    const towardCamera = { x: 0, y: 1, z: 0 }
    store.setPolyDrawMode('poly')
    store.polyDrawClick({ x: 0, y: 0, z: 0 }, null, 'perspective', towardCamera)
    useAppStore.getState().polyDrawClick(
      { x: 3, y: 0, z: 0 }, null, 'perspective', towardCamera
    )
    useAppStore.getState().polyDrawClick(
      { x: 0, y: 0, z: 3 }, null, 'perspective', towardCamera
    )
    useAppStore.getState().polyDrawClick(
      { x: 0, y: 0, z: 0 },
      { kind: 'draft', draftIndex: 0 },
      'perspective',
      towardCamera
    )

    const object = useAppStore.getState().objects[0]!
    const [aIndex, bIndex, cIndex] = object.faces[0]!
    const a = object.positions[aIndex!]!
    const b = object.positions[bIndex!]!
    const c = object.positions[cIndex!]!
    const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
    expect(normalY).toBeGreaterThan(0)
  })
})
