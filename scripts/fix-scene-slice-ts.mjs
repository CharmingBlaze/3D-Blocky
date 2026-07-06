import fs from 'fs'

const path = 'src/store/sceneObjectsSlice.ts'
let t = fs.readFileSync(path, 'utf8')
const start = t.indexOf('  return {')
const end = t.lastIndexOf('  }\n}')
const head = t.slice(0, start)
const tail = t.slice(end)
let body = t.slice(start, end)

body = body.replace(/\bset\(/g, 'setPartial(')

// removeObject setPartial callback needs cast for cross-slice fields
body = body.replace(
  /setPartial\(\(s\) => \{\s*const removed = new Set\(\[id\]\)\s*const \{ objectTextures, pixelDocuments \} = deps\.purgeTextureResourcesForObjects\(\s*s\.objects,/,
  `setPartial((s) => {
        const st = s as unknown as SceneStore
        const removed = new Set([id])
        const { objectTextures, pixelDocuments } = deps.purgeTextureResourcesForObjects(
          st.objects,`
)
body = body.replace(
  /return \{\s*objects: s\.objects\.filter/,
  `return {
          objects: st.objects.filter`
)
body = body.replace(
  /selectedObjectId: s\.selectedObjectId === id \? null : s\.selectedObjectId,\s*selectionObjectIds: s\.selectionObjectIds\.filter/,
  `selectedObjectId: st.selectedObjectId === id ? null : st.selectedObjectId,
          selectionObjectIds: st.selectionObjectIds.filter`
)

fs.writeFileSync(path, head + body + tail)
console.log('fixed sceneObjectsSlice setPartial usage')
