import { create } from 'zustand'
import type { FloatingPanelState } from '../components/FloatingPanel'

interface OutlinerUiState {
  open: boolean
  panel: FloatingPanelState
  setOpen: (open: boolean) => void
  toggle: () => void
  setPanel: (panel: FloatingPanelState) => void
}

export const useOutlinerUiStore = create<OutlinerUiState>((set) => ({
  open: false,
  panel: { x: 28, y: 92, width: 380, height: 560, minimized: false },
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => {
    if (state.open && state.panel.minimized) {
      return { open: true, panel: { ...state.panel, minimized: false } }
    }
    return { open: !state.open }
  }),
  setPanel: (panel) => set({ panel }),
}))
