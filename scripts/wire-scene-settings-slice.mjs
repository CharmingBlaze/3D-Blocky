import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

text = text.replace(
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice, MeshEditSlice {',
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice, MeshEditSlice, SceneSettingsSlice {'
)

text = text.replace(
  /  polyBudget: number\r?\n  polyBudgetMode: 'strict' \| 'adaptive'\r?\n  brushDensity: number\r?\n  brushStrength: number\r?\n  brushRadius: number\r?\n  rdpTolerance: number\r?\n  closeThreshold: number\r?\n  defaultDepth: number\r?\n  facetExaggeration: number\r?\n  showDensityHeatmap: boolean\r?\n  themeId: ThemeId\r?\n  topologyLocked: boolean\r?\n\r?\n  activeColor: number\r?\n  showToolRing: boolean\r?\n  showExportDialog: boolean\r?\n\r?\n/,
  ''
)

text = text.replace(
  /  setPolyBudget: \(budget: number\) => void\r?\n  setBrushDensity: \(density: number\) => void\r?\n  setBrushStrength: \(strength: number\) => void\r?\n  setBrushRadius: \(radius: number\) => void\r?\n  setActiveColor: \(color: number\) => void\r?\n  setFacetExaggeration: \(value: number\) => void\r?\n  setShowDensityHeatmap: \(show: boolean\) => void\r?\n  setThemeId: \(id: ThemeId\) => void\r?\n  toggleTopologyLock: \(\) => void\r?\n  setShowToolRing: \(show: boolean\) => void\r?\n  setShowExportDialog: \(show: boolean\) => void\r?\n/,
  ''
)

text = text.replace(
  /  applySculptAt: \(center: Vec3, tool: SculptTool, options\?: \{ saveHistory\?: boolean \}\) => void\r?\n  simplifySelected: \(\) => void\r?\n/,
  ''
)

if (!text.includes('sceneSettingsSlice')) {
  text = text.replace(
    "} from './meshEditSlice'\nexport type { StrokeMode",
    `} from './meshEditSlice'
import {
  createSceneSettingsSlice,
  sceneSettingsInitialState,
  type SceneSettingsSlice,
} from './sceneSettingsSlice'
export type { StrokeMode`
  )
}

text = text.replace(
  `  ...createMeshEditSlice<AppState>(set, get),

  polyBudget: 128,
  polyBudgetMode: 'strict',
  brushDensity: 12,
  brushStrength: 0.5,
  brushRadius: 30,
  rdpTolerance: 2,
  closeThreshold: 8,
  defaultDepth: 0,
  facetExaggeration: 0,
  showDensityHeatmap: false,
  themeId: BOOT_THEME_ID,
  topologyLocked: false,

  activeColor: BOOT_ACCENT,
  showToolRing: false,
  showExportDialog: false,

  imageDropMode:`,
  `  ...createMeshEditSlice<AppState>(set, get),
  ...sceneSettingsInitialState,
  ...createSceneSettingsSlice<AppState>(set, get),

  imageDropMode:`
)

const lines = text.split('\n')
const removeBlock = (startMarker, endMarkerInclusive) => {
  const start = lines.findIndex((l) => l.trim() === startMarker)
  const end = lines.findIndex((l) => l.trim() === endMarkerInclusive)
  if (start >= 0 && end >= start) {
    lines.splice(start, end - start + 1)
  }
}

removeBlock(
  'setPolyBudget: (budget) => set({ polyBudget: budget }),',
  'setShowExportDialog: (show) => set({ showExportDialog: show }),'
)

const sculptStart = lines.findIndex((l) => l.trim() === 'applySculptAt: (center, tool, options) => {')
if (sculptStart >= 0) {
  let sculptEnd = sculptStart
  while (sculptEnd < lines.length && lines[sculptEnd].trim() !== '},') {
    sculptEnd++
  }
  lines.splice(sculptStart, sculptEnd - sculptStart + 1)
}

text = lines.join('\n')

// Remove dead objectNeedsRecolor from appStore if present
text = text.replace(
  /function objectNeedsRecolor\(obj: SceneObject, color: number, rgba: Rgba4\): boolean \{[\s\S]*?\}\r?\n\r?\nexport const useAppStore/,
  'export const useAppStore'
)

fs.writeFileSync(path, text)
console.log('Wired sceneSettingsSlice into appStore.ts')
