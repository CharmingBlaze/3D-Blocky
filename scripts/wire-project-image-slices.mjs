import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

const extendsMatch = text.match(/export interface AppState extends ([^{]+) \{/)
if (!extendsMatch) throw new Error('AppState extends clause not found')
let clause = extendsMatch[1].trim()
if (!clause.includes('ProjectIoSlice')) clause += ', ProjectIoSlice'
if (!clause.includes('ImageDropSlice')) clause += ', ImageDropSlice'
text = text.replace(/export interface AppState extends [^{]+ \{/, `export interface AppState extends ${clause} {`)

text = text.replace(
  /  imageDropMode: ImageDropMode\r?\n  referenceImages: ReferenceImage\[\]\r?\n  selectedReferenceImageId: string \| null\r?\n  billboardImages: BillboardImage\[\]\r?\n  selectedBillboardImageId: string \| null\r?\n\r?\n/,
  ''
)

text = text.replace(
  /  applySculptAt: \(center: Vec3, tool: SculptTool, options\?: \{ saveHistory\?: boolean \}\) => void\r?\n  simplifySelected: \(\) => void\r?\n  \/\*\* Re-upload GPU textures after a WebGL context restore\. \*\/\r?\n  reconcileGpuResources: \(\) => void\r?\n/,
  ''
)

text = text.replace(
  /  setImageDropMode: \(mode: ImageDropMode\) => void\r?\n  dropImageInView:[\s\S]*?  deleteSelectedImageDrop: \(\) => void\r?\n\r?\n/,
  ''
)

if (!text.includes("from './projectIoSlice'")) {
  const importAnchor = text.includes("from './sceneSettingsSlice'")
    ? "} from './sceneSettingsSlice'"
    : "} from './meshEditSlice'"
  text = text.replace(
    importAnchor,
    `${importAnchor}
import {
  createProjectIoSlice,
  type ProjectIoSlice,
} from './projectIoSlice'
import {
  createImageDropSlice,
  imageDropInitialState,
  type ImageDropSlice,
} from './imageDropSlice'`
  )
}

text = text.replace(
  "export type { ImageDropMode, ReferenceImage, BillboardImage } from '../images/imageDropTypes'",
  "export type { ImageDropMode, ReferenceImage, BillboardImage } from './imageDropSlice'"
)

const projectIoBlock = `  ...imageDropInitialState,
  ...createImageDropSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    addObject: (obj, options) => get().addObject(obj, options),
  }),
  ...createProjectIoSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    restoreScene: (snapshot, options) => restoreSceneToStore(set, get, snapshot, options),
    resetHistory: (snapshot) => resetSceneHistory(snapshot),
    getSnapshot: () => snapshotFromState(get()),
  }),

`

if (!text.includes('createProjectIoSlice')) {
  if (text.includes('...createSceneSettingsSlice<AppState>(set, get),')) {
    text = text.replace(
      '  ...createSceneSettingsSlice<AppState>(set, get),\n\n  ...uvEditorInitialState,',
      `  ...createSceneSettingsSlice<AppState>(set, get),\n\n${projectIoBlock}  ...uvEditorInitialState,`
    )
  } else if (text.includes('  selectedBillboardImageId: null,\n\n  ...uvEditorInitialState,')) {
    text = text.replace(
      '  selectedBillboardImageId: null,\n\n  ...uvEditorInitialState,',
      `${projectIoBlock}  ...uvEditorInitialState,`
    )
    text = text.replace(
      /  imageDropMode: 'off',\r?\n  referenceImages: \[\],\r?\n  selectedReferenceImageId: null,\r?\n  billboardImages: \[\],\r?\n  selectedBillboardImageId: null,\r?\n\r?\n/,
      ''
    )
  } else {
    throw new Error('Could not find anchor for project/image slice wiring')
  }
}

const lines = text.split('\n')
function removeMethod(methodPrefix) {
  const startIdx = lines.findIndex((l) => l.trim().startsWith(methodPrefix))
  if (startIdx < 0) return
  let endIdx = startIdx + 1
  while (endIdx < lines.length) {
    const line = lines[endIdx]
    if (/^  [a-zA-Z_$]/.test(line) || /^  \.\.\./.test(line)) break
    endIdx++
  }
  lines.splice(startIdx, endIdx - startIdx)
}

for (const m of [
  'reconcileGpuResources:',
  'requestProjectLoad:',
  'loadProjectFromDialog:',
  'newProject:',
  'saveProject:',
  'loadProjectFile:',
  'importSceneFile:',
  'setImageDropMode:',
  'dropImageInView:',
  'selectReferenceImage:',
  'updateReferenceImage:',
  'commitReferenceImageEdit:',
  'removeReferenceImage:',
  'selectBillboardImage:',
  'updateBillboardImage:',
  'commitBillboardImageEdit:',
  'removeBillboardImage:',
  'deleteSelectedImageDrop:',
]) {
  removeMethod(m)
}

text = lines.join('\n')
fs.writeFileSync(path, text)
console.log('Wired projectIoSlice and imageDropSlice into appStore.ts')
