export type ViewportDisplayMode =
  | 'model'
  | 'game'
  | 'flat'
  | 'smooth'
  | 'wireframe'
  | 'solid-wire'
  | 'outline'
  | 'unlit'

export interface ViewportDisplayConfig {
  label: string
  hint: string
  forceFlat: boolean
  forceSmooth: boolean
  material: 'lambert' | 'standard' | 'basic' | 'toon'
  wireframe: boolean
  wireOverlay: boolean
  showEdgeOutline: boolean
  selectionEmissive: boolean
  gameLighting: boolean
  /** When true, imported UV textures are shown on meshes in this mode. */
  supportsTexture: boolean
  background: string
}

export const VIEWPORT_DISPLAY_MODES: ViewportDisplayMode[] = [
  'model',
  'game',
  'flat',
  'smooth',
  'wireframe',
  'solid-wire',
  'outline',
  'unlit',
]

export const VIEWPORT_DISPLAY_CONFIG: Record<ViewportDisplayMode, ViewportDisplayConfig> = {
  model: {
    label: 'Model',
    hint: 'Modeling view — textures, clear shading, edge outlines',
    forceFlat: false,
    forceSmooth: false,
    material: 'standard',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: true,
    selectionEmissive: true,
    gameLighting: false,
    supportsTexture: true,
    background: '#0e1118',
  },
  game: {
    label: 'Game',
    hint: 'In-engine look — vertex colors, flat facets, simple lighting',
    forceFlat: false,
    forceSmooth: false,
    material: 'lambert',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: false,
    gameLighting: true,
    supportsTexture: true,
    background: '#141820',
  },
  flat: {
    label: 'Flat',
    hint: 'Editor flat shading with PBR-style lighting',
    forceFlat: true,
    forceSmooth: false,
    material: 'standard',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: true,
    gameLighting: false,
    supportsTexture: true,
    background: '#0a0c10',
  },
  smooth: {
    label: 'Smooth',
    hint: 'Preview all meshes with smooth shading',
    forceFlat: false,
    forceSmooth: true,
    material: 'standard',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: true,
    gameLighting: false,
    supportsTexture: true,
    background: '#0a0c10',
  },
  wireframe: {
    label: 'Wireframe',
    hint: 'Triangle wireframe only',
    forceFlat: false,
    forceSmooth: false,
    material: 'basic',
    wireframe: true,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: false,
    gameLighting: false,
    supportsTexture: false,
    background: '#0a0c10',
  },
  'solid-wire': {
    label: 'Solid + Wire',
    hint: 'Shaded mesh with wireframe overlay',
    forceFlat: false,
    forceSmooth: false,
    material: 'lambert',
    wireframe: false,
    wireOverlay: true,
    showEdgeOutline: false,
    selectionEmissive: false,
    gameLighting: true,
    supportsTexture: true,
    background: '#0a0c10',
  },
  outline: {
    label: 'Outline',
    hint: 'Flat fill with hard edge lines',
    forceFlat: false,
    forceSmooth: false,
    material: 'lambert',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: true,
    selectionEmissive: false,
    gameLighting: true,
    supportsTexture: true,
    background: '#141820',
  },
  unlit: {
    label: 'Unlit',
    hint: 'Raw vertex color with no lighting',
    forceFlat: false,
    forceSmooth: false,
    material: 'basic',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: false,
    gameLighting: false,
    supportsTexture: true,
    background: '#0a0c10',
  },
}

export function resolveFlatShading(
  objectSmooth: boolean,
  mode: ViewportDisplayMode
): boolean {
  const cfg = VIEWPORT_DISPLAY_CONFIG[mode]
  if (cfg.forceFlat) return true
  if (cfg.forceSmooth) return false
  return !objectSmooth
}
