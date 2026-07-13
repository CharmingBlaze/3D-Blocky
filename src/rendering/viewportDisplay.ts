export type ViewportDisplayMode =
  | 'model'
  | 'game'
  | 'flat'
  | 'smooth'
  | 'wireframe'
  | 'solid-wire'
  | 'outline'
  | 'unlit'
  | 'normals'

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
  /** When true, face-normal arrows are drawn on every mesh. */
  showNormals: boolean
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
  'normals',
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
    showNormals: false,
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
    showNormals: false,
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
    showNormals: false,
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
    showNormals: false,
    background: '#0a0c10',
  },
  wireframe: {
    label: 'Wireframe',
    hint: 'See-through authored polygon boundaries',
    forceFlat: false,
    forceSmooth: false,
    material: 'basic',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: true,
    selectionEmissive: false,
    gameLighting: false,
    supportsTexture: false,
    showNormals: false,
    background: '#0a0c10',
  },
  'solid-wire': {
    label: 'Solid + Wire',
    hint: 'Shaded mesh with authored polygon boundaries',
    forceFlat: false,
    forceSmooth: false,
    material: 'lambert',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: true,
    selectionEmissive: false,
    gameLighting: true,
    supportsTexture: true,
    showNormals: false,
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
    showNormals: false,
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
    showNormals: false,
    background: '#0a0c10',
  },
  normals: {
    label: 'Normals',
    hint: 'Flat shading with face normals — green outward, red inverted. Alt+click to flip · F flips selection',
    forceFlat: true,
    forceSmooth: false,
    material: 'lambert',
    wireframe: false,
    wireOverlay: false,
    showEdgeOutline: false,
    selectionEmissive: true,
    gameLighting: true,
    supportsTexture: false,
    showNormals: true,
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
