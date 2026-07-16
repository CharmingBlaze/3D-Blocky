import { beforeEach, describe, expect, it } from 'vitest'
import { useOutlinerUiStore } from './outlinerUiStore'

describe('Outliner shortcut state', () => {
  beforeEach(() => {
    useOutlinerUiStore.setState({
      open: false,
      panel: { x: 28, y: 92, width: 380, height: 560, minimized: false },
    })
  })

  it('opens, closes, and restores a minimized panel', () => {
    useOutlinerUiStore.getState().toggle()
    expect(useOutlinerUiStore.getState().open).toBe(true)
    useOutlinerUiStore.getState().toggle()
    expect(useOutlinerUiStore.getState().open).toBe(false)

    useOutlinerUiStore.setState((state) => ({
      open: true,
      panel: { ...state.panel, minimized: true },
    }))
    useOutlinerUiStore.getState().toggle()
    expect(useOutlinerUiStore.getState().open).toBe(true)
    expect(useOutlinerUiStore.getState().panel.minimized).toBe(false)
  })
})
