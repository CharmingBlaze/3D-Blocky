import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/sceneSettingsSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const block1Start = lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
const block1End = lines.findIndex((l) => l.trim() === 'setShowExportDialog: (show) => set({ showExportDialog: show }),')
const block2Start = lines.findIndex((l) => l.trim() === 'applySculptAt: (center, tool, options) => {')
const block2End = lines.findIndex((l) => l.trim().startsWith('simplifySelected:') )
if (block1Start < 0 || block1End < 0 || block2Start < 0 || block2End < 0) {
  throw new Error(
    `markers not found: b1=${block1Start}/${block1End} b2=${block2Start}/${block2End}`
  )
}

// include full simplifySelected through its closing `},`
let block2EndLine = block2End
while (block2EndLine < lines.length && lines[block2EndLine].trim() !== '},') {
  block2EndLine++
}
block2EndLine++

const sliceLines = [
  ...lines.slice(block1Start, block1End + 1),
  '',
  ...lines.slice(block2Start, block2EndLine),
]

const implBody = sliceLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')

const header = `import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { simplifyMesh } from '../mesh/simplification'
import { applySculpt, type SculptTool } from '../sculpt/sculptTools'
import type { Vec3 } from '../utils/math'
import {
  paintColorOnObjects,
  resolveTargetObjectIds,
} from '../material/materialEditorSlice'
import {
  ensureObjectMaterial,
  resolveColorCornersForSelection,
} from '../material/materials'
import { numberToRgba4, rgba4ToNumber } from '../material/materialTypes'
import { rgba4Equal } from '../material/colorObject'
import type { Rgba4 } from '../material/materialTypes'
import { applyTheme } from '../theme/applyTheme'
import { getTheme, hexToNumber, type ThemeId } from '../theme/themes'
import { readStoredThemeId } from '../theme/bootstrapTheme'
import { mirrorWorldPoint } from '../symmetry/symmetry'
import { invalidateFaceGroupCache } from '../mesh/faceGroups'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from './selectionSlice'

const THEME_STORAGE_KEY = 'lpo-theme'
const BOOT_THEME_ID = readStoredThemeId()
const BOOT_ACCENT = hexToNumber(getTheme(BOOT_THEME_ID).css['--accent'])

function objectNeedsRecolor(obj: SceneObject, color: number, rgba: Rgba4): boolean {
  const mat = ensureObjectMaterial(obj).material!
  if (mat.mode === 'texture') return true
  if (obj.color !== color) return true
  if (obj.cornerColors?.length) {
    return obj.cornerColors.some((c) => !rgba4Equal(c, rgba))
  }
  return obj.faceColors.some((fc) => fc !== color)
}

export interface SceneSettingsLayoutState {
  polyBudget: number
  polyBudgetMode: 'strict' | 'adaptive'
  brushDensity: number
  brushStrength: number
  brushRadius: number
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  facetExaggeration: number
  showDensityHeatmap: boolean
  themeId: ThemeId
  activeColor: number
  showToolRing: boolean
  showExportDialog: boolean
}

export interface SceneSettingsLayoutActions {
  setPolyBudget: (budget: number) => void
  setBrushDensity: (density: number) => void
  setBrushStrength: (strength: number) => void
  setBrushRadius: (radius: number) => void
  setActiveColor: (color: number) => void
  setFacetExaggeration: (value: number) => void
  setShowDensityHeatmap: (show: boolean) => void
  setThemeId: (id: ThemeId) => void
  toggleTopologyLock: () => void
  setShowToolRing: (show: boolean) => void
  setShowExportDialog: (show: boolean) => void
  applySculptAt: (center: Vec3, tool: SculptTool, options?: { saveHistory?: boolean }) => void
  simplifySelected: () => void
}

export type SceneSettingsSlice = SceneSettingsLayoutState & SceneSettingsLayoutActions

export const sceneSettingsInitialState: SceneSettingsLayoutState = {
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
  activeColor: BOOT_ACCENT,
  showToolRing: false,
  showExportDialog: false,
}

type SettingsStore = SceneSettingsLayoutState & {
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  objects: SceneObject[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  symmetryEnabled: boolean
  symmetryAxis: import('../symmetry/symmetry').SymmetryAxis
  symmetryPlane: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
}

export function createSceneSettingsSlice<T extends SceneSettingsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & SceneSettingsLayoutActions
): SceneSettingsLayoutActions {
  const store = () => get() as T & SceneSettingsLayoutActions & SettingsStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
${implBody
  .split('\n')
  .map((l) => (l ? '    ' + l : l))
  .join('\n')
  .replace(/\bget\(\)/g, 'store()')}
  }
}
`

fs.writeFileSync(outPath, header)
console.log(`Wrote ${outPath} (${sliceLines.length} impl lines)`)
